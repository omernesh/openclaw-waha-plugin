// ╔══════════════════════════════════════════════════════════════════════╗
// ║  HEALTH MONITOR — DO NOT CHANGE                                     ║
// ║                                                                     ║
// ║  Session health monitor. Pings WAHA /api/sessions/{session} at a     ║
// ║  configurable interval to detect silent disconnects before they     ║
// ║  cause message delivery failures.                                   ║
// ║                                                                     ║
// ║  Uses setTimeout chain (NOT setInterval) — schedules next ping      ║
// ║  only after current completes, preventing pile-up on slow pings.   ║
// ║                                                                     ║
// ║  Added in Phase 2, Plan 01 (2026-03-11).                           ║
// ║  DO NOT remove health pinging — silent disconnects are the #1      ║
// ║  cause of missed messages.                                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  AUTO-RECOVERY — DO NOT CHANGE (Phase 25, Plan 01)                 ║
// ║                                                                     ║
// ║  After AUTO_RECOVERY_THRESHOLD (5) consecutive failures, the       ║
// ║  session is automatically restarted via POST /api/sessions/restart. ║
// ║                                                                     ║
// ║  Cooldown: RECOVERY_COOLDOWN_MS (5 min) between attempts —         ║
// ║  prevents restart storms when WAHA is in a bad state.              ║
// ║                                                                     ║
// ║  Alerting: god mode users are notified via WhatsApp using a        ║
// ║  healthy session (bypassPolicy: true for system alerts).           ║
// ║                                                                     ║
// ║  History: last 50 recovery events stored in recoveryHistory ring   ║
// ║  buffer, accessible via getRecoveryHistory() for admin API.        ║
// ║                                                                     ║
// ║  enableRecovery: false by default — opt in per startHealthCheck    ║
// ║  call to preserve backward compatibility.                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { callWahaApi } from "./http-client.js";
import type { CoreConfig } from "./types.js";
import { createLogger } from "./logger.js";


const log = createLogger({ component: "health" });
// ── Named constants (no magic numbers) ──────────────────────────────
/** Timeout for the health check fetch call. */
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** Default initial delay before first health ping. */
const DEFAULT_INITIAL_DELAY_MS = 5_000;

/** Threshold for unhealthy status (also auto-recovery trigger). */
const UNHEALTHY_THRESHOLD = 5;

// ── Auto-recovery constants ──────────────────────────────────────────
/** Number of consecutive failures before auto-recovery is attempted. */
const AUTO_RECOVERY_THRESHOLD = 5;

/** Minimum time between recovery attempts (5 minutes). */
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

/** Maximum number of recovery events stored in history ring buffer. */
const RECOVERY_HISTORY_MAX = 50;

// ── Types ────────────────────────────────────────────────────────────

/** Health state for a WAHA session. */
export interface HealthState {
  status: "healthy" | "degraded" | "unhealthy";
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastCheckAt: number | null;
}

/**
 * Per-session recovery tracking state.
 * Phase 25, Plan 01 — DO NOT REMOVE.
 */
export interface RecoveryState {
  attemptCount: number;
  lastAttemptAt: number | null;
  lastOutcome: "success" | "failed" | null;
  lastError: string | null;
  cooldownUntil: number | null;
}

/**
 * Single auto-recovery event stored in history ring buffer.
 * Phase 25, Plan 01 — DO NOT REMOVE.
 */
export interface RecoveryEvent {
  timestamp: number;
  session: string;
  outcome: "success" | "failed";
  error: string | null;
  consecutiveFailuresAtTrigger: number;
}

export interface HealthCheckOptions {
  baseUrl: string;
  apiKey: string;
  session: string;
  intervalMs: number;
  abortSignal: AbortSignal;
  /** Override initial delay (default 5000ms, shorter for tests). */
  initialDelayMs?: number;
  /** CoreConfig — required for alerting god mode users. Phase 25, Plan 01. */
  cfg?: CoreConfig;
  /** Account ID — used to identify the account for alerting. Phase 25, Plan 01. */
  accountId?: string;
  /**
   * Enable auto-recovery on 5 consecutive failures.
   * Default false for backward compatibility — must be explicitly set to true.
   * Phase 25, Plan 01. DO NOT REMOVE.
   */
  enableRecovery?: boolean;
}

// ── Module-level state ───────────────────────────────────────────────

/** Module-level health state per session key. */
const sessionHealthStates = new Map<string, HealthState>();

// ── SSE callback — Phase 29, Plan 01. DO NOT REMOVE.
// Allows monitor.ts to broadcast health state changes over SSE.
let onHealthStateChange: ((session: string, state: HealthState) => void) | null = null;

/**
 * Register a callback to be called whenever session health state changes.
 * Called by monitor.ts to wire SSE broadcast. Phase 29, Plan 01. DO NOT REMOVE.
 */
export function setHealthStateChangeCallback(cb: (session: string, state: HealthState) => void): void {
  onHealthStateChange = cb;
}

/** Per-session recovery tracking state. Phase 25, Plan 01. DO NOT REMOVE. */
const sessionRecoveryStates = new Map<string, RecoveryState>();

/** Recovery event history ring buffer (max RECOVERY_HISTORY_MAX entries). Phase 25, Plan 01. DO NOT REMOVE. */
const recoveryHistory: RecoveryEvent[] = [];

// ── Helpers ─────────────────────────────────────────────────────────

/** Call .unref() on a timer so it doesn't keep the process alive. */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as NodeJS.Timeout).unref();
  }
}

// ── Exported state accessors ─────────────────────────────────────────

/**
 * Get the current health state for a session.
 * Returns undefined if no health check has been started for that session.
 */
export function getHealthState(session: string): HealthState | undefined {
  return sessionHealthStates.get(session);
}

/**
 * Get the current recovery state for a session.
 * Returns undefined if no recovery has ever been attempted for that session.
 * Phase 25, Plan 01 — DO NOT REMOVE.
 */
export function getRecoveryState(session: string): RecoveryState | undefined {
  return sessionRecoveryStates.get(session);
}

/**
 * Get the full recovery event history (up to RECOVERY_HISTORY_MAX=50 events).
 * Phase 25, Plan 01 — DO NOT REMOVE.
 */
export function getRecoveryHistory(): RecoveryEvent[] {
  return recoveryHistory;
}

// ── Auto-recovery internals ──────────────────────────────────────────

/**
 * Send WhatsApp alerts to god mode users about a recovery event.
 * Uses a healthy session as the sender — bypassPolicy: true for system alerts.
 * Phase 25, Plan 01 — DO NOT REMOVE.
 */
async function alertGodModeUsers(
  opts: HealthCheckOptions,
  healthState: HealthState,
  recoveryState: RecoveryState,
): Promise<void> {
  if (!opts.cfg) return; // no config = can't alert

  // Dynamic imports to avoid circular dependency issues
  const { listEnabledWahaAccounts } = await import("./accounts.js");
  const { sendWahaText } = await import("./send.js");

  // Find a healthy session to send the alert from (not the failed session)
  const accounts = listEnabledWahaAccounts(opts.cfg);
  const healthySender = accounts.find(
    (acc) =>
      acc.session !== opts.session &&
      sessionHealthStates.get(acc.session)?.status === "healthy",
  );

  if (!healthySender) {
    log.warn("Cannot alert god mode users — no healthy session available");
    return;
  }

  // Extract god mode users from BOTH dmFilter and groupFilter
  const wahaCfg = opts.cfg.channels?.waha;
  const godUsers = [
    ...(wahaCfg?.dmFilter?.godModeSuperUsers ?? []),
    ...(wahaCfg?.groupFilter?.godModeSuperUsers ?? []),
  ];

  // Deduplicate by identifier
  const uniqueJids = [
    ...new Set(
      godUsers.map((u) =>
        typeof u === "string" ? u : (u as { identifier: string }).identifier,
      ),
    ),
  ];

  if (uniqueJids.length === 0) return; // no god mode users to alert

  const alertMessage =
    `[WAHA Alert] Session ${opts.session} is unhealthy (${healthState.consecutiveFailures} failures). ` +
    `Auto-recovery attempt #${recoveryState.attemptCount}: ${recoveryState.lastOutcome?.toUpperCase() ?? "UNKNOWN"}` +
    `${recoveryState.lastError ? " — " + recoveryState.lastError : ""}`;

  for (const jid of uniqueJids) {
    try {
      await sendWahaText({
        cfg: opts.cfg,
        to: jid,
        text: alertMessage,
        accountId: healthySender.accountId,
        bypassPolicy: true, // system alert — must bypass policy filters
      });
    } catch (err) {
      log.warn("Failed to send recovery alert", { jid, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/**
 * Attempt to auto-recover a WAHA session via POST /api/sessions/{session}/restart.
 * Enforces RECOVERY_COOLDOWN_MS between attempts.
 * Phase 25, Plan 01 — DO NOT REMOVE.
 */
async function attemptRecovery(
  opts: HealthCheckOptions,
  state: HealthState,
): Promise<void> {
  // Get or create recovery state for this session
  let recoveryState = sessionRecoveryStates.get(opts.session);
  if (!recoveryState) {
    recoveryState = {
      attemptCount: 0,
      lastAttemptAt: null,
      lastOutcome: null,
      lastError: null,
      cooldownUntil: null,
    };
    sessionRecoveryStates.set(opts.session, recoveryState);
  }

  // Check cooldown — prevent restart storms
  const now = Date.now();
  if (recoveryState.cooldownUntil !== null && now < recoveryState.cooldownUntil) {
    log.warn("Recovery skipped — cooldown active", { session: opts.session, cooldownUntil: new Date(recoveryState.cooldownUntil).toISOString() });
    return;
  }

  // Set cooldown immediately to prevent concurrent attempts
  recoveryState.cooldownUntil = now + RECOVERY_COOLDOWN_MS;
  recoveryState.attemptCount += 1;
  recoveryState.lastAttemptAt = now;

  const attemptCount = recoveryState.attemptCount;
  log.warn("Attempting auto-recovery", { session: opts.session, attempt: attemptCount, consecutiveFailures: state.consecutiveFailures });

  let outcome: "success" | "failed";
  let errMsg: string | null = null;

  try {
    await callWahaApi({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      path: `/api/sessions/${opts.session}/restart`,
      method: "POST",
      timeoutMs: 30_000,
      context: { action: "session-recovery" },
    });
    outcome = "success";
    recoveryState.lastOutcome = "success";
    recoveryState.lastError = null;
    log.warn("Auto-recovery SUCCESS", { session: opts.session });
  } catch (err) {
    errMsg = err instanceof Error ? err.message : String(err);
    outcome = "failed";
    recoveryState.lastOutcome = "failed";
    recoveryState.lastError = errMsg;
    log.warn("Auto-recovery FAILED", { session: opts.session, error: errMsg });
  }

  // Push to history ring buffer (cap at RECOVERY_HISTORY_MAX)
  const event: RecoveryEvent = {
    timestamp: now,
    session: opts.session,
    outcome,
    error: errMsg,
    consecutiveFailuresAtTrigger: state.consecutiveFailures,
  };
  recoveryHistory.push(event);
  if (recoveryHistory.length > RECOVERY_HISTORY_MAX) {
    recoveryHistory.shift();
  }

  // Alert god mode users — fire and forget
  alertGodModeUsers(opts, state, recoveryState).catch((err) => {
    log.warn("alertGodModeUsers error", { session: opts.session, error: err instanceof Error ? err.message : String(err) });
  });
}

// ── Health check loop ────────────────────────────────────────────────

/**
 * Start a health check loop for a WAHA session.
 *
 * Returns a mutable HealthState reference that is updated in-place
 * on each ping result. The caller can read state.status at any time.
 *
 * The loop uses setTimeout chain: schedule next ping only after current
 * completes. All timers are .unref()'d so they don't block shutdown.
 *
 * @param opts - Health check configuration
 * @returns Mutable HealthState reference
 */
export function startHealthCheck(opts: HealthCheckOptions): HealthState {
  const state: HealthState = {
    status: "healthy",
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastCheckAt: null,
  };

  // Store in module-level map for getHealthState()
  sessionHealthStates.set(opts.session, state);

  // Clean up Map entries when the session is aborted to prevent memory leaks
  opts.abortSignal.addEventListener("abort", () => {
    sessionHealthStates.delete(opts.session);
    sessionRecoveryStates.delete(opts.session); // Phase 25: also clean up recovery state
  }, { once: true });

  const initialDelay = opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;

  // Schedule first tick after initial delay (don't block startup)
  const timer = setTimeout(() => {
    tick(opts, state);
  }, initialDelay);

  // Unref so timer doesn't keep process alive
  unrefTimer(timer);

  return state;
}

/** Single health ping + schedule next tick. */
async function tick(opts: HealthCheckOptions, state: HealthState): Promise<void> {
  // Check abort before pinging
  if (opts.abortSignal.aborted) return;

  try {
    await callWahaApi({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      path: `/api/sessions/${opts.session}`,
      method: "GET",
      skipRateLimit: true,
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      context: { action: "health-check" },
    });

    // Success: reset state
    state.consecutiveFailures = 0;
    state.status = "healthy";
    state.lastSuccessAt = Date.now();
    // Clear stale recovery state when session is back to healthy.
    // Without this, Dashboard shows "failed" recovery badge on healthy sessions. DO NOT REMOVE.
    sessionRecoveryStates.delete(opts.session);
  } catch (err) {
    // Failure: increment and evaluate
    state.consecutiveFailures += 1;
    const msg = err instanceof Error ? err.message : String(err);

    if (state.consecutiveFailures >= UNHEALTHY_THRESHOLD) {
      state.status = "unhealthy";
      log.warn("Health check UNHEALTHY", { session: opts.session, consecutiveFailures: state.consecutiveFailures, error: msg });

      // Phase 25, Plan 01: Auto-recovery on 5+ consecutive failures.
      // Fire-and-forget — recovery runs async, doesn't block next health tick.
      // DO NOT REMOVE — this is the core recovery trigger.
      if (opts.enableRecovery && state.consecutiveFailures >= AUTO_RECOVERY_THRESHOLD) {
        attemptRecovery(opts, state).catch((err) => {
          log.warn("Recovery attempt error", { session: opts.session, error: err instanceof Error ? err.message : String(err) });
        });
      }
    } else {
      state.status = "degraded";
      log.warn("Health check DEGRADED", { session: opts.session, consecutiveFailures: state.consecutiveFailures, error: msg });
    }
  }

  state.lastCheckAt = Date.now();
  // Phase 29: Emit SSE health event after every tick (including failures). DO NOT REMOVE.
  onHealthStateChange?.(opts.session, { ...state });

  // Schedule next tick (setTimeout chain, NOT setInterval)
  if (!opts.abortSignal.aborted) {
    const nextTimer = setTimeout(() => {
      tick(opts, state);
    }, opts.intervalMs);

    // Unref so timer doesn't keep process alive
    unrefTimer(nextTimer);
  }
}
