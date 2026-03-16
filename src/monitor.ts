import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
import { getWahaChats, getWahaContact, getWahaContacts, getWahaGroups, getWahaGroupParticipants, getWahaNewsletter, getWahaAllLids, toArr } from "./send.js";
import { listEnabledWahaAccounts } from "./accounts.js";
import { verifyWahaWebhookHmac } from "./signature.js";
import { normalizeResolvedSecretInputString } from "./secret-input.js";
import { isDuplicate } from "./dedup.js";
import { startHealthCheck, getHealthState, type HealthState } from "./health.js";
import { InboundQueue, type QueueStats, type QueueItem } from "./inbound-queue.js";
import { isWhatsAppGroupJid } from "openclaw/plugin-sdk";
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

/**
 * Simple rate limiter for WAHA API calls.
 * Limits concurrent requests and enforces minimum delay between requests.
 */
class RateLimiter {
  private queue: Array<() => void> = [];
  private activeCount = 0;
  private lastRequestTime = 0;

  constructor(
    private maxConcurrent: number,
    private delayMs: number,
  ) {}

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs - elapsed));
      }
      this.lastRequestTime = Date.now();
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.activeCount++;
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < this.delayMs) {
          setTimeout(() => {
            this.lastRequestTime = Date.now();
            resolve();
          }, this.delayMs - elapsed);
        } else {
          this.lastRequestTime = Date.now();
          resolve();
        }
      });
    });
  }

  release(): void {
    this.activeCount--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}


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
  .dir-search { min-width: 200px; background: #0f172a; border: 1px solid #334155; color: #e2e8f0; border-radius: 6px; padding: 8px 12px; font-size: 0.88rem; }
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
  /* DIR TABS */
  .dir-tab { background: none; border: none; color: #94a3b8; padding: 10px 16px; cursor: pointer; font-size: 0.85rem; border-bottom: 2px solid transparent; transition: color .15s; }
  .dir-tab:hover { color: #e2e8f0; }
  .dir-tab.active { color: #38bdf8; border-bottom-color: #38bdf8; }
  /* DIR-01: Groups paginated table */
  .groups-table { width:100%; border-collapse:collapse; }
  .groups-table th, .groups-table td { padding:8px 12px; text-align:left; border-bottom:1px solid #1e293b; }
  .groups-table th { color:#94a3b8; font-size:0.75rem; text-transform:uppercase; }
  .groups-table tr:hover { background:#1e293b; cursor:pointer; }
  .page-nav { display:flex; align-items:center; justify-content:center; gap:4px; padding:8px 0; }
  .page-size-select { background:#1e293b; color:#e2e8f0; border:1px solid #334155; border-radius:4px; padding:4px 8px; font-size:0.8rem; }
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
  .log-level-btn { padding:4px 10px; border-radius:5px; border:1px solid #334155; cursor:pointer; font-size:0.75rem; background:#334155; color:#94a3b8; transition: background .1s; }
  .log-level-btn.active { background:#3b82f6; color:#fff; }
  .log-entry { display:flex; gap:8px; padding:3px 0; border-bottom:1px solid #1e293b; font-family:monospace; font-size:0.78rem; }
  .log-entry:last-child { border-bottom:none; }
  .log-ts { color:#64748b; flex-shrink:0; width:130px; }
  .log-level { flex-shrink:0; width:50px; font-weight:600; text-transform:uppercase; }
  .log-level-error { color:#ef4444; }
  .log-level-warn { color:#f59e0b; }
  .log-level-info { color:#22d3ee; }
  .log-level-debug { color:#94a3b8; }
  .log-msg { color:#e2e8f0; white-space:pre-wrap; word-break:break-all; flex:1; }
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
  .nr-name { color: #e2e8f0; font-size: 0.88rem; }
  .nr-jid { color: #64748b; font-family: monospace; font-size: 0.75rem; }
  .nr-skeleton { display: inline-block; width: 80px; height: 14px; background: linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%); background-size: 400px 100%; animation: nr-shimmer 1.2s ease-in-out infinite; border-radius: 4px; }
  /* TAG INPUT (Phase 8, UI-02) -- DO NOT CHANGE: pill bubble input replacing JID-list textareas */
  .ti-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px; min-height: 42px; cursor: text; }
  .ti-wrap.ti-focused { border-color: #38bdf8; }
  .ti-tag { background: #0ea5e9; color: #fff; font-size: 0.8rem; padding: 3px 10px; border-radius: 9999px; font-family: monospace; display: inline-flex; align-items: center; gap: 4px; }
  .ti-tag .ti-remove { cursor: pointer; color: rgba(255,255,255,0.7); font-size: 0.9rem; line-height: 1; padding: 0 2px; }
  .ti-tag .ti-remove:hover { color: #fff; }
  .ti-input { background: none; border: none; color: #e2e8f0; font-size: 0.88rem; font-family: system-ui, sans-serif; outline: none; flex: 1; min-width: 120px; }
  .ti-input::placeholder { color: #64748b; }
  /* CONTACT PICKER (Phase 8, UI-03) -- DO NOT CHANGE: searchable contact selector with multi-select */
  .cp-wrap { position: relative; }
  .cp-selected { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .cp-chip { background: #1e3a5f; color: #7dd3fc; font-size: 0.75rem; padding: 4px 12px; border-radius: 4px; font-family: monospace; display: inline-flex; align-items: center; gap: 6px; }
  .cp-chip .cp-chip-remove { cursor: pointer; color: #7dd3fc; font-size: 0.85rem; line-height: 1; padding: 0 2px; }
  .cp-chip .cp-chip-remove:hover { color: #ef4444; }
  .cp-search { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px 12px; color: #e2e8f0; font-size: 0.88rem; font-family: system-ui, sans-serif; outline: none; box-sizing: border-box; }
  .cp-search:focus { border-color: #38bdf8; }
  .cp-search::placeholder { color: #64748b; }
  .cp-dropdown { position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.4); max-height: 240px; overflow-y: auto; z-index: 300; display: none; }
  .cp-dropdown.cp-open { display: block; }
  .cp-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; transition: background .1s; }
  .cp-row:hover { background: #0f172a; }
  .cp-row .cp-av { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8rem; flex-shrink: 0; color: #fff; }
  .cp-row .cp-row-info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
  .cp-row .cp-row-name { color: #e2e8f0; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-row .cp-row-jid { color: #64748b; font-family: monospace; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-row .cp-check { color: #10b981; font-size: 0.85rem; flex-shrink: 0; width: 20px; text-align: center; }
  .cp-empty { color: #64748b; text-align: center; padding: 16px; font-size: 0.85rem; }
  .cp-loading { padding: 10px 12px; }
  /* SESSION ROW (Phase 11, Plan 01 - DASH-01) -- DO NOT CHANGE: compact multi-session row in Dashboard card */
  .session-row { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #1e293b; font-size:0.82rem; }
  .session-row:last-child { border-bottom:none; }
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
    <button onclick="switchTab('logs', this)" id="tab-logs">Log</button>
  </nav>
  <span class="badge" id="status-badge">Loading...</span>
</header>

<!-- TOAST -->
<div id="toast"></div>

<!-- DIR-04: Bulk action toolbar — fixed at bottom, shown only when bulk items are selected -->
<div id="bulk-toolbar" style="display:none;position:fixed;bottom:0;left:0;right:0;background:#0f172a;border-top:2px solid #1d4ed8;padding:12px 24px;z-index:1000;align-items:center;gap:16px;">
  <span id="bulk-count" style="color:#94a3b8;font-size:0.88rem;font-weight:600;"></span>
  <div id="bulk-actions" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
</div>

<!-- TAB: DASHBOARD -->
<div class="tab-content active" id="content-dashboard">
<main class="tab-pane">
  <div class="card" id="dm-filter-card">
    <h2>DM Keyword Filter</h2>
    <div class="stat-row" id="filter-stats"></div>
    <div id="filter-patterns" style="margin-top:12px;"></div>
    <div class="event-list" id="filter-events"></div>
  </div>
  <div class="card" id="group-filter-card">
    <h2>Group Keyword Filter</h2>
    <div class="stat-row" id="group-filter-stats"></div>
    <div id="group-filter-patterns" style="margin-top:12px;"></div>
    <div class="event-list" id="group-filter-events"></div>
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
    <h2>Sessions <span id="health-dot" style="display:inline-block;width:12px;height:12px;border-radius:50%;margin-left:8px;vertical-align:middle;background:#94a3b8;" title="Loading..."></span></h2>
    <!-- Phase 11, Plan 01 (DASH-01): multi-session rows rendered by loadDashboardSessions(). DO NOT REMOVE. -->
    <div id="dashboard-sessions" style="margin-bottom:12px;"></div>
    <div class="kv" id="session-kv"></div>
    <div class="kv" id="health-kv" style="margin-top:8px;border-top:1px solid #334155;padding-top:8px;"></div>
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
          <label>DM Policy <span class="tip" data-tip="How to handle DMs from unknown senders. open: accept all. closed: block all. allowlist: only contacts in Allow From list. pairing: not supported in current SDK integration.">?</span></label>
          <select id="s-dmPolicy" name="dmPolicy">
            <!-- UX-01: pairing disabled - SDK integration not verified -->
            <option value="pairing" disabled>pairing (not available)</option>
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
          <label>Mention Patterns <span class="tip" data-tip="Regex patterns (case-insensitive). DMs must match at least one. One per line. Example: bot, help, @bot">?</span></label>
          <textarea id="s-mentionPatterns" name="mentionPatterns" rows="4" placeholder="bot&#10;help&#10;hello"></textarea>
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
          <label>Mention Patterns <span class="tip" data-tip="Regex patterns (case-insensitive). Group messages must match at least one. One per line. This uses OpenClaw's built-in group interaction filtering with regex support.">?</span></label>
          <textarea id="s-groupMentionPatterns" name="groupMentionPatterns" rows="4" placeholder="bot&#10;@bot&#10;help"></textarea>
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
        <div id="media-sub-toggles" style="display:none;padding-left:16px;border-left:2px solid #334155;gap:10px;">
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
          <label style="color:#64748b;font-size:0.82rem;">Poll Handling &nbsp;<span style="background:#10b981;color:#fff;font-size:0.72rem;padding:2px 8px;border-radius:9999px;">Automatic (built-in)</span></label>
        </div>
        <div class="field">
          <label style="color:#64748b;font-size:0.82rem;">Event Handling &nbsp;<span style="background:#10b981;color:#fff;font-size:0.72rem;padding:2px 8px;border-radius:9999px;">Automatic (built-in)</span></label>
        </div>
      </div>
    </details>

    <div style="padding-top:8px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">
      <button type="submit" class="save-btn">Save Settings</button>
      <button type="button" class="save-btn" style="background:#f59e0b;" onclick="saveAndRestart()">Save &amp; Restart</button>
      <div id="save-note" style="font-size:0.78rem;color:#64748b;margin-top:6px;display:none;width:100%;">Some settings require a gateway restart to take effect.</div>
    </div>
  </form>
<!-- Multi-Session Filtering Guide — collapsible reference for admin panel users -->  <details class="settings-section" style="margin-top:20px;border-top:1px solid #334155;padding-top:12px;">    <summary style="color:#38bdf8;">Multi-Session Filtering Guide</summary>    <div style="font-size:0.82rem;color:#cbd5e1;line-height:1.7;padding:8px 0 16px 0;">      <p style="color:#94a3b8;margin-bottom:12px;font-style:italic;">How messages flow through the guardrails:</p>      <ol style="padding-left:20px;margin-bottom:16px;display:grid;gap:4px;">        <li><strong style="color:#f8fafc;">Group allowlist</strong> — Is this group allowed? If not → dropped (zero tokens)</li>        <li><strong style="color:#f8fafc;">Sender allowlist</strong> — Is this sender allowed? If not → dropped</li>        <li><strong style="color:#f8fafc;">Cross-session dedup</strong> — Bot session claims first (200ms priority). If bot already claimed → human session drops the duplicate</li>        <li><strong style="color:#f8fafc;">Trigger prefix</strong> — Does the message start with the trigger operator (e.g., "!")? If required and missing → dropped</li>        <li><strong style="color:#f8fafc;">Keyword filter</strong> — Does the message match a keyword pattern? If not → dropped</li>        <li><strong style="color:#10b981;">Only then</strong> → Bot processes the message</li>      </ol>      <p style="color:#94a3b8;font-weight:600;margin-bottom:8px;text-transform:uppercase;font-size:0.78rem;letter-spacing:0.06em;">Scenarios</p>      <div style="background:#0f172a;border-radius:8px;padding:12px 14px;margin-bottom:10px;">        <p style="color:#38bdf8;font-weight:600;margin-bottom:6px;">Bot + Human session in same group</p>        <ul style="padding-left:16px;display:grid;gap:3px;">          <li>Normal message from anyone → Bot session handles it, human session drops the dupe</li>          <li>"hey bot, what's the weather?" → Bot session handles (keyword match), human drops dupe</li>          <li>"!what's the weather?" → Bot session handles (trigger match), human drops dupe</li>          <li>Your message to a friend (no keyword) → Filtered on both sessions. God mode only bypasses DM filter, not group filter. The bot stays quiet.</li>        </ul>      </div>      <div style="background:#0f172a;border-radius:8px;padding:12px 14px;margin-bottom:10px;">        <p style="color:#38bdf8;font-weight:600;margin-bottom:6px;">Only human session in group (bot not a member)</p>        <ul style="padding-left:16px;display:grid;gap:3px;">          <li>Normal message → Filtered (no keyword/trigger match). The bot stays quiet.</li>          <li>"!what's the weather?" → Trigger activates on human session. The bot responds with 🤖 prefix via your session.</li>          <li>Your message (superuser, no keyword) → Filtered. God mode scope is "dm" so groups still require keyword/trigger.</li>        </ul>      </div>      <div style="background:#0f172a;border-radius:8px;padding:12px 14px;margin-bottom:10px;">        <p style="color:#38bdf8;font-weight:600;margin-bottom:6px;">DMs</p>        <ul style="padding-left:16px;display:grid;gap:3px;">          <li>You (superuser) DM the bot → God mode bypasses DM filter. The bot responds normally.</li>          <li>Someone else DMs → Must match keyword pattern or trigger prefix to reach the bot.</li>        </ul>      </div>      <div style="background:#0f172a;border-radius:8px;padding:12px 14px;margin-bottom:10px;">        <p style="color:#38bdf8;font-weight:600;margin-bottom:6px;">Bot prefix</p>        <p>When the bot responds through a human session (cross-session routing), messages are prefixed with 🤖 so recipients know it's the bot, not you.</p>      </div>      <div style="background:#0f172a;border-radius:8px;padding:12px 14px;margin-bottom:10px;">        <p style="color:#38bdf8;font-weight:600;margin-bottom:6px;">God Mode Scope</p>        <ul style="padding-left:16px;display:grid;gap:3px;">          <li><strong style="color:#f8fafc;">"all"</strong> — Superusers bypass ALL filters (DM + group). Use with caution.</li>          <li><strong style="color:#f8fafc;">"dm"</strong> <span style="color:#10b981;">(recommended)</span> — Superusers bypass DM filter only. Groups always require keyword/trigger.</li>          <li><strong style="color:#f8fafc;">"off"</strong> — Superusers never bypass filters. Must always use keyword/trigger.</li>        </ul>      </div>      <div style="background:#0f172a;border-radius:8px;padding:12px 14px;">        <p style="color:#38bdf8;font-weight:600;margin-bottom:6px;">Per-Group Filter Overrides</p>        <ul style="padding-left:16px;display:grid;gap:3px;">          <li>Per-group overrides take <strong style="color:#f8fafc;">priority over the global filter</strong>. When a group has an override, global settings are ignored for that group.</li>          <li>Override with <strong style="color:#f8fafc;">filterEnabled=false</strong> → ALL messages in that group reach the bot (no keyword/trigger required).</li>          <li>Override with <strong style="color:#f8fafc;">custom keywords</strong> → those keywords are used instead of the global keyword list.</li>          <li>Groups <strong style="color:#f8fafc;">without overrides</strong> continue using the global filter as usual.</li>          <li>Configure per-group overrides in the <strong style="color:#38bdf8;">Directory</strong> tab — click on a group to manage its settings.</li>        </ul>      </div>    </div>  </details>
</div>
</main>
</div>

<!-- TAB: DIRECTORY -->
<div class="tab-content" id="content-directory">
<main class="tab-pane">
<div class="card">
  <h2>Contact Directory</h2>
  <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:1px solid #334155;">
    <button class="dir-tab active" onclick="switchDirTab('contacts',this)" id="dtab-contacts">Contacts</button>
    <button class="dir-tab" onclick="switchDirTab('groups',this)" id="dtab-groups">Groups</button>
    <button class="dir-tab" onclick="switchDirTab('newsletters',this)" id="dtab-newsletters">Channels</button>
  </div>
  <div class="dir-header">
    <div style="position:relative;flex:1;">
      <input type="text" class="dir-search" id="dir-search" placeholder="Search by name or JID..." oninput="debouncedDirSearch()" style="width:100%;padding-right:28px;">
      <button id="dir-search-clear" onclick="clearDirSearch()" aria-label="Clear search" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;line-height:1;padding:0 4px;" onmouseover="this.style.color='#e2e8f0'" onmouseout="this.style.color='#94a3b8'">&#x2715;</button>
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
      <button class="refresh-btn" onclick="loadQueue()">Refresh</button>
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
    <p style="margin-top:16px;font-size:0.78rem;color:#64748b;border-top:1px solid #334155;padding-top:12px;">Changes take effect after gateway restart.</p>
    <div style="margin-top:8px;display:flex;justify-content:flex-end;">
      <button class="refresh-btn" onclick="loadSessions()">Refresh</button>
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
    <input type="text" id="log-search" placeholder="Filter logs..." oninput="debouncedLogSearch()" style="flex:1;min-width:180px;padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:0.82rem;">
    <button onclick="setLogLevel('all')" id="log-level-all" class="log-level-btn active">All</button>
    <button onclick="setLogLevel('error')" id="log-level-error" class="log-level-btn">Error</button>
    <button onclick="setLogLevel('warn')" id="log-level-warn" class="log-level-btn">Warn</button>
    <button onclick="setLogLevel('info')" id="log-level-info" class="log-level-btn">Info</button>
    <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;color:#94a3b8;cursor:pointer;"><input type="checkbox" id="log-autoscroll" checked> Auto-scroll</label>
    <button onclick="loadLogs()" style="padding:4px 12px;border-radius:5px;border:1px solid #334155;cursor:pointer;font-size:0.75rem;background:#1e293b;color:#e2e8f0;">Refresh</button>
  </div>
  <div id="log-source" style="font-size:0.72rem;color:#64748b;margin-bottom:6px;"></div>
  <div id="log-output" style="background:#0f172a;color:#e2e8f0;padding:16px;border-radius:8px;max-height:70vh;overflow-y:auto;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:0.78rem;line-height:1.4;margin:0;"></div>
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
  if (name === 'queue') loadQueue();
  if (name === 'sessions') loadSessions();
  if (name === 'logs') { loadLogs(); startLogRefresh(); } else { stopLogRefresh(); }
  location.hash = name;
}

// Init from hash
(function() {
  var hash = location.hash.replace('#','') || 'dashboard';
  var valid = ['dashboard','settings','directory','logs','queue','sessions'];
  if (!valid.includes(hash)) hash = 'dashboard';
  var btn = document.getElementById('tab-' + hash);
  switchTab(hash, btn);
})();

// ---- Helpers ----
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
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
  return input.split(/[,\n]+/).map(function(t) { return t.trim(); }).filter(Boolean);
}

// ---- Tag Input (Phase 8, UI-02) -- DO NOT CHANGE: pill bubble input factory for JID list fields ----
function createTagInput(containerId, opts) {
  opts = opts || {};
  var container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return null;
  var tags = [];
  var wrap = document.createElement('div');
  wrap.className = 'ti-wrap';
  var input = document.createElement('input');
  input.className = 'ti-input';
  input.type = 'text';
  input.placeholder = opts.placeholder || 'Type JID or phone, press Enter';
  wrap.appendChild(input);
  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(wrap);

  function renderTags() {
    var existing = wrap.querySelectorAll('.ti-tag');
    for (var i = 0; i < existing.length; i++) wrap.removeChild(existing[i]);
    for (var j = 0; j < tags.length; j++) {
      (function(idx, val) {
        var pill = document.createElement('span');
        pill.className = 'ti-tag';
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
      // Resolve display names asynchronously (best-effort)
      selected.forEach(function(item) {
        fetch('/api/admin/directory/' + encodeURIComponent(item.jid))
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(data) {
            if (data && data.displayName) {
              for (var k = 0; k < selected.length; k++) {
                if (selected[k].jid === item.jid) {
                  selected[k].displayName = data.displayName;
                  break;
                }
              }
              renderChips();
            }
          })
          .catch(function(err) { console.warn('[waha] name resolve failed:', item.jid, err); });
      });
    },
    getSelected: function() { return selected.slice(); },
    // Allow callers to directly set selected with full objects (jid + displayName + any extra fields)
    // This preserves all properties on the objects, unlike setValue which only takes JID strings.
    // Used by createGodModeUsersField to store lid pairings inside the picker's closure.
    setSelectedObjects: function(items) {
      selected = (items || []).slice();
      renderChips();
      // Resolve display names for items that only have jid as displayName
      selected.forEach(function(item) {
        if (item.displayName && item.displayName !== item.jid) return; // already has a name
        fetch('/api/admin/directory/' + encodeURIComponent(item.jid))
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(data) {
            if (data && data.displayName) {
              for (var k = 0; k < selected.length; k++) {
                if (selected[k].jid === item.jid) {
                  selected[k].displayName = data.displayName;
                  break;
                }
              }
              renderChips();
            }
          })
          .catch(function(err) { console.warn('[waha] name resolve failed:', item.jid, err); });
      });
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

// ---- Tag Input instance variables (Phase 8, UI-02) -- initialized lazily in loadConfig() ----
var tagInputAllowFrom = null;
var tagInputGroupAllowFrom = null;
var tagInputAllowedGroups = null;
// ---- Group Filter Override tag input instances (Phase 9, UX-03) -- keyed by sanitized JID suffix ----
var gfoTagInputs = {};
// ---- God Mode Users Field instance variables (Phase 8, UI-04) -- initialized lazily in loadConfig() ----
var godModePickerDm = null;
var godModePickerGroup = null;

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
    // Group filter card
    if (d.groupFilter) {
      var gf = d.groupFilter;
      var gs = gf.stats || {allowed:0,dropped:0,tokensEstimatedSaved:0};
      document.getElementById('group-filter-stats').innerHTML = [
        stat('Allowed', gs.allowed, '#10b981'),
        stat('Dropped', gs.dropped, '#f87171'),
        stat('Tokens Saved (est)', (gs.tokensEstimatedSaved || 0).toLocaleString(), '#38bdf8'),
      ].join('');
      var gpats = gf.patterns || [];
      document.getElementById('group-filter-patterns').innerHTML = '<div style="color:#94a3b8;font-size:.8rem;margin-bottom:6px;">Patterns</div><div class="pattern-list">' +
        (gpats.length ? gpats.map(function(p) { return '<span class="pattern">' + esc(p) + '</span>'; }).join('') : '<span style="color:#64748b">none</span>') + '</div>';
      var gevents = gf.recentEvents || [];
      document.getElementById('group-filter-events').innerHTML = gevents.length
        ? '<div style="color:#94a3b8;font-size:.8rem;margin:10px 0 6px;">Recent Events (last ' + gevents.length + ')</div>' +
          gevents.slice(0,20).map(function(e) { return '<div class="event ' + (e.pass ? 'pass' : 'fail') + '">' +
            '<span class="ts">' + new Date(e.ts).toLocaleTimeString() + '</span>' +
            '<span class="reason">' + esc(e.reason) + '</span>' +
            '<span class="preview">' + esc(e.preview) + '</span>' +
          '</div>'; }).join('')
        : '<div style="color:#64748b;margin-top:8px;font-size:.8rem">No events yet</div>';
      document.getElementById('group-filter-card').style.display = '';
    } else {
      document.getElementById('group-filter-card').style.display = 'none';
    }
    var pr = d.presence;
    document.getElementById('presence-kv').innerHTML = kvRow('enabled', pr.enabled !== false) +
      kvRow('wpm', pr.wpm) + kvRow('readDelayMs', JSON.stringify(pr.readDelayMs)) +
      kvRow('typingDurationMs', JSON.stringify(pr.typingDurationMs)) +
      kvRow('pauseChance', pr.pauseChance) + kvRow('jitter', JSON.stringify(pr.jitter));
    // Phase 8, UI-01 -- access-kv uses Name Resolver for JID display. DO NOT REVERT to innerHTML tags().
    var ac = d.access;
    var accessKv = document.getElementById('access-kv');
    accessKv.innerHTML = kvRow('dmPolicy', ac.dmPolicy) + kvRow('groupPolicy', ac.groupPolicy);
    var jidGroups = [
      { key: 'allowFrom', arr: ac.allowFrom || [] },
      { key: 'groupAllowFrom', arr: ac.groupAllowFrom || [] },
      { key: 'allowedGroups', arr: ac.allowedGroups || [] }
    ];
    for (var gi = 0; gi < jidGroups.length; gi++) {
      (function(grp) {
        var keyEl = document.createElement('div');
        keyEl.className = 'k';
        keyEl.style.marginTop = '8px';
        keyEl.textContent = grp.key;
        var valEl = document.createElement('div');
        valEl.className = 'tag-list';
        valEl.style.padding = '4px 0';
        valEl.id = 'nr-' + grp.key;
        accessKv.appendChild(keyEl);
        accessKv.appendChild(valEl);
        if (!grp.arr.length) {
          var noneEl = document.createElement('span');
          noneEl.style.color = '#64748b';
          noneEl.textContent = 'none';
          valEl.appendChild(noneEl);
        } else {
          for (var ji = 0; ji < grp.arr.length; ji++) {
            createNameResolver(valEl, grp.arr[ji]);
          }
        }
      })(jidGroups[gi]);
    }
    document.getElementById('session-kv').innerHTML =
      kvRow('baseUrl', d.baseUrl) +
      kvRow('webhookPort', d.webhookPort) + kvRow('serverTime', d.serverTime);
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
  logSearchTimeout = setTimeout(loadLogs, 300);
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
  var m = line.match(/^(\w{3}\s+\d+\s+[\d:]+)\s+\S+\s+\S+:\s(.*)$/);
  if (m) return { ts: m[1], msg: m[2] };
  // Fallback for non-journalctl lines (file source or malformed)
  return { ts: '', msg: line };
}

// Phase 11, Plan 02 (LOG-01) -- detect log level from line content. DO NOT REMOVE.
function detectLogLevel(line) {
  if (/error/i.test(line)) return 'error';
  if (/warn/i.test(line)) return 'warn';
  if (/\[waha\]/i.test(line)) return 'info';
  return 'debug';
}

async function loadLogs() {
  var search = (document.getElementById('log-search') || {}).value || '';
  search = search.trim();
  var url = '/api/admin/logs?lines=200&level=' + currentLogLevel + (search ? '&search=' + encodeURIComponent(search) : '');
  try {
    var r = await fetch(url);
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
    var r = await fetch('/api/admin/queue');
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
    var r = await fetch('/api/admin/sessions');
    var container = document.getElementById('dashboard-sessions');
    if (!container) return;
    if (!r.ok) {
      var errEl = document.createElement('div');
      errEl.style.cssText = 'color:#ef4444;font-size:0.82rem;padding:4px 0;';
      errEl.textContent = 'Could not load sessions (HTTP ' + r.status + ')';
      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(errEl);
      return;
    }
    var sessions = await r.json();
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      var emptyEl = document.createElement('div');
      emptyEl.style.cssText = 'color:#64748b;font-size:0.82rem;padding:4px 0;';
      emptyEl.textContent = 'No sessions configured.';
      container.appendChild(emptyEl);
      return;
    }
    for (var i = 0; i < sessions.length; i++) {
      (function(s) {
        var row = document.createElement('div');
        row.className = 'session-row';
        var nameEl = document.createElement('span');
        nameEl.style.cssText = 'flex:1;font-weight:500;color:#e2e8f0;';
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
        wahaEl.style.cssText = 'font-family:monospace;font-size:0.75rem;color:#94a3b8;';
        wahaEl.textContent = s.wahaStatus || 'UNKNOWN';
        row.appendChild(nameEl);
        row.appendChild(roleEl);
        row.appendChild(subRoleEl);
        row.appendChild(dotEl);
        row.appendChild(wahaEl);
        container.appendChild(row);
      })(sessions[i]);
    }
  } catch(e) {
    console.warn('[waha] loadDashboardSessions failed:', e.message || e);
  }
}

// ---- Sessions Tab (Phase 4, Plan 04) ----
// Phase 11, Plan 01 (SESS-01): saveSessionRole -- save role/subRole via PUT endpoint. DO NOT REMOVE.
async function saveSessionRole(sessionId, role, subRole) {
  try {
    var body = {};
    if (role !== null) body.role = role;
    if (subRole !== null) body.subRole = subRole;
    var r = await fetch('/api/admin/sessions/' + encodeURIComponent(sessionId) + '/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (r.ok) {
      showToast('Role saved. Restart gateway to apply changes.');
      loadSessions();
    } else {
      var errData = await r.json().catch(function() { return {}; });
      showToast(errData.error || 'Failed to save role', true);
    }
  } catch(e) {
    showToast('Error saving role: ' + (e.message || String(e)), true);
  }
}

async function loadSessions() {
  var container = document.getElementById('sessions-list');
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
  var loadingEl = document.createElement('div');
  loadingEl.style.cssText = 'color:#64748b;font-size:0.85rem;';
  loadingEl.textContent = 'Loading...';
  container.appendChild(loadingEl);
  try {
    var r = await fetch('/api/admin/sessions');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var sessions = await r.json();
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      var noneEl = document.createElement('div');
      noneEl.style.cssText = 'color:#64748b;font-size:0.85rem;';
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
      var roleSelect =
        '<select onchange="saveSessionRole(\'' + esc(s.sessionId) + '\', this.value, null)" style="background:' + roleBadgeColor(s.role) + ';color:#fff;font-size:0.72rem;padding:2px 6px;border-radius:6px;border:1px solid #475569;cursor:pointer;">' +
          '<option value="bot"' + (s.role === 'bot' ? ' selected' : '') + '>bot</option>' +
          '<option value="human"' + (s.role === 'human' ? ' selected' : '') + '>human</option>' +
        '</select>';
      var subRoleSelect =
        '<select onchange="saveSessionRole(\'' + esc(s.sessionId) + '\', null, this.value)" style="background:' + subRoleBadgeColor(s.subRole) + ';color:#fff;font-size:0.72rem;padding:2px 6px;border-radius:6px;border:1px solid #475569;cursor:pointer;margin-left:4px;">' +
          '<option value="full-access"' + (s.subRole === 'full-access' ? ' selected' : '') + '>full-access</option>' +
          '<option value="listener"' + (s.subRole === 'listener' ? ' selected' : '') + '>listener</option>' +
        '</select>';
      return '<div class="contact-card" style="background:#0f172a;">' +
        '<div class="contact-header" style="cursor:default;">' +
          '<div class="avatar" style="background:' + roleBadgeColor(s.role) + ';font-size:0.85rem;">' + esc((s.name || s.sessionId || '?').substring(0, 2).toUpperCase()) + '</div>' +
          '<div class="contact-info">' +
            '<div class="contact-name">' + displayName + '</div>' +
            '<div class="contact-jid">' + sessionId + '</div>' +
          '</div>' +
          '<div class="contact-meta">' +
            roleSelect +
            subRoleSelect +
            '<span style="display:inline-flex;align-items:center;gap:5px;margin-left:8px;font-size:0.78rem;color:#94a3b8;" title="' + dotTitle + '">' +
              '<span style="width:10px;height:10px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;display:inline-block;"></span>' +
              esc(s.healthStatus || 'unknown') +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div style="padding:8px 16px 12px;border-top:1px solid #334155;font-size:0.78rem;display:grid;grid-template-columns:130px 1fr;gap:4px 12px;background:#1a2540;">' +
          '<span style="color:#64748b;">WAHA Status</span><span style="font-family:monospace;color:#e2e8f0;">' + wahaStatus + '</span>' +
          '<span style="color:#64748b;">Failures</span><span style="color:#e2e8f0;">' + esc(String(s.consecutiveFailures ?? 0)) + '</span>' +
          '<span style="color:#64748b;">Last Check</span><span style="color:#e2e8f0;">' + esc(lastCheckStr) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    container.innerHTML = html;
  } catch(e) {
    while (container.firstChild) container.removeChild(container.firstChild);
    var errEl = document.createElement('div');
    errEl.style.cssText = 'color:#ef4444;font-size:0.85rem;';
    errEl.textContent = 'Failed to load sessions: ' + (e.message || String(e));
    container.appendChild(errEl);
  }
}

// ---- Settings ----
async function loadConfig() {
  try {
    var r = await fetch('/api/admin/config');
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
        var sr = await fetch('/api/admin/sessions');
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
    setVal('s-dmPolicy', w.dmPolicy || 'pairing');
    setVal('s-groupPolicy', w.groupPolicy || 'allowlist');
    // Phase 8, UI-02 -- Tag Input components replace textareas for JID lists. DO NOT REVERT to setVal.
    if (!tagInputAllowFrom) tagInputAllowFrom = createTagInput('s-allowFrom-ti', { placeholder: '972544329000@c.us' });
    if (!tagInputGroupAllowFrom) tagInputGroupAllowFrom = createTagInput('s-groupAllowFrom-ti', { placeholder: 'Phone or JID, press Enter' });
    if (!tagInputAllowedGroups) tagInputAllowedGroups = createTagInput('s-allowedGroups-ti', { placeholder: '120363421825201386@g.us' });
    if (tagInputAllowFrom) tagInputAllowFrom.setValue(w.allowFrom || []);
    if (tagInputGroupAllowFrom) tagInputGroupAllowFrom.setValue(w.groupAllowFrom || []);
    if (tagInputAllowedGroups) tagInputAllowedGroups.setValue(w.allowedGroups || []);
    var dm = w.dmFilter || {};
    setChk('s-dmFilterEnabled', dm.enabled);
    setVal('s-mentionPatterns', (dm.mentionPatterns || []).join('\\n'));
    setChk('s-godModeBypass', dm.godModeBypass !== false);
    setVal('s-godModeScope', dm.godModeScope || 'all');
    // Phase 8, UI-04 -- God Mode Users Field (Contact Picker with paired JID support)
    if (!godModePickerDm) godModePickerDm = createGodModeUsersField('s-godModeSuperUsers-cp', { placeholder: 'Search god mode users...' });
    if (godModePickerDm) godModePickerDm.setValue(dm.godModeSuperUsers || []);
    setVal('s-tokenEstimate', dm.tokenEstimate || 2500);
    var gf = w.groupFilter || {};
    setChk('s-groupFilterEnabled', gf.enabled);
    setVal('s-groupMentionPatterns', (gf.mentionPatterns || []).join('\\n'));
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
      dmPolicy: getVal('s-dmPolicy') || 'pairing',
      groupPolicy: getVal('s-groupPolicy') || 'allowlist',
      // Phase 8, UI-02 -- read from Tag Input components. DO NOT REVERT to splitLines(getVal(...)).
      allowFrom: tagInputAllowFrom ? tagInputAllowFrom.getValue() : [],
      groupAllowFrom: tagInputGroupAllowFrom ? tagInputGroupAllowFrom.getValue() : [],
      allowedGroups: tagInputAllowedGroups ? tagInputAllowedGroups.getValue() : [],
      dmFilter: {
        enabled: getChk('s-dmFilterEnabled'),
        mentionPatterns: splitLines(getVal('s-mentionPatterns')),
        godModeBypass: getChk('s-godModeBypass'),
        godModeScope: getVal('s-godModeScope') || 'all',
        // Phase 8, UI-04 -- read from God Mode Users Field. DO NOT REVERT to splitLines(getVal(...)).
        godModeSuperUsers: godModePickerDm ? godModePickerDm.getValue().map(function(id) { return { identifier: id }; }) : [],
        tokenEstimate: parseNum(getVal('s-tokenEstimate'), 2500),
      },
      groupFilter: {
        enabled: getChk('s-groupFilterEnabled'),
        mentionPatterns: splitLines(getVal('s-groupMentionPatterns')),
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
  dirAutoImported = false;
  // DIR-04: Clear bulk selection state on tab switch (Pitfall 4)
  bulkSelectMode = false;
  bulkSelectedJids.clear();
  bulkCurrentGroupJid = null;
  updateBulkToolbar();
  loadDirectory();
}
// UX-04: Clear search bar and reload directory
function clearDirSearch() {
  var el = document.getElementById('dir-search');
  if (el) el.value = '';
  dirOffset = 0;
  loadDirectory();
}
// ---- Directory refresh ----
async function refreshDirectory() {
  var btn = document.getElementById('dir-refresh-all-btn');
  if (btn) { btn.textContent = 'Importing...'; btn.disabled = true; }
  try {
    var r = await fetch('/api/admin/directory/refresh', { method: 'POST' });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Refresh failed');
    showToast('Imported ' + d.contacts + ' contacts, ' + d.groups + ' groups' + (d.namesResolved ? ', resolved ' + d.namesResolved + ' names' : ''));
    dirOffset = 0;
    await loadDirectory();
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
  if (currentDirTab === 'groups') { loadGroupsTable(); } else { dirOffset = 0; loadDirectory(); }
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
      '<button onclick="bulkAction(\'allow-group\')" style="background:#10b981;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Allow Group</button>' +
      '<button onclick="bulkAction(\'revoke-group\')" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Revoke Group</button>' +
      '<button onclick="bulkRoleAction()" style="background:#1d4ed8;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Set Role</button>';
  } else {
    // Contacts context: Allow DM / Revoke DM
    actionsEl.innerHTML =
      '<button onclick="bulkAction(\'allow-dm\')" style="background:#10b981;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Allow DM</button>' +
      '<button onclick="bulkAction(\'revoke-dm\')" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-size:0.85rem;">Revoke DM</button>';
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
    } else if (currentDirTab === 'groups') { loadGroupsTable(); } else { dirOffset = 0; loadDirectory(); }
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
function debouncedDirSearch() {
  clearTimeout(dirSearchTimeout);
  dirSearchTimeout = setTimeout(function() { dirOffset = 0; dirGroupPage = 1; loadDirectory(); }, 300);
}
async function loadDirectory() {
  // DIR-01: groups tab uses a separate paginated table renderer — do not use infinite-scroll path
  if (currentDirTab === 'groups') { return loadGroupsTable(); }
  var search = document.getElementById('dir-search').value.trim();
  var typeParam = currentDirTab === 'contacts' ? '&type=contact' : '&type=newsletter';
  var url = '/api/admin/directory?limit=50&offset=' + (dirOffset || 0) + typeParam + (search ? '&search=' + encodeURIComponent(search) : '');
  try {
    var r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();
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
      if (dirOffset === 0) list.innerHTML = '<div style="color:#64748b;text-align:center;padding:32px;">No entries found.</div>';
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

// DIR-01: Build page navigation HTML — pure function, returns '' for single-page results.
// All button labels and onclick args are static integers — no user data, no XSS risk.
function buildPageNav(currentPage, totalPages) {
  if (totalPages <= 1) return '';
  var start = Math.max(1, currentPage - 2);
  var end = Math.min(totalPages, start + 4);
  start = Math.max(1, end - 4); // re-anchor if end hit the wall
  var sBase = 'padding:4px 10px;border-radius:4px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer;font-size:0.8rem;';
  var sDis  = 'padding:4px 10px;border-radius:4px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:0.8rem;opacity:0.5;pointer-events:none;';
  var sCur  = 'padding:4px 10px;border-radius:4px;border:1px solid #334155;background:#1d4ed8;color:#fff;cursor:pointer;font-size:0.8rem;font-weight:bold;';
  var nav = '<div class="page-nav">';
  nav += '<button style="' + (currentPage <= 1 ? sDis : sBase) + '" onclick="goGroupPage(1)">First</button>';
  nav += '<button style="' + (currentPage <= 1 ? sDis : sBase) + '" onclick="goGroupPage(' + (currentPage - 1) + ')">Prev</button>';
  for (var pg = start; pg <= end; pg++) {
    nav += '<button style="' + (pg === currentPage ? sCur : sBase) + '" onclick="goGroupPage(' + pg + ')">' + pg + '</button>';
  }
  nav += '<button style="' + (currentPage >= totalPages ? sDis : sBase) + '" onclick="goGroupPage(' + (currentPage + 1) + ')">Next</button>';
  nav += '<button style="' + (currentPage >= totalPages ? sDis : sBase) + '" onclick="goGroupPage(' + totalPages + ')">Last</button>';
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
      emptyEl.style.cssText = 'color:#64748b;text-align:center;padding:32px;';
      emptyEl.textContent = 'No groups found.';
      list.appendChild(emptyEl);
      return;
    }
    // Page-size selector — option values/labels are static integers, safe
    var sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    var sizeLabel = document.createElement('label');
    sizeLabel.style.cssText = 'font-size:0.8rem;color:#94a3b8;';
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
    upperNav.innerHTML = buildPageNav(dirGroupPage, totalPages);
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
      tr.setAttribute('onclick', 'loadGroupParticipants(\'' + esc(c.jid) + '\')');
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
      tdJid.style.cssText = 'font-family:monospace;font-size:0.78rem;color:#64748b;';
      tdJid.textContent = c.jid; // textContent safe
      var tdMem = document.createElement('td');
      tdMem.textContent = c.messageCount > 0 ? String(c.messageCount) : '-';
      var tdTime = document.createElement('td');
      tdTime.textContent = relTime(c.lastMessageAt);
      var tdAct = document.createElement('td');
      var expandBtn = document.createElement('button');
      expandBtn.style.cssText = 'background:#1e293b;color:#e2e8f0;border:1px solid #334155;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;';
      expandBtn.textContent = 'Participants';
      expandBtn.setAttribute('onclick', 'event.stopPropagation();loadGroupParticipants(\'' + esc(c.jid) + '\')');
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
    lowerNav.innerHTML = buildPageNav(dirGroupPage, totalPages);
    list.appendChild(lowerNav);
  } catch(err) {
    while (list.firstChild) { list.removeChild(list.firstChild); }
    var errEl = document.createElement('div');
    errEl.style.cssText = 'color:#ef4444;padding:16px;';
    errEl.textContent = 'Error loading groups: ' + (err instanceof Error ? err.message : String(err));
    list.appendChild(errEl);
  }
}

function buildContactCard(c) {
  var name = c.displayName || c.jid;
  var color = avatarColor(c.jid);
  var inits = initials(c.displayName || '', c.jid);
  var dm = c.dmSettings || {mode:'active',mentionOnly:false,customKeywords:'',canInitiate:true};
  var id = 'card-' + c.jid.replace(/[^a-zA-Z0-9]/g, '_');
  var isGroup = c.isGroup;
  var avatarBg = isGroup ? '#1e3a5f' : color;
  var avatarContent = isGroup ? '&#128101;' : esc(inits);
  var borderStyle = c.allowedDm ? 'border-left:3px solid #10b981;' : '';

  var allowBtn = '';
  if (!isGroup) {
    if (c.allowedDm) {
      allowBtn = '<button style="background:#10b981;color:#fff;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.75rem;" onclick="event.stopPropagation();toggleAllowDm(\\'' + esc(c.jid) + '\\',true)">Allowed (DM)</button>';
    } else {
      allowBtn = '<button style="background:#1d4ed8;color:#fff;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.75rem;" onclick="event.stopPropagation();toggleAllowDm(\\'' + esc(c.jid) + '\\',false)">Allow DM</button>';
    }
  }

  var clickAction = isGroup
    ? 'loadGroupParticipants(\\'' + esc(c.jid) + '\\')'
    : 'toggleContactSettings(\\'' + esc(c.jid) + '\\')';

  var panelContent = '';
  if (isGroup) {
    panelContent = '<div class="contact-settings-panel" id="panel-' + id + '">' +
      '<div style="color:#64748b;padding:8px">Click to load participants...</div>' +
    '</div>';
  } else {
    panelContent = '<div class="contact-settings-panel" id="panel-' + id + '">' +
      '<div class="settings-fields">' +
        '<div class="settings-field"><label>Mode <span class="tip" data-tip="Active: bot responds to this contact. Listen Only: messages arrive but bot does not reply.">?</span></label><select id="mode-' + id + '"><option value="active"' + (dm.mode==='active'?' selected':'') + '>Active</option><option value="listen_only"' + (dm.mode==='listen_only'?' selected':'') + '>Listen Only</option></select></div>' +
        '<div class="settings-field"><label><input type="checkbox" id="mo-' + id + '"' + (dm.mentionOnly?' checked':'') + '> Mention Only <span class="tip" data-tip="When checked, bot only responds if it is explicitly @mentioned in the message.">?</span></label></div>' +
        '<div class="settings-field"><label>Custom Keywords <span class="tip" data-tip="Comma-separated regex patterns. Bot responds only if the message matches one. Overrides global keyword filter for this contact.">?</span></label><input type="text" id="kw-' + id + '" value="' + esc(dm.customKeywords) + '" placeholder="keyword1, keyword2"></div>' +
        '<div class="settings-field"><label><input type="checkbox" id="ci-' + id + '"' + (dm.canInitiate?' checked':'') + '> Can Initiate <span class="tip" data-tip="When checked, bot is allowed to send the first message to this contact. Uncheck to prevent unsolicited outbound messages.">?</span></label></div>' +
        '<button class="save-contact-btn" onclick="saveContactSettings(\\'' + esc(c.jid) + '\\', \\'' + id + '\\')">Save</button>' +
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
    cbEl.setAttribute('onclick', 'event.stopPropagation();toggleBulkItem(' + JSON.stringify(c.jid) + ',this)');
    var tempDiv = document.createElement('div');
    tempDiv.appendChild(cbEl);
    bulkCheckbox = tempDiv.innerHTML;
  }

  return '<div class="contact-card" id="' + id + '" style="' + borderStyle + '">' +
    '<div class="contact-header" onclick="' + clickAction + '" style="display:flex;align-items:center;">' +
      bulkCheckbox +
      '<div class="avatar" style="background:' + avatarBg + ';color:#fff">' + avatarContent + '</div>' +
      '<div class="contact-info">' +
        '<div class="contact-name">' + esc(name) + '</div>' +
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
  if (panel) panel.classList.toggle('open');
}
async function saveContactSettings(jid, id) {
  var mode = document.getElementById('mode-' + id)?.value || 'active';
  var mentionOnly = document.getElementById('mo-' + id)?.checked || false;
  var customKeywords = document.getElementById('kw-' + id)?.value || '';
  var canInitiate = document.getElementById('ci-' + id)?.checked ?? true;
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
  panel.innerHTML = '<div style="color:#64748b;padding:8px">Loading participants...</div>';
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
    html += '<span style="font-size:0.85rem;color:#94a3b8;font-weight:600;">' + parts.length + ' participants</span>';
    html += '<button style="background:' + (allowAll ? '#10b981' : '#1d4ed8') + ';color:#fff;border:none;padding:4px 12px;border-radius:5px;cursor:pointer;font-size:0.78rem;margin-left:auto;" onclick="toggleGroupAllowAll(\\'' + esc(groupJid) + '\\',' + (allowAll ? 'true' : 'false') + ')">' + (allowAll ? 'Revoke All' : 'Allow All') + '</button>';
    html += '</div>';
    if (parts.length === 0) {
      html += '<div style="color:#64748b;font-size:0.85rem;">No participants found. Try refreshing from WAHA first.</div>';
    } else {
      parts.forEach(function(p) {
        // DIR-02: For @lid JIDs with no display name, strip domain for a cleaner fallback than the full raw JID
        var pNameFallback = p.participantJid.indexOf('@lid') !== -1 ? p.participantJid.replace(/@.*$/, '') : p.participantJid;
        var pName = p.displayName || pNameFallback;
        var pColor = avatarColor(p.participantJid);
        var pInits = initials(p.displayName || '', p.participantJid);
        // DIR-02: Green if allowed per-group OR globally allowed via config.groupAllowFrom
        var groupAllowed = p.allowInGroup || p.globallyAllowed;
        html += '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #1e293b;">';
        // DIR-04: Checkbox in bulk select mode — use JSON.stringify to safely embed JID in onclick
        if (bulkSelectMode) {
          var pChecked = bulkSelectedJids.has(p.participantJid);
          html += '<input type="checkbox"' + (pChecked ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:#1d4ed8;flex-shrink:0;cursor:pointer;" onclick="event.stopPropagation();toggleBulkItem(' + JSON.stringify(p.participantJid) + ',this)">';
        }
        html += '<div class="avatar" style="width:32px;height:32px;font-size:0.8rem;background:' + pColor + ';color:#fff">' + esc(pInits) + '</div>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="font-size:0.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(pName) + (p.isAdmin ? ' <span style="color:#f59e0b;font-size:0.7rem;">ADMIN</span>' : '') + '</div>';
        html += '<div style="font-size:0.72rem;color:#64748b;font-family:monospace;">' + esc(p.participantJid) + '</div>';
        html += '</div>';
        // DIR-03: Role dropdown — role values are static strings (no user data), safe as HTML template
        var pRole = p.participantRole || 'participant';
        html += '<select style="background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:2px 6px;font-size:0.75rem;" onchange="setParticipantRole(\\'' + esc(groupJid) + '\\',\\'' + esc(p.participantJid) + '\\',this.value)">';
        html += '<option value="bot_admin"' + (pRole === 'bot_admin' ? ' selected' : '') + '>Bot Admin</option>';
        html += '<option value="manager"' + (pRole === 'manager' ? ' selected' : '') + '>Manager</option>';
        html += '<option value="participant"' + (pRole === 'participant' ? ' selected' : '') + '>Participant</option>';
        html += '</select>';
        html += '<button style="background:' + (groupAllowed ? '#10b981' : '#334155') + ';color:#fff;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:0.72rem;" onclick="toggleParticipantAllow(\\'' + esc(groupJid) + '\\',\\'' + esc(p.participantJid) + '\\',\\'allow-group\\',' + (p.allowInGroup ? 'true' : 'false') + ')">' + (groupAllowed ? 'Allowed' : 'Allow') + '</button>';
        html += '<button style="background:' + (p.allowDm ? '#10b981' : '#334155') + ';color:#fff;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:0.72rem;" onclick="toggleParticipantAllow(\\'' + esc(groupJid) + '\\',\\'' + esc(p.participantJid) + '\\',\\'allow-dm\\',' + (p.allowDm ? 'true' : 'false') + ')">' + (p.allowDm ? 'DM OK' : 'Allow DM') + '</button>';
        html += '</div>';
      });
    }
    html += '</div>';
    // ---- Group filter override section ----
    // DO NOT CHANGE — per-group filter override UI allows admin to set custom keyword filter settings per group.
    html += '<div class="group-filter-override" style="margin-top:12px;padding:12px;background:#0f172a;border-radius:8px;border:1px solid #1e293b;">';
    var sfx = esc(groupJid).replace(/[^a-zA-Z0-9]/g,'_');
    html += '<h4 style="margin:0 0 8px;color:#94a3b8;font-size:13px;text-transform:uppercase;">Group Filter Override</h4>';
    html += '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
    html += '<input type="checkbox" id="gfo-enabled-' + sfx + '">';
    html += ' <span>Override global filter</span></label>';
    html += '<div id="gfo-settings-' + sfx + '" style="display:none;margin-left:24px;">';
    html += '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
    html += '<input type="checkbox" id="gfo-filter-enabled-' + sfx + '" checked>';
    html += ' <span>Keyword filter enabled</span></label>';
    // UX-03: Trigger operator select — directly below keyword filter enabled checkbox, above keywords tag input
    html += '<div class="settings-field" style="margin-bottom:8px;"><label style="display:block;margin-bottom:4px;color:#94a3b8;font-size:12px;">Trigger Operator <span class="tip" data-tip="OR: message matches if it contains any keyword. AND: message must contain all keywords.">?</span></label>';
    html += '<select id="gfo-operator-' + sfx + '" style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;border-radius:5px;padding:6px 10px;font-size:0.85rem;width:100%;">';
    html += '<option value="OR">OR &ndash; match any keyword</option>';
    html += '<option value="AND">AND &ndash; match all keywords</option></select></div>';
    // UX-03: Tag input container replaces plain text input for keywords
    html += '<div style="margin-bottom:8px;"><label style="display:block;margin-bottom:4px;color:#94a3b8;font-size:12px;">Keywords (empty = inherit global)</label>';
    html += '<div id="gfo-patterns-cp-' + sfx + '"></div></div>';
    html += '<div><label style="display:block;margin-bottom:4px;color:#94a3b8;font-size:12px;">God Mode Scope</label>';
    html += '<select id="gfo-god-mode-' + sfx + '" style="padding:6px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#e2e8f0;">';
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
  } catch(e) { panel.innerHTML = '<div style="color:#ef4444;padding:8px">' + esc(e.message) + '</div>'; }
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

// DIR-03: Set participant role — calls PUT /api/admin/directory/group/:groupJid/participants/:participantJid/role
async function setParticipantRole(groupJid, participantJid, role) {
  try {
    var r = await fetch('/api/admin/directory/group/' + encodeURIComponent(groupJid) + '/participants/' + encodeURIComponent(participantJid) + '/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: role })
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    if (!d.ok) throw new Error(d.error || 'Participant not found — refresh participants first');
    showToast('Role updated');
  } catch(e) {
    showToast('Failed to update role: ' + e.message, true);
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
    // UX-03: Trigger operator select element
    var elOperator = document.getElementById('gfo-operator-' + sfx);
    if (!elEnabled) return;
    if (ov && ov.enabled) {
      elEnabled.checked = true;
      if (elSettings) elSettings.style.display = '';
      if (elFilterEnabled) elFilterEnabled.checked = ov.filterEnabled !== false;
      // UX-03: Load keywords into tag input instance instead of plain text input
      if (gfoTagInputs[sfx] && ov.mentionPatterns) {
        gfoTagInputs[sfx].setValue(ov.mentionPatterns);
      }
      // UX-03: Load trigger operator
      if (elOperator) elOperator.value = ov.triggerOperator || 'OR';
      if (elGodMode && ov.godModeScope) elGodMode.value = ov.godModeScope;
    } else {
      elEnabled.checked = false;
      if (elSettings) elSettings.style.display = 'none';
    }
    // Wire toggle for settings visibility + save on change
    elEnabled.onchange = function() {
      if (elSettings) elSettings.style.display = elEnabled.checked ? '' : 'none';
      saveGroupFilter(groupJid);
    };
    if (elFilterEnabled) elFilterEnabled.onchange = function() { saveGroupFilter(groupJid); };
    // UX-03: Auto-save when trigger operator changes
    if (elOperator) elOperator.onchange = function() { saveGroupFilter(groupJid); };
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
  // UX-03: Read trigger operator from select element
  var elOperator = document.getElementById('gfo-operator-' + sfx);
  var triggerOperator = elOperator ? elOperator.value : 'OR';
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
      body: JSON.stringify({ enabled: enabled, filterEnabled: filterEnabled, mentionPatterns: mentionPatterns, godModeScope: godModeScope, triggerOperator: triggerOperator }),
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
      const groupFilter = getGroupFilterForAdmin(opts.config, opts.accountId);
      const groupFilterCfg = (account.config.groupFilter ?? {}) as Record<string, unknown>;
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
        const contacts = db.getContacts({ search, limit, offset, type });
        const total = db.getContactCount(search, type);
        const dms = db.getDmCount();
        const groups = db.getGroupCount();
        const newsletters = db.getNewsletterCount();
        // Enrich with allowedDm status from config
        const configAllowFrom: string[] = account.config.allowFrom ?? [];
        // @lid and @s.whatsapp.net entries are now filtered at SQL level in directory.ts
        // to fix pagination offset/count mismatches. DO NOT re-add post-query filtering here.
        const enriched = contacts.map((c) => ({
          ...c,
          allowedDm: configAllowFrom.includes(c.jid),
        }));
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
        const validActions = ["allow-dm", "revoke-dm", "allow-group", "revoke-group", "set-role"];
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

    // POST /api/admin/directory/refresh — bulk import contacts and groups from WAHA
    if (req.url === "/api/admin/directory/refresh" && req.method === "POST") {
      try {
        const db = getDirectoryDb(opts.accountId);
        const rateLimiter = new RateLimiter(3, 200);

        // Fetch bulk data with rate limiting
        const [rawChats, rawContacts, rawGroups, rawLids] = await Promise.all([
          rateLimiter.run(() => getWahaChats({ cfg: opts.config, accountId: opts.accountId }).catch((err: unknown) => { console.warn(`[waha] directory refresh: getWahaChats failed: ${String(err)}`); return []; })),
          rateLimiter.run(() => getWahaContacts({ cfg: opts.config, accountId: opts.accountId }).catch((err: unknown) => { console.warn(`[waha] directory refresh: getWahaContacts failed: ${String(err)}`); return []; })),
          rateLimiter.run(() => getWahaGroups({ cfg: opts.config, accountId: opts.accountId }).catch((err: unknown) => { console.warn(`[waha] directory refresh: getWahaGroups failed: ${String(err)}`); return []; })),
          rateLimiter.run(() => getWahaAllLids({ cfg: opts.config, accountId: opts.accountId }).catch((err: unknown) => { console.warn(`[waha] directory refresh: getWahaAllLids failed: ${String(err)}`); return []; })),
        ]);
        // toArr imported from send.ts — shared utility for normalizing WAHA API dict responses
        const chatsArr = toArr(rawChats);
        const contactsArr = toArr(rawContacts);
        const groupsArr = toArr(rawGroups);
        const lidsArr = toArr(rawLids);

        // Build LID -> @c.us mapping from the WAHA LID API and contacts API
        const lidToCus = new Map<string, string>();
        for (const entry of lidsArr) {
          const rec = entry as Record<string, unknown>;
          const lid = String(rec.lid ?? rec.id ?? "");
          const phone = String(rec.phone ?? rec.contactId ?? "");
          if (lid && lid.endsWith("@lid") && phone) {
            const cusJid = phone.includes("@") ? phone : `${phone}@c.us`;
            lidToCus.set(lid, cusJid);
          }
        }
        // Also build from contacts API (contacts may have linkedDevices or server-reported LIDs)
        for (const c of contactsArr) {
          const rec = c as Record<string, unknown>;
          const jid = String(rec.id ?? "");
          if (!jid || !jid.endsWith("@c.us")) continue;
          const lid = (rec.lid as string) || (rec.linkedDeviceId as string) || undefined;
          if (lid && lid.endsWith("@lid")) {
            lidToCus.set(lid, jid);
          }
        }

        // Build contact map from chats (primary source -- always works on NOWEB)
        const contactMap = new Map<string, { jid: string; name?: string; isGroup: boolean }>();
        for (const c of chatsArr) {
          const rec = c as Record<string, unknown>;
          const jid = String(rec.id ?? "");
          if (!jid) continue;
          const isGroup = jid.endsWith("@g.us");
          const name = (rec.name as string) || undefined;
          contactMap.set(jid, { jid, name, isGroup });
        }

        // Merge contacts API results (prefer contact name over chat name)
        for (const c of contactsArr) {
          const rec = c as Record<string, unknown>;
          const jid = String(rec.id ?? "");
          if (!jid) continue;
          const name = (rec.name as string) || (rec.pushName as string) || undefined;
          const existing = contactMap.get(jid);
          if (existing) {
            if (name) existing.name = name;
          } else {
            contactMap.set(jid, { jid, name, isGroup: jid.endsWith("@g.us") });
          }
        }

        // Add groups from groups API (use subject for name)
        for (const g of groupsArr) {
          const rec = g as Record<string, unknown>;
          const jid = String(rec.id ?? "");
          if (!jid) continue;
          const name = (rec.subject as string) || (rec.name as string) || undefined;
          const existing = contactMap.get(jid);
          if (existing) {
            if (name) existing.name = name;
            existing.isGroup = true;
          } else {
            contactMap.set(jid, { jid, name, isGroup: true });
          }
        }

        // Normalize @s.whatsapp.net → @c.us (same person, different format)
        for (const [jid, entry] of contactMap) {
          if (!jid.endsWith("@s.whatsapp.net")) continue;
          const cusJid = jid.replace("@s.whatsapp.net", "@c.us");
          const cusEntry = contactMap.get(cusJid);
          if (cusEntry) {
            if (!cusEntry.name && entry.name) cusEntry.name = entry.name;
          } else {
            contactMap.set(cusJid, { jid: cusJid, name: entry.name, isGroup: entry.isGroup });
          }
          contactMap.delete(jid);
        }

        // Merge @lid entries into their @c.us counterparts using the LID map
        for (const [jid, entry] of contactMap) {
          if (!jid.endsWith("@lid")) continue;
          const cusJid = lidToCus.get(jid);
          if (cusJid) {
            const cusEntry = contactMap.get(cusJid);
            if (cusEntry) {
              if (!cusEntry.name && entry.name) cusEntry.name = entry.name;
            } else {
              contactMap.set(cusJid, { jid: cusJid, name: entry.name, isGroup: false });
            }
          }
          contactMap.delete(jid);
        }

        // Filter out any remaining @lid and @s.whatsapp.net entries
        const filteredEntries = [...contactMap.values()].filter((e) => !e.jid.endsWith("@lid") && !e.jid.endsWith("@s.whatsapp.net"));
        const mappedContacts = filteredEntries.filter((e) => !e.isGroup);
        const mappedGroups = filteredEntries.filter((e) => e.isGroup);
        const imported = db.bulkUpsertContacts(filteredEntries);

        // Merge existing @lid and @s.whatsapp.net DB entries into their @c.us counterparts.
        // getContacts() filters these out at SQL level (AP-02 fix), so we use getOrphanedLidEntries()
        // to explicitly fetch only the ghost JID entries that need merging.
        // DO NOT CHANGE — getContacts() never returns @lid/@s.whatsapp.net entries so the old
        // db.getContacts({ limit: 10000 }) call was dead code.
        let lidsMerged = 0;
        try {
          const orphanedEntries = db.getOrphanedLidEntries();
          for (const c of orphanedEntries) {
            if (c.jid.endsWith("@lid")) {
              const cusJid = lidToCus.get(c.jid);
              if (cusJid) {
                db.mergeContacts(c.jid, cusJid);
                lidsMerged++;
              }
            } else if (c.jid.endsWith("@s.whatsapp.net")) {
              const cusJid = c.jid.replace("@s.whatsapp.net", "@c.us");
              db.mergeContacts(c.jid, cusJid);
              lidsMerged++;
            }
          }
        } catch (mergeErr) {
          console.warn(`[waha] LID merge partially failed: ${String(mergeErr)}`);
        }

        // Participants are loaded lazily when user clicks a group (not during bulk refresh)

        // Second pass: resolve names for contacts/newsletters that still have no display_name
        let namesResolved = 0;
        try {
          // Resolve nameless contacts via WAHA contacts API
          const allContacts = db.getContacts({ limit: 5000, type: "contact" });
          const namelessContacts = allContacts.filter((c) => !c.displayName && !c.jid.endsWith("@lid"));
          const BATCH_SIZE = 5;
          for (let i = 0; i < namelessContacts.length; i += BATCH_SIZE) {
            const batch = namelessContacts.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
              batch.map((c) =>
                rateLimiter.run(() =>
                  getWahaContact({ cfg: opts.config, contactId: c.jid, accountId: opts.accountId })
                    .then((result) => ({ jid: c.jid, result: result as Record<string, unknown> }))
                )
              ),
            );
            for (const r of results) {
              if (r.status !== "fulfilled") continue;
              const { jid, result } = r.value;
              const resolvedName =
                (result.name as string) || (result.pushName as string) || (result.pushname as string) || undefined;
              if (resolvedName) {
                db.upsertContact(jid, resolvedName, false);
                namesResolved++;
              }
            }
            // Delay between batches for proper rate limiting
            if (i + BATCH_SIZE < namelessContacts.length) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }

          // Resolve nameless newsletters via WAHA channels API
          const allNewsletters = db.getContacts({ limit: 5000, type: "newsletter" });
          const namelessNewsletters = allNewsletters.filter((c) => !c.displayName);
          for (let i = 0; i < namelessNewsletters.length; i += BATCH_SIZE) {
            const batch = namelessNewsletters.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
              batch.map((c) =>
                rateLimiter.run(() =>
                  getWahaNewsletter({ cfg: opts.config, newsletterId: c.jid, accountId: opts.accountId })
                    .then((result) => ({ jid: c.jid, result }))
                )
              ),
            );
            for (const r of results) {
              if (r.status !== "fulfilled") continue;
              const { jid, result } = r.value;
              if (!result) continue;
              const resolvedName =
                (result.name as string) || (result.subject as string) || (result.title as string) || undefined;
              if (resolvedName) {
                db.upsertContact(jid, resolvedName, false);
                namesResolved++;
              }
            }
            if (i + BATCH_SIZE < namelessNewsletters.length) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }
        } catch (err) {
          console.warn(`[waha] per-contact name resolution partially failed: ${String(err)}`);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ imported, contacts: mappedContacts.length, groups: mappedGroups.length, participants: 0, namesResolved, lidsMerged }));
      } catch (err) {
        console.error(`[waha] directory refresh failed: ${String(err)}`);
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
                // DIR-02: Name resolution pass — for @lid JIDs with no display name, attempt
                // to find the matching @c.us contact in the directory (NOWEB sends @lid JIDs).
                const noName = participants.filter((p) => !p.displayName);
                for (const p of noName) {
                  const altJid = p.participantJid.replace("@lid", "@c.us");
                  const contact = db.getContact(altJid);
                  if (contact?.displayName) {
                    db.updateParticipantDisplayName(groupJid, p.participantJid, contact.displayName);
                  }
                }
                // Re-read after name resolution so enriched names are returned in response
                participants = db.getGroupParticipants(groupJid);
              }
            } catch (fetchErr) {
              console.warn(`[waha] Failed to lazy-fetch participants for ${groupJid}: ${String(fetchErr)}`);
            }
          }

          // DIR-02: Enrich participants with global allowlist state from config.groupAllowFrom
          // This shows green buttons for participants already in the global allowlist (not just per-group DB)
          const groupAllowFrom: string[] = account.config.groupAllowFrom ?? [];
          const enrichedParticipants = participants.map((p) => ({
            ...p,
            globallyAllowed: groupAllowFrom.includes(p.participantJid),
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
  if (env && account.accountId === "default") {
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
