/**
 * /join, /leave, /list WhatsApp slash commands — regex-based, NOT LLM-dependent.
 * Enables users to join/leave groups/channels and list memberships via WhatsApp messages.
 * Follows the exact pattern established by /shutup (src/shutup.ts).
 *
 * DO NOT CHANGE — slash commands bypass the LLM pipeline for direct group management.
 *
 * Added Phase 43 (2026-03-25).
 */

import {
  sendWahaText,
  joinWahaGroup,
  leaveWahaGroup,
  getWahaGroups,
  getWahaChannels,
  followWahaChannel,
  unfollowWahaChannel,
  getWahaChannel,
  resolveWahaTarget,
  searchWahaChannelsByText,
  fuzzyScore,
} from "./send.js";
import { checkShutupAuthorization } from "./shutup.js";
import { getDirectoryDb } from "./directory.js";
import type { PendingSelectionRecord } from "./directory.js";
import { listEnabledWahaAccounts } from "./accounts.js";
import type { ResolvedWahaAccount } from "./accounts.js";
import type { CoreConfig } from "./types.js";
import { createLogger } from "./logger.js";

const log = createLogger({ component: "commands" });

// ── User-friendly error extraction ──

const FRIENDLY_MAP: Record<string, string> = {
  "bad-request": "invalid invite link or group not found",
  "not-authorized": "not authorized to join this group",
  "item-not-found": "group not found",
};

function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Try to extract JSON blob from WAHA error strings like "WAHA POST /api/... failed: 500 {...}"
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const exMsg: string | undefined = parsed?.exception?.message ?? parsed?.message;
      if (exMsg) {
        return FRIENDLY_MAP[exMsg] ?? exMsg;
      }
    } catch { /* not valid JSON, fall through */ }
  }
  // No JSON found — return a short version, no stack traces
  const firstLine = raw.split("\n")[0] ?? raw;
  return firstLine.length > 100 ? firstLine.slice(0, 100) + "…" : firstLine;
}

// ── Regex for /join, /leave, /list commands ──
// DO NOT CHANGE — must match: /join <args>, /leave <args>, /list, /list groups, /list channels
export const COMMANDS_RE = /^\/(join|leave|list)\s*(.*)?$/i;

// ── Invite link detection ──

/** Detect if a string looks like a WhatsApp invite link or raw invite code (group OR channel). */
function isInviteLink(str: string): boolean {
  // WhatsApp invite links: full URL or exact 22-char alphanumeric code.
  // DO NOT use {22,} (22+) — group names can be 22+ chars and would falsely match. DO NOT CHANGE.
  return str.includes("chat.whatsapp.com/") || str.includes("whatsapp.com/channel/") || /^[A-Za-z0-9]{22}$/.test(str);
}

/** Detect if a string is specifically a channel invite link (whatsapp.com/channel/CODE). */
function isChannelInviteLink(str: string): boolean {
  return str.includes("whatsapp.com/channel/");
}

/** Extract invite code from a WhatsApp invite link or raw code. */
function extractInviteCode(str: string): string {
  const idx = str.indexOf("chat.whatsapp.com/");
  if (idx !== -1) {
    // Take everything after chat.whatsapp.com/ and strip trailing slashes/params
    const after = str.slice(idx + "chat.whatsapp.com/".length);
    return after.split(/[/?#]/)[0]?.trim() ?? after.trim();
  }
  return str.trim();
}

// ── Authorization ──

/**
 * Reuse checkShutupAuthorization (godModeSuperUsers + allowFrom + groupAllowFrom).
 * DO NOT CHANGE — must be consistent with shutup authorization check.
 */
async function checkCommandAuthorization(
  senderId: string,
  chatId: string,
  isGroup: boolean,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<boolean> {
  const authorized = await checkShutupAuthorization(senderId, chatId, isGroup, config, runtime);
  if (!authorized) {
    await sendWahaText({
      cfg: config,
      to: chatId,
      text: "⛔ You are not authorized to use this command.",
      accountId: undefined,
      bypassPolicy: true,
    }).catch(err => log.warn("commands: failed to send auth error", { error: String(err) }));
  }
  return authorized;
}

// ── Store pending selection across ALL account DBs ──

function storePendingSelection(
  senderId: string,
  record: Omit<PendingSelectionRecord, "senderId" | "timestamp">,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): void {
  const enabledAccounts = listEnabledWahaAccounts(config);
  for (const acct of enabledAccounts) {
    try {
      const dirDb = getDirectoryDb(acct.accountId);
      dirDb.setPendingSelection(senderId, record);
    } catch (err) {
      runtime.log?.(`[waha] commands: failed to store pending selection in ${acct.accountId}: ${String(err)}`);
    }
  }
}

// ── /join handler ──

async function handleJoin(
  args: string,
  chatId: string,
  senderId: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  log.info("commands: handleJoin called", { args: args.trim(), isChannel: isChannelInviteLink(args.trim()), isInvite: isInviteLink(args.trim()) });
  if (!args.trim()) {
    await sendWahaText({
      cfg: config, to: chatId,
      text: "Usage: /join <invite-link-or-group-name>",
      accountId: account.accountId, bypassPolicy: true,
    });
    return;
  }

  if (isChannelInviteLink(args.trim())) {
    // ── Channel invite link path ──
    // Step 1: Extract invite code from URL
    // Step 2: Resolve invite code to newsletter JID via GET /channels/{code}
    // Step 3: Follow the channel via POST /channels/{jid}/follow
    const channelCode = args.trim().split("whatsapp.com/channel/")[1]?.split(/[/?#]/)[0]?.trim() ?? "";
    if (!channelCode) {
      await sendWahaText({ cfg: config, to: chatId, text: "⚠️ Invalid channel link", accountId: account.accountId, bypassPolicy: true });
      return;
    }
    try {
      // Resolve invite code → newsletter JID (WAHA returns { id, name, ... })
      const channelInfo = await getWahaChannel({ cfg: config, channelId: channelCode, accountId: account.accountId }) as Record<string, unknown>;
      const channelJid = String(channelInfo.id ?? "");
      const channelName = String(channelInfo.name ?? "channel");
      if (!channelJid || !channelJid.endsWith("@newsletter")) {
        await sendWahaText({ cfg: config, to: chatId, text: "⚠️ Can't resolve channel from invite link", accountId: account.accountId, bypassPolicy: true });
        return;
      }
      // Follow using the resolved JID
      await followWahaChannel({ cfg: config, channelId: channelJid, accountId: account.accountId });
      await sendWahaText({ cfg: config, to: chatId, text: `Followed "${channelName}" ✓`, accountId: account.accountId, bypassPolicy: true });
      log.info("commands: /join channel via invite link succeeded", { channelCode: channelCode.slice(0, 12) + "...", channelJid });
    } catch (err) {
      const raw = (err as Error).message ?? String(err);
      await sendWahaText({ cfg: config, to: chatId, text: `⚠️ Can't follow channel: ${friendlyError(err)}`, accountId: account.accountId, bypassPolicy: true });
      log.warn("commands: /join channel invite link failed", { error: raw });
    }
    return;
  }

  if (isInviteLink(args.trim())) {
    // ── Group invite link / raw code path ──
    const inviteCode = extractInviteCode(args.trim());
    try {
      await joinWahaGroup({ cfg: config, inviteCode, accountId: account.accountId });
      await sendWahaText({
        cfg: config, to: chatId,
        text: "Joined group ✓",
        accountId: account.accountId, bypassPolicy: true,
      });
      log.info("commands: /join via invite code succeeded", { inviteCode: inviteCode.slice(0, 8) + "..." });
    } catch (err) {
      const raw = (err as Error).message ?? String(err);
      await sendWahaText({
        cfg: config, to: chatId,
        text: `⚠️ Can't join group: ${friendlyError(err)}`,
        accountId: account.accountId, bypassPolicy: true,
      });
      log.warn("commands: /join via invite code failed", { error: raw });
    }
    return;
  }

  // ── Name-based search path (groups + channels) ──
  let result: Awaited<ReturnType<typeof resolveWahaTarget>>;
  try {
    result = await resolveWahaTarget({ cfg: config, query: args.trim(), type: "auto", accountId: account.accountId });
  } catch (err) {
    await sendWahaText({
      cfg: config, to: chatId,
      text: `⚠️ Search failed: ${friendlyError(err)}`,
      accountId: account.accountId, bypassPolicy: true,
    });
    return;
  }

  // Filter to groups and channels only — can't "join" a contact
  const topMatches = result.matches
    .filter(m => m.jid.endsWith("@g.us") || m.jid.endsWith("@newsletter"))
    .slice(0, 5);

  // If no channel matches found, search WhatsApp's public channel directory
  // resolveWahaTarget only returns channels the bot already follows — this fallback finds unfollowed ones.
  // DO NOT REMOVE — without this, /join <channel name> can't discover new channels.
  const hasChannelMatch = topMatches.some(m => m.jid.endsWith("@newsletter"));
  if (!hasChannelMatch) {
    try {
      const channelResults = await searchWahaChannelsByText({ cfg: config, query: args.trim(), accountId: account.accountId });
      const channels = Array.isArray(channelResults) ? channelResults : (channelResults as any)?.newsletters ?? [];
      for (const ch of channels) {
        const jid = String((ch as any).id ?? (ch as any).jid ?? "");
        const name = String((ch as any).name ?? (ch as any).subject ?? "");
        if (jid && name) {
          topMatches.push({ jid, name, type: "channel" as const, confidence: fuzzyScore(args.trim(), name) });
        }
      }
      // Re-sort by confidence and limit to 5
      topMatches.sort((a, b) => b.confidence - a.confidence);
      topMatches.splice(5);
    } catch (err) {
      log.warn("commands: channel search fallback failed", { error: (err as Error).message });
    }
  }

  if (topMatches.length === 0) {
    await sendWahaText({
      cfg: config, to: chatId,
      text: `No groups or channels matching '${args.trim()}' found`,
      accountId: account.accountId, bypassPolicy: true,
    });
    return;
  }

  if (topMatches.length === 1 && topMatches[0]!.confidence >= 0.8) {
    // Single high-confidence match — already a member/follower
    const isChannel = topMatches[0]!.jid.endsWith("@newsletter");
    await sendWahaText({
      cfg: config, to: chatId,
      text: isChannel
        ? `Already following ${topMatches[0]!.name}`
        : `Already a member of ${topMatches[0]!.name}`,
      accountId: account.accountId, bypassPolicy: true,
    });
    return;
  }

  // Multiple matches or low confidence — present numbered list
  const list = topMatches.map((m, i) => `${i + 1}) ${m.name}`).join("\n");
  const groups = topMatches.map(m => ({ jid: m.jid, name: m.name }));
  storePendingSelection(senderId, { type: "join", groups, durationStr: null }, config, runtime);
  await sendWahaText({
    cfg: config, to: chatId,
    text: `Multiple matches for '${args.trim()}':\n\n${list}\n\nReply with a number to select.`,
    accountId: account.accountId, bypassPolicy: true,
  });
}

// ── /leave handler ──

async function handleLeave(
  args: string,
  chatId: string,
  senderId: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  if (!args.trim()) {
    await sendWahaText({
      cfg: config, to: chatId,
      text: "Usage: /leave <group-or-channel-name>",
      accountId: account.accountId, bypassPolicy: true,
    });
    return;
  }

  let result: Awaited<ReturnType<typeof resolveWahaTarget>>;
  try {
    result = await resolveWahaTarget({ cfg: config, query: args.trim(), type: "auto", accountId: account.accountId });
  } catch (err) {
    await sendWahaText({
      cfg: config, to: chatId,
      text: `⚠️ Search failed: ${friendlyError(err)}`,
      accountId: account.accountId, bypassPolicy: true,
    });
    return;
  }

  // Filter to only groups and channels (not contacts)
  const filtered = result.matches
    .filter(m => m.jid.endsWith("@g.us") || m.jid.endsWith("@newsletter"))
    .slice(0, 5);

  if (filtered.length === 0) {
    await sendWahaText({
      cfg: config, to: chatId,
      text: `No groups or channels matching '${args.trim()}' found`,
      accountId: account.accountId, bypassPolicy: true,
    });
    return;
  }

  if (filtered.length === 1 && filtered[0]!.confidence >= 0.8) {
    await executeLeave(filtered[0]!.jid, filtered[0]!.name, chatId, account, config, runtime);
    return;
  }

  // Multiple matches or low confidence — present numbered list
  const list = filtered.map((m, i) => `${i + 1}) ${m.name}`).join("\n");
  const groups = filtered.map(m => ({ jid: m.jid, name: m.name }));
  storePendingSelection(senderId, { type: "leave", groups, durationStr: null }, config, runtime);
  await sendWahaText({
    cfg: config, to: chatId,
    text: `Multiple matches for '${args.trim()}':\n\n${list}\n\nReply with a number to select.`,
    accountId: account.accountId, bypassPolicy: true,
  });
}

/** Execute a leave for a single resolved JID. */
async function executeLeave(
  jid: string,
  name: string,
  chatId: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  try {
    if (jid.endsWith("@newsletter")) {
      await unfollowWahaChannel({ cfg: config, channelId: jid, accountId: account.accountId });
    } else {
      await leaveWahaGroup({ cfg: config, groupId: jid, accountId: account.accountId });
    }
    await sendWahaText({
      cfg: config, to: chatId,
      text: `Left "${name}" ✓`,
      accountId: account.accountId, bypassPolicy: true,
    });
    log.info("commands: /leave succeeded", { jid });
  } catch (err) {
    const raw = (err as Error).message ?? String(err);
    await sendWahaText({
      cfg: config, to: chatId,
      text: `⚠️ Can't leave: ${friendlyError(err)}`,
      accountId: account.accountId, bypassPolicy: true,
    });
    log.warn("commands: /leave failed", { jid, error: raw });
  }
}

// ── /list handler ──

async function handleList(
  args: string,
  chatId: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void },
): Promise<void> {
  const sub = args.trim().toLowerCase();
  const showGroups = !sub || sub === "groups" || sub === "group" || sub === "all";
  const showChannels = !sub || sub === "channels" || sub === "channel" || sub === "all";

  let groupsList: string[] = [];
  let channelsList: string[] = [];

  if (showGroups) {
    try {
      const raw = await getWahaGroups({ cfg: config, accountId: account.accountId });
      const groups = typeof raw === "object" && raw !== null && !Array.isArray(raw)
        ? Object.values(raw as Record<string, unknown>)
        : (Array.isArray(raw) ? raw : []);
      groupsList = (groups as Array<Record<string, unknown>>)
        .map(g => String(g.subject ?? g.name ?? g.id ?? ""))
        .filter(Boolean)
        .sort();
    } catch (err) {
      log.warn("commands: /list groups fetch failed", { error: String(err) });
    }
  }

  if (showChannels) {
    try {
      const raw = await getWahaChannels({ cfg: config, accountId: account.accountId });
      const channels = Array.isArray(raw) ? raw : (typeof raw === "object" && raw !== null ? Object.values(raw as Record<string, unknown>) : []);
      channelsList = (channels as Array<Record<string, unknown>>)
        .map(c => String(c.name ?? c.subject ?? c.id ?? ""))
        .filter(Boolean)
        .sort();
    } catch (err) {
      log.warn("commands: /list channels fetch failed", { error: String(err) });
    }
  }

  const parts: string[] = [];

  if (showGroups) {
    if (groupsList.length > 0) {
      parts.push(`📱 Groups (${groupsList.length}):\n${groupsList.map((g, i) => `${i + 1}. ${g}`).join("\n")}`);
    } else {
      parts.push("📱 Groups: none");
    }
  }

  if (showChannels) {
    if (channelsList.length > 0) {
      parts.push(`📢 Channels (${channelsList.length}):\n${channelsList.map((c, i) => `${i + 1}. ${c}`).join("\n")}`);
    } else {
      parts.push("📢 Channels: none");
    }
  }

  if (parts.length === 0) {
    await sendWahaText({
      cfg: config, to: chatId,
      text: "Not a member of any groups or channels",
      accountId: account.accountId, bypassPolicy: true,
    });
    return;
  }

  await sendWahaText({
    cfg: config, to: chatId,
    text: parts.join("\n\n"),
    accountId: account.accountId, bypassPolicy: true,
  });
}

// ── Main dispatcher ──

/**
 * Handle a /join, /leave, or /list slash command.
 * Caller must check authorization before calling this function (or let the internal guard handle it).
 *
 * DO NOT CHANGE — this is the primary entry point for all slash command handling.
 */
export async function handleSlashCommand(params: {
  command: "join" | "leave" | "list";
  args: string;
  chatId: string;
  senderId: string;
  isGroup: boolean;
  account: ResolvedWahaAccount;
  config: CoreConfig;
  runtime: { log?: (msg: string) => void; error?: (msg: string) => void };
}): Promise<void> {
  const { command, args, chatId, senderId, isGroup, account, config, runtime } = params;

  // Authorization guard — reuses godModeSuperUsers check from shutup.ts
  const authorized = await checkCommandAuthorization(senderId, chatId, isGroup, config, runtime);
  if (!authorized) {
    log.warn("commands: unauthorized command attempt", { command, senderId });
    return;
  }

  switch (command) {
    case "join":
      await handleJoin(args, chatId, senderId, account, config, runtime);
      break;
    case "leave":
      await handleLeave(args, chatId, senderId, account, config, runtime);
      break;
    case "list":
      await handleList(args, chatId, account, config, runtime);
      break;
    default:
      log.warn("commands: unknown command", { command });
  }
}

// ── Selection response handler ──

/**
 * Handle a numbered selection response for a pending /join or /leave flow.
 * Called from inbound.ts when a pending selection of type "join" or "leave" is found.
 *
 * Returns true when the selection was handled (clears pending), false to keep pending alive.
 *
 * DO NOT CHANGE — mirrors handleSelectionResponse in shutup.ts for /join and /leave.
 */
export async function handleCommandSelectionResponse(
  pending: PendingSelectionRecord,
  text: string,
  chatId: string,
  account: ResolvedWahaAccount,
  config: CoreConfig,
  runtime: { log?: (msg: string) => void; error?: (msg: string) => void },
): Promise<boolean> {
  if (!pending.groups || pending.groups.length === 0) {
    await sendWahaText({
      cfg: config, to: chatId,
      text: "Selection expired. Please run the command again.",
      accountId: account.accountId, bypassPolicy: true,
    });
    return true; // Clear the pending
  }

  const trimmed = text.trim();
  const num = parseInt(trimmed, 10);

  if (isNaN(num) || num < 1 || num > pending.groups.length) {
    await sendWahaText({
      cfg: config, to: chatId,
      text: `Invalid selection. Reply with a number (1-${pending.groups.length}).`,
      accountId: account.accountId, bypassPolicy: true,
    });
    return false; // Don't clear pending — let user retry
  }

  const selected = pending.groups[num - 1]!;

  if (pending.type === "join") {
    // resolveWahaTarget only returns groups/channels the bot already has access to.
    // For channels, we still call followWahaChannel in case it's from a search result the bot can see but hasn't followed.
    if (selected.jid.endsWith("@newsletter")) {
      try {
        await followWahaChannel({ cfg: config, channelId: selected.jid, accountId: account.accountId });
        await sendWahaText({
          cfg: config, to: chatId,
          text: `Followed channel ✓`,
          accountId: account.accountId, bypassPolicy: true,
        });
        log.info("commands: /join channel via selection succeeded", { jid: selected.jid });
      } catch (err) {
        await sendWahaText({
          cfg: config, to: chatId,
          text: `⚠️ Can't follow channel: ${friendlyError(err)}`,
          accountId: account.accountId, bypassPolicy: true,
        });
        log.warn("commands: /join channel via selection failed", { jid: selected.jid, error: String(err) });
      }
    } else {
      // Group — bot is already a member (resolveWahaTarget only returns groups bot has access to)
      await sendWahaText({
        cfg: config, to: chatId,
        text: `Already a member of ${selected.name}`,
        accountId: account.accountId, bypassPolicy: true,
      });
    }
    return true;
  }

  if (pending.type === "leave") {
    await executeLeave(selected.jid, selected.name, chatId, account, config, runtime);
    return true;
  }

  // Unknown pending type — clear it
  return true;
}
