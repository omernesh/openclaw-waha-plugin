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

import { callWahaApi } from "./http-client.js";

// ── Named constants (no magic numbers) ──────────────────────────────
/** Timeout for the health check fetch call. */
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** Default initial delay before first health ping. */
const DEFAULT_INITIAL_DELAY_MS = 5_000;

/** Health state for a WAHA session. */
export interface HealthState {
  status: "healthy" | "degraded" | "unhealthy";
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastCheckAt: number | null;
}

/** Module-level health state per session key. */
const sessionHealthStates = new Map<string, HealthState>();

/** Threshold for unhealthy status. */
const UNHEALTHY_THRESHOLD = 3;

export interface HealthCheckOptions {
  baseUrl: string;
  apiKey: string;
  session: string;
  intervalMs: number;
  abortSignal: AbortSignal;
  /** Override initial delay (default 5000ms, shorter for tests). */
  initialDelayMs?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Call .unref() on a timer so it doesn't keep the process alive. */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as NodeJS.Timeout).unref();
  }
}

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

  // Clean up the Map entry when the session is aborted to prevent memory leaks
  opts.abortSignal.addEventListener("abort", () => {
    sessionHealthStates.delete(opts.session);
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

/**
 * Get the current health state for a session.
 * Returns undefined if no health check has been started for that session.
 */
export function getHealthState(session: string): HealthState | undefined {
  return sessionHealthStates.get(session);
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
  } catch (err) {
    // Failure: increment and evaluate
    state.consecutiveFailures += 1;
    const msg = err instanceof Error ? err.message : String(err);

    if (state.consecutiveFailures >= UNHEALTHY_THRESHOLD) {
      state.status = "unhealthy";
      console.warn(
        `[WAHA] Health check UNHEALTHY for session ${opts.session} ` +
        `(${state.consecutiveFailures} consecutive failures): ${msg}`
      );
    } else {
      state.status = "degraded";
      console.warn(
        `[WAHA] Health check DEGRADED for session ${opts.session} ` +
        `(${state.consecutiveFailures} consecutive failure(s)): ${msg}`
      );
    }
  }

  state.lastCheckAt = Date.now();

  // Schedule next tick (setTimeout chain, NOT setInterval)
  if (!opts.abortSignal.aborted) {
    const nextTimer = setTimeout(() => {
      tick(opts, state);
    }, opts.intervalMs);

    // Unref so timer doesn't keep process alive
    unrefTimer(nextTimer);
  }
}
