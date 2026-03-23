import { readFileSync } from "fs";
import { extname, basename } from "path";
import { LRUCache } from "lru-cache";
import { detectMime } from "openclaw/plugin-sdk/media-runtime";
import { sendMediaWithLeadingCaption } from "openclaw/plugin-sdk/reply-payload";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import { listEnabledWahaAccounts, resolveWahaAccount } from "./accounts.js";
import { normalizeWahaMessagingTarget } from "./normalize.js";
import { callWahaApi, warnOnError } from "./http-client.js";
import { assertPolicyCanSend } from "./policy-enforcer.js";
import type { CoreConfig } from "./types.js";
import { getDirectoryDb } from "./directory.js";
import { getWahaClient, type WahaClient } from "./waha-client.js";

const HEAD_DETECT_TIMEOUT_MS = 5000;
const RESOLVE_FETCH_DELAY_MS = 200;

// URL detection for auto link preview in sendWahaText.
// Added Phase 3, Plan 01 (2026-03-11). DO NOT REMOVE.
const URL_REGEX = /https?:\/\/\S+/i;

// Bot proxy prefix constant — prepended to text when bot borrows a human session.
// Extracted to module level for reuse in both send.ts and inbound.ts (media caption). DO NOT CHANGE.
export const BOT_PROXY_PREFIX = "🤖";

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  assertCanSend — Role-based send guardrail (Phase 4, Plan 01)       ║
// ║                                                                      ║
// ║  Replaces old assertAllowedSession which hardcoded session names.   ║
// ║  Now reads role/subRole from config. Listener sessions CANNOT send. ║
// ║  Default: bot/full-access (backward compatible with no-role configs)║
// ║                                                                      ║
// ║  History: v1.8.x had no guardrail, v1.9.0 hardcoded omer block,    ║
// ║  Phase 4 replaced with config-driven role check.                    ║
// ║  DO NOT REMOVE — prevents listener sessions from sending messages.  ║
// ╚══════════════════════════════════════════════════════════════════════╝
export function assertCanSend(session: string, cfg: CoreConfig): void {
  const accounts = listEnabledWahaAccounts(cfg);
  const match = accounts.find(a => a.session === session);
  if (!match) {
    console.warn(`[waha] assertCanSend: session "${session}" not found in config, defaulting to full-access`);
  }
  const subRole = match?.subRole ?? "full-access";
  if (subRole === "listener") {
    throw new Error(
      `Session '${session}' has sub-role 'listener' and cannot send messages. ` +
      `Change sub-role to 'full-access' in config to enable sending.`
    );
  }
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  callWahaApi is now imported from ./http-client.ts — DO NOT CHANGE  ║
// ║                                                                     ║
// ║  The function was extracted to http-client.ts in Phase 1, Plan 01   ║
// ║  to add timeout, rate limiting, 429 backoff, and structured logging.║
// ║  All 60+ functions below reference callWahaApi by name unchanged.   ║
// ║                                                                     ║
// ║  DO NOT re-define callWahaApi here. It comes from the import above. ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  getClient / resolveSessionPath — internal helpers DO NOT CHANGE    ║
// ║                                                                     ║
// ║  getClient() returns a cached WahaClient for the given account.    ║
// ║  It does NOT call assertCanSend — mutation callers do that.        ║
// ║                                                                     ║
// ║  resolveSessionPath() is kept as a thin wrapper for the few        ║
// ║  call sites that build paths before having a client reference.     ║
// ║                                                                     ║
// ║  Added: Phase 32, Plan 01 (2026-03-20).                            ║
// ╚══════════════════════════════════════════════════════════════════════╝

function getClient(cfg: CoreConfig, accountId?: string): WahaClient {
  return getWahaClient(cfg, accountId);
}

// resolveSessionPath — legacy helper kept for internal path building.
// Delegates to WahaClient.sessionPath when a client is available; used standalone here.
function resolveSessionPath(template: string, cfg: CoreConfig, accountId?: string): string {
  return getClient(cfg, accountId).sessionPath(template);
}

// resolveAccountParams — kept as a deprecated compatibility shim.
// Previously used everywhere; now only a few complex send functions that still need
// the session string directly (sendWahaEvent, getWahaContacts) call this.
// DO NOT REMOVE until all callers are migrated.
function resolveAccountParams(cfg: CoreConfig, accountId?: string) {
  const account = resolveWahaAccount({ cfg, accountId: accountId ?? DEFAULT_ACCOUNT_ID });
  const session = account.session ?? "default";
  assertCanSend(session, cfg);
  return {
    baseUrl: account.baseUrl ?? "",
    apiKey: typeof account.apiKey === "string" ? account.apiKey : "",
    session,
  };
}

const EXTENSION_MIME_MAP: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg; codecs=opus",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".opus": "audio/ogg; codecs=opus",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".wma": "audio/x-ms-wma",
};

/**
 * Resolve MIME type from detectMime() with file-extension fallback for local paths.
 */
function resolveMime(url: string): string {
  const mimeRaw = detectMime(url);
  if (typeof mimeRaw === "string" && mimeRaw) return mimeRaw;
  // Strip query params and fragments before extension detection
  let cleanPath = url;
  try {
    const parsed = new URL(url, "file://localhost/");
    cleanPath = parsed.pathname;
  } catch { /* use raw url */ }
  const ext = extname(cleanPath).toLowerCase();
  return EXTENSION_MIME_MAP[ext] ?? "";
}

/**
 * Build the WAHA "file" payload.
 * - Local paths (start with "/") are read and base64-encoded using file.data
 * - HTTP/HTTPS URLs are passed as file.url (WAHA fetches them)
 */
export function buildFilePayload(url: string): Record<string, string> {
  if (url.startsWith("/") || url.startsWith("file://")) {
    const filePath = url.startsWith("file://") ? url.slice(7) : url;
    const data = readFileSync(filePath).toString("base64");
    const ext = extname(filePath).toLowerCase();
    const mimetype = EXTENSION_MIME_MAP[ext] ?? "application/octet-stream";
    const filename = filePath.split("/").pop() ?? "file";
    return { data, mimetype, filename };
  }
  // For HTTP URLs, include mimetype + filename so WAHA sends as proper media
  // (without mimetype, WAHA may send as generic file attachment)
  let cleanPath = url;
  try {
    const parsed = new URL(url, "file://localhost/");
    cleanPath = parsed.pathname;
  } catch { /* use raw url */ }
  const mime = resolveMime(url);
  if (mime) {
    const filename = basename(cleanPath) || "file";
    return { url, mimetype: mime, filename };
  }
  return { url };
}

/**
 * Send typing indicator (start or stop) to a WAHA chat.
 */
export async function sendWahaPresence(params: {
  cfg: CoreConfig;
  chatId: string;
  typing: boolean;
  accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  // Let callers handle errors — they already use .catch(warnOnError(...))
  return client.post(params.typing ? "/api/startTyping" : "/api/stopTyping", {
    chatId: params.chatId,
    session: client.session,
  });
}

/**
 * Send "seen" (read receipt / blue ticks) for a chat.
 */
export async function sendWahaSeen(params: {
  cfg: CoreConfig;
  chatId: string;
  accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post("/api/sendSeen", {
    chatId: params.chatId,
    session: client.session,
  }).catch(warnOnError(`presence /api/sendSeen ${params.chatId}`));
}

export async function sendWahaText(params: {
  cfg: CoreConfig;
  to: string;
  text: string;
  replyToId?: string;
  accountId?: string;
  botProxy?: boolean;
  bypassPolicy?: boolean; // Skip rules-based policy check (used by system commands like /shutup)
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const chatId = normalizeWahaMessagingTarget(params.to);
  if (!chatId) throw new Error("WAHA sendText requires chatId");
  // Phase 6: Rules-based outbound policy enforcement. DO NOT CHANGE.
  // Fail-open: if rules not configured or resolution fails, send proceeds normally.
  // Only blocks on explicit policy denial (can_initiate=false or silent_observer group).
  // bypassPolicy skips this check for system commands (e.g., /shutup confirmations).
  if (!params.bypassPolicy) {
    assertPolicyCanSend(chatId, params.cfg);
  }

  // Check if target group is muted — block outbound sends to muted groups.
  // DO NOT CHANGE — muted groups must not receive any bot messages except /unshutup confirmations.
  // Added Phase 7 (2026-03-15).
  if (chatId.endsWith("@g.us") && !params.bypassPolicy) {
    try {
      const dirDb = getDirectoryDb(client.accountId);
      if (dirDb.isGroupMuted(chatId)) {
        throw new Error(`Outbound blocked: group ${chatId} is muted. Use /unshutup to unmute.`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Outbound blocked:")) throw err;
      console.warn(`[waha] mute check DB error for ${chatId}, proceeding with send: ${String(err)}`);
    }
  }

  // Bot prefix for human session replies — when the bot borrows a human session to send,
  // prepend a robot emoji so recipients know it's the bot, not the human.
  // Only applies when botProxy is explicitly true (set by inbound handler and channel action).
  // DO NOT CHANGE — prevents confusion about message source in group chats.
  let textToSend = params.text;
  if (params.botProxy && textToSend.trim()) {
    textToSend = `${BOT_PROXY_PREFIX} ${textToSend}`;
  }

  // Auto link preview: add linkPreview: true when text contains a URL and config allows.
  // Default is true (autoLinkPreview not set or true). Only skip when explicitly false.
  // Added Phase 3, Plan 01 (2026-03-11). DO NOT CHANGE — recipients see rich preview cards.
  const autoLP = params.cfg.channels?.waha?.autoLinkPreview;
  const addLinkPreview = autoLP !== false && URL_REGEX.test(textToSend);

  return client.post("/api/sendText", {
    chatId,
    text: textToSend,
    session: client.session,
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    ...(addLinkPreview ? { linkPreview: true } : {}),
  });
}

/**
 * Attempt to detect MIME type via HTTP HEAD request.
 * Returns empty string if detection fails or URL is not HTTP.
 * DO NOT CHANGE — verified 2026-03-10 (media type routing fix)
 */
async function detectMimeViaHead(url: string): Promise<string> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEAD_DETECT_TIMEOUT_MS);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    clearTimeout(timeout);
    const ct = res.headers.get("content-type") || "";
    // Extract just the MIME type (before any ;charset= or parameters)
    return ct.split(";")[0].trim().toLowerCase();
  } catch (err) {
    console.warn(`[waha] MIME HEAD detection failed for ${url}: ${String(err)}`);
    return "";
  }
}

async function sendWahaMedia(params: {
  cfg: CoreConfig;
  to: string;
  mediaUrl: string;
  text?: string;
  replyToId?: string;
  accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const chatId = normalizeWahaMessagingTarget(params.to);
  if (!chatId) throw new Error("WAHA sendMedia requires chatId");

  // ── MIME detection: extension-based, then HTTP HEAD fallback ──────
  // DO NOT CHANGE this detection logic — verified 2026-03-10 (media routing fix)
  let mime = resolveMime(params.mediaUrl);

  // If extension-based detection failed, try HTTP HEAD request
  if (!mime && (params.mediaUrl.startsWith("http://") || params.mediaUrl.startsWith("https://"))) {
    mime = await detectMimeViaHead(params.mediaUrl);
  }

  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");
  const isDocument = mime.startsWith("application/") || mime.startsWith("text/");

  const filePayload = buildFilePayload(params.mediaUrl);

  const base = {
    chatId,
    file: filePayload,
    session: client.session,
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
  };

  if (isImage) {
    return client.post("/api/sendImage", {
      ...base,
      ...(params.text ? { caption: params.text } : {}),
    });
  }

  if (isVideo) {
    return client.post("/api/sendVideo", {
      ...base,
      convert: true,
      ...(params.text ? { caption: params.text } : {}),
    });
  }

  if (isAudio) {
    // Send text first (voice notes don't support captions in WhatsApp)
    if (params.text) {
      await client.post("/api/sendText", {
        chatId,
        text: params.text,
        session: client.session,
      });
    }
    // Then send voice bubble
    return client.post("/api/sendVoice", {
      ...base,
      convert: true,
    });
  }

  // ── DEFAULT ROUTING — DO NOT CHANGE ────────────────────────────
  // When MIME is unknown (empty), default to sendImage (not sendFile).
  // Most outbound media in chat contexts are images (e.g. URLs without
  // file extensions like https://placecats.com/400/300).
  // Only use sendFile for known document MIME types (application/*, text/*).
  // Verified 2026-03-10 (media routing fix).
  // ───────────────────────────────────────────────────────────────
  if (isDocument) {
    return client.post("/api/sendFile", {
      ...base,
      ...(params.text ? { caption: params.text } : {}),
    });
  }

  // Unknown or undetectable MIME → default to sendImage
  return client.post("/api/sendImage", {
    ...base,
    ...(params.text ? { caption: params.text } : {}),
  });
}

export async function sendWahaMediaBatch(params: {
  cfg: CoreConfig;
  to: string;
  mediaUrls: string[];
  caption?: string;
  replyToId?: string;
  accountId?: string;
}) {
  const { mediaUrls, caption } = params;
  if (mediaUrls.length === 0) return;

  await sendMediaWithLeadingCaption({
    mediaUrls,
    caption: caption ?? "",
    send: async ({ mediaUrl, caption }) => {
      await sendWahaMedia({
        cfg: params.cfg,
        to: params.to,
        mediaUrl,
        text: caption,
        replyToId: params.replyToId,
        accountId: params.accountId,
      });
    },
    onError: (err, mediaUrl) => {
      console.warn(`[waha] failed to send media ${mediaUrl}: ${String(err)}`);
    },
  });
}


// ── DIRECT MEDIA SENDERS (DO NOT CHANGE) ─────────────────────────
// These call WAHA API directly without MIME detection.
// sendImage → /api/sendImage, sendVideo → /api/sendVideo, sendFile → /api/sendFile
// When the agent explicitly picks sendImage, it MUST go to /api/sendImage.
// DO NOT route through sendWahaMediaBatch which does MIME sniffing.
// Verified working 2026-03-10.
// ─────────────────────────────────────────────────────────────────

export async function sendWahaImage(params: {
  cfg: CoreConfig;
  chatId: string;
  file: string;
  caption?: string;
  replyToId?: string;
  accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const chatId = normalizeWahaMessagingTarget(params.chatId);
  if (!chatId) throw new Error("sendImage requires chatId");
  // Phase 6: Rules-based outbound policy enforcement. DO NOT CHANGE.
  assertPolicyCanSend(chatId, params.cfg);
  const filePayload = buildFilePayload(params.file);
  return client.post("/api/sendImage", {
    chatId,
    file: filePayload,
    session: client.session,
    ...(params.caption ? { caption: params.caption } : {}),
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
  });
}

export async function sendWahaVideo(params: {
  cfg: CoreConfig;
  chatId: string;
  file: string;
  caption?: string;
  replyToId?: string;
  accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const chatId = normalizeWahaMessagingTarget(params.chatId);
  if (!chatId) throw new Error("sendVideo requires chatId");
  // Phase 6: Rules-based outbound policy enforcement. DO NOT CHANGE.
  assertPolicyCanSend(chatId, params.cfg);
  const filePayload = buildFilePayload(params.file);
  return client.post("/api/sendVideo", {
    chatId,
    file: filePayload,
    session: client.session,
    convert: true,
    ...(params.caption ? { caption: params.caption } : {}),
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
  });
}

export async function sendWahaFile(params: {
  cfg: CoreConfig;
  chatId: string;
  file: string;
  caption?: string;
  replyToId?: string;
  accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const chatId = normalizeWahaMessagingTarget(params.chatId);
  if (!chatId) throw new Error("sendFile requires chatId");
  // Phase 6: Rules-based outbound policy enforcement. DO NOT CHANGE.
  assertPolicyCanSend(chatId, params.cfg);
  const filePayload = buildFilePayload(params.file);
  return client.post("/api/sendFile", {
    chatId,
    file: filePayload,
    session: client.session,
    ...(params.caption ? { caption: params.caption } : {}),
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
  });
}

// ── VERIFIED WORKING 2026-03-10 ──────────────────────────────────
// Reaction needs full messageId: "true_<chatId>_<shortId>"
// Uses PUT /api/reaction (not POST).
export async function sendWahaReaction(params: {
  cfg: CoreConfig;
  messageId: string;
  emoji: string;
  accountId?: string;
  remove?: boolean;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);

  const reaction = params.remove ? "" : params.emoji;
  if (!params.messageId) {
    throw new Error("WAHA reaction requires messageId");
  }

  return client.put("/api/reaction", {
    messageId: params.messageId,
    reaction,
    session: client.session,
  });
}

// ── Rich Messages ──────────────────────────────────────────────

// ── VERIFIED WORKING 2026-03-10 (native WhatsApp poll, 19s) ─────
// WAHA requires poll:{name, options, multipleAnswers} wrapper object.
// Do NOT flatten poll fields into the top-level body.
export async function sendWahaPoll(params: {
  cfg: CoreConfig; chatId: string; name: string; options: string[];
  multipleAnswers?: boolean; replyToId?: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post("/api/sendPoll", {
    chatId: params.chatId, session: client.session,
    poll: { name: params.name, options: params.options, multipleAnswers: params.multipleAnswers ?? false },
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
  });
}

export async function sendWahaPollVote(params: {
  cfg: CoreConfig; chatId: string; pollMessageId: string; votes: string[]; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post("/api/sendPollVote", {
    chatId: params.chatId, session: client.session,
    pollMessageId: params.pollMessageId, votes: params.votes,
  });
}

// ── VERIFIED WORKING 2026-03-10 ──────────────────────────────────
export async function sendWahaLocation(params: {
  cfg: CoreConfig; chatId: string; latitude: number; longitude: number; title: string;
  replyToId?: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post("/api/sendLocation", {
    chatId: params.chatId, session: client.session,
    latitude: params.latitude, longitude: params.longitude, title: params.title,
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
  });
}

export async function sendWahaContactVcard(params: {
  cfg: CoreConfig; chatId: string;
  contacts: Array<{ fullName: string; phoneNumber: string; organization?: string }>;
  replyToId?: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post("/api/sendContactVcard", {
    chatId: params.chatId, session: client.session,
    contacts: params.contacts.map(c => ({
      fullName: c.fullName, phoneNumber: c.phoneNumber,
      ...(c.organization ? { organization: c.organization } : {}),
    })),
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
  });
}

export async function sendWahaList(params: {
  cfg: CoreConfig; chatId: string; title: string; description: string; buttonText: string;
  sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  replyToId?: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post("/api/sendList", {
    chatId: params.chatId, session: client.session,
    title: params.title, description: params.description, buttonText: params.buttonText,
    sections: params.sections,
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
  });
}

export async function forwardWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post("/api/forwardMessage", {
    chatId: params.chatId, session: client.session, messageId: params.messageId,
  });
}

export async function sendWahaLinkPreview(params: {
  cfg: CoreConfig; chatId: string; url: string; title: string;
  description?: string; image?: string; replyToId?: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post("/api/send/link-custom-preview", {
    chatId: params.chatId, session: client.session,
    url: params.url, title: params.title,
    ...(params.description ? { description: params.description } : {}),
    ...(params.image ? { image: params.image } : {}),
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
  });
}

export async function sendWahaButtonsReply(params: {
  cfg: CoreConfig; chatId: string; messageId: string; buttonId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post("/api/send/buttons/reply", {
    chatId: params.chatId, session: client.session,
    messageId: params.messageId, buttonId: params.buttonId,
  });
}

// ── Message Management ─────────────────────────────────────────

// ── VERIFIED WORKING 2026-03-10 ──────────────────────────────────
// Edit endpoint: PUT /api/{session}/chats/{chatId}/messages/{messageId}
// messageId MUST be full format: "true_<chatId>_<shortId>"
// Short IDs (just the hex part) cause 500 error from WAHA.
export async function editWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; text: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put(
    client.sessionPath("/api/{session}/chats")
      + `/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}`,
    { text: params.text },
  );
}

// ── VERIFIED WORKING 2026-03-10 ──────────────────────────────────
// Delete/unsend endpoint: DELETE /api/{session}/chats/{chatId}/messages/{messageId}
// Same full messageId format required as edit.
// Returns protocolMessage type "REVOKE" on success.
export async function deleteWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.del(
    client.sessionPath("/api/{session}/chats")
      + `/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}`,
  );
}

export async function pinWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/chats")
      + `/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}/pin`,
    {},
  );
}

export async function unpinWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/chats")
      + `/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}/unpin`,
    {},
  );
}

export async function starWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; star: boolean; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put("/api/star", {
    chatId: params.chatId, session: client.session,
    messageId: params.messageId, star: params.star,
  });
}

// ── Chat Management ────────────────────────────────────────────

export async function getWahaChats(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/chats"));
}

export async function getWahaChatsOverview(params: {
  cfg: CoreConfig; page?: number; limit?: number; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/chats/overview"), {
    ...(params.page != null ? { page: String(params.page) } : {}),
    ...(params.limit != null ? { limit: String(params.limit) } : {}),
  });
}

export async function getWahaChatMessages(params: {
  cfg: CoreConfig; chatId: string; limit?: number; offset?: number;
  downloadMedia?: boolean; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/chats") + `/${encodeURIComponent(params.chatId)}/messages`,
    {
      ...(params.limit != null ? { limit: String(params.limit) } : {}),
      ...(params.offset != null ? { offset: String(params.offset) } : {}),
      ...(params.downloadMedia != null ? { downloadMedia: String(params.downloadMedia) } : {}),
    },
  );
}

export async function getWahaChatMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/chats")
      + `/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}`,
  );
}

export async function deleteWahaChat(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.del(
    client.sessionPath("/api/{session}/chats") + `/${encodeURIComponent(params.chatId)}`,
  );
}

export async function clearWahaChatMessages(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.del(
    client.sessionPath("/api/{session}/chats") + `/${encodeURIComponent(params.chatId)}/messages`,
  );
}

export async function archiveWahaChat(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.post(
    client.sessionPath("/api/{session}/chats") + `/${encodeURIComponent(params.chatId)}/archive`,
    {},
  );
}

export async function unarchiveWahaChat(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.post(
    client.sessionPath("/api/{session}/chats") + `/${encodeURIComponent(params.chatId)}/unarchive`,
    {},
  );
}

export async function unreadWahaChat(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.post(
    client.sessionPath("/api/{session}/chats") + `/${encodeURIComponent(params.chatId)}/unread`,
    {},
  );
}

export async function readWahaChatMessages(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.post(
    client.sessionPath("/api/{session}/chats") + `/${encodeURIComponent(params.chatId)}/messages/read`,
    {},
  );
}

export async function getWahaChatPicture(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/chats") + `/${encodeURIComponent(params.chatId)}/picture`,
  );
}

// ── Group Admin ────────────────────────────────────────────────

export async function createWahaGroup(params: {
  cfg: CoreConfig; name: string; participants: string[]; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(client.sessionPath("/api/{session}/groups"), {
    name: params.name, participants: params.participants,
  });
}

export async function getWahaGroups(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/groups"));
}

export async function getWahaGroup(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/groups") + `/${encodeURIComponent(params.groupId)}`,
  );
}

export async function deleteWahaGroup(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.del(
    client.sessionPath("/api/{session}/groups") + `/${encodeURIComponent(params.groupId)}`,
  );
}

export async function leaveWahaGroup(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/groups") + `/${encodeURIComponent(params.groupId)}/leave`,
    {},
  );
}

export async function setWahaGroupSubject(params: {
  cfg: CoreConfig; groupId: string; subject: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/settings/subject`,
    { subject: params.subject },
  );
}

export async function setWahaGroupDescription(params: {
  cfg: CoreConfig; groupId: string; description: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/settings/description`,
    { description: params.description },
  );
}

export async function setWahaGroupPicture(params: {
  cfg: CoreConfig; groupId: string; file: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const filePayload = buildFilePayload(params.file);
  return client.put(
    client.sessionPath("/api/{session}/groups") + `/${encodeURIComponent(params.groupId)}/picture`,
    { file: filePayload },
  );
}

export async function deleteWahaGroupPicture(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.del(
    client.sessionPath("/api/{session}/groups") + `/${encodeURIComponent(params.groupId)}/picture`,
  );
}

export async function getWahaGroupPicture(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/groups") + `/${encodeURIComponent(params.groupId)}/picture`,
  );
}

export async function addWahaGroupParticipants(params: {
  cfg: CoreConfig; groupId: string; participants: string[]; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/participants/add`,
    { participants: params.participants },
  );
}

export async function removeWahaGroupParticipants(params: {
  cfg: CoreConfig; groupId: string; participants: string[]; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/participants/remove`,
    { participants: params.participants },
  );
}

export async function promoteWahaGroupAdmin(params: {
  cfg: CoreConfig; groupId: string; participants: string[]; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/admin/promote`,
    { participants: params.participants },
  );
}

export async function demoteWahaGroupAdmin(params: {
  cfg: CoreConfig; groupId: string; participants: string[]; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/admin/demote`,
    { participants: params.participants },
  );
}

export async function getWahaGroupParticipants(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/participants`,
  );
}

export async function setWahaGroupInfoAdminOnly(params: {
  cfg: CoreConfig; groupId: string; adminOnly: boolean; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/settings/info-admin-only`,
    { adminsOnly: params.adminOnly },
  );
}

export async function getWahaGroupInfoAdminOnly(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/settings/info-admin-only`,
  );
}

export async function setWahaGroupMessagesAdminOnly(params: {
  cfg: CoreConfig; groupId: string; adminOnly: boolean; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/settings/messages-admin-only`,
    { adminsOnly: params.adminOnly },
  );
}

export async function getWahaGroupMessagesAdminOnly(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/settings/messages-admin-only`,
  );
}

export async function getWahaGroupInviteCode(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/invite-code`,
  );
}

export async function revokeWahaGroupInviteCode(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/groups")
      + `/${encodeURIComponent(params.groupId)}/invite-code/revoke`,
    {},
  );
}

export async function joinWahaGroup(params: {
  cfg: CoreConfig; inviteCode: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(client.sessionPath("/api/{session}/groups/join"), {
    inviteCode: params.inviteCode,
  });
}

export async function getWahaGroupsCount(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/groups/count"));
}

export async function getWahaGroupJoinInfo(params: { cfg: CoreConfig; groupId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/groups") + `/${encodeURIComponent(params.groupId)}/join-info`,
  );
}
// Added Phase 28, Plan 01.

export async function refreshWahaGroups(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.post(client.sessionPath("/api/{session}/groups/refresh"), {});
}
// Added Phase 28, Plan 01.

// ── Contacts ───────────────────────────────────────────────────

// WAHA contacts list endpoint is /api/contacts/all (NOT /api/{session}/contacts which 404s). DO NOT CHANGE.
export async function getWahaContacts(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  // /api/contacts/all uses query param session, not path segment. DO NOT CHANGE.
  return client.get(`/api/contacts/all`, { session: client.session });
}

export async function getWahaContact(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/contacts") + `/${encodeURIComponent(params.contactId)}`,
  );
}

export async function checkWahaContactExists(params: { cfg: CoreConfig; phone: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.post(
    client.sessionPath("/api/{session}/contacts/check-exists"),
    { phone: params.phone },
  );
}

export async function getWahaContactAbout(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/contacts") + `/${encodeURIComponent(params.contactId)}/about`,
  );
}

export async function getWahaContactPicture(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/contacts")
      + `/${encodeURIComponent(params.contactId)}/profile-picture`,
  );
}

export async function blockWahaContact(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/contacts/block"),
    { contactId: params.contactId },
  );
}

export async function unblockWahaContact(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/contacts/unblock"),
    { contactId: params.contactId },
  );
}

// ── Labels ─────────────────────────────────────────────────────

export async function getWahaLabels(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/labels"));
}

export async function createWahaLabel(params: { cfg: CoreConfig; name: string; color?: number; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(client.sessionPath("/api/{session}/labels"), {
    name: params.name, ...(params.color != null ? { color: params.color } : {}),
  });
}

export async function updateWahaLabel(params: { cfg: CoreConfig; labelId: string; name?: string; color?: number; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put(
    client.sessionPath("/api/{session}/labels") + `/${encodeURIComponent(params.labelId)}`,
    { ...(params.name ? { name: params.name } : {}), ...(params.color != null ? { color: params.color } : {}) },
  );
}

export async function deleteWahaLabel(params: { cfg: CoreConfig; labelId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.del(
    client.sessionPath("/api/{session}/labels") + `/${encodeURIComponent(params.labelId)}`,
  );
}

export async function getWahaChatLabels(params: { cfg: CoreConfig; chatId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/labels/chats") + `/${encodeURIComponent(params.chatId)}`,
  );
}

export async function setWahaChatLabels(params: { cfg: CoreConfig; chatId: string; labels: Array<{ id: string }>; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put(
    client.sessionPath("/api/{session}/labels/chats") + `/${encodeURIComponent(params.chatId)}`,
    { labels: params.labels },
  );
}

export async function getWahaChatsByLabel(params: { cfg: CoreConfig; labelId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/labels") + `/${encodeURIComponent(params.labelId)}/chats`,
  );
}

// ── Status / Stories ───────────────────────────────────────────

export async function sendWahaTextStatus(params: { cfg: CoreConfig; text: string; backgroundColor?: string; font?: number; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(client.sessionPath("/api/{session}/status/text"), {
    text: params.text,
    ...(params.backgroundColor ? { backgroundColor: params.backgroundColor } : {}),
    ...(params.font != null ? { font: params.font } : {}),
  });
}

export async function sendWahaImageStatus(params: { cfg: CoreConfig; image: string; caption?: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const filePayload = buildFilePayload(params.image);
  return client.post(client.sessionPath("/api/{session}/status/image"), {
    file: filePayload, ...(params.caption ? { caption: params.caption } : {}),
  });
}

export async function sendWahaVoiceStatus(params: { cfg: CoreConfig; voice: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const filePayload = buildFilePayload(params.voice);
  return client.post(client.sessionPath("/api/{session}/status/voice"), { file: filePayload });
}

export async function sendWahaVideoStatus(params: { cfg: CoreConfig; video: string; caption?: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const filePayload = buildFilePayload(params.video);
  return client.post(client.sessionPath("/api/{session}/status/video"), {
    file: filePayload, ...(params.caption ? { caption: params.caption } : {}),
  });
}

export async function deleteWahaStatus(params: { cfg: CoreConfig; id: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(client.sessionPath("/api/{session}/status/delete"), { id: params.id });
}

// ── Channels / Newsletters ─────────────────────────────────────

export async function getWahaChannels(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/channels"));
}

export async function createWahaChannel(params: { cfg: CoreConfig; name: string; description?: string; picture?: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(client.sessionPath("/api/{session}/channels"), {
    name: params.name,
    ...(params.description ? { description: params.description } : {}),
    ...(params.picture ? { picture: params.picture } : {}),
  });
}

export async function getWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/channels") + `/${encodeURIComponent(params.channelId)}`,
  );
}

export async function deleteWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.del(
    client.sessionPath("/api/{session}/channels") + `/${encodeURIComponent(params.channelId)}`,
  );
}

export async function followWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/channels") + `/${encodeURIComponent(params.channelId)}/follow`,
    {},
  );
}

export async function unfollowWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/channels") + `/${encodeURIComponent(params.channelId)}/unfollow`,
    {},
  );
}

export async function muteWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/channels") + `/${encodeURIComponent(params.channelId)}/mute`,
    {},
  );
}

export async function unmuteWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/channels") + `/${encodeURIComponent(params.channelId)}/unmute`,
    {},
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  CHAT MUTE/UNMUTE — DO NOT CHANGE                                  ║
// ║                                                                     ║
// ║  Added Phase 3, Plan 01 (2026-03-11).                              ║
// ║  Separate from muteWahaChannel/unmuteWahaChannel (newsletter).     ║
// ║  These target regular chats via /chats/{chatId}/mute and /unmute.  ║
// ╚══════════════════════════════════════════════════════════════════════╝
export async function muteWahaChat(params: { cfg: CoreConfig; chatId: string; duration?: number; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/chats") + `/${encodeURIComponent(params.chatId)}/mute`,
    params.duration != null ? { duration: params.duration } : {},
  );
}

export async function unmuteWahaChat(params: { cfg: CoreConfig; chatId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/chats") + `/${encodeURIComponent(params.chatId)}/unmute`,
    {},
  );
}

export async function searchWahaChannelsByText(params: { cfg: CoreConfig; query: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.post(client.sessionPath("/api/{session}/channels/search/by-text"), {
    query: params.query,
  });
}

export async function previewWahaChannelMessages(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/channels")
      + `/${encodeURIComponent(params.channelId)}/messages/preview`,
  );
}

// ── Channel Search ──────────────────────────────────────────────

export async function searchWahaChannelsByView(params: { cfg: CoreConfig; viewType: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.post(client.sessionPath("/api/{session}/channels/search/by-view"), {
    view: params.viewType,
  });
}
// Added Phase 28, Plan 01.

export async function getWahaChannelSearchViews(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/channels/search/views"));
}
// Added Phase 28, Plan 01.

export async function getWahaChannelSearchCountries(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/channels/search/countries"));
}
// Added Phase 28, Plan 01.

export async function getWahaChannelSearchCategories(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/channels/search/categories"));
}
// Added Phase 28, Plan 01.

/**
 * Get newsletter info by JID. Tries /channels endpoint first (newsletters are channels in WAHA).
 * Falls back gracefully if the newsletter is not found.
 */
export async function getWahaNewsletter(params: { cfg: CoreConfig; newsletterId: string; accountId?: string }): Promise<Record<string, unknown> | null> {
  try {
    const result = await getWahaChannel({ cfg: params.cfg, channelId: params.newsletterId, accountId: params.accountId });
    return result as Record<string, unknown>;
  } catch (err) {
    console.warn(`[waha] getWahaNewsletter failed: ${String(err)}`);
    return null;
  }
}

// ── Events / Calendar ──────────────────────────────────────────

// ⚠️ NOT SUPPORTED on NOWEB engine (returns 501).
// Only works with WEBJS engine. Keep the function for future compatibility.
export async function sendWahaEvent(params: {
  cfg: CoreConfig; chatId: string; name: string; startTime: number;
  endTime?: number; description?: string; location?: { name: string };
  extraGuestsAllowed?: boolean; replyToId?: string; accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(client.sessionPath("/api/{session}/events"), {
    chatId: params.chatId,
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    event: {
      name: params.name, startTime: params.startTime,
      ...(params.endTime != null ? { endTime: params.endTime } : {}),
      ...(params.description ? { description: params.description } : {}),
      ...(params.location ? { location: params.location } : {}),
      ...(params.extraGuestsAllowed != null ? { extraGuestsAllowed: params.extraGuestsAllowed } : {}),
    },
  });
}

// ── Presence ───────────────────────────────────────────────────

export async function setWahaPresenceStatus(params: { cfg: CoreConfig; status: "online" | "offline"; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(client.sessionPath("/api/{session}/presence"), { status: params.status });
}

export async function getWahaPresence(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/presence") + `/${encodeURIComponent(params.contactId)}`,
  );
}

export async function subscribeWahaPresence(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(
    client.sessionPath("/api/{session}/presence/subscribe"),
    { contactId: params.contactId },
  );
}

export async function getAllWahaPresence(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/presence"));
}
// Added Phase 28, Plan 01.

// ── Profile ────────────────────────────────────────────────────

export async function getWahaProfile(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/profile"));
}

export async function setWahaProfileName(params: { cfg: CoreConfig; name: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put(client.sessionPath("/api/{session}/profile/name"), { name: params.name });
}

export async function setWahaProfileStatus(params: { cfg: CoreConfig; status: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put(client.sessionPath("/api/{session}/profile/status"), { status: params.status });
}

export async function setWahaProfilePicture(params: { cfg: CoreConfig; file: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const filePayload = buildFilePayload(params.file);
  return client.put(client.sessionPath("/api/{session}/profile/picture"), { file: filePayload });
}

export async function deleteWahaProfilePicture(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.del(client.sessionPath("/api/{session}/profile/picture"));
}

// ── LID Resolution ─────────────────────────────────────────────

export async function findWahaPhoneByLid(params: { cfg: CoreConfig; lid: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/lids") + `/${encodeURIComponent(params.lid)}`,
  );
}

export async function findWahaLidByPhone(params: { cfg: CoreConfig; phone: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(
    client.sessionPath("/api/{session}/lids/pn") + `/${encodeURIComponent(params.phone)}`,
  );
}

export async function getWahaAllLids(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get(client.sessionPath("/api/{session}/lids"));
}

// ── Calls ──────────────────────────────────────────────────────

export async function rejectWahaCall(params: { cfg: CoreConfig; callId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.post(client.sessionPath("/api/{session}/calls/reject"), {
    callId: params.callId,
  });
}

// ── API Keys — Added Phase 28, Plan 02 ─────────────────────────────
// WAHA server-level API key management. These are server-scoped (not session-scoped),
// so they use /api/keys directly without resolveSessionPath.
// DO NOT CHANGE — API key endpoints are server-level, not session-scoped.

export async function createWahaApiKey(params: { cfg: CoreConfig; name: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post("/api/keys", { name: params.name });
}

export async function getWahaApiKeys(params: { cfg: CoreConfig; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  return client.get("/api/keys");
}

export async function updateWahaApiKey(params: { cfg: CoreConfig; keyId: string; name?: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.put(`/api/keys/${encodeURIComponent(params.keyId)}`, { name: params.name });
}

export async function deleteWahaApiKey(params: { cfg: CoreConfig; keyId: string; accountId?: string }) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.del(`/api/keys/${encodeURIComponent(params.keyId)}`);
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  resolveWahaTarget — DO NOT CHANGE / DO NOT REMOVE                  ║
// ║                                                                      ║
// ║  Fuzzy name-to-JID resolver for groups, contacts, and channels.     ║
// ║  This is the ONLY way agents can resolve human-readable names       ║
// ║  (e.g., "test group", "zeev nesher") to WhatsApp JIDs.             ║
// ║  Removing this will break all name-based targeting for the agent.   ║
// ║                                                                      ║
// ║  Added: 2026-03-10                                                   ║
// ║  Verified: 2026-03-10                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

interface ResolveTargetMatch {
  jid: string;
  name: string;
  type: "group" | "contact" | "channel";
  confidence: number;
}

interface ResolveTargetResult {
  matches: ResolveTargetMatch[];
  query: string;
  searchedTypes: string[];
}

// Exported for testing -- DO NOT CHANGE signature
export function fuzzyScore(query: string, name: string): number {
  const q = query.toLowerCase().trim();
  const n = name.toLowerCase().trim();
  if (!n) return 0;
  // Empty query = list all (return low confidence so sorted by name effectively)
  if (!q) return 0.1;

  // Exact match
  if (q === n) return 1.0;
  // Name starts with query
  if (n.startsWith(q)) return 0.9;
  // Query starts with name
  if (q.startsWith(n)) return 0.85;
  // All query words found in name
  const qWords = q.split(/\s+/).filter(Boolean);
  const allFound = qWords.every((w) => n.includes(w));
  if (allFound && qWords.length > 0) return 0.8;
  // Contains query as substring
  if (n.includes(q)) return 0.7;
  // Any query word found in name
  const anyFound = qWords.some((w) => n.includes(w));
  if (anyFound) return 0.5;

  return 0;
}

export function toArr(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") return Object.values(val);
  return [];
}

// ── Rate-limiting cache for resolveTarget ──────────────────────
// Prevents hammering WAHA API when the agent calls resolveTarget
// multiple times in quick succession. LRU cache with max 1000 entries, TTL = 30 seconds.
// DO NOT REMOVE — protects WAHA from excessive API load.
// Replaced unbounded Map with LRUCache in Phase 1, Plan 02 (2026-03-11) — REL-10.
const _resolveCache = new LRUCache<string, unknown[]>({
  max: 1000,
  ttl: 30_000, // 30 seconds
});

function getCachedOrFetch(key: string, fetcher: () => Promise<unknown>): Promise<unknown[]> {
  const cached = _resolveCache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  return fetcher().then((raw) => {
    const arr = toArr(raw);
    _resolveCache.set(key, arr);
    return arr;
  });
}

export async function resolveWahaTarget(params: {
  cfg: CoreConfig;
  query: string;
  type: "group" | "contact" | "channel" | "auto";
  accountId?: string;
}): Promise<ResolveTargetResult> {
  const { cfg, query, type, accountId } = params;
  const matches: ResolveTargetMatch[] = [];
  const searchedTypes: string[] = [];

  const fetchGroups = async () => {
    searchedTypes.push("group");
    try {
      const groups = await getCachedOrFetch("groups", () => getWahaGroups({ cfg, accountId }));
      for (const g of groups) {
        const entry = g as Record<string, unknown>;
        const jid = String(entry.id ?? entry.jid ?? "");
        const name = String(entry.subject ?? entry.name ?? "");
        if (!jid || !name) continue;
        const score = fuzzyScore(query, name);
        if (score > 0) matches.push({ jid, name, type: "group", confidence: score });
      }
    } catch (err) {
      console.warn("[resolveWahaTarget] groups fetch failed:", (err as Error).message);
    }
  };

  const fetchContacts = async () => {
    searchedTypes.push("contact");
    try {
      const chats = await getCachedOrFetch("contacts", () => getWahaChatsOverview({ cfg, limit: 500, accountId }));
      for (const c of chats) {
        const entry = c as Record<string, unknown>;
        const jid = String(entry.id ?? entry.jid ?? "");
        // Only include DM contacts (@c.us and @lid), not groups or channels
        if (!jid || (!jid.endsWith("@c.us") && !jid.endsWith("@lid"))) continue;
        const name = String(entry.name ?? entry.pushName ?? "");
        if (!name) continue;
        const score = fuzzyScore(query, name);
        if (score > 0) matches.push({ jid, name, type: "contact", confidence: score });
      }
    } catch (err) {
      console.warn("[resolveWahaTarget] contacts fetch failed:", (err as Error).message);
    }
  };

  const fetchChannels = async () => {
    searchedTypes.push("channel");
    try {
      const channels = await getCachedOrFetch("channels", () => getWahaChannels({ cfg, accountId }));
      for (const ch of channels) {
        const entry = ch as Record<string, unknown>;
        const jid = String(entry.id ?? entry.jid ?? "");
        const name = String(entry.name ?? entry.subject ?? "");
        if (!jid || !name) continue;
        const score = fuzzyScore(query, name);
        if (score > 0) matches.push({ jid, name, type: "channel", confidence: score });
      }
    } catch (err) {
      console.warn("[resolveWahaTarget] channels fetch failed:", (err as Error).message);
    }
  };

  if (type === "group") {
    await fetchGroups();
  } else if (type === "contact") {
    await fetchContacts();
  } else if (type === "channel") {
    await fetchChannels();
  } else {
    // "auto" — fetch sequentially with small delay to avoid burst load on WAHA
    await fetchGroups();
    await new Promise(r => setTimeout(r, RESOLVE_FETCH_DELAY_MS));
    await fetchContacts();
    await new Promise(r => setTimeout(r, RESOLVE_FETCH_DELAY_MS));
    await fetchChannels();
  }

  // Sort by confidence descending, limit to top 20
  matches.sort((a, b) => b.confidence - a.confidence);
  const topMatches = matches.slice(0, 20);

  return { matches: topMatches, query, searchedTypes };
}
