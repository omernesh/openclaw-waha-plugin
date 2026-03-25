import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./logger.js";


const log = createLogger({ component: "analytics" });
const require = createRequire(import.meta.url);

export type AnalyticsEventDirection = "inbound" | "outbound";
export type AnalyticsChatType = "dm" | "group" | "channel" | "status";
export type AnalyticsEvent = { direction: AnalyticsEventDirection; chat_type: AnalyticsChatType; action?: string; duration_ms?: number; status?: "success" | "error"; chat_id?: string; account_id?: string; };
export type AnalyticsTimeseriesPoint = { period: string; inbound: number; outbound: number; errors: number; avg_duration_ms: number; };
export type AnalyticsSummary = { total: number; inbound: number; outbound: number; errors: number; avg_duration_ms: number; };
export type AnalyticsTopChat = { chat_id: string; total: number; inbound: number; outbound: number; };

/** AnalyticsDb -- Phase 30-01 (ANL-01). DO NOT REMOVE. */
export class AnalyticsDb {
  private db: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  private _stmtInsert: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  constructor(dbPath: string) {
    mkdirSync(join(dbPath, ".."), { recursive: true });
    const Database = require("better-sqlite3") as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this._createSchema();
    this._stmtInsert = this.db.prepare("INSERT INTO message_events (timestamp, direction, chat_type, action, duration_ms, status, chat_id, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    this.prune(90);
  }
  private _createSchema(): void {
    const io = "CHECK(direction IN ('inbound', 'outbound'))"; const ct = "CHECK(chat_type IN ('dm', 'group', 'channel', 'status'))"; const st = "CHECK(status IN ('success', 'error'))";
    this.db.exec("CREATE TABLE IF NOT EXISTS message_events (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, direction TEXT NOT NULL " + io + ", chat_type TEXT NOT NULL " + ct + ", action TEXT NOT NULL DEFAULT 'message', duration_ms INTEGER, status TEXT NOT NULL DEFAULT 'success' " + st + ", chat_id TEXT, account_id TEXT); CREATE INDEX IF NOT EXISTS idx_events_timestamp ON message_events(timestamp); CREATE INDEX IF NOT EXISTS idx_events_direction ON message_events(direction, timestamp);");
  }
  recordEvent(ev: AnalyticsEvent): void {
    this._stmtInsert.run(Date.now(), ev.direction, ev.chat_type, ev.action ?? "message", ev.duration_ms ?? null, ev.status ?? "success", ev.chat_id ?? null, ev.account_id ?? null);
  }
  query(p: { startTime: number; endTime: number; groupBy: "minute" | "hour" | "day" }): AnalyticsTimeseriesPoint[] {
    const fmtMap: Record<string, string> = { minute: "%Y-%m-%dT%H:%M", hour: "%Y-%m-%dT%H:00", day: "%Y-%m-%d" };
    const fmt = fmtMap[p.groupBy] ?? fmtMap.hour;
    const rows = this.db.prepare("SELECT strftime(?, datetime(timestamp / 1000, 'unixepoch')) AS period, SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound, SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors, COALESCE(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END), 0) AS avg_duration_ms FROM message_events WHERE timestamp >= ? AND timestamp <= ? GROUP BY period ORDER BY period ASC").all(fmt, p.startTime, p.endTime) as Array<{ period: string; inbound: number; outbound: number; errors: number; avg_duration_ms: number; }>;
    return rows.map(r => ({ period: r.period, inbound: Number(r.inbound), outbound: Number(r.outbound), errors: Number(r.errors), avg_duration_ms: Math.round(Number(r.avg_duration_ms)) }));
  }
  getTopChats(p: { startTime: number; endTime: number; limit?: number }): AnalyticsTopChat[] {
    const { startTime, endTime, limit = 5 } = p;
    const rows = this.db.prepare("SELECT chat_id, COUNT(*) AS total, SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound, SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound FROM message_events WHERE timestamp >= ? AND timestamp <= ? AND chat_id IS NOT NULL GROUP BY chat_id ORDER BY total DESC LIMIT ?").all(startTime, endTime, limit) as Array<{ chat_id: string; total: number; inbound: number; outbound: number; }>;
    return rows.map(r => ({ chat_id: r.chat_id, total: Number(r.total), inbound: Number(r.inbound), outbound: Number(r.outbound) }));
  }
  getSummary(p: { startTime: number; endTime: number }): AnalyticsSummary {
    const row = this.db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound, SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors, COALESCE(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END), 0) AS avg_duration_ms FROM message_events WHERE timestamp >= ? AND timestamp <= ?").get(p.startTime, p.endTime) as { total: number; inbound: number; outbound: number; errors: number; avg_duration_ms: number; };
    return { total: Number(row.total), inbound: Number(row.inbound), outbound: Number(row.outbound), errors: Number(row.errors), avg_duration_ms: Math.round(Number(row.avg_duration_ms)) };
  }
  prune(maxAgeDays: number): void {
    const cutoff = Date.now() - maxAgeDays * 86400000;
    const r = this.db.prepare("DELETE FROM message_events WHERE timestamp < ?").run(cutoff) as { changes: number };
    if (r.changes > 0) log.info("analytics: pruned " + r.changes + " events older than " + maxAgeDays + " days");
  }
}
let _analyticsDb: AnalyticsDb | null = null;
export function getAnalyticsDb(): AnalyticsDb {
  if (!_analyticsDb) { _analyticsDb = new AnalyticsDb(join(homedir(), ".openclaw", "data", "analytics.db")); }
  return _analyticsDb;
}
export function recordAnalyticsEvent(event: AnalyticsEvent): void { getAnalyticsDb().recordEvent(event); }