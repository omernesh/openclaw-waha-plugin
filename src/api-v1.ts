// Phase 60, Plan 01 (API-01, API-04): Public REST API v1 route handlers.
// Handles all /api/v1/* routing for external callers (CLI, MCP server, third-party integrations).
// DO NOT REMOVE — this is the public API surface for Chatlytics external access.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoreConfig } from "./types.js";
import { setCorsHeaders } from "./api-v1-auth.js";
import { handleProxySend } from "./proxy-send-handler.js";
import { getDirectoryDb } from "./directory.js";
import { listEnabledWahaAccounts } from "./accounts.js";
import { getHealthState } from "./health.js";
import { getMimicryDb, getMaturityPhase, resolveCapLimit, getCapStatus } from "./mimicry-gate.js";
import { getWahaChatMessages } from "./send.js";

export interface ApiV1Opts {
  config: CoreConfig;
}

/** Read a request body with a 1MB limit and 30s timeout. Returns string. */
async function readBodyString(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BYTES = 1024 * 1024; // 1MB
    const timeout = setTimeout(() => reject(new Error("Request body timeout")), 30_000);
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        clearTimeout(timeout);
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  // CORS headers must be set before writeHead
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Handle all /api/v1/* requests.
 *
 * Routes:
 *   POST /api/v1/send       — proxy send via mimicry enforcement
 *   GET  /api/v1/messages   — chat message history
 *   GET  /api/v1/search     — directory search (contacts + groups)
 *   GET  /api/v1/directory  — paginated directory listing
 *   GET  /api/v1/sessions   — session list with health status
 *   GET  /api/v1/mimicry    — mimicry gate status (read-only)
 *
 * Phase 60 (API-01). DO NOT REMOVE.
 */
export async function handleApiV1Request(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ApiV1Opts
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // ── POST /api/v1/send ────────────────────────────────────────────
  if (pathname === "/api/v1/send" && req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      const raw = await readBodyString(req);
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch (_err) {
      writeJson(res, 400, { error: "Invalid request body" });
      return;
    }
    try {
      const result = await handleProxySend({ body, cfg: opts.config });
      writeJson(res, result.status, result.body);
    } catch (err) {
      writeJson(res, 500, { error: `Internal error: ${err instanceof Error ? err.message : String(err)}` });
    }
    return;
  }

  // ── GET /api/v1/messages ─────────────────────────────────────────
  if (pathname === "/api/v1/messages" && req.method === "GET") {
    const chatId = url.searchParams.get("chatId");
    const session = url.searchParams.get("session");
    if (!chatId) {
      writeJson(res, 400, { error: "chatId query parameter is required" });
      return;
    }
    if (!session) {
      writeJson(res, 400, { error: "session query parameter is required" });
      return;
    }
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10) || 20;
    try {
      const messages = await getWahaChatMessages({
        cfg: opts.config,
        accountId: session,
        chatId,
        limit,
        downloadMedia: false,
      });
      writeJson(res, 200, messages);
    } catch (err) {
      writeJson(res, 502, { error: `WAHA error: ${err instanceof Error ? err.message : String(err)}` });
    }
    return;
  }

  // ── GET /api/v1/search ───────────────────────────────────────────
  if (pathname === "/api/v1/search" && req.method === "GET") {
    const q = url.searchParams.get("q");
    if (!q) {
      writeJson(res, 400, { error: "q query parameter is required" });
      return;
    }
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 100);
    const accounts = listEnabledWahaAccounts(opts.config);
    const firstAccount = accounts[0];
    if (!firstAccount) {
      writeJson(res, 200, { contacts: [], groups: [] });
      return;
    }
    const db = getDirectoryDb(firstAccount.accountId, firstAccount.tenantId);
    // Search contacts — the search param in getContacts uses FTS5
    const contacts = db.getContacts({ search: q, limit });
    const groups = db.getContacts({ search: q, limit, type: "group" });
    writeJson(res, 200, { contacts, groups });
    return;
  }

  // ── GET /api/v1/directory ────────────────────────────────────────
  if (pathname === "/api/v1/directory" && req.method === "GET") {
    const search = url.searchParams.get("search") ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
    const type = (url.searchParams.get("type") ?? undefined) as "contact" | "group" | "newsletter" | undefined;
    const accounts = listEnabledWahaAccounts(opts.config);
    const firstAccount = accounts[0];
    if (!firstAccount) {
      writeJson(res, 200, { contacts: [], total: 0, dms: 0, groups: 0, newsletters: 0 });
      return;
    }
    const db = getDirectoryDb(firstAccount.accountId, firstAccount.tenantId);
    const contacts = db.getContacts({ search, limit, offset, type });
    const total = db.getContactCount(search, type);
    const dms = db.getDmCount();
    const groups = db.getGroupCount();
    const newsletters = db.getNewsletterCount();
    writeJson(res, 200, { contacts, total, dms, groups, newsletters });
    return;
  }

  // ── GET /api/v1/sessions ─────────────────────────────────────────
  if (pathname === "/api/v1/sessions" && req.method === "GET") {
    const accounts = listEnabledWahaAccounts(opts.config);
    const sessions = accounts.map((acc) => {
      const health = getHealthState(acc.session);
      return {
        session: acc.session,
        accountId: acc.accountId,
        name: acc.name ?? acc.session,
        healthy: health?.healthy ?? null,
        consecutiveFailures: health?.consecutiveFailures ?? 0,
        lastCheckedAt: health?.lastCheckedAt ?? null,
      };
    });
    writeJson(res, 200, sessions);
    return;
  }

  // ── GET /api/v1/mimicry ──────────────────────────────────────────
  // Read-only mimicry status — NEVER calls checkAndConsumeCap. DO NOT CHANGE.
  if (pathname === "/api/v1/mimicry" && req.method === "GET") {
    const accounts = listEnabledWahaAccounts(opts.config);
    const wahaConfig = ((opts.config as Record<string, unknown>)?.channels as Record<string, unknown> | undefined)?.waha ?? {};
    const db = getMimicryDb();
    const now = Date.now();
    const sessions = accounts.map((acc) => {
      const session = acc.session;
      const firstSendAt = db.getFirstSendAt(session);
      const maturity = getMaturityPhase(firstSendAt, now);
      const limit = resolveCapLimit(session, maturity, wahaConfig as Record<string, unknown>, null);
      // getCapStatus is read-only — DO NOT replace with checkAndConsumeCap
      const capStatus = getCapStatus(session, limit, db, now);
      return {
        session,
        count: capStatus.count,
        limit: capStatus.limit,
        remaining: capStatus.remaining,
        maturity: capStatus.maturity,
        windowStartMs: capStatus.windowStartMs,
      };
    });
    writeJson(res, 200, sessions);
    return;
  }

  // ── 404 ──────────────────────────────────────────────────────────
  writeJson(res, 404, { error: "Not found" });
}
