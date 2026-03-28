// Phase 53 (INFRA-01): MimicryGate core module -- time gate, hourly cap, config resolution.
// DO NOT REMOVE -- all send-time enforcement (Plan 02+) builds on this foundation.

// NOTE FOR PHASE 54: When wiring gate into send.ts, add bypassPolicy param to
// sendWahaImage, sendWahaVideo, sendWahaFile (currently only sendWahaText has it).
// /shutup, /join, /leave use these functions and must bypass the gate.

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "./logger.js";
import { getDataDir } from "./data-dir.js";

const log = createLogger({ component: "mimicry-gate" });
const require = createRequire(import.meta.url);

// ── Named constants (no magic numbers) ──────────────────────────────────────
const ONE_HOUR_MS = 3_600_000;
const PRUNE_WINDOW_MS = 7_200_000;  // 2x counting window
const ONE_DAY_MS = 86_400_000;
const WAL_CHECKPOINT_INTERVAL_MS = 30 * 60 * 1000;
const NEW_PHASE_DAYS = 7;
const WARMING_PHASE_DAYS = 30;

export type MaturityPhase = "new" | "warming" | "stable";

export interface TargetGateOverride {
  enabled?: boolean;
  timezone?: string;
  startHour?: number;
  endHour?: number;
  onBlock?: "reject" | "queue";
}

export interface TargetCapOverride {
  enabled?: boolean;
  limits?: { new?: number; warming?: number; stable?: number };
}

export interface ResolvedGateConfig {
  enabled: boolean;
  timezone: string;
  startHour: number;
  endHour: number;
  onBlock: "reject" | "queue";
}

export interface ResolvedCapConfig {
  enabled: boolean;
  limits: { new: number; warming: number; stable: number };
}

export interface GateResult {
  allowed: boolean;
  reason?: string;
}

export interface CapResult {
  allowed: boolean;
  count: number;
  limit: number;
  reason?: string;
}

export interface CapStatus {
  count: number;
  limit: number;
  remaining: number;
  maturity: MaturityPhase;
  windowStartMs: number;
}

export class MimicryDb {
  private db: import('better-sqlite3').Database;
  private _walTimer: ReturnType<typeof setTimeout> | null = null;
  private _stmtCountRecentSends: import('better-sqlite3').Statement;
  private _stmtRecordSend: import('better-sqlite3').Statement;
  private _stmtEnsureFirstSendAt: import('better-sqlite3').Statement;
  private _stmtGetFirstSendAt: import('better-sqlite3').Statement;
  private _stmtPruneOldWindows: import('better-sqlite3').Statement;

  constructor(dbPath: string) {
    mkdirSync(join(dbPath, ".."), { recursive: true });
    const Database = require("better-sqlite3") as new (path: string) => import('better-sqlite3').Database;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this._createSchema();
    this._prepareStatements();
    this._stmtPruneOldWindows.run(Date.now());
    this._startWalCheckpoint();
  }

  private _createSchema(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS send_window_events (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  session TEXT NOT NULL," +
      "  sent_at INTEGER NOT NULL" +
      ");" +
      "CREATE INDEX IF NOT EXISTS idx_swe_session_time ON send_window_events (session, sent_at);" +
      "CREATE TABLE IF NOT EXISTS account_metadata (" +
      "  session TEXT PRIMARY KEY," +
      "  first_send_at INTEGER NOT NULL," +
      "  updated_at INTEGER NOT NULL" +
      ");"
    );
  }

  private _prepareStatements(): void {
    this._stmtCountRecentSends = this.db.prepare(
      "SELECT COUNT(*) AS cnt FROM send_window_events WHERE session = ? AND sent_at >= ?"
    );
    this._stmtRecordSend = this.db.prepare(
      "INSERT INTO send_window_events (session, sent_at) VALUES (?, ?)"
    );
    this._stmtEnsureFirstSendAt = this.db.prepare(
      "INSERT INTO account_metadata (session, first_send_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(session) DO NOTHING"
    );
    this._stmtGetFirstSendAt = this.db.prepare(
      "SELECT first_send_at FROM account_metadata WHERE session = ?"
    );
    this._stmtPruneOldWindows = this.db.prepare(
      "DELETE FROM send_window_events WHERE sent_at < ?"
    );
  }

  private _startWalCheckpoint(): void {
    const tick = () => {
      try { this.db.pragma("wal_checkpoint(PASSIVE)"); } catch (err) { log.warn("WAL checkpoint failed", { error: String(err) }); }
      // Prune old send_window_events every 30 min to prevent unbounded growth. DO NOT REMOVE.
      try { this.pruneOldWindows(); } catch (err) { log.warn("pruneOldWindows failed", { error: String(err) }); }
      this._walTimer = setTimeout(tick, WAL_CHECKPOINT_INTERVAL_MS);
      this._walTimer.unref();
    };
    this._walTimer = setTimeout(tick, WAL_CHECKPOINT_INTERVAL_MS);
    this._walTimer.unref();
  }

  countRecentSends(session: string, now: number = Date.now()): number {
    const windowStart = now - ONE_HOUR_MS;
    const row = this._stmtCountRecentSends.get(session, windowStart) as { cnt: number };
    return Number(row.cnt);
  }

  recordSend(session: string, now: number = Date.now()): void {
    this._stmtRecordSend.run(session, now);
    this._stmtEnsureFirstSendAt.run(session, now, now);
  }

  ensureFirstSendAt(session: string, now: number = Date.now()): void {
    this._stmtEnsureFirstSendAt.run(session, now, now);
  }

  getFirstSendAt(session: string): number | null {
    const row = this._stmtGetFirstSendAt.get(session) as { first_send_at: number } | undefined;
    return row ? row.first_send_at : null;
  }

  pruneOldWindows(now: number = Date.now()): void {
    const cutoff = now - PRUNE_WINDOW_MS;
    const r = this._stmtPruneOldWindows.run(cutoff) as { changes: number };
    if (r.changes > 0) { log.info("mimicry-gate: pruned " + r.changes + " old send window events"); }
  }

  close(): void {
    if (this._walTimer) { clearTimeout(this._walTimer); this._walTimer = null; }
    this.db.close();
  }
}

let _mimicryDb: MimicryDb | null = null;

export function getMimicryDb(): MimicryDb {
  if (!_mimicryDb) {
    // Phase 59 (CORE-06): getDataDir() respects CHATLYTICS_DATA_DIR for Docker volume persistence.
    _mimicryDb = new MimicryDb(join(getDataDir(), "mimicry.db"));
  }
  return _mimicryDb;
}

export function getMaturityPhase(firstSendAt: number | null, now: number = Date.now()): MaturityPhase {
  if (firstSendAt === null) return "new";
  const ageDays = (now - firstSendAt) / ONE_DAY_MS;
  if (ageDays < NEW_PHASE_DAYS) return "new";
  if (ageDays < WARMING_PHASE_DAYS) return "warming";
  return "stable";
}

// sendGate and hourlyCap fields are intentionally NOT in the Zod config schema
// (config-schema.ts) to avoid OpenClaw gateway AJV validation errors. These functions
// read them from the raw config object with ?? fallback defaults. DO NOT add these
// fields back to WahaAccountSchemaBase.

export function resolveGateConfig(
  session: string | undefined,
  cfg: { sendGate?: Partial<ResolvedGateConfig>; accounts?: Record<string, { sendGate?: Partial<ResolvedGateConfig> }> },
  targetOverride?: TargetGateOverride | null
): ResolvedGateConfig {
  const defaults: ResolvedGateConfig = { enabled: false, timezone: "UTC", startHour: 7, endHour: 1, onBlock: "reject" };
  const global = cfg.sendGate ?? {};
  const perSession = session ? (cfg.accounts?.[session]?.sendGate ?? {}) : {};
  const perTarget = targetOverride ?? {};
  return { ...defaults, ...global, ...perSession, ...perTarget };
}

export function resolveCapLimit(
  session: string | undefined,
  maturity: MaturityPhase,
  cfg: { hourlyCap?: Partial<ResolvedCapConfig>; accounts?: Record<string, { hourlyCap?: Partial<ResolvedCapConfig> }> },
  targetOverride?: TargetCapOverride | null
): number {
  const defaultLimits = { new: 15, warming: 30, stable: 50 };
  const global = cfg.hourlyCap?.limits ?? {};
  const perSession = session ? (cfg.accounts?.[session]?.hourlyCap?.limits ?? {}) : {};
  const perTarget = targetOverride?.limits ?? {};
  const merged = { ...defaultLimits, ...global, ...perSession, ...perTarget };
  return merged[maturity];
}

// ─── Plan 02: Gate enforcement functions ──────────────────────────────────────
// DO NOT REMOVE -- these are the core enforcement primitives wired by Phase 54.

/**
 * Private helper: extract the local hour (0-23) for a given UTC timestamp
 * using the specified IANA timezone. Uses Intl.DateTimeFormat.formatToParts
 * for correctness across all timezones including DST transitions.
 * DO NOT CHANGE -- getHours() returns UTC, not local time.
 */
function extractHour(nowMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const hourPart = parts.find((p) => p.type === "hour");
  if (!hourPart) {
    log.warn("extractHour: could not parse hour from Intl.DateTimeFormat", { timezone });
    return new Date(nowMs).getUTCHours();
  }
  const h = parseInt(hourPart.value, 10);
  // Intl may return 24 for midnight in some locales — normalize to 0.
  return h === 24 ? 0 : h;
}

/**
 * checkTimeOfDay — enforces time-of-day send gate.
 *
 * Returns {allowed: true} if gate is disabled or current hour is inside window.
 * Returns {allowed: false, reason} if outside window.
 *
 * Cross-midnight window (endHour <= startHour): hour >= startHour OR hour < endHour.
 * Same-day window (endHour > startHour): hour >= startHour AND hour < endHour.
 * endHour is exclusive.
 *
 * DO NOT CHANGE -- cross-midnight logic was carefully verified with tests.
 */
export function checkTimeOfDay(config: ResolvedGateConfig, now: number = Date.now()): GateResult {
  if (!config.enabled) return { allowed: true };

  const hour = extractHour(now, config.timezone);
  const { startHour, endHour } = config;
  const crossMidnight = endHour <= startHour;
  const inWindow = crossMidnight
    ? (hour >= startHour || hour < endHour)
    : (hour >= startHour && hour < endHour);

  if (!inWindow) {
    return {
      allowed: false,
      reason: `Outside send window (${startHour}:00-${endHour}:00 ${config.timezone})`,
    };
  }
  return { allowed: true };
}

/**
 * checkAndConsumeCap — checks hourly cap and records a send atomically.
 *
 * WARNING: This is a combined check-and-record. Only call when send is definitely happening.
 * If allowed, records the send AND sets first_send_at for maturity tracking.
 * If blocked, returns {allowed: false} without recording anything.
 *
 * INFRA-04: bypassPolicy callers must skip this function entirely. Phase 54 wires this.
 *
 * DO NOT CHANGE -- blocked sends must not call recordSend or ensureFirstSendAt.
 */
export function checkAndConsumeCap(
  session: string,
  limit: number,
  db: MimicryDb,
  now: number = Date.now()
): CapResult {
  const count = db.countRecentSends(session, now);

  if (count >= limit) {
    return { allowed: false, count, limit, reason: `Hourly cap reached (${count}/${limit})` };
  }

  db.recordSend(session, now);
  db.ensureFirstSendAt(session, now);
  return { allowed: true, count: count + 1, limit };
}

/**
 * getCapStatus — read-only snapshot of current cap state.
 *
 * Returns {count, limit, remaining, maturity, windowStartMs} without recording a send.
 * Use this for UI display and pre-flight checks that must not affect cap counts.
 *
 * DO NOT CHANGE -- this must remain read-only (no recordSend calls).
 */
export function getCapStatus(
  session: string,
  limit: number,
  db: MimicryDb,
  now: number = Date.now()
): CapStatus {
  const count = db.countRecentSends(session, now);
  const firstSendAt = db.getFirstSendAt(session);
  const maturity = getMaturityPhase(firstSendAt, now);
  return {
    count,
    limit,
    remaining: Math.max(0, limit - count),
    maturity,
    windowStartMs: now - ONE_HOUR_MS,
  };
}
