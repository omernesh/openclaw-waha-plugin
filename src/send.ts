import { readFileSync } from "fs";
import { extname } from "path";
import { detectMime, sendMediaWithLeadingCaption, DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
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
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}) {
  const method = params.method ?? "POST";
  const url = new URL(params.path, params.baseUrl);
  if (params.query) {
    for (const [k, v] of Object.entries(params.query)) {
      url.searchParams.set(k, v);
    }
  }
  const hasBody = method !== "GET" && method !== "DELETE" && params.body;
  const response = await fetch(url.toString(), {
    method,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(params.apiKey ? { "x-api-key": params.apiKey } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(params.body) } : {}),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`WAHA ${method} ${params.path} failed: ${response.status} ${errorText}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }
  return await response.text();
}

function resolveSessionPath(template: string, cfg: CoreConfig, accountId?: string): string {
  const account = resolveWahaAccount({ cfg, accountId: accountId ?? DEFAULT_ACCOUNT_ID });
  const session = account.session ?? "default";
  return template.replace("{session}", encodeURIComponent(session));
}

function resolveAccountParams(cfg: CoreConfig, accountId?: string) {
  const account = resolveWahaAccount({ cfg, accountId: accountId ?? DEFAULT_ACCOUNT_ID });
  const session = account.session ?? "default";
  assertAllowedSession(session);
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
export function buildFilePayload(url: string): Record<string, string> {
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

// ── Rich Messages ──────────────────────────────────────────────

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

// ── Events / Calendar ──────────────────────────────────────────

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
    path: resolveSessionPath("/api/{session}/contacts/lids", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.lid)}/phone` });
}

export async function findWahaLidByPhone(params: { cfg: CoreConfig; phone: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/contacts/lids/phone", params.cfg, params.accountId)
      + `/${encodeURIComponent(params.phone)}` });
}

export async function getWahaAllLids(params: { cfg: CoreConfig; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey, method: "GET",
    path: resolveSessionPath("/api/{session}/contacts/lids", params.cfg, params.accountId) });
}

// ── Calls ──────────────────────────────────────────────────────

export async function rejectWahaCall(params: { cfg: CoreConfig; callId: string; accountId?: string }) {
  const { baseUrl, apiKey } = resolveAccountParams(params.cfg, params.accountId);
  return callWahaApi({ baseUrl, apiKey,
    path: resolveSessionPath("/api/{session}/calls/reject", params.cfg, params.accountId),
    body: { callId: params.callId } });
}
