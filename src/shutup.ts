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
import type { PendingSelectionRecord } from "./directory.js";
import { callWahaApi } from "./http-client.js";
import { resolveWahaAccount, listEnabledWahaAccounts } from "./accounts.js";
import type { CoreConfig } from "./types.js";
import type { ResolvedWahaAccount } from "./accounts.js";

// ── Regex for /shutup and /unshutup commands ──
// DO NOT CHANGE — must match: /shutup, /shutup all, /shutup 5m, /shutup all 2h,
// /unshutup, /unshutup all, /unmute, /unmute all
export const SHUTUP_RE = /^\/(shutup|unshutup|unmute)\s*(all)?\s*(\d+[mhd])?\s*$/i;

// ── Duration constants ──
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

// ── Duration parsing ──

/** Parse duration string like "5m", "2h", "1d" into milliseconds. Returns 0 for permanent. */
function parseDuration(str: string | null): number {
  if (!str) return 0;
  const match = str.match(/^(\d+)([mhd])$/i);
  if (!match) return 0;
  const [, num, unit] = match;
  const value = parseInt(num!, 10);
  switch (unit!.toLowerCase()) {
    case "m": return value * MS_PER_MINUTE;
    case "h": return value * MS_PER_HOUR;
    case "d": return value * MS_PER_DAY;
    default: return 0;
  }
}

/** Format duration for display */
function formatDuration(ms: number): string {
  if (ms <= 0) return "";
  const minutes = Math.round(ms / MS_PER_MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

// ── Pending DM selections (SQLite-backed, survives restarts) ──
// DO NOT CHANGE — pending selections are stored in SQLite across ALL account DBs.
// Previously used an in-memory Map which was lost on gateway restart.
// Fixed Phase 7 (2026-03-15).

/**
 * Check if incoming DM is a pending selection response.
 * Searches ALL account DBs since the pending selection may have been stored by a different account.
 * Returns the pending selection if found and not expired, null otherwise.
 * DO NOT CHANGE — pending selection check must run before normal message processing.
 */
export function checkPendingSelection(senderId: string, config?: CoreConfig): PendingSelectionRecord | null {
  if (config) {
    // Search all account DBs — the pending may be stored by any account
    const enabledAccounts = listEnabledWahaAccounts(config);
    for (const acct of enabledAccounts) {
      try {
        const dirDb = getDirectoryDb(acct.accountId);
        const pending = dirDb.getPendingSelection(senderId);
        if (pending) return pending;
      } catch (err) {
        console.warn(`[waha] checkPendingSelection failed for account: ${String(err)}`);
      }
    }
    return null;
  }
  // Fallback: no config provided, can't search all accounts
  return null;
}

/**
 * Clear a pending selection across ALL account DBs.
 * DO NOT CHANGE — must clear from all DBs since we don't know which one stored it.
 */
export function clearPendingSelection(senderId: string, config?: CoreConfig): void {
  if (config) {
    const enabledAccounts = listEnabledWahaAccounts(config);
    for (const acct of enabledAccounts) {
      try {
        const dirDb = getDirectoryDb(acct.accountId);
        dirDb.clearPendingSelection(senderId);
      } catch (err) {
        console.warn(`[waha] clearPendingSelection failed for account: ${String(err)}`);
      }
    }
  }
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

  // Check if sender matches a superuser — exact match on normalized phone number.
  // DO NOT CHANGE to substring matching — would allow unauthorized users to execute commands.
  const senderNormalized = senderId.replace(/@.*$/, "");
  for (const su of superUsers) {
    if (senderNormalized === su.identifier || su.identifier === senderNormalized) {
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
  const durationMs = parseDuration(durationStr);
  const expiresAt = durationMs > 0 ? Date.now() + durationMs : 0;

  if (isGroup) {
    // === GROUP CONTEXT ===
    if (isMute) {
      // Send confirmation BEFORE muting — sendWahaText blocks sends to muted groups.
      // DO NOT CHANGE this ordering.
      const durationText = durationMs > 0 ? ` for ${formatDuration(durationMs)}` : "";
      await sendWahaText({ cfg: config, to: chatId, text: `🔇 Shutting up${durationText}.`, accountId: account.accountId, bypassPolicy: true });
      try {
        await muteGroupAllAccounts(chatId, senderId, config, expiresAt, runtime);
      } catch (err) {
        runtime.log?.(`[waha] shutup: mute failed after confirmation: ${String(err)}`);
        await sendWahaText({ cfg: config, to: chatId, text: "⚠️ Mute failed. Please try again.", accountId: account.accountId, bypassPolicy: true }).catch(e => runtime.log?.(`[waha] shutup: error notification send failed: ${String(e)}`));
      }
    } else {
      // Unmute FIRST, then send confirmation (group was muted, can't send before unmute).
      try {
        await unmuteGroupAllAccounts(chatId, config, runtime);
        await sendWahaText({ cfg: config, to: chatId, text: "🔊 I'm back.", accountId: account.accountId, bypassPolicy: true });
      } catch (err) {
        runtime.log?.(`[waha] unshutup: unmute failed: ${String(err)}`);
        await sendWahaText({ cfg: config, to: chatId, text: "⚠️ Unmute failed. Please try again.", accountId: account.accountId, bypassPolicy: true }).catch(e => runtime.log?.(`[waha] shutup: error notification send failed: ${String(e)}`));
      }
    }
  } else {
    // === DM CONTEXT ===
    // DM confirmations are sent to the sender's DM chat, NOT to the group.
    // sendWahaText mute check only applies to @g.us targets, so DM sends are unaffected.
    if (isMute) {
      if (allFlag) {
        // Mute all groups — send confirmation FIRST (muting 100+ groups takes minutes).
        // Skip participant DM backup for "all" mode — too slow with WAHA rate limits.
        // DO NOT CHANGE — confirmation must be immediate, muting runs in background.
        const groups = await getGroupsForAccount(account, config);
        const durationText = durationMs > 0 ? ` for ${formatDuration(durationMs)}` : "";
        await sendWahaText({ cfg: config, to: chatId, text: `🔇 Shutting up in ${groups.length} groups${durationText}...`, accountId: account.accountId, bypassPolicy: true });
        // Mute in background (no await) — skip DM backup for bulk operations
        (async () => {
          let successCount = 0;
          for (const g of groups) {
            try {
              // Write mute record directly without participant fetch (fast path)
              const enabledAccounts = listEnabledWahaAccounts(config);
              for (const acct of enabledAccounts) {
                const dirDb = getDirectoryDb(acct.accountId);
                dirDb.muteGroup(g.jid, senderId, acct.accountId, expiresAt, null);
              }
              successCount++;
            } catch (err) {
              runtime.log?.(`[waha] shutup: failed to mute ${g.jid}: ${String(err)}`);
            }
          }
          runtime.log?.(`[waha] shutup all: muted ${successCount}/${groups.length} groups`);
          await sendWahaText({ cfg: config, to: chatId, text: `✅ Done. Muted ${successCount}/${groups.length} groups.`, accountId: account.accountId, bypassPolicy: true }).catch(() => {});
        })().catch(err => runtime.log?.(`[waha] shutup all background error: ${String(err)}`));
      } else {
        // Show group list for selection
        await showGroupListForMute(chatId, senderId, account, config, durationStr, runtime);
      }
    } else {
      if (allFlag) {
        // Unmute all groups across all accounts — synchronous SQLite operations (fast).
        const enabledAccounts = listEnabledWahaAccounts(config);
        let totalUnmuted = 0;
        for (const acct of enabledAccounts) {
          const dirDb = getDirectoryDb(acct.accountId);
          const mutedGroups = dirDb.getAllMutedGroups();
          for (const mg of mutedGroups) {
            try {
              unmuteGroupWithDmRestore(dirDb, mg.groupJid, acct, config, runtime);
              totalUnmuted++;
            } catch (err) {
              runtime.log?.(`[waha] unshutup: failed to unmute ${mg.groupJid}: ${String(err)}`);
            }
          }
        }
        await sendWahaText({ cfg: config, to: chatId, text: `🔊 Unmuted ${totalUnmuted} groups.`, accountId: account.accountId, bypassPolicy: true });
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
  pending: PendingSelectionRecord,
  text: string,
  chatId: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<boolean> {
  if (!pending.groups || pending.groups.length === 0) {
    await sendWahaText({ cfg: config, to: chatId, text: "Selection expired. Please run the command again.", accountId: account.accountId, bypassPolicy: true });
    return true; // Clear the pending
  }

  const trimmed = text.trim().toLowerCase();

  if (trimmed === "all") {
    if (pending.type === "mute") {
      const durationMs = parseDuration(pending.durationStr);
      const expiresAt = durationMs > 0 ? Date.now() + durationMs : 0;
      let successCount = 0;
      for (const g of pending.groups) {
        try {
          await muteGroupAllAccounts(g.jid, pending.senderId, config, expiresAt, runtime);
          successCount++;
        } catch (err) {
          runtime.log?.(`[waha] shutup: failed to mute ${g.jid}: ${String(err)}`);
        }
      }
      const durationText = durationMs > 0 ? ` for ${formatDuration(durationMs)}` : "";
      await sendWahaText({ cfg: config, to: chatId, text: `🔇 Shutting up in ${successCount}/${pending.groups.length} groups${durationText}.`, accountId: account.accountId, bypassPolicy: true });
    } else {
      let successCount = 0;
      for (const g of pending.groups) {
        try {
          await unmuteGroupAllAccounts(g.jid, config, runtime);
          successCount++;
        } catch (err) {
          runtime.log?.(`[waha] unshutup: failed to unmute ${g.jid}: ${String(err)}`);
        }
      }
      await sendWahaText({ cfg: config, to: chatId, text: `🔊 Unmuted ${successCount}/${pending.groups.length} groups.`, accountId: account.accountId, bypassPolicy: true });
    }
    return true;
  }

  const num = parseInt(trimmed, 10);
  if (isNaN(num) || num < 1 || num > pending.groups.length) {
    await sendWahaText({ cfg: config, to: chatId, text: `Invalid selection. Reply with a number (1-${pending.groups.length}) or "all".`, accountId: account.accountId, bypassPolicy: true });
    return false; // Don't clear pending — let user retry
  }

  const selected = pending.groups[num - 1]!;
  if (pending.type === "mute") {
    const durationMs = parseDuration(pending.durationStr);
    const expiresAt = durationMs > 0 ? Date.now() + durationMs : 0;
    await muteGroupAllAccounts(selected.jid, pending.senderId, config, expiresAt, runtime);
    const durationText = durationMs > 0 ? ` for ${formatDuration(durationMs)}` : "";
    await sendWahaText({ cfg: config, to: chatId, text: `🔇 Shutting up in ${selected.name}${durationText}.`, accountId: account.accountId, bypassPolicy: true });
  } else {
    await unmuteGroupAllAccounts(selected.jid, config, runtime);
    await sendWahaText({ cfg: config, to: chatId, text: `🔊 Unmuted ${selected.name}.`, accountId: account.accountId, bypassPolicy: true });
  }
  return true;
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
    unmuteGroupWithDmRestore(dirDb, groupJid, acct, config, runtime);
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
    // Group will still be muted but participant DMs will NOT be blocked (no participant list).
    // DO NOT CHANGE — mute must proceed even if participant fetch fails.
    runtime.log?.(`[waha] shutup: failed to get participants for ${groupJid}: ${String(err)}. Group will be muted but participant DMs will NOT be blocked.`);
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
function unmuteGroupWithDmRestore(
  dirDb: ReturnType<typeof getDirectoryDb>,
  groupJid: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): void {
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

/** Show group list in DM for mute selection — writes pending to ALL account DBs */
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
    await sendWahaText({ cfg: config, to: chatId, text: "I'm not in any groups.", accountId: account.accountId, bypassPolicy: true });
    return;
  }
  const list = groups.map((g, i) => `${i + 1}) ${g.name}`).join("\n");
  // Store pending selection in ALL account DBs so any session can find it
  // DO NOT CHANGE — cross-session pending selection requires all DBs to have the entry.
  const enabledAccounts = listEnabledWahaAccounts(config);
  for (const acct of enabledAccounts) {
    try {
      const dirDb = getDirectoryDb(acct.accountId);
      dirDb.setPendingSelection(senderId, { type: "mute", groups, durationStr });
    } catch (err) {
      runtime.log?.(`[waha] failed to store pending selection in ${acct.accountId}: ${String(err)}`);
    }
  }
  await sendWahaText({
    cfg: config, to: chatId,
    text: `Which group would you like me to shut up in?\n\n${list}\n\nReply with the number, or "all".`,
    accountId: account.accountId,
    bypassPolicy: true,
  });
}

/** Show muted groups list in DM for unmute selection — writes pending to ALL account DBs */
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
    await sendWahaText({ cfg: config, to: chatId, text: "I'm not muted in any groups.", accountId: account.accountId, bypassPolicy: true });
    return;
  }
  const list = groups.map((g, i) => `${i + 1}) ${g.name}`).join("\n");
  // Store pending selection in ALL account DBs so any session can find it
  // DO NOT CHANGE — cross-session pending selection requires all DBs to have the entry.
  for (const acct of enabledAccounts) {
    try {
      const dirDb = getDirectoryDb(acct.accountId);
      dirDb.setPendingSelection(senderId, { type: "unmute", groups, durationStr: null });
    } catch (err) {
      runtime.log?.(`[waha] failed to store pending selection in ${acct.accountId}: ${String(err)}`);
    }
  }
  await sendWahaText({
    cfg: config, to: chatId,
    text: `Which group would you like to unmute?\n\n${list}\n\nReply with the number, or "all".`,
    accountId: account.accountId,
    bypassPolicy: true,
  });
}

/**
 * Get all groups across ALL enabled accounts, via WAHA API.
 * Tries bot sessions first (more reliable), falls back to human sessions.
 * Deduplicates by JID across accounts. WAHA /groups returns a dict keyed by JID.
 * DO NOT CHANGE — must try all accounts to handle rate limits on individual sessions.
 */
async function getGroupsForAccount(account: ResolvedWahaAccount, config: CoreConfig): Promise<{ jid: string; name: string }[]> {
  const accounts = listEnabledWahaAccounts(config);
  // Sort: bot sessions first (more reliable API access)
  const sorted = [...accounts].sort((a, b) => (a.role === "bot" ? -1 : 1) - (b.role === "bot" ? -1 : 1));
  const seenJids = new Set<string>();
  const result: { jid: string; name: string }[] = [];

  for (const acct of sorted) {
    try {
      const data = await callWahaApi({
        baseUrl: acct.baseUrl,
        apiKey: acct.apiKey,
        path: `/api/${encodeURIComponent(acct.session)}/groups`,
        method: "GET",
      });
      // WAHA returns dict keyed by JID
      const groups = typeof data === "object" && data !== null && !Array.isArray(data)
        ? Object.values(data as Record<string, unknown>)
        : (Array.isArray(data) ? data : []);
      for (const g of groups as Array<Record<string, unknown>>) {
        const jid = (g.id as string) || (g.jid as string) || "";
        if (jid && !seenJids.has(jid)) {
          seenJids.add(jid);
          result.push({
            jid,
            name: (g.subject as string) || (g.name as string) || jid,
          });
        }
      }
      if (result.length > 0) return result; // Got groups from this account, done
    } catch (err) {
      console.warn(`[waha] getGroupsForAccount failed for session ${acct.session}: ${String(err)}`);
    }
  }
  return result;
}
