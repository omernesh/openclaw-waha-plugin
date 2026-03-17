import { readFileSync } from "fs";
import { extname, basename } from "path";
import { LRUCache } from "lru-cache";
import { detectMime, sendMediaWithLeadingCaption, DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { listEnabledWahaAccounts, resolveWahaAccount } from "./accounts.js";
import { normalizeWahaMessagingTarget } from "./normalize.js";
import { callWahaApi, warnOnError } from "./http-client.js";
import { assertPolicyCanSend } from "./policy-enforcer.js";
import type { CoreConfig } from "./types.js";
import { getDirectoryDb } from "./directory.js";

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

function resolveSessionPath(template: string, cfg: CoreConfig, accountId?: string): string {
  const account = resolveWahaAccount({ cfg, accountId: accountId ?? DEFAULT_ACCOUNT_ID });
  const session = account.session ?? "default";
  return template.replace("{session}", encodeURIComponent(session));
}

// Account resolution: determines which WAHA session + API key to use.
// In production: session=3cf11776_logan, API key from WHATSAPP_API_KEY env var.
// ⚠️ WAHA has TWO API keys (WAHA_API_KEY vs WHATSAPP_API_KEY) — only WHATSAPP_API_KEY works.
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
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertCanSend(account.session, params.cfg);
  // Let callers handle errors — they already use .catch(warnOnError(...))
  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: params.typing ? "/api/startTyping" : "/api/stopTyping",
    body: {
      chatId: params.chatId,
      session: account.session,
    },
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
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertCanSend(account.session, params.cfg);
  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: "/api/sendSeen",
    body: {
      chatId: params.chatId,
      session: account.session,
    },
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
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertCanSend(account.session, params.cfg);
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
      const dirDb = getDirectoryDb(account.accountId);
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

  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: "/api/sendText",
    body: {
      chatId,
      text: textToSend,
      session: account.session,
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
      ...(addLinkPreview ? { linkPreview: true } : {}),
    },
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
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertCanSend(account.session, params.cfg);
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
    session: account.session,
    ...(params.replyToId ? { reply_to: params.replyToId } : {}),
  };

  if (isImage) {
    return callWahaApi({
      baseUrl: account.baseUrl,
      apiKey: account.apiKey,
      path: "/api/sendImage",
      body: {
        ...base,
        ...(params.text ? { caption: params.text } : {}),
      },
    });
  }

  if (isVideo) {
    return callWahaApi({
      baseUrl: account.baseUrl,
      apiKey: account.apiKey,
      path: "/api/sendVideo",
      body: {
        ...base,
        convert: true,
        ...(params.text ? { caption: params.text } : {}),
      },
    });
  }

  if (isAudio) {
    // Send text first (voice notes don't support captions in WhatsApp)
    if (params.text) {
      await callWahaApi({
        baseUrl: account.baseUrl,
        apiKey: account.apiKey,
        path: "/api/sendText",
        body: {
          chatId,
          text: params.text,
          session: account.session,
        },
      });
    }
    // Then send voice bubble
    return callWahaApi({
      baseUrl: account.baseUrl,
      apiKey: account.apiKey,
      path: "/api/sendVoice",
      body: {
        ...base,
        convert: true,
      },
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
    return callWahaApi({
      baseUrl: account.baseUrl,
      apiKey: account.apiKey,
      path: "/api/sendFile",
      body: {
        ...base,
        ...(params.text ? { caption: params.text } : {}),
      },
    });
  }

  // Unknown or undetectable MIME → default to sendImage
  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: "/api/sendImage",
    body: {
      ...base,
      ...(params.text ? { caption: params.text } : {}),
    },
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
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertCanSend(account.session, params.cfg);
  const chatId = normalizeWahaMessagingTarget(params.chatId);
  if (!chatId) throw new Error("sendImage requires chatId");
  // Phase 6: Rules-based outbound policy enforcement. DO NOT CHANGE.
  assertPolicyCanSend(chatId, params.cfg);
  const filePayload = buildFilePayload(params.file);
  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: "/api/sendImage",
    body: {
      chatId,
      file: filePayload,
      session: account.session,
      ...(params.caption ? { caption: params.caption } : {}),
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    },
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
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertCanSend(account.session, params.cfg);
  const chatId = normalizeWahaMessagingTarget(params.chatId);
  if (!chatId) throw new Error("sendVideo requires chatId");
  // Phase 6: Rules-based outbound policy enforcement. DO NOT CHANGE.
  assertPolicyCanSend(chatId, params.cfg);
  const filePayload = buildFilePayload(params.file);
  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: "/api/sendVideo",
    body: {
      chatId,
      file: filePayload,
      session: account.session,
      convert: true,
      ...(params.caption ? { caption: params.caption } : {}),
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    },
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
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertCanSend(account.session, params.cfg);
  const chatId = normalizeWahaMessagingTarget(params.chatId);
  if (!chatId) throw new Error("sendFile requires chatId");
  // Phase 6: Rules-based outbound policy enforcement. DO NOT CHANGE.
  assertPolicyCanSend(chatId, params.cfg);
  const filePayload = buildFilePayload(params.file);
  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: "/api/sendFile",
    body: {
      chatId,
      file: filePayload,
      session: account.session,
      ...(params.caption ? { caption: params.caption } : {}),
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    },
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
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertCanSend(account.session, params.cfg);

  const reaction = params.remove ? "" : params.emoji;
  if (!params.messageId) {
    throw new Error("WAHA reaction requires messageId");
  }

  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: "/api/reaction",
    body: {
      messageId: params.messageId,
      reaction,
      session: account.session,
    },
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
  const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, path: "/api/sendPoll",
    body: {
      chatId: params.chatId, session,
      poll: { name: params.name, options: params.options, multipleAnswers: params.multipleAnswers ?? false },
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    },
  });
}

export async function sendWahaPollVote(params: {
  cfg: CoreConfig; chatId: string; pollMessageId: string; votes: string[]; accountId?: string;
}) {
  const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, path: "/api/sendPollVote",
    body: { chatId: params.chatId, session, pollMessageId: params.pollMessageId, votes: params.votes },
  });
}

// ── VERIFIED WORKING 2026-03-10 ──────────────────────────────────
export async function sendWahaLocation(params: {
  cfg: CoreConfig; chatId: string; latitude: number; longitude: number; title: string;
  replyToId?: string; accountId?: string;
}) {
  const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, path: "/api/sendLocation",
    body: {
      chatId: params.chatId, session,
      latitude: params.latitude, longitude: params.longitude, title: params.title,
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    },
  });
}

export async function sendWahaContactVcard(params: {
  cfg: CoreConfig; chatId: string;
  contacts: Array<{ fullName: string; phoneNumber: string; organization?: string }>;
  replyToId?: string; accountId?: string;
}) {
  const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, path: "/api/sendContactVcard",
    body: {
      chatId: params.chatId, session,
      contacts: params.contacts.map(c => ({
        fullName: c.fullName, phoneNumber: c.phoneNumber,
        ...(c.organization ? { organization: c.organization } : {}),
      })),
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    },
  });
}

export async function sendWahaList(params: {
  cfg: CoreConfig; chatId: string; title: string; description: string; buttonText: string;
  sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  replyToId?: string; accountId?: string;
}) {
  const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, path: "/api/sendList",
    body: {
      chatId: params.chatId, session,
      title: params.title, description: params.description, buttonText: params.buttonText,
      sections: params.sections,
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    },
  });
}

export async function forwardWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; accountId?: string;
}) {
  const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, path: "/api/forwardMessage",
    body: { chatId: params.chatId, session, messageId: params.messageId },
  });
}

export async function sendWahaLinkPreview(params: {
  cfg: CoreConfig; chatId: string; url: string; title: string;
  description?: string; image?: string; replyToId?: string; accountId?: string;
}) {
  const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, path: "/api/send/link-custom-preview",
    body: {
      chatId: params.chatId, session,
      url: params.url, title: params.title,
      ...(params.description ? { description: params.description } : {}),
      ...(params.image ? { image: params.image } : {}),
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    },
  });
}

export async function sendWahaButtonsReply(params: {
  cfg: CoreConfig; chatId: string; messageId: string; buttonId: string; accountId?: string;
}) {
  const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, path: "/api/send/buttons/reply",
    body: { chatId: params.chatId, session, messageId: params.messageId, buttonId: params.buttonId },
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
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}`,
    body: { text: params.text },
  });
}

// ── VERIFIED WORKING 2026-03-10 ──────────────────────────────────
// Delete/unsend endpoint: DELETE /api/{session}/chats/{chatId}/messages/{messageId}
// Same full messageId format required as edit.
// Returns protocolMessage type "REVOKE" on success.
export async function deleteWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "DELETE",
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}`,
  });
}

export async function pinWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}/pin`,
    body: {},
  });
}

export async function unpinWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}/unpin`,
    body: {},
  });
}

export async function starWahaMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; star: boolean; accountId?: string;
}) {
  const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "PUT", path: "/api/star",
    body: { chatId: params.chatId, session, messageId: params.messageId, star: params.star },
  });
}

// ── Chat Management ────────────────────────────────────────────

export async function getWahaChats(params: { cfg: CoreConfig; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId),
  });
}

export async function getWahaChatsOverview(params: {
  cfg: CoreConfig; page?: number; limit?: number; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/chats/overview", params.cfg, params.accountId),
    query: {
      ...(params.page != null ? { page: String(params.page) } : {}),
      ...(params.limit != null ? { limit: String(params.limit) } : {}),
    },
  });
}

export async function getWahaChatMessages(params: {
  cfg: CoreConfig; chatId: string; limit?: number; offset?: number;
  downloadMedia?: boolean; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/messages`,
    query: {
      ...(params.limit != null ? { limit: String(params.limit) } : {}),
      ...(params.offset != null ? { offset: String(params.offset) } : {}),
      ...(params.downloadMedia != null ? { downloadMedia: String(params.downloadMedia) } : {}),
    },
  });
}

export async function getWahaChatMessage(params: {
  cfg: CoreConfig; chatId: string; messageId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}`,
  });
}

export async function deleteWahaChat(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "DELETE",
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}`,
  });
}

export async function clearWahaChatMessages(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "DELETE",
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/messages`,
  });
}

export async function archiveWahaChat(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/archive`,
    body: {},
  });
}

export async function unarchiveWahaChat(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/unarchive`,
    body: {},
  });
}

export async function unreadWahaChat(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/unread`,
    body: {},
  });
}

export async function readWahaChatMessages(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/messages/read`,
    body: {},
  });
}

export async function getWahaChatPicture(params: {
  cfg: CoreConfig; chatId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.chatId)}/picture`,
  });
}

// ── Group Admin ────────────────────────────────────────────────

export async function createWahaGroup(params: {
  cfg: CoreConfig; name: string; participants: string[]; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId),
    body: { name: params.name, participants: params.participants },
  });
}

export async function getWahaGroups(params: { cfg: CoreConfig; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId),
  });
}

export async function getWahaGroup(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}`,
  });
}

export async function deleteWahaGroup(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "DELETE",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}`,
  });
}

export async function leaveWahaGroup(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/leave`,
    body: {},
  });
}

export async function setWahaGroupSubject(params: {
  cfg: CoreConfig; groupId: string; subject: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/settings/subject`,
    body: { subject: params.subject },
  });
}

export async function setWahaGroupDescription(params: {
  cfg: CoreConfig; groupId: string; description: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/settings/description`,
    body: { description: params.description },
  });
}

export async function setWahaGroupPicture(params: {
  cfg: CoreConfig; groupId: string; file: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  const filePayload = buildFilePayload(params.file);
  return callWahaApi({
    baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/picture`,
    body: { file: filePayload },
  });
}

export async function deleteWahaGroupPicture(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "DELETE",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/picture`,
  });
}

export async function getWahaGroupPicture(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/picture`,
  });
}

export async function addWahaGroupParticipants(params: {
  cfg: CoreConfig; groupId: string; participants: string[]; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/participants/add`,
    body: { participants: params.participants },
  });
}

export async function removeWahaGroupParticipants(params: {
  cfg: CoreConfig; groupId: string; participants: string[]; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/participants/remove`,
    body: { participants: params.participants },
  });
}

export async function promoteWahaGroupAdmin(params: {
  cfg: CoreConfig; groupId: string; participants: string[]; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/admin/promote`,
    body: { participants: params.participants },
  });
}

export async function demoteWahaGroupAdmin(params: {
  cfg: CoreConfig; groupId: string; participants: string[]; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/admin/demote`,
    body: { participants: params.participants },
  });
}

export async function getWahaGroupParticipants(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/participants`,
  });
}

export async function setWahaGroupInfoAdminOnly(params: {
  cfg: CoreConfig; groupId: string; adminOnly: boolean; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/settings/info-admin-only`,
    body: { adminsOnly: params.adminOnly },
  });
}

export async function getWahaGroupInfoAdminOnly(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/settings/info-admin-only`,
  });
}

export async function setWahaGroupMessagesAdminOnly(params: {
  cfg: CoreConfig; groupId: string; adminOnly: boolean; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/settings/messages-admin-only`,
    body: { adminsOnly: params.adminOnly },
  });
}

export async function getWahaGroupMessagesAdminOnly(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/settings/messages-admin-only`,
  });
}

export async function getWahaGroupInviteCode(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/invite-code`,
  });
}

export async function revokeWahaGroupInviteCode(params: {
  cfg: CoreConfig; groupId: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/groups", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.groupId)}/invite-code/revoke`,
    body: {},
  });
}

export async function joinWahaGroup(params: {
  cfg: CoreConfig; inviteCode: string; accountId?: string;
}) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/groups/join", params.cfg, params.accountId),
    body: { inviteCode: params.inviteCode },
  });
}

export async function getWahaGroupsCount(params: { cfg: CoreConfig; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({
    baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/groups/count", params.cfg, params.accountId),
  });
}

// ── Contacts ───────────────────────────────────────────────────

export async function getWahaContacts(params: { cfg: CoreConfig; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/contacts", params.cfg, params.accountId) });
}

export async function getWahaContact(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/contacts", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.contactId)}` });
}

export async function checkWahaContactExists(params: { cfg: CoreConfig; phone: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/contacts/check-exists", params.cfg, params.accountId),
    body: { phone: params.phone } });
}

export async function getWahaContactAbout(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/contacts", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.contactId)}/about` });
}

export async function getWahaContactPicture(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/contacts", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.contactId)}/profile-picture` });
}

export async function blockWahaContact(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/contacts/block", params.cfg, params.accountId),
    body: { contactId: params.contactId } });
}

export async function unblockWahaContact(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/contacts/unblock", params.cfg, params.accountId),
    body: { contactId: params.contactId } });
}

// ── Labels ─────────────────────────────────────────────────────

export async function getWahaLabels(params: { cfg: CoreConfig; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/labels", params.cfg, params.accountId) });
}

export async function createWahaLabel(params: { cfg: CoreConfig; name: string; color?: number; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/labels", params.cfg, params.accountId),
    body: { name: params.name, ...(params.color != null ? { color: params.color } : {}) } });
}

export async function updateWahaLabel(params: { cfg: CoreConfig; labelId: string; name?: string; color?: number; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/labels", params.cfg, params.accountId) + `/${encodeURIComponent(params.labelId)}`,
    body: { ...(params.name ? { name: params.name } : {}), ...(params.color != null ? { color: params.color } : {}) } });
}

export async function deleteWahaLabel(params: { cfg: CoreConfig; labelId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "DELETE",
    path: resolveSessionPath("/api/{session}/labels", params.cfg, params.accountId) + `/${encodeURIComponent(params.labelId)}` });
}

export async function getWahaChatLabels(params: { cfg: CoreConfig; chatId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/labels/chats", params.cfg, params.accountId) + `/${encodeURIComponent(params.chatId)}` });
}

export async function setWahaChatLabels(params: { cfg: CoreConfig; chatId: string; labels: Array<{ id: string }>; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/labels/chats", params.cfg, params.accountId) + `/${encodeURIComponent(params.chatId)}`,
    body: { labels: params.labels } });
}

export async function getWahaChatsByLabel(params: { cfg: CoreConfig; labelId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/labels", params.cfg, params.accountId) + `/${encodeURIComponent(params.labelId)}/chats` });
}

// ── Status / Stories ───────────────────────────────────────────

export async function sendWahaTextStatus(params: { cfg: CoreConfig; text: string; backgroundColor?: string; font?: number; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/status/text", params.cfg, params.accountId),
    body: { text: params.text, ...(params.backgroundColor ? { backgroundColor: params.backgroundColor } : {}), ...(params.font != null ? { font: params.font } : {}) } });
}

export async function sendWahaImageStatus(params: { cfg: CoreConfig; image: string; caption?: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  const filePayload = buildFilePayload(params.image);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/status/image", params.cfg, params.accountId),
    body: { file: filePayload, ...(params.caption ? { caption: params.caption } : {}) } });
}

export async function sendWahaVoiceStatus(params: { cfg: CoreConfig; voice: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  const filePayload = buildFilePayload(params.voice);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/status/voice", params.cfg, params.accountId),
    body: { file: filePayload } });
}

export async function sendWahaVideoStatus(params: { cfg: CoreConfig; video: string; caption?: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  const filePayload = buildFilePayload(params.video);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/status/video", params.cfg, params.accountId),
    body: { file: filePayload, ...(params.caption ? { caption: params.caption } : {}) } });
}

export async function deleteWahaStatus(params: { cfg: CoreConfig; id: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/status/delete", params.cfg, params.accountId),
    body: { id: params.id } });
}

// ── Channels / Newsletters ─────────────────────────────────────

export async function getWahaChannels(params: { cfg: CoreConfig; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/channels", params.cfg, params.accountId) });
}

export async function createWahaChannel(params: { cfg: CoreConfig; name: string; description?: string; picture?: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/channels", params.cfg, params.accountId),
    body: { name: params.name, ...(params.description ? { description: params.description } : {}), ...(params.picture ? { picture: params.picture } : {}) } });
}

export async function getWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/channels", params.cfg, params.accountId) + `/${encodeURIComponent(params.channelId)}` });
}

export async function deleteWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "DELETE",
    path: resolveSessionPath("/api/{session}/channels", params.cfg, params.accountId) + `/${encodeURIComponent(params.channelId)}` });
}

export async function followWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/channels", params.cfg, params.accountId) + `/${encodeURIComponent(params.channelId)}/follow`, body: {} });
}

export async function unfollowWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/channels", params.cfg, params.accountId) + `/${encodeURIComponent(params.channelId)}/unfollow`, body: {} });
}

export async function muteWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/channels", params.cfg, params.accountId) + `/${encodeURIComponent(params.channelId)}/mute`, body: {} });
}

export async function unmuteWahaChannel(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/channels", params.cfg, params.accountId) + `/${encodeURIComponent(params.channelId)}/unmute`, body: {} });
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  CHAT MUTE/UNMUTE — DO NOT CHANGE                                  ║
// ║                                                                     ║
// ║  Added Phase 3, Plan 01 (2026-03-11).                              ║
// ║  Separate from muteWahaChannel/unmuteWahaChannel (newsletter).     ║
// ║  These target regular chats via /chats/{chatId}/mute and /unmute.  ║
// ╚══════════════════════════════════════════════════════════════════════╝
export async function muteWahaChat(params: { cfg: CoreConfig; chatId: string; duration?: number; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId) + `/${encodeURIComponent(params.chatId)}/mute`,
    body: params.duration != null ? { duration: params.duration } : {} });
}

export async function unmuteWahaChat(params: { cfg: CoreConfig; chatId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/chats", params.cfg, params.accountId) + `/${encodeURIComponent(params.chatId)}/unmute`,
    body: {} });
}

export async function searchWahaChannelsByText(params: { cfg: CoreConfig; query: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/channels/search/by-text", params.cfg, params.accountId),
    body: { query: params.query } });
}

export async function previewWahaChannelMessages(params: { cfg: CoreConfig; channelId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/channels", params.cfg, params.accountId) + `/${encodeURIComponent(params.channelId)}/messages/preview` });
}

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
  const { baseUrl, apiKey, session } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: `/api/${encodeURIComponent(session)}/events`,
    body: {
      chatId: params.chatId,
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
      event: {
        name: params.name, startTime: params.startTime,
        ...(params.endTime != null ? { endTime: params.endTime } : {}),
        ...(params.description ? { description: params.description } : {}),
        ...(params.location ? { location: params.location } : {}),
        ...(params.extraGuestsAllowed != null ? { extraGuestsAllowed: params.extraGuestsAllowed } : {}),
      },
    },
  });
}

// ── Presence ───────────────────────────────────────────────────

export async function setWahaPresenceStatus(params: { cfg: CoreConfig; status: "online" | "offline"; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/presence", params.cfg, params.accountId),
    body: { status: params.status } });
}

export async function getWahaPresence(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/presence", params.cfg, params.accountId) + `/${encodeURIComponent(params.contactId)}` });
}

export async function subscribeWahaPresence(params: { cfg: CoreConfig; contactId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/presence/subscribe", params.cfg, params.accountId),
    body: { contactId: params.contactId } });
}

// ── Profile ────────────────────────────────────────────────────

export async function getWahaProfile(params: { cfg: CoreConfig; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/profile", params.cfg, params.accountId) });
}

export async function setWahaProfileName(params: { cfg: CoreConfig; name: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/profile/name", params.cfg, params.accountId),
    body: { name: params.name } });
}

export async function setWahaProfileStatus(params: { cfg: CoreConfig; status: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/profile/status", params.cfg, params.accountId),
    body: { status: params.status } });
}

export async function setWahaProfilePicture(params: { cfg: CoreConfig; file: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  const filePayload = buildFilePayload(params.file);
  return callWahaApi({ baseUrl, apiKey, method: "PUT",
    path: resolveSessionPath("/api/{session}/profile/picture", params.cfg, params.accountId),
    body: { file: filePayload } });
}

export async function deleteWahaProfilePicture(params: { cfg: CoreConfig; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "DELETE",
    path: resolveSessionPath("/api/{session}/profile/picture", params.cfg, params.accountId) });
}

// ── LID Resolution ─────────────────────────────────────────────

export async function findWahaPhoneByLid(params: { cfg: CoreConfig; lid: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/lids", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.lid)}` });
}

export async function findWahaLidByPhone(params: { cfg: CoreConfig; phone: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/lids/pn", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.phone)}` });
}

export async function getWahaAllLids(params: { cfg: CoreConfig; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/lids", params.cfg, params.accountId) });
}

// ── Calls ──────────────────────────────────────────────────────

export async function rejectWahaCall(params: { cfg: CoreConfig; callId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/calls/reject", params.cfg, params.accountId),
    body: { callId: params.callId } });
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
