// ACTIVITY SCANNER -- DO NOT REMOVE
//
// Phase 56 (ADAPT-01, ADAPT-02, ADAPT-03): Background scanner that learns per-chat active
// hours from message history and stores derived peak windows in SQLite for use by the mimicry gate.
//
// Pattern: setTimeout chain (NOT setInterval) -- copied from sync.ts to prevent pile-up.
// All timers are .unref()'d so they don't block process shutdown.
//
// Key behaviors:
// - Runs ONLY during off-peak hours (ADAPT-03) -- scanner skips when gate is open
// - Paginates getWahaChatMessages in batches of 100, stops at 500 or 7-day cutoff (ADAPT-01)
// - Stores derived peak_start_hour/peak_end_hour in chat_activity_profiles table (ADAPT-02)
// - Weekly full rescan (7-day cycle). Batch cursor continues across ticks for partial scans.
// - Exported computePeakWindow uses top-60% hour histogram via Intl.DateTimeFormat

import { getDirectoryDb } from "./directory.js";
import { resolveGateConfig, checkTimeOfDay } from "./mimicry-gate.js";
import { getWahaChatMessages } from "./send.js";
import { createLogger } from "./logger.js";
import type { ActivityProfile, DirectoryDb } from "./directory.js";
import type { CoreConfig } from "./types.js";

const log = createLogger({ component: "activity-scanner" });

// ── Constants ──────────────────────────────────────────────────────────────────

const BATCH_SIZE = 10;           // chats per tick
const MAX_MESSAGES = 500;        // pagination ceiling per chat
const PAGE_SIZE = 100;           // messages per WAHA fetch
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const BETWEEN_CHATS_MS = 500;    // sleep between individual chat scans
const FIRST_TICK_DELAY_MS = 30_000;   // 30s startup delay
const ON_PEAK_RETRY_MS = 30 * 60_000; // 30 min retry when on-peak
const BATCH_CONTINUE_MS = 5 * 60_000; // 5 min between partial batches
const FULL_PASS_DELAY_MS = 7 * 24 * 60 * 60_000; // 7-day rescan interval
const MIN_TIMESTAMPS = 20;       // sparse guard for computePeakWindow
const TOP_PERCENT = 0.6;         // top-60% of hours by volume = peak window

// ── Public Types ──────────────────────────────────────────────────────────────

export interface ScannerOptions {
  accountId: string;
  config: CoreConfig;
  session: string;
  abortSignal: AbortSignal;
  // DI for testing -- inject to avoid real WAHA/SQLite
  _dirDb?: DirectoryDb;
  _fetchMessages?: typeof getWahaChatMessages;
  _now?: () => number;
  _sleep?: (ms: number) => Promise<void>;
  /** Override first tick delay (ms). Default: 30000. For testing, pass 0 or a small value. */
  _firstTickDelayMs?: number;
}

export interface ScannerState {
  status: "idle" | "running" | "error";
  lastScanAt: number | null;
  lastError: string | null;
  chatsScanned: number;
}

// ── Module-level state ────────────────────────────────────────────────────────

/** Per-account scanner state. Keyed by accountId. */
const scannerStates = new Map<string, ScannerState>();

/** Per-account batch cursor -- offset into the chats-needing-rescan list. */
const scanCursors = new Map<string, number>();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Call .unref() on a timer so it doesn't keep the process alive. */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as NodeJS.Timeout).unref();
  }
}

/**
 * Determine whether the scanner should run right now.
 *
 * The scanner runs during OFF-peak hours to avoid interfering with send traffic.
 * "Off-peak" = the send gate would currently BLOCK sends (i.e., outside the send window).
 * If sendGate is disabled, always returns true (scan freely).
 *
 * ADAPT-03: Scanner skips when system is on-peak.
 * DO NOT CHANGE -- this is what prevents the scanner from running during human activity hours.
 */
function isOffPeak(cfg: CoreConfig, session: string, now: number): boolean {
  const wahaConfig = (cfg as any)?.channels?.waha ?? cfg;
  if (!wahaConfig?.sendGate?.enabled) return true;
  const gateConfig = resolveGateConfig(session, wahaConfig, null);
  if (!gateConfig.enabled) return true;
  const result = checkTimeOfDay(gateConfig, now);
  return !result.allowed; // off-peak = gate would block sends
}

/**
 * Paginate getWahaChatMessages and collect message timestamps (in ms).
 *
 * Stop conditions:
 * - Empty response (no more messages)
 * - Oldest message in batch is older than 7 days
 * - Total fetched >= 500 (MAX_MESSAGES)
 *
 * WAHA returns timestamps in Unix seconds -- multiply by 1000 to get ms.
 * DO NOT CHANGE the *1000 conversion -- WAHA sends seconds, not ms.
 */
async function fetchRecentTimestamps(
  opts: ScannerOptions,
  chatId: string
): Promise<number[]> {
  const fetchFn = opts._fetchMessages ?? getWahaChatMessages;
  const now = opts._now ? opts._now() : Date.now();
  const cutoff = now - SEVEN_DAYS_MS;
  const allTimestamps: number[] = [];
  let offset = 0;

  while (offset < MAX_MESSAGES) {
    const messages = await fetchFn({
      cfg: opts.config,
      chatId,
      limit: PAGE_SIZE,
      offset,
      downloadMedia: false,
      accountId: opts.accountId,
    });

    if (!messages || messages.length === 0) break;

    let hitCutoff = false;
    for (const msg of messages) {
      const rec = msg as Record<string, unknown>;
      const rawTs = rec.timestamp as number | undefined;
      if (rawTs === undefined) continue;
      // WAHA returns Unix seconds -- convert to ms (DO NOT CHANGE)
      const tsMs = rawTs * 1000;
      if (tsMs < cutoff) {
        hitCutoff = true;
        break;
      }
      allTimestamps.push(tsMs);
    }

    if (hitCutoff) break;
    offset += messages.length;
  }

  return allTimestamps;
}

/**
 * computePeakWindow -- exported for testing.
 *
 * Builds an hour histogram (0-23) from message timestamps, then selects the
 * top-60% of hours by volume as the peak window. Returns a contiguous
 * [startHour, endHour) window spanning those hours.
 *
 * Returns null if fewer than 20 timestamps provided (sparse guard -- don't
 * derive patterns from too few data points).
 *
 * Note: bimodal activity (e.g., morning + evening) intentionally produces a wide
 * window spanning the gap -- this is permissive by design.
 *
 * Uses Intl.DateTimeFormat.formatToParts for timezone-aware hour extraction.
 * Handles midnight normalization: Intl may return "24" for midnight -- normalize to 0.
 */
export function computePeakWindow(
  timestamps: number[],
  timezone: string
): { startHour: number; endHour: number } | null {
  if (timestamps.length < MIN_TIMESTAMPS) return null;

  // Build hour histogram
  const histogram = new Array<number>(24).fill(0);
  for (const ts of timestamps) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(ts));
    const hourPart = parts.find((p) => p.type === "hour");
    if (!hourPart) continue;
    let h = parseInt(hourPart.value, 10);
    if (h === 24) h = 0; // Intl midnight normalization
    histogram[h]++;
  }

  // Sort hours by count descending, take top 60%
  const hoursWithCount = histogram
    .map((count, h) => ({ h, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);

  if (hoursWithCount.length === 0) return null;

  const topN = Math.max(1, Math.ceil(hoursWithCount.length * TOP_PERCENT));
  const peakHours = new Set(hoursWithCount.slice(0, topN).map((x) => x.h));

  // Find the contiguous span of peak hours (min..max+1)
  const sortedPeakHours = Array.from(peakHours).sort((a, b) => a - b);
  const startHour = sortedPeakHours[0]!;
  const endHour = sortedPeakHours[sortedPeakHours.length - 1]! + 1;

  return { startHour, endHour };
}

// ── Scan batch ────────────────────────────────────────────────────────────────

/**
 * Process one batch of BATCH_SIZE chats starting at the current cursor.
 * Returns true if the batch was the last batch (cursor reset), false if more remain.
 */
async function runScanBatch(opts: ScannerOptions, state: ScannerState): Promise<boolean> {
  const dirDb = opts._dirDb ?? getDirectoryDb(opts.accountId);
  const sleepFn = opts._sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts._now ? opts._now() : Date.now();

  const allChats = dirDb.getChatsNeedingRescan(opts.accountId, SEVEN_DAYS_MS, SEVEN_DAYS_MS);
  const cursor = scanCursors.get(opts.accountId) ?? 0;
  const batch = allChats.slice(cursor, cursor + BATCH_SIZE);

  if (batch.length === 0) {
    // Full pass complete -- reset cursor
    scanCursors.set(opts.accountId, 0);
    return true;
  }

  for (const jid of batch) {
    if (opts.abortSignal.aborted) break;

    try {
      const timestamps = await fetchRecentTimestamps(opts, jid);
      const timezone = (opts.config as any)?.channels?.waha?.sendGate?.timezone ?? "UTC";
      const result = computePeakWindow(timestamps, timezone);

      if (result) {
        const profile: ActivityProfile = {
          jid,
          accountId: opts.accountId,
          peakStartHour: result.startHour,
          peakEndHour: result.endHour,
          messageCount: timestamps.length,
          scannedAt: now,
        };
        dirDb.upsertActivityProfile(profile);
        state.chatsScanned++;
      }
    } catch (err: unknown) {
      log.warn("activity-scanner: failed to scan chat", {
        accountId: opts.accountId,
        jid,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Sleep between chats to avoid hammering WAHA
    if (!opts.abortSignal.aborted) {
      await sleepFn(BETWEEN_CHATS_MS);
    }
  }

  // Advance cursor
  const nextCursor = cursor + batch.length;
  if (nextCursor >= allChats.length) {
    scanCursors.set(opts.accountId, 0);
    return true; // pass complete
  }
  scanCursors.set(opts.accountId, nextCursor);
  return false; // more batches remain
}

// ── Tick ──────────────────────────────────────────────────────────────────────

async function tick(opts: ScannerOptions, state: ScannerState): Promise<void> {
  if (opts.abortSignal.aborted) return;

  const now = opts._now ? opts._now() : Date.now();

  // ADAPT-03: Skip if we are currently on-peak (inside the send window).
  // The scanner only runs during off-peak hours to stay below the radar.
  if (!isOffPeak(opts.config, opts.session, now)) {
    log.debug("activity-scanner: on-peak, skipping tick", { accountId: opts.accountId });
    scheduleNext(opts, state, ON_PEAK_RETRY_MS);
    return;
  }

  state.status = "running";

  let passComplete = false;
  try {
    passComplete = await runScanBatch(opts, state);
    state.lastScanAt = opts._now ? opts._now() : Date.now();
    state.lastError = null;
    state.status = "idle";
  } catch (err: unknown) {
    state.status = "error";
    state.lastError = err instanceof Error ? err.message : String(err);
    log.warn("activity-scanner: tick failed", {
      accountId: opts.accountId,
      error: state.lastError,
    });
  }

  if (opts.abortSignal.aborted) return;

  // ADAPT-02: After a full pass, wait 7 days before next rescan.
  // Otherwise continue the batch in 5 minutes.
  const nextDelay = passComplete ? FULL_PASS_DELAY_MS : BATCH_CONTINUE_MS;
  scheduleNext(opts, state, nextDelay);
}

function scheduleNext(opts: ScannerOptions, state: ScannerState, delayMs: number): void {
  if (opts.abortSignal.aborted) return;
  const timer = setTimeout(() => {
    tick(opts, state);
  }, delayMs);
  unrefTimer(timer);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the background activity scanner for one account.
 *
 * Returns a mutable ScannerState reference updated in-place by each scan tick.
 * Uses setTimeout chain (NOT setInterval) -- schedules next tick only after
 * current batch completes, preventing pile-up on slow WAHA.
 *
 * First tick delayed 30s to not block startup.
 * Timers are .unref()'d so they don't block process shutdown.
 *
 * DO NOT REMOVE -- Phase 56 activity scanner entry point. Called from monitor.ts
 * alongside startDirectorySync(). Feeds chat_activity_profiles to resolveGateConfig().
 */
export function startActivityScanner(opts: ScannerOptions): ScannerState {
  const state: ScannerState = {
    status: "idle",
    lastScanAt: null,
    lastError: null,
    chatsScanned: 0,
  };

  scannerStates.set(opts.accountId, state);

  // Clean up on abort (prevent memory leaks in long-running processes)
  opts.abortSignal.addEventListener("abort", () => {
    scannerStates.delete(opts.accountId);
    scanCursors.delete(opts.accountId);
  }, { once: true });

  // Schedule first tick after startup delay (use _firstTickDelayMs for DI in tests)
  const firstDelay = opts._firstTickDelayMs !== undefined ? opts._firstTickDelayMs : FIRST_TICK_DELAY_MS;
  const timer = setTimeout(() => {
    tick(opts, state);
  }, firstDelay);
  unrefTimer(timer);

  return state;
}

/**
 * Get the current scanner state for an account.
 * Returns undefined if no scanner has been started for that account.
 */
export function getScannerState(accountId: string): ScannerState | undefined {
  return scannerStates.get(accountId);
}
