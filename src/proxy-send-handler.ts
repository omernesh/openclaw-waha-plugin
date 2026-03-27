// Phase 55 (CC-01, CC-02): Proxy-send handler for Claude Code whatsapp-messenger skill.
// Routes sends through mimicry enforcement (time gate, cap, typing simulation).
// Calls callWahaApi() directly — NOT sendWahaText() — to avoid double-enforcement.
// DO NOT REMOVE — closing bypass gap where Claude Code sends skip mimicry.

import { enforceMimicry, recordMimicrySuccess } from "./mimicry-enforcer.js";
import { callWahaApi } from "./http-client.js";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { CoreConfig } from "./types.js";

// Phase 55 (CC-01): Maps proxy-send type field to WAHA API path. DO NOT REMOVE.
export const SEND_TYPE_TO_PATH: Record<string, string> = {
  text:  "/api/sendText",
  image: "/api/sendImage",
  video: "/api/sendVideo",
  file:  "/api/sendFile",
};

export interface ProxySendResult {
  status: number;
  body: Record<string, unknown>;
}

export interface ProxySendInput {
  body: Record<string, unknown>;
  cfg: CoreConfig;
}

/**
 * Handle a proxy-send request.
 *
 * Validates required fields, enforces mimicry (gate + cap + jitter + typing),
 * forwards to WAHA API via callWahaApi, records cap usage on success.
 *
 * Returns { status, body } for the caller to write to the HTTP response.
 *
 * DO NOT CHANGE — Phase 55 (CC-01, CC-02). Tests in tests/proxy-send.test.ts.
 */
export async function handleProxySend(input: ProxySendInput): Promise<ProxySendResult> {
  const { body, cfg } = input;

  // 1. Validate required fields
  const chatId = body.chatId as string | undefined;
  const session = body.session as string | undefined;
  if (!chatId || !session) {
    return { status: 400, body: { error: "chatId and session are required" } };
  }

  // 2. Determine send type and message length for typing simulation (CC-02)
  const sendType = (body.type as string | undefined) ?? "text";
  const messageLength = typeof body.text === "string" ? (body.text as string).length : 0;

  // 3. Enforce mimicry — gate + cap + jitter + typing (CC-01, CC-02)
  try {
    await enforceMimicry({
      session,
      chatId,
      accountId: DEFAULT_ACCOUNT_ID,
      cfg,
      messageLength,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 403, body: { error: reason, blocked: true } };
  }

  // 4. Forward to WAHA API — use callWahaApi, NOT sendWahaText (avoids double-enforcement)
  const wahaConfig = (cfg as any)?.channels?.waha ?? cfg;
  const baseUrl = wahaConfig.apiUrl ?? "http://127.0.0.1:3004";
  const apiKey = wahaConfig.apiKey ?? "";
  const wahaPath = SEND_TYPE_TO_PATH[sendType] ?? "/api/sendText";

  let wahaResult: unknown;
  try {
    wahaResult = await callWahaApi({
      baseUrl,
      apiKey,
      path: wahaPath,
      method: "POST",
      body: body as Record<string, unknown>,
      session,
      context: { action: "proxy-send", chatId },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 502, body: { error: `WAHA API error: ${reason}` } };
  }

  // 5. Record cap usage AFTER WAHA success — failed sends don't consume cap
  recordMimicrySuccess(session);

  return { status: 200, body: { ok: true, waha: wahaResult } };
}
