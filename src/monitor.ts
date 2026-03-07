import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import {
  createLoggerBackedRuntime,
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { resolveWahaAccount } from "./accounts.js";
import { getDmFilterForAdmin, handleWahaInbound } from "./inbound.js";
import { assertAllowedSession } from "./send.js";
import { verifyWahaWebhookHmac } from "./signature.js";
import { normalizeResolvedSecretInputString } from "./secret-input.js";
import type { CoreConfig, WahaInboundMessage, WahaReactionEvent, WahaWebhookEnvelope } from "./types.js";

const DEFAULT_WEBHOOK_PORT = 8050;
const DEFAULT_WEBHOOK_HOST = "0.0.0.0";
const DEFAULT_WEBHOOK_PATH = "/webhook/waha";
const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_WEBHOOK_BODY_TIMEOUT_MS = 30_000;
const HEALTH_PATH = "/healthz";

const WEBHOOK_ERRORS = {
  invalidPayloadFormat: "Invalid payload format",
  invalidSignature: "Invalid signature",
  payloadTooLarge: "Payload too large",
  internalServerError: "Internal server error",
} as const;

function writeJsonResponse(res: ServerResponse, status: number, body?: Record<string, unknown>) {
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
    if (!data || typeof data !== "object") return null;
    if (!data.event || !data.session || !data.payload) return null;
    return data as WahaWebhookEnvelope;
  } catch {
    return null;
  }
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

function buildAdminHtml(config: CoreConfig, account: ReturnType<typeof resolveWahaAccount>): string {
  const session = account.config.session ?? "unknown";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WAHA Plugin Admin - ${session}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
  header { background: #1e293b; padding: 16px 24px; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 1.25rem; font-weight: 600; }
  header .badge { background: #10b981; color: #fff; font-size: 0.75rem; padding: 2px 8px; border-radius: 9999px; }
  main { max-width: 900px; margin: 0 auto; padding: 24px; display: grid; gap: 20px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px; }
  .card h2 { font-size: 1rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
  .stat-row { display: flex; gap: 16px; flex-wrap: wrap; }
  .stat { background: #0f172a; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 120px; }
  .stat .label { font-size: 0.75rem; color: #64748b; margin-bottom: 4px; }
  .stat .value { font-size: 1.5rem; font-weight: 700; color: #38bdf8; }
  .pattern-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .pattern { background: #0ea5e9; color: #fff; font-size: 0.8rem; padding: 3px 10px; border-radius: 9999px; font-family: monospace; }
  .event-list { margin-top: 12px; font-size: 0.8rem; }
  .event { padding: 6px 10px; border-left: 3px solid #334155; margin-bottom: 4px; border-radius: 0 4px 4px 0; background: #0f172a; display: flex; gap: 8px; }
  .event.pass { border-color: #10b981; }
  .event.fail { border-color: #f87171; }
  .event .ts { color: #64748b; min-width: 80px; }
  .event .reason { color: #94a3b8; min-width: 120px; }
  .event .preview { color: #e2e8f0; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kv { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; font-size: 0.85rem; }
  .kv .k { color: #64748b; }
  .kv .v { color: #e2e8f0; font-family: monospace; }
  .tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag { background: #1e3a5f; color: #7dd3fc; font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; font-family: monospace; }
  #last-refresh { color: #64748b; font-size: 0.75rem; text-align: right; margin-top: 12px; }
  .refresh-btn { background: #1d4ed8; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; margin-left: auto; }
  .refresh-btn:hover { background: #2563eb; }
</style>
</head>
<body>
<header>
  <h1>WAHA Plugin Admin</h1>
  <span class="badge" id="status-badge">Loading...</span>
  <button class="refresh-btn" onclick="loadStats()">Refresh</button>
</header>
<main>
  <div class="card" id="dm-filter-card">
    <h2>DM Keyword Filter</h2>
    <div class="stat-row" id="filter-stats"></div>
    <div id="filter-patterns" style="margin-top:12px;"></div>
    <div class="event-list" id="filter-events"></div>
  </div>
  <div class="card" id="presence-card">
    <h2>Presence System</h2>
    <div class="kv" id="presence-kv"></div>
  </div>
  <div class="card" id="access-card">
    <h2>Access Control</h2>
    <div class="kv" id="access-kv"></div>
  </div>
  <div class="card" id="session-card">
    <h2>Session Info</h2>
    <div class="kv" id="session-kv"></div>
  </div>
  <div id="last-refresh"></div>
</main>
<script>
async function loadStats() {
  try {
    var r = await fetch('/api/admin/stats');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();

    document.getElementById('status-badge').textContent = d.dmFilter.enabled ? 'Filter ON' : 'Filter OFF';
    document.getElementById('status-badge').style.background = d.dmFilter.enabled ? '#10b981' : '#f59e0b';

    var s = d.dmFilter.stats;
    document.getElementById('filter-stats').innerHTML = [
      stat('Allowed', s.allowed, '#10b981'),
      stat('Dropped', s.dropped, '#f87171'),
      stat('Tokens Saved (est)', (s.tokensEstimatedSaved || 0).toLocaleString(), '#38bdf8'),
    ].join('');

    var pats = d.dmFilter.patterns;
    document.getElementById('filter-patterns').innerHTML = '<div style="color:#94a3b8;font-size:.8rem;margin-bottom:6px;">Patterns</div><div class="pattern-list">' +
      (pats.length ? pats.map(function(p) { return '<span class="pattern">' + esc(p) + '</span>'; }).join('') : '<span style="color:#64748b">none</span>') + '</div>';

    var events = d.dmFilter.recentEvents || [];
    document.getElementById('filter-events').innerHTML = events.length
      ? '<div style="color:#94a3b8;font-size:.8rem;margin:10px 0 6px;">Recent Events (last ' + events.length + ')</div>' +
        events.slice(0, 20).map(function(e) { return '<div class="event ' + (e.pass ? 'pass' : 'fail') + '">' +
          '<span class="ts">' + new Date(e.ts).toLocaleTimeString() + '</span>' +
          '<span class="reason">' + esc(e.reason) + '</span>' +
          '<span class="preview">' + esc(e.preview) + '</span>' +
        '</div>'; }).join('')
      : '<div style="color:#64748b;margin-top:8px;font-size:.8rem">No events yet</div>';

    var pr = d.presence;
    document.getElementById('presence-kv').innerHTML = kvRow('enabled', pr.enabled !== false) +
      kvRow('wpm', pr.wpm) + kvRow('readDelayMs', JSON.stringify(pr.readDelayMs)) +
      kvRow('typingDurationMs', JSON.stringify(pr.typingDurationMs)) +
      kvRow('pauseChance', pr.pauseChance) + kvRow('jitter', JSON.stringify(pr.jitter));

    var ac = d.access;
    document.getElementById('access-kv').innerHTML =
      kvRow('dmPolicy', ac.dmPolicy) + kvRow('groupPolicy', ac.groupPolicy) +
      '<div class="k" style="margin-top:8px">allowFrom</div><div class="tag-list" style="padding:4px 0">' + tags(ac.allowFrom) + '</div>' +
      '<div class="k" style="margin-top:8px">groupAllowFrom</div><div class="tag-list" style="padding:4px 0">' + tags(ac.groupAllowFrom) + '</div>' +
      '<div class="k" style="margin-top:8px">allowedGroups</div><div class="tag-list" style="padding:4px 0">' + tags(ac.allowedGroups) + '</div>';

    document.getElementById('session-kv').innerHTML =
      kvRow('session', d.session) + kvRow('baseUrl', d.baseUrl) +
      kvRow('webhookPort', d.webhookPort) + kvRow('serverTime', d.serverTime);

    document.getElementById('last-refresh').textContent = 'Last refreshed: ' + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById('status-badge').textContent = 'Error';
    document.getElementById('status-badge').style.background = '#ef4444';
    console.error(e);
  }
}
function stat(label, value, color) {
  return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="value" style="color:' + color + '">' + esc(String(value)) + '</div></div>';
}
function kvRow(k, v) {
  return '<div class="k">' + esc(k) + '</div><div class="v">' + esc(String(v != null ? v : '')) + '</div>';
}
function tags(arr) {
  return (arr || []).map(function(t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') || '<span style="color:#64748b">none</span>';
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
loadStats();
setInterval(loadStats, 30000);
</script>
</body>
</html>`;
}

export function readWahaWebhookBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return readRequestBodyWithLimit(req, {
    maxBytes: maxBodyBytes,
    timeoutMs: DEFAULT_WEBHOOK_BODY_TIMEOUT_MS,
  });
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

  const server = createServer(async (req, res) => {
    if (req.url === HEALTH_PATH) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    // Admin panel
    if (req.url === "/admin" || req.url === "/admin/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildAdminHtml(opts.config, account));
      return;
    }

    if (req.url === "/api/admin/stats" && req.method === "GET") {
      const dmFilter = getDmFilterForAdmin(opts.config, opts.accountId);
      const dmCfg = account.config.dmFilter ?? {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        dmFilter: {
          enabled: dmCfg.enabled ?? false,
          patterns: dmCfg.mentionPatterns ?? [],
          godModeBypass: dmCfg.godModeBypass ?? true,
          godModeSuperUsers: dmCfg.godModeSuperUsers ?? [],
          tokenEstimate: dmCfg.tokenEstimate ?? 2500,
          stats: dmFilter.stats,
          recentEvents: dmFilter.recentEvents,
        },
        presence: account.config.presence ?? {},
        access: {
          allowFrom: account.config.allowFrom ?? [],
          groupAllowFrom: account.config.groupAllowFrom ?? [],
          allowedGroups: account.config.allowedGroups ?? [],
          dmPolicy: account.config.dmPolicy ?? "pairing",
          groupPolicy: account.config.groupPolicy ?? "allowlist",
        },
        session: account.config.session ?? "unknown",
        baseUrl: account.config.baseUrl ?? "",
        webhookPort: account.config.webhookPort ?? 8050,
        serverTime: new Date().toISOString(),
      }));
      return;
    }

    if (req.url === "/api/admin/config" && req.method === "POST") {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Config write not yet implemented" }));
      return;
    }

    if (req.method !== "POST" || !req.url || !req.url.startsWith(path)) {
      res.writeHead(404);
      res.end();
      return;
    }

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

    try {
      assertAllowedSession(payload.session);
    } catch (err) {
      // Guardrail enforcement without triggering WAHA retry storms:
      // acknowledge and ignore non-allowed sessions.
      writeJsonResponse(res, 200, { status: "ignored", reason: String(err) });
      return;
    }

    const runtime = opts.runtime ?? createLoggerBackedRuntime("waha-webhook");

    if (payload.event === "message" || payload.event === "message.any") {
      const message = payloadToInboundMessage(payload.payload);
      if (!message) {
        writeWebhookError(res, 400, WEBHOOK_ERRORS.invalidPayloadFormat);
        return;
      }
      if (message.fromMe) {
        // Skip outbound echo messages.
        writeJsonResponse(res, 200, { status: "ignored" });
        return;
      }
      await handleWahaInbound({
        message,
        account,
        config: opts.config,
        runtime,
        statusSink: opts.statusSink,
      });
      writeJsonResponse(res, 200, { status: "ok" });
      return;
    }

    if (payload.event === "message.reaction") {
      const reaction = payloadToReaction(payload.payload);
      if (!reaction) {
        writeWebhookError(res, 400, WEBHOOK_ERRORS.invalidPayloadFormat);
        return;
      }
      // TODO: expose reaction events as system messages or hooks once WAHA reaction semantics are confirmed.
      writeJsonResponse(res, 200, { status: "ok" });
      return;
    }

    // Ignore other events for now.
    writeJsonResponse(res, 200, { status: "ignored" });
  });

  const start = async () => {
    await new Promise<void>((resolve) => {
      server.listen(port, host, () => resolve());
    });
  };

  const stop = () => {
    server.close();
  };

  if (opts.abortSignal) {
    opts.abortSignal.addEventListener("abort", () => stop(), { once: true });
  }

  return { server, start, stop };
}

function resolveWebhookHmacSecret(account: ReturnType<typeof resolveWahaAccount>): string {
  const env = process.env.WAHA_WEBHOOK_HMAC_KEY?.trim();
  if (env && account.accountId === "default") {
    return env;
  }
  if (account.config.webhookHmacKeyFile) {
    try {
      return readFileSync(account.config.webhookHmacKeyFile, "utf-8").trim();
    } catch {
      // ignore
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
