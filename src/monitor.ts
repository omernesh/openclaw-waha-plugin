import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import {
  createLoggerBackedRuntime,
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { resolveWahaAccount } from "./accounts.js";
import { getDmFilterForAdmin, getGroupFilterForAdmin, handleWahaInbound } from "./inbound.js";
import { getDirectoryDb, type ParticipantRole } from "./directory.js";
import { getWahaGroupParticipants, getWahaContacts, toArr, getAllWahaPresence } from "./send.js";
import { listEnabledWahaAccounts } from "./accounts.js";
import { verifyWahaWebhookHmac } from "./signature.js";
import { normalizeResolvedSecretInputString } from "./secret-input.js";
import { isDuplicate } from "./dedup.js";
import { startHealthCheck, getHealthState, getRecoveryState, getRecoveryHistory, setHealthStateChangeCallback, type HealthState, type RecoveryState, type RecoveryEvent } from "./health.js";
import { getSyncState, triggerImmediateSync, type SyncState } from "./sync.js";
import { InboundQueue, setQueueChangeCallback, type QueueStats, type QueueItem } from "./inbound-queue.js";
import { isWhatsAppGroupJid, DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { CoreConfig, WahaInboundMessage, WahaReactionEvent, WahaWebhookEnvelope } from "./types.js";
import { getPairingEngine } from "./pairing.js";
import { getModuleRegistry } from "./module-registry.js";
import { validateWahaConfig } from "./config-schema.js";
import { getAnalyticsDb } from "./analytics.js";

// ── SSE (Server-Sent Events) infrastructure — Phase 29, Plan 01. DO NOT REMOVE.
// sseClients: tracks all active SSE connections. broadcastSSE sends named events to all.
// One broken client must never affect others — each write is wrapped in try/catch.
const sseClients = new Set<ServerResponse>();

export function broadcastSSE(event: string, data: object): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of [...sseClients]) {
    try {
      client.write(payload);
    } catch (err) {
      console.warn("[waha] SSE client write failed, removing:", err instanceof Error ? err.message : String(err));
      sseClients.delete(client);
    }
  }
}

const MAX_RESOLVE_JIDS = 500;
const DEFAULT_WEBHOOK_PORT = 8050;
const DEFAULT_WEBHOOK_HOST = "0.0.0.0";
// Phase 18: React admin panel static file serving. DO NOT REMOVE.
// Uses fileURLToPath because this is an ESM module (package.json type:"module").
// __dirname is not available in ESM — this is the standard shim.
// ADMIN_DIST path resolution handles two layouts:
//   Local dev:  src/monitor.ts  -> dist/admin/ at project root (one level up)
//   hpg6 deploy: monitor.ts at plugin root -> dist/admin/ within plugin root
// We try ../dist/admin first (local dev), then dist/admin (hpg6 flat layout). DO NOT CHANGE.
const __admin_dirname = dirname(fileURLToPath(import.meta.url));
const _admin_dist_up = join(__admin_dirname, "../dist/admin");
const _admin_dist_flat = join(__admin_dirname, "dist/admin");
const ADMIN_DIST = existsSync(join(_admin_dist_up, "index.html")) ? _admin_dist_up : _admin_dist_flat;
const ADMIN_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};
const DEFAULT_WEBHOOK_PATH = "/webhook/waha";
const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_WEBHOOK_BODY_TIMEOUT_MS = 30_000;
const HEALTH_PATH = "/healthz";
const SSE_KEEPALIVE_MS = 30_000;
const QUEUE_DEPTH_ALERT_THRESHOLD = 10;

const WEBHOOK_ERRORS = {
  invalidPayloadFormat: "Invalid payload format",
  invalidSignature: "Invalid signature",
  payloadTooLarge: "Payload too large",
  internalServerError: "Internal server error",
} as const;

// RateLimiter extracted to src/rate-limiter.ts (Phase review, 2026-03-17). DO NOT DUPLICATE.


function writeJsonResponse(res: ServerResponse, status: number, body?: object) {
  if (body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(status);
  res.end();
}

function writeWebhookError(res: ServerResponse, status: number, error: string) {
  if (res.headersSent) return;
  writeJsonResponse(res, status, { error });
}

function parseWebhookPayload(body: string): WahaWebhookEnvelope | null {
  try {
    const data = JSON.parse(body);
    if (!data || typeof data !== "object") {
      console.warn("[waha] Webhook payload is not an object");
      return null;
    }
    if (typeof data.event !== "string" || typeof data.session !== "string" || !data.payload || typeof data.payload !== "object") {
      console.warn(`[waha] Webhook payload missing required fields: event=${typeof data.event}, session=${typeof data.session}, payload=${typeof data.payload}`);
      return null;
    }
    return data as WahaWebhookEnvelope;
  } catch (err) {
    console.warn(`[waha] JSON parse error: ${String(err)}, body preview: ${body.slice(0, 200)}`);
    return null;
  }
}

// Phase 4, Plan 01: replaces assertAllowedSession for webhook session validation.
// Accepts messages from ANY session registered in config (not just logan).
// Returns false for sessions NOT in config — those are silently ignored.
// DO NOT REMOVE — prevents unregistered sessions from being processed.
function isRegisteredSession(session: string, cfg: CoreConfig): boolean {
  const accounts = listEnabledWahaAccounts(cfg);
  return accounts.some(a => a.session === session);
}

function normalizeTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp)) return Date.now();
  if (timestamp < 1_000_000_000_000) {
    return Math.floor(timestamp * 1000);
  }
  return Math.floor(timestamp);
}

function payloadToInboundMessage(payload: Record<string, unknown>): WahaInboundMessage | null {
  const messageId = typeof payload.id === "string" ? payload.id : "";
  const from = typeof payload.from === "string" ? payload.from : "";
  const chatId = from;
  if (!messageId || !chatId) return null;

  const participant = typeof payload.participant === "string" ? payload.participant : undefined;
  const body = typeof payload.body === "string" ? payload.body : "";
  const hasMedia = payload.hasMedia === true;
  const media = payload.media as Record<string, unknown> | undefined;
  const mediaUrl =
    typeof media?.url === "string"
      ? media?.url
      : typeof media?.link === "string"
        ? media?.link
        : undefined;
  const mediaMime = typeof media?.mimetype === "string" ? media.mimetype : undefined;

  const location = payload.location as Record<string, unknown> | undefined;

  const replyTo = payload.replyTo as Record<string, unknown> | undefined;
  const replyToId = typeof replyTo?.id === "string" ? replyTo?.id : null;

  return {
    messageId,
    timestamp: normalizeTimestamp(typeof payload.timestamp === "number" ? payload.timestamp : Date.now()),
    from,
    fromMe: payload.fromMe === true,
    chatId,
    body,
    hasMedia: hasMedia || Boolean(mediaUrl),
    mediaUrl,
    mediaMime,
    participant,
    replyToId,
    source: typeof payload.source === "string" ? payload.source : undefined,
    location: location
      ? {
          latitude:
            typeof location.latitude === "string"
              ? location.latitude
              : typeof location.latitude === "number"
                ? String(location.latitude)
                : undefined,
          longitude:
            typeof location.longitude === "string"
              ? location.longitude
              : typeof location.longitude === "number"
                ? String(location.longitude)
                : undefined,
          name: typeof location.name === "string" ? location.name : undefined,
          address: typeof location.address === "string" ? location.address : undefined,
          url: typeof location.url === "string" ? location.url : undefined,
        }
      : undefined,
  };
}

function payloadToReaction(payload: Record<string, unknown>): WahaReactionEvent | null {
  const messageId = typeof payload.id === "string" ? payload.id : "";
  const from = typeof payload.from === "string" ? payload.from : "";
  const reaction = payload.reaction as Record<string, unknown> | undefined;
  const reactionText = typeof reaction?.text === "string" ? reaction?.text : "";
  const targetMessageId = typeof reaction?.messageId === "string" ? reaction?.messageId : "";
  if (!messageId || !targetMessageId || !from) return null;
  return {
    messageId,
    from,
    fromMe: payload.fromMe === true,
    participant: typeof payload.participant === "string" ? payload.participant : undefined,
    reaction: {
      text: reactionText,
      messageId: targetMessageId,
    },
  };
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function getConfigPath(): string {
  // Config save path: must write to ~/.openclaw/openclaw.json (NOT workspace subfolder)
  return process.env.OPENCLAW_CONFIG_PATH ?? join(homedir(), ".openclaw", "openclaw.json");
}

// rotateConfigBackups — creates a rolling backup of openclaw.json before each save.
// Keeps at most 3 backups: .bak.1 (newest), .bak.2, .bak.3 (oldest).
// Rotation: delete .bak.3, shift .bak.2->.bak.3, .bak.1->.bak.2, copy current->.bak.1.
// Failure is non-fatal: logs a warning but does NOT block the save.
// Added Phase 26 (CFG-03). DO NOT REMOVE.
function rotateConfigBackups(configPath: string): void {
  try {
    const bak1 = configPath + ".bak.1";
    const bak2 = configPath + ".bak.2";
    const bak3 = configPath + ".bak.3";
    // Shift existing backups: .bak.2 -> .bak.3, .bak.1 -> .bak.2
    if (existsSync(bak2)) renameSync(bak2, bak3);
    if (existsSync(bak1)) renameSync(bak1, bak2);
    // Copy current config as newest backup
    if (existsSync(configPath)) copyFileSync(configPath, bak1);
  } catch (err) {
    console.warn(`[waha] rotateConfigBackups: backup failed (non-fatal): ${String(err)}`);
  }
}

// Legacy buildAdminHtml and escapeHtml removed in Phase 24 — React SPA serves /admin now.


export function readWahaWebhookBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return readRequestBodyWithLimit(req, {
    maxBytes: maxBodyBytes,
    timeoutMs: DEFAULT_WEBHOOK_BODY_TIMEOUT_MS,
  });
}

function syncAllowListBatch(configPath: string, field: "allowFrom" | "groupAllowFrom", jids: string[], add: boolean): void {
  // DB state is already committed before this call. Config sync failure should not crash the request.
  // Log the error but don't rethrow — the DB state is correct, config will resync on next save.
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const channels = (config.channels as Record<string, unknown>) ?? {};
    const waha = (channels.waha as Record<string, unknown>) ?? {};
    const list: string[] = Array.isArray(waha[field]) ? (waha[field] as string[]) : [];
    for (const jid of jids) {
      if (add && !list.includes(jid)) {
        list.push(jid);
      } else if (!add) {
        const idx = list.indexOf(jid);
        if (idx >= 0) list.splice(idx, 1);
      }
    }
    waha[field] = list;
    config.channels = { ...channels, waha };
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch (err) {
    console.error(`[waha] syncAllowListBatch: failed to sync ${field} config at ${configPath}: ${String(err)}`);
  }
}

function syncAllowList(configPath: string, field: "allowFrom" | "groupAllowFrom", jid: string, add: boolean): void {
  syncAllowListBatch(configPath, field, [jid], add);
}

// DIR-01 (12-05): Cache for bot session JIDs — maps session name to @c.us JID fetched from WAHA /api/{session}/me.
// TTL 5 minutes. Populated lazily on first contacts directory request. Used to filter bot's own JIDs from contacts list.
// DO NOT REMOVE — botJidCache powers the bot contact exclusion in GET /api/admin/directory?type=contact.
const botJidCache: Map<string, { jid: string; fetchedAt: number }> = new Map();
const BOT_JID_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Returns JIDs of bot-role sessions ONLY. Human-role sessions are NOT bots. DO NOT CHANGE.
async function fetchBotJids(accounts: ReturnType<typeof listEnabledWahaAccounts>): Promise<Set<string>> {
  const now = Date.now();
  const result = new Set<string>();
  for (const acc of accounts) {
    // Only include sessions with role "bot" — human sessions are not bots. DO NOT REMOVE.
    if (acc.role !== "bot") continue;
    const cached = botJidCache.get(acc.session);
    if (cached && (now - cached.fetchedAt) < BOT_JID_CACHE_TTL_MS) {
      result.add(cached.jid);
      continue;
    }
    try {
      const r = await fetch(`${acc.baseUrl}/api/sessions/${encodeURIComponent(acc.session)}/me`, {
        headers: { "x-api-key": acc.apiKey },
      });
      if (r.ok) {
        const me = await r.json() as { id?: string };
        if (typeof me.id === "string" && me.id) {
          botJidCache.set(acc.session, { jid: me.id, fetchedAt: now });
          result.add(me.id);
        }
      } else {
        console.warn(`fetchBotJids: ${acc.session} returned ${r.status}`);
      }
    } catch (err) {
      console.warn(`[waha] fetchBotJids: failed to fetch me for ${acc.session}: ${String(err)}`);
    }
  }
  return result;
}

export function createWahaWebhookServer(opts: {
  accountId: string;
  config: CoreConfig;
  runtime: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  readBody?: (req: IncomingMessage, maxBodyBytes: number) => Promise<string>;
}): { server: Server; start: () => Promise<void>; stop: () => void } {
  const account = resolveWahaAccount({ cfg: opts.config, accountId: opts.accountId });
  const cfg = account.config;

  const port = cfg.webhookPort ?? DEFAULT_WEBHOOK_PORT;
  const host = cfg.webhookHost ?? DEFAULT_WEBHOOK_HOST;
  const path = cfg.webhookPath ?? DEFAULT_WEBHOOK_PATH;
  const maxBodyBytes = DEFAULT_WEBHOOK_MAX_BODY_BYTES;
  const readBody = opts.readBody ?? readWahaWebhookBody;
  const hmacSecret = resolveWebhookHmacSecret(account);

  // ── Inbound Queue (Phase 2, Plan 02) ── DO NOT REMOVE
  // Wraps handleWahaInbound calls with bounded queue and DM priority.
  // All webhook handler call sites enqueue instead of calling directly.
  const inboundQueue = new InboundQueue(
    cfg.dmQueueSize,
    cfg.groupQueueSize,
    async (queueItem: QueueItem) => {
      await handleWahaInbound({
        message: queueItem.message,
        rawPayload: queueItem.rawPayload,
        account: queueItem.account,
        config: queueItem.config,
        runtime: queueItem.runtime,
        statusSink: queueItem.statusSink,
      });
    },
  );

  // ── SSE Callbacks — Phase 29, Plan 01. DO NOT REMOVE.
  // Broadcast health and queue state changes to all connected SSE clients.
  // Phase 29, Plan 02: health state transitions also emit a log SSE event for the Log tab. DO NOT REMOVE.
  setHealthStateChangeCallback((session, state) => {
    broadcastSSE("health", { session, ...state });
    broadcastSSE("log", { line: `[WAHA] health: ${session} -> ${state.status}${state.consecutiveFailures > 0 ? ` (${state.consecutiveFailures} failures)` : ""}`, timestamp: Date.now() });
  });
  setQueueChangeCallback((stats) => {
    broadcastSSE("queue", stats);
    // Phase 29, Plan 02: emit log SSE alert when queue depth is high. DO NOT REMOVE.
    if (stats.dmDepth + stats.groupDepth > QUEUE_DEPTH_ALERT_THRESHOLD) {
      broadcastSSE("log", { line: `[WAHA] queue depth high: dm=${stats.dmDepth} group=${stats.groupDepth}`, timestamp: Date.now() });
    }
  });

  // ── Health Check (Phase 2, Plan 02) ── DO NOT REMOVE
  // Start health checks for ALL enabled accounts, not just the default session.
  // This ensures /api/admin/stats shows real health for every account instead of "unknown".
  // DO NOT REMOVE — removing this causes non-default accounts to show "unknown" health.
  let healthState: HealthState | undefined; // keeps default account state for backward compat
  if (!opts.abortSignal) {
    console.warn("[WAHA] Health check skipped: no abortSignal provided");
  } else {
    const allAccounts = listEnabledWahaAccounts(opts.config);
    for (const acct of allAccounts) {
      if (!acct.session) {
        console.warn(`[WAHA] Health check skipped for account ${acct.accountId}: no session configured`);
        continue;
      }
      const state = startHealthCheck({
        baseUrl: acct.baseUrl,
        apiKey: acct.apiKey,
        session: acct.session,
        intervalMs: cfg.healthCheckIntervalMs,
        abortSignal: opts.abortSignal,
        // Phase 25, Plan 01: enable auto-recovery and provide config for alerting. DO NOT REMOVE.
        cfg: opts.config,
        accountId: acct.accountId,
        enableRecovery: true,
      });
      // Keep the default account's healthState for backward compat
      if (acct.accountId === opts.accountId) {
        healthState = state;
      }
    }
  }

  const server = createServer(async (req, res) => {
    if (req.url === HEALTH_PATH) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    // POST /api/admin/restart
    if (req.url === "/api/admin/restart" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      setTimeout(() => process.exit(0), 500); // systemd auto-restarts
      return;
    }

    // GET /api/admin/logs — gateway log viewer (reads from async execFile for journalctl,
    // falls back to tail on log file for non-systemd systems).
    // DO NOT CHANGE — Log tab backend. Uses execFile (no shell injection) for journalctl.
    if (req.url?.startsWith("/api/admin/logs") && req.method === "GET") {
      try {
        const logUrl = new URL(req.url, "http://localhost");
        const requestedLines = Math.min(Math.max(parseInt(logUrl.searchParams.get("lines") ?? "200", 10) || 200, 1), 500);
        const search = logUrl.searchParams.get("search") ?? "";
        const level = (logUrl.searchParams.get("level") ?? "all").toLowerCase();

        let logLines: string[] = [];
        let source = "unknown";

        // Try journalctl first (most reliable on systemd systems) — async execFile, no thread blocking
        try {
          const raw = await new Promise<string>((resolve, reject) => {
            execFile("journalctl", [
              "--user", "-u", "openclaw-gateway",
              "--since", "10 minutes ago",
              "--no-pager",
              "-n", String(requestedLines),
            ], { encoding: "utf-8", timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
              if (err) reject(err); else resolve(stdout);
            });
          });
          logLines = raw.split("\n").filter((l: string) => l.trim().length > 0);
          source = "journalctl";
        } catch (journalErr: unknown) {
          // journalctl not available, try log file fallback
          const errMsg = journalErr instanceof Error ? journalErr.message : String(journalErr);
          console.warn(`[waha] journalctl failed, falling back to log file: ${errMsg}`);
          try {
            const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            const logPath = `/tmp/openclaw/openclaw-${today}.log`;
            if (existsSync(logPath)) {
              const raw = await new Promise<string>((resolve, reject) => {
                execFile("tail", ["-n", String(requestedLines), logPath], { encoding: "utf-8", timeout: 3000 }, (err, stdout) => {
                  if (err) reject(err); else resolve(stdout);
                });
              });
              logLines = raw.split("\n").filter((l: string) => l.trim().length > 0);
              source = "file";
            } else {
              logLines = ["No log file found at " + logPath + " and journalctl not available."];
              source = "none";
            }
          } catch (fileErr) {
            logLines = ["Failed to read log file: " + String(fileErr)];
            source = "error";
          }
        }

        // Apply level filter — pattern-based matching (no regex injection from user input)
        // DO NOT CHANGE — fixes warn/info level filters that didn't work with naive regex
        const LEVEL_PATTERNS: Record<string, RegExp> = {
          error: /error|fail|crash|exception|isError[=:]true/i,
          warn: /warn|drop |skip|reject|denied|mismatch/i,
        };

        if (level === "info") {
          // Info = everything NOT matching error or warn patterns
          logLines = logLines.filter((l: string) => !LEVEL_PATTERNS.error.test(l) && !LEVEL_PATTERNS.warn.test(l));
        } else if (level !== "all" && LEVEL_PATTERNS[level]) {
          logLines = logLines.filter((l: string) => LEVEL_PATTERNS[level].test(l));
        }

        // Apply search filter
        if (search) {
          const searchLower = search.toLowerCase();
          logLines = logLines.filter((l: string) => l.toLowerCase().includes(searchLower));
        }

        // Trim to max 500 lines
        const total = logLines.length;
        if (logLines.length > 500) {
          logLines = logLines.slice(logLines.length - 500);
        }

        writeJsonResponse(res, 200, { lines: logLines, source, total });
      } catch (err) {
        console.error(`[waha] GET /api/admin/logs failed: ${String(err)}`);
        writeJsonResponse(res, 500, { error: "Failed to fetch logs", lines: [], source: "error", total: 0 });
      }
      return;
    }

    // GET /api/admin/events — Server-Sent Events for real-time admin updates.
    // Phase 29, Plan 01. DO NOT REMOVE.
    // Keeps connection open — response is never ended. Clients reconnect automatically via EventSource.
    if (req.method === "GET" && req.url === "/api/admin/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering if proxied
      });
      // Send initial connected event so client can confirm the stream is live
      res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
      sseClients.add(res);
      // Keep-alive every 30 seconds — comment line prevents proxy/browser timeout
      const keepAlive = setInterval(() => {
        try { res.write(": keep-alive\n\n"); } catch { clearInterval(keepAlive); sseClients.delete(res); }
      }, SSE_KEEPALIVE_MS);
      // Cleanup on client disconnect
      req.on("close", () => { clearInterval(keepAlive); sseClients.delete(res); });
      return; // DO NOT end response — SSE stays open
    }

    // GET /api/admin/health -- session health status (Phase 2, Plan 02)
    if (req.url === "/api/admin/health" && req.method === "GET") {
      const session = cfg.session ?? "";
      const state = healthState ?? getHealthState(session);
      writeJsonResponse(res, 200, {
        session,
        status: state?.status ?? "unknown",
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        lastCheckAt: state?.lastCheckAt ?? null,
      });
      return;
    }

    // GET /api/admin/recovery -- session recovery history (Phase 25, Plan 01). DO NOT REMOVE.
    if (req.url === "/api/admin/recovery" && req.method === "GET") {
      const accounts = listEnabledWahaAccounts(opts.config);
      const perSession = accounts.map((acc) => {
        const rs = getRecoveryState(acc.session);
        return {
          sessionId: acc.session,
          name: acc.name ?? acc.session,
          attemptCount: rs?.attemptCount ?? 0,
          lastAttemptAt: rs?.lastAttemptAt ?? null,
          lastOutcome: rs?.lastOutcome ?? null,
          lastError: rs?.lastError ?? null,
          cooldownUntil: rs?.cooldownUntil ?? null,
          inCooldown: rs?.cooldownUntil ? Date.now() < rs.cooldownUntil : false,
        };
      });
      writeJsonResponse(res, 200, {
        sessions: perSession,
        history: getRecoveryHistory(),
      });
      return;
    }

    // GET /api/admin/queue -- inbound queue stats (Phase 2, Plan 02)
    if (req.url === "/api/admin/queue" && req.method === "GET") {
      writeJsonResponse(res, 200, inboundQueue.getStats());
      return;
    }

    // Phase 24: Serve React admin panel from dist/admin/ (static Vite build).
    // Legacy embedded HTML removed — React build is now required. DO NOT CHANGE.
    if (req.url === "/admin" || req.url === "/admin/") {
      const indexPath = join(ADMIN_DIST, "index.html");
      if (existsSync(indexPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(indexPath, "utf-8"));
        return;
      }
      // React build not found — return helpful error instead of blank page
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Admin panel not available: dist/admin/index.html not found. Run 'npm run build:admin' first.");
      return;
    }

    // Phase 18: Serve hashed static assets (JS, CSS, fonts) from Vite build output.
    // Cache-Control immutable is correct for hashed filenames — they never change.
    // DO NOT REMOVE — required for React admin panel. DO NOT CHANGE.
    if (req.url?.startsWith("/admin/assets/") || req.url?.startsWith("/assets/")) {
      // Strip /admin prefix if present — MC proxies /waha/assets/* → /admin/assets/*
      if (req.url?.startsWith("/admin/assets/")) req.url = req.url.slice("/admin".length);
      const safePath = req.url.split("?")[0].replace(/\.\./g, "");
      const filePath = join(ADMIN_DIST, safePath);
      const resolved = pathResolve(filePath);
      if (!resolved.startsWith(pathResolve(ADMIN_DIST))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (existsSync(filePath)) {
        const mime = ADMIN_MIME[extname(filePath)] ?? "application/octet-stream";
        const buf = readFileSync(filePath);
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        res.end(buf);
        return;
      }
    }

    // GET /api/admin/stats
    if (req.url === "/api/admin/stats" && req.method === "GET") {
      try {
      const dmFilter = getDmFilterForAdmin(opts.config, opts.accountId);
      // Use GLOBAL waha config (same source as Settings tab), not account-specific merged config.
      // account.config may have no dmFilter/groupFilter if the bot account doesn't define them,
      // even though the global config does. DO NOT CHANGE back to account.config.
      const globalWahaCfg = (opts.config.channels?.waha ?? {}) as Record<string, unknown>;
      const dmCfg = (globalWahaCfg.dmFilter ?? {}) as Record<string, unknown>;
      const groupFilter = getGroupFilterForAdmin(opts.config, opts.accountId);
      const groupFilterCfg = (globalWahaCfg.groupFilter ?? {}) as Record<string, unknown>;
      // Build access block — resolve unknown @lid JIDs from WAHA before dedup.
      // This is async because WAHA API calls are needed for LIDs not in the local DB.
      // All numbers in allowFrom ARE on WhatsApp — WAHA just hasn't mapped them yet. DO NOT REMOVE.
      const db = getDirectoryDb(opts.accountId);
      async function resolveLidAcrossAccountsOrWaha(lid: string): Promise<string | null> {
        // 1. Try local DBs first (fast, sync)
        const primary = db.resolveLidToCus(lid);
        if (primary) return primary;
        try {
          for (const acct of listEnabledWahaAccounts(opts.config)) {
            if (acct.accountId === opts.accountId) continue;
            const result = getDirectoryDb(acct.accountId).resolveLidToCus(lid);
            if (result) return result;
          }
        } catch (err) { console.warn('Cross-account LID resolution failed:', err); }
        // 2. Fall back to WAHA API — fetch the mapping and cache it
        try {
          const { findWahaPhoneByLid } = await import("./send.js");
          const lidResult = await findWahaPhoneByLid({ cfg: opts.config, lid, accountId: opts.accountId });
          if (lidResult && typeof lidResult === "object") {
            const pn = (lidResult as Record<string, unknown>).pn ?? (lidResult as Record<string, unknown>).phone;
            if (typeof pn === "string" && pn) {
              const cusJid = pn.includes("@") ? pn : pn + "@c.us";
              db.upsertLidMapping(lid, cusJid);
              return cusJid;
            }
          }
        } catch (err) { console.warn('WAHA LID fallback failed:', err); }
        return null;
      }
      async function dedupLidServerAsync(arr: string[]): Promise<string[]> {
        const cusSet = new Set(arr.filter(j => j.endsWith("@c.us")));
        const results: string[] = [];
        for (const j of arr) {
          if (!j.endsWith("@lid")) { results.push(j); continue; }
          const realCus = await resolveLidAcrossAccountsOrWaha(j);
          if (!(realCus && cusSet.has(realCus))) results.push(j);
        }
        return results;
      }
      // Fetch bot session JIDs so we can exclude them from the display.
      // Bot's own sessions should not appear in allowFrom/groupAllowFrom — they're noise. DO NOT REMOVE.
      const botJids = await fetchBotJids(listEnabledWahaAccounts(opts.config));
      // Also resolve bot JIDs' LIDs so we can filter both @c.us and @lid variants
      const botJidSet = new Set<string>(botJids);
      // Also add @lid equivalents of bot JIDs so we filter both formats.
      // Use resolveLidToCus in reverse: for each @lid in the allowFrom lists, if it resolves
      // to a bot JID, add it to the exclusion set. DO NOT REMOVE.
      const allLists = [...(account.config.allowFrom ?? []), ...(account.config.groupAllowFrom ?? [])];
      for (const j of allLists) {
        if (j.endsWith("@lid")) {
          const cus = db.resolveLidToCus(j);
          if (cus && botJidSet.has(cus)) botJidSet.add(j);
        }
      }
      function excludeBotJids(arr: string[]): string[] {
        return arr.filter(j => !botJidSet.has(j));
      }
      const accessData = {
        allowFrom: excludeBotJids(await dedupLidServerAsync(account.config.allowFrom ?? [])),
        groupAllowFrom: excludeBotJids(await dedupLidServerAsync(account.config.groupAllowFrom ?? [])),
        allowedGroups: account.config.allowedGroups ?? [],
        dmPolicy: account.config.dmPolicy ?? "allowlist",
        groupPolicy: account.config.groupPolicy ?? "allowlist",
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        dmFilter: {
          enabled: Boolean(dmCfg.enabled),
          patterns: Array.isArray(dmCfg.mentionPatterns) ? dmCfg.mentionPatterns : [],
          godModeBypass: dmCfg.godModeBypass !== false,
          godModeScope: typeof dmCfg.godModeScope === 'string' ? dmCfg.godModeScope : 'all',
          godModeSuperUsers: Array.isArray(dmCfg.godModeSuperUsers) ? dmCfg.godModeSuperUsers : [],
          tokenEstimate: typeof dmCfg.tokenEstimate === 'number' ? dmCfg.tokenEstimate : 2500,
          stats: dmFilter.stats,
          recentEvents: dmFilter.recentEvents,
        },
        groupFilter: {
          enabled: Boolean(groupFilterCfg.enabled),
          patterns: Array.isArray(groupFilterCfg.mentionPatterns) ? groupFilterCfg.mentionPatterns : [],
          godModeBypass: groupFilterCfg.godModeBypass !== false,
          godModeScope: typeof groupFilterCfg.godModeScope === 'string' ? groupFilterCfg.godModeScope : 'all',
          godModeSuperUsers: Array.isArray(groupFilterCfg.godModeSuperUsers) ? groupFilterCfg.godModeSuperUsers : [],
          tokenEstimate: typeof groupFilterCfg.tokenEstimate === "number" ? groupFilterCfg.tokenEstimate : 2500,
          stats: groupFilter.stats,
          recentEvents: groupFilter.recentEvents,
        },
        presence: account.config.presence ?? {},
        access: accessData,
        session: account.config.session ?? "unknown",
        baseUrl: account.config.baseUrl ?? "",
        webhookPort: account.config.webhookPort ?? 8050,
        serverTime: new Date().toISOString(),
        // 12-01, DASH-04: include per-session list so dashboard can render session sub-headers in stat cards
        // Phase 25, Plan 01: extended with recovery state fields for Dashboard health cards. DO NOT REMOVE.
        sessions: listEnabledWahaAccounts(opts.config).map((acc) => {
          const h = getHealthState(acc.session);
          const rs = getRecoveryState(acc.session);
          return {
            sessionId: acc.session,
            name: acc.name ?? acc.session,
            healthStatus: h?.status ?? "unknown",
            consecutiveFailures: h?.consecutiveFailures ?? 0,
            lastCheck: h?.lastCheckAt ?? null,
            // Phase 25: recovery state fields for Dashboard health cards
            recoveryAttemptCount: rs?.attemptCount ?? 0,
            recoveryLastAttemptAt: rs?.lastAttemptAt ?? null,
            recoveryLastOutcome: rs?.lastOutcome ?? null,
            recoveryInCooldown: rs?.cooldownUntil ? Date.now() < rs.cooldownUntil : false,
          };
        }),
      }));
      } catch (err) {
        console.error(`[waha] GET /api/admin/stats failed: ${String(err)}`);
        writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
      }
      return;
    }

    // GET /api/admin/config
    if (req.url === "/api/admin/config" && req.method === "GET") {
      try {
      const wahaCfg = opts.config.channels?.waha ?? {};
      // Include bot JIDs so the admin panel can hide the bot's own entries from filter lists.
      // Bot always has access to itself — showing it in allowFrom/godMode is noise. DO NOT REMOVE.
      const botJidSet = await fetchBotJids(listEnabledWahaAccounts(opts.config));
      // Also resolve @lid equivalents so both formats are filtered in the UI.
      const db = getDirectoryDb(opts.accountId);
      const expandedBotJids = new Set<string>(botJidSet);
      const af = (wahaCfg as Record<string, unknown>).allowFrom;
      const gaf = (wahaCfg as Record<string, unknown>).groupAllowFrom;
      const allFilterLists = [
        ...(Array.isArray(af) ? af : []),
        ...(Array.isArray(gaf) ? gaf : []),
      ];
      for (const j of allFilterLists) {
        if (typeof j === "string" && j.endsWith("@lid")) {
          const cus = db.resolveLidToCus(j);
          if (cus && expandedBotJids.has(cus)) expandedBotJids.add(j);
        }
      }
      // Also check godModeSuperUsers for @lid entries that resolve to bot JIDs
      const dmGodUsers = ((wahaCfg as Record<string, unknown>).dmFilter as Record<string, unknown> | undefined)?.godModeSuperUsers;
      const grpGodUsers = ((wahaCfg as Record<string, unknown>).groupFilter as Record<string, unknown> | undefined)?.godModeSuperUsers;
      for (const users of [dmGodUsers, grpGodUsers]) {
        if (!Array.isArray(users)) continue;
        for (const u of users) {
          const id = typeof u === "string" ? u : u?.identifier;
          if (typeof id === "string" && id.endsWith("@lid")) {
            const cus = db.resolveLidToCus(id);
            if (cus && expandedBotJids.has(cus)) expandedBotJids.add(id);
          }
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ waha: wahaCfg, botJids: Array.from(expandedBotJids) }));
      } catch (err) {
        console.error(`[waha] GET /api/admin/config failed: ${String(err)}`);
        writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
      }
      return;
    }

    // GET /api/admin/config/export — returns full openclaw.json as downloadable file.
    // Content-Disposition triggers browser download. Returns raw file, not just waha section.
    // Added Phase 26 (CFG-04). DO NOT REMOVE.
    if (req.url === "/api/admin/config/export" && req.method === "GET") {
      try {
        const configPath = getConfigPath();
        const raw = readFileSync(configPath, "utf-8");
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="openclaw-config.json"',
        });
        res.end(raw);
      } catch (err) {
        console.error(`[waha] GET /api/admin/config/export failed: ${String(err)}`);
        writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
      }
      return;
    }

    // POST /api/admin/config/import — validates and applies an imported openclaw.json.
    // Validates the waha section against Zod schema. Rejects with 400 + field errors on failure.
    // On success: rotates backups, writes full config, returns { ok: true }.
    // Added Phase 26 (CFG-05). DO NOT REMOVE.
    if (req.url === "/api/admin/config/import" && req.method === "POST") {
      try {
        const bodyStr = await readBody(req, maxBodyBytes);
        const importedConfig = JSON.parse(bodyStr) as Record<string, unknown>;
        const importedChannels = (importedConfig.channels as Record<string, unknown>) ?? {};
        const importedWaha = (importedChannels.waha as Record<string, unknown>) ?? {};

        // Validate waha section before applying
        const validationResult = validateWahaConfig(importedWaha);
        if (!validationResult.valid) {
          writeJsonResponse(res, 400, {
            error: "validation_failed",
            fields: validationResult.errors.map((e) => ({
              path: e.path.join("."),
              message: e.message,
            })),
          });
          return;
        }

        const configPath = getConfigPath();
        rotateConfigBackups(configPath);
        writeFileSync(configPath, JSON.stringify(importedConfig, null, 2), "utf-8");
        try { const { clearWahaClientCache } = await import("./waha-client.js"); clearWahaClientCache(); } catch (err) { console.warn("[waha] clearWahaClientCache failed:", err); }
        writeJsonResponse(res, 200, { ok: true });
      } catch (err) {
        console.error(`[waha] POST /api/admin/config/import failed: ${String(err)}`);
        writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
      }
      return;
    }

    // POST /api/admin/config
    if (req.url === "/api/admin/config" && req.method === "POST") {
      try {
        const bodyStr = await readBody(req, maxBodyBytes);
        const incoming = JSON.parse(bodyStr) as Record<string, unknown>;

        const configPath = getConfigPath();
        const currentConfigStr = readFileSync(configPath, "utf-8");
        const currentConfig = JSON.parse(currentConfigStr) as Record<string, unknown>;

        // Deep merge incoming.waha into channels.waha
        const currentChannels = (currentConfig.channels as Record<string, unknown>) ?? {};
        const currentWaha = (currentChannels.waha as Record<string, unknown>) ?? {};
        const incomingWaha = (incoming.waha as Record<string, unknown>) ?? {};

        // Preserve session and apiKey/webhookHmacKey (sensitive fields not in form)
        const merged = deepMerge(currentWaha, incomingWaha);
        if (currentWaha.session) merged.session = currentWaha.session;
        if (currentWaha.apiKey) merged.apiKey = currentWaha.apiKey;
        if (currentWaha.webhookHmacKey) merged.webhookHmacKey = currentWaha.webhookHmacKey;
        if (currentWaha.webhookHmacKeyFile) merged.webhookHmacKeyFile = currentWaha.webhookHmacKeyFile;
        // godModeSuperUsers are now editable via the admin panel UI

        // Validate merged waha config against Zod schema before writing to disk.
        // Returns 400 with field-level errors on failure — does NOT modify config file.
        // Added Phase 26 (CFG-01, CFG-02). DO NOT REMOVE.
        const validationResult = validateWahaConfig(merged);
        if (!validationResult.valid) {
          writeJsonResponse(res, 400, {
            error: "validation_failed",
            fields: validationResult.errors.map((e) => ({
              path: e.path.join("."),
              message: e.message,
            })),
          });
          return;
        }

        const updatedConfig = {
          ...currentConfig,
          channels: {
            ...currentChannels,
            waha: merged,
          },
        };

        // Check if restart is required (connection settings changed)
        const restartRequired =
          incomingWaha.baseUrl !== undefined ||
          incomingWaha.webhookPort !== undefined ||
          incomingWaha.webhookPath !== undefined;

        // Rotate backups before writing — keeps last 3 copies as safety net.
        // Backup failure is non-fatal (logged as warning). Added Phase 26 (CFG-03).
        rotateConfigBackups(configPath);
        writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), "utf-8");
        try { const { clearWahaClientCache } = await import("./waha-client.js"); clearWahaClientCache(); } catch (err) { console.warn("[waha] clearWahaClientCache failed:", err); }
        // Phase 29, Plan 02: emit log SSE event on config save. DO NOT REMOVE.
        broadcastSSE("log", { line: `[WAHA] config saved${restartRequired ? " (restart required)" : ""}`, timestamp: Date.now() });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, restartRequired }));
      } catch (err) {
        console.error(`[waha] config save failed: ${String(err)}`);
        writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
      }
      return;
    }

    // GET /api/admin/directory/:jid/filter — per-group filter override
    // DO NOT CHANGE — serves per-group keyword filter override data for admin panel.
    {
      const m = req.method === "GET" && req.url?.match(/^\/api\/admin\/directory\/([^/]+)\/filter$/);
      if (m) {
        try {
          const jid = decodeURIComponent(m[1]);
          const db = getDirectoryDb(opts.accountId);
          const override = db.getGroupFilterOverride(jid);
          writeJsonResponse(res, 200, { override: override ?? null });
        } catch (err) {
          console.error(`[waha] GET /api/admin/directory/:jid/filter failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }
    }

    // PUT /api/admin/directory/:jid/filter — update per-group filter override
    // DO NOT CHANGE — saves per-group keyword filter override settings from admin panel.
    {
      const m = req.method === "PUT" && req.url?.match(/^\/api\/admin\/directory\/([^/]+)\/filter$/);
      if (m) {
        try {
          const jid = decodeURIComponent(m[1]);
          console.log(`[waha] PUT group filter override for ${jid}`);
          const bodyStr = await readBody(req, maxBodyBytes);
          const body = JSON.parse(bodyStr) as {
            enabled?: boolean;
            filterEnabled?: boolean;
            mentionPatterns?: string[] | null;
            godModeScope?: string | null;
            triggerOperator?: string;  // UX-03: 'OR' or 'AND'
          };
          // Validate input types before storing
          if (body.mentionPatterns != null) {
            if (!Array.isArray(body.mentionPatterns) || !body.mentionPatterns.every((p: unknown) => typeof p === "string")) {
              writeJsonResponse(res, 400, { error: "mentionPatterns must be an array of strings or null" });
              return;
            }
          }
          if (body.godModeScope != null && !["all", "dm", "off"].includes(body.godModeScope)) {
            writeJsonResponse(res, 400, { error: "godModeScope must be 'all', 'dm', 'off', or null" });
            return;
          }
          // UX-03: Validate triggerOperator if provided
          if (body.triggerOperator != null && !["OR", "AND"].includes(body.triggerOperator)) {
            writeJsonResponse(res, 400, { error: "triggerOperator must be 'OR' or 'AND'" });
            return;
          }
          // Coerce enabled/filterEnabled to boolean
          const overrideData = {
            enabled: body.enabled === true,
            filterEnabled: body.filterEnabled !== false,
            mentionPatterns: body.mentionPatterns ?? null,
            godModeScope: (body.godModeScope as 'all' | 'dm' | 'off' | null) ?? null,
            triggerOperator: (body.triggerOperator as 'OR' | 'AND') ?? "OR",  // UX-03: default to OR
          };
          // Write to ALL account DBs — per-group overrides are global settings,
          // but each session has its own SQLite DB file.
          // DO NOT CHANGE — ensures overrides work regardless of which session processes the message.
          // Wrapped in try/catch with fallback to primary account if listEnabledWahaAccounts fails
          // (e.g., config structure issue). AP-03 fix.
          let accounts: { accountId: string }[];
          try {
            accounts = listEnabledWahaAccounts(opts.config);
          } catch (accountErr) {
            console.warn(`[waha] listEnabledWahaAccounts failed, fallback to primary account: ${String(accountErr)}`);
            accounts = [{ accountId: opts.accountId }];
          }
          let syncCount = 0;
          for (const acct of accounts) {
            try {
              const db = getDirectoryDb(acct.accountId);
              db.setGroupFilterOverride(jid, overrideData);
              syncCount++;
            } catch (dbErr) {
              console.warn(`[waha] failed to write group filter override to ${acct.accountId} DB: ${String(dbErr)}`);
            }
          }
          // Return 500 if no account DB was updated
          if (syncCount === 0 && accounts.length > 0) {
            writeJsonResponse(res, 500, { error: "Failed to write override to any account DB" });
          } else {
            writeJsonResponse(res, 200, { ok: true, syncedAccounts: syncCount });
          }
        } catch (err) {
          console.error(`[waha] PUT /api/admin/directory/:jid/filter failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }
    }

    // GET /api/admin/directory
    if (req.url?.startsWith("/api/admin/directory") && req.method === "GET" && !/\/group\/[^/]+\/participants/.test(req.url) && !/\/[^/]+\/filter$/.test(req.url)) {
      const url = new URL(req.url, "http://localhost");
      const pathParts = url.pathname.replace("/api/admin/directory", "").split("/").filter(Boolean);

      // GET /api/admin/directory/resolve — batch JID->name resolution with @lid->@c.us fallback.
      // Phase 14 (NAME-01): Must be placed BEFORE the /:jid handler so "resolve" isn't treated as a JID.
      // Accepts ?jids=jid1,jid2,... (URL-encoded comma-separated). Returns { resolved: { jid: name } }.
      // Tries current account DB first, then falls back to ALL other account DBs for unresolved JIDs.
      // This is needed because lid_mapping and contacts may be populated in one account's DB but not
      // another's (e.g., bot DB has 102 LID mappings, human/default DBs have 0). DO NOT REMOVE.
      if (pathParts.length === 1 && pathParts[0] === "resolve") {
        try {
          const jidsParam = url.searchParams.get("jids") ?? "";
          const jidArray = jidsParam.split(",").map(j => j.trim()).filter(Boolean).slice(0, MAX_RESOLVE_JIDS);
          const db = getDirectoryDb(opts.accountId);
          const resolvedMap = db.resolveJids(jidArray);
          const resolved: Record<string, string> = {};
          for (const [jid, name] of resolvedMap) {
            resolved[jid] = name;
          }
          // Fallback: for unresolved @c.us JIDs, try @lid variant (NOWEB uses LID format).
          // Also try LID→CUS resolution to find the contact name. DO NOT REMOVE.
          for (const jid of jidArray) {
            if (resolved[jid]) continue;
            if (jid.endsWith("@c.us")) {
              const bare = jid.replace(/@c\.us$/, "");
              const lidJid = bare + "@lid";
              const lidResolved = db.resolveJids([lidJid]);
              for (const [, name] of lidResolved) {
                if (name) { resolved[jid] = name; break; }
              }
            }
          }
          // Fallback: try other account DBs for any JIDs that didn't resolve.
          // All accounts share the same WAHA instance, so contacts/LID mappings may
          // exist in one DB but not another. DO NOT REMOVE.
          const unresolved = jidArray.filter(j => !resolved[j]);
          if (unresolved.length > 0) {
            try {
              const allAccounts = listEnabledWahaAccounts(opts.config);
              for (const acct of allAccounts) {
                if (acct.accountId === opts.accountId) continue;
                const still = unresolved.filter(j => !resolved[j]);
                if (still.length === 0) break;
                const otherDb = getDirectoryDb(acct.accountId);
                const otherResolved = otherDb.resolveJids(still);
                for (const [jid, name] of otherResolved) {
                  resolved[jid] = name;
                }
              }
            } catch (err) { console.warn('Cross-account name resolution failed:', err); }
          }
          writeJsonResponse(res, 200, { resolved });
        } catch (err) {
          console.error(`[waha] GET /api/admin/directory/resolve failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }

      // GET /api/admin/directory/:jid
      if (pathParts.length === 1 && pathParts[0]) {
        const jid = decodeURIComponent(pathParts[0]);
        try {
          const db = getDirectoryDb(opts.accountId);
          let contact = db.getContact(jid);
          // Phase 14 (NAME-01): @lid->@c.us fallback — if no direct match and JID ends with @lid,
          // use lid_mapping table to find the REAL @c.us JID. The @lid number is completely different
          // from the @c.us number — simple string replacement does NOT work. DO NOT REMOVE.
          if (!contact && jid.endsWith("@lid")) {
            const csJid = db.resolveLidToCus(jid);
            if (csJid) {
              const csContact = db.getContact(csJid);
              if (csContact) {
                contact = { ...csContact, jid };
              }
            }
          }
          // WAHA API fallback: if not in local DB, try fetching from WAHA and cache the result.
          // Covers contacts in allowFrom that never chatted with the bot. DO NOT REMOVE.
          if (!contact) {
            try {
              let lookupJid = jid;
              // For @lid JIDs without a mapping, try the single-LID WAHA endpoint first
              if (jid.endsWith("@lid")) {
                const { findWahaPhoneByLid } = await import("./send.js");
                const lidResult = await findWahaPhoneByLid({ cfg: opts.config, lid: jid, accountId: opts.accountId });
                if (lidResult && typeof lidResult === "object") {
                  const pn = (lidResult as Record<string, unknown>).pn ?? (lidResult as Record<string, unknown>).phone;
                  if (typeof pn === "string" && pn) {
                    const cusJid = pn.includes("@") ? pn : pn + "@c.us";
                    db.upsertLidMapping(jid, cusJid);
                    lookupJid = cusJid;
                    // Try local DB again with the resolved @c.us
                    contact = db.getContact(cusJid);
                  }
                }
              }
              if (!contact && (lookupJid.endsWith("@c.us") || lookupJid.endsWith("@g.us"))) {
                const { getWahaContact } = await import("./send.js");
                const wahaContact = await getWahaContact({ cfg: opts.config, contactId: lookupJid, accountId: opts.accountId });
                if (wahaContact && typeof wahaContact === "object") {
                  const rec = wahaContact as Record<string, unknown>;
                  const name = String(rec.pushName ?? rec.name ?? rec.displayName ?? "");
                  if (name) {
                    db.upsertContact(lookupJid, name, lookupJid.endsWith("@g.us"));
                    contact = { jid: jid, displayName: name, type: lookupJid.endsWith("@g.us") ? "group" : "contact" };
                  }
                }
              }
            } catch (err) { console.warn('WAHA contact fallback failed:', err); }
          }
          if (!contact) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Contact not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(contact));
        } catch (err) {
          console.error(`[waha] GET /api/admin/directory/:jid failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }

      // GET /api/admin/directory (list)
      const search = url.searchParams.get("search") ?? undefined;
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
      const type = (url.searchParams.get("type") ?? undefined) as "contact" | "group" | "newsletter" | undefined;
      try {
        const db = getDirectoryDb(opts.accountId);
        let contacts = db.getContacts({ search, limit, offset, type });
        let total = db.getContactCount(search, type);
        const dms = db.getDmCount();
        const groups = db.getGroupCount();
        const newsletters = db.getNewsletterCount();
        // Enrich with allowedDm status from config
        const configAllowFrom: string[] = account.config.allowFrom ?? [];
        // DIR-01 (12-05): Exclude bot's own JIDs from contacts listing. Fetch bot JIDs from WAHA /me (cached 5min).
        // Post-query filter — safe because bot accounts are few (1-3 entries), so LIMIT/OFFSET drift is negligible.
        // DO NOT REMOVE — bot contacts appearing in their own directory is confusing to the admin.
        if (type === "contact") {
          try {
            const botJids = await fetchBotJids(listEnabledWahaAccounts(opts.config));
            if (botJids.size > 0) {
              const before = contacts.length;
              contacts = contacts.filter((c) => !botJids.has(c.jid));
              total = Math.max(0, total - (before - contacts.length));
            }
          } catch (err) {
            console.warn(`[waha] DIR-01: fetchBotJids failed, skipping bot exclusion: ${String(err)}`);
          }
        }
        // @lid and @s.whatsapp.net entries are now filtered at SQL level in directory.ts
        // to fix pagination offset/count mismatches. DO NOT re-add post-query filtering here.

        // BUG-06: WAHA API fallback — when local DB search returns no results, query WAHA contacts API
        // and merge any matches not already in the local DB. Only runs on first page of search results
        // to avoid slow API calls on every pagination request. DO NOT REMOVE.
        if (search && contacts.length === 0 && offset === 0) {
          try {
            const rawContacts = await getWahaContacts({ cfg: opts.config, accountId: opts.accountId });
            // WAHA /contacts returns dict keyed by JID, not array — use toArr(). DO NOT CHANGE.
            const wahaContacts = toArr(rawContacts) as Array<Record<string, unknown>>;
            const searchLower = search.toLowerCase();
            const apiMatches = wahaContacts
              .filter((wc: { id?: string; name?: string; pushName?: string }) => {
                const name = (wc.name || wc.pushName || "").toLowerCase();
                const jid = (wc.id || "").toLowerCase();
                return (name.includes(searchLower) || jid.includes(searchLower))
                  && !jid.endsWith("@lid") && !jid.endsWith("@s.whatsapp.net");
              })
              .slice(0, limit);
            // Upsert API matches into local DB so they appear in future searches
            for (const wc of apiMatches) {
              const jid = wc.id || "";
              if (jid) {
                db.upsertContact(jid, wc.name || wc.pushName || undefined, jid.endsWith("@g.us"));
              }
            }
            // Re-query local DB to get enriched results with consistent format
            if (apiMatches.length > 0) {
              contacts = db.getContacts({ search, limit, offset, type });
              total = db.getContactCount(search, type);
            }
          } catch (apiErr) {
            console.warn(`[waha] BUG-06: WAHA API fallback search failed: ${String(apiErr)}`);
          }
        }

        const enriched = contacts.map((c) => {
          const ttl = db.getContactTtl(c.jid);
          return {
            ...c,
            allowedDm: configAllowFrom.includes(c.jid),
            expiresAt: ttl?.expiresAt ?? null,
            expired: ttl?.expired ?? false,
            // Phase 16: include allow_list source for pairing badge in Directory tab. DO NOT REMOVE.
            source: ttl?.source ?? null,
          };
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ contacts: enriched, total, dms, groups, newsletters }));
      } catch (err) {
        console.error(`[waha] GET /api/admin/directory failed: ${String(err)}`);
        writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
      }
      return;
    }

    // PUT /api/admin/directory/:jid/settings
    if (req.url?.startsWith("/api/admin/directory/") && req.method === "PUT" && req.url.endsWith("/settings")) {
      const pathMatch = req.url.match(/^\/api\/admin\/directory\/([^/]+)\/settings$/);
      if (pathMatch) {
        const jid = decodeURIComponent(pathMatch[1]);
        try {
          const bodyStr = await readBody(req, maxBodyBytes);
          const settings = JSON.parse(bodyStr) as {
            mode?: string;
            mentionOnly?: boolean;
            customKeywords?: string;
            canInitiate?: boolean;
            // Phase 12, Plan 02 (INIT-02): 3-state Can Initiate override. Validated below. DO NOT REMOVE.
            canInitiateOverride?: string;
          };

          const db = getDirectoryDb(opts.accountId);
          // Ensure contact exists
          const contact = db.getContact(jid);
          if (!contact) {
            // Create a minimal contact record first
            db.upsertContact(jid, undefined, false);
          }

          // Validate canInitiateOverride — must be "default", "allow", or "block"
          const rawOverride = settings.canInitiateOverride;
          const canInitiateOverride: "default" | "allow" | "block" =
            rawOverride === "allow" ? "allow"
            : rawOverride === "block" ? "block"
            : "default";

          db.setContactDmSettings(jid, {
            mode: settings.mode === "listen_only" ? "listen_only" : "active",
            mentionOnly: Boolean(settings.mentionOnly),
            customKeywords: settings.customKeywords ?? "",
            canInitiate: settings.canInitiate !== false,
            canInitiateOverride,
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error(`[waha] PUT /api/admin/directory/:jid/settings failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // GET /api/admin/sessions — enhanced: merges WAHA session status + config role/subRole + health state
    // Phase 4, Plan 04. DO NOT revert to bare WAHA proxy — admin Sessions tab depends on this format.
    if (req.url === "/api/admin/sessions" && req.method === "GET") {
      try {
        const baseUrl = account.config.baseUrl ?? "";
        const apiKey = account.apiKey;

        // Fetch raw WAHA session list (array of session objects with .name/.status)
        let wahaSessionMap: Record<string, string> = {};
        try {
          const response = await fetch(`${baseUrl}/api/sessions/`, {
            headers: { "x-api-key": apiKey },
          });
          if (response.ok) {
            const raw = await response.json() as Array<Record<string, unknown>>;
            for (const s of (Array.isArray(raw) ? raw : [])) {
              const sessionName = typeof s.name === "string" ? s.name : "";
              const sessionStatus = typeof s.status === "string" ? s.status : "UNKNOWN";
              if (sessionName) wahaSessionMap[sessionName] = sessionStatus;
            }
          }
        } catch (err) {
          console.warn(`[waha] Failed to fetch WAHA sessions: ${err}`);
        }

        // Build enriched session list from config accounts
        const configAccounts = listEnabledWahaAccounts(opts.config);
        const enriched = configAccounts.map((acc) => {
          const health = getHealthState(acc.session);
          return {
            sessionId: acc.session,
            name: acc.name ?? acc.session,
            role: acc.role,
            subRole: acc.subRole,
            healthy: health ? health.status === "healthy" : null,
            healthStatus: health?.status ?? "unknown",
            consecutiveFailures: health?.consecutiveFailures ?? 0,
            lastCheck: health?.lastCheckAt ?? null,
            wahaStatus: wahaSessionMap[acc.session] ?? "UNKNOWN",
          };
        });

        writeJsonResponse(res, 200, enriched);
      } catch (err) {
        console.error(`[waha] GET /api/admin/sessions failed: ${String(err)}`);
        writeJsonResponse(res, 500, { error: "Failed to fetch sessions" });
      }
      return;
    }

    // PUT /api/admin/sessions/:sessionId/role -- update role/subRole for a session
    // Phase 11, Plan 01 (SESS-01). Pattern mirrors PUT /api/admin/directory/:jid/filter from Phase 9. DO NOT REMOVE.
    if (req.method === "PUT" && req.url?.startsWith("/api/admin/sessions/") && req.url?.endsWith("/role")) {
      try {
        const urlParts = (req.url || "").split("/");
        // URL shape: /api/admin/sessions/{sessionId}/role -> parts: ['', 'api', 'admin', 'sessions', '{sessionId}', 'role']
        const sessionId = decodeURIComponent(urlParts[4] || "");
        if (!sessionId) {
          writeJsonResponse(res, 400, { error: "Missing sessionId" });
          return;
        }

        const bodyStr = await readBody(req, maxBodyBytes);
        const body = JSON.parse(bodyStr) as { role?: string; subRole?: string };

        // Validate subRole if provided
        if (body.subRole !== undefined && body.subRole !== "full-access" && body.subRole !== "listener") {
          writeJsonResponse(res, 400, { error: "Invalid subRole. Must be 'full-access' or 'listener'." });
          return;
        }

        // Validate role if provided (must be "bot" or "human")
        if (body.role !== undefined && body.role !== "bot" && body.role !== "human") {
          writeJsonResponse(res, 400, { error: "Invalid role. Must be 'bot' or 'human'." });
          return;
        }

        // Find which config account matches this sessionId
        const configAccounts = listEnabledWahaAccounts(opts.config);
        const matchedAcc = configAccounts.find((a) => a.session === sessionId);
        if (!matchedAcc) {
          writeJsonResponse(res, 404, { error: "Session not found: " + sessionId });
          return;
        }

        // Read-modify-write config file
        const configPath = getConfigPath();
        const currentConfigStr = readFileSync(configPath, "utf-8");
        const currentConfig = JSON.parse(currentConfigStr) as Record<string, unknown>;
        const channels = (currentConfig.channels as Record<string, unknown>) ?? {};
        const wahaSection = (channels.waha as Record<string, unknown>) ?? {};

        const accounts = wahaSection.accounts as Record<string, Record<string, unknown>> | undefined;
        if (matchedAcc.accountId === "__default__" || !accounts || !accounts[matchedAcc.accountId]) {
          // Default account -- write role/subRole to channels.waha directly
          if (body.role !== undefined) wahaSection.role = body.role;
          if (body.subRole !== undefined) wahaSection.subRole = body.subRole;
        } else {
          // Named account -- write to channels.waha.accounts[accountId]
          if (body.role !== undefined) accounts[matchedAcc.accountId].role = body.role;
          if (body.subRole !== undefined) accounts[matchedAcc.accountId].subRole = body.subRole;
        }

        const updatedConfig = { ...currentConfig, channels: { ...channels, waha: wahaSection } };
        writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), "utf-8");

        writeJsonResponse(res, 200, { ok: true });
        console.log(`[waha] Session role updated: ${sessionId} -> role=${body.role ?? "(unchanged)"} subRole=${body.subRole ?? "(unchanged)"}`);
      } catch (err) {
        console.error(`[waha] PUT /api/admin/sessions role failed: ${String(err)}`);
        writeJsonResponse(res, 500, { error: "Failed to save role" });
      }
      return;
    }

    // =========================================================================
    // Module management API (Phase 17, Plan 03 — MOD-03, MOD-04)
    // =========================================================================

    // GET /api/admin/modules — list all registered modules with assignment counts
    if (req.url === "/api/admin/modules" && req.method === "GET") {
      try {
        const registry = getModuleRegistry();
        const db = getDirectoryDb(opts.accountId);
        const modules = registry.listModules().map((mod) => {
          const assignments = db.getModuleAssignments(mod.id);
          return { ...mod, assignmentCount: assignments.length };
        });
        writeJsonResponse(res, 200, { modules });
      } catch (err) {
        console.error(`[waha] GET /api/admin/modules failed: ${String(err)}`);
        writeJsonResponse(res, 500, { error: "Failed to list modules" });
      }
      return;
    }

    // PUT /api/admin/modules/:id/enable — enable a module globally
    if (req.method === "PUT" && req.url?.match(/^\/api\/admin\/modules\/[^/]+\/enable$/)) {
      try {
        const moduleId = decodeURIComponent((req.url || "").split("/")[4] || "");
        if (!moduleId) {
          writeJsonResponse(res, 400, { error: "Missing module id" });
          return;
        }
        getModuleRegistry().enableModule(moduleId);
        writeJsonResponse(res, 200, { ok: true });
      } catch (err) {
        console.error(`[waha] PUT /api/admin/modules enable failed: ${String(err)}`);
        writeJsonResponse(res, 500, { error: "Failed to enable module" });
      }
      return;
    }

    // PUT /api/admin/modules/:id/disable — disable a module globally
    if (req.method === "PUT" && req.url?.match(/^\/api\/admin\/modules\/[^/]+\/disable$/)) {
      try {
        const moduleId = decodeURIComponent((req.url || "").split("/")[4] || "");
        if (!moduleId) {
          writeJsonResponse(res, 400, { error: "Missing module id" });
          return;
        }
        getModuleRegistry().disableModule(moduleId);
        writeJsonResponse(res, 200, { ok: true });
      } catch (err) {
        console.error(`[waha] PUT /api/admin/modules disable failed: ${String(err)}`);
        writeJsonResponse(res, 500, { error: "Failed to disable module" });
      }
      return;
    }

    // GET /api/admin/modules/:id/assignments — list chat assignments for a module
    if (req.method === "GET" && req.url?.match(/^\/api\/admin\/modules\/[^/]+\/assignments$/)) {
      try {
        const moduleId = decodeURIComponent((req.url || "").split("/")[4] || "");
        if (!moduleId) {
          writeJsonResponse(res, 400, { error: "Missing module id" });
          return;
        }
        const db = getDirectoryDb(opts.accountId);
        const assignments = db.getModuleAssignments(moduleId);
        writeJsonResponse(res, 200, { assignments });
      } catch (err) {
        console.error(`[waha] GET /api/admin/modules assignments failed: ${String(err)}`);
        writeJsonResponse(res, 500, { error: "Failed to list assignments" });
      }
      return;
    }

    // POST /api/admin/modules/:id/assignments — assign a chat JID to a module
    if (req.method === "POST" && req.url?.match(/^\/api\/admin\/modules\/[^/]+\/assignments$/)) {
      try {
        const moduleId = decodeURIComponent((req.url || "").split("/")[4] || "");
        if (!moduleId) {
          writeJsonResponse(res, 400, { error: "Missing module id" });
          return;
        }
        const bodyStr = await readBody(req, maxBodyBytes);
        const { jid } = JSON.parse(bodyStr) as { jid?: string };
        if (!jid || typeof jid !== "string") {
          writeJsonResponse(res, 400, { error: "jid must be a non-empty string" });
          return;
        }
        const db = getDirectoryDb(opts.accountId);
        db.assignModule(moduleId, jid);
        writeJsonResponse(res, 200, { ok: true });
      } catch (err) {
        console.error(`[waha] POST /api/admin/modules assignments failed: ${String(err)}`);
        writeJsonResponse(res, 500, { error: "Failed to add assignment" });
      }
      return;
    }

    // DELETE /api/admin/modules/:id/assignments/:jid — remove a chat assignment from a module
    if (req.method === "DELETE" && req.url?.match(/^\/api\/admin\/modules\/[^/]+\/assignments\/.+$/)) {
      try {
        const urlParts = (req.url || "").split("/");
        // URL: /api/admin/modules/{id}/assignments/{jid}
        // parts: ['', 'api', 'admin', 'modules', '{id}', 'assignments', '{jid}']
        const moduleId = decodeURIComponent(urlParts[4] || "");
        const jid = decodeURIComponent(urlParts.slice(6).join("/") || "");
        if (!moduleId || !jid) {
          writeJsonResponse(res, 400, { error: "Missing module id or jid" });
          return;
        }
        const db = getDirectoryDb(opts.accountId);
        db.unassignModule(moduleId, jid);
        writeJsonResponse(res, 200, { ok: true });
      } catch (err) {
        console.error(`[waha] DELETE /api/admin/modules assignment failed: ${String(err)}`);
        writeJsonResponse(res, 500, { error: "Failed to remove assignment" });
      }
      return;
    }

    // POST /api/admin/directory/bulk — bulk operations on multiple JIDs (DIR-04)
    // CRITICAL: exact URL match placed BEFORE generic /api/admin/directory/:jid routes to avoid collision (Pitfall 7)
    if (req.url === "/api/admin/directory/bulk" && req.method === "POST") {
      try {
        const bodyStr = await readBody(req, maxBodyBytes);
        const { jids, action, value, groupJid } = JSON.parse(bodyStr) as {
          jids: string[];
          action: string;
          value?: string;
          groupJid?: string;
        };
        if (!Array.isArray(jids) || jids.length === 0) {
          writeJsonResponse(res, 400, { error: "jids must be a non-empty array" });
          return;
        }
        if (jids.length > 500) {
          writeJsonResponse(res, 400, { error: "jids array exceeds maximum of 500 items" });
          return;
        }
        if (!jids.every((j) => typeof j === "string")) {
          writeJsonResponse(res, 400, { error: "all jids must be strings" });
          return;
        }
        const validActions = ["allow-dm", "revoke-dm", "allow-group", "revoke-group", "set-role", "follow", "unfollow"];
        if (!validActions.includes(action)) {
          writeJsonResponse(res, 400, { error: "action must be one of: " + validActions.join(", ") });
          return;
        }
        if (action === "set-role") {
          if (!value || !["bot_admin", "manager", "participant"].includes(value)) {
            writeJsonResponse(res, 400, { error: "value must be bot_admin, manager, or participant for set-role action" });
            return;
          }
          if (!groupJid) {
            writeJsonResponse(res, 400, { error: "groupJid is required for set-role action" });
            return;
          }
        }
        if ((action === "allow-group" || action === "revoke-group") && !groupJid) {
          writeJsonResponse(res, 400, { error: "groupJid is required for " + action + " action" });
          return;
        }
        const db = getDirectoryDb(opts.accountId);
        const configPath = getConfigPath();
        let updated = 0;
        const allowDmJids: string[] = [];
        const revokeDmJids: string[] = [];
        const allowGroupJids: string[] = [];
        const revokeGroupJids: string[] = [];
        for (const jid of jids) {
          if (action === "allow-dm") {
            db.setContactAllowDm(jid, true);
            allowDmJids.push(jid);
            updated++;
          } else if (action === "revoke-dm") {
            db.setContactAllowDm(jid, false);
            revokeDmJids.push(jid);
            updated++;
          } else if (action === "allow-group" && groupJid) {
            if (db.setParticipantAllowInGroup(groupJid, jid, true)) {
              allowGroupJids.push(jid);
              updated++;
            }
          } else if (action === "revoke-group" && groupJid) {
            if (db.setParticipantAllowInGroup(groupJid, jid, false)) {
              revokeGroupJids.push(jid);
              updated++;
            }
          } else if (action === "set-role" && groupJid && value) {
            if (value === "bot_admin" || value === "manager" || value === "participant") {
              if (db.setParticipantRole(groupJid, jid, value)) updated++;
            }
          }
        }
        // Follow/unfollow actions require WAHA API calls — handled separately outside the per-JID loop
        if (action === "follow" || action === "unfollow") {
          const wahaBaseUrl = account.config.baseUrl ?? "http://127.0.0.1:3004";
          const wahaApiKey = account.apiKey;
          const session = account.config.session ?? "default";
          for (const jid of jids) {
            try {
              const channelId = encodeURIComponent(jid);
              const followPath = action === "follow" ? "follow" : "unfollow";
              const resp = await fetch(
                `${wahaBaseUrl}/api/${encodeURIComponent(session)}/channels/${channelId}/${followPath}`,
                { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": wahaApiKey }, body: "{}" }
              );
              if (resp.ok) updated++;
            } catch (err) {
              console.warn('Bulk follow/unfollow failed for channel:', err);
            }
          }
        }
        // Batch config sync — single file read+write per action type instead of per-JID
        if (allowDmJids.length) syncAllowListBatch(configPath, "allowFrom", allowDmJids, true);
        if (revokeDmJids.length) syncAllowListBatch(configPath, "allowFrom", revokeDmJids, false);
        if (allowGroupJids.length) syncAllowListBatch(configPath, "groupAllowFrom", allowGroupJids, true);
        if (revokeGroupJids.length) syncAllowListBatch(configPath, "groupAllowFrom", revokeGroupJids, false);
        writeJsonResponse(res, 200, { ok: true, updated });
      } catch (err) {
        console.error(`[waha] POST /api/admin/directory/bulk failed: ${String(err)}`);
        writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
      }
      return;
    }

    // GET /api/admin/sync/status — sync status endpoint for admin panel status bar.
    // Phase 13 (SYNC-03): Returns current SyncState for the account. DO NOT REMOVE.
    if (req.url === "/api/admin/sync/status" && req.method === "GET") {
      const state = getSyncState(opts.accountId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state ?? { status: "idle", lastSyncAt: null, lastSyncDuration: null, itemsSynced: 0, currentPhase: null, lastError: null }));
      return;
    }

    // POST /api/admin/directory/refresh — trigger immediate background sync
    // Phase 13: Redirected from inline refresh to triggerImmediateSync.
    // The sync engine handles the full refresh pipeline. DO NOT revert to inline refresh.
    if (req.url === "/api/admin/directory/refresh" && req.method === "POST") {
      try {
        triggerImmediateSync(opts.accountId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ triggered: true, message: "Sync triggered" }));
      } catch (err) {
        console.error(`[waha] sync trigger failed: ${String(err)}`);
        writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
      }
      return;
    }


    // POST /api/admin/directory/:jid/allow-dm
    {
      const m = req.method === "POST" && req.url?.match(/^\/api\/admin\/directory\/([^/]+)\/allow-dm$/);
      if (m) {
        try {
          const jid = decodeURIComponent(m[1]);
          const bodyStr = await readBody(req, maxBodyBytes);
          const { allowed } = JSON.parse(bodyStr) as { allowed: boolean };
          if (typeof allowed !== "boolean") {
            writeJsonResponse(res, 400, { error: "allowed must be a boolean" });
            return;
          }
          const db = getDirectoryDb(opts.accountId);
          db.setContactAllowDm(jid, allowed);
          syncAllowList(getConfigPath(), "allowFrom", jid, allowed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error(`[waha] POST /api/admin/directory/:jid/allow-dm failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }
    }

    // PUT /api/admin/directory/:jid/ttl — set or clear TTL on allow_list entry
    // TTL-01: Used by admin panel "Access Expires" control. DO NOT REMOVE.
    {
      const m = req.method === "PUT" && req.url?.match(/^\/api\/admin\/directory\/([^/]+)\/ttl$/);
      if (m) {
        try {
          const jid = decodeURIComponent(m[1]);
          const bodyStr = await readBody(req, maxBodyBytes);
          const body = JSON.parse(bodyStr) as { expiresAt: number | null };
          // Validate: expiresAt must be null (never) or a positive Unix timestamp (seconds)
          if (body.expiresAt !== null && (typeof body.expiresAt !== 'number' || body.expiresAt <= 0)) {
            writeJsonResponse(res, 400, { error: "expiresAt must be null or a positive Unix timestamp in seconds" });
            return;
          }
          const db = getDirectoryDb(opts.accountId);
          // Update only if contact exists in allow_list
          const existing = db.getContactTtl(jid);
          if (!existing) {
            writeJsonResponse(res, 404, { error: "Contact not in allow list" });
            return;
          }
          // Re-insert with same allow_dm but new expires_at
          db.setContactAllowDm(jid, true, body.expiresAt);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, expiresAt: body.expiresAt }));
        } catch (err) {
          console.error(`[waha] PUT /api/admin/directory/:jid/ttl failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }
    }

    // GET /api/admin/directory/group/:groupJid/participants
    {
      const m = req.method === "GET" && req.url?.match(/^\/api\/admin\/directory\/group\/([^/]+)\/participants$/);
      if (m) {
        try {
          const groupJid = decodeURIComponent(m[1]);
          const db = getDirectoryDb(opts.accountId);
          let participants = db.getGroupParticipants(groupJid);

          // Lazy-fetch from WAHA if no participants in DB yet
          if (participants.length === 0) {
            try {
              const rawParticipants = await getWahaGroupParticipants({ cfg: opts.config, groupId: groupJid, accountId: opts.accountId });
              const parts = Array.isArray(rawParticipants) ? rawParticipants : [];
              const mapped = parts.map((p: Record<string, unknown>) => ({
                jid: String(p.id ?? ""),
                name: (p.name as string) || (p.pushName as string) || undefined,
                isAdmin: (p.admin as string) === "admin" || (p.admin as string) === "superadmin" || p.isAdmin === true,
              })).filter((p) => p.jid);
              if (mapped.length > 0) {
                db.bulkUpsertGroupParticipants(groupJid, mapped);
                participants = db.getGroupParticipants(groupJid);
                // DIR-02: Name resolution pass — for @lid JIDs with no display name, use
                // lid_mapping table to find the REAL @c.us contact (NOWEB sends @lid JIDs).
                // The @lid number is completely different from @c.us — simple string replacement
                // does NOT work. Must use resolveLidToCus(). DO NOT CHANGE.
                const noName = participants.filter((p) => !p.displayName);
                for (const p of noName) {
                  if (p.participantJid.endsWith("@lid")) {
                    const realCus = db.resolveLidToCus(p.participantJid);
                    if (realCus) {
                      const contact = db.getContact(realCus);
                      if (contact?.displayName) {
                        db.updateParticipantDisplayName(groupJid, p.participantJid, contact.displayName);
                      }
                    }
                  } else if (p.participantJid.endsWith("@c.us")) {
                    const contact = db.getContact(p.participantJid);
                    if (contact?.displayName) {
                      db.updateParticipantDisplayName(groupJid, p.participantJid, contact.displayName);
                    }
                  }
                }
                // Re-read after name resolution so enriched names are returned in response
                participants = db.getGroupParticipants(groupJid);
              }
            } catch (fetchErr) {
              console.warn(`[waha] Failed to lazy-fetch participants for ${groupJid}: ${String(fetchErr)}`);
            }
          }

          // Name resolution pass for existing participants that still have no display name.
          // This covers cases where participants were stored before lid_mapping was populated,
          // or where @c.us contacts gained a display_name after initial participant insert.
          // Only runs when there are nameless participants — no-op otherwise. DO NOT REMOVE.
          {
            const noName = participants.filter((p) => !p.displayName);
            if (noName.length > 0) {
              let updated = false;
              for (const p of noName) {
                if (p.participantJid.endsWith("@lid")) {
                  const realCus = db.resolveLidToCus(p.participantJid);
                  if (realCus) {
                    const contact = db.getContact(realCus);
                    if (contact?.displayName) {
                      db.updateParticipantDisplayName(groupJid, p.participantJid, contact.displayName);
                      updated = true;
                    }
                  }
                } else if (p.participantJid.endsWith("@c.us")) {
                  const contact = db.getContact(p.participantJid);
                  if (contact?.displayName) {
                    db.updateParticipantDisplayName(groupJid, p.participantJid, contact.displayName);
                    updated = true;
                  }
                }
              }
              if (updated) participants = db.getGroupParticipants(groupJid);
            }
          }

          // DIR-02: Enrich participants with global allowlist state from config.groupAllowFrom
          // This shows green buttons for participants already in the global allowlist (not just per-group DB)
          const groupAllowFrom: string[] = account.config.groupAllowFrom ?? [];
          // Fetch bot session JIDs to mark bot participants server-side. DO NOT REMOVE.
          const botJidSet = await fetchBotJids(listEnabledWahaAccounts(opts.config));
          // Also resolve LID→@c.us for bot JIDs so we match both formats
          const botJidFull = new Set<string>(botJidSet);
          for (const p of participants) {
            if (p.participantJid.endsWith("@lid")) {
              const cus = db.resolveLidToCus(p.participantJid);
              if (cus && botJidFull.has(cus)) botJidFull.add(p.participantJid);
            }
          }
          const enrichedParticipants = participants.map((p) => ({
            ...p,
            globallyAllowed: groupAllowFrom.includes(p.participantJid),
            isBotSession: botJidFull.has(p.participantJid),
          }));

          const allowAll = db.getGroupAllowAllStatus(groupJid);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ participants: enrichedParticipants, allowAll }));
        } catch (err) {
          console.error(`[waha] GET /api/admin/directory/group/:groupJid/participants failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }
    }

    // POST /api/admin/directory/group/:groupJid/participants/:participantJid/allow-group
    {
      const m = req.method === "POST" && req.url?.match(/^\/api\/admin\/directory\/group\/([^/]+)\/participants\/([^/]+)\/allow-group$/);
      if (m) {
        try {
          const groupJid = decodeURIComponent(m[1]);
          const participantJid = decodeURIComponent(m[2]);
          const bodyStr = await readBody(req, maxBodyBytes);
          const { allowed } = JSON.parse(bodyStr) as { allowed: boolean };
          if (typeof allowed !== "boolean") {
            writeJsonResponse(res, 400, { error: "allowed must be a boolean" });
            return;
          }
          const db = getDirectoryDb(opts.accountId);
          db.setParticipantAllowInGroup(groupJid, participantJid, allowed);
          syncAllowList(getConfigPath(), "groupAllowFrom", participantJid, allowed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error(`[waha] POST /api/admin/directory/group/:groupJid/participants/:participantJid/allow-group failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }
    }

    // POST /api/admin/directory/group/:groupJid/participants/:participantJid/allow-dm
    {
      const m = req.method === "POST" && req.url?.match(/^\/api\/admin\/directory\/group\/([^/]+)\/participants\/([^/]+)\/allow-dm$/);
      if (m) {
        try {
          const groupJid = decodeURIComponent(m[1]);
          const participantJid = decodeURIComponent(m[2]);
          const bodyStr = await readBody(req, maxBodyBytes);
          const { allowed } = JSON.parse(bodyStr) as { allowed: boolean };
          if (typeof allowed !== "boolean") {
            writeJsonResponse(res, 400, { error: "allowed must be a boolean" });
            return;
          }
          const db = getDirectoryDb(opts.accountId);
          db.setParticipantAllowDm(groupJid, participantJid, allowed);
          syncAllowList(getConfigPath(), "allowFrom", participantJid, allowed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error(`[waha] POST /api/admin/directory/group/:groupJid/participants/:participantJid/allow-dm failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }
    }

    // PUT /api/admin/directory/group/:groupJid/participants/:participantJid/role
    {
      const m = req.method === "PUT" && req.url?.match(/^\/api\/admin\/directory\/group\/([^/]+)\/participants\/([^/]+)\/role$/);
      if (m) {
        try {
          const groupJid = decodeURIComponent(m[1]);
          const participantJid = decodeURIComponent(m[2]);
          const bodyStr = await readBody(req, maxBodyBytes);
          const { role } = JSON.parse(bodyStr) as { role: string };
          if (!["bot_admin", "manager", "participant"].includes(role)) {
            writeJsonResponse(res, 400, { error: "role must be bot_admin, manager, or participant" });
            return;
          }
          const db = getDirectoryDb(opts.accountId);
          const ok = db.setParticipantRole(groupJid, participantJid, role as ParticipantRole);
          if (!ok) {
            writeJsonResponse(res, 404, { error: "Participant not found in group" });
          } else {
            writeJsonResponse(res, 200, { ok: true });
          }
        } catch (err) {
          console.error(`[waha] PUT participant role failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }
    }

    // POST /api/admin/directory/group/:groupJid/allow-all
    {
      const m = req.method === "POST" && req.url?.match(/^\/api\/admin\/directory\/group\/([^/]+)\/allow-all$/);
      if (m) {
        try {
          const groupJid = decodeURIComponent(m[1]);
          const bodyStr = await readBody(req, maxBodyBytes);
          const { allowed } = JSON.parse(bodyStr) as { allowed: boolean };
          if (typeof allowed !== "boolean") {
            writeJsonResponse(res, 400, { error: "allowed must be a boolean" });
            return;
          }
          const db = getDirectoryDb(opts.accountId);
          db.setGroupAllowAll(groupJid, allowed);
          const participants = db.getGroupParticipants(groupJid);
          const configPath = getConfigPath();
          syncAllowListBatch(configPath, "groupAllowFrom", participants.map(p => p.participantJid), allowed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error(`[waha] POST /api/admin/directory/group/:groupJid/allow-all failed: ${String(err)}`);
          writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
        }
        return;
      }
    }

    // ── Presence data for admin panel — Added Phase 28, Plan 03 ──
    // GET /api/admin/presence — returns all subscribed presence info from WAHA.
    // Used by ContactsTab to display online/offline status next to contacts.
    // DO NOT REMOVE — powers presence indicators in the admin Directory tab.
    if (req.url === "/api/admin/presence" && req.method === "GET") {
      try {
        const presenceData = await getAllWahaPresence({ cfg });
        writeJsonResponse(res, 200, { presence: presenceData });
      } catch (err) {
        writeJsonResponse(res, 200, { presence: [], error: String(err) });
      }
      return;
    }

    // Phase 16: GET /api/admin/pairing/deeplink?jid=<jid>
    // Generates a wa.me deep link with HMAC token for a specific JID. DO NOT REMOVE.
    if (req.method === "GET" && req.url?.startsWith("/api/admin/pairing/deeplink")) {
      try {
        const urlObj = new URL(req.url, "http://localhost");
        const jid = urlObj.searchParams.get("jid");
        if (!jid) {
          writeJsonResponse(res, 400, { error: "jid parameter required" });
          return;
        }
        const hmacSecret = (account.config.pairingMode as Record<string, unknown> | undefined)?.hmacSecret as string | undefined;
        if (!hmacSecret) {
          writeJsonResponse(res, 400, { error: "pairingMode.hmacSecret not configured" });
          return;
        }
        const token = getPairingEngine(opts.accountId, hmacSecret).generateDeepLinkToken(jid);
        const phone = jid.replace(/@.*$/, "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ link: `https://wa.me/${phone}?text=PAIR-${token}` }));
      } catch (err) {
        console.error(`[waha] GET /api/admin/pairing/deeplink failed: ${String(err)}`);
        writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
      }
      return;
    }

    // Phase 16: DELETE /api/admin/pairing/grant/:jid
    // Revokes pairing access for a specific JID. DO NOT REMOVE.
    if (req.method === "DELETE" && req.url?.startsWith("/api/admin/pairing/grant/")) {
      try {
        const jid = decodeURIComponent(req.url.replace("/api/admin/pairing/grant/", ""));
        const db = getDirectoryDb(opts.accountId);
        db.revokePairingGrant(jid);
        syncAllowList(getConfigPath(), "allowFrom", jid, false);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error(`[waha] DELETE /api/admin/pairing/grant failed: ${String(err)}`);
        writeWebhookError(res, 500, WEBHOOK_ERRORS.internalServerError);
      }
      return;
    }

    // ── Webhook processing: only POST requests to the configured webhook path ──
    // All admin API routes are handled above. Non-webhook requests that didn't match
    // any admin route get 404 at the bottom of this handler. DO NOT MOVE this check
    // above the admin routes — it would block GET/PUT/DELETE requests. (Bug fix: 2026-03-19)
    if (req.method === "POST" && req.url?.startsWith(path)) {

    let body = "";
    try {
      body = await readBody(req, maxBodyBytes);
    } catch (err) {
      if (isRequestBodyLimitError(err)) {
        writeWebhookError(res, 413, WEBHOOK_ERRORS.payloadTooLarge);
        return;
      }
      const message = requestBodyErrorToText(err) || WEBHOOK_ERRORS.internalServerError;
      writeWebhookError(res, 400, message);
      return;
    }

    if (hmacSecret) {
      const signature = req.headers["x-webhook-hmac"] as string | undefined;
      const algorithm = req.headers["x-webhook-hmac-algorithm"] as string | undefined;
      const valid = verifyWahaWebhookHmac({
        body,
        secret: hmacSecret,
        signatureHeader: signature,
        algorithmHeader: algorithm,
      });
      if (!valid) {
        writeWebhookError(res, 401, WEBHOOK_ERRORS.invalidSignature);
        return;
      }
    }

    const payload = parseWebhookPayload(body);
    if (!payload) {
      writeWebhookError(res, 400, WEBHOOK_ERRORS.invalidPayloadFormat);
      return;
    }

    if (!isRegisteredSession(payload.session, opts.config)) {
      writeJsonResponse(res, 200, { status: "ignored", reason: `Session '${payload.session}' not registered in config` });
      return;
    }

    const runtime = opts.runtime ?? createLoggerBackedRuntime("waha-webhook");

    // Only process "message" events — NOT "message.any". WAHA sends both,
    // and processing both causes duplicate message handling. (Per CLAUDE.md rule.)
    // Exception: also accept "message.any" for fromMe trigger-word messages,
    // because WAHA NOWEB only fires "message.any" (not "message") for self-sent messages.
    // DO NOT CHANGE — required for trigger-word activation on human sessions.
    if (payload.event === "message" || payload.event === "message.any") {
      const message = payloadToInboundMessage(payload.payload);
      if (!message) {
        writeWebhookError(res, 400, WEBHOOK_ERRORS.invalidPayloadFormat);
        return;
      }
      // "message.any" is ONLY accepted for fromMe trigger-word messages.
      // For all other cases, only "message" events are processed to avoid duplicates.
      // DO NOT CHANGE — WAHA NOWEB fires "message.any" (not "message") for self-sent messages.
      if (payload.event === "message.any" && !message.fromMe) {
        writeJsonResponse(res, 200, { status: "ignored" });
        return;
      }
      // Skip self-messages UNLESS the account has a triggerWord and the message starts with it.
      // This allows human sessions to invoke the bot via trigger prefix even when sending from their own phone.
      // DO NOT CHANGE — required for trigger-word activation in groups where only the human session is present.
      if (message.fromMe) {
        const triggerWord = cfg.triggerWord;
        const messageText = (message.body ?? "").trim();
        if (!triggerWord || !messageText.toLowerCase().startsWith(triggerWord.toLowerCase())) {
          writeJsonResponse(res, 200, { status: "ignored" });
          return;
        }
      }
      // Dedup check: filter duplicate webhook deliveries by composite key
      // Primary guard is message vs message.any event filter; this is secondary protection (REL-09)
      // Normalize event type for dedup — "message" and "message.any" should dedup against each other.
      if (isDuplicate("message", message.messageId)) {
        writeJsonResponse(res, 200, { status: "duplicate" });
        return;
      }
      // Enqueue instead of direct call -- bounded queue with DM priority (Phase 2, Plan 02)
      // ALWAYS return 200 after enqueue. Never return 500 on queue full -- WAHA retries cause flood.
      inboundQueue.enqueue({
        message,
        rawPayload: payload.payload,
        account,
        config: opts.config,
        runtime,
        statusSink: opts.statusSink,
      }, isWhatsAppGroupJid(message.chatId));
      // Phase 29, Plan 02: emit log SSE event when a message is queued. DO NOT REMOVE.
      broadcastSSE("log", { line: `[WAHA] message queued: ${message.chatId} (${message.fromMe ? "outbound" : "inbound"})`, timestamp: Date.now() });
      writeJsonResponse(res, 200, { status: "queued" });
      return;
    }

    if (payload.event === "message.reaction") {
      const reaction = payloadToReaction(payload.payload);
      if (!reaction) {
        writeWebhookError(res, 400, WEBHOOK_ERRORS.invalidPayloadFormat);
        return;
      }
      if (isDuplicate(payload.event, reaction.messageId)) {
        writeJsonResponse(res, 200, { status: "duplicate" });
        return;
      }
      writeJsonResponse(res, 200, { status: "ok" });
      return;
    }

    // ── Poll votes ──
    if (payload.event === "poll.vote" || payload.event === "poll.vote.failed") {
      const voteData = payload.payload as Record<string, unknown>;
      const vote = voteData?.vote as Record<string, unknown> | undefined;
      const poll = voteData?.poll as Record<string, unknown> | undefined;
      if (vote && poll) {
        const voter = (vote.participant ?? vote.from ?? "unknown") as string;
        const selected = Array.isArray(vote.selectedOptions) ? vote.selectedOptions.join(", ") : "unknown";
        const failed = payload.event === "poll.vote.failed" ? " (decryption failed)" : "";
        const syntheticMessage: WahaInboundMessage = {
          messageId: (vote.id as string) ?? `poll-vote-${Date.now()}`,
          timestamp: normalizeTimestamp(typeof vote.timestamp === "number" ? vote.timestamp : Date.now()),
          from: (vote.from as string) ?? "",
          fromMe: vote.fromMe === true,
          chatId: (vote.to as string) ?? (poll.to as string) ?? "",
          body: `[poll_vote${failed}] ${voter} voted "${selected}" on poll ${(poll.id as string) ?? "unknown"}`,
          hasMedia: false,
          participant: vote.participant as string | undefined,
        };
        if (!syntheticMessage.fromMe && syntheticMessage.chatId) {
          // Enqueue poll vote -- always return 200 (Phase 2, Plan 02)
          inboundQueue.enqueue({
            message: syntheticMessage,
            rawPayload: voteData,
            account,
            config: opts.config,
            runtime,
            statusSink: opts.statusSink,
          }, isWhatsAppGroupJid(syntheticMessage.chatId));
          writeJsonResponse(res, 200, { status: "queued" });
          return;
        }
      }
      writeJsonResponse(res, 200, { status: "ok" });
      return;
    }

    // ── Event RSVPs ──
    if (payload.event === "event.response" || payload.event === "event.response.failed") {
      const rsvpData = payload.payload as Record<string, unknown>;
      const eventResponse = rsvpData?.eventResponse as Record<string, unknown> | undefined;
      if (eventResponse) {
        const participant = ((rsvpData.participant ?? rsvpData.from) as string) ?? "unknown";
        const response = (eventResponse.response as string) ?? "UNKNOWN";
        const failed = payload.event === "event.response.failed" ? " (decryption failed)" : "";
        const syntheticMessage: WahaInboundMessage = {
          messageId: (rsvpData.id as string) ?? `event-rsvp-${Date.now()}`,
          timestamp: normalizeTimestamp(typeof rsvpData.timestamp === "number" ? rsvpData.timestamp : Date.now()),
          from: (rsvpData.from as string) ?? "",
          fromMe: rsvpData.fromMe === true,
          chatId: (rsvpData.to as string) ?? "",
          body: `[event_rsvp${failed}] ${participant} responded "${response}"`,
          hasMedia: false,
          participant: rsvpData.participant as string | undefined,
        };
        if (!syntheticMessage.fromMe && syntheticMessage.chatId) {
          // Enqueue event RSVP -- always return 200 (Phase 2, Plan 02)
          inboundQueue.enqueue({
            message: syntheticMessage,
            rawPayload: rsvpData,
            account,
            config: opts.config,
            runtime,
            statusSink: opts.statusSink,
          }, isWhatsAppGroupJid(syntheticMessage.chatId));
          writeJsonResponse(res, 200, { status: "queued" });
          return;
        }
      }
      writeJsonResponse(res, 200, { status: "ok" });
      return;
    }

    // ── Group join/leave events — Added Phase 28, Plan 02 ──────────────
    // Handle group membership changes. Creates synthetic messages for the agent
    // and updates directory participant tracking.
    // DO NOT CHANGE — group events are critical for directory consistency.
    if (payload.event === "group.join" || payload.event === "group.leave") {
      const groupData = payload.payload as Record<string, unknown>;
      // WAHA group event payload: { id: groupJid, participants: string[], action: "add"|"remove"|... }
      const groupId = (groupData.id as string) ?? (groupData.chatId as string) ?? "";
      const participants = Array.isArray(groupData.participants) ? groupData.participants as string[] : [];
      const action = payload.event === "group.join" ? "group_join" : "group_leave";
      const verb = payload.event === "group.join" ? "joined" : "left";

      if (groupId && participants.length > 0) {
        for (const participant of participants) {
          const eventKey = `${action}-${groupId}-${participant}`;
          if (isDuplicate(payload.event, eventKey)) continue;

          const syntheticMessage: WahaInboundMessage = {
            messageId: `${action}-${Date.now()}-${participant}`,
            timestamp: normalizeTimestamp(typeof groupData.timestamp === "number" ? groupData.timestamp : Date.now()),
            from: participant,
            fromMe: false,
            chatId: groupId,
            body: `[${action}] ${participant} ${verb} group ${groupId}`,
            hasMedia: false,
            participant,
          };

          // Update directory participant tracking via DirectoryDb
          try {
            if (payload.event === "group.join") {
              // Add new participant to the directory. isAdmin=false is safe default;
              // a full directory sync will correct admin status later if needed.
              const dirDb = getDirectoryDb(account.accountId);
              dirDb.bulkUpsertGroupParticipants(groupId, [{ jid: participant, isAdmin: false }]);
            }
            // For group.leave: no removal method on DirectoryDb — row stays as historical record.
            // A future directory sync will clean stale entries.
          } catch (dirErr) {
            console.warn(`[waha-webhook] Failed to update directory for ${action}:`, (dirErr as Error).message);
          }

          inboundQueue.enqueue({
            message: syntheticMessage,
            rawPayload: groupData,
            account,
            config: opts.config,
            runtime,
            statusSink: opts.statusSink,
          }, true); // group events are always group-queue priority
        }
        writeJsonResponse(res, 200, { status: "queued" });
        return;
      }
      writeJsonResponse(res, 200, { status: "ok" });
      return;
    }

    writeJsonResponse(res, 200, { status: "ignored" });
    return;
    } // end: webhook POST processing

    // GET /api/admin/analytics — message analytics aggregation (Phase 30, Plan 01). DO NOT REMOVE.
    if (req.url?.startsWith("/api/admin/analytics") && req.method === "GET") {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const range = url.searchParams.get("range") || "24h";
        const groupByParam = url.searchParams.get("groupBy") as "minute" | "hour" | "day" | null;
        const rangeMs: Record<string, number> = {
          "1h": 3600000, "6h": 21600000, "24h": 86400000,
          "7d": 604800000, "30d": 2592000000,
        };
        const ms = rangeMs[range] || 86400000;
        const endTime = Date.now();
        const startTime = endTime - ms;
        // Auto-select groupBy if not specified based on range size
        let groupBy: "minute" | "hour" | "day";
        if (ms <= 3600000) groupBy = "minute";
        else if (ms <= 86400000) groupBy = "hour";
        else groupBy = "day";
        const effectiveGroupBy: "minute" | "hour" | "day" = groupByParam ?? groupBy;
        const db = getAnalyticsDb();
        const timeseries = db.query({ startTime, endTime, groupBy: effectiveGroupBy });
        const summary = db.getSummary({ startTime, endTime });
        const topChats = db.getTopChats({ startTime, endTime, limit: 5 });
        writeJsonResponse(res, 200, { range, groupBy: effectiveGroupBy, timeseries, summary, topChats });
        return;
      } catch (err) {
        console.error(`[waha] GET /api/admin/analytics failed: ${String(err)}`);
        writeJsonResponse(res, 500, { error: "Analytics query failed" });
        return;
      }
    }

    // ── Catch-all 404 — no route matched ──
    // This MUST be the last handler in the chain, AFTER all admin API routes
    // and webhook processing. DO NOT MOVE above admin routes.
    res.writeHead(404);
    res.end();
  });

  const start = async () => {
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(port, host, () => resolve());
    });
  };

  const stop = () => {
    server.close((err) => { if (err) console.error("[waha] Server close error:", err); });
  };

  if (opts.abortSignal) {
    opts.abortSignal.addEventListener("abort", () => stop(), { once: true });
  }

  return { server, start, stop };
}

function resolveWebhookHmacSecret(account: ReturnType<typeof resolveWahaAccount>): string {
  const env = process.env.WAHA_WEBHOOK_HMAC_KEY?.trim();
  if (env && account.accountId === DEFAULT_ACCOUNT_ID) {
    return env;
  }
  if (account.config.webhookHmacKeyFile) {
    try {
      return readFileSync(account.config.webhookHmacKeyFile, "utf-8").trim();
    } catch (err) {
      throw new Error(`[waha] webhookHmacKeyFile "${account.config.webhookHmacKeyFile}" unreadable: ${String(err)}. Fix the file path or remove webhookHmacKeyFile from config.`);
    }
  }
  const inline = normalizeResolvedSecretInputString({
    value: account.config.webhookHmacKey,
    path: `channels.waha.accounts.${account.accountId}.webhookHmacKey`,
  });
  return inline?.trim() ?? "";
}

export async function monitorWahaProvider(params: {
  accountId: string;
  config: CoreConfig;
  runtime: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number; running?: boolean }) => void;
}) {
  const server = createWahaWebhookServer({
    accountId: params.accountId,
    config: params.config,
    runtime: params.runtime,
    abortSignal: params.abortSignal,
    statusSink: params.statusSink,
  });

  await server.start();
  params.statusSink?.({ running: true });

  return {
    stop: () => {
      server.stop();
      params.statusSink?.({ running: false });
    },
  };
}
