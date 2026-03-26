// Phase 53 (INFRA-01): MimicryGate core module -- time gate, hourly cap, config resolution.
// DO NOT REMOVE -- all send-time enforcement (Plan 02+) builds on this foundation.

// NOTE FOR PHASE 54: When wiring gate into send.ts, add bypassPolicy param to
// sendWahaImage, sendWahaVideo, sendWahaFile (currently only sendWahaText has it).
// /shutup, /join, /leave use these functions and must bypass the gate.

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger({ component: "mimicry-gate" });
const require = createRequire(import.meta.url);

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
  private db: any;
  private _walTimer: ReturnType<typeof setTimeout> | null = null;
  private _stmtCountRecentSends: any;
  private _stmtRecordSend: any;
  private _stmtEnsureFirstSendAt: any;
  private _stmtGetFirstSendAt: any;
  private _stmtPruneOldWindows: any;

  constructor(dbPath: string) {
    mkdirSync(join(dbPath, ".."), { recursive: true });
    const Database = require("better-sqlite3") as any;
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
    const INTERVAL_MS = 30 * 60 * 1000;
    const tick = () => {
      try { this.db.pragma("wal_checkpoint(PASSIVE)"); } catch (err) { log.warn("WAL checkpoint failed", { error: String(err) }); }
      this._walTimer = setTimeout(tick, INTERVAL_MS);
      this._walTimer.unref();
    };
    this._walTimer = setTimeout(tick, INTERVAL_MS);
    this._walTimer.unref();
  }

  countRecentSends(session: string, now: number = Date.now()): number {
    const windowStart = now - 3_600_000;
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
    const cutoff = now - 7_200_000;
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
    _mimicryDb = new MimicryDb(join(homedir(), ".openclaw", "data", "mimicry.db"));
  }
  return _mimicryDb;
}

export function getMaturityPhase(firstSendAt: number | null, now: number = Date.now()): MaturityPhase {
  if (firstSendAt === null) return "new";
  const ageDays = (now - firstSendAt) / 86_400_000;
  if (ageDays < 7) return "new";
  if (ageDays < 30) return "warming";
  return "stable";
}

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

// Gate enforcement functions are in Plan 02 of this phase.
