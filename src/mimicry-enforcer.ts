// Phase 54-01 (BEH-01, BEH-02, BEH-03): Send pipeline enforcement chokepoint.
// DO NOT REMOVE — all outbound send functions call this before firing WAHA API.
// Wired into send.ts by Plan 02. This separate file avoids circular imports.
//
// Flow: bypassPolicy? → early return. time gate → throw. cap pre-check → throw.
//       jitter delay → typing simulation → return (caller fires send).
// After WAHA API success, caller calls recordMimicrySuccess() to consume cap quota.

import type { CoreConfig } from "./types.js";
import {
  getMimicryDb,
  getMaturityPhase,
  resolveGateConfig,
  resolveCapLimit,
  checkTimeOfDay,
  type MimicryDb,
} from "./mimicry-gate.js";
import { sendWahaPresence } from "./send.js";
import { getDirectoryDb } from "./directory.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnforceMimicryParams {
  /** WAHA session name (e.g. "3cf11776_logan") */
  session: string;
  /** Recipient chat JID */
  chatId: string;
  /** OpenClaw account ID for DirectoryDb per-target override lookup */
  accountId: string;
  /** Plugin config (CoreConfig) */
  cfg: CoreConfig;
  /** If true, skip all mimicry enforcement (used by /shutup, /join, /leave) */
  bypassPolicy?: boolean;
  /** Character count of outbound message — drives typing indicator duration */
  messageLength?: number;
  /**
   * Batch pre-check count. When >1, pre-checks count + current usage ≤ limit
   * to reject entire batch if it would exceed the hourly cap.
   */
  count?: number;
  /** Status/story sends skip cap check but still honour time gate */
  isStatusSend?: boolean;

  // ── Dependency injection (tests only) ───────────────────────────────────────
  /** Override MimicryDb instance (avoids real SQLite in tests) */
  _db?: MimicryDb;
  /** Override current timestamp in ms (pins time for deterministic tests) */
  _now?: number;
  /** Override sleep function (avoids real delays in tests) */
  _sleep?: (ms: number) => Promise<void>;
}

// ─── Default sleep ─────────────────────────────────────────────────────────────

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── enforceMimicry ───────────────────────────────────────────────────────────

/**
 * Single enforcement chokepoint for all outbound sends.
 *
 * Call BEFORE firing the WAHA API send. Throws on gate/cap violations.
 * On success, applies jitter delay and typing simulation (side effects).
 * After successful WAHA send, call recordMimicrySuccess() to record cap usage.
 *
 * DO NOT CHANGE the error prefix format — callers match on "[mimicry] Send blocked:".
 */
export async function enforceMimicry(params: EnforceMimicryParams): Promise<void> {
  const {
    session,
    chatId,
    accountId,
    cfg,
    bypassPolicy = false,
    messageLength,
    count = 1,
    isStatusSend = false,
    _db,
    _now = Date.now(),
    _sleep = defaultSleep,
  } = params;

  // Step 1: bypass — skip everything
  if (bypassPolicy) return;

  // Step 2: resolve per-target overrides from DirectoryDb (best-effort, ignore errors)
  let targetGateOverride = null;
  let targetCapOverride = null;
  try {
    const dirDb = getDirectoryDb(accountId);
    const dmSettings = dirDb.getDmSettings(chatId);
    if (dmSettings) {
      targetGateOverride = dmSettings.sendGateOverride ?? null;
      targetCapOverride = dmSettings.hourlyCapOverride ?? null;
    }
  } catch {
    // Non-fatal: directory may not be initialized yet on first boot
  }

  // Step 3: time gate check — throw on blocked
  const wahaConfig = (cfg as any)?.channels?.waha ?? cfg;
  const gateConfig = resolveGateConfig(session, wahaConfig, targetGateOverride);
  const gateResult = checkTimeOfDay(gateConfig, _now);
  if (!gateResult.allowed) {
    throw new Error(`[mimicry] Send blocked: ${gateResult.reason ?? "outside send window"}`);
  }

  // Step 4: cap pre-check (skip for status/story sends)
  if (!isStatusSend) {
    const db = _db ?? getMimicryDb();
    const firstSendAt = db.getFirstSendAt(session);
    const maturity = getMaturityPhase(firstSendAt, _now);
    const limit = resolveCapLimit(session, maturity, wahaConfig, targetCapOverride);
    const currentCount = db.countRecentSends(session, _now);

    if (currentCount + count > limit) {
      throw new Error(
        `[mimicry] Send blocked: Hourly cap reached (${currentCount}/${limit} sent, batch=${count})`
      );
    }
  }

  // Step 5: jitter delay — base 5000ms ±40% → effective range 3000-7000ms
  const BASE_DELAY_MS = 5000;
  const JITTER_FACTOR = 0.4;
  const jitter = BASE_DELAY_MS * JITTER_FACTOR;
  const delayMs = BASE_DELAY_MS + (Math.random() * 2 - 1) * jitter;
  await _sleep(Math.round(delayMs));

  // Step 6: typing simulation — only when messageLength > 0
  if (messageLength && messageLength > 0) {
    const typingDurationMs = Math.min((messageLength / 4) * 1000, 8000);
    await sendWahaPresence({ cfg, chatId, typing: true });
    await _sleep(typingDurationMs);
    await sendWahaPresence({ cfg, chatId, typing: false });
  }
}

// ─── recordMimicrySuccess ─────────────────────────────────────────────────────

/**
 * Record a successful outbound send in the hourly cap window.
 * Call AFTER the WAHA API send succeeds — failed sends do not consume quota.
 *
 * DO NOT CALL on bypassed sends or failed API calls.
 */
export function recordMimicrySuccess(session: string, _db?: MimicryDb): void {
  const db = _db ?? getMimicryDb();
  db.recordSend(session);
}
