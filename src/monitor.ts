import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createLoggerBackedRuntime,
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { resolveWahaAccount } from "./accounts.js";
import { getDmFilterForAdmin, handleWahaInbound } from "./inbound.js";
import { getDirectoryDb } from "./directory.js";
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

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
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
  return process.env.OPENCLAW_CONFIG_PATH ?? join(homedir(), ".openclaw", "workspace", "openclaw.json");
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
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; }
  /* NAV */
  header { background: #1e293b; padding: 0 24px; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 0; position: sticky; top: 0; z-index: 100; }
  header .brand { font-size: 1.1rem; font-weight: 700; color: #38bdf8; padding: 14px 24px 14px 0; border-right: 1px solid #334155; margin-right: 4px; white-space: nowrap; }
  nav { display: flex; gap: 0; flex: 1; }
  nav button { background: none; border: none; color: #94a3b8; padding: 16px 20px; cursor: pointer; font-size: 0.9rem; border-bottom: 3px solid transparent; transition: color .15s, border-color .15s; white-space: nowrap; }
  nav button:hover { color: #e2e8f0; }
  nav button.active { color: #38bdf8; border-bottom-color: #38bdf8; }
  header .badge { background: #10b981; color: #fff; font-size: 0.72rem; padding: 2px 8px; border-radius: 9999px; margin-left: auto; }
  /* CONTENT */
  .tab-content { display: none; flex: 1; }
  .tab-content.active { display: block; }
  main.tab-pane { max-width: 920px; margin: 0 auto; padding: 24px; display: grid; gap: 20px; }
  /* CARDS */
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px; }
  .card h2 { font-size: 0.85rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 16px; }
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
  #last-refresh { color: #64748b; font-size: 0.75rem; text-align: right; margin-top: 4px; }
  .refresh-btn { background: #1d4ed8; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
  .refresh-btn:hover { background: #2563eb; }
  /* SETTINGS */
  .settings-section { margin-bottom: 8px; }
  .settings-section summary { cursor: pointer; font-weight: 600; color: #94a3b8; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; padding: 10px 0; list-style: none; display: flex; align-items: center; gap: 8px; }
  .settings-section summary::before { content: '▶'; font-size: 0.7rem; transition: transform .15s; }
  .settings-section[open] summary::before { transform: rotate(90deg); }
  .field-group { display: grid; gap: 12px; padding: 4px 0 16px 0; }
  .field { display: grid; gap: 4px; }
  .field label { font-size: 0.82rem; color: #94a3b8; display: flex; align-items: center; gap: 6px; }
  .field input[type=text], .field input[type=number], .field textarea, .field select {
    background: #0f172a; border: 1px solid #334155; color: #e2e8f0; border-radius: 6px;
    padding: 8px 10px; font-size: 0.88rem; width: 100%; font-family: inherit;
    transition: border-color .15s;
  }
  .field input:focus, .field textarea:focus, .field select:focus { outline: none; border-color: #38bdf8; }
  .field input[readonly] { color: #64748b; }
  .field textarea { resize: vertical; min-height: 70px; }
  .range-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  /* TOGGLE */
  .toggle-wrap { display: flex; align-items: center; gap: 10px; }
  .toggle { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
  .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
  .slider { position: absolute; inset: 0; background: #334155; border-radius: 99px; cursor: pointer; transition: background .2s; }
  .slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .2s; }
  .toggle input:checked + .slider { background: #0ea5e9; }
  .toggle input:checked + .slider::before { transform: translateX(18px); }
  /* TOOLTIP */
  .tip { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; background: #334155; border-radius: 50%; font-size: 0.7rem; color: #94a3b8; cursor: help; flex-shrink: 0; }
  .tip::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: #1e3a5f; color: #e2e8f0; font-size: 0.75rem; padding: 6px 10px; border-radius: 6px; width: 220px; pointer-events: none; opacity: 0; transition: opacity .15s; z-index: 200; white-space: normal; line-height: 1.4; border: 1px solid #334155; }
  .tip:hover::after { opacity: 1; }
  .save-btn { background: #10b981; color: #fff; border: none; padding: 10px 28px; border-radius: 8px; cursor: pointer; font-size: 0.95rem; font-weight: 600; margin-top: 8px; transition: background .15s; }
  .save-btn:hover { background: #059669; }
  /* TOAST */
  #toast { position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%) translateY(20px); background: #10b981; color: #fff; padding: 10px 24px; border-radius: 8px; font-size: 0.9rem; opacity: 0; transition: opacity .3s, transform .3s; pointer-events: none; z-index: 999; }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  #toast.error { background: #ef4444; }
  /* DIRECTORY */
  .dir-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .dir-search { flex: 1; min-width: 200px; background: #0f172a; border: 1px solid #334155; color: #e2e8f0; border-radius: 6px; padding: 8px 12px; font-size: 0.88rem; }
  .dir-search:focus { outline: none; border-color: #38bdf8; }
  .dir-stats { display: flex; gap: 16px; }
  .dir-stat { font-size: 0.8rem; color: #64748b; }
  .dir-stat span { color: #38bdf8; font-weight: 600; }
  .contact-list { display: grid; gap: 8px; }
  .contact-card { background: #0f172a; border: 1px solid #334155; border-radius: 8px; overflow: hidden; }
  .contact-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; transition: background .1s; }
  .contact-header:hover { background: #1a2540; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1rem; flex-shrink: 0; }
  .contact-info { flex: 1; min-width: 0; }
  .contact-name { font-size: 0.9rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .contact-jid { font-size: 0.75rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace; }
  .contact-meta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .badge-count { background: #1e3a5f; color: #7dd3fc; font-size: 0.72rem; padding: 2px 8px; border-radius: 9999px; }
  .contact-time { font-size: 0.75rem; color: #64748b; }
  .settings-toggle-btn { background: #1d4ed8; color: #fff; border: none; padding: 4px 12px; border-radius: 5px; cursor: pointer; font-size: 0.78rem; }
  .contact-settings-panel { display: none; padding: 16px; border-top: 1px solid #334155; background: #1a2540; }
  .contact-settings-panel.open { display: block; }
  .settings-fields { display: grid; gap: 10px; }
  .settings-field { display: grid; gap: 4px; }
  .settings-field label { font-size: 0.8rem; color: #94a3b8; }
  .settings-field select, .settings-field input[type=text] {
    background: #0f172a; border: 1px solid #334155; color: #e2e8f0; border-radius: 5px; padding: 6px 10px; font-size: 0.85rem; width: 100%;
  }
  .save-contact-btn { background: #10b981; color: #fff; border: none; padding: 6px 18px; border-radius: 5px; cursor: pointer; font-size: 0.82rem; font-weight: 600; margin-top: 6px; }
  .load-more-btn { background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 8px 24px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; margin-top: 12px; width: 100%; transition: background .1s; }
  .load-more-btn:hover { background: #334155; }
  /* DOCS */
  .docs-section { margin-bottom: 4px; }
  .docs-section summary { cursor: pointer; font-size: 1rem; font-weight: 600; color: #e2e8f0; padding: 12px 0; list-style: none; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #334155; }
  .docs-section summary::before { content: '▶'; font-size: 0.7rem; transition: transform .15s; color: #64748b; }
  .docs-section[open] summary::before { transform: rotate(90deg); }
  .docs-body { padding: 14px 0; color: #94a3b8; font-size: 0.88rem; line-height: 1.6; }
  .docs-body p { margin-bottom: 10px; }
  .docs-body code { background: #0f172a; color: #38bdf8; padding: 1px 6px; border-radius: 4px; font-family: monospace; font-size: 0.85rem; }
  .docs-body ul { margin-left: 20px; margin-bottom: 10px; }
  .docs-body li { margin-bottom: 4px; }
  /* FOOTER */
  footer { background: #1e293b; border-top: 1px solid #334155; padding: 12px 24px; text-align: center; font-size: 0.8rem; color: #64748b; margin-top: auto; }
  footer a { color: #38bdf8; text-decoration: none; }
  footer a:hover { text-decoration: underline; }
  @media (max-width: 640px) {
    main.tab-pane { padding: 16px; }
    nav button { padding: 14px 12px; font-size: 0.8rem; }
    .range-pair { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<header>
  <div class="brand">WAHA-OC Admin Panel</div>
  <nav>
    <button class="active" onclick="switchTab('dashboard', this)" id="tab-dashboard">Dashboard</button>
    <button onclick="switchTab('settings', this)" id="tab-settings">Settings</button>
    <button onclick="switchTab('directory', this)" id="tab-directory">Directory</button>
    <button onclick="switchTab('docs', this)" id="tab-docs">Docs</button>
  </nav>
  <span class="badge" id="status-badge">Loading...</span>
</header>

<!-- TOAST -->
<div id="toast"></div>

<!-- TAB: DASHBOARD -->
<div class="tab-content active" id="content-dashboard">
<main class="tab-pane">
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
    <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;align-items:center;">
      <div id="last-refresh"></div>
      <button class="refresh-btn" onclick="loadStats()">Refresh</button>
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
          <label>Session <span class="tip" data-tip="WAHA session name. Read-only — change in openclaw.json directly.">?</span></label>
          <input type="text" id="s-session" name="session" readonly>
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

    <details class="settings-section" open>
      <summary>Access Control</summary>
      <div class="field-group">
        <div class="field">
          <label>DM Policy <span class="tip" data-tip="How to handle unknown DM senders. pairing=require approval code, open=allow all, closed=block all, allowlist=only allowFrom list.">?</span></label>
          <select id="s-dmPolicy" name="dmPolicy">
            <option value="pairing">pairing</option>
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
          <label>Allow From (DMs) <span class="tip" data-tip="JIDs allowed to send DMs. One per line. Supports @c.us and @lid formats. Example: 972544329000@c.us">?</span></label>
          <textarea id="s-allowFrom" name="allowFrom" rows="3" placeholder="972544329000@c.us&#10;271862907039996@lid"></textarea>
        </div>
        <div class="field">
          <label>Group Allow From <span class="tip" data-tip="JIDs allowed to trigger the bot in groups. One per line. Include both @c.us and @lid for the same person (NOWEB sends @lid).">?</span></label>
          <textarea id="s-groupAllowFrom" name="groupAllowFrom" rows="3"></textarea>
        </div>
        <div class="field">
          <label>Allowed Groups <span class="tip" data-tip="Group JIDs the bot will respond in. One per line. Leave empty to allow all groups (with open policy).">?</span></label>
          <textarea id="s-allowedGroups" name="allowedGroups" rows="3" placeholder="120363421825201386@g.us"></textarea>
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
          <label>Mention Patterns <span class="tip" data-tip="Regex patterns (case-insensitive). DMs must match at least one. One per line. Example: sammie, help, @bot">?</span></label>
          <textarea id="s-mentionPatterns" name="mentionPatterns" rows="4" placeholder="sammie&#10;help&#10;hello"></textarea>
        </div>
        <div class="field">
          <label class="toggle-wrap">
            <span>God Mode Bypass <span class="tip" data-tip="When on, super-users bypass the keyword filter entirely (their messages always get a response).">?</span></span>
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="s-godModeBypass" name="godModeBypass"><span class="slider"></span></label>
          </label>
        </div>
        <div class="field">
          <label>Token Estimate <span class="tip" data-tip="Estimated tokens saved per dropped DM. Used for stats display only. Default: 2500.">?</span></label>
          <input type="number" id="s-tokenEstimate" name="tokenEstimate" min="100" max="100000" step="100">
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

    <div style="padding-top:8px;">
      <button type="submit" class="save-btn">Save Settings</button>
      <div id="save-note" style="font-size:0.78rem;color:#64748b;margin-top:6px;display:none">Some settings require a gateway restart to take effect.</div>
    </div>
  </form>
</div>
</main>
</div>

<!-- TAB: DIRECTORY -->
<div class="tab-content" id="content-directory">
<main class="tab-pane">
<div class="card">
  <h2>Contact Directory</h2>
  <div class="dir-header">
    <input type="text" class="dir-search" id="dir-search" placeholder="Search by name or JID..." oninput="debouncedDirSearch()">
    <div class="dir-stats" id="dir-stats"></div>
  </div>
  <div class="contact-list" id="contact-list"></div>
  <button class="load-more-btn" id="load-more-btn" onclick="loadMoreContacts()" style="display:none">Load More</button>
</div>
</main>
</div>

<!-- TAB: DOCS -->
<div class="tab-content" id="content-docs">
<main class="tab-pane">
<div class="card">
  <h2>Documentation</h2>

  <details class="docs-section" open>
    <summary>Getting Started</summary>
    <div class="docs-body">
      <p>This admin panel is your browser-based control center for the <strong>OpenClaw WAHA plugin</strong>. All changes save directly to <code>openclaw.json</code>.</p>
      <p>The plugin bridges WhatsApp (via WAHA) to your OpenClaw AI agents. Messages arrive via webhook, get filtered and routed, then responses are sent back through WAHA's REST API.</p>
      <ul>
        <li><strong>Dashboard</strong> — Live stats, filter events, session info</li>
        <li><strong>Settings</strong> — Edit all plugin config without touching JSON files</li>
        <li><strong>Directory</strong> — See who has messaged the bot, configure per-contact behavior</li>
        <li><strong>Docs</strong> — This page</li>
      </ul>
    </div>
  </details>

  <details class="docs-section">
    <summary>DM Keyword Filter</summary>
    <div class="docs-body">
      <p>The DM filter lets you control which direct messages get forwarded to your AI agent. Without it, every DM (spam, irrelevant messages) consumes tokens.</p>
      <p><strong>How it works:</strong> When enabled, a DM must match at least one <em>mention pattern</em> (regex, case-insensitive) to pass. Non-matching messages are silently dropped.</p>
      <p><strong>God Mode Bypass:</strong> Super-users listed in <code>godModeSuperUsers</code> bypass the filter entirely — useful for the bot owner.</p>
      <p><strong>Patterns:</strong> Each pattern is a JavaScript regex. Examples:</p>
      <ul>
        <li><code>sammie</code> — matches any message containing "sammie"</li>
        <li><code>^help</code> — matches messages starting with "help"</li>
        <li><code>\\bbot\\b</code> — matches the word "bot" exactly</li>
      </ul>
    </div>
  </details>

  <details class="docs-section">
    <summary>Per-DM Settings</summary>
    <div class="docs-body">
      <p>In the Directory tab, each contact can have custom behavior settings:</p>
      <ul>
        <li><strong>Mode: Active</strong> — Normal behavior, bot responds as configured</li>
        <li><strong>Mode: Listen Only</strong> — Bot tracks messages but never responds to this contact</li>
        <li><strong>Mention Only</strong> — Even if the global filter is off, this contact must mention the bot</li>
        <li><strong>Custom Keywords</strong> — Additional comma-separated keywords for this contact's filter</li>
        <li><strong>Can Initiate</strong> — Whether the bot can proactively message this contact (future feature)</li>
      </ul>
      <p>Settings are stored in a local SQLite database at <code>~/.openclaw/data/waha-directory-{accountId}.db</code>.</p>
    </div>
  </details>

  <details class="docs-section">
    <summary>Presence System (Human Mimicry)</summary>
    <div class="docs-body">
      <p>The presence system makes the bot feel more human by simulating natural messaging behavior:</p>
      <ul>
        <li><strong>Read delay</strong> — Waits before starting to type (as if reading the message)</li>
        <li><strong>Typing indicator</strong> — Shows "typing..." in WhatsApp based on response length and WPM</li>
        <li><strong>Pause breaks</strong> — Random mid-typing pauses (like a human pausing to think)</li>
        <li><strong>Jitter</strong> — Random timing variation so patterns aren't perfectly predictable</li>
      </ul>
      <p>Tune WPM and timing ranges to match your desired persona. Higher WPM = faster typist. Lower pause chance = fewer interruptions.</p>
    </div>
  </details>

  <details class="docs-section">
    <summary>Access Control</summary>
    <div class="docs-body">
      <p><strong>DM Policy options:</strong></p>
      <ul>
        <li><code>pairing</code> — Unknown senders get a pairing code. Approved users are stored in the pairing store.</li>
        <li><code>open</code> — Everyone can DM the bot (not recommended for public-facing bots)</li>
        <li><code>closed</code> — No DMs accepted</li>
        <li><code>allowlist</code> — Only JIDs in the <em>Allow From</em> list can DM</li>
      </ul>
      <p><strong>JID formats:</strong> WAHA NOWEB engine may send senders as <code>@lid</code> (linked device ID) instead of <code>@c.us</code> (phone). Add BOTH formats for the same person to ensure access.</p>
      <p><strong>Group policy</strong> works similarly but applies to group message senders.</p>
    </div>
  </details>

  <details class="docs-section">
    <summary>Troubleshooting</summary>
    <div class="docs-body">
      <p><strong>Bot not responding to messages?</strong></p>
      <ul>
        <li>Check the Dashboard → DM Filter recent events (red = dropped)</li>
        <li>Verify the sender JID is in allowFrom (try both @c.us and @lid)</li>
        <li>Check allowedGroups includes the group JID</li>
        <li>For groups: groupAllowFrom must include the sender's JID</li>
        <li>If using dmPolicy=pairing: sender must complete the pairing flow first</li>
      </ul>
      <p><strong>HMAC signature errors?</strong> The <code>webhookHmacKey</code> in this config must match the HMAC key configured in WAHA's webhook settings.</p>
      <p><strong>Settings not taking effect?</strong> Connection settings (baseUrl, webhookPort) require a gateway restart: <code>kill -9 $(pgrep -f openclaw-gatewa)</code> — systemd auto-restarts it.</p>
      <p><strong>Directory not updating?</strong> Contacts are tracked on first message receipt. The SQLite file is at <code>~/.openclaw/data/waha-directory-{accountId}.db</code>.</p>
    </div>
  </details>

</div>
</main>
</div>

<footer>
  Created with love by <a href="https://github.com/omernesh/openclaw-waha-plugin" target="_blank" rel="noopener">omer nesher</a>
  &nbsp;&bull;&nbsp;
  <a href="https://github.com/omernesh/openclaw-waha-plugin" target="_blank" rel="noopener">GitHub</a>
</footer>

<script>
// ---- Tab switching ----
function switchTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('nav button').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('content-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'dashboard') loadStats();
  if (name === 'settings') loadConfig();
  if (name === 'directory') loadDirectory();
  location.hash = name;
}

// Init from hash
(function() {
  var hash = location.hash.replace('#','') || 'dashboard';
  var valid = ['dashboard','settings','directory','docs'];
  if (!valid.includes(hash)) hash = 'dashboard';
  var btn = document.getElementById('tab-' + hash);
  switchTab(hash, btn);
})();

// ---- Helpers ----
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function stat(label, value, color) {
  return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="value" style="color:' + color + '">' + esc(String(value)) + '</div></div>';
}
function kvRow(k, v) { return '<div class="k">' + esc(k) + '</div><div class="v">' + esc(String(v != null ? v : '')) + '</div>'; }
function tags(arr) { return (arr || []).map(function(t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') || '<span style="color:#64748b">none</span>'; }
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

// ---- Dashboard ----
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
        events.slice(0,20).map(function(e) { return '<div class="event ' + (e.pass ? 'pass' : 'fail') + '">' +
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
  } catch(e) {
    document.getElementById('status-badge').textContent = 'Error';
    document.getElementById('status-badge').style.background = '#ef4444';
  }
}
if (location.hash === '' || location.hash === '#dashboard') loadStats();
setInterval(function() { if (document.getElementById('content-dashboard').classList.contains('active')) loadStats(); }, 30000);

// ---- Settings ----
async function loadConfig() {
  try {
    var r = await fetch('/api/admin/config');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();
    var w = d.waha || {};
    var setVal = function(id, v) { var el = document.getElementById(id); if (el) el.value = v != null ? v : ''; };
    var setChk = function(id, v) { var el = document.getElementById(id); if (el) el.checked = Boolean(v); };
    setVal('s-baseUrl', w.baseUrl || '');
    setVal('s-session', w.session || '');
    setVal('s-webhookPort', w.webhookPort || 8050);
    setVal('s-webhookPath', w.webhookPath || '/webhook/waha');
    setVal('s-dmPolicy', w.dmPolicy || 'pairing');
    setVal('s-groupPolicy', w.groupPolicy || 'allowlist');
    setVal('s-allowFrom', (w.allowFrom || []).join('\\n'));
    setVal('s-groupAllowFrom', (w.groupAllowFrom || []).join('\\n'));
    setVal('s-allowedGroups', (w.allowedGroups || []).join('\\n'));
    var dm = w.dmFilter || {};
    setChk('s-dmFilterEnabled', dm.enabled);
    setVal('s-mentionPatterns', (dm.mentionPatterns || []).join('\\n'));
    setChk('s-godModeBypass', dm.godModeBypass !== false);
    setVal('s-tokenEstimate', dm.tokenEstimate || 2500);
    var pr = w.presence || {};
    setChk('s-presenceEnabled', pr.enabled !== false);
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
    setChk('s-reactions', (w.actions || {}).reactions !== false);
    setChk('s-blockStreaming', w.blockStreaming === true);
  } catch(e) {
    showToast('Failed to load config: ' + e.message, true);
  }
}
async function saveSettings(e) {
  e.preventDefault();
  var getVal = function(id) { return document.getElementById(id)?.value || ''; };
  var getChk = function(id) { return document.getElementById(id)?.checked || false; };
  var splitLines = function(s) { return s.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean); };
  var parseNum = function(s, def) { var n = parseFloat(s); return isNaN(n) ? def : n; };
  var payload = {
    waha: {
      baseUrl: getVal('s-baseUrl') || undefined,
      webhookPort: parseNum(getVal('s-webhookPort'), 8050),
      webhookPath: getVal('s-webhookPath') || '/webhook/waha',
      dmPolicy: getVal('s-dmPolicy') || 'pairing',
      groupPolicy: getVal('s-groupPolicy') || 'allowlist',
      allowFrom: splitLines(getVal('s-allowFrom')),
      groupAllowFrom: splitLines(getVal('s-groupAllowFrom')),
      allowedGroups: splitLines(getVal('s-allowedGroups')),
      dmFilter: {
        enabled: getChk('s-dmFilterEnabled'),
        mentionPatterns: splitLines(getVal('s-mentionPatterns')),
        godModeBypass: getChk('s-godModeBypass'),
        tokenEstimate: parseNum(getVal('s-tokenEstimate'), 2500),
      },
      presence: {
        enabled: getChk('s-presenceEnabled'),
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
      actions: { reactions: getChk('s-reactions') },
      blockStreaming: getChk('s-blockStreaming'),
    }
  };
  try {
    var r = await fetch('/api/admin/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    var result = await r.json();
    if (!r.ok) throw new Error(result.error || 'Save failed');
    showToast('Settings saved' + (result.restartRequired ? ' (restart required)' : ''));
    if (result.restartRequired) document.getElementById('save-note').style.display = 'block';
    else document.getElementById('save-note').style.display = 'none';
  } catch(e) {
    showToast('Error: ' + e.message, true);
  }
}

// ---- Directory ----
var dirOffset = 0;
var dirSearchTimeout = null;
function debouncedDirSearch() {
  clearTimeout(dirSearchTimeout);
  dirSearchTimeout = setTimeout(function() { dirOffset = 0; loadDirectory(); }, 300);
}
async function loadDirectory() {
  var search = document.getElementById('dir-search').value.trim();
  var url = '/api/admin/directory?limit=50&offset=' + (dirOffset || 0) + (search ? '&search=' + encodeURIComponent(search) : '');
  try {
    var r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();
    document.getElementById('dir-stats').innerHTML =
      '<div class="dir-stat">Total <span>' + d.total + '</span></div>' +
      '<div class="dir-stat">DMs <span>' + d.dms + '</span></div>' +
      '<div class="dir-stat">Groups <span>' + d.groups + '</span></div>';
    var list = document.getElementById('contact-list');
    if (dirOffset === 0) list.innerHTML = '';
    if (!d.contacts || d.contacts.length === 0) {
      if (dirOffset === 0) list.innerHTML = '<div style="color:#64748b;text-align:center;padding:32px;">No contacts yet. Send a message to Sammie!</div>';
      document.getElementById('load-more-btn').style.display = 'none';
      return;
    }
    d.contacts.forEach(function(c) { list.innerHTML += buildContactCard(c); });
    dirOffset += d.contacts.length;
    document.getElementById('load-more-btn').style.display = d.contacts.length === 50 ? '' : 'none';
  } catch(e) {
    document.getElementById('contact-list').innerHTML = '<div style="color:#ef4444;padding:16px;">Error loading directory: ' + esc(e.message) + '</div>';
  }
}
async function loadMoreContacts() { await loadDirectory(); }
function buildContactCard(c) {
  var name = c.displayName || c.jid;
  var color = avatarColor(c.jid);
  var inits = initials(c.displayName || '', c.jid);
  var dm = c.dmSettings || {mode:'active',mentionOnly:false,customKeywords:'',canInitiate:true};
  var id = 'card-' + c.jid.replace(/[^a-zA-Z0-9]/g, '_');
  return '<div class="contact-card" id="' + id + '">' +
    '<div class="contact-header" onclick="toggleContactSettings(\\'' + esc(c.jid) + '\\')">' +
      '<div class="avatar" style="background:' + color + ';color:#fff">' + esc(inits) + '</div>' +
      '<div class="contact-info">' +
        '<div class="contact-name">' + esc(name) + '</div>' +
        '<div class="contact-jid">' + esc(c.jid) + '</div>' +
      '</div>' +
      '<div class="contact-meta">' +
        '<span class="contact-time">' + relTime(c.lastMessageAt) + '</span>' +
        '<span class="badge-count">' + c.messageCount + ' msg' + (c.messageCount !== 1 ? 's' : '') + '</span>' +
        '<button class="settings-toggle-btn" onclick="event.stopPropagation();toggleContactSettings(\\'' + esc(c.jid) + '\\')">Settings</button>' +
      '</div>' +
    '</div>' +
    '<div class="contact-settings-panel" id="panel-' + id + '">' +
      '<div class="settings-fields">' +
        '<div class="settings-field"><label>Mode</label><select id="mode-' + id + '"><option value="active"' + (dm.mode==='active'?' selected':'') + '>Active</option><option value="listen_only"' + (dm.mode==='listen_only'?' selected':'') + '>Listen Only</option></select></div>' +
        '<div class="settings-field"><label><input type="checkbox" id="mo-' + id + '"' + (dm.mentionOnly?' checked':'') + '> Mention Only</label></div>' +
        '<div class="settings-field"><label>Custom Keywords (comma-separated)</label><input type="text" id="kw-' + id + '" value="' + esc(dm.customKeywords) + '" placeholder="keyword1, keyword2"></div>' +
        '<div class="settings-field"><label><input type="checkbox" id="ci-' + id + '"' + (dm.canInitiate?' checked':'') + '> Can Initiate</label></div>' +
        '<button class="save-contact-btn" onclick="saveContactSettings(\\'' + esc(c.jid) + '\\', \\'' + id + '\\')">Save</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}
function toggleContactSettings(jid) {
  var id = 'card-' + jid.replace(/[^a-zA-Z0-9]/g, '_');
  var panel = document.getElementById('panel-' + id);
  if (panel) panel.classList.toggle('open');
}
async function saveContactSettings(jid, id) {
  var mode = document.getElementById('mode-' + id)?.value || 'active';
  var mentionOnly = document.getElementById('mo-' + id)?.checked || false;
  var customKeywords = document.getElementById('kw-' + id)?.value || '';
  var canInitiate = document.getElementById('ci-' + id)?.checked !== false;
  try {
    var r = await fetch('/api/admin/directory/' + encodeURIComponent(jid) + '/settings', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({mode, mentionOnly, customKeywords, canInitiate})
    });
    var result = await r.json();
    if (!r.ok) throw new Error(result.error || 'Save failed');
    showToast('Settings saved for ' + jid);
    var panel = document.getElementById('panel-' + id);
    if (panel) panel.classList.remove('open');
  } catch(e) {
    showToast('Error: ' + e.message, true);
  }
}
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

    // GET /api/admin/stats
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
        if (currentWaha.godModeSuperUsers) {
          // Preserve godModeSuperUsers from nested dmFilter if present
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

        writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, restartRequired }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // GET /api/admin/directory
    if (req.url?.startsWith("/api/admin/directory") && req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const pathParts = url.pathname.replace("/api/admin/directory", "").split("/").filter(Boolean);

      // GET /api/admin/directory/:jid
      if (pathParts.length === 1 && pathParts[0]) {
        const jid = decodeURIComponent(pathParts[0]);
        try {
          const db = getDirectoryDb(opts.accountId);
          const contact = db.getContact(jid);
          if (!contact) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Contact not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(contact));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      // GET /api/admin/directory (list)
      const search = url.searchParams.get("search") ?? undefined;
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
      try {
        const db = getDirectoryDb(opts.accountId);
        const contacts = db.getContacts({ search, limit, offset });
        const total = db.getContactCount(search);
        const dms = db.getDmCount();
        const groups = db.getGroupCount();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ contacts, total, dms, groups }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // PUT /api/admin/directory/:jid/settings
    if (req.url?.startsWith("/api/admin/directory/") && req.method === "PUT" && req.url.endsWith("/settings")) {
      const pathMatch = req.url.match(/^\/api\/admin\/directory\/(.+)\/settings$/);
      if (pathMatch) {
        const jid = decodeURIComponent(pathMatch[1]);
        try {
          const bodyStr = await readBody(req, maxBodyBytes);
          const settings = JSON.parse(bodyStr) as {
            mode?: string;
            mentionOnly?: boolean;
            customKeywords?: string;
            canInitiate?: boolean;
          };

          const db = getDirectoryDb(opts.accountId);
          // Ensure contact exists
          const contact = db.getContact(jid);
          if (!contact) {
            // Create a minimal contact record first
            db.upsertContact(jid, undefined, false);
          }

          db.setContactDmSettings(jid, {
            mode: settings.mode === "listen_only" ? "listen_only" : "active",
            mentionOnly: Boolean(settings.mentionOnly),
            customKeywords: settings.customKeywords ?? "",
            canInitiate: settings.canInitiate !== false,
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      } else {
        res.writeHead(404);
        res.end();
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

    try {
      assertAllowedSession(payload.session);
    } catch (err) {
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
        writeJsonResponse(res, 200, { status: "ignored" });
        return;
      }
      await handleWahaInbound({
        message,
        rawPayload: payload.payload,
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
      writeJsonResponse(res, 200, { status: "ok" });
      return;
    }

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
