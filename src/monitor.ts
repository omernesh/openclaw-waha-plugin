import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname, dirname } from "node:path";
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
import { getWahaGroupParticipants, getWahaContacts, toArr } from "./send.js";
import { listEnabledWahaAccounts } from "./accounts.js";
import { verifyWahaWebhookHmac } from "./signature.js";
import { normalizeResolvedSecretInputString } from "./secret-input.js";
import { isDuplicate } from "./dedup.js";
import { startHealthCheck, getHealthState, type HealthState } from "./health.js";
import { getSyncState, triggerImmediateSync, type SyncState } from "./sync.js";
import { InboundQueue, type QueueStats, type QueueItem } from "./inbound-queue.js";
import { isWhatsAppGroupJid, DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { CoreConfig, WahaInboundMessage, WahaReactionEvent, WahaWebhookEnvelope } from "./types.js";
import { getPairingEngine } from "./pairing.js";
import { getModuleRegistry } from "./module-registry.js";

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildAdminHtml(config: CoreConfig, account: ReturnType<typeof resolveWahaAccount>): string {
  const session = escapeHtml(account.config.session ?? "unknown");
  // DIR-01 / DIR-02 (12-05): Inject bot session IDs as a JS global so client can mark bot participants
  // and exclude them from the contacts list. Session IDs are server-controlled, not user input — safe for JSON.
  const botSessionIds = listEnabledWahaAccounts(config).map((a) => a.session);
  const botSessionIdsJson = JSON.stringify(botSessionIds);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="format-detection" content="telephone=no">
<title>WAHA Plugin Admin - ${session}</title>
<style>
  /* ---- CSS Custom Properties for Light/Dark Theme (Change 5) ---- */
  /* DO NOT REMOVE: All UI colors are defined as CSS variables. Dark mode is default. */
  /* .light-mode on body overrides to light palette. Toggle via theme button in header. */
  :root {
    --bg-primary: #0f172a;
    --bg-secondary: #1e293b;
    --bg-tertiary: #0f172a;
    --bg-hover: #1a2540;
    --border: #334155;
    --border-light: #334155;
    --text-primary: #e2e8f0;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --text-accent: #38bdf8;
    --text-mono: #7dd3fc;
    --nav-bg: #1e293b;
    --nav-border: #334155;
    --badge-bg: #1e3a5f;
    --badge-text: #7dd3fc;
    --stat-bg: #0f172a;
    --tag-bg: #0ea5e9;
    --toast-bg: #10b981;
    --success: #10b981;
    --error: #ef4444;
    --warning: #f59e0b;
    --info: #22d3ee;
    --btn-primary: #1d4ed8;
    --btn-primary-hover: #2563eb;
    --slider-bg: #334155;
    --shimmer-from: #1e293b;
    --shimmer-mid: #334155;
    --sub-header-color: #b0bec5;
    --sub-header-border: #333;
    --explainer-bg: #1a1f2e;
    --explainer-text: #78909c;
    --explainer-label: #90a4ae;
  }
  body.light-mode {
    --bg-primary: #f8fafc;
    --bg-secondary: #ffffff;
    --bg-tertiary: #f1f5f9;
    --bg-hover: #f1f5f9;
    --border: #e2e8f0;
    --border-light: #f1f5f9;
    --text-primary: #1e293b;
    --text-secondary: #64748b;
    --text-muted: #94a3b8;
    --text-accent: #0284c7;
    --text-mono: #0369a1;
    --nav-bg: #ffffff;
    --nav-border: #e2e8f0;
    --badge-bg: #dbeafe;
    --badge-text: #1d4ed8;
    --stat-bg: #f1f5f9;
    --tag-bg: #0284c7;
    --toast-bg: #059669;
    --success: #059669;
    --error: #dc2626;
    --warning: #d97706;
    --info: #0891b2;
    --btn-primary: #1d4ed8;
    --btn-primary-hover: #2563eb;
    --slider-bg: #cbd5e1;
    --shimmer-from: #e2e8f0;
    --shimmer-mid: #f1f5f9;
    --sub-header-color: #475569;
    --sub-header-border: #e2e8f0;
    --explainer-bg: #f1f5f9;
    --explainer-text: #64748b;
    --explainer-label: #475569;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: var(--bg-primary); color: var(--text-primary); min-height: 100vh; display: flex; flex-direction: column; }
  /* NAV */
  header { background: var(--nav-bg); padding: 0 24px; border-bottom: 1px solid var(--nav-border); display: flex; align-items: center; gap: 0; position: sticky; top: 0; z-index: 100; }
  header .brand { font-size: 1.1rem; font-weight: 700; color: var(--text-accent); padding: 14px 24px 14px 0; border-right: 1px solid var(--nav-border); margin-right: 4px; white-space: nowrap; }
  nav { display: flex; gap: 0; flex: 1; }
  nav button { background: none; border: none; color: var(--text-secondary); padding: 16px 20px; cursor: pointer; font-size: 0.9rem; border-bottom: 3px solid transparent; transition: color .15s, border-color .15s; white-space: nowrap; }
  nav button:hover { color: var(--text-primary); }
  nav button.active { color: var(--text-accent); border-bottom-color: var(--text-accent); }
  header .badge { background: var(--success); color: #fff; font-size: 0.72rem; padding: 2px 8px; border-radius: 9999px; margin-left: auto; }
  /* THEME TOGGLE (Change 5) -- DO NOT REMOVE: switches between dark/light mode */
  #theme-toggle { background: none; border: 1px solid var(--border); color: var(--text-secondary); font-size: 1.1rem; padding: 4px 8px; border-radius: 6px; cursor: pointer; margin-left: 10px; line-height: 1; transition: color .15s, border-color .15s; }
  #theme-toggle:hover { color: var(--text-primary); border-color: var(--text-accent); }
  /* CONTENT */
  .tab-content { display: none; flex: 1; }
  .tab-content.active { display: block; }
  main.tab-pane { max-width: 920px; margin: 0 auto; padding: 24px; display: grid; gap: 20px; }
  /* CARDS */
  /* BUG-08: overflow:visible prevents tooltip clipping by card container. DO NOT REVERT. */
  .card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 10px; padding: 20px; overflow: visible; }
  .card h2 { font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 16px; }
  .stat-row { display: flex; gap: 16px; flex-wrap: wrap; }
  .stat { background: var(--stat-bg); border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 120px; }
  .stat .label { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px; }
  .stat .value { font-size: 1.5rem; font-weight: 700; color: var(--text-accent); }
  .pattern-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .pattern { background: var(--tag-bg); color: #fff; font-size: 0.8rem; padding: 3px 10px; border-radius: 9999px; font-family: monospace; }
  .event-list { margin-top: 12px; font-size: 0.8rem; }
  .event { padding: 6px 10px; border-left: 3px solid var(--border); margin-bottom: 4px; border-radius: 0 4px 4px 0; background: var(--bg-tertiary); display: flex; gap: 8px; }
  .event.pass { border-color: var(--success); }
  .event.fail { border-color: #f87171; }
  .event .ts { color: var(--text-muted); min-width: 80px; }
  .event .reason { color: var(--text-secondary); min-width: 120px; }
  .event .preview { color: var(--text-primary); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kv { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; font-size: 0.85rem; }
  .kv .k { color: var(--text-muted); }
  .kv .v { color: var(--text-primary); font-family: monospace; }
  .tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag { background: var(--badge-bg); color: var(--badge-text); font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; font-family: monospace; }
  #last-refresh { color: var(--text-muted); font-size: 0.75rem; text-align: right; margin-top: 4px; }
  .refresh-btn { background: var(--btn-primary); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
  .refresh-btn:hover { background: var(--btn-primary-hover); }
  /* Phase 12, Plan 03 (UX-03 + UI-09): shared refresh button spinner + timestamp */
  .refresh-wrap { display:inline-flex; flex-direction:column; align-items:center; gap:2px; }
  .refresh-ts { font-size:0.7rem; color:var(--explainer-text); }
  @keyframes pulse-refresh { 0%,100%{opacity:1} 50%{opacity:0.5} }
  .refreshing { animation: pulse-refresh 1s ease-in-out infinite; pointer-events:none; }
  /* SETTINGS */
  .settings-section { margin-bottom: 8px; overflow: visible; }
  .settings-section summary { cursor: pointer; font-weight: 600; color: var(--text-secondary); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; padding: 10px 0; list-style: none; display: flex; align-items: center; gap: 8px; }
  .settings-section summary::before { content: '\\25B6'; font-size: 0.7rem; transition: transform .15s; }
  .settings-section[open] summary::before { transform: rotate(90deg); }
  .field-group { display: grid; gap: 12px; padding: 4px 0 16px 0; overflow: visible; }
  .field { display: grid; gap: 4px; }
  .field label { font-size: 0.82rem; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
  .field input[type=text], .field input[type=number], .field textarea, .field select {
    background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); border-radius: 6px;
    padding: 8px 10px; font-size: 0.88rem; width: 100%; font-family: inherit;
    transition: border-color .15s;
  }
  .field input:focus, .field textarea:focus, .field select:focus { outline: none; border-color: var(--text-accent); }
  .field input[readonly] { color: var(--text-muted); }
  .field textarea { resize: vertical; min-height: 70px; }
  .range-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  /* TOGGLE */
  .toggle-wrap { display: flex; align-items: center; gap: 10px; }
  .toggle { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
  .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
  .slider { position: absolute; inset: 0; background: var(--slider-bg); border-radius: 99px; cursor: pointer; transition: background .2s; }
  .slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .2s; }
  .toggle input:checked + .slider { background: var(--tag-bg); }
  .toggle input:checked + .slider::before { transform: translateX(18px); }
  /* TOOLTIP */
  /* Phase 12, Plan 03 (UI-06): z-index raised to 1000 so tooltips render above card containers. DO NOT LOWER. */
  .tip { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; background: var(--border); border-radius: 50%; font-size: 0.7rem; color: var(--text-secondary); cursor: help; flex-shrink: 0; }
  .tip::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: var(--badge-bg); color: var(--text-primary); font-size: 0.75rem; padding: 6px 10px; border-radius: 6px; width: 220px; pointer-events: none; opacity: 0; transition: opacity .15s; z-index: 1000; white-space: normal; line-height: 1.4; border: 1px solid var(--border); }
  .tip:hover::after { opacity: 1; }
  .save-btn { background: var(--success); color: #fff; border: none; padding: 10px 28px; border-radius: 8px; cursor: pointer; font-size: 0.95rem; font-weight: 600; margin-top: 8px; transition: background .15s; }
  .save-btn:hover { background: #059669; }
  /* TOAST */
  #toast { position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%) translateY(20px); background: var(--toast-bg); color: #fff; padding: 10px 24px; border-radius: 8px; font-size: 0.9rem; opacity: 0; transition: opacity .3s, transform .3s; pointer-events: none; z-index: 999; }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  #toast.error { background: var(--error); }
  /* DIRECTORY */
  .dir-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .dir-search { min-width: 200px; background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); border-radius: 6px; padding: 8px 12px; font-size: 0.88rem; }
  .dir-search:focus { outline: none; border-color: var(--text-accent); }
  .dir-stats { display: flex; gap: 16px; }
  .dir-stat { font-size: 0.8rem; color: var(--text-muted); }
  .dir-stat span { color: var(--text-accent); font-weight: 600; }
  .contact-list { display: grid; gap: 8px; }
  /* Phase 15 (TTL-01/TTL-04/TTL-05): TTL badge classes for time-limited access grants. DO NOT REMOVE. */
  .ttl-badge { display:inline-block; padding:2px 6px; border-radius:3px; font-size:0.7rem; font-weight:600; margin-left:6px; }
  .ttl-green { background:#064e3b; color:#6ee7b7; }
  .ttl-yellow { background:#713f12; color:#fde68a; }
  .ttl-red { background:#7f1d1d; color:#fca5a5; }
  .ttl-expired { background:#374151; color:#9ca3af; }
  .contact-card.expired-card { opacity:0.5; border-left:3px solid #4b5563 !important; }
  /* Phase 12, Plan 03 (UI-06): overflow changed from hidden to visible so .tip::after tooltips are not clipped. DO NOT REVERT. */
  .contact-card { background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 8px; overflow: visible; }
  .contact-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; transition: background .1s; }
  .contact-header:hover { background: var(--bg-hover); }
  .avatar { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1rem; flex-shrink: 0; }
  .contact-info { flex: 1; min-width: 0; }
  .contact-name { font-size: 0.9rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .contact-jid { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace; }
  .contact-meta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .badge-count { background: var(--badge-bg); color: var(--badge-text); font-size: 0.72rem; padding: 2px 8px; border-radius: 9999px; }
  /* DIR-02 (12-05): Bot session badge — shown on group participants that are the bot's own sessions. DO NOT REMOVE. */
  .bot-badge { background: #1565c0; color: #fff; font-size: 0.65rem; padding: 1px 6px; border-radius: 8px; display: inline-block; vertical-align: middle; }
  .contact-time { font-size: 0.75rem; color: var(--text-muted); }
  .settings-toggle-btn { background: var(--btn-primary); color: #fff; border: none; padding: 4px 12px; border-radius: 5px; cursor: pointer; font-size: 0.78rem; }
  /* BUG-08: overflow:visible so .tip::after tooltips are not clipped inside contact cards. DO NOT REVERT. */
  .contact-settings-panel { display: none; padding: 16px; border-top: 1px solid var(--border); background: var(--bg-hover); overflow: visible; }
  .contact-settings-panel.open { display: block; }
  .settings-fields { display: grid; gap: 10px; overflow: visible; }
  .settings-field { display: grid; gap: 4px; overflow: visible; }
  .settings-field label { font-size: 0.8rem; color: var(--text-secondary); }
  .settings-field select, .settings-field input[type=text] {
    background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); border-radius: 5px; padding: 6px 10px; font-size: 0.85rem; width: 100%;
  }
  .save-contact-btn { background: var(--success); color: #fff; border: none; padding: 6px 18px; border-radius: 5px; cursor: pointer; font-size: 0.82rem; font-weight: 600; margin-top: 6px; }
  .load-more-btn { background: var(--bg-secondary); color: var(--text-secondary); border: 1px solid var(--border); padding: 8px 24px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; margin-top: 12px; width: 100%; transition: background .1s; }
  .load-more-btn:hover { background: var(--border); }
  /* DIR TABS */
  .dir-tab { background: none; border: none; color: var(--text-secondary); padding: 10px 16px; cursor: pointer; font-size: 0.85rem; border-bottom: 2px solid transparent; transition: color .15s; }
  .dir-tab:hover { color: var(--text-primary); }
  .dir-tab.active { color: var(--text-accent); border-bottom-color: var(--text-accent); }
  /* DIR-01: Groups paginated table */
  .groups-table { width:100%; border-collapse:collapse; }
  .groups-table th, .groups-table td { padding:8px 12px; text-align:left; border-bottom:1px solid var(--border-light); }
  .groups-table th { color:var(--text-secondary); font-size:0.75rem; text-transform:uppercase; }
  .groups-table tr:hover { background:var(--bg-secondary); cursor:pointer; }
  .page-nav { display:flex; align-items:center; justify-content:center; gap:4px; padding:8px 0; }
  .page-size-select { background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border); border-radius:4px; padding:4px 8px; font-size:0.8rem; }
  /* DOCS */
  .docs-section { margin-bottom: 4px; }
  .docs-section summary { cursor: pointer; font-size: 1rem; font-weight: 600; color: var(--text-primary); padding: 12px 0; list-style: none; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); }
  .docs-section summary::before { content: '\\25B6'; font-size: 0.7rem; transition: transform .15s; color: var(--text-muted); }
  .docs-section[open] summary::before { transform: rotate(90deg); }
  .docs-body { padding: 14px 0; color: var(--text-secondary); font-size: 0.88rem; line-height: 1.6; }
  .docs-body p { margin-bottom: 10px; }
  .docs-body code { background: var(--bg-tertiary); color: var(--text-accent); padding: 1px 6px; border-radius: 4px; font-family: monospace; font-size: 0.85rem; }
  .docs-body ul { margin-left: 20px; margin-bottom: 10px; }
  .docs-body li { margin-bottom: 4px; }
  /* FOOTER */
  footer { background: var(--nav-bg); border-top: 1px solid var(--border); padding: 12px 24px; text-align: center; font-size: 0.8rem; color: var(--text-muted); margin-top: auto; }
  footer a { color: var(--text-accent); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
  .log-level-btn { padding:4px 10px; border-radius:5px; border:1px solid var(--border); cursor:pointer; font-size:0.75rem; background:var(--border); color:var(--text-secondary); transition: background .1s; }
  .log-level-btn.active { background:#3b82f6; color:#fff; }
  .log-entry { display:flex; gap:8px; padding:3px 0; border-bottom:1px solid var(--border-light); font-family:monospace; font-size:0.78rem; }
  .log-entry:last-child { border-bottom:none; }
  .log-ts { color:var(--text-muted); flex-shrink:0; width:130px; }
  .log-level { flex-shrink:0; width:50px; font-weight:600; text-transform:uppercase; }
  .log-level-error { color:var(--error); }
  .log-level-warn { color:var(--warning); }
  .log-level-info { color:var(--info); }
  .log-level-debug { color:var(--text-secondary); }
  .log-msg { color:var(--text-primary); white-space:pre-wrap; word-break:break-all; flex:1; }
  @media (max-width: 640px) {
    main.tab-pane { padding: 16px; }
    nav button { padding: 14px 12px; font-size: 0.8rem; }
    .range-pair { grid-template-columns: 1fr; }
  }
  /* NAME RESOLVER (Phase 8, UI-01) -- DO NOT CHANGE: shimmer + avatar + JID display for resolved contacts */
  @keyframes nr-shimmer { 0% { background-position: -200px 0; } 100% { background-position: calc(200px + 100%) 0; } }
  .nr-wrap { display: inline-flex; align-items: center; gap: 8px; }
  .nr-avatar { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1rem; flex-shrink: 0; color: #fff; }
  .nr-info { display: flex; flex-direction: column; gap: 2px; }
  .nr-name { color: var(--text-primary); font-size: 0.88rem; }
  .nr-jid { color: var(--text-muted); font-family: monospace; font-size: 0.75rem; }
  .nr-skeleton { display: inline-block; width: 80px; height: 14px; background: linear-gradient(90deg, var(--shimmer-from) 25%, var(--shimmer-mid) 50%, var(--shimmer-from) 75%); background-size: 400px 100%; animation: nr-shimmer 1.2s ease-in-out infinite; border-radius: 4px; }
  /* TAG INPUT (Phase 8, UI-02) -- DO NOT CHANGE: pill bubble input replacing JID-list textareas */
  .ti-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 6px; padding: 8px; min-height: 42px; cursor: text; }
  .ti-wrap.ti-focused { border-color: var(--text-accent); }
  .ti-tag { background: var(--tag-bg); color: #fff; font-size: 0.8rem; padding: 3px 10px; border-radius: 9999px; font-family: monospace; display: inline-flex; align-items: center; gap: 4px; }
  .ti-tag .ti-remove { cursor: pointer; color: rgba(255,255,255,0.7); font-size: 0.9rem; line-height: 1; padding: 0 2px; }
  .ti-tag .ti-remove:hover { color: #fff; }
  .ti-input { background: none; border: none; color: var(--text-primary); font-size: 0.88rem; font-family: system-ui, sans-serif; outline: none; flex: 1; min-width: 120px; }
  .ti-input::placeholder { color: var(--text-muted); }
  /* CONTACT PICKER (Phase 8, UI-03) -- DO NOT CHANGE: searchable contact selector with multi-select */
  .cp-wrap { position: relative; }
  .cp-selected { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .cp-chip { background: var(--badge-bg); color: var(--badge-text); font-size: 0.75rem; padding: 4px 12px; border-radius: 4px; font-family: monospace; display: inline-flex; align-items: center; gap: 6px; }
  .cp-chip .cp-chip-remove { cursor: pointer; color: var(--badge-text); font-size: 0.85rem; line-height: 1; padding: 0 2px; }
  .cp-chip .cp-chip-remove:hover { color: var(--error); }
  .cp-search { width: 100%; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; color: var(--text-primary); font-size: 0.88rem; font-family: system-ui, sans-serif; outline: none; box-sizing: border-box; }
  .cp-search:focus { border-color: var(--text-accent); }
  .cp-search::placeholder { color: var(--text-muted); }
  .cp-dropdown { position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.4); max-height: 240px; overflow-y: auto; z-index: 300; display: none; }
  .cp-dropdown.cp-open { display: block; }
  .cp-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; transition: background .1s; }
  .cp-row:hover { background: var(--bg-tertiary); }
  .cp-row .cp-av { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8rem; flex-shrink: 0; color: #fff; }
  .cp-row .cp-row-info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
  .cp-row .cp-row-name { color: var(--text-primary); font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-row .cp-row-jid { color: var(--text-muted); font-family: monospace; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-row .cp-check { color: var(--success); font-size: 0.85rem; flex-shrink: 0; width: 20px; text-align: center; }
  .cp-empty { color: var(--text-muted); text-align: center; padding: 16px; font-size: 0.85rem; }
  .cp-loading { padding: 10px 12px; }
  /* SESSION ROW (Phase 11, Plan 01 - DASH-01) -- DO NOT CHANGE: compact multi-session row in Dashboard card */
  .session-row { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-light); font-size:0.82rem; }
  .session-row:last-child { border-bottom:none; }
  /* SESSION-SUB-HEADER (12-01, DASH-04) -- per-session name header inside stat cards */
  .session-sub-header { font-weight:600; font-size:0.85rem; margin:8px 0 4px; color:var(--sub-header-color); border-bottom:1px solid var(--sub-header-border); padding-bottom:2px; }
  /* SESSION-HEALTH-DETAIL (12-01, DASH-01) -- health detail rows inside session rows */
  .session-health-detail { font-size:0.75rem; color:var(--text-muted); padding:2px 0 2px 16px; }
  /* ACCESS CONTROL SECTIONS (Change 1) -- stacked vertically below kv grid. DO NOT CHANGE. */
  .access-sections { display:block; margin-top:12px; }
  .access-section { margin-bottom:12px; }
  .access-section-header { font-size:0.82rem; color:var(--text-secondary); font-weight:600; padding:6px 0; display:flex; align-items:center; gap:6px; }
  .access-section-count { background:var(--badge-bg); color:var(--badge-text); font-size:0.72rem; padding:1px 7px; border-radius:9999px; }
  /* ACCESS CONTROL PAGINATION (Change 4) -- proper page-number pagination. DO NOT CHANGE. */
  .ac-page-nav { display:flex; align-items:center; justify-content:center; gap:2px; padding:6px 0; font-size:0.78rem; }
  .ac-page-btn { background:var(--border); color:var(--text-primary); border:none; padding:3px 8px; border-radius:4px; cursor:pointer; font-size:0.75rem; min-width:28px; }
  .ac-page-btn:disabled { opacity:0.4; cursor:default; }
  .ac-page-btn.ac-current { background:var(--tag-bg); color:#fff; font-weight:bold; }
</style>
</head>
<body>
<header>
  <div class="brand">WAHA-OC Admin Panel</div>
  <nav>
    <button class="active" onclick="switchTab('dashboard', this)" id="tab-dashboard">Dashboard</button>
    <button onclick="switchTab('settings', this)" id="tab-settings">Settings</button>
    <button onclick="switchTab('directory', this)" id="tab-directory">Directory</button>
    <button onclick="switchTab('queue', this)" id="tab-queue">Queue</button>
    <button onclick="switchTab('sessions', this)" id="tab-sessions">Sessions</button>
    <button onclick="switchTab('modules', this)" id="tab-modules">Modules</button>
    <button onclick="switchTab('logs', this)" id="tab-logs">Log</button>
  </nav>
  <span class="badge" id="status-badge">Loading...</span>
  <button id="theme-toggle" onclick="toggleTheme()" title="Toggle light/dark mode">☀</button>
</header>

<!-- TOAST -->
<div id="toast"></div>

<!-- DIR-04: Bulk action toolbar — fixed at bottom, shown only when bulk items are selected -->
<div id="bulk-toolbar" style="display:none;position:fixed;bottom:0;left:0;right:0;background:var(--bg-primary);border-top:2px solid var(--btn-primary);padding:12px 24px;z-index:1000;align-items:center;gap:16px;">
  <span id="bulk-count" style="color:var(--text-secondary);font-size:0.88rem;font-weight:600;"></span>
  <div id="bulk-actions" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
</div>

<!-- TAB: DASHBOARD -->
<div class="tab-content active" id="content-dashboard">
<main class="tab-pane">
  <!-- 12-01, DASH-02: DM Keyword Filter card is collapsible via details/summary. DO NOT remove open attr (expanded by default). -->
  <div class="card" id="dm-filter-card">
    <details class="settings-section" open>
      <summary>DM Keyword Filter</summary>
      <div class="stat-row" id="filter-stats"></div>
      <div id="filter-patterns" style="margin-top:12px;"></div>
      <div class="event-list" id="filter-events"></div>
    </details>
  </div>
  <!-- 12-01, DASH-02: Group Keyword Filter card is collapsible via details/summary. DO NOT remove open attr (expanded by default). -->
  <div class="card" id="group-filter-card">
    <details class="settings-section" open>
      <summary>Group Keyword Filter</summary>
      <div class="stat-row" id="group-filter-stats"></div>
      <div id="group-filter-patterns" style="margin-top:12px;"></div>
      <div class="event-list" id="group-filter-events"></div>
    </details>
  </div>
  <div class="card" id="presence-card">
    <h2>Presence System</h2>
    <div class="kv" id="presence-kv"></div>
  </div>
  <div class="card" id="access-card">
    <h2>Access Control</h2>
    <div class="kv" id="access-kv"></div>
    <div class="access-sections" id="access-sections"></div>
  </div>
  <div class="card" id="session-card">
    <h2>Sessions <span id="health-dot" style="display:inline-block;width:12px;height:12px;border-radius:50%;margin-left:8px;vertical-align:middle;background:var(--text-secondary);" title="Loading..."></span></h2>
    <!-- Phase 11, Plan 01 (DASH-01): multi-session rows rendered by loadDashboardSessions(). DO NOT REMOVE. -->
    <div id="dashboard-sessions" style="margin-bottom:12px;"></div>
    <div class="kv" id="session-kv"></div>
    <div class="kv" id="health-kv" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;"></div>
    <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;align-items:center;">
      <div id="last-refresh"></div>
      <button class="refresh-btn" id="refresh-dashboard" onclick="_accessKvBuilt=false;loadStats()">Refresh</button>
    </div>
  </div>
</main>
</div>

<!-- TAB: SETTINGS -->
<div class="tab-content" id="content-settings">
<main class="tab-pane">
<div class="card">
  <h2>Plugin Settings</h2>
  <form id="settings-form" onsubmit="saveSettings(event)">

    <details class="settings-section" open>
      <summary>Connection</summary>
      <div class="field-group">
        <div class="field">
          <label>Base URL <span class="tip" data-tip="WAHA server URL. Must be accessible from this host. Example: http://127.0.0.1:3004">?</span></label>
          <input type="text" id="s-baseUrl" name="baseUrl" placeholder="http://127.0.0.1:3004">
        </div>
        <div class="field">
          <label>Active WAHA Session <span class="tip" data-tip="WAHA session name. Select from sessions available on your WAHA server.">?</span></label>
          <select id="s-session" name="session">
            <option value="" disabled>Loading sessions...</option>
          </select>
        </div>
        <div class="field">
          <label>Webhook Port <span class="tip" data-tip="Port the webhook HTTP server listens on. Default: 8050. Restart required after change.">?</span></label>
          <input type="number" id="s-webhookPort" name="webhookPort" min="1" max="65535">
        </div>
        <div class="field">
          <label>Webhook Path <span class="tip" data-tip="URL path WAHA sends events to. Default: /webhook/waha">?</span></label>
          <input type="text" id="s-webhookPath" name="webhookPath" placeholder="/webhook/waha">
        </div>
      </div>
    </details>

    <details class="settings-section">
      <summary>Trigger Operator</summary>
      <div class="field-group">
        <div class="field">
          <label>Trigger Word <span class="tip" data-tip="Prefix that activates the bot (e.g. '!' or '!bot'). Messages must start with this to pass through filters. Used for human sessions where all messages are filtered by default. Leave empty to disable trigger-based filtering.">?</span></label>
          <input type="text" id="s-triggerWord" name="triggerWord" placeholder="!" style="max-width:200px">
        </div>
        <div class="field">
          <label>Trigger Response Mode <span class="tip" data-tip="Where the bot responds when triggered in a group. 'dm' = respond via DM to the sender. 'reply-in-chat' = respond in the same group. For DM triggers, the bot always responds in the same DM.">?</span></label>
          <select id="s-triggerResponseMode" name="triggerResponseMode">
            <option value="dm">dm</option>
            <option value="reply-in-chat">reply-in-chat</option>
          </select>
        </div>
      </div>
    </details>

    <details class="settings-section" open>
      <summary>Access Control</summary>
      <div class="field-group">
        <div class="field">
          <label>DM Policy <span class="tip" data-tip="How to handle DMs from unknown senders. open: accept all. closed: block all. allowlist: only contacts in Allow From list.">?</span></label>
          <select id="s-dmPolicy" name="dmPolicy">
            <!-- Phase 12, Plan 02 (UI-08): pairing option removed — no longer supported. Auto-migrated to allowlist on load. DO NOT ADD BACK. -->
            <option value="open">open</option>
            <option value="closed">closed</option>
            <option value="allowlist">allowlist</option>
          </select>
        </div>
        <div class="field">
          <label>Group Policy <span class="tip" data-tip="How to handle group messages. allowlist=only allowedGroups, open=all groups, closed=no groups.">?</span></label>
          <select id="s-groupPolicy" name="groupPolicy">
            <option value="allowlist">allowlist</option>
            <option value="open">open</option>
            <option value="closed">closed</option>
          </select>
        </div>
        <div class="field">
          <label>Allow From (DMs) <span class="tip" data-tip="JIDs allowed to send DMs. Press Enter or comma to add. Supports @c.us and @lid formats. Example: 972544329000@c.us">?</span></label>
          <div id="s-allowFrom-ti"></div>
        </div>
        <div class="field">
          <label>Group Allow From <span class="tip" data-tip="JIDs allowed to trigger the bot in groups. Press Enter or comma to add. Include both @c.us and @lid for the same person (NOWEB sends @lid).">?</span></label>
          <div id="s-groupAllowFrom-ti"></div>
        </div>
        <div class="field">
          <label>Allowed Groups <span class="tip" data-tip="Group JIDs the bot will respond in. Press Enter or comma to add. Leave empty to allow all groups (with open policy).">?</span></label>
          <div id="s-allowedGroups-ti"></div>
        </div>
        <div class="field">
          <!-- Phase 12, Plan 02 (INIT-01): Global Can Initiate toggle. Default on. DO NOT REMOVE. -->
          <label class="toggle-wrap">
            <span>Can Initiate (Global Default) <span class="tip" data-tip="When enabled, the bot can start new conversations with any contact. When disabled, the bot can only respond to incoming messages unless a per-contact override allows initiation.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="canInitiateGlobal" name="canInitiateGlobal" checked><span class="slider"></span></label>
          </label>
        </div>
      </div>
    </details>

    <details class="settings-section">
      <summary>Pairing Mode</summary>
      <div class="field-group">
        <div class="field">
          <label class="toggle-wrap">
            <span>Enable Pairing Mode <span class="tip" data-tip="When enabled, unknown DM senders can enter a passcode to get added to the allow list automatically.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="pairingEnabled" name="pairingEnabled"><span class="slider"></span></label>
          </label>
        </div>
        <div id="pairingFields" style="display:none">
          <div class="field">
            <label>Passcode (6 digits) <span class="tip" data-tip="The 6-digit code contacts must enter to get DM access. Click Generate to create a random one.">?</span></label>
            <div style="display:flex;gap:8px">
              <input type="text" id="pairingPasscode" name="pairingPasscode" maxlength="6" pattern="[0-9]{6}" placeholder="123456" style="flex:1;font-family:monospace;font-size:1.1em;letter-spacing:2px">
              <button type="button" id="generatePasscode" class="btn btn-sm">Generate</button>
            </div>
          </div>
          <div class="field">
            <label>Grant TTL <span class="tip" data-tip="How long pairing-granted access lasts. After this period, access is automatically revoked.">?</span></label>
            <select id="pairingGrantTtl" name="pairingGrantTtl">
              <option value="60">1 hour</option>
              <option value="360">6 hours</option>
              <option value="1440" selected>24 hours</option>
              <option value="10080">7 days</option>
              <option value="43200">30 days</option>
              <option value="0">Never expires</option>
            </select>
          </div>
          <div class="field">
            <label>Challenge Message <span class="tip" data-tip="The message sent to unknown DMs asking them to enter the passcode.">?</span></label>
            <textarea id="pairingChallengeMsg" name="pairingChallengeMsg" rows="2" style="width:100%"></textarea>
          </div>
          <div class="field">
            <label>wa.me Deep Link <span class="tip" data-tip="Share this link to let a specific contact start a pairing flow. Enter their JID below to generate.">?</span></label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="text" id="pairingDeepLinkJid" placeholder="972544329000@c.us" style="flex:1">
              <button type="button" id="generateDeepLink" class="btn btn-sm">Generate</button>
            </div>
            <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
              <input type="text" id="pairingDeepLink" readonly style="flex:1;font-family:monospace;font-size:0.85em;background:var(--bg-tertiary);border-color:var(--border)">
              <button type="button" id="copyDeepLink" class="btn btn-sm">Copy</button>
            </div>
            <small style="color:#666">Share this link for zero-friction authorization (JID-specific HMAC token)</small>
          </div>
        </div>
      </div>
    </details>

    <details class="settings-section">
      <summary>Auto-Reply</summary>
      <div class="field-group">
        <div class="field">
          <label class="toggle-wrap">
            <span>Send rejection message to unauthorized DMs <span class="tip" data-tip="When enabled, contacts whose DMs are blocked will receive an automatic reply explaining they are not authorized.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="autoReplyEnabled" name="autoReplyEnabled"><span class="slider"></span></label>
          </label>
        </div>
        <div id="autoReplyFields" style="display:none">
          <div class="field">
            <label>Rejection Message <span class="tip" data-tip="Message sent to blocked DMs. Use {admin_name} to insert the bot owner's name.">?</span></label>
            <textarea id="autoReplyMessage" name="autoReplyMessage" rows="3" style="width:100%"></textarea>
            <small style="color:#666">Template variables: {admin_name}</small>
          </div>
          <div class="field">
            <label>Rate Limit <span class="tip" data-tip="Minimum minutes between auto-replies to the same contact to prevent spam.">?</span></label>
            <select id="autoReplyInterval" name="autoReplyInterval">
              <option value="60">1 hour</option>
              <option value="360">6 hours</option>
              <option value="1440" selected>24 hours</option>
              <option value="10080">7 days</option>
            </select>
          </div>
        </div>
      </div>
    </details>

    <details class="settings-section">
      <summary>DM Keyword Filter</summary>
      <div class="field-group">
        <div class="field">
          <label class="toggle-wrap">
            <span>Enabled <span class="tip" data-tip="When on, DMs must contain at least one mention pattern to get a response. Reduces noise and token usage.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-dmFilterEnabled" name="dmFilterEnabled"><span class="slider"></span></label>
          </label>
        </div>
        <div class="field">
          <label>Mention Patterns <span class="tip" data-tip="Regex patterns (case-insensitive). DMs must match at least one. Press Enter or comma to add each pattern.">?</span></label>
          <div id="dm-mention-patterns"></div>
        </div>
        <div class="field">
          <label class="toggle-wrap">
            <span>God Mode Bypass <span class="tip" data-tip="When on, super-users bypass the keyword filter entirely (their messages always get a response).">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-godModeBypass" name="godModeBypass"><span class="slider"></span></label>
          </label>
        </div>
        <div class="field">
          <label>God Mode Scope <span class="tip" data-tip="Controls which filters god mode bypass applies to. 'All' = bypass both DM and group filters (default for bot sessions). 'DM Only' = bypass DM filter only, NOT group filter (recommended for human sessions). 'Off' = never bypass.">?</span></label>
          <select id="s-godModeScope" name="godModeScope">
            <option value="all">All (DM + Groups)</option>
            <option value="dm">DM Only</option>
            <option value="off">Off</option>
          </select>
        </div>
        <div class="field">
          <label>Token Estimate <span class="tip" data-tip="Estimated tokens saved per dropped DM. Used for stats display only. Default: 2500.">?</span></label>
          <input type="number" id="s-tokenEstimate" name="tokenEstimate" min="100" max="100000" step="100">
        </div>
        <div class="field">
          <label>God Mode Users <span class="tip" data-tip="JIDs that bypass the DM keyword filter entirely. Search and select contacts. Include both @c.us and @lid formats for NOWEB compatibility.">?</span></label>
          <div id="s-godModeSuperUsers-cp"></div>
        </div>
      </div>
    </details>

    <details class="settings-section">
      <summary>Group Keyword Filter</summary>
      <div class="field-group">
        <div class="field">
          <label class="toggle-wrap">
            <span>Enabled <span class="tip" data-tip="When on, group messages must contain at least one mention pattern to get a response. Works the same as DM Keyword Filter but for group messages. Saves tokens by filtering irrelevant group chatter.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-groupFilterEnabled" name="groupFilterEnabled"><span class="slider"></span></label>
          </label>
        </div>
        <div class="field">
          <label>Mention Patterns <span class="tip" data-tip="Regex patterns (case-insensitive). Group messages must match at least one. Press Enter or comma to add each pattern.">?</span></label>
          <div id="group-mention-patterns"></div>
        </div>
        <div class="field">
          <label class="toggle-wrap">
            <span>God Mode Bypass <span class="tip" data-tip="When on, super-users bypass the group keyword filter entirely.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-groupGodModeBypass" name="groupGodModeBypass"><span class="slider"></span></label>
          </label>
        </div>
        <div class="field">
          <label>God Mode Scope <span class="tip" data-tip="Controls which filters god mode bypass applies to. 'All' = bypass both DM and group filters. 'DM Only' = bypass DM filter only, NOT group filter. 'Off' = never bypass. Typically set the same as the DM filter scope.">?</span></label>
          <select id="s-groupGodModeScope" name="groupGodModeScope">
            <option value="all">All (DM + Groups)</option>
            <option value="dm">DM Only</option>
            <option value="off">Off</option>
          </select>
        </div>
        <div class="field">
          <label>Token Estimate <span class="tip" data-tip="Estimated tokens saved per dropped group message. Default: 2500.">?</span></label>
          <input type="number" id="s-groupTokenEstimate" name="groupTokenEstimate" min="100" max="100000" step="100">
        </div>
        <div class="field">
          <label>God Mode Users <span class="tip" data-tip="JIDs that bypass the group keyword filter entirely. Search and select contacts. Supports @c.us and @lid formats.">?</span></label>
          <div id="s-groupGodModeSuperUsers-cp"></div>
        </div>
      </div>
    </details>

    <details class="settings-section">
      <summary>Presence (Human Mimicry)</summary>
      <div class="field-group">
        <div class="field">
          <label class="toggle-wrap">
            <span>Enabled <span class="tip" data-tip="Simulate human typing: read delays, typing indicators, pause breaks. Makes responses feel natural.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-presenceEnabled" name="presenceEnabled"><span class="slider"></span></label>
          </label>
        </div>
<div class="field">          <label class="toggle-wrap">            <span>Send Seen <span class="tip" data-tip="Send read receipts (blue ticks) when reading incoming messages. Shows the sender that the bot has seen their message.">?</span></span>            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-sendSeen" name="sendSeen"><span class="slider"></span></label>          </label>        </div>
        <div class="field">
          <label>Words Per Minute <span class="tip" data-tip="Typing speed for calculating typing duration. Default: 42. Range: 20-120.">?</span></label>
          <input type="number" id="s-wpm" name="wpm" min="10" max="200">
        </div>
        <div class="field">
          <label>Read Delay (ms) <span class="tip" data-tip="Simulated message reading time range [min, max] before starting to type. Default: [500, 4000].">?</span></label>
          <div class="range-pair">
            <input type="number" id="s-readDelayMin" name="readDelayMin" placeholder="min">
            <input type="number" id="s-readDelayMax" name="readDelayMax" placeholder="max">
          </div>
        </div>
        <div class="field">
          <label>ms Per Read Char <span class="tip" data-tip="Extra read delay per character in the message. Longer messages = longer read time. Default: 30.">?</span></label>
          <input type="number" id="s-msPerReadChar" name="msPerReadChar" min="0" max="500">
        </div>
        <div class="field">
          <label>Typing Duration (ms) <span class="tip" data-tip="Min/max clamp for typing indicator duration. Actual duration is derived from WPM + message length. Default: [1500, 15000].">?</span></label>
          <div class="range-pair">
            <input type="number" id="s-typingMin" name="typingMin" placeholder="min">
            <input type="number" id="s-typingMax" name="typingMax" placeholder="max">
          </div>
        </div>
        <div class="field">
          <label>Pause Chance <span class="tip" data-tip="Probability of a mid-typing pause (0.0 = never, 1.0 = always). Default: 0.3 (30% chance).">?</span></label>
          <input type="number" id="s-pauseChance" name="pauseChance" min="0" max="1" step="0.1">
        </div>
        <div class="field">
          <label>Pause Duration (ms) <span class="tip" data-tip="Duration of a typing pause [min, max]. Default: [500, 2000].">?</span></label>
          <div class="range-pair">
            <input type="number" id="s-pauseDurMin" name="pauseDurMin" placeholder="min">
            <input type="number" id="s-pauseDurMax" name="pauseDurMax" placeholder="max">
          </div>
        </div>
        <div class="field">
          <label>Pause Interval (ms) <span class="tip" data-tip="How often pauses can occur [min, max interval]. Default: [2000, 5000].">?</span></label>
          <div class="range-pair">
            <input type="number" id="s-pauseIntMin" name="pauseIntMin" placeholder="min">
            <input type="number" id="s-pauseIntMax" name="pauseIntMax" placeholder="max">
          </div>
        </div>
        <div class="field">
          <label>Jitter [min, max] <span class="tip" data-tip="Random timing multiplier range. 1.0 = no jitter. Default: [0.7, 1.3] = ±30% variation.">?</span></label>
          <div class="range-pair">
            <input type="number" id="s-jitterMin" name="jitterMin" step="0.1" placeholder="min">
            <input type="number" id="s-jitterMax" name="jitterMax" step="0.1" placeholder="max">
          </div>
        </div>
      </div>
    </details>

    <details class="settings-section">
      <summary>Markdown</summary>
      <div class="field-group">
        <div class="field">
          <label class="toggle-wrap">
            <span>Markdown Enabled <span class="tip" data-tip="Process markdown in outbound messages (bold, italic, code). WhatsApp uses its own formatting syntax.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-markdownEnabled" name="markdownEnabled"><span class="slider"></span></label>
          </label>
        </div>
        <div class="field">
          <label>Tables Mode <span class="tip" data-tip="How to render markdown tables. auto=detect client capability, markdown=always markdown, text=always plain text.">?</span></label>
          <select id="s-markdownTables" name="markdownTables">
            <option value="auto">auto</option>
            <option value="markdown">markdown</option>
            <option value="text">text</option>
          </select>
        </div>
      </div>
    </details>

    <details class="settings-section">
      <summary>Features</summary>
      <div class="field-group">
        <div class="field">
          <label class="toggle-wrap">
            <span>Reactions <span class="tip" data-tip="Enable emoji reaction support. When on, the bot can receive and process message reactions.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-reactions" name="reactions"><span class="slider"></span></label>
          </label>
        </div>
        <div class="field">
          <label class="toggle-wrap">
            <span>Block Streaming <span class="tip" data-tip="Send responses as a single message instead of streaming chunks. Reduces message spam for long responses.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-blockStreaming" name="blockStreaming"><span class="slider"></span></label>
          </label>
        </div>
      </div>
    </details>

    <details class="settings-section">
      <summary>Media Preprocessing</summary>
      <div class="field-group">
        <div class="field">
          <label class="toggle-wrap">
            <span>Media Preprocessing <span class="tip" data-tip="Master toggle. When enabled, inbound media messages (audio, images, video, documents, locations, vCards) are preprocessed before being sent to the AI.">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-mediaEnabled" name="mediaEnabled" onchange="toggleMediaSubToggles()"><span class="slider"></span></label>
          </label>
        </div>
        <div id="media-sub-toggles" style="display:none;padding-left:16px;border-left:2px solid var(--border);gap:10px;">
          <div class="field">
            <label class="toggle-wrap">
              <span>Audio Transcription <span class="tip" data-tip="Transcribe voice messages to text using Whisper before sending to AI.">?</span></span>
              <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-audioTranscription" name="audioTranscription"><span class="slider"></span></label>
            </label>
          </div>
          <div class="field">
            <label class="toggle-wrap">
              <span>Image Analysis <span class="tip" data-tip="Analyze image content and generate descriptions before sending to AI.">?</span></span>
              <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-imageAnalysis" name="imageAnalysis"><span class="slider"></span></label>
            </label>
          </div>
          <div class="field">
            <label class="toggle-wrap">
              <span>Video Analysis <span class="tip" data-tip="Analyze video content (extracts key frames) before sending to AI.">?</span></span>
              <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-videoAnalysis" name="videoAnalysis"><span class="slider"></span></label>
            </label>
          </div>
          <div class="field">
            <label class="toggle-wrap">
              <span>Location Resolution <span class="tip" data-tip="Resolve GPS coordinates to human-readable addresses via OpenStreetMap Nominatim.">?</span></span>
              <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-locationResolution" name="locationResolution"><span class="slider"></span></label>
            </label>
          </div>
          <div class="field">
            <label class="toggle-wrap">
              <span>vCard Parsing <span class="tip" data-tip="Parse vCard contact attachments and extract contact info as structured text.">?</span></span>
              <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-vcardParsing" name="vcardParsing"><span class="slider"></span></label>
            </label>
          </div>
          <div class="field">
            <label class="toggle-wrap">
              <span>Document Analysis <span class="tip" data-tip="Extract text content from PDF and document attachments before sending to AI.">?</span></span>
              <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-documentAnalysis" name="documentAnalysis"><span class="slider"></span></label>
            </label>
          </div>
        </div>
        <div class="field" style="margin-top:4px;">
          <label style="color:var(--text-muted);font-size:0.82rem;">Poll Handling &nbsp;<span style="background:#10b981;color:#fff;font-size:0.72rem;padding:2px 8px;border-radius:9999px;">Automatic (built-in)</span></label>
        </div>
        <div class="field">
          <label style="color:var(--text-muted);font-size:0.82rem;">Event Handling &nbsp;<span style="background:#10b981;color:#fff;font-size:0.72rem;padding:2px 8px;border-radius:9999px;">Automatic (built-in)</span></label>
        </div>
      </div>
    </details>

    <div style="padding-top:8px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">
      <button type="submit" class="save-btn">Save Settings</button>
      <button type="button" class="save-btn" style="background:#f59e0b;" onclick="saveAndRestart()">Save &amp; Restart</button>
      <div id="save-note" style="font-size:0.78rem;color:var(--text-muted);margin-top:6px;display:none;width:100%;">Some settings require a gateway restart to take effect.</div>
    </div>
  </form>
<!-- Multi-Session Filtering Guide — collapsible reference for admin panel users -->  <details class="settings-section" style="margin-top:20px;border-top:1px solid var(--border);padding-top:12px;">    <summary style="color:var(--text-accent);">Multi-Session Filtering Guide</summary>    <div style="font-size:0.82rem;color:var(--text-primary);line-height:1.7;padding:8px 0 16px 0;">      <p style="color:var(--text-secondary);margin-bottom:12px;font-style:italic;">How messages flow through the guardrails:</p>      <ol style="padding-left:20px;margin-bottom:16px;display:grid;gap:4px;">        <li><strong style="color:var(--text-primary);">Group allowlist</strong> — Is this group allowed? If not → dropped (zero tokens)</li>        <li><strong style="color:var(--text-primary);">Sender allowlist</strong> — Is this sender allowed? If not → dropped</li>        <li><strong style="color:var(--text-primary);">Cross-session dedup</strong> — Bot session claims first (200ms priority). If bot already claimed → human session drops the duplicate</li>        <li><strong style="color:var(--text-primary);">Trigger prefix</strong> — Does the message start with the trigger operator (e.g., "!")? If required and missing → dropped</li>        <li><strong style="color:var(--text-primary);">Keyword filter</strong> — Does the message match a keyword pattern? If not → dropped</li>        <li><strong style="color:var(--success);">Only then</strong> → Bot processes the message</li>      </ol>      <p style="color:var(--text-secondary);font-weight:600;margin-bottom:8px;text-transform:uppercase;font-size:0.78rem;letter-spacing:0.06em;">Scenarios</p>      <div style="background:var(--bg-tertiary);border-radius:8px;padding:12px 14px;margin-bottom:10px;">        <p style="color:var(--text-accent);font-weight:600;margin-bottom:6px;">Bot + Human session in same group</p>        <ul style="padding-left:16px;display:grid;gap:3px;">          <li>Normal message from anyone → Bot session handles it, human session drops the dupe</li>          <li>"hey bot, what's the weather?" → Bot session handles (keyword match), human drops dupe</li>          <li>"!what's the weather?" → Bot session handles (trigger match), human drops dupe</li>          <li>Your message to a friend (no keyword) → Filtered on both sessions. God mode only bypasses DM filter, not group filter. The bot stays quiet.</li>        </ul>      </div>      <div style="background:var(--bg-tertiary);border-radius:8px;padding:12px 14px;margin-bottom:10px;">        <p style="color:var(--text-accent);font-weight:600;margin-bottom:6px;">Only human session in group (bot not a member)</p>        <ul style="padding-left:16px;display:grid;gap:3px;">          <li>Normal message → Filtered (no keyword/trigger match). The bot stays quiet.</li>          <li>"!what's the weather?" → Trigger activates on human session. The bot responds with 🤖 prefix via your session.</li>          <li>Your message (superuser, no keyword) → Filtered. God mode scope is "dm" so groups still require keyword/trigger.</li>        </ul>      </div>      <div style="background:var(--bg-tertiary);border-radius:8px;padding:12px 14px;margin-bottom:10px;">        <p style="color:var(--text-accent);font-weight:600;margin-bottom:6px;">DMs</p>        <ul style="padding-left:16px;display:grid;gap:3px;">          <li>You (superuser) DM the bot → God mode bypasses DM filter. The bot responds normally.</li>          <li>Someone else DMs → Must match keyword pattern or trigger prefix to reach the bot.</li>        </ul>      </div>      <div style="background:var(--bg-tertiary);border-radius:8px;padding:12px 14px;margin-bottom:10px;">        <p style="color:var(--text-accent);font-weight:600;margin-bottom:6px;">Bot prefix</p>        <p>When the bot responds through a human session (cross-session routing), messages are prefixed with 🤖 so recipients know it's the bot, not you.</p>      </div>      <div style="background:var(--bg-tertiary);border-radius:8px;padding:12px 14px;margin-bottom:10px;">        <p style="color:var(--text-accent);font-weight:600;margin-bottom:6px;">God Mode Scope</p>        <ul style="padding-left:16px;display:grid;gap:3px;">          <li><strong style="color:var(--text-primary);">"all"</strong> — Superusers bypass ALL filters (DM + group). Use with caution.</li>          <li><strong style="color:var(--text-primary);">"dm"</strong> <span style="color:var(--success);">(recommended)</span> — Superusers bypass DM filter only. Groups always require keyword/trigger.</li>          <li><strong style="color:var(--text-primary);">"off"</strong> — Superusers never bypass filters. Must always use keyword/trigger.</li>        </ul>      </div>      <div style="background:var(--bg-tertiary);border-radius:8px;padding:12px 14px;">        <p style="color:var(--text-accent);font-weight:600;margin-bottom:6px;">Per-Group Filter Overrides</p>        <ul style="padding-left:16px;display:grid;gap:3px;">          <li>Per-group overrides take <strong style="color:var(--text-primary);">priority over the global filter</strong>. When a group has an override, global settings are ignored for that group.</li>          <li>Override with <strong style="color:var(--text-primary);">filterEnabled=false</strong> → ALL messages in that group reach the bot (no keyword/trigger required).</li>          <li>Override with <strong style="color:var(--text-primary);">custom keywords</strong> → those keywords are used instead of the global keyword list.</li>          <li>Groups <strong style="color:var(--text-primary);">without overrides</strong> continue using the global filter as usual.</li>          <li>Configure per-group overrides in the <strong style="color:var(--text-accent);">Directory</strong> tab — click on a group to manage its settings.</li>        </ul>      </div>    </div>  </details>
</div>
</main>
</div>

<!-- TAB: DIRECTORY -->
<div class="tab-content" id="content-directory">
<main class="tab-pane">
<div class="card">
  <h2>Contact Directory</h2>
  <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:1px solid var(--border);">
    <button class="dir-tab active" onclick="switchDirTab('contacts',this)" id="dtab-contacts">Contacts</button>
    <button class="dir-tab" onclick="switchDirTab('groups',this)" id="dtab-groups">Groups</button>
    <button class="dir-tab" onclick="switchDirTab('newsletters',this)" id="dtab-newsletters">Channels</button>
  </div>
  <div id="syncStatusBar" style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:8px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--text-secondary);">
    <span id="syncStatusIcon"></span>
    <span id="syncStatusText">Checking sync status...</span>
  </div>
  <div class="dir-header">
    <div style="position:relative;flex:1;">
      <input type="text" class="dir-search" id="dir-search" placeholder="Search by name or JID..." oninput="debouncedDirSearch()" style="width:100%;padding-right:28px;">
      <button id="dir-search-clear" onclick="clearDirSearch()" aria-label="Clear search" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;line-height:1;padding:0 4px;display:none;" onmouseover="this.style.color='var(--text-primary)'" onmouseout="this.style.color='var(--text-secondary)'">&#x2715;</button>
    </div>
    <button class="refresh-btn" id="dir-refresh-btn" onclick="refreshDirectory()" title="Refresh current tab from WAHA API">Refresh</button>
    <button class="refresh-btn" style="background:#7c3aed;" id="dir-refresh-all-btn" onclick="refreshDirectory()" title="Import all contacts, groups and newsletters from WAHA API">Refresh All</button>
    <button class="refresh-btn" id="bulk-select-btn" onclick="toggleBulkSelectMode()" title="Toggle bulk select mode">Select</button>
    <div class="dir-stats" id="dir-stats"></div>
  </div>
  <div class="contact-list" id="contact-list"></div>
  <button class="load-more-btn" id="load-more-btn" onclick="loadDirectory()" style="display:none">Load More</button>
</div>
</main>
</div>

<!-- TAB: QUEUE (Phase 2, Plan 02) -->
<div class="tab-content" id="content-queue">
<main class="tab-pane">
  <div class="card">
    <h2>Inbound Queue</h2>
    <div class="stat-row" id="queue-stats"></div>
    <div class="kv" id="queue-kv" style="margin-top:12px;"></div>
    <div style="margin-top:12px;display:flex;justify-content:flex-end;">
      <div class="refresh-wrap"><button class="refresh-btn" id="refresh-queue" onclick="loadQueue()">Refresh</button></div>
    </div>
  </div>
</main>
</div>

<!-- TAB: SESSIONS (Phase 4, Plan 04) -->
<div class="tab-content" id="content-sessions">
<main class="tab-pane">
  <div class="card">
    <h2>Registered Sessions</h2>
    <div id="sessions-list" style="display:grid;gap:12px;margin-top:4px;"></div>
    <p style="margin-top:16px;font-size:0.78rem;color:var(--text-muted);border-top:1px solid var(--border);padding-top:12px;">Changes take effect after gateway restart.</p>
    <div style="margin-top:8px;display:flex;justify-content:flex-end;gap:8px;">
      <button class="refresh-btn" id="refresh-sessions" onclick="loadSessions()">Refresh</button>
      <button class="save-btn" style="background:#f59e0b;" onclick="sessionsSaveAndRestart()">Save &amp; Restart</button>
    </div>
  </div>
</main>
</div>

<!-- TAB: MODULES (Phase 17, Plan 03 — MOD-03, MOD-04) -->
<div class="tab-content" id="content-modules">
<main class="tab-pane">
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h2 style="margin:0;font-size:1.1rem;color:var(--text-primary);">Registered Modules</h2>
      <button class="refresh-btn" id="refresh-modules">Refresh</button>
    </div>
    <div id="modules-list"></div>
    <div id="modules-empty" style="display:none;color:var(--text-muted);text-align:center;padding:32px 0;">
      No modules registered. Modules are loaded at gateway startup.
    </div>
  </div>
</main>
</div>

<!-- TAB: LOG -->
<div class="tab-content" id="content-logs">
<main class="tab-pane">
<div class="card">
  <h2>Gateway Log</h2>
  <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
    <div style="position:relative;flex:1;display:flex;align-items:center;min-width:180px;">
      <input type="text" id="log-search" placeholder="Filter logs..." oninput="debouncedLogSearch()" style="width:100%;padding:6px 30px 6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:0.82rem;">
      <button id="log-search-clear" onclick="clearLogSearch()" aria-label="Clear log filter" style="position:absolute;right:8px;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;line-height:1;padding:0 2px;display:none;" onmouseover="this.style.color='var(--text-primary)'" onmouseout="this.style.color='var(--text-secondary)'">&#x2715;</button>
    </div>
    <button onclick="setLogLevel('all')" id="log-level-all" class="log-level-btn active">All</button>
    <button onclick="setLogLevel('error')" id="log-level-error" class="log-level-btn">Error</button>
    <button onclick="setLogLevel('warn')" id="log-level-warn" class="log-level-btn">Warn</button>
    <button onclick="setLogLevel('info')" id="log-level-info" class="log-level-btn">Info</button>
    <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;color:var(--text-secondary);cursor:pointer;"><input type="checkbox" id="log-autoscroll" checked> Auto-scroll</label>
    <button id="refresh-log" onclick="loadLogs()" style="padding:4px 12px;border-radius:5px;border:1px solid var(--border);cursor:pointer;font-size:0.75rem;background:var(--bg-secondary);color:var(--text-primary);">Refresh</button>
  </div>
  <div id="log-source" style="font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;"></div>
  <div id="log-output" style="background:var(--bg-tertiary);color:var(--text-primary);padding:16px;border-radius:8px;max-height:70vh;overflow-y:auto;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:0.78rem;line-height:1.4;margin:0;"></div>
</div>
</main>
</div>

<footer>
  Created with love by <a href="https://github.com/omernesh/openclaw-waha-plugin" target="_blank" rel="noopener">omer nesher</a>
  &nbsp;&bull;&nbsp;
  <a href="https://github.com/omernesh/openclaw-waha-plugin" target="_blank" rel="noopener">GitHub</a>
</footer>

<script>
// DIR-01 / DIR-02 (12-05): Bot session IDs injected server-side. Used to mark bot participants and
// exclude bot's own JIDs from contacts. DO NOT REMOVE — participant badge and contact filter depend on this.
var BOT_SESSION_IDS = ${botSessionIdsJson};
</script>
<script>
// ---- Tab switching ----
function switchTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('nav button').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('content-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'dashboard') { _accessKvBuilt = false; loadStats(); }
  if (name === 'settings') loadConfig();
  if (name === 'directory') { loadDirectory(); updateSyncStatus(); }
  if (name === 'queue') loadQueue();
  if (name === 'sessions') loadSessions();
  if (name === 'modules') loadModules();
  if (name === 'logs') { loadLogs(); startLogRefresh(); } else { stopLogRefresh(); }
  location.hash = name;
}

// Init from hash
(function() {
  var hash = location.hash.replace('#','') || 'dashboard';
  var valid = ['dashboard','settings','directory','logs','queue','sessions','modules'];
  if (!valid.includes(hash)) hash = 'dashboard';
  var btn = document.getElementById('tab-' + hash);
  switchTab(hash, btn);
})();

// ---- Theme Toggle (Change 5) -- DO NOT REMOVE: persists dark/light mode in localStorage ----
function toggleTheme() {
  document.body.classList.toggle('light-mode');
  var isLight = document.body.classList.contains('light-mode');
  localStorage.setItem('waha-theme', isLight ? 'light' : 'dark');
  document.getElementById('theme-toggle').textContent = isLight ? '☽' : '☀';
}
(function() {
  var savedTheme = localStorage.getItem('waha-theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = '☽';
  }
})();

// ---- Helpers ----
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
function stat(label, value, color, id) {
  return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="value"' + (id ? ' id="' + id + '"' : '') + ' style="color:' + color + '">' + esc(String(value)) + '</div></div>';
}
function kvRow(k, v) { return '<div class="k">' + esc(k) + '</div><div class="v">' + esc(String(v != null ? v : '')) + '</div>'; }
function tags(arr) { return (arr || []).map(function(t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') || '<span style="color:var(--text-muted)">none</span>'; }
function relTime(ts) {
  var diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}
function avatarColor(jid) {
  var colors = ['#e11d48','#d97706','#16a34a','#0284c7','#7c3aed','#be185d','#0891b2','#15803d'];
  var hash = 0;
  for (var i = 0; i < jid.length; i++) hash = (hash * 31 + jid.charCodeAt(i)) & 0x7fffffff;
  return colors[hash % colors.length];
}
function initials(name, jid) {
  var s = name || jid;
  var parts = s.trim().split(/\\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.substring(0, 2).toUpperCase();
}
function showToast(msg, isError) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(function() { t.className = ''; }, 3500);
}

// ---- Name Resolver (Phase 8, UI-01) -- DO NOT CHANGE: resolves JIDs to contact names with shimmer loading state ----
function createNameResolver(container, jid) {
  if (typeof container === 'string') container = document.getElementById(container);
  if (!container) return null;
  var wrap = document.createElement('span');
  wrap.className = 'nr-wrap';
  var skeleton = document.createElement('span');
  skeleton.className = 'nr-skeleton';
  wrap.appendChild(skeleton);
  container.appendChild(wrap);
  function clearWrap() { while (wrap.firstChild) wrap.removeChild(wrap.firstChild); }
  fetch('/api/admin/directory/' + encodeURIComponent(jid)).then(function(r) {
    if (r.ok) {
      return r.json().then(function(data) {
        var name = (data && data.displayName) ? data.displayName : jid;
        var avatar = document.createElement('span');
        avatar.className = 'nr-avatar';
        avatar.style.background = avatarColor(jid);
        avatar.textContent = initials(name, jid);
        var info = document.createElement('span');
        info.className = 'nr-info';
        var nameEl = document.createElement('span');
        nameEl.className = 'nr-name';
        nameEl.textContent = name;
        var jidEl = document.createElement('span');
        jidEl.className = 'nr-jid';
        jidEl.textContent = jid;
        info.appendChild(nameEl);
        info.appendChild(jidEl);
        clearWrap();
        wrap.appendChild(avatar);
        wrap.appendChild(info);
      });
    } else {
      throw new Error('not found');
    }
  }).catch(function(err) {
    console.warn('[waha] name resolve failed for', jid, err);
    clearWrap();
    var jidEl = document.createElement('span');
    jidEl.className = 'nr-jid';
    jidEl.textContent = jid;
    wrap.appendChild(jidEl);
  });
  return wrap;
}

// Pure logic: normalize raw input into trimmed non-empty tag array. DO NOT CHANGE: extracted for testability (Phase 8, UI-02)
function normalizeTags(input) {
  if (!input || typeof input !== 'string') return [];
  return input.split(/[,\\n]+/).map(function(t) { return t.trim(); }).filter(Boolean);
}

// ---- Tag Input (Phase 8, UI-02) -- DO NOT CHANGE: pill bubble input factory for JID list fields ----
// Phase 14 (NAME-01): supports resolveNames option — pills show resolved contact names with raw JID tooltip.
// getValue() always returns raw JID strings (NOT names) — critical for config save correctness. DO NOT CHANGE.
function createTagInput(containerId, opts) {
  opts = opts || {};
  var container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return null;
  var tags = [];
  var _resolveTimer = null;
  var wrap = document.createElement('div');
  wrap.className = 'ti-wrap';
  var input = document.createElement('input');
  input.className = 'ti-input';
  input.type = 'text';
  input.placeholder = opts.placeholder || 'Type JID or phone, press Enter';
  wrap.appendChild(input);
  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(wrap);

  function applyResolvedNames(resolvedMap) {
    // Update pill text with resolved names; keep raw JID in title tooltip. DO NOT REMOVE.
    var pills = wrap.querySelectorAll('.ti-tag');
    for (var i = 0; i < pills.length; i++) {
      var pill = pills[i];
      var jid = pill.getAttribute('data-jid');
      if (jid && resolvedMap[jid]) {
        var textNode = pill.firstChild;
        if (textNode && textNode.nodeType === 3) {
          textNode.nodeValue = resolvedMap[jid] + ' ';
        }
        pill.title = jid;
      }
    }
  }

  function scheduleResolve() {
    // Phase 14 (NAME-01): debounced batch resolve — fires once 50ms after last renderTags call.
    // Prevents N+1 fetch calls when setValue sets multiple tags at once. DO NOT REMOVE.
    if (!opts.resolveNames) return;
    if (_resolveTimer) clearTimeout(_resolveTimer);
    _resolveTimer = setTimeout(function() {
      _resolveTimer = null;
      if (!tags.length) return;
      var jidsParam = encodeURIComponent(tags.join(','));
      fetch('/api/admin/directory/resolve?jids=' + jidsParam)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) { if (data && data.resolved) applyResolvedNames(data.resolved); })
        .catch(function() { /* graceful fallback — pills keep raw JID text */ });
    }, 50);
  }

  function renderTags() {
    var existing = wrap.querySelectorAll('.ti-tag');
    for (var i = 0; i < existing.length; i++) wrap.removeChild(existing[i]);
    for (var j = 0; j < tags.length; j++) {
      (function(idx, val) {
        var pill = document.createElement('span');
        pill.className = 'ti-tag';
        pill.setAttribute('data-jid', val);
        pill.appendChild(document.createTextNode(val + ' '));
        var rm = document.createElement('span');
        rm.className = 'ti-remove';
        rm.textContent = '\u00d7';
        rm.setAttribute('aria-label', 'Remove ' + val);
        rm.addEventListener('click', function(e) {
          e.stopPropagation();
          tags.splice(idx, 1);
          renderTags();
        });
        pill.appendChild(rm);
        wrap.insertBefore(pill, input);
      })(j, tags[j]);
    }
    scheduleResolve();
  }

  function addTag(val) {
    val = val ? val.trim() : '';
    if (!val) return;
    if (tags.indexOf(val) !== -1) return;
    tags.push(val);
    input.value = '';
    renderTags();
  }

  input.addEventListener('keydown', function(e) {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === 'Tab') && input.value.trim()) {
      e.preventDefault();
      var parts = normalizeTags(input.value);
      for (var i = 0; i < parts.length; i++) addTag(parts[i]);
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop();
      renderTags();
    }
  });
  input.addEventListener('paste', function() {
    setTimeout(function() {
      var parts = normalizeTags(input.value);
      input.value = '';
      for (var i = 0; i < parts.length; i++) addTag(parts[i]);
    }, 0);
  });
  wrap.addEventListener('click', function() { input.focus(); });
  input.addEventListener('focus', function() { wrap.classList.add('ti-focused'); });
  input.addEventListener('blur', function() {
    wrap.classList.remove('ti-focused');
    if (input.value.trim()) addTag(input.value);
  });

  return {
    getValue: function() { return tags.slice(); },
    setValue: function(arr) { tags = (arr || []).slice(); renderTags(); }
  };
}

// ---- Contact Picker (Phase 8, UI-03) -- DO NOT CHANGE: searchable multi-select contact picker ----

// Pure logic: toggle an item in a selection array by jid. Returns new array.
// If item.jid exists in arr, removes it. Otherwise appends it.
// DO NOT CHANGE: extracted for testability (Phase 8, UI-03)
function toggleSelection(arr, item) {
  var idx = -1;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].jid === item.jid) { idx = i; break; }
  }
  var next = arr.slice();
  if (idx >= 0) {
    next.splice(idx, 1);
  } else {
    next.push({ jid: item.jid, displayName: item.displayName || item.jid });
  }
  return next;
}

function createContactPicker(containerId, opts) {
  opts = opts || {};
  var container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return null;
  var selected = [];
  var results = [];
  var searchTimeout = null;
  var isOpen = false;

  var wrapEl = document.createElement('div');
  wrapEl.className = 'cp-wrap';
  var chipsEl = document.createElement('div');
  chipsEl.className = 'cp-selected';
  var searchInput = document.createElement('input');
  searchInput.className = 'cp-search';
  searchInput.type = 'text';
  searchInput.placeholder = opts.placeholder || 'Search contacts...';
  var dropdown = document.createElement('div');
  dropdown.className = 'cp-dropdown';
  wrapEl.appendChild(chipsEl);
  wrapEl.appendChild(searchInput);
  wrapEl.appendChild(dropdown);
  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(wrapEl);

  function renderChips() {
    while (chipsEl.firstChild) chipsEl.removeChild(chipsEl.firstChild);
    for (var i = 0; i < selected.length; i++) {
      (function(idx, item) {
        var chip = document.createElement('span');
        chip.className = 'cp-chip';
        chip.appendChild(document.createTextNode(item.displayName || item.jid));
        var rm = document.createElement('span');
        rm.className = 'cp-chip-remove';
        rm.textContent = '\u00d7';
        rm.setAttribute('aria-label', 'Remove ' + (item.displayName || item.jid));
        rm.addEventListener('click', function(e) {
          e.stopPropagation();
          selected.splice(idx, 1);
          renderChips();
          if (opts.onRemove) opts.onRemove(item);
        });
        chip.appendChild(rm);
        chipsEl.appendChild(chip);
      })(i, selected[i]);
    }
  }

  function renderResults() {
    while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);
    if (results.length === 0 && searchInput.value.trim()) {
      var emptyEl = document.createElement('div');
      emptyEl.className = 'cp-empty';
      emptyEl.appendChild(document.createTextNode('No contacts found'));
      var emptyLine2 = document.createElement('div');
      emptyLine2.textContent = 'Try a different name or phone number';
      emptyEl.appendChild(emptyLine2);
      dropdown.appendChild(emptyEl);
      return;
    }
    for (var i = 0; i < results.length; i++) {
      (function(result) {
        var row = document.createElement('div');
        row.className = 'cp-row';
        var av = document.createElement('span');
        av.className = 'cp-av';
        av.style.background = avatarColor(result.jid);
        av.textContent = initials(result.displayName, result.jid);
        var info = document.createElement('div');
        info.className = 'cp-row-info';
        var nameEl = document.createElement('span');
        nameEl.className = 'cp-row-name';
        nameEl.textContent = result.displayName || result.jid;
        var jidEl = document.createElement('span');
        jidEl.className = 'cp-row-jid';
        jidEl.textContent = result.jid;
        info.appendChild(nameEl);
        info.appendChild(jidEl);
        var check = document.createElement('span');
        check.className = 'cp-check';
        var isSelected = false;
        for (var j = 0; j < selected.length; j++) {
          if (selected[j].jid === result.jid) { isSelected = true; break; }
        }
        check.textContent = isSelected ? '\u2713' : '';
        row.appendChild(av);
        row.appendChild(info);
        row.appendChild(check);
        row.addEventListener('click', function() {
          selected = toggleSelection(selected, { jid: result.jid, displayName: result.displayName || result.jid });
          renderChips();
          renderResults();
          if (opts.onSelect) opts.onSelect(selected);
        });
        dropdown.appendChild(row);
      })(results[i]);
    }
  }

  function openDropdown() {
    isOpen = true;
    dropdown.classList.add('cp-open');
    // Prevent dropdown from overflowing viewport bottom
    var rect = wrapEl.getBoundingClientRect();
    // 240px = estimated max dropdown height for viewport overflow check
    if (rect.bottom + 240 > window.innerHeight) {
      dropdown.style.bottom = '100%';
      dropdown.style.top = 'auto';
      dropdown.style.marginTop = '0';
      dropdown.style.marginBottom = '4px';
    } else {
      dropdown.style.top = '100%';
      dropdown.style.bottom = 'auto';
      dropdown.style.marginTop = '4px';
      dropdown.style.marginBottom = '0';
    }
  }

  function closeDropdown() {
    isOpen = false;
    dropdown.classList.remove('cp-open');
    results = [];
  }

  // NAME-03: Contact picker search queries local SQLite via FTS5 (Phase 13). No changes needed.
  function doSearch(query) {
    // Minimum 2 characters before triggering search
    if (!query || query.length < 2) { closeDropdown(); return; }
    fetch('/api/admin/directory?search=' + encodeURIComponent(query) + '&limit=20&type=contact')
      .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
      .then(function(data) {
        results = data.contacts || [];
        renderResults();
        openDropdown();
      })
      .catch(function(err) { console.warn('[waha] contact search failed:', err); showToast('Search failed', true); });
  }

  searchInput.addEventListener('input', function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function() { doSearch(searchInput.value.trim()); }, 300); // 300ms debounce delay for search input
  });

  document.addEventListener('mousedown', function(e) {
    if (isOpen && !wrapEl.contains(e.target)) closeDropdown();
  });

  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isOpen) { e.stopPropagation(); closeDropdown(); }
  });

  return {
    getValue: function() { return selected.map(function(s) { return s.jid; }); },
    setValue: function(jids) {
      // NOTE: This fetch-in-component is an approved exception to the UI-SPEC
      // "no fetch inside components" guideline. The same pattern exists in
      // createNameResolver (Plan 01). Justified because name resolution is
      // best-effort cosmetic enrichment, not data-fetching logic.
      selected = (jids || []).map(function(jid) { return { jid: jid, displayName: jid }; });
      renderChips();
      // NAME-02: Batch resolve display names via single /api/admin/directory/resolve call.
      // Replaces N individual per-JID fetches with one batch call for efficiency.
      // @lid JIDs are resolved via the @c.us fallback in resolveJids() (Plan 01).
      var needResolve = selected.filter(function(s) { return s.displayName === s.jid; }).map(function(s) { return s.jid; });
      if (needResolve.length > 0) {
        fetch('/api/admin/directory/resolve?jids=' + encodeURIComponent(needResolve.join(',')))
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(data) {
            if (!data || !data.resolved) return;
            var changed = false;
            for (var k = 0; k < selected.length; k++) {
              if (data.resolved[selected[k].jid]) {
                selected[k].displayName = data.resolved[selected[k].jid];
                changed = true;
              }
            }
            if (changed) renderChips();
          })
          .catch(function(err) { console.warn('[waha] batch name resolve failed:', err); });
      }
    },
    getSelected: function() { return selected.slice(); },
    // Allow callers to directly set selected with full objects (jid + displayName + any extra fields)
    // This preserves all properties on the objects, unlike setValue which only takes JID strings.
    // Used by createGodModeUsersField to store lid pairings inside the picker's closure.
    setSelectedObjects: function(items) {
      selected = (items || []).slice();
      renderChips();
      // NAME-02: Batch resolve display names for items that only have jid as displayName.
      // Replaces N individual per-JID fetches with one batch call for efficiency.
      // @lid JIDs are resolved via the @c.us fallback in resolveJids() (Plan 01).
      var needResolve = selected.filter(function(s) { return !s.displayName || s.displayName === s.jid; }).map(function(s) { return s.jid; });
      if (needResolve.length > 0) {
        fetch('/api/admin/directory/resolve?jids=' + encodeURIComponent(needResolve.join(',')))
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(data) {
            if (!data || !data.resolved) return;
            var changed = false;
            for (var k = 0; k < selected.length; k++) {
              if (data.resolved[selected[k].jid]) {
                selected[k].displayName = data.resolved[selected[k].jid];
                changed = true;
              }
            }
            if (changed) renderChips();
          })
          .catch(function(err) { console.warn('[waha] batch name resolve failed:', err); });
      }
    }
  };
}

// Pure logic: serialize God Mode selected contacts to config format
// Each contact produces [{identifier: jid}] or [{identifier: jid}, {identifier: lid}] if paired
// DO NOT CHANGE: extracted for testability (Phase 8, UI-04)
function serializeGodModeUsers(selected) {
  var result = [];
  for (var i = 0; i < selected.length; i++) {
    result.push({ identifier: selected[i].jid });
    if (selected[i].lid) result.push({ identifier: selected[i].lid });
  }
  return result;
}

// Pure logic: deserialize God Mode config [{identifier: x}] to picker-friendly array
// Groups @c.us + @lid pairs into single entries
function deserializeGodModeUsers(configArr) {
  if (!configArr || !configArr.length) return [];
  var result = [];
  for (var i = 0; i < configArr.length; i++) {
    var id = typeof configArr[i] === 'string' ? configArr[i] : (configArr[i].identifier || '');
    if (!id) continue;
    if (id.endsWith('@lid')) {
      // Find the last @c.us entry without a lid (immediately preceding this @lid)
      var found = false;
      for (var j = result.length - 1; j >= 0; j--) {
        if (!result[j].lid) { result[j].lid = id; found = true; break; }
      }
      if (!found) result.push({ jid: id, displayName: id, lid: null });
    } else {
      result.push({ jid: id, displayName: id, lid: null });
    }
  }
  return result;
}

// ---- God Mode Users Field (Phase 8, UI-04) -- DO NOT CHANGE: wraps Contact Picker with paired JID (@c.us + @lid) handling ----
function createGodModeUsersField(containerId, opts) {
  opts = opts || {};
  var picker = createContactPicker(containerId, {
    placeholder: opts.placeholder || 'Search contacts...',
    mode: 'multi'
  });
  if (!picker) return null;

  // Maintain a parallel lid map keyed by JID string.
  // This is independent of the picker's internal selected array,
  // so lid pairings survive getSelected() copy semantics.
  // DO NOT CHANGE: fixes lid-loss bug (Phase 8 revision, checker issue #1)
  var lidMap = {};

  return {
    getValue: function() {
      // Return flat array of JID strings, consulting lidMap for pairings
      var sel = picker.getSelected();
      var ids = [];
      for (var i = 0; i < sel.length; i++) {
        ids.push(sel[i].jid);
        if (lidMap[sel[i].jid]) ids.push(lidMap[sel[i].jid]);
      }
      return ids;
    },
    setValue: function(configArr) {
      // configArr is [{identifier: "jid"}, ...] or ["jid", ...]
      var items = deserializeGodModeUsers(configArr);
      // Populate lidMap from deserialized pairs
      lidMap = {};
      for (var i = 0; i < items.length; i++) {
        if (items[i].lid) lidMap[items[i].jid] = items[i].lid;
      }
      // Use setSelectedObjects to pass full objects (with displayName) into picker
      // This avoids the closure-copy problem entirely
      picker.setSelectedObjects(items.map(function(it) {
        return { jid: it.jid, displayName: it.displayName || it.jid };
      }));
    }
  };
}

// LABEL_MAP (12-01, DASH-03) -- human-readable display labels for raw config key names.
// DO NOT REMOVE: applied in kvRow() calls throughout the dashboard to avoid showing raw camelCase keys.
var LABEL_MAP = {
  wpm: 'Words Per Minute',
  readDelayMs: 'Read Delay (ms)',
  typingDurationMs: 'Typing Duration (ms)',
  pauseChance: 'Pause Chance',
  presenceEnabled: 'Presence Enabled',
  groupFilter: 'Group Filter',
  dmFilter: 'DM Filter',
  allowFrom: 'Allow From',
  groupAllowFrom: 'Group Allow From',
  allowedGroups: 'Allowed Groups',
  godModeSuperUsers: 'God Mode Users',
  dmPolicy: 'DM Policy',
  groupPolicy: 'Group Policy',
  mentionPatterns: 'Mention Patterns',
  keywords: 'Keywords',
  triggerOperator: 'Trigger Operator',
  globalKeywords: 'Global Keywords',
  groupKeywords: 'Group Keywords',
  enabled: 'Enabled',
  jitter: 'Jitter',
  baseUrl: 'Base URL',
  webhookPort: 'Webhook Port',
  serverTime: 'Server Time'
};
function labelFor(key) { return LABEL_MAP[key] || key; }

// _accessKvBuilt: guards Access Control Name Resolver div creation so they are built ONCE.
// On 30s auto-refresh, loadStats() runs again but must NOT re-create Name Resolver divs —
// doing so triggers new async fetches and causes visible flicker on the Access Control card.
// Set to false only when the page first loads. DO NOT REMOVE (12-01, UI-01).
var _accessKvBuilt = false;
// _filterStatsBuilt: guards DM and Group filter stat cards. On first load, builds full innerHTML
// with IDs on stat value elements. On 30s auto-refresh, updates values in-place via textContent
// to prevent visible flicker. DO NOT REMOVE (BUG-02).
var _filterStatsBuilt = false;

// ---- Tag Input instance variables (Phase 8, UI-02) -- initialized lazily in loadConfig() ----
var tagInputAllowFrom = null;
var tagInputGroupAllowFrom = null;
var tagInputAllowedGroups = null;
// ---- Mention Patterns tag input instances (Phase 12, UX-05) -- initialized lazily in loadConfig() ----
var dmMentionPatternsInput = null;
var groupMentionPatternsInput = null;
// ---- Custom Keywords tag input instances (Phase 12, UX-04) -- keyed by sanitized contact ID ----
var customKeywordTagInputs = {};
// ---- Group Filter Override tag input instances (Phase 9, UX-03) -- keyed by sanitized JID suffix ----
var gfoTagInputs = {};
// ---- God Mode Users Field instance variables (Phase 8, UI-04) -- initialized lazily in loadConfig() ----
var godModePickerDm = null;
var godModePickerGroup = null;
// triggerOperator UI removed — backend hardcodes OR. Variable kept for safety but unused.
var globalTriggerOperator = 'OR';

// ---- Dashboard ----
async function loadStats() {
  try {
    var r = await fetchWithRetry('/api/admin/stats');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();
    document.getElementById('status-badge').textContent = d.dmFilter.enabled ? 'Filter ON' : 'Filter OFF';
    document.getElementById('status-badge').style.background = d.dmFilter.enabled ? '#10b981' : '#f59e0b';
    var s = d.dmFilter.stats;
    // 12-01, DASH-04: session sub-headers inside stat cards
    var sessionsForSubHeader = (d.sessions && Array.isArray(d.sessions)) ? d.sessions : [];
    var sessionSubHtml = sessionsForSubHeader.map(function(sess) {
      return '<div class="session-sub-header">' + esc(sess.name || sess.sessionId) + '</div>';
    }).join('');
    // 12-01, UI-02: labels changed from Allowed/Dropped to Passed/Filtered (BUG-03)
    // BUG-02: On refresh, update stat values in-place via textContent to prevent flicker.
    // Only rebuild full content on first load. DO NOT CHANGE.
    if (_filterStatsBuilt && document.getElementById('dm-stat-passed')) {
      document.getElementById('dm-stat-passed').textContent = String(s.allowed);
      document.getElementById('dm-stat-filtered').textContent = String(s.dropped);
      document.getElementById('dm-stat-tokens').textContent = (s.tokensEstimatedSaved || 0).toLocaleString();
    } else {
      document.getElementById('filter-stats').innerHTML = sessionSubHtml + [
        stat('Passed', s.allowed, '#10b981', 'dm-stat-passed'),
        stat('Filtered', s.dropped, '#f87171', 'dm-stat-filtered'),
        stat('Tokens Saved (est)', (s.tokensEstimatedSaved || 0).toLocaleString(), '#38bdf8', 'dm-stat-tokens'),
      ].join('');
    }
    var pats = d.dmFilter.patterns;
    document.getElementById('filter-patterns').innerHTML = '<div style="color:var(--text-secondary);font-size:.8rem;margin-bottom:6px;">Patterns</div><div class="pattern-list">' +
      (pats.length ? pats.map(function(p) { return '<span class="pattern">' + esc(p) + '</span>'; }).join('') : '<span style="color:var(--text-muted)">none</span>') + '</div>';
    var events = d.dmFilter.recentEvents || [];
    document.getElementById('filter-events').innerHTML = events.length
      ? '<div style="color:var(--text-secondary);font-size:.8rem;margin:10px 0 6px;">Recent Events (last ' + events.length + ')</div>' +
        events.slice(0,20).map(function(e) { return '<div class="event ' + (e.pass ? 'pass' : 'fail') + '">' +
          '<span class="ts">' + new Date(e.ts).toLocaleTimeString() + '</span>' +
          '<span class="reason">' + esc(e.reason) + '</span>' +
          '<span class="preview">' + esc(e.preview) + '</span>' +
        '</div>'; }).join('')
      : '<div style="color:var(--text-muted);margin-top:8px;font-size:.8rem">No events yet</div>';
    // Group filter card
    if (d.groupFilter) {
      var gf = d.groupFilter;
      var gs = gf.stats || {allowed:0,dropped:0,tokensEstimatedSaved:0};
      // 12-01, UI-02: Group filter also uses Passed/Filtered labels; per-session sub-headers (DASH-04)
      // BUG-02: On refresh, update group stat values in-place via textContent. DO NOT CHANGE.
      if (_filterStatsBuilt && document.getElementById('grp-stat-passed')) {
        document.getElementById('grp-stat-passed').textContent = String(gs.allowed);
        document.getElementById('grp-stat-filtered').textContent = String(gs.dropped);
        document.getElementById('grp-stat-tokens').textContent = (gs.tokensEstimatedSaved || 0).toLocaleString();
      } else {
        document.getElementById('group-filter-stats').innerHTML = sessionSubHtml + [
          stat('Passed', gs.allowed, '#10b981', 'grp-stat-passed'),
          stat('Filtered', gs.dropped, '#f87171', 'grp-stat-filtered'),
          stat('Tokens Saved (est)', (gs.tokensEstimatedSaved || 0).toLocaleString(), '#38bdf8', 'grp-stat-tokens'),
        ].join('');
      }
      var gpats = gf.patterns || [];
      document.getElementById('group-filter-patterns').innerHTML = '<div style="color:var(--text-secondary);font-size:.8rem;margin-bottom:6px;">Patterns</div><div class="pattern-list">' +
        (gpats.length ? gpats.map(function(p) { return '<span class="pattern">' + esc(p) + '</span>'; }).join('') : '<span style="color:var(--text-muted)">none</span>') + '</div>';
      var gevents = gf.recentEvents || [];
      document.getElementById('group-filter-events').innerHTML = gevents.length
        ? '<div style="color:var(--text-secondary);font-size:.8rem;margin:10px 0 6px;">Recent Events (last ' + gevents.length + ')</div>' +
          gevents.slice(0,20).map(function(e) { return '<div class="event ' + (e.pass ? 'pass' : 'fail') + '">' +
            '<span class="ts">' + new Date(e.ts).toLocaleTimeString() + '</span>' +
            '<span class="reason">' + esc(e.reason) + '</span>' +
            '<span class="preview">' + esc(e.preview) + '</span>' +
          '</div>'; }).join('')
        : '<div style="color:var(--text-muted);margin-top:8px;font-size:.8rem">No events yet</div>';
      document.getElementById('group-filter-card').style.display = '';
    } else {
      document.getElementById('group-filter-card').style.display = 'none';
    }
    // BUG-02: Mark filter stats as built so subsequent refreshes use in-place textContent updates.
    _filterStatsBuilt = true;
    var pr = d.presence;
    // 12-01, DASH-03: use labelFor() to convert raw config keys to human-readable labels
    document.getElementById('presence-kv').innerHTML = kvRow(labelFor('enabled'), pr.enabled !== false) +
      kvRow(labelFor('wpm'), pr.wpm) + kvRow(labelFor('readDelayMs'), JSON.stringify(pr.readDelayMs)) +
      kvRow(labelFor('typingDurationMs'), JSON.stringify(pr.typingDurationMs)) +
      kvRow(labelFor('pauseChance'), pr.pauseChance) + kvRow(labelFor('jitter'), JSON.stringify(pr.jitter));
    // Phase 8, UI-01 -- access-kv uses Name Resolver for JID display. DO NOT REVERT to innerHTML tags().
    // 12-01, UI-01: _accessKvBuilt guard — only build Name Resolver divs on first load.
    // On 30s auto-refresh loadStats() re-runs but must NOT rebuild these divs (causes flicker).
    // DO NOT REMOVE this guard.
    var ac = d.access;
    var accessKv = document.getElementById('access-kv');
    if (!_accessKvBuilt) {
      _accessKvBuilt = true;
      // Change 1: dmPolicy and groupPolicy stay in the .kv grid
      accessKv.innerHTML = kvRow(labelFor('dmPolicy'), ac.dmPolicy) + kvRow(labelFor('groupPolicy'), ac.groupPolicy);
      // Phase 14 (NAME-01): dedupLidCus removes @lid entries when the equivalent @c.us JID is also present.
      // NOWEB puts both @lid and @c.us in groupAllowFrom — same person should appear once. DO NOT REMOVE.
      function dedupLidCus(arr) {
        var cusSet = {};
        for (var i = 0; i < arr.length; i++) {
          if (arr[i].endsWith('@c.us')) cusSet[arr[i].replace('@c.us', '')] = true;
        }
        return arr.filter(function(j) { return !(j.endsWith('@lid') && cusSet[j.replace('@lid', '')]); });
      }
      // Changes 1-4: Access Control tables — always-visible sections in separate stacked container.
      // Paginated with proper << < 1 2 3 > >> navigation. JID text uses readable colors. DO NOT REVERT to tag-list.
      var PAGE_SIZE_AC = 10;
      var accessSections = document.getElementById('access-sections');
      accessSections.innerHTML = '';
      var jidGroups = [
        { key: 'allowFrom', arr: ac.allowFrom || [] },
        { key: 'groupAllowFrom', arr: ac.groupAllowFrom || [] },
        { key: 'allowedGroups', arr: ac.allowedGroups || [] }
      ];
      for (var gi = 0; gi < jidGroups.length; gi++) {
        (function(grp) {
          var dedupedArr = dedupLidCus(grp.arr);
          var total = dedupedArr.length;
          // Change 1+3: Always-visible section (no <details> collapsing), stacked vertically in access-sections
          var section = document.createElement('div');
          section.className = 'access-section';
          var headerEl = document.createElement('div');
          headerEl.className = 'access-section-header';
          var labelSpan = document.createElement('span');
          labelSpan.textContent = labelFor(grp.key);
          headerEl.appendChild(labelSpan);
          var countBadge = document.createElement('span');
          countBadge.className = 'access-section-count';
          countBadge.textContent = String(total);
          headerEl.appendChild(countBadge);
          section.appendChild(headerEl);
          accessSections.appendChild(section);
          if (!total) {
            var noneEl = document.createElement('span');
            noneEl.style.cssText = 'color:var(--text-muted);font-size:0.82rem;padding:4px 0;display:block;';
            noneEl.textContent = 'none';
            section.appendChild(noneEl);
            return;
          }
          // Wildcard check: if '*' is in the list, show warning and gray out other contacts. DO NOT REMOVE.
          var hasWildcard = dedupedArr.indexOf('*') !== -1;
          // Sort: put '*' first if present, then the rest
          if (hasWildcard) {
            dedupedArr = ['*'].concat(dedupedArr.filter(function(j) { return j !== '*'; }));
          }
          if (hasWildcard) {
            var warnEl = document.createElement('div');
            warnEl.style.cssText = 'background:var(--warning-bg, #713f12);color:var(--warning-text, #fde68a);font-size:0.82rem;padding:8px 12px;border-radius:6px;margin-bottom:6px;display:flex;align-items:center;gap:6px;';
            warnEl.innerHTML = '<span style="font-size:1.1rem;">⚠</span> Wildcard (*) is active — all contacts are allowed. Other entries below have no effect.';
            section.appendChild(warnEl);
          }
          // Simple list — names only, JID shown as tooltip on hover. DO NOT add JID column back.
          var listEl = document.createElement('div');
          listEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:4px 0;';
          section.appendChild(listEl);
          // Change 4: Proper pagination nav container
          var navEl = document.createElement('div');
          navEl.className = 'ac-page-nav';
          section.appendChild(navEl);
          var currentPage = 1;
          var totalPages = Math.ceil(total / PAGE_SIZE_AC);
          function renderPage(page) {
            currentPage = page;
            listEl.innerHTML = '';
            var start = (page - 1) * PAGE_SIZE_AC;
            var end = Math.min(start + PAGE_SIZE_AC, total);
            var pageSlice = dedupedArr.slice(start, end);
            for (var ji = 0; ji < pageSlice.length; ji++) {
              (function(jid) {
                var pill = document.createElement('span');
                var isWc = jid === '*';
                var isGrayed = hasWildcard && !isWc;
                if (isWc) {
                  pill.style.cssText = 'background:var(--warning-bg, #713f12);color:var(--warning-text, #fde68a);font-size:0.82rem;padding:4px 12px;border-radius:6px;cursor:default;font-weight:600;';
                  pill.textContent = '* (everyone)';
                  pill.title = 'Wildcard — allows all contacts';
                } else {
                  pill.style.cssText = 'background:var(--stat-bg);color:var(--text-primary);font-size:0.82rem;padding:4px 12px;border-radius:6px;cursor:default;border:1px solid var(--border);text-decoration:none;' + (isGrayed ? 'opacity:0.4;' : '');
                  pill.title = jid;
                  pill.textContent = jid;
                }
                listEl.appendChild(pill);
                if (!isWc) {
                  fetch('/api/admin/directory/' + encodeURIComponent(jid)).then(function(r) {
                    return r.ok ? r.json() : null;
                  }).then(function(data) {
                    if (data && data.displayName) {
                      pill.textContent = data.displayName;
                    }
                  }).catch(function() { /* keep raw JID as fallback */ });
                }
              })(pageSlice[ji]);
            }
            // Change 4: Proper pagination with << < 1 2 3 > >>
            navEl.innerHTML = '';
            if (totalPages <= 1) return;
            function mkPageBtn(label, pg, disabled, isCurrent) {
              var b = document.createElement('button');
              b.textContent = label;
              b.disabled = disabled;
              b.className = 'ac-page-btn' + (isCurrent ? ' ac-current' : '');
              if (!disabled && !isCurrent) b.onclick = function() { renderPage(pg); };
              return b;
            }
            navEl.appendChild(mkPageBtn('«', 1, currentPage <= 1, false));
            navEl.appendChild(mkPageBtn('‹', currentPage - 1, currentPage <= 1, false));
            var pgStart = Math.max(1, currentPage - 2);
            var pgEnd = Math.min(totalPages, pgStart + 4);
            pgStart = Math.max(1, pgEnd - 4);
            for (var pg = pgStart; pg <= pgEnd; pg++) {
              navEl.appendChild(mkPageBtn(String(pg), pg, false, pg === currentPage));
            }
            navEl.appendChild(mkPageBtn('›', currentPage + 1, currentPage >= totalPages, false));
            navEl.appendChild(mkPageBtn('»', totalPages, currentPage >= totalPages, false));
          }
          renderPage(1);
        })(jidGroups[gi]);
      }
    } // end if (!_accessKvBuilt)
    // 12-01, DASH-03: use labelFor() for session-kv labels
    document.getElementById('session-kv').innerHTML =
      kvRow(labelFor('baseUrl'), d.baseUrl) +
      kvRow(labelFor('webhookPort'), d.webhookPort) + kvRow(labelFor('serverTime'), d.serverTime);
    document.getElementById('last-refresh').textContent = 'Last refreshed: ' + new Date().toLocaleTimeString();
    // Load health status for session card (Phase 2, Plan 02)
    loadHealth();
    // Load multi-session dashboard rows (Phase 11, Plan 01 - DASH-01)
    loadDashboardSessions();
  } catch(e) {
    document.getElementById('status-badge').textContent = 'Error';
    document.getElementById('status-badge').style.background = '#ef4444';
  }
}
if (location.hash === '' || location.hash === '#dashboard') loadStats();

// ---- Health Status (Phase 2, Plan 02) ----
async function loadHealth() {
  try {
    var r = await fetch('/api/admin/health');
    if (!r.ok) return;
    var d = await r.json();
    var dot = document.getElementById('health-dot');
    var colors = { healthy: '#10b981', degraded: '#f59e0b', unhealthy: '#ef4444', unknown: '#94a3b8' };
    dot.style.background = colors[d.status] || '#94a3b8';
    dot.title = 'Session health: ' + d.status;
    var hkv = document.getElementById('health-kv');
    var healthHtml = kvRow('Health', d.status) +
      kvRow('Consecutive Failures', d.consecutiveFailures) +
      kvRow('Last Success', d.lastSuccessAt ? relTime(d.lastSuccessAt) : 'never') +
      kvRow('Last Check', d.lastCheckAt ? relTime(d.lastCheckAt) : 'never');
    hkv.innerHTML = healthHtml;
  } catch(e) {
    dot = document.getElementById('health-dot');
    if (dot) { dot.style.background = '#ef4444'; dot.title = 'Health check error: ' + (e.message || e); }
    console.warn('[waha] loadHealth failed:', e.message || e);
  }
}

// ---- Log Tab ----
var currentLogLevel = 'all';
var logRefreshTimer = null;
var logSearchTimeout = null;
function debouncedLogSearch() {
  clearTimeout(logSearchTimeout);
  // Phase 12, Plan 03 (UX-02): show/hide log search clear button based on input content
  var clearBtn = document.getElementById('log-search-clear');
  var searchEl = document.getElementById('log-search');
  if (clearBtn && searchEl) clearBtn.style.display = searchEl.value ? 'block' : 'none';
  logSearchTimeout = setTimeout(loadLogs, 300);
}

// Phase 12, Plan 03 (UX-02): clear log search filter and reset results
function clearLogSearch() {
  var input = document.getElementById('log-search');
  if (input) { input.value = ''; }
  var clearBtn = document.getElementById('log-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  loadLogs();
}

function setLogLevel(level) {
  currentLogLevel = level;
  document.querySelectorAll('.log-level-btn').forEach(function(b) {
    b.classList.remove('active');
  });
  var btn = document.getElementById('log-level-' + level);
  if (btn) { btn.classList.add('active'); }
  loadLogs();
}

function startLogRefresh() {
  stopLogRefresh();
  logRefreshTimer = setInterval(loadLogs, 5000);
}

function stopLogRefresh() {
  if (logRefreshTimer) { clearInterval(logRefreshTimer); logRefreshTimer = null; }
}

// Phase 11, Plan 02 (LOG-01) -- parse journalctl log line into timestamp + message. DO NOT REMOVE.
function parseLogLine(line) {
  // Journalctl format: "Mar 16 12:34:56 hostname proc[pid]: message"
  var m = line.match(/^(\\w{3}\\s+\\d+\\s+[\\d:]+)\\s+\\S+\\s+\\S+:\\s(.*)$/);
  if (m) return { ts: m[1], msg: m[2] };
  // Fallback for non-journalctl lines (file source or malformed)
  return { ts: '', msg: line };
}

// Phase 11, Plan 02 (LOG-01) -- detect log level from line content. DO NOT REMOVE.
function detectLogLevel(line) {
  if (/error/i.test(line)) return 'error';
  if (/warn/i.test(line)) return 'warn';
  if (/\\[waha\\]/i.test(line)) return 'info';
  return 'debug';
}

async function loadLogs() {
  var search = (document.getElementById('log-search') || {}).value || '';
  search = search.trim();
  var url = '/api/admin/logs?lines=200&level=' + currentLogLevel + (search ? '&search=' + encodeURIComponent(search) : '');
  try {
    var r = await fetchWithRetry(url);
    if (!r.ok) {
      var errBody = await r.json().catch(function() { return {}; });
      throw new Error(errBody.error || 'HTTP ' + r.status);
    }
    var d = await r.json();
    // Null-check output element — DO NOT REMOVE
    var output = document.getElementById('log-output');
    if (!output) return;
    var sourceEl = document.getElementById('log-source');
    if (sourceEl) sourceEl.textContent = 'Source: ' + (d.source || 'unknown') + ' | ' + d.total + ' lines';
    var lines = d.lines || [];
    // Phase 11, Plan 02 (LOG-01) -- structured log rendering with DOM creation.
    // Uses textContent for all log data (timestamps, messages) -- security pattern. DO NOT CHANGE to raw HTML.
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < lines.length; i++) {
      var parsed = parseLogLine(lines[i]);
      var level = detectLogLevel(lines[i]);

      var entry = document.createElement('div');
      entry.className = 'log-entry';

      var tsEl = document.createElement('span');
      tsEl.className = 'log-ts';
      tsEl.textContent = parsed.ts;
      entry.appendChild(tsEl);

      var levelEl = document.createElement('span');
      levelEl.className = 'log-level log-level-' + level;
      levelEl.textContent = level;
      entry.appendChild(levelEl);

      var msgEl = document.createElement('span');
      msgEl.className = 'log-msg';
      msgEl.textContent = parsed.msg;
      entry.appendChild(msgEl);

      fragment.appendChild(entry);
    }
    // Clear and append in one operation for performance
    while (output.firstChild) output.removeChild(output.firstChild);
    output.appendChild(fragment);
    var autoScroll = document.getElementById('log-autoscroll');
    if (autoScroll && autoScroll.checked) {
      output.scrollTop = output.scrollHeight;
    }
  } catch(e) {
    var out = document.getElementById('log-output');
    if (out) out.textContent = 'Error loading logs: ' + (e.message || String(e));
  }
}

// ---- Queue Stats (Phase 2, Plan 02) ----
async function loadQueue() {
  try {
    var r = await fetchWithRetry('/api/admin/queue');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();
    var statsHtml = [
      stat('DM Depth', d.dmDepth, '#0284c7'),
      stat('Group Depth', d.groupDepth, '#7c3aed'),
      stat('Processed', d.totalProcessed, '#10b981'),
    ].join('');
    document.getElementById('queue-stats').innerHTML = statsHtml;
    var qkvHtml = kvRow('DM Overflow Drops', d.dmOverflowDrops) +
      kvRow('Group Overflow Drops', d.groupOverflowDrops);
    document.getElementById('queue-kv').innerHTML = qkvHtml;
  } catch(e) {
    document.getElementById('queue-stats').textContent = 'Failed to load queue stats: ' + (e.message || e);
  }
}
setInterval(function() { if (document.getElementById('content-dashboard').classList.contains('active')) loadStats(); }, 30000);

// ---- Sessions Tab helpers (Phase 11, Plan 01 - DASH-01+SESS-01) ----
// Moved out of loadSessions() so loadDashboardSessions() can share them. DO NOT MOVE BACK inside loadSessions().
function roleBadgeColor(role) {
  if (role === 'bot') return '#1d4ed8';
  if (role === 'human') return '#059669';
  return '#64748b';
}
function subRoleBadgeColor(subRole) {
  if (subRole === 'full-access') return '#059669';
  if (subRole === 'listener') return '#d97706';
  return '#64748b';
}
function healthDotColor(healthy, healthStatus) {
  if (healthy === null) return '#94a3b8'; // unknown
  if (healthStatus === 'healthy') return '#10b981';
  if (healthStatus === 'degraded') return '#f59e0b';
  return '#ef4444'; // unhealthy
}

// ---- Dashboard multi-session rows (Phase 11, Plan 01 - DASH-01) ----
// DO NOT REMOVE: renders all config sessions in the Dashboard session card.
async function loadDashboardSessions() {
  try {
    var r = await fetchWithRetry('/api/admin/sessions');
    var container = document.getElementById('dashboard-sessions');
    if (!container) return;
    if (!r.ok) {
      var errEl = document.createElement('div');
      errEl.style.cssText = 'color:var(--error);font-size:0.82rem;padding:4px 0;';
      errEl.textContent = 'Could not load sessions (HTTP ' + r.status + ')';
      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(errEl);
      return;
    }
    var sessions = await r.json();
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      var emptyEl = document.createElement('div');
      emptyEl.style.cssText = 'color:var(--text-muted);font-size:0.82rem;padding:4px 0;';
      emptyEl.textContent = 'No sessions configured.';
      container.appendChild(emptyEl);
      return;
    }
    // 12-01, DASH-01: each session now shows its own health details (consecutiveFailures, lastCheck, etc.)
    for (var i = 0; i < sessions.length; i++) {
      (function(s) {
        // Session name sub-header
        var headerEl = document.createElement('div');
        headerEl.className = 'session-sub-header';
        headerEl.textContent = s.name || s.sessionId;
        container.appendChild(headerEl);

        // Main session row
        var row = document.createElement('div');
        row.className = 'session-row';
        var nameEl = document.createElement('span');
        nameEl.style.cssText = 'flex:1;font-weight:500;color:var(--text-primary);';
        nameEl.textContent = s.name || s.sessionId;
        var roleEl = document.createElement('span');
        roleEl.style.cssText = 'background:' + roleBadgeColor(s.role) + ';color:#fff;font-size:0.72rem;padding:2px 8px;border-radius:9999px;';
        roleEl.textContent = s.role || 'unknown';
        var subRoleEl = document.createElement('span');
        subRoleEl.style.cssText = 'background:' + subRoleBadgeColor(s.subRole) + ';color:#fff;font-size:0.72rem;padding:2px 8px;border-radius:9999px;';
        subRoleEl.textContent = s.subRole || 'unknown';
        var dotEl = document.createElement('span');
        dotEl.style.cssText = 'width:8px;height:8px;border-radius:50%;display:inline-block;background:' + healthDotColor(s.healthy, s.healthStatus) + ';flex-shrink:0;';
        dotEl.setAttribute('title', 'Health: ' + (s.healthStatus || 'unknown'));
        var wahaEl = document.createElement('span');
        wahaEl.style.cssText = 'font-family:monospace;font-size:0.75rem;color:var(--text-secondary);';
        wahaEl.textContent = s.wahaStatus || 'UNKNOWN';
        row.appendChild(nameEl);
        row.appendChild(roleEl);
        row.appendChild(subRoleEl);
        row.appendChild(dotEl);
        row.appendChild(wahaEl);
        container.appendChild(row);

        // Health detail rows for this session (12-01, DASH-01)
        var detailEl = document.createElement('div');
        detailEl.className = 'session-health-detail';
        var consecutiveFailures = typeof s.consecutiveFailures === 'number' ? s.consecutiveFailures : 0;
        var lastCheck = s.lastCheck ? relTime(s.lastCheck) : 'never';
        detailEl.textContent = 'Health: ' + (s.healthStatus || 'unknown') +
          ' | Consecutive Failures: ' + consecutiveFailures +
          ' | Last Check: ' + lastCheck;
        container.appendChild(detailEl);
      })(sessions[i]);
    }
  } catch(e) {
    console.warn('[waha] loadDashboardSessions failed:', e.message || e);
  }
}

// ---- Sessions Tab (Phase 4, Plan 04) ----
// Phase 11, Plan 01 (SESS-01): saveSessionRole -- save role/subRole via PUT endpoint. DO NOT REMOVE.
// Phase 12, Plan 02 (UI-03): Optimistic UI — do NOT call loadSessions() on success (causes flicker).
//   The dropdown already shows the new value (user just changed it). On error, revert to old value.
//   On 502 (gateway restarting), show polling overlay via showSessionRestartOverlay().
async function saveSessionRole(sessionId, role, subRole, selectEl, prevVal) {
  try {
    var body = {};
    if (role !== null) body.role = role;
    if (subRole !== null) body.subRole = subRole;
    var r = await fetch('/api/admin/sessions/' + encodeURIComponent(sessionId) + '/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (r.status === 502) {
      // UI-04: Gateway is restarting — show polling overlay instead of raw error
      showSessionRestartOverlay();
      return;
    }
    if (r.ok) {
      // BUG-04 fix: Update data-prev to new value so future changes have correct revert target.
      // Update dropdown background color to match new value. Show amber "restart required" notice.
      // DO NOT call loadSessions() here — it re-renders everything and resets dropdowns. DO NOT CHANGE.
      if (selectEl) {
        selectEl.dataset.prev = selectEl.value;
        // Update background color to match new selection
        if (role !== null) selectEl.style.background = roleBadgeColor(role);
        if (subRole !== null) selectEl.style.background = subRoleBadgeColor(subRole);
        // Show amber "restart required" notice under the dropdown's parent container
        var parentDiv = selectEl.parentElement;
        if (parentDiv) {
          var existingNotice = parentDiv.querySelector('.restart-notice');
          if (!existingNotice) {
            var notice = document.createElement('div');
            notice.className = 'restart-notice';
            notice.style.cssText = 'color:var(--warning);font-weight:600;font-size:0.7rem;margin-top:3px;white-space:nowrap;';
            notice.textContent = 'Restart required';
            parentDiv.appendChild(notice);
          }
        }
      }
      showToast('Saved. Restart required for changes to take effect.');
    } else {
      var errData = await r.json().catch(function() { return {}; });
      // Revert dropdown to previous value on error
      if (selectEl && prevVal != null) selectEl.value = prevVal;
      showToast(errData.error || 'Failed to save role', true);
    }
  } catch(e) {
    // Network error (e.g. server dropped connection during restart) — show overlay
    showSessionRestartOverlay();
  }
}

// Phase 12, Plan 02 (UI-04): Show a polling overlay when a 502 occurs during session role save.
// Reuses the same pattern as saveAndRestart() but polls /api/admin/sessions instead of /api/admin/stats.
// DO NOT REMOVE — 502 happens when gateway is mid-restart.
function showSessionRestartOverlay() {
  // Avoid duplicate overlays
  if (document.getElementById('restart-overlay')) return;
  var overlay = document.createElement('div');
  overlay.id = 'restart-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;';
  var inner = document.createElement('div');
  inner.style.cssText = 'text-align:center;';
  var title = document.createElement('div');
  title.style.cssText = 'font-size:1.5em;font-weight:bold;margin-bottom:16px;';
  title.textContent = 'Gateway restarting...';
  inner.appendChild(title);
  var spinStyle = document.createElement('style');
  spinStyle.textContent = '.spin{display:inline-block;width:36px;height:36px;border:4px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;}@keyframes spin{to{transform:rotate(360deg);}}';
  inner.appendChild(spinStyle);
  var spinWrap = document.createElement('div');
  spinWrap.style.cssText = 'margin-bottom:24px;';
  var spinEl = document.createElement('div');
  spinEl.className = 'spin';
  spinWrap.appendChild(spinEl);
  inner.appendChild(spinWrap);
  var statusEl = document.createElement('div');
  statusEl.id = 'restart-status';
  statusEl.style.cssText = 'font-size:0.95em;color:#aaa;';
  statusEl.textContent = 'Waiting for server...';
  inner.appendChild(statusEl);
  var manualEl = document.createElement('div');
  manualEl.id = 'restart-manual';
  manualEl.style.cssText = 'display:none;margin-top:20px;';
  var refreshBtn = document.createElement('button');
  refreshBtn.style.cssText = 'padding:10px 24px;font-size:1em;cursor:pointer;background:#3b82f6;color:#fff;border:none;border-radius:6px;';
  refreshBtn.textContent = 'Refresh Manually';
  refreshBtn.onclick = function() { location.reload(); };
  manualEl.appendChild(refreshBtn);
  inner.appendChild(manualEl);
  overlay.appendChild(inner);
  document.body.appendChild(overlay);
  pollSessionsUntilReady(Date.now());
}
function pollSessionsUntilReady(startedAt) {
  var statusEl = document.getElementById('restart-status');
  var manualEl = document.getElementById('restart-manual');
  var elapsed = Math.floor((Date.now() - startedAt) / 1000);
  if (Date.now() - startedAt >= 30000) {
    if (statusEl) statusEl.textContent = 'Gateway did not respond within 30s. Try refreshing manually.';
    if (manualEl) manualEl.style.display = '';
    return;
  }
  if (statusEl) statusEl.textContent = 'Waiting for server... ' + elapsed + 's elapsed';
  setTimeout(function() {
    fetch('/api/admin/sessions').then(function(r) {
      if (r.ok) {
        var ov = document.getElementById('restart-overlay');
        if (ov) ov.remove();
        loadSessions();
      } else {
        pollSessionsUntilReady(startedAt);
      }
    }).catch(function() {
      pollSessionsUntilReady(startedAt);
    });
  }, 2000);
}

// BUG-04/BUG-05: "Save & Restart" button for the Sessions tab.
// Triggers gateway restart and shows polling overlay (reuses showSessionRestartOverlay).
// DO NOT REMOVE — this is the only way for session role changes to take effect without manual restart.
async function sessionsSaveAndRestart() {
  if (!confirm('This will restart the gateway to apply session role changes. Continue?')) return;
  try {
    await fetch('/api/admin/restart', { method: 'POST' });
  } catch(e) { /* expected — server drops connection during restart */ }
  // Show polling overlay — same as 502 handler
  showSessionRestartOverlay();
}

// fetchWithRetry: wraps fetch with a timeout (8s) and one automatic retry on network failure.
// Handles transient "Failed to fetch" errors caused by gateway restarts or proxy hiccups.
// DO NOT REMOVE — without this, any tab that fetches data will show a permanent error if the
// first request fails (e.g. during gateway restart), with no way to recover except manual refresh.
async function fetchWithRetry(url, opts, retries) {
  retries = typeof retries === 'number' ? retries : 1;
  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      var controller = new AbortController();
      var timeoutId = setTimeout(function() { controller.abort(); }, 8000);
      var mergedOpts = Object.assign({}, opts || {}, { signal: controller.signal });
      var r = await fetch(url, mergedOpts);
      clearTimeout(timeoutId);
      return r;
    } catch(err) {
      clearTimeout(timeoutId);
      if (attempt < retries) {
        // Wait 1s before retrying on network error
        await new Promise(function(resolve) { setTimeout(resolve, 1000); });
        continue;
      }
      throw err;
    }
  }
}

async function loadSessions() {
  var container = document.getElementById('sessions-list');
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
  var loadingEl = document.createElement('div');
  loadingEl.style.cssText = 'color:var(--text-muted);font-size:0.85rem;';
  loadingEl.textContent = 'Loading...';
  container.appendChild(loadingEl);
  try {
    var r = await fetchWithRetry('/api/admin/sessions');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var sessions = await r.json();
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      var noneEl = document.createElement('div');
      noneEl.style.cssText = 'color:var(--text-muted);font-size:0.85rem;';
      noneEl.textContent = 'No sessions configured.';
      container.appendChild(noneEl);
      return;
    }
    var html = sessions.map(function(s) {
      var displayName = esc(s.name || s.sessionId);
      var sessionId = esc(s.sessionId || '');
      var dotColor = healthDotColor(s.healthy, s.healthStatus);
      var dotTitle = 'Health: ' + esc(s.healthStatus || 'unknown');
      var lastCheckStr = s.lastCheck ? relTime(s.lastCheck) : 'never';
      var wahaStatus = esc(s.wahaStatus || 'UNKNOWN');
      // Phase 11, Plan 01 (SESS-01): role/subRole are dropdowns. DO NOT revert to static spans.
      // Phase 12, Plan 02 (UI-03, UX-01): Optimistic UI — pass this + data-prev for revert on error.
      //   data-prev is set by onmousedown (captures value before change).
      //   Labels added above each dropdown. DO NOT REMOVE.
      var roleSelect =
        '<div style="display:inline-flex;flex-direction:column;align-items:flex-start;">' +
          '<label style="display:block;font-size:0.75rem;color:#90a4ae;margin-bottom:2px;">Role</label>' +
          '<select data-prev="' + esc(s.role || 'bot') + '" onmousedown="this.dataset.prev=this.value" onchange="saveSessionRole(' + "'" + esc(s.sessionId) + "'" + ',this.value,null,this,this.dataset.prev)" style="background:' + roleBadgeColor(s.role) + ';color:#fff;font-size:0.72rem;padding:2px 6px;border-radius:6px;border:1px solid #475569;cursor:pointer;">' +
            '<option value="bot"' + (s.role === 'bot' ? ' selected' : '') + '>bot</option>' +
            '<option value="human"' + (s.role === 'human' ? ' selected' : '') + '>human</option>' +
          '</select>' +
        '</div>';
      var subRoleSelect =
        '<div style="display:inline-flex;flex-direction:column;align-items:flex-start;margin-left:8px;">' +
          '<label style="display:block;font-size:0.75rem;color:#90a4ae;margin-bottom:2px;">Sub-Role</label>' +
          '<select data-prev="' + esc(s.subRole || 'full-access') + '" onmousedown="this.dataset.prev=this.value" onchange="saveSessionRole(' + "'" + esc(s.sessionId) + "'" + ',null,this.value,this,this.dataset.prev)" style="background:' + subRoleBadgeColor(s.subRole) + ';color:#fff;font-size:0.72rem;padding:2px 6px;border-radius:6px;border:1px solid #475569;cursor:pointer;">' +
            '<option value="full-access"' + (s.subRole === 'full-access' ? ' selected' : '') + '>full-access</option>' +
            '<option value="listener"' + (s.subRole === 'listener' ? ' selected' : '') + '>listener</option>' +
          '</select>' +
        '</div>';
      return '<div class="contact-card">' +
        '<div class="contact-header" style="cursor:default;">' +
          '<div class="avatar" style="background:' + roleBadgeColor(s.role) + ';font-size:0.85rem;">' + esc((s.name || s.sessionId || '?').substring(0, 2).toUpperCase()) + '</div>' +
          '<div class="contact-info">' +
            '<div class="contact-name">' + displayName + '</div>' +
            '<div class="contact-jid">' + sessionId + '</div>' +
          '</div>' +
          '<div class="contact-meta">' +
            roleSelect +
            subRoleSelect +
            '<span style="display:inline-flex;align-items:center;gap:5px;margin-left:8px;font-size:0.78rem;color:var(--text-secondary);" title="' + dotTitle + '">' +
              '<span style="width:10px;height:10px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;display:inline-block;"></span>' +
              esc(s.healthStatus || 'unknown') +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div style="padding:8px 16px 12px;border-top:1px solid var(--border);font-size:0.78rem;display:grid;grid-template-columns:130px 1fr;gap:4px 12px;background:var(--bg-hover);">' +
          '<span style="color:var(--text-muted);">WAHA Status</span><span style="font-family:monospace;color:var(--text-primary);">' + wahaStatus + '</span>' +
          '<span style="color:var(--text-muted);">Failures</span><span style="color:var(--text-primary);">' + esc(String(s.consecutiveFailures ?? 0)) + '</span>' +
          '<span style="color:var(--text-muted);">Last Check</span><span style="color:var(--text-primary);">' + esc(lastCheckStr) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    // Phase 12, Plan 02 (UX-01): Append explanatory text box after session rows. DO NOT REMOVE.
    html += '<div class="sessions-explainer" style="font-size:0.78rem;color:var(--explainer-text);background:var(--explainer-bg);padding:10px 12px;border-radius:6px;margin-top:12px;line-height:1.6;">' +
      '<strong style="display:block;margin-bottom:4px;color:var(--explainer-label);">Role Options:</strong>' +
      'bot — AI-controlled session, processes messages automatically<br>' +
      'human — User-controlled session, messages monitored but not auto-responded to<br>' +
      '<strong style="display:block;margin-top:8px;margin-bottom:4px;color:var(--explainer-label);">Sub-Role Options:</strong>' +
      'full-access — Can send and receive messages<br>' +
      'listener — Can only receive/monitor messages, outgoing sends are blocked' +
    '</div>';
    container.innerHTML = html;
  } catch(e) {
    while (container.firstChild) container.removeChild(container.firstChild);
    var errEl = document.createElement('div');
    errEl.style.cssText = 'color:var(--error);font-size:0.85rem;';
    errEl.textContent = 'Failed to load sessions: ' + (e.message || String(e));
    container.appendChild(errEl);
  }
}

// ---- Modules Tab (Phase 17, Plan 03 — MOD-03, MOD-04) ----
// DO NOT REMOVE: Renders registered modules with enable/disable toggles and assignment management.
async function loadModules() {
  var listEl = document.getElementById('modules-list');
  var emptyEl = document.getElementById('modules-empty');
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">Loading...</div>';
  emptyEl.style.display = 'none';
  try {
    var r = await fetchWithRetry('/api/admin/modules');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var data = await r.json();
    var modules = data.modules || [];
    listEl.innerHTML = '';
    if (modules.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    modules.forEach(function(mod) {
      var card = document.createElement('div');
      card.style.cssText = 'background:var(--bg-tertiary);border-radius:10px;margin-bottom:14px;overflow:hidden;border:1px solid var(--border-light);';
      var toggleId = 'mod-toggle-' + mod.id;
      var assignSectionId = 'mod-assign-' + mod.id;
      var assignListId = 'mod-assign-list-' + mod.id;
      var headerHtml =
        '<div style="padding:14px 16px;display:flex;align-items:flex-start;justify-content:space-between;">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:0.95rem;font-weight:600;color:var(--text-primary);">' + esc(mod.name) + '</div>' +
            '<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:2px;">' + esc(mod.description || '') + '</div>' +
            '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">v' + esc(mod.version || '') +
              ' &bull; <span id="mod-count-' + esc(mod.id) + '">' + esc(String(mod.assignmentCount || 0)) + '</span> chat(s) assigned</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;margin-left:12px;">' +
            '<label class="toggle" title="' + (mod.enabled ? 'Enabled' : 'Disabled') + '">' +
              '<input type="checkbox" id="' + esc(toggleId) + '"' + (mod.enabled ? ' checked' : '') +
                ' onchange="toggleModule(' + "'" + esc(mod.id) + "'" + ', this)">' +
              '<span class="slider"></span>' +
            '</label>' +
          '</div>' +
        '</div>';
      var assignHtml =
        '<details style="border-top:1px solid var(--border-light);" id="' + esc(assignSectionId) + '">' +
          '<summary style="padding:10px 16px;cursor:pointer;font-size:0.82rem;color:var(--text-secondary);list-style:none;display:flex;align-items:center;gap:6px;">' +
            '<span style="font-size:0.7rem;">&#9654;</span> Chat Assignments' +
          '</summary>' +
          '<div style="padding:12px 16px 16px;background:var(--bg-primary);">' +
            '<div id="' + esc(assignListId) + '" style="margin-bottom:10px;"></div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
              '<input type="text" id="mod-jid-input-' + esc(mod.id) + '" placeholder="Chat JID (e.g. 123@c.us)" style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:0.82rem;">' +
              '<button onclick="addModuleAssignment(' + "'" + esc(mod.id) + "'" + ')" style="padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:0.78rem;cursor:pointer;">Add</button>' +
            '</div>' +
          '</div>' +
        '</details>';
      card.innerHTML = headerHtml + assignHtml;
      listEl.appendChild(card);
      // Load assignments for this module
      loadModuleAssignments(mod.id);
      // Wire toggle on details to lazy-load
      var details = document.getElementById(assignSectionId);
      if (details) {
        details.addEventListener('toggle', function() {
          if (details.open) loadModuleAssignments(mod.id);
        });
      }
    });
  } catch(e) {
    listEl.innerHTML = '<div style="color:var(--error);font-size:0.85rem;">Failed to load modules: ' + esc(e.message || String(e)) + '</div>';
  }
}

async function loadModuleAssignments(moduleId) {
  var listEl = document.getElementById('mod-assign-list-' + moduleId);
  var countEl = document.getElementById('mod-count-' + moduleId);
  if (!listEl) return;
  listEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.78rem;">Loading...</span>';
  try {
    var r = await fetch('/api/admin/modules/' + encodeURIComponent(moduleId) + '/assignments');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var data = await r.json();
    var assignments = data.assignments || [];
    if (countEl) countEl.textContent = String(assignments.length);
    if (assignments.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem;">No chats assigned.</div>';
      return;
    }
    listEl.innerHTML = assignments.map(function(jid) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-light);">' +
        '<span style="font-size:0.8rem;color:var(--text-primary);font-family:monospace;">' + esc(jid) + '</span>' +
        '<button onclick="removeModuleAssignment(' + "'" + esc(moduleId) + "','" + esc(jid) + "'" + ')" style="background:none;border:none;color:var(--error);cursor:pointer;font-size:0.85rem;padding:2px 6px;" title="Remove">&times;</button>' +
      '</div>';
    }).join('');
  } catch(e) {
    listEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem;">Failed to load assignments.</div>';
  }
}

async function toggleModule(moduleId, checkbox) {
  var action = checkbox.checked ? 'enable' : 'disable';
  try {
    var r = await fetch('/api/admin/modules/' + encodeURIComponent(moduleId) + '/' + action, { method: 'PUT' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    showToast('Module ' + action + 'd');
  } catch(e) {
    // Revert optimistic UI
    checkbox.checked = !checkbox.checked;
    showToast('Failed to ' + action + ' module: ' + (e.message || String(e)), true);
  }
}

async function addModuleAssignment(moduleId) {
  var input = document.getElementById('mod-jid-input-' + moduleId);
  if (!input) return;
  var jid = input.value.trim();
  if (!jid) { showToast('Enter a chat JID first', true); return; }
  try {
    var r = await fetch('/api/admin/modules/' + encodeURIComponent(moduleId) + '/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid: jid })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    input.value = '';
    showToast('Chat assigned to module');
    loadModuleAssignments(moduleId);
  } catch(e) {
    showToast('Failed to add assignment: ' + (e.message || String(e)), true);
  }
}

async function removeModuleAssignment(moduleId, jid) {
  try {
    var r = await fetch('/api/admin/modules/' + encodeURIComponent(moduleId) + '/assignments/' + encodeURIComponent(jid), {
      method: 'DELETE'
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    showToast('Assignment removed');
    loadModuleAssignments(moduleId);
  } catch(e) {
    showToast('Failed to remove assignment: ' + (e.message || String(e)), true);
  }
}

// ---- Settings ----
async function loadConfig() {
  try {
    var r = await fetchWithRetry('/api/admin/config');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();
    var w = d.waha || {};
    var NL = String.fromCharCode(10);
    var setVal = function(id, v) { var el = document.getElementById(id); if (el) el.value = v != null ? v : ''; };
    var setChk = function(id, v) { var el = document.getElementById(id); if (el) el.checked = Boolean(v); };
    setVal('s-baseUrl', w.baseUrl || '');
    // Populate session picker from WAHA API
    (async function() {
      var sel = document.getElementById('s-session');
      if (!sel) return;
      try {
        var sr = await fetchWithRetry('/api/admin/sessions');
        if (sr.ok) {
          var sessions = await sr.json();
          var currentSession = w.session || '';
          sel.innerHTML = sessions.map(function(s) {
            // Phase 4, Plan 04: sessions endpoint now returns enriched objects with sessionId + name.
            // Use sessionId as value (matches config w.session), show name as label.
            var sessionId = typeof s === 'string' ? s : (s.sessionId || s.name || s.id || JSON.stringify(s));
            var label = typeof s === 'string' ? s : (s.name || s.sessionId || s.id || sessionId);
            return '<option value="' + esc(sessionId) + '"' + (sessionId === currentSession ? ' selected' : '') + '>' + esc(label) + '</option>';
          }).join('') || '<option value="' + esc(currentSession) + '" selected>' + esc(currentSession || 'unknown') + '</option>';
        }
      } catch(e) {
        var cur = w.session || '';
        sel.innerHTML = '<option value="' + esc(cur) + '" selected>' + esc(cur || 'unknown') + '</option>';
      }
    })();
    setVal('s-webhookPort', w.webhookPort || 8050);
    setVal('s-webhookPath', w.webhookPath || '/webhook/waha');
    setVal('s-triggerWord', w.triggerWord || '');
    setVal('s-triggerResponseMode', w.triggerResponseMode || 'dm');
    // Phase 12, Plan 02 (UI-08): Auto-migrate pairing to allowlist — pairing is no longer supported.
    // DO NOT REMOVE — configs with dmPolicy=pairing must be silently migrated on load.
    if (w.dmPolicy === 'pairing') {
      w.dmPolicy = 'allowlist';
      showToast("DM Policy was set to 'pairing' which is no longer available. Migrated to 'allowlist'.", false);
      fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waha: { dmPolicy: 'allowlist' } })
      }).catch(function(e) { console.error('Migration failed:', e); showToast('Migration failed — please set DM Policy manually in Access Control', true); });
    }
    setVal('s-dmPolicy', w.dmPolicy || 'allowlist');
    setVal('s-groupPolicy', w.groupPolicy || 'allowlist');
    // Phase 8, UI-02 -- Tag Input components replace textareas for JID lists. DO NOT REVERT to setVal.
    // Phase 14 (NAME-01): resolveNames:true enables pill name resolution via /api/admin/directory/resolve. DO NOT REMOVE.
    if (!tagInputAllowFrom) tagInputAllowFrom = createTagInput('s-allowFrom-ti', { placeholder: '972544329000@c.us', resolveNames: true });
    if (!tagInputGroupAllowFrom) tagInputGroupAllowFrom = createTagInput('s-groupAllowFrom-ti', { placeholder: 'Phone or JID, press Enter', resolveNames: true });
    if (!tagInputAllowedGroups) tagInputAllowedGroups = createTagInput('s-allowedGroups-ti', { placeholder: '120363421825201386@g.us', resolveNames: true });
    if (tagInputAllowFrom) tagInputAllowFrom.setValue(w.allowFrom || []);
    if (tagInputGroupAllowFrom) tagInputGroupAllowFrom.setValue(w.groupAllowFrom || []);
    if (tagInputAllowedGroups) tagInputAllowedGroups.setValue(w.allowedGroups || []);
    var dm = w.dmFilter || {};
    setChk('s-dmFilterEnabled', dm.enabled);
    // Phase 12, UX-05 -- DM Mention Patterns tag input replaces textarea. DO NOT REVERT to setVal/splitLines.
    if (!dmMentionPatternsInput) dmMentionPatternsInput = createTagInput('dm-mention-patterns', { placeholder: 'Add pattern and press Enter...' });
    if (dmMentionPatternsInput) dmMentionPatternsInput.setValue(dm.mentionPatterns || []);
    setChk('s-godModeBypass', dm.godModeBypass !== false);
    setVal('s-godModeScope', dm.godModeScope || 'all');
    // Phase 8, UI-04 -- God Mode Users Field (Contact Picker with paired JID support)
    if (!godModePickerDm) godModePickerDm = createGodModeUsersField('s-godModeSuperUsers-cp', { placeholder: 'Search god mode users...' });
    if (godModePickerDm) godModePickerDm.setValue(dm.godModeSuperUsers || []);
    setVal('s-tokenEstimate', dm.tokenEstimate || 2500);
    var gf = w.groupFilter || {};
    setChk('s-groupFilterEnabled', gf.enabled);
    // triggerOperator UI removed — backend hardcodes OR.
    globalTriggerOperator = 'OR';
    // Phase 12, UX-05 -- Group Mention Patterns tag input replaces textarea. DO NOT REVERT to setVal/splitLines.
    if (!groupMentionPatternsInput) groupMentionPatternsInput = createTagInput('group-mention-patterns', { placeholder: 'Add pattern and press Enter...' });
    if (groupMentionPatternsInput) groupMentionPatternsInput.setValue(gf.mentionPatterns || []);
    setChk('s-groupGodModeBypass', gf.godModeBypass !== false);
    setVal('s-groupGodModeScope', gf.godModeScope || 'all');
    // Phase 8, UI-04 -- God Mode Users Field (Contact Picker with paired JID support)
    if (!godModePickerGroup) godModePickerGroup = createGodModeUsersField('s-groupGodModeSuperUsers-cp', { placeholder: 'Search god mode users...' });
    if (godModePickerGroup) godModePickerGroup.setValue(gf.godModeSuperUsers || []);
    setVal('s-groupTokenEstimate', gf.tokenEstimate || 2500);
    var pr = w.presence || {};
    setChk('s-presenceEnabled', pr.enabled !== false);
    setChk("s-sendSeen", pr.sendSeen === true);
    setVal('s-wpm', pr.wpm || 42);
    setVal('s-readDelayMin', (pr.readDelayMs || [500])[0]);
    setVal('s-readDelayMax', (pr.readDelayMs || [500, 4000])[1]);
    setVal('s-msPerReadChar', pr.msPerReadChar || 30);
    setVal('s-typingMin', (pr.typingDurationMs || [1500])[0]);
    setVal('s-typingMax', (pr.typingDurationMs || [1500, 15000])[1]);
    setVal('s-pauseChance', pr.pauseChance != null ? pr.pauseChance : 0.3);
    setVal('s-pauseDurMin', (pr.pauseDurationMs || [500])[0]);
    setVal('s-pauseDurMax', (pr.pauseDurationMs || [500, 2000])[1]);
    setVal('s-pauseIntMin', (pr.pauseIntervalMs || [2000])[0]);
    setVal('s-pauseIntMax', (pr.pauseIntervalMs || [2000, 5000])[1]);
    setVal('s-jitterMin', (pr.jitter || [0.7])[0]);
    setVal('s-jitterMax', (pr.jitter || [0.7, 1.3])[1]);
    var md = w.markdown || {};
    setChk('s-markdownEnabled', md.enabled !== false);
    setVal('s-markdownTables', md.tables || 'auto');
    // Phase 12, Plan 02 (INIT-01): Global Can Initiate toggle. Default true. DO NOT REMOVE.
    setChk('canInitiateGlobal', w.canInitiateGlobal !== false);
    // Phase 16: Pairing Mode config load. DO NOT REMOVE.
    var pm = w.pairingMode || {};
    setChk('pairingEnabled', pm.enabled === true);
    setVal('pairingPasscode', pm.passcode || '');
    setVal('pairingGrantTtl', String(pm.grantTtlMinutes || 1440));
    setVal('pairingChallengeMsg', pm.challengeMessage || 'Welcome! Please enter the 6-digit passcode to get started.');
    document.getElementById('pairingFields').style.display = pm.enabled ? '' : 'none';
    // Phase 16: Auto-Reply config load. DO NOT REMOVE.
    var ar = w.autoReply || {};
    setChk('autoReplyEnabled', ar.enabled === true);
    setVal('autoReplyMessage', ar.message || 'Hey! Thanks for reaching out. Unfortunately, I\\'m not permitted to chat with you right now. Please ask the admin to add you to the allow list.');
    setVal('autoReplyInterval', String(ar.intervalMinutes || 1440));
    document.getElementById('autoReplyFields').style.display = ar.enabled ? '' : 'none';
    setChk('s-reactions', (w.actions || {}).reactions !== false);
    setChk('s-blockStreaming', w.blockStreaming === true);
    var mp = w.mediaPreprocessing || {};
    setChk('s-mediaEnabled', mp.enabled === true);
    setChk('s-audioTranscription', mp.audioTranscription !== false);
    setChk('s-imageAnalysis', mp.imageAnalysis !== false);
    setChk('s-videoAnalysis', mp.videoAnalysis !== false);
    setChk('s-locationResolution', mp.locationResolution !== false);
    setChk('s-vcardParsing', mp.vcardParsing !== false);
    setChk('s-documentAnalysis', mp.documentAnalysis !== false);
    toggleMediaSubToggles();
  } catch(e) {
    showToast('Failed to load config: ' + e.message, true);
  }
}
async function saveSettings(e) {
  if (e && e.preventDefault) e.preventDefault();
  var getVal = function(id) { return document.getElementById(id)?.value || ''; };
  var getChk = function(id) { return document.getElementById(id)?.checked || false; };
  var splitLines = function(s) { return s.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean); };
  var parseNum = function(s, def) { var n = parseFloat(s); return isNaN(n) ? def : n; };
  var payload = {
    waha: {
      baseUrl: getVal('s-baseUrl') || undefined,
      webhookPort: parseNum(getVal('s-webhookPort'), 8050),
      webhookPath: getVal('s-webhookPath') || '/webhook/waha',
      triggerWord: getVal('s-triggerWord') || undefined,
      triggerResponseMode: getVal('s-triggerResponseMode') || 'dm',
      dmPolicy: getVal('s-dmPolicy') || 'allowlist',
      groupPolicy: getVal('s-groupPolicy') || 'allowlist',
      // Phase 8, UI-02 -- read from Tag Input components. DO NOT REVERT to splitLines(getVal(...)).
      allowFrom: tagInputAllowFrom ? tagInputAllowFrom.getValue() : [],
      groupAllowFrom: tagInputGroupAllowFrom ? tagInputGroupAllowFrom.getValue() : [],
      allowedGroups: tagInputAllowedGroups ? tagInputAllowedGroups.getValue() : [],
      dmFilter: {
        enabled: getChk('s-dmFilterEnabled'),
        // Phase 12, UX-05 -- read from Mention Patterns tag input. DO NOT REVERT to splitLines(getVal(...)).
        mentionPatterns: dmMentionPatternsInput ? dmMentionPatternsInput.getValue() : [],
        godModeBypass: getChk('s-godModeBypass'),
        godModeScope: getVal('s-godModeScope') || 'all',
        // Phase 8, UI-04 -- read from God Mode Users Field. DO NOT REVERT to splitLines(getVal(...)).
        godModeSuperUsers: godModePickerDm ? godModePickerDm.getValue().map(function(id) { return { identifier: id }; }) : [],
        tokenEstimate: parseNum(getVal('s-tokenEstimate'), 2500),
      },
      groupFilter: {
        enabled: getChk('s-groupFilterEnabled'),
        // Phase 12, UX-05 -- read from Group Mention Patterns tag input. DO NOT REVERT to splitLines(getVal(...)).
        mentionPatterns: groupMentionPatternsInput ? groupMentionPatternsInput.getValue() : [],
        godModeBypass: getChk('s-groupGodModeBypass'),
        godModeScope: getVal('s-groupGodModeScope') || 'all',
        // Phase 8, UI-04 -- read from God Mode Users Field. DO NOT REVERT to splitLines(getVal(...)).
        godModeSuperUsers: godModePickerGroup ? godModePickerGroup.getValue().map(function(id) { return { identifier: id }; }) : [],
        tokenEstimate: parseNum(getVal('s-groupTokenEstimate'), 2500),
      },
      presence: {
        enabled: getChk('s-presenceEnabled'),
        sendSeen: getChk("s-sendSeen"),
        wpm: parseNum(getVal('s-wpm'), 42),
        readDelayMs: [parseNum(getVal('s-readDelayMin'), 500), parseNum(getVal('s-readDelayMax'), 4000)],
        msPerReadChar: parseNum(getVal('s-msPerReadChar'), 30),
        typingDurationMs: [parseNum(getVal('s-typingMin'), 1500), parseNum(getVal('s-typingMax'), 15000)],
        pauseChance: parseNum(getVal('s-pauseChance'), 0.3),
        pauseDurationMs: [parseNum(getVal('s-pauseDurMin'), 500), parseNum(getVal('s-pauseDurMax'), 2000)],
        pauseIntervalMs: [parseNum(getVal('s-pauseIntMin'), 2000), parseNum(getVal('s-pauseIntMax'), 5000)],
        jitter: [parseNum(getVal('s-jitterMin'), 0.7), parseNum(getVal('s-jitterMax'), 1.3)],
      },
      markdown: {
        enabled: getChk('s-markdownEnabled'),
        tables: getVal('s-markdownTables') || 'auto',
      },
      // Phase 12, Plan 02 (INIT-01): Global Can Initiate toggle. DO NOT REMOVE.
      canInitiateGlobal: getChk('canInitiateGlobal'),
      // Phase 16: Pairing Mode config save. DO NOT REMOVE.
      pairingMode: {
        enabled: getChk('pairingEnabled'),
        passcode: document.getElementById('pairingPasscode').value || undefined,
        grantTtlMinutes: parseInt(document.getElementById('pairingGrantTtl').value) || 1440,
        challengeMessage: document.getElementById('pairingChallengeMsg').value || undefined,
      },
      // Phase 16: Auto-Reply config save. DO NOT REMOVE.
      autoReply: {
        enabled: getChk('autoReplyEnabled'),
        message: document.getElementById('autoReplyMessage').value || undefined,
        intervalMinutes: parseInt(document.getElementById('autoReplyInterval').value) || 1440,
      },
      actions: { reactions: getChk('s-reactions') },
      blockStreaming: getChk('s-blockStreaming'),
      mediaPreprocessing: {
        enabled: getChk('s-mediaEnabled'),
        audioTranscription: getChk('s-audioTranscription'),
        imageAnalysis: getChk('s-imageAnalysis'),
        videoAnalysis: getChk('s-videoAnalysis'),
        locationResolution: getChk('s-locationResolution'),
        vcardParsing: getChk('s-vcardParsing'),
        documentAnalysis: getChk('s-documentAnalysis'),
      },
    }
  };
  try {
    var r = await fetch('/api/admin/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    var result = await r.json();
    if (!r.ok) throw new Error(result.error || 'Save failed');
    showToast('Settings saved' + (result.restartRequired ? ' (restart required)' : ''));
    if (result.restartRequired) document.getElementById('save-note').style.display = 'block';
    else document.getElementById('save-note').style.display = 'none';
    return true;
  } catch(e) {
    showToast('Error: ' + e.message, true);
    return false;
  }
}

// ---- Save & Restart ----
// DO NOT CHANGE — Uses pollUntilReady overlay to avoid 502 crash page when gateway restarts.
// The old code used a blind 5-second setTimeout which showed a Cloudflare 502 if restart took >5s.
// Now: shows fullscreen overlay, polls /api/admin/stats every 3s for up to 60s, auto-reloads on success.
async function saveAndRestart() {
  if (!confirm('Are you sure? This will save settings and restart the gateway. It will be back online in a few seconds.')) return;
  var saved = await saveSettings(null);
  if (!saved) {
    showToast('Save failed — restart cancelled. Fix the error above and try again.', true);
    return;
  }
  try {
    await fetch('/api/admin/restart', { method: 'POST' });
  } catch(e) { /* expected — Restarting: server drops connection before responding */ }
  // Show fullscreen overlay immediately — DO NOT revert to blind setTimeout reload
  var overlay = document.createElement('div');
  overlay.id = 'restart-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;';
  var inner = document.createElement('div');
  inner.style.cssText = 'text-align:center;';
  var title = document.createElement('div');
  title.style.cssText = 'font-size:1.5em;font-weight:bold;margin-bottom:16px;';
  title.textContent = 'Restarting gateway...';
  inner.appendChild(title);
  var spinStyle = document.createElement('style');
  spinStyle.textContent = '.spin{display:inline-block;width:36px;height:36px;border:4px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;}@keyframes spin{to{transform:rotate(360deg);}}';
  inner.appendChild(spinStyle);
  var spinWrap = document.createElement('div');
  spinWrap.style.cssText = 'margin-bottom:24px;';
  var spinEl = document.createElement('div');
  spinEl.className = 'spin';
  spinWrap.appendChild(spinEl);
  inner.appendChild(spinWrap);
  var statusEl = document.createElement('div');
  statusEl.id = 'restart-status';
  statusEl.style.cssText = 'font-size:0.95em;color:#aaa;';
  statusEl.textContent = 'Waiting for server...';
  inner.appendChild(statusEl);
  var manualEl = document.createElement('div');
  manualEl.id = 'restart-manual';
  manualEl.style.cssText = 'display:none;margin-top:20px;';
  var refreshBtn = document.createElement('button');
  refreshBtn.style.cssText = 'padding:10px 24px;font-size:1em;cursor:pointer;background:#3b82f6;color:#fff;border:none;border-radius:6px;';
  refreshBtn.textContent = 'Refresh Manually';
  refreshBtn.onclick = function() { location.reload(); };
  manualEl.appendChild(refreshBtn);
  inner.appendChild(manualEl);
  overlay.appendChild(inner);
  document.body.appendChild(overlay);
  pollUntilReady(Date.now());
}
function pollUntilReady(startedAt) {
  var statusEl = document.getElementById('restart-status');
  var manualEl = document.getElementById('restart-manual');
  var elapsed = Math.floor((Date.now() - startedAt) / 1000);
  if (Date.now() - startedAt >= 60000) {
    if (statusEl) statusEl.textContent = 'Gateway did not respond within 60s. Try refreshing manually.';
    if (manualEl) manualEl.style.display = '';
    return;
  }
  if (statusEl) statusEl.textContent = 'Waiting for server... ' + elapsed + 's elapsed';
  setTimeout(function() {
    fetch('/api/admin/stats').then(function(r) {
      if (r.ok) {
        location.reload();
      } else {
        pollUntilReady(startedAt);
      }
    }).catch(function() {
      pollUntilReady(startedAt);
    });
  }, 3000);
}

// ---- Media sub-toggles visibility ----
function toggleMediaSubToggles() {
  var masterEl = document.getElementById('s-mediaEnabled');
  var subDiv = document.getElementById('media-sub-toggles');
  if (masterEl && subDiv) subDiv.style.display = masterEl.checked ? 'grid' : 'none';
}

// ---- Phase 16: Pairing Mode and Auto-Reply UI logic ----
// Toggle show/hide for pairing fields section on checkbox change. DO NOT REMOVE.
document.getElementById('pairingEnabled').addEventListener('change', function() {
  document.getElementById('pairingFields').style.display = this.checked ? '' : 'none';
});
// Toggle show/hide for auto-reply fields section on checkbox change. DO NOT REMOVE.
document.getElementById('autoReplyEnabled').addEventListener('change', function() {
  document.getElementById('autoReplyFields').style.display = this.checked ? '' : 'none';
});
// Generate a random 6-digit passcode. DO NOT REMOVE.
document.getElementById('generatePasscode').addEventListener('click', function() {
  var code = String(Math.floor(100000 + Math.random() * 900000));
  document.getElementById('pairingPasscode').value = code;
});
// Generate wa.me deep link for a specific JID. Calls /api/admin/pairing/deeplink. DO NOT REMOVE.
document.getElementById('generateDeepLink').addEventListener('click', async function() {
  var jid = document.getElementById('pairingDeepLinkJid').value.trim();
  if (!jid) { showToast('Enter a JID first', true); return; }
  try {
    var r = await fetch('/api/admin/pairing/deeplink?jid=' + encodeURIComponent(jid));
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    document.getElementById('pairingDeepLink').value = d.link;
    showToast('Deep link generated');
  } catch(e) {
    showToast('Error: ' + e.message, true);
  }
});
// Copy deep link to clipboard. DO NOT REMOVE.
document.getElementById('copyDeepLink').addEventListener('click', function() {
  var el = document.getElementById('pairingDeepLink');
  if (el.value) {
    navigator.clipboard.writeText(el.value).then(function() { showToast('Link copied!'); }).catch(function() { showToast('Failed to copy', true); });
  }
});
// Revoke a pairing grant from the Directory tab. DO NOT REMOVE.
async function revokePairingGrant(jid) {
  if (!confirm('Revoke pairing access for ' + jid + '?')) return;
  try {
    var r = await fetch('/api/admin/pairing/grant/' + encodeURIComponent(jid), { method: 'DELETE' });
    if (!r.ok) { var d = await r.json(); throw new Error(d.error || 'Failed'); }
    showToast('Pairing access revoked');
    loadContactsTable && loadContactsTable();
  } catch(e) {
    showToast('Failed to revoke: ' + e.message, true);
  }
}

// ---- Directory sub-tabs ----
var currentDirTab = 'contacts';
var dirAutoImported = false;
// DIR-04: Bulk select mode state
var bulkSelectMode = false;
var bulkSelectedJids = new Set();
var bulkCurrentGroupJid = null;  // set when bulk-selecting participants within a group panel
function switchDirTab(tab, btn) {
  currentDirTab = tab;
  document.querySelectorAll('.dir-tab').forEach(function(el) { el.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  var searchEl = document.getElementById('dir-search');   // UX-04: clear on tab switch
  if (searchEl) searchEl.value = '';                      // UX-04: clear on tab switch
  dirOffset = 0;
  dirGroupPage = 1;  // DIR-01: reset groups page on tab switch
  dirContactPage = 1;  // Phase 13: reset contacts page on tab switch
  dirAutoImported = false;
  // DIR-04: Clear bulk selection state on tab switch (Pitfall 4)
  bulkSelectMode = false;
  bulkSelectedJids.clear();
  bulkCurrentGroupJid = null;
  updateBulkToolbar();
  loadDirectory();
}
// UX-04: Clear search bar and reload directory
// Phase 12, Plan 03 (UI-05): also hides the clear button after clearing
function clearDirSearch() {
  var el = document.getElementById('dir-search');
  if (el) el.value = '';
  var clearBtn = document.getElementById('dir-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  // BUG-07: Reset all pagination state when clearing search so results reload from page 1. DO NOT REMOVE.
  dirOffset = 0;
  dirGroupPage = 1;
  dirContactPage = 1;
  loadDirectory();
}
// ---- Sync status bar (Phase 13, SYNC-03) ----
// Updates the sync status bar at the top of the Directory tab.
// Fetches /api/admin/sync/status and updates #syncStatusIcon and #syncStatusText.
// All text set via textContent — no user data, no XSS risk.
// DO NOT REMOVE — status bar informs admin of background sync activity.
async function updateSyncStatus() {
  try {
    var r = await fetch('/api/admin/sync/status');
    var s = await r.json();
    var icon = document.getElementById('syncStatusIcon');
    var text = document.getElementById('syncStatusText');
    if (!icon || !text) return;
    if (s.status === 'running') {
      icon.textContent = '⟳';
      icon.style.animation = 'spin 1s linear infinite';
      text.textContent = 'Syncing' + (s.currentPhase ? ' ' + s.currentPhase + '...' : '...');
    } else if (s.status === 'error') {
      icon.textContent = '⚠';
      icon.style.animation = '';
      text.textContent = 'Sync error: ' + (s.lastError || 'unknown');
    } else {
      icon.textContent = '✓';
      icon.style.animation = '';
      if (s.lastSyncAt) {
        var ago = Math.round((Date.now() - s.lastSyncAt) / 60000);
        text.textContent = 'Last synced: ' + (ago < 1 ? 'just now' : ago + 'm ago') + ' (' + (s.itemsSynced || 0) + ' items)';
      } else {
        text.textContent = 'Sync not started yet';
      }
    }
  } catch (e) {
    // silently ignore -- status bar is informational
  }
}

// ---- Directory refresh ----
async function refreshDirectory() {
  var btn = document.getElementById('dir-refresh-all-btn');
  if (btn) { btn.textContent = 'Syncing...'; btn.disabled = true; }
  try {
    var r = await fetch('/api/admin/directory/refresh', { method: 'POST' });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Refresh failed');
    showToast('Sync triggered');
    // Poll sync status for a few seconds to show progress
    var pollCount = 0;
    var pollInterval = setInterval(function() {
      updateSyncStatus();
      pollCount++;
      if (pollCount >= 10) clearInterval(pollInterval);
    }, 1000);
    // Reload directory data after a short delay to show new entries
    setTimeout(function() { dirOffset = 0; loadDirectory(); }, 3000);
  } catch(e) {
    showToast('Refresh error: ' + e.message, true);
  } finally {
    if (btn) { btn.textContent = 'Refresh All'; btn.disabled = false; }
  }
}

// ---- DIR-04: Bulk select functions ----
function toggleBulkSelectMode() {
  bulkSelectMode = !bulkSelectMode;
  bulkSelectedJids.clear();
  bulkCurrentGroupJid = null;
  updateBulkToolbar();
  if (currentDirTab === 'groups') { loadGroupsTable(); } else if (currentDirTab === 'contacts') { loadContactsTable(); } else { dirOffset = 0; loadDirectory(); }
}
function toggleBulkItem(jid, checkbox) {
  if (checkbox.checked) { bulkSelectedJids.add(jid); } else { bulkSelectedJids.delete(jid); }
  updateBulkToolbar();
}
function updateBulkToolbar() {
  var toolbar = document.getElementById('bulk-toolbar');
  var btn = document.getElementById('bulk-select-btn');
  if (!toolbar) return;
  // Update select button style
  if (btn) {
    btn.textContent = bulkSelectMode ? 'Cancel' : 'Select';
    btn.style.background = bulkSelectMode ? '#ef4444' : '';
  }
  // Hide toolbar if not in bulk mode or no items selected
  if (!bulkSelectMode || bulkSelectedJids.size === 0) {
    toolbar.style.display = 'none';
    return;
  }
  toolbar.style.display = 'flex';
  var countEl = document.getElementById('bulk-count');
  if (countEl) { countEl.textContent = bulkSelectedJids.size + ' selected'; }
  // Rebuild action buttons based on context
  var actionsEl = document.getElementById('bulk-actions');
  if (!actionsEl) return;
  actionsEl.innerHTML = '';
  if (bulkCurrentGroupJid) {
    // Participant context: Allow Group / Revoke Group / Set Role
    actionsEl.innerHTML =
      '<button onclick="bulkAction(\\'allow-group\\')" style="background:#10b981;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Allow Group</button>' +
      '<button onclick="bulkAction(\\'revoke-group\\')" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Revoke Group</button>' +
      '<button onclick="bulkRoleAction()" style="background:#1d4ed8;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Set Role</button>';
  } else if (currentDirTab === 'newsletters') {
    // Channels context: Allow DM / Revoke DM / Follow / Unfollow
    actionsEl.innerHTML =
      '<button onclick="bulkAction(\\'allow-dm\\')" style="background:#10b981;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Allow DM</button>' +
      '<button onclick="bulkAction(\\'revoke-dm\\')" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Revoke DM</button>' +
      '<button onclick="bulkAction(\\'follow\\')" style="background:#1d4ed8;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Follow</button>' +
      '<button onclick="bulkAction(\\'unfollow\\')" style="background:var(--text-muted);color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Unfollow</button>';
  } else {
    // Contacts context: Allow DM / Revoke DM
    actionsEl.innerHTML =
      '<button onclick="bulkAction(\\'allow-dm\\')" style="background:#10b981;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Allow DM</button>' +
      '<button onclick="bulkAction(\\'revoke-dm\\')" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Revoke DM</button>';
  }
}
async function bulkAction(action) {
  var jids = Array.from(bulkSelectedJids);
  if (jids.length === 0) return;
  try {
    var body = { jids: jids, action: action, groupJid: bulkCurrentGroupJid };
    var r = await fetch('/api/admin/directory/bulk', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    showToast('Updated ' + d.updated + ' item' + (d.updated !== 1 ? 's' : ''));
    var savedGroupJid = bulkCurrentGroupJid;
    bulkSelectMode = false;
    bulkSelectedJids.clear();
    bulkCurrentGroupJid = null;
    updateBulkToolbar();
    if (savedGroupJid && (action === 'allow-group' || action === 'revoke-group')) {
      loadGroupParticipants(savedGroupJid, true);
    } else if (currentDirTab === 'groups') { loadGroupsTable(); } else if (currentDirTab === 'contacts') { loadContactsTable(); } else { dirOffset = 0; loadDirectory(); }
  } catch(e) { showToast('Bulk action failed: ' + e.message, true); }
}
async function bulkRoleAction() {
  var jids = Array.from(bulkSelectedJids);
  if (jids.length === 0 || !bulkCurrentGroupJid) return;
  var role = prompt('Enter role: bot_admin, manager, or participant', 'participant');
  if (!role) return;
  if (!['bot_admin', 'manager', 'participant'].includes(role)) {
    showToast('Invalid role. Must be bot_admin, manager, or participant', true);
    return;
  }
  try {
    var r = await fetch('/api/admin/directory/bulk', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ jids: jids, action: 'set-role', value: role, groupJid: bulkCurrentGroupJid })
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    showToast('Set role for ' + d.updated + ' participant' + (d.updated !== 1 ? 's' : ''));
    bulkSelectMode = false;
    bulkSelectedJids.clear();
    var savedGroupJid = bulkCurrentGroupJid;
    bulkCurrentGroupJid = null;
    updateBulkToolbar();
    loadGroupParticipants(savedGroupJid, true).catch(function(re) { showToast('Panel refresh failed: ' + (re instanceof Error ? re.message : String(re)), true); });
  } catch(e) { showToast('Bulk role failed: ' + e.message, true); }
}

// ---- Directory ----
var dirOffset = 0;
var dirSearchTimeout = null;
// DIR-01: Groups tab pagination state
var dirGroupPage = 1;
var dirGroupPageSize = 25;
// Phase 13: Contacts tab pagination state (mirrors groups tab pattern)
var dirContactPage = 1;
var dirContactPageSize = 25;
function debouncedDirSearch() {
  clearTimeout(dirSearchTimeout);
  // Phase 12, Plan 03 (UI-05): show/hide clear button based on input content
  var clearBtn = document.getElementById('dir-search-clear');
  var searchEl = document.getElementById('dir-search');
  if (clearBtn && searchEl) clearBtn.style.display = searchEl.value ? 'block' : 'none';
  dirSearchTimeout = setTimeout(function() { dirOffset = 0; dirGroupPage = 1; dirContactPage = 1; loadDirectory(); }, 300);
}
async function loadDirectory() {
  // Default to 'contacts' if currentDirTab not yet initialized (e.g., initial page load with #directory hash).
  // var hoisting means currentDirTab is undefined until its assignment line executes. DO NOT REMOVE.
  if (!currentDirTab) currentDirTab = 'contacts';
  // DIR-01: groups tab uses a separate paginated table renderer — do not use infinite-scroll path
  if (currentDirTab === 'groups') { return loadGroupsTable(); }
  // Phase 13: contacts tab uses paginated renderer matching groups tab
  if (currentDirTab === 'contacts') { return loadContactsTable(); }
  var search = document.getElementById('dir-search').value.trim();
  var typeParam = currentDirTab === 'contacts' ? '&type=contact' : '&type=newsletter';
  var url = '/api/admin/directory?limit=50&offset=' + (dirOffset || 0) + typeParam + (search ? '&search=' + encodeURIComponent(search) : '');
  try {
    var r = await fetchWithRetry(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();
    // Stale render guard — if tab switched to contacts/groups while newsletter fetch was in flight, discard.
    if (currentDirTab !== 'newsletters') return;
    document.getElementById('dir-stats').innerHTML =
      '<div class="dir-stat">Contacts <span>' + d.dms + '</span></div>' +
      '<div class="dir-stat">Groups <span>' + d.groups + '</span></div>' +
      '<div class="dir-stat">Newsletters <span>' + (d.newsletters || 0) + '</span></div>' +
      '<div class="dir-stat">Showing <span>' + d.total + '</span></div>';
    var list = document.getElementById('contact-list');
    if (dirOffset === 0) list.innerHTML = '';
    // Auto-import if empty
    if (dirOffset === 0 && d.total === 0 && !dirAutoImported) {
      dirAutoImported = true;
      refreshDirectory();
      return;
    }
    if (!d.contacts || d.contacts.length === 0) {
      if (dirOffset === 0) list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:32px;">No entries found.</div>';
      document.getElementById('load-more-btn').style.display = 'none';
      return;
    }
    d.contacts.forEach(function(c) { list.innerHTML += buildContactCard(c); });
    dirOffset += d.contacts.length;
    // Show Load More when there are more items to fetch. DO NOT use d.contacts.length === 50
    // because server-side @lid/@s.whatsapp.net filtering can reduce count below 50.
    var hasMore = dirOffset < d.total;
    document.getElementById('load-more-btn').style.display = hasMore ? '' : 'none';
  } catch(e) {
    document.getElementById('contact-list').innerHTML = '<div style="color:#ef4444;padding:16px;">Error loading directory: ' + esc(e.message) + '</div>';
  }
}
// Infinite scroll: auto-load when user scrolls near the bottom of the directory list
(function() {
  var mainEl = document.querySelector('main');
  if (!mainEl) return;
  var loading = false;
  mainEl.addEventListener('scroll', function() {
    if (loading) return;
    var btn = document.getElementById('load-more-btn');
    if (!btn || btn.style.display === 'none') return;
    // Trigger when within 200px of the bottom
    if (mainEl.scrollTop + mainEl.clientHeight >= mainEl.scrollHeight - 200) {
      loading = true;
      loadDirectory().finally(function() { loading = false; });
    }
  });
})();
// DIR-01: Navigate to a specific groups page — called from buildPageNav onclick handlers
function goGroupPage(page) { dirGroupPage = page; loadGroupsTable(); }
// Phase 13: Navigate to a specific contacts page — called from buildPageNav onclick handlers
function goContactPage(page) { dirContactPage = page; loadContactsTable(); }

// DIR-01 / Phase 13: Build page navigation HTML — pure function, returns '' for single-page results.
// goFn is the callback function name string (e.g. 'goGroupPage' or 'goContactPage').
// All button labels and onclick args are static integers — no user data, no XSS risk.
// DO NOT REMOVE — shared by groups and contacts tab pagination.
function buildPageNav(currentPage, totalPages, goFn) {
  if (totalPages <= 1) return '';
  var start = Math.max(1, currentPage - 2);
  var end = Math.min(totalPages, start + 4);
  start = Math.max(1, end - 4); // re-anchor if end hit the wall
  var sBase = 'padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:0.8rem;';
  var sDis  = 'padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:0.8rem;opacity:0.5;pointer-events:none;';
  var sCur  = 'padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--btn-primary);color:#fff;cursor:pointer;font-size:0.8rem;font-weight:bold;';
  var nav = '<div class="page-nav">';
  nav += '<button style="' + (currentPage <= 1 ? sDis : sBase) + '" onclick="' + goFn + '(1)">\\u00AB</button>';
  nav += '<button style="' + (currentPage <= 1 ? sDis : sBase) + '" onclick="' + goFn + '(' + (currentPage - 1) + ')">\\u2039</button>';
  for (var pg = start; pg <= end; pg++) {
    nav += '<button style="' + (pg === currentPage ? sCur : sBase) + '" onclick="' + goFn + '(' + pg + ')">' + pg + '</button>';
  }
  nav += '<button style="' + (currentPage >= totalPages ? sDis : sBase) + '" onclick="' + goFn + '(' + (currentPage + 1) + ')">\\u203A</button>';
  nav += '<button style="' + (currentPage >= totalPages ? sDis : sBase) + '" onclick="' + goFn + '(' + totalPages + ')">\\u00BB</button>';
  nav += '</div>';
  return nav;
}

// DIR-01: Render groups tab as a paginated table.
// Uses DOM methods (textContent / createElement / appendChild) for all user-supplied text (JIDs, names).
// buildPageNav output is static-integer-only HTML — safe to assign via innerHTML.
// DO NOT replace DOM methods with innerHTML concatenation — security hook requires DOM methods for user text.
async function loadGroupsTable() {
  var search = document.getElementById('dir-search').value.trim();
  var offset = (dirGroupPage - 1) * dirGroupPageSize;
  var url = '/api/admin/directory?type=group&limit=' + dirGroupPageSize + '&offset=' + offset + (search ? '&search=' + encodeURIComponent(search) : '');
  var list = document.getElementById('contact-list');
  try {
    var r = await fetch(url);
    if (!r.ok) {
      var errBody; try { errBody = await r.json(); } catch(_) {}
      throw new Error((errBody && errBody.error) || 'HTTP ' + r.status);
    }
    var d = await r.json();
    var totalPages = Math.ceil((d.total || 0) / dirGroupPageSize) || 1;
    document.getElementById('dir-stats').innerHTML =
      '<div class="dir-stat">Contacts <span>' + d.dms + '</span></div>' +
      '<div class="dir-stat">Groups <span>' + d.groups + '</span></div>' +
      '<div class="dir-stat">Newsletters <span>' + (d.newsletters || 0) + '</span></div>' +
      '<div class="dir-stat">Showing <span>' + d.total + '</span></div>';
    document.getElementById('load-more-btn').style.display = 'none';
    // Clear list — safe DOM loop avoids direct innerHTML assignment on user container
    while (list.firstChild) { list.removeChild(list.firstChild); }
    if (!d.contacts || d.contacts.length === 0) {
      var emptyEl = document.createElement('div');
      emptyEl.style.cssText = 'color:var(--text-muted);text-align:center;padding:32px;';
      emptyEl.textContent = 'No groups found.';
      list.appendChild(emptyEl);
      return;
    }
    // Page-size selector — option values/labels are static integers, safe
    var sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    var sizeLabel = document.createElement('label');
    sizeLabel.style.cssText = 'font-size:0.8rem;color:var(--text-secondary);';
    sizeLabel.textContent = 'Groups per page:';
    var sizeSelect = document.createElement('select');
    sizeSelect.className = 'page-size-select';
    sizeSelect.setAttribute('onchange', 'dirGroupPageSize=parseInt(this.value);dirGroupPage=1;loadGroupsTable();');
    [10, 25, 50, 100].forEach(function(sz) {
      var opt = document.createElement('option');
      opt.value = String(sz);
      opt.textContent = String(sz);
      if (sz === dirGroupPageSize) { opt.selected = true; }
      sizeSelect.appendChild(opt);
    });
    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(sizeSelect);
    list.appendChild(sizeRow);
    // Upper nav — buildPageNav output is static-integer HTML, no user data
    var upperNav = document.createElement('div');
    upperNav.innerHTML = buildPageNav(dirGroupPage, totalPages, 'goGroupPage');
    list.appendChild(upperNav);
    // Groups table — all user text (names, JIDs) set via textContent
    var table = document.createElement('table');
    table.className = 'groups-table';
    var thead = document.createElement('thead');
    // DIR-04: Add checkbox column header in bulk select mode
    thead.innerHTML = (bulkSelectMode ? '<tr><th style="width:30px;"></th><th>Name</th><th>JID</th><th>Members</th><th>Last Active</th><th></th></tr>' : '<tr><th>Name</th><th>JID</th><th>Members</th><th>Last Active</th><th></th></tr>');
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    d.contacts.forEach(function(c) {
      var safeId = c.jid.replace(/[^a-zA-Z0-9]/g, '_');
      // Group row — click expands participant panel
      var tr = document.createElement('tr');
      tr.id = 'row-' + safeId;
      tr.setAttribute('onclick', 'loadGroupParticipants(\\'' + esc(c.jid) + '\\')');
      // DIR-04: Checkbox cell in bulk select mode — DOM methods required (JID is user data)
      if (bulkSelectMode) {
        var tdCb = document.createElement('td');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.cssText = 'width:16px;height:16px;accent-color:#1d4ed8;vertical-align:middle;cursor:pointer;';
        cb.checked = bulkSelectedJids.has(c.jid);
        (function(jid) {
          cb.addEventListener('click', function(e) { e.stopPropagation(); toggleBulkItem(jid, cb); });
        })(c.jid);
        tdCb.appendChild(cb);
        tr.appendChild(tdCb);
      }
      var tdName = document.createElement('td');
      tdName.textContent = c.displayName || c.jid; // textContent safe — no HTML injection
      var tdJid = document.createElement('td');
      tdJid.style.cssText = 'font-family:monospace;font-size:0.78rem;color:var(--text-muted);';
      tdJid.textContent = c.jid; // textContent safe
      var tdMem = document.createElement('td');
      tdMem.textContent = c.messageCount > 0 ? String(c.messageCount) : '-';
      var tdTime = document.createElement('td');
      tdTime.textContent = relTime(c.lastMessageAt);
      var tdAct = document.createElement('td');
      var expandBtn = document.createElement('button');
      expandBtn.style.cssText = 'background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);padding:3px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;';
      expandBtn.textContent = 'Participants';
      expandBtn.setAttribute('onclick', 'event.stopPropagation();loadGroupParticipants(\\'' + esc(c.jid) + '\\')');
      tdAct.appendChild(expandBtn);
      tr.appendChild(tdName); tr.appendChild(tdJid); tr.appendChild(tdMem); tr.appendChild(tdTime); tr.appendChild(tdAct);
      tbody.appendChild(tr);
      // Panel expansion row (hosts participant panel div — reuses loadGroupParticipants panel pattern)
      var panelTr = document.createElement('tr');
      var panelTd = document.createElement('td');
      panelTd.setAttribute('colspan', bulkSelectMode ? '6' : '5');
      panelTd.style.padding = '0';
      var panelDiv = document.createElement('div');
      panelDiv.className = 'contact-settings-panel';
      panelDiv.id = 'panel-card-' + safeId; // matches loadGroupParticipants expected id: panel-{card-jid}
      panelTd.appendChild(panelDiv);
      panelTr.appendChild(panelTd);
      tbody.appendChild(panelTr);
    });
    table.appendChild(tbody);
    list.appendChild(table);
    // Lower nav — same static-integer HTML
    var lowerNav = document.createElement('div');
    lowerNav.innerHTML = buildPageNav(dirGroupPage, totalPages, 'goGroupPage');
    list.appendChild(lowerNav);
  } catch(err) {
    while (list.firstChild) { list.removeChild(list.firstChild); }
    var errEl = document.createElement('div');
    errEl.style.cssText = 'color:var(--error);padding:16px;';
    errEl.textContent = 'Error loading groups: ' + (err instanceof Error ? err.message : String(err));
    list.appendChild(errEl);
  }
}

// Phase 13: Render contacts tab as a paginated list.
// Uses DOM methods for all user-supplied text (JIDs, names).
// buildPageNav output is static-integer-only HTML — safe to assign via innerHTML.
// Mirrors loadGroupsTable() pagination pattern. DO NOT remove — replaces infinite-scroll for contacts.
async function loadContactsTable() {
  var search = document.getElementById('dir-search').value.trim();
  var offset = (dirContactPage - 1) * dirContactPageSize;
  var url = '/api/admin/directory?type=contact&limit=' + dirContactPageSize + '&offset=' + offset + (search ? '&search=' + encodeURIComponent(search) : '');
  var list = document.getElementById('contact-list');
  try {
    var r = await fetch(url);
    if (!r.ok) {
      var errBody; try { errBody = await r.json(); } catch(_) {}
      throw new Error((errBody && errBody.error) || 'HTTP ' + r.status);
    }
    var d = await r.json();
    var totalPages = Math.ceil((d.total || 0) / dirContactPageSize) || 1;
    // BUG-15: Show "X-Y of Z" range and page indicator so user knows pagination is active. DO NOT REMOVE.
    var pageStart = offset + 1;
    var pageEnd = Math.min(offset + (d.contacts ? d.contacts.length : 0), d.total);
    document.getElementById('dir-stats').innerHTML =
      '<div class="dir-stat">Contacts <span>' + d.dms + '</span></div>' +
      '<div class="dir-stat">Groups <span>' + d.groups + '</span></div>' +
      '<div class="dir-stat">Newsletters <span>' + (d.newsletters || 0) + '</span></div>' +
      '<div class="dir-stat">Showing <span>' + (d.total > 0 ? pageStart + '-' + pageEnd + ' of ' : '') + d.total + '</span></div>' +
      (totalPages > 1 ? '<div class="dir-stat">Page <span>' + dirContactPage + '/' + totalPages + '</span></div>' : '');
    document.getElementById('load-more-btn').style.display = 'none';
    // Clear list
    while (list.firstChild) { list.removeChild(list.firstChild); }
    // Auto-import if empty
    if (d.total === 0 && !dirAutoImported) {
      dirAutoImported = true;
      refreshDirectory();
      return;
    }
    if (!d.contacts || d.contacts.length === 0) {
      var emptyEl = document.createElement('div');
      emptyEl.style.cssText = 'color:var(--text-muted);text-align:center;padding:32px;';
      emptyEl.textContent = 'No contacts found.';
      list.appendChild(emptyEl);
      return;
    }
    // Page-size selector — option values/labels are static integers, safe
    var sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    var sizeLabel = document.createElement('label');
    sizeLabel.style.cssText = 'font-size:0.8rem;color:var(--text-secondary);';
    sizeLabel.textContent = 'Contacts per page:';
    var sizeSelect = document.createElement('select');
    sizeSelect.className = 'page-size-select';
    sizeSelect.setAttribute('onchange', 'dirContactPageSize=parseInt(this.value);dirContactPage=1;loadContactsTable();');
    [10, 25, 50, 100].forEach(function(sz) {
      var opt = document.createElement('option');
      opt.value = String(sz);
      opt.textContent = String(sz);
      if (sz === dirContactPageSize) { opt.selected = true; }
      sizeSelect.appendChild(opt);
    });
    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(sizeSelect);
    list.appendChild(sizeRow);
    // Upper nav — buildPageNav output is static-integer HTML, no user data
    var upperNav = document.createElement('div');
    upperNav.innerHTML = buildPageNav(dirContactPage, totalPages, 'goContactPage');
    list.appendChild(upperNav);
    // TTL-05: Sort expired entries to bottom of list.
    // DO NOT REMOVE — expired entries should not be mixed with active contacts.
    d.contacts.sort(function(a, b) {
      if (a.expired && !b.expired) return 1;
      if (!a.expired && b.expired) return -1;
      return 0;
    });
    // Contact cards — existing buildContactCard renders HTML, safe (uses esc() for user text)
    var cardsDiv = document.createElement('div');
    d.contacts.forEach(function(c) { cardsDiv.innerHTML += buildContactCard(c); });
    list.appendChild(cardsDiv);
    // Lower nav
    var lowerNav = document.createElement('div');
    lowerNav.innerHTML = buildPageNav(dirContactPage, totalPages, 'goContactPage');
    list.appendChild(lowerNav);
  } catch(err) {
    while (list.firstChild) { list.removeChild(list.firstChild); }
    var errEl = document.createElement('div');
    errEl.style.cssText = 'color:var(--error);padding:16px;';
    errEl.textContent = 'Error loading contacts: ' + (err instanceof Error ? err.message : String(err));
    list.appendChild(errEl);
  }
}

// Phase 15 (TTL-04/TTL-05): Generate a color-coded TTL badge for active or expired access grants.
// Colors: green >1h remaining, yellow <1h, red <15m, gray for expired.
// Called from buildContactCard for all contacts that have a non-null expiresAt.
// DO NOT REMOVE — badge is the primary visual indicator of time-limited access in the directory.
function formatTtlBadge(expiresAt, expired) {
  if (!expiresAt) return '';
  if (expired) return '<span class="ttl-badge ttl-expired">Expired</span>';
  var now = Math.floor(Date.now() / 1000);
  var remaining = expiresAt - now;
  if (remaining <= 0) return '<span class="ttl-badge ttl-expired">Expired</span>';
  var text;
  if (remaining < 60) text = remaining + 's';
  else if (remaining < 3600) text = Math.floor(remaining / 60) + 'm';
  else if (remaining < 86400) {
    var h = Math.floor(remaining / 3600);
    var m = Math.floor((remaining % 3600) / 60);
    text = h + 'h' + (m > 0 ? ' ' + m + 'm' : '');
  } else {
    var d = Math.floor(remaining / 86400);
    text = d + 'd';
  }
  // TTL-04: green >1h, yellow <1h (but >15m), red <15m (900s)
  var cls = remaining > 3600 ? 'ttl-green' : (remaining > 900 ? 'ttl-yellow' : 'ttl-red');
  return '<span class="ttl-badge ' + cls + '">Expires in ' + text + '</span>';
}

function buildContactCard(c) {
  var name = c.displayName || c.jid;
  var color = avatarColor(c.jid);
  var inits = initials(c.displayName || '', c.jid);
  var dm = c.dmSettings || {mode:'active',mentionOnly:false,customKeywords:'',canInitiate:true,canInitiateOverride:'default'};
  var id = 'card-' + c.jid.replace(/[^a-zA-Z0-9]/g, '_');
  var isGroup = c.isGroup;
  var avatarBg = isGroup ? '#1e3a5f' : color;
  var avatarContent = isGroup ? '&#128101;' : esc(inits);
  var borderStyle = c.allowedDm ? 'border-left:3px solid #10b981;' : '';

  var allowBtn = '';
  var isNewsletter = c.jid && c.jid.indexOf('@newsletter') !== -1;
  if (!isGroup) {
    if (isNewsletter) {
      // UI-11 (12-05): Channels tab Allow DM — inline toggle button, no full directory reload.
      // State persists across page reload because it reads from API response data (allowedDm).
      // DO NOT REMOVE — newsletter allow-dm uses inline toggle to avoid full-directory reload on each click.
      var nlBtnBg = c.allowedDm ? '#10b981' : '#334155';
      var nlBtnColor = '#fff';
      var nlBtnBorder = 'none';
      var nlBtnText = c.allowedDm ? 'DM Allowed' : 'Allow DM';
      var nlBtnId = 'allow-btn-' + id;
      allowBtn = '<button id="' + nlBtnId + '" style="background:' + nlBtnBg + ';color:' + nlBtnColor + ';border:' + nlBtnBorder + ';padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.75rem;" onclick="event.stopPropagation();toggleChannelAllowDm(\\'' + esc(c.jid) + '\\',\\'' + nlBtnId + '\\',' + (c.allowedDm ? 'true' : 'false') + ')">' + nlBtnText + '</button>';
    } else {
      if (c.allowedDm) {
        allowBtn = '<button style="background:#10b981;color:#fff;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.75rem;" onclick="event.stopPropagation();toggleAllowDm(\\'' + esc(c.jid) + '\\',true)">Allowed (DM)</button>';
      } else {
        allowBtn = '<button style="background:#1d4ed8;color:#fff;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.75rem;" onclick="event.stopPropagation();toggleAllowDm(\\'' + esc(c.jid) + '\\',false)">Allow DM</button>';
      }
    }
  }

  var clickAction = isGroup
    ? 'loadGroupParticipants(\\'' + esc(c.jid) + '\\')'
    : 'toggleContactSettings(\\'' + esc(c.jid) + '\\')';

  var panelContent = '';
  if (isGroup) {
    panelContent = '<div class="contact-settings-panel" id="panel-' + id + '">' +
      '<div style="color:var(--text-muted);padding:8px">Click to load participants...</div>' +
    '</div>';
  } else {
    panelContent = '<div class="contact-settings-panel" id="panel-' + id + '">' +
      '<div class="settings-fields">' +
        '<div class="settings-field"><label>Mode <span class="tip" data-tip="Active: bot responds to this contact. Listen Only: messages arrive but bot does not reply.">?</span></label><select id="mode-' + id + '"><option value="active"' + (dm.mode==='active'?' selected':'') + '>Active</option><option value="listen_only"' + (dm.mode==='listen_only'?' selected':'') + '>Listen Only</option></select></div>' +
        '<div class="settings-field"><label><input type="checkbox" id="mo-' + id + '"' + (dm.mentionOnly?' checked':'') + '> Mention Only <span class="tip" data-tip="When checked, bot only responds if it is explicitly @mentioned in the message.">?</span></label></div>' +
        '<div class="settings-field"><label>Custom Keywords <span class="tip" data-tip="Regex patterns. Bot responds only if the message matches one. Overrides global keyword filter for this contact. Press Enter to add each keyword.">?</span></label><div id="kw-' + id + '" data-init-kw="' + esc(JSON.stringify((dm.customKeywords || '').split(',').map(function(s){return s.trim();}).filter(Boolean))) + '"></div></div>' +
        '<div class="settings-field"><label>Can Initiate <span class="tip" data-tip="Override the global Can Initiate setting for this contact. Default: follow the global toggle in Settings. Allow: always allow initiation. Block: never initiate.">?</span></label>' +
          '<select id="ci-' + id + '">' +
            '<option value="default"' + (dm.canInitiateOverride==='default'?' selected':'') + '>Default (use global)</option>' +
            '<option value="allow"' + (dm.canInitiateOverride==='allow'?' selected':'') + '>Allow</option>' +
            '<option value="block"' + (dm.canInitiateOverride==='block'?' selected':'') + '>Block</option>' +
          '</select>' +
        '</div>' +
        (function() {
          // Phase 15 (TTL-01): Access Expires dropdown. DO NOT REMOVE.
          // Determines selected preset: null/undefined -> never, matched preset -> that value, custom -> "custom".
          var ttlPresets = [1800, 3600, 14400, 86400, 604800];
          var ttlSelected = 'never';
          if (c.expiresAt && !c.expired) {
            var rem = c.expiresAt - Math.floor(Date.now() / 1000);
            if (rem > 0) {
              var closest = ttlPresets.reduce(function(best, p) { return Math.abs(p - rem) < Math.abs(best - rem) ? p : best; }, ttlPresets[0]);
              ttlSelected = Math.abs(closest - rem) < 60 ? String(closest) : 'custom';
            }
          }
          return '<div class="settings-field"><label>Access Expires <span class="tip" data-tip="Set how long this contact\\'s DM access lasts. After expiry, access is automatically revoked.">?</span></label>' +
            '<select id="ttl-' + id + '" onchange="ttlChanged(\\'' + esc(c.jid) + '\\',\\'ttl-' + id + '\\')">' +
              '<option value="never"' + (ttlSelected==='never'?' selected':'') + '>Never</option>' +
              '<option value="1800"' + (ttlSelected==='1800'?' selected':'') + '>30 minutes</option>' +
              '<option value="3600"' + (ttlSelected==='3600'?' selected':'') + '>1 hour</option>' +
              '<option value="14400"' + (ttlSelected==='14400'?' selected':'') + '>4 hours</option>' +
              '<option value="86400"' + (ttlSelected==='86400'?' selected':'') + '>24 hours</option>' +
              '<option value="604800"' + (ttlSelected==='604800'?' selected':'') + '>7 days</option>' +
              '<option value="custom"' + (ttlSelected==='custom'?' selected':'') + '>Custom...</option>' +
            '</select>' +
            '<div id="ttl-custom-' + id + '" style="display:' + (ttlSelected==='custom'?'flex':'none') + ';margin-top:6px;gap:6px;align-items:center;">' +
              '<input type="datetime-local" style="background:var(--bg-tertiary);border:1px solid var(--border);color:var(--text-primary);border-radius:6px;padding:6px 8px;font-size:0.85rem;">' +
              '<button onclick="ttlCustomApply(\\'' + esc(c.jid) + '\\',\\'ttl-' + id + '\\')" style="background:#1d4ed8;color:#fff;border:none;padding:6px 12px;border-radius:5px;cursor:pointer;font-size:0.8rem;">Apply</button>' +
            '</div>' +
          '</div>';
        })() +
        '<button class="save-contact-btn" onclick="event.stopPropagation();saveContactSettings(\\'' + esc(c.jid) + '\\', \\'' + id + '\\')">Save</button>' +
      '</div>' +
    '</div>';
  }

  // DIR-04: Checkbox prepended in bulk select mode (DOM method used — JID is user data)
  var bulkCheckbox = '';
  if (bulkSelectMode) {
    var cbEl = document.createElement('input');
    cbEl.type = 'checkbox';
    cbEl.style.cssText = 'margin-right:8px;width:18px;height:18px;accent-color:#1d4ed8;vertical-align:middle;flex-shrink:0;';
    cbEl.checked = bulkSelectedJids.has(c.jid);
    if (cbEl.checked) cbEl.setAttribute('checked', '');
    cbEl.setAttribute('onclick', 'event.stopPropagation();toggleBulkItem(' + JSON.stringify(c.jid) + ',this)');
    var tempDiv = document.createElement('div');
    tempDiv.appendChild(cbEl);
    bulkCheckbox = tempDiv.innerHTML;
  }

  // Phase 15 (TTL-04/TTL-05): TTL badge and expired card styling.
  // DO NOT REMOVE — badge and dimming are primary visual indicators of time-limited access.
  var ttlBadge = formatTtlBadge(c.expiresAt, c.expired);
  var expiredClass = c.expired ? ' expired-card' : '';
  // Phase 16: Pairing source badge + revoke link. DO NOT REMOVE — shows which contacts were auto-granted via pairing.
  var pairingBadge = '';
  var pairingRevoke = '';
  if (c.source === 'pairing') {
    pairingBadge = '<span style="background:#e3f2fd;color:#1565c0;font-size:0.75em;padding:2px 6px;border-radius:4px;margin-left:4px">Pairing</span>';
    pairingRevoke = '<a href="#" onclick="event.stopPropagation();revokePairingGrant(\\'' + esc(c.jid) + '\\');return false" style="color:#c62828;font-size:0.75em;margin-left:4px">Revoke</a>';
  }

  return '<div class="contact-card' + expiredClass + '" id="' + id + '" style="' + borderStyle + '">' +
    '<div class="contact-header" onclick="' + clickAction + '" style="display:flex;align-items:center;">' +
      bulkCheckbox +
      '<div class="avatar" style="background:' + avatarBg + ';color:#fff">' + avatarContent + '</div>' +
      '<div class="contact-info">' +
        '<div class="contact-name">' + esc(name) + ttlBadge + pairingBadge + pairingRevoke + '</div>' +
        '<div class="contact-jid">' + esc(c.jid) + '</div>' +
      '</div>' +
      '<div class="contact-meta">' +
        '<span class="contact-time">' + relTime(c.lastMessageAt) + '</span>' +
        (c.messageCount > 0 ? '<span class="badge-count">' + c.messageCount + ' msg' + (c.messageCount !== 1 ? 's' : '') + '</span>' : '') +
        allowBtn +
        (isGroup ? '' : '<button class="settings-toggle-btn" onclick="event.stopPropagation();toggleContactSettings(\\'' + esc(c.jid) + '\\')">Settings</button>') +
      '</div>' +
    '</div>' +
    panelContent +
  '</div>';
}
function toggleContactSettings(jid) {
  var id = 'card-' + jid.replace(/[^a-zA-Z0-9]/g, '_');
  var panel = document.getElementById('panel-' + id);
  if (!panel) return;
  panel.classList.toggle('open');
  // Phase 12, UX-04 — lazily init Custom Keywords tag input on first open.
  // DO NOT CHANGE: createTagInput requires the container div to exist in DOM. We only call it once per contact
  // (null-guard prevents re-creation). data-init-kw holds the initial value as JSON from buildContactCard.
  if (!customKeywordTagInputs[id]) {
    var kwContainer = document.getElementById('kw-' + id);
    if (kwContainer) {
      customKeywordTagInputs[id] = createTagInput('kw-' + id, { placeholder: 'Add keyword and press Enter...' });
      try {
        var initKw = JSON.parse(kwContainer.getAttribute('data-init-kw') || '[]');
        customKeywordTagInputs[id].setValue(Array.isArray(initKw) ? initKw : []);
      } catch(e) { /* ignore malformed init data */ }
    }
  }
}
async function saveContactSettings(jid, id) {
  var mode = document.getElementById('mode-' + id)?.value || 'active';
  var mentionOnly = document.getElementById('mo-' + id)?.checked || false;
  // Phase 12, UX-04 -- read customKeywords from tag input (returns array, joined to comma-string for backend).
  // DO NOT REVERT to reading .value from a plain text input — the input is now a tag input container div.
  var kwArr = customKeywordTagInputs[id] ? customKeywordTagInputs[id].getValue() : [];
  var customKeywords = kwArr.join(',');
  // Phase 12, Plan 02 (INIT-02): Can Initiate is now a 3-option dropdown (default/allow/block). DO NOT REVERT to checkbox.
  var canInitiateOverride = document.getElementById('ci-' + id)?.value || 'default';
  try {
    var r = await fetch('/api/admin/directory/' + encodeURIComponent(jid) + '/settings', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({mode, mentionOnly, customKeywords, canInitiateOverride})
    });
    var result = await r.json();
    if (!r.ok) throw new Error(result.error || 'Save failed');
    // Phase 12, UI-07 — drawer stays open after save (BUG-09). DO NOT add panel.classList.remove('open') here.
    // User should be able to continue editing without reopening the drawer. Toast confirms save succeeded.
    showToast('Settings saved');
  } catch(e) {
    showToast('Error: ' + e.message, true);
  }
}

// Phase 15 (TTL-01): TTL change handler — called by Access Expires dropdown onchange.
// Immediately PUTs expiresAt to the TTL endpoint. Custom option shows datetime picker instead.
// DO NOT REMOVE — wired directly by buildContactCard Access Expires dropdown.
async function ttlChanged(jid, selectId) {
  var sel = document.getElementById(selectId);
  var customDiv = document.getElementById(selectId.replace('ttl-','ttl-custom-'));
  if (!sel) return;
  var val = sel.value;
  if (val === 'custom') {
    if (customDiv) customDiv.style.display = 'flex';
    return;
  }
  if (customDiv) customDiv.style.display = 'none';
  var expiresAt = null;
  if (val !== 'never') {
    expiresAt = Math.floor(Date.now() / 1000) + parseInt(val, 10);
  }
  try {
    var r = await fetch('/api/admin/directory/' + encodeURIComponent(jid) + '/ttl', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresAt: expiresAt })
    });
    if (!r.ok) {
      var err = await r.json();
      showToast((err && err.error) || 'Failed to set TTL', true);
      return;
    }
    showToast(val === 'never' ? 'Access set to never expire' : 'Access expires in ' + sel.options[sel.selectedIndex].text);
  } catch(e) {
    showToast('Failed to set TTL: ' + e.message, true);
  }
}

// Phase 15 (TTL-01): Custom datetime apply handler — called by Apply button in custom TTL picker.
// Validates that the selected datetime is in the future, then PUTs expiresAt.
// DO NOT REMOVE — wired by buildContactCard custom datetime Apply button.
async function ttlCustomApply(jid, selectId) {
  var customDiv = document.getElementById(selectId.replace('ttl-','ttl-custom-'));
  var input = customDiv ? customDiv.querySelector('input[type="datetime-local"]') : null;
  if (!input || !input.value) { showToast('Please select a date and time', true); return; }
  var expiresAt = Math.floor(new Date(input.value).getTime() / 1000);
  if (expiresAt <= Math.floor(Date.now() / 1000)) { showToast('Expiry must be in the future', true); return; }
  try {
    var r = await fetch('/api/admin/directory/' + encodeURIComponent(jid) + '/ttl', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresAt: expiresAt })
    });
    if (!r.ok) { var err = await r.json(); showToast((err && err.error) || 'Failed', true); return; }
    showToast('Access expires at ' + new Date(expiresAt * 1000).toLocaleString());
    if (customDiv) customDiv.style.display = 'none';
  } catch(e) {
    showToast('Failed: ' + e.message, true);
  }
}

// ---- Allow-list toggles ----
async function toggleAllowDm(jid, currentlyAllowed) {
  try {
    var r = await fetch('/api/admin/directory/' + encodeURIComponent(jid) + '/allow-dm', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ allowed: !currentlyAllowed })
    });
    if (!r.ok) throw new Error('Failed');
    showToast((!currentlyAllowed ? 'Added' : 'Removed') + ' ' + jid + ' DM access');
    dirOffset = 0; loadDirectory();
  } catch(e) { showToast('Error: ' + e.message, true); }
}

// UI-11 (12-05): Inline allow-dm toggle for Channels tab — updates button in place without reloading directory.
// DO NOT REMOVE — newsletter allow-dm button uses this to avoid full directory reload on toggle.
// Visual state reads from API response on next loadDirectory(), so it persists across page reload.
async function toggleChannelAllowDm(jid, btnId, currentlyAllowed) {
  try {
    var newState = !currentlyAllowed;
    var r = await fetch('/api/admin/directory/' + encodeURIComponent(jid) + '/allow-dm', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ allowed: newState })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    // Update button visual state inline
    var btn = document.getElementById(btnId);
    if (btn) {
      btn.textContent = newState ? 'DM Allowed' : 'Allow DM';
      btn.style.background = newState ? '#10b981' : '#334155';
      btn.style.color = '#fff';
      btn.style.border = 'none';
      // Update onclick to reflect new current state
      btn.setAttribute('onclick', 'event.stopPropagation();toggleChannelAllowDm(\\'' + jid.replace(/'/g, "\\'") + '\\',\\'' + btnId + '\\',' + (newState ? 'true' : 'false') + ')');
    }
    // Update card border to reflect allow state
    var card = document.getElementById('card-' + jid.replace(/[^a-zA-Z0-9]/g, '_'));
    if (card) card.style.borderLeft = newState ? '3px solid #10b981' : '';
    showToast(newState ? 'DM allowed for channel' : 'DM revoked for channel', false);
  } catch(e) { showToast('Failed: ' + e.message, true); }
}

async function loadGroupParticipants(groupJid, forceOpen) {
  var id = 'card-' + groupJid.replace(/[^a-zA-Z0-9]/g, '_');
  var panel = document.getElementById('panel-' + id);
  if (!panel) return;
  if (!forceOpen) {
    panel.classList.toggle('open');
    if (!panel.classList.contains('open')) {
      if (bulkSelectMode && bulkCurrentGroupJid === groupJid) { bulkCurrentGroupJid = null; updateBulkToolbar(); }
      return;
    }
  } else {
    panel.classList.add('open');
  }
  panel.innerHTML = '<div style="color:var(--text-muted);padding:8px">Loading participants...</div>';
  try {
    var r = await fetch('/api/admin/directory/group/' + encodeURIComponent(groupJid) + '/participants');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();
    var parts = d.participants || [];
    var allowAll = d.allowAll;
    // DIR-04: When bulk mode is active, set bulkCurrentGroupJid so toolbar knows the context
    if (bulkSelectMode) { bulkCurrentGroupJid = groupJid; updateBulkToolbar(); }
    var html = '<div style="padding:12px;">';
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">';
    html += '<span style="font-size:0.85rem;color:var(--text-secondary);font-weight:600;">' + parts.length + ' participants</span>';
    html += '<button style="background:' + (allowAll ? '#10b981' : '#1d4ed8') + ';color:#fff;border:none;padding:4px 12px;border-radius:5px;cursor:pointer;font-size:0.78rem;margin-left:auto;" onclick="toggleGroupAllowAll(\\'' + esc(groupJid) + '\\',' + (allowAll ? 'true' : 'false') + ')">' + (allowAll ? 'Revoke All' : 'Allow All') + '</button>';
    html += '</div>';
    if (parts.length === 0) {
      html += '<div style="color:var(--text-muted);font-size:0.85rem;">No participants found. Try refreshing from WAHA first.</div>';
    } else {
      parts.forEach(function(p) {
        // DIR-02: For @lid JIDs with no display name, strip domain for a cleaner fallback than the full raw JID
        var pNameFallback = p.participantJid.indexOf('@lid') !== -1 ? p.participantJid.replace(/@.*$/, '') : p.participantJid;
        var pName = p.displayName || pNameFallback;
        var pColor = avatarColor(p.participantJid);
        var pInits = initials(p.displayName || '', p.participantJid);
        // DIR-02: Green if allowed per-group OR globally allowed via config.groupAllowFrom
        var groupAllowed = p.allowInGroup || p.globallyAllowed;
        // DIR-02 (12-05): Check if this participant is a bot session. BOT_SESSION_IDS is injected server-side.
        // Bot sessions show a 'bot' badge and have no action controls — allow/dm toggles and role dropdown are suppressed.
        // DO NOT REMOVE — isBotSession check powers the bot badge and control suppression for bot session participants.
        // Uses server-side flag (enriched in participants API) instead of client-side session name matching.
        var isBotSession = !!p.isBotSession;
        html += '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-light);">';
        // DIR-04: Checkbox in bulk select mode — use JSON.stringify to safely embed JID in onclick
        if (bulkSelectMode && !isBotSession) {
          var pChecked = bulkSelectedJids.has(p.participantJid);
          html += '<input type="checkbox"' + (pChecked ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:#1d4ed8;flex-shrink:0;cursor:pointer;" onclick="event.stopPropagation();toggleBulkItem(' + JSON.stringify(p.participantJid) + ',this)">';
        }
        html += '<div class="avatar" style="width:32px;height:32px;font-size:0.8rem;background:' + pColor + ';color:#fff">' + esc(pInits) + '</div>';
        html += '<div style="flex:1;min-width:0;">';
        // DIR-02 (12-05): Bot badge next to participant name — indicates this is the bot's own session
        html += '<div style="font-size:0.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(pName) + (p.isAdmin ? ' <span style="color:#f59e0b;font-size:0.7rem;">ADMIN</span>' : '') + (isBotSession ? ' <span class="bot-badge">bot</span>' : '') + '</div>';
        html += '<div style="font-size:0.72rem;color:var(--text-muted);font-family:monospace;">' + esc(p.participantJid) + '</div>';
        html += '</div>';
        if (!isBotSession) {
          // DIR-03: Role dropdown — role values are static strings (no user data), safe as HTML template
          // DIR-04 (12-05): onmousedown captures prev value; onchange fires setParticipantRole with auto-grant
          var pRole = p.participantRole || 'participant';
          html += '<select style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:0.75rem;" data-prev="' + esc(pRole) + '" onmousedown="this.dataset.prev=this.value" onchange="setParticipantRole(\\'' + esc(groupJid) + '\\',\\'' + esc(p.participantJid) + '\\',this.value,this.dataset.prev,this)">';
          html += '<option value="bot_admin"' + (pRole === 'bot_admin' ? ' selected' : '') + '>Bot Admin</option>';
          html += '<option value="manager"' + (pRole === 'manager' ? ' selected' : '') + '>Manager</option>';
          html += '<option value="participant"' + (pRole === 'participant' ? ' selected' : '') + '>Participant</option>';
          html += '</select>';
          html += '<button id="allow-grp-' + esc(p.participantJid).replace(/[^a-zA-Z0-9]/g,'_') + '" style="background:' + (groupAllowed ? '#10b981' : '#334155') + ';color:#fff;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:0.72rem;" onclick="toggleParticipantAllow(\\'' + esc(groupJid) + '\\',\\'' + esc(p.participantJid) + '\\',\\'allow-group\\',' + (p.allowInGroup ? 'true' : 'false') + ')">' + (groupAllowed ? 'Allowed' : 'Allow') + '</button>';
          html += '<button id="allow-dm-' + esc(p.participantJid).replace(/[^a-zA-Z0-9]/g,'_') + '" style="background:' + (p.allowDm ? '#10b981' : '#334155') + ';color:#fff;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:0.72rem;" onclick="toggleParticipantAllow(\\'' + esc(groupJid) + '\\',\\'' + esc(p.participantJid) + '\\',\\'allow-dm\\',' + (p.allowDm ? 'true' : 'false') + ')">' + (p.allowDm ? 'DM OK' : 'Allow DM') + '</button>';
        }
        html += '</div>';
      });
    }
    html += '</div>';
    // ---- Group filter override section ----
    // DO NOT CHANGE — per-group filter override UI allows admin to set custom keyword filter settings per group.
    html += '<div class="group-filter-override" style="margin-top:12px;padding:12px;background:var(--bg-tertiary);border-radius:8px;border:1px solid var(--border-light);">';
    var sfx = esc(groupJid).replace(/[^a-zA-Z0-9]/g,'_');
    html += '<h4 style="margin:0 0 8px;color:var(--text-secondary);font-size:13px;text-transform:uppercase;">Group Filter Override</h4>';
    html += '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
    html += '<input type="checkbox" id="gfo-enabled-' + sfx + '">';
    html += ' <span>Override global filter</span></label>';
    html += '<div id="gfo-settings-' + sfx + '" style="display:none;margin-left:24px;">';
    html += '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
    html += '<input type="checkbox" id="gfo-filter-enabled-' + sfx + '" checked>';
    html += ' <span>Keyword filter enabled</span></label>';
    // UX-03: Tag input container replaces plain text input for keywords
    html += '<div style="margin-bottom:8px;"><label style="display:block;margin-bottom:4px;color:var(--text-secondary);font-size:12px;">Keywords (empty = inherit global)</label>';
    html += '<div id="gfo-patterns-cp-' + sfx + '"></div></div>';
    html += '<div><label style="display:block;margin-bottom:4px;color:var(--text-secondary);font-size:12px;">God Mode Scope</label>';
    html += '<select id="gfo-god-mode-' + sfx + '" style="padding:6px 8px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);">';
    html += '<option value="">Inherit global</option><option value="all">All (DM + Groups)</option><option value="dm">DM Only</option><option value="off">Off</option></select></div>';
    html += '</div></div>';
    panel.innerHTML = html;
    // UX-03: Initialize tag input for group filter keywords (must be after DOM assignment)
    // DO NOT CHANGE — createTagInput requires container div to exist in DOM before calling.
    // Always re-create: panel.innerHTML rebuild destroys old DOM, stale reference would be non-functional.
    delete gfoTagInputs[sfx];
    gfoTagInputs[sfx] = createTagInput('gfo-patterns-cp-' + sfx, {
      placeholder: 'hello, help, bot'
    });
    // Load existing filter override data for this group (async, non-blocking)
    loadGroupFilter(groupJid);
  } catch(e) { panel.innerHTML = '<div style="color:var(--error);padding:8px">' + esc(e.message) + '</div>'; }
}

async function toggleParticipantAllow(groupJid, participantJid, type, currentlyAllowed) {
  try {
    var r = await fetch('/api/admin/directory/group/' + encodeURIComponent(groupJid) + '/participants/' + encodeURIComponent(participantJid) + '/' + type, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ allowed: !currentlyAllowed })
    });
    if (!r.ok) throw new Error('Failed');
    showToast('Updated ' + participantJid);
    loadGroupParticipants(groupJid, true);
  } catch(e) { showToast('Error: ' + e.message, true); }
}

// DIR-03 / DIR-04 (12-05): Set participant role with auto-grant/revoke.
// prevRole: value before change (captured by onmousedown in the select). selectEl: the dropdown element.
// Auto-grant: promoting to bot_admin or manager enables Allow + Allow DM automatically.
// Auto-revoke: demoting from bot_admin/manager to participant revokes Allow DM (group Allow stays).
// DO NOT REMOVE — auto-grant/revoke is part of the role promotion UX (DIR-04 requirement).
async function setParticipantRole(groupJid, participantJid, role, prevRole, selectEl) {
  try {
    var r = await fetch('/api/admin/directory/group/' + encodeURIComponent(groupJid) + '/participants/' + encodeURIComponent(participantJid) + '/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: role })
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    if (!d.ok) throw new Error(d.error || 'Participant not found — refresh participants first');

    var isPromotion = role === 'bot_admin' || role === 'manager';
    var wasPrivileged = prevRole === 'bot_admin' || prevRole === 'manager';

    if (isPromotion) {
      // DIR-04: Auto-grant Allow (group) + Allow DM on promotion to bot_admin/manager
      try {
        await Promise.all([
          fetch('/api/admin/directory/group/' + encodeURIComponent(groupJid) + '/participants/' + encodeURIComponent(participantJid) + '/allow-group', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allowed: true })
          }),
          fetch('/api/admin/directory/' + encodeURIComponent(participantJid) + '/allow-dm', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allowed: true })
          })
        ]);
        // Update button visuals inline to reflect new allow states
        var grpBtn = document.getElementById('allow-grp-' + participantJid.replace(/[^a-zA-Z0-9]/g, '_'));
        if (grpBtn) { grpBtn.textContent = 'Allowed'; grpBtn.style.background = '#10b981'; }
        var dmBtn = document.getElementById('allow-dm-' + participantJid.replace(/[^a-zA-Z0-9]/g, '_'));
        if (dmBtn) { dmBtn.textContent = 'DM OK'; dmBtn.style.background = '#10b981'; }
        showToast('Role updated. Allow and Allow DM auto-enabled.', false);
      } catch(autoErr) {
        showToast('Role updated. Auto-grant failed: ' + autoErr.message, true);
      }
    } else if (wasPrivileged && role === 'participant') {
      // DIR-04: Auto-revoke Allow DM on demotion to participant (group Allow kept as-is)
      try {
        await fetch('/api/admin/directory/' + encodeURIComponent(participantJid) + '/allow-dm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowed: false })
        });
        // Update DM button visual inline
        var dmBtn2 = document.getElementById('allow-dm-' + participantJid.replace(/[^a-zA-Z0-9]/g, '_'));
        if (dmBtn2) { dmBtn2.textContent = 'Allow DM'; dmBtn2.style.background = '#334155'; }
        showToast('Role updated. Allow DM revoked.', false);
      } catch(revokeErr) {
        showToast('Role updated. Auto-revoke failed: ' + revokeErr.message, true);
      }
    } else {
      showToast('Role updated', false);
    }
    // Update data-prev on select to reflect new current role (for next change)
    if (selectEl) selectEl.dataset.prev = role;
  } catch(e) {
    showToast('Failed to update role: ' + e.message, true);
    // Revert dropdown on failure
    if (selectEl && prevRole) selectEl.value = prevRole;
  }
}

async function toggleGroupAllowAll(groupJid, currentlyAll) {
  try {
    var r = await fetch('/api/admin/directory/group/' + encodeURIComponent(groupJid) + '/allow-all', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ allowed: !currentlyAll })
    });
    if (!r.ok) throw new Error('Failed');
    showToast((!currentlyAll ? 'Allowed all' : 'Revoked all') + ' in group');
    loadGroupParticipants(groupJid, true);
  } catch(e) { showToast('Error: ' + e.message, true); }
}
// ---- Group filter override functions ----
// DO NOT CHANGE — loadGroupFilter/saveGroupFilter manage per-group keyword filter overrides.
async function loadGroupFilter(groupJid) {
  var sfx = groupJid.replace(/[^a-zA-Z0-9]/g, '_');
  try {
    var r = await fetch('/api/admin/directory/' + encodeURIComponent(groupJid) + '/filter');
    if (!r.ok) return;
    var d = await r.json();
    var ov = d.override;
    var elEnabled = document.getElementById('gfo-enabled-' + sfx);
    var elSettings = document.getElementById('gfo-settings-' + sfx);
    var elFilterEnabled = document.getElementById('gfo-filter-enabled-' + sfx);
    var elGodMode = document.getElementById('gfo-god-mode-' + sfx);
    if (!elEnabled) return;
    if (ov && ov.enabled) {
      elEnabled.checked = true;
      if (elSettings) elSettings.style.display = '';
      if (elFilterEnabled) elFilterEnabled.checked = ov.filterEnabled !== false;
      // UX-03: Load keywords into tag input instance instead of plain text input
      if (gfoTagInputs[sfx] && ov.mentionPatterns) {
        gfoTagInputs[sfx].setValue(ov.mentionPatterns);
      }
      if (elGodMode && ov.godModeScope) elGodMode.value = ov.godModeScope;
    } else {
      elEnabled.checked = false;
      if (elSettings) elSettings.style.display = 'none';
    }
    // Wire toggle for settings visibility + save on change
    elEnabled.onchange = function() {
      var isOverriding = elEnabled.checked;
      if (elSettings) elSettings.style.display = isOverriding ? '' : 'none';
      saveGroupFilter(groupJid);
    };
    if (elFilterEnabled) elFilterEnabled.onchange = function() { saveGroupFilter(groupJid); };
  } catch(e) { console.warn('[waha] loadGroupFilter failed:', e); }
}
// DO NOT CHANGE — saveGroupFilter uses AbortController for 10s timeout to prevent 502 from hung requests (AP-03 fix).
async function saveGroupFilter(groupJid) {
  var sfx = groupJid.replace(/[^a-zA-Z0-9]/g, '_');
  var elEnabled = document.getElementById('gfo-enabled-' + sfx);
  var elFilterEnabled = document.getElementById('gfo-filter-enabled-' + sfx);
  var elGodMode = document.getElementById('gfo-god-mode-' + sfx);
  // UX-03: Read keywords from tag input instance (returns array) instead of plain text input
  var patternsArr = gfoTagInputs[sfx] ? gfoTagInputs[sfx].getValue() : [];
  if (!elEnabled) return;
  var enabled = elEnabled.checked;
  var filterEnabled = elFilterEnabled ? elFilterEnabled.checked : true;
  var mentionPatterns = patternsArr.length ? patternsArr : null;
  var godModeScope = elGodMode ? elGodMode.value || null : null;
  // Disable checkbox while saving to prevent double-clicks
  elEnabled.disabled = true;
  showToast('Saving...');
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 10000);
  try {
    var r = await fetch('/api/admin/directory/' + encodeURIComponent(groupJid) + '/filter', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ enabled: enabled, filterEnabled: filterEnabled, mentionPatterns: mentionPatterns, godModeScope: godModeScope }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    showToast('Group filter override saved');
  } catch(e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      showToast('Request timed out — filter may have been saved. Refresh to check.', true);
    } else {
      showToast('Error saving filter: ' + e.message, true);
    }
  } finally {
    elEnabled.disabled = false;
  }
}

// ---- Phase 12, Plan 03 (UX-03 + UI-09): Shared Refresh button helper ----
// DO NOT REMOVE: wrapRefreshButton wraps any Refresh button with:
//   1. "Refreshing..." text + pulse animation while the load function runs
//   2. "Last refreshed: Xm ago" timestamp below the button, auto-updating every 30s
// Applied uniformly to all 5 tabs (dashboard, sessions, log, queue, directory).
function wrapRefreshButton(btn, loadFn) {
  var tsEl = document.createElement("span");
  tsEl.className = "refresh-ts";
  tsEl.textContent = "";
  btn.parentNode.insertBefore(tsEl, btn.nextSibling);

  var lastRefreshed = null;

  function updateTs() {
    if (!lastRefreshed) return;
    var diff = Math.floor((Date.now() - lastRefreshed) / 1000);
    if (diff < 60) tsEl.textContent = "Just now";
    else if (diff < 3600) tsEl.textContent = Math.floor(diff / 60) + "m ago";
    else tsEl.textContent = Math.floor(diff / 3600) + "h ago";
  }

  // Update relative time every 30s
  setInterval(updateTs, 30000);

  btn.addEventListener("click", function() {
    var origText = btn.textContent;
    btn.textContent = "Refreshing...";
    btn.classList.add("refreshing");
    btn.disabled = true;

    Promise.resolve(loadFn()).then(function() {
      lastRefreshed = Date.now();
      updateTs();
    }).catch(function(err) {
      console.warn("[waha] refresh failed:", err);
    }).then(function() {
      btn.textContent = origText;
      btn.classList.remove("refreshing");
      btn.disabled = false;
    });
  });
}

// Wire wrapRefreshButton to all 5 tab Refresh buttons after DOM is ready.
// DO NOT REMOVE: removes inline onclick handlers would break _accessKvBuilt reset on dashboard.
// We keep onclick AND add wrapRefreshButton — onclick fires but wrapRefreshButton's click
// handler also fires. To avoid double-call, we override the onclick after wrapping.
(function() {
  function wireRefreshBtn(id, loadFn, extraSetup) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.removeAttribute("onclick");
    if (extraSetup) btn.addEventListener("click", function() { extraSetup(); }, true);
    wrapRefreshButton(btn, loadFn);
  }
  // Dashboard: must reset _accessKvBuilt before calling loadStats
  wireRefreshBtn("refresh-dashboard", loadStats, function() { _accessKvBuilt = false; });
  wireRefreshBtn("refresh-sessions", loadSessions, null);
  wireRefreshBtn("refresh-modules", loadModules, null);
  wireRefreshBtn("refresh-log", loadLogs, null);
  wireRefreshBtn("refresh-queue", loadQueue, null);
  // Directory uses dir-refresh-btn (simple refresh of current view, not full import)
  wireRefreshBtn("dir-refresh-btn", loadDirectory, null);
})();
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
      const r = await fetch(`${acc.config.baseUrl}/api/sessions/${encodeURIComponent(acc.session)}/me`, {
        headers: { "x-api-key": acc.apiKey },
      });
      if (r.ok) {
        const me = await r.json() as { id?: string };
        if (typeof me.id === "string" && me.id) {
          botJidCache.set(acc.session, { jid: me.id, fetchedAt: now });
          result.add(me.id);
        }
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

  // ── Health Check (Phase 2, Plan 02) ── DO NOT REMOVE
  // Start health check loop for this session. State is stored in module-level
  // Map and accessible via getHealthState(session).
  let healthState: HealthState | undefined;
  if (!opts.abortSignal) {
    console.warn("[WAHA] Health check skipped: no abortSignal provided");
  } else {
    const baseUrl = cfg.baseUrl ?? "http://127.0.0.1:3004";
    const apiKey = account.apiKey;
    const session = cfg.session ?? "";
    if (!session) {
      console.warn("[WAHA] Health check skipped: no session configured");
    } else {
      healthState = startHealthCheck({
        baseUrl,
        apiKey,
        session,
        intervalMs: cfg.healthCheckIntervalMs,
        abortSignal: opts.abortSignal,
      });
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

    // GET /api/admin/queue -- inbound queue stats (Phase 2, Plan 02)
    if (req.url === "/api/admin/queue" && req.method === "GET") {
      writeJsonResponse(res, 200, inboundQueue.getStats());
      return;
    }

    // Phase 18: Serve React admin panel from dist/admin/ (static Vite build).
    // Falls back to old buildAdminHtml() if dist/admin/ not built yet.
    // DO NOT REMOVE the fallback — it is the safety net until Phase 24. DO NOT CHANGE.
    if (req.url === "/admin" || req.url === "/admin/") {
      const indexPath = join(ADMIN_DIST, "index.html");
      if (existsSync(indexPath)) {
        console.log(`[admin] serving React app from ${indexPath}`);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(indexPath, "utf-8"));
        return;
      }
      // Fallback: old embedded HTML (preserved until Phase 24 removes it)
      console.log(`[admin] React build not found at ${ADMIN_DIST}, serving fallback HTML`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildAdminHtml(opts.config, account));
      return;
    }

    // Phase 18: Serve hashed static assets (JS, CSS, fonts) from Vite build output.
    // Cache-Control immutable is correct for hashed filenames — they never change.
    // DO NOT REMOVE — required for React admin panel. DO NOT CHANGE.
    if (req.url?.startsWith("/assets/")) {
      const safePath = req.url.split("?")[0].replace(/\.\./g, "");
      const filePath = join(ADMIN_DIST, safePath);
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
      const dmFilter = getDmFilterForAdmin(opts.config, opts.accountId);
      const dmCfg = account.config.dmFilter ?? {};
      const groupFilter = getGroupFilterForAdmin(opts.config, opts.accountId);
      const groupFilterCfg = (account.config.groupFilter ?? {}) as Record<string, unknown>;
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
        } catch { /* non-critical */ }
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
        } catch { /* WAHA fallback is best-effort */ }
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
          enabled: dmCfg.enabled ?? false,
          patterns: dmCfg.mentionPatterns ?? [],
          godModeBypass: dmCfg.godModeBypass ?? true,
          godModeScope: dmCfg.godModeScope ?? 'all',
          godModeSuperUsers: dmCfg.godModeSuperUsers ?? [],
          tokenEstimate: dmCfg.tokenEstimate ?? 2500,
          stats: dmFilter.stats,
          recentEvents: dmFilter.recentEvents,
        },
        groupFilter: {
          enabled: Boolean(groupFilterCfg.enabled),
          patterns: Array.isArray(groupFilterCfg.mentionPatterns) ? groupFilterCfg.mentionPatterns : [],
          godModeBypass: groupFilterCfg.godModeBypass !== false,
          godModeScope: typeof groupFilterCfg.godModeScope === 'string' ? groupFilterCfg.godModeScope : 'all',
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
        sessions: listEnabledWahaAccounts(opts.config).map((acc) => {
          const h = getHealthState(acc.session);
          return {
            sessionId: acc.session,
            name: acc.name ?? acc.session,
            healthStatus: h?.status ?? "unknown",
            consecutiveFailures: h?.consecutiveFailures ?? 0,
            lastCheck: h?.lastCheckAt ?? null,
          };
        }),
      }));
      return;
    }

    // GET /api/admin/config
    if (req.url === "/api/admin/config" && req.method === "GET") {
      const wahaCfg = opts.config.channels?.waha ?? {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ waha: wahaCfg }));
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

        writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), "utf-8");
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
          const jidArray = jidsParam.split(",").map(j => j.trim()).filter(Boolean).slice(0, 500);
          const db = getDirectoryDb(opts.accountId);
          const resolvedMap = db.resolveJids(jidArray);
          const resolved: Record<string, string> = {};
          for (const [jid, name] of resolvedMap) {
            resolved[jid] = name;
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
            } catch { /* non-critical — fallback resolution is best-effort */ }
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
            } catch { /* WAHA fallback is best-effort — don't fail the request */ }
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
            } catch (_) {
              // skip individual failures — caller sees partial updated count
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

    writeJsonResponse(res, 200, { status: "ignored" });
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
