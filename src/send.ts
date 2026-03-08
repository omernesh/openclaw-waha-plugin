import { readFileSync } from "fs";
import { extname } from "path";
import { detectMime, sendMediaWithLeadingCaption } from "openclaw/plugin-sdk";
import { resolveWahaAccount } from "./accounts.js";
import { normalizeWahaMessagingTarget } from "./normalize.js";
import type { CoreConfig } from "./types.js";

export function assertAllowedSession(session: string) {
  const normalized = session.trim();
  // Block "omer" and any prefixed variant like "3cf11776_omer"
  if (normalized === "omer" || normalized.endsWith("_omer")) {
    throw new Error(`WAHA session '${normalized}' is explicitly blocked by guardrail`);
  }
  // Allow "logan" and any prefixed variant like "3cf11776_logan"
  if (normalized !== "logan" && !normalized.endsWith("_logan")) {
    throw new Error(`WAHA session '${normalized}' is not allowed (only 'logan' or '*_logan')`);
  }
}

async function callWahaApi(params: {
  baseUrl: string;
  apiKey: string;
  path: string;
  body: Record<string, unknown>;
}) {
  const url = new URL(params.path, params.baseUrl);
  if (params.apiKey) {
    url.searchParams.set("api_key", params.apiKey);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiKey ? { "x-api-key": params.apiKey } : {}),
    },
    body: JSON.stringify(params.body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`WAHA API ${params.path} failed (${response.status}): ${text}`);
  }

  return response.json().catch(() => ({}));
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
};

/**
 * Resolve MIME type from detectMime() with file-extension fallback for local paths.
 */
function resolveMime(url: string): string {
  const mimeRaw = detectMime(url);
  if (typeof mimeRaw === "string" && mimeRaw) return mimeRaw;
  const ext = extname(url).toLowerCase();
  return EXTENSION_MIME_MAP[ext] ?? "";
}

/**
 * Build the WAHA "file" payload.
 * - Local paths (start with "/") are read and base64-encoded using file.data
 * - HTTP/HTTPS URLs are passed as file.url (WAHA fetches them)
 */
function buildFilePayload(url: string): Record<string, string> {
  if (url.startsWith("/") || url.startsWith("file://")) {
    const filePath = url.startsWith("file://") ? url.slice(7) : url;
    const data = readFileSync(filePath).toString("base64");
    const ext = extname(filePath).toLowerCase();
    const mimetype = EXTENSION_MIME_MAP[ext] ?? "application/octet-stream";
    const filename = filePath.split("/").pop() ?? "file";
    return { data, mimetype, filename };
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
  assertAllowedSession(account.session);
  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: params.typing ? "/api/startTyping" : "/api/stopTyping",
    body: {
      chatId: params.chatId,
      session: account.session,
    },
  }).catch(() => {});
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
  assertAllowedSession(account.session);
  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: "/api/sendSeen",
    body: {
      chatId: params.chatId,
      session: account.session,
    },
  }).catch(() => {});
}

export async function sendWahaText(params: {
  cfg: CoreConfig;
  to: string;
  text: string;
  replyToId?: string;
  accountId?: string;
}) {
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertAllowedSession(account.session);
  const chatId = normalizeWahaMessagingTarget(params.to);
  if (!chatId) throw new Error("WAHA sendText requires chatId");

  return callWahaApi({
    baseUrl: account.baseUrl,
    apiKey: account.apiKey,
    path: "/api/sendText",
    body: {
      chatId,
      text: params.text,
      session: account.session,
      ...(params.replyToId ? { reply_to: params.replyToId } : {}),
    },
  });
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
  assertAllowedSession(account.session);
  const chatId = normalizeWahaMessagingTarget(params.to);
  if (!chatId) throw new Error("WAHA sendMedia requires chatId");

  const mime = resolveMime(params.mediaUrl);
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");

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

export async function sendWahaReaction(params: {
  cfg: CoreConfig;
  messageId: string;
  emoji: string;
  accountId?: string;
  remove?: boolean;
}) {
  const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
  assertAllowedSession(account.session);

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
