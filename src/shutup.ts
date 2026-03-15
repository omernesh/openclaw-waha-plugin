/**
 * /shutup and /unshutup WhatsApp commands — regex-based, NOT LLM-dependent.
 * Mutes/unmutes the bot in specific groups. When muted, all inbound messages are
 * silently dropped and outbound sends are blocked. DM settings are backed up on
 * mute and restored on unmute.
 *
 * DO NOT CHANGE — slash commands are the primary mechanism for users to mute the bot
 * in groups. The regex-based approach ensures they work even when the bot is muted.
 *
 * Added Phase 7 (2026-03-15).
 */

import { sendWahaText, getWahaGroupParticipants } from "./send.js";
import { getDirectoryDb } from "./directory.js";
import { callWahaApi } from "./http-client.js";
import { resolveWahaAccount, listEnabledWahaAccounts } from "./accounts.js";
import type { CoreConfig } from "./types.js";
import type { ResolvedWahaAccount } from "./accounts.js";

// ── Regex for /shutup and /unshutup commands ──
// DO NOT CHANGE — must match: /shutup, /shutup all, /shutup 5m, /shutup all 2h,
// /unshutup, /unshutup all, /unmute, /unmute all
export const SHUTUP_RE = /^\/(shutup|unshutup|unmute)\s*(all)?\s*(\d+[mhd])?\s*$/i;

// ── Duration parsing ──

/** Parse duration string like "5m", "2h", "1d" into milliseconds. Returns 0 for permanent. */
function parseDuration(str: string | null): number {
  if (!str) return 0;
  const match = str.match(/^(\d+)([mhd])$/i);
  if (!match) return 0;
  const [, num, unit] = match;
  const value = parseInt(num!, 10);
  switch (unit!.toLowerCase()) {
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "d": return value * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

/** Format duration for display */
function formatDuration(ms: number): string {
  if (ms <= 0) return "";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

// ── Pending DM selections (interactive group list flow) ──

interface PendingSelection {
  type: "mute" | "unmute";
  groups: { jid: string; name: string }[];
  senderId: string;
  durationStr: string | null;
  timestamp: number;
}
const _pendingSelections = new Map<string, PendingSelection>(); // key: senderJid
const SELECTION_TTL_MS = 60_000; // 1 minute to respond

/**
 * Check if incoming DM is a pending selection response.
 * Returns the pending selection if found and not expired, null otherwise.
 * DO NOT CHANGE — pending selection check must run before normal message processing.
 */
export function checkPendingSelection(senderId: string): PendingSelection | null {
  const pending = _pendingSelections.get(senderId);
  if (!pending) return null;
  if (Date.now() - pending.timestamp > SELECTION_TTL_MS) {
    _pendingSelections.delete(senderId);
    return null;
  }
  return pending;
}

export function clearPendingSelection(senderId: string): void {
  _pendingSelections.delete(senderId);
}

// ── Authorization ──

/**
 * Check if the sender is authorized to use /shutup and /unshutup commands.
 * Authorized users: god mode superusers, allowFrom, groupAllowFrom.
 * DO NOT CHANGE — authorization ensures only trusted users can mute the bot.
 */
export async function checkShutupAuthorization(
  senderId: string,
  chatId: string,
  isGroup: boolean,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<boolean> {
  const wahaConfig = config.channels?.waha as Record<string, unknown> | undefined;
  const dmFilter = wahaConfig?.dmFilter as Record<string, unknown> | undefined;
  const groupFilter = wahaConfig?.groupFilter as Record<string, unknown> | undefined;
  const superUsers = (dmFilter?.godModeSuperUsers ?? groupFilter?.godModeSuperUsers ?? []) as Array<{ identifier: string }>;

  const senderNormalized = senderId.replace(/@.*$/, "");
  for (const su of superUsers) {
    if (senderNormalized.includes(su.identifier) || su.identifier.includes(senderNormalized)) {
      return true;
    }
  }

  // Check groupAllowFrom (admin-configured senders)
  const groupAllowFrom = (wahaConfig?.groupAllowFrom ?? []) as string[];
  if (groupAllowFrom.includes(senderId)) return true;

  // Check allowFrom
  const allowFrom = (wahaConfig?.allowFrom ?? []) as string[];
  if (allowFrom.includes(senderId)) return true;

  // Also check per-account allowFrom/groupAllowFrom
  const accounts = wahaConfig?.accounts as Record<string, Record<string, unknown>> | undefined;
  if (accounts) {
    for (const acctCfg of Object.values(accounts)) {
      const acctAllowFrom = (acctCfg.allowFrom ?? []) as string[];
      if (acctAllowFrom.includes(senderId)) return true;
      const acctGroupAllowFrom = (acctCfg.groupAllowFrom ?? []) as string[];
      if (acctGroupAllowFrom.includes(senderId)) return true;
    }
  }

  runtime.log?.(`[waha] shutup: unauthorized attempt by ${senderId}`);
  return false;
}

// ── Main command handler ──

/**
 * Handle a /shutup or /unshutup command.
 * In GROUP context: directly mute/unmute the current group.
 * In DM context: show interactive group list for selection, or use "all" flag.
 *
 * IMPORTANT: For /shutup in GROUP context, the confirmation message is sent BEFORE
 * muting the group, because sendWahaText blocks sends to muted groups.
 * For /unshutup in GROUP context, we unmute FIRST then send confirmation.
 * DO NOT CHANGE this ordering — it ensures confirmations are always delivered.
 */
export async function handleShutupCommand(params: {
  command: "shutup" | "unshutup" | "unmute";
  allFlag: boolean;
  durationStr: string | null;
  chatId: string;
  senderId: string;
  isGroup: boolean;
  account: ResolvedWahaAccount;
  config: CoreConfig;
  runtime: { log?: (msg: string) => void };
}): Promise<void> {
  const { command, allFlag, durationStr, chatId, senderId, isGroup, account, config, runtime } = params;
  const isMute = command === "shutup";
  const isUnmute = command === "unshutup" || command === "unmute";
  const durationMs = parseDuration(durationStr);
  const expiresAt = durationMs > 0 ? Date.now() + durationMs : 0;

  if (isGroup) {
    // === GROUP CONTEXT ===
    if (isMute) {
      // Send confirmation BEFORE muting — sendWahaText blocks sends to muted groups.
      // DO NOT CHANGE this ordering.
      const durationText = durationMs > 0 ? ` for ${formatDuration(durationMs)}` : "";
      await sendWahaText({ cfg: config, to: chatId, text: `\u{1F507} Shutting up${durationText}.`, accountId: account.accountId });
      await muteGroupAllAccounts(chatId, senderId, config, expiresAt, runtime);
    } else if (isUnmute) {
      // Unmute FIRST, then send confirmation (group was muted, can't send before unmute).
      await unmuteGroupAllAccounts(chatId, config, runtime);
      await sendWahaText({ cfg: config, to: chatId, text: "\u{1F50A} I'm back.", accountId: account.accountId });
    }
  } else {
    // === DM CONTEXT ===
    // DM confirmations are sent to the sender's DM chat, NOT to the group.
    // sendWahaText mute check only applies to @g.us targets, so DM sends are unaffected.
    if (isMute) {
      if (allFlag) {
        // Mute all groups
        const groups = await getGroupsForAccount(account, config);
        for (const g of groups) {
          await muteGroupAllAccounts(g.jid, senderId, config, expiresAt, runtime);
        }
        const durationText = durationMs > 0 ? ` for ${formatDuration(durationMs)}` : "";
        await sendWahaText({ cfg: config, to: chatId, text: `\u{1F507} Shutting up in all ${groups.length} groups${durationText}.`, accountId: account.accountId });
      } else {
        // Show group list for selection
        await showGroupListForMute(chatId, senderId, account, config, durationStr, runtime);
      }
    } else if (isUnmute) {
      if (allFlag) {
        // Unmute all groups across all accounts
        const enabledAccounts = listEnabledWahaAccounts(config);
        let totalUnmuted = 0;
        for (const acct of enabledAccounts) {
          const dirDb = getDirectoryDb(acct.accountId);
          const mutedGroups = dirDb.getAllMutedGroups();
          for (const mg of mutedGroups) {
            await unmuteGroupWithDmRestore(dirDb, mg.groupJid, acct, config, runtime);
          }
          totalUnmuted += mutedGroups.length;
        }
        await sendWahaText({ cfg: config, to: chatId, text: `\u{1F50A} Unmuted ${totalUnmuted} groups.`, accountId: account.accountId });
      } else {
        // Show muted groups list for selection
        await showMutedGroupsListForUnmute(chatId, senderId, account, config, runtime);
      }
    }
  }
}

// ── Interactive DM selection handler ──

/**
 * Handle a selection response from a pending DM flow (user replied with a number or "all").
 * DO NOT CHANGE — handles the interactive group list flow for DM-based mute/unmute.
 */
export async function handleSelectionResponse(
  pending: PendingSelection,
  text: string,
  chatId: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === "all") {
    if (pending.type === "mute") {
      const durationMs = parseDuration(pending.durationStr);
      const expiresAt = durationMs > 0 ? Date.now() + durationMs : 0;
      for (const g of pending.groups) {
        await muteGroupAllAccounts(g.jid, pending.senderId, config, expiresAt, runtime);
      }
      const durationText = durationMs > 0 ? ` for ${formatDuration(durationMs)}` : "";
      await sendWahaText({ cfg: config, to: chatId, text: `\u{1F507} Shutting up in all ${pending.groups.length} groups${durationText}.`, accountId: account.accountId });
    } else {
      for (const g of pending.groups) {
        await unmuteGroupAllAccounts(g.jid, config, runtime);
      }
      await sendWahaText({ cfg: config, to: chatId, text: `\u{1F50A} Unmuted ${pending.groups.length} groups.`, accountId: account.accountId });
    }
    return;
  }

  const num = parseInt(trimmed, 10);
  if (isNaN(num) || num < 1 || num > pending.groups.length) {
    await sendWahaText({ cfg: config, to: chatId, text: `Invalid selection. Reply with a number (1-${pending.groups.length}) or "all".`, accountId: account.accountId });
    return;
  }

  const selected = pending.groups[num - 1]!;
  if (pending.type === "mute") {
    const durationMs = parseDuration(pending.durationStr);
    const expiresAt = durationMs > 0 ? Date.now() + durationMs : 0;
    await muteGroupAllAccounts(selected.jid, pending.senderId, config, expiresAt, runtime);
    const durationText = durationMs > 0 ? ` for ${formatDuration(durationMs)}` : "";
    await sendWahaText({ cfg: config, to: chatId, text: `\u{1F507} Shutting up in ${selected.name}${durationText}.`, accountId: account.accountId });
  } else {
    await unmuteGroupAllAccounts(selected.jid, config, runtime);
    await sendWahaText({ cfg: config, to: chatId, text: `\u{1F50A} Unmuted ${selected.name}.`, accountId: account.accountId });
  }
}

// ── Helpers ──

/** Mute a group across ALL enabled accounts (like per-group filter overrides). */
async function muteGroupAllAccounts(
  groupJid: string,
  mutedBy: string,
  config: CoreConfig,
  expiresAt: number,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  const enabledAccounts = listEnabledWahaAccounts(config);
  for (const acct of enabledAccounts) {
    const dirDb = getDirectoryDb(acct.accountId);
    await muteGroupWithDmBackup(dirDb, groupJid, mutedBy, acct, config, expiresAt, runtime);
  }
}

/** Unmute a group across ALL enabled accounts. */
async function unmuteGroupAllAccounts(
  groupJid: string,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  const enabledAccounts = listEnabledWahaAccounts(config);
  for (const acct of enabledAccounts) {
    const dirDb = getDirectoryDb(acct.accountId);
    await unmuteGroupWithDmRestore(dirDb, groupJid, acct, config, runtime);
  }
}

/**
 * Mute a group: snapshot DM settings for all participants, block their DMs, record mute.
 * DO NOT CHANGE — DM backup ensures participant DM settings are restored on unmute.
 */
async function muteGroupWithDmBackup(
  dirDb: ReturnType<typeof getDirectoryDb>,
  groupJid: string,
  mutedBy: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  expiresAt: number,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  // Get current participants
  let participants: string[] = [];
  try {
    const participantData = await getWahaGroupParticipants({ cfg: config, groupId: groupJid, accountId: account.accountId }) as unknown[];
    participants = (participantData as Array<Record<string, unknown>>).map(
      (p) => (p.id as string) || (p.jid as string) || ""
    ).filter(Boolean);
  } catch (err) {
    runtime.log?.(`[waha] shutup: failed to get participants for ${groupJid}: ${String(err)}`);
  }

  // Snapshot current DM settings for all participants
  const dmBackup: Record<string, boolean> = {};
  for (const participantJid of participants) {
    const settings = dirDb.getContactDmSettings(participantJid);
    dmBackup[participantJid] = settings.canInitiate; // default is true
  }

  // Mute the group
  dirDb.muteGroup(groupJid, mutedBy, account.accountId, expiresAt, dmBackup);

  // Block DMs from all participants
  // Ensure each participant exists in contacts table first (FK constraint on dm_settings)
  for (const participantJid of participants) {
    dirDb.upsertContact(participantJid);
    dirDb.setContactDmSettings(participantJid, { canInitiate: false });
  }

  runtime.log?.(`[waha] muted group ${groupJid} by ${mutedBy}, backed up DM settings for ${participants.length} participants`);
}

/**
 * Unmute a group: restore DM settings from backup, remove mute record.
 * DO NOT CHANGE — DM restore ensures participant settings return to pre-mute state.
 */
async function unmuteGroupWithDmRestore(
  dirDb: ReturnType<typeof getDirectoryDb>,
  groupJid: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  const dmBackup = dirDb.unmuteGroup(groupJid);

  // Restore DM settings from backup
  if (dmBackup) {
    for (const [participantJid, canInitiate] of Object.entries(dmBackup)) {
      dirDb.upsertContact(participantJid);
      dirDb.setContactDmSettings(participantJid, { canInitiate });
    }
    runtime.log?.(`[waha] unmuted group ${groupJid}, restored DM settings for ${Object.keys(dmBackup).length} participants`);
  } else {
    runtime.log?.(`[waha] unmuted group ${groupJid}, no DM backup to restore`);
  }
}

/** Show group list in DM for mute selection */
async function showGroupListForMute(
  chatId: string,
  senderId: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  durationStr: string | null,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  const groups = await getGroupsForAccount(account, config);
  if (groups.length === 0) {
    await sendWahaText({ cfg: config, to: chatId, text: "I'm not in any groups.", accountId: account.accountId });
    return;
  }
  const list = groups.map((g, i) => `${i + 1}) ${g.name}`).join("\n");
  _pendingSelections.set(senderId, { type: "mute", groups, senderId, durationStr, timestamp: Date.now() });
  await sendWahaText({
    cfg: config, to: chatId,
    text: `Which group would you like me to shut up in?\n\n${list}\n\nReply with the number, or "all".`,
    accountId: account.accountId,
  });
}

/** Show muted groups list in DM for unmute selection */
async function showMutedGroupsListForUnmute(
  chatId: string,
  senderId: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  // Collect muted groups from all accounts
  const enabledAccounts = listEnabledWahaAccounts(config);
  const seenJids = new Set<string>();
  const groups: { jid: string; name: string }[] = [];
  for (const acct of enabledAccounts) {
    const dirDb = getDirectoryDb(acct.accountId);
    const mutedGroups = dirDb.getAllMutedGroups();
    for (const mg of mutedGroups) {
      if (seenJids.has(mg.groupJid)) continue;
      seenJids.add(mg.groupJid);
      const contact = dirDb.getContact(mg.groupJid);
      groups.push({ jid: mg.groupJid, name: contact?.displayName ?? mg.groupJid });
    }
  }

  if (groups.length === 0) {
    await sendWahaText({ cfg: config, to: chatId, text: "I'm not muted in any groups.", accountId: account.accountId });
    return;
  }
  const list = groups.map((g, i) => `${i + 1}) ${g.name}`).join("\n");
  _pendingSelections.set(senderId, { type: "unmute", groups, senderId, durationStr: null, timestamp: Date.now() });
  await sendWahaText({
    cfg: config, to: chatId,
    text: `Which group would you like to unmute?\n\n${list}\n\nReply with the number, or "all".`,
    accountId: account.accountId,
  });
}

/**
 * Get all groups the account's session is in, via WAHA API.
 * WAHA /groups returns a dict keyed by JID — use Object.values().
 */
async function getGroupsForAccount(account: ResolvedWahaAccount, config: CoreConfig): Promise<{ jid: string; name: string }[]> {
  try {
    const data = await callWahaApi({
      baseUrl: account.baseUrl,
      apiKey: account.apiKey,
      path: `/api/${encodeURIComponent(account.session)}/groups`,
      method: "GET",
    });
    // WAHA returns dict keyed by JID
    const groups = typeof data === "object" && data !== null && !Array.isArray(data)
      ? Object.values(data as Record<string, unknown>)
      : (Array.isArray(data) ? data : []);
    return (groups as Array<Record<string, unknown>>).map((g) => ({
      jid: (g.id as string) || (g.jid as string) || "",
      name: (g.subject as string) || (g.name as string) || (g.id as string) || "Unknown",
    })).filter(g => g.jid);
  } catch (err) {
    return [];
  }
}
