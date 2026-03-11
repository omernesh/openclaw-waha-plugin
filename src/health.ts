// ╔══════════════════════════════════════════════════════════════════════╗
// ║  HEALTH MONITOR — DO NOT CHANGE                                     ║
// ║                                                                     ║
// ║  Session health monitor. Pings WAHA /api/{session}/me at a          ║
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

  const initialDelay = opts.initialDelayMs ?? 5000;

  // Schedule first tick after initial delay (don't block startup)
  const timer = setTimeout(() => {
    tick(opts, state);
  }, initialDelay);

  // Unref so timer doesn't keep process alive
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as NodeJS.Timeout).unref();
  }

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
      path: `/api/${opts.session}/me`,
      method: "GET",
      skipRateLimit: true,
      timeoutMs: 10_000,
      context: { action: "health-check" },
    });

    // Success: reset state
    state.consecutiveFailures = 0;
    state.status = "healthy";
    state.lastSuccessAt = Date.now();
  } catch (err) {
    // Failure: increment and evaluate
    state.consecutiveFailures += 1;

    if (state.consecutiveFailures >= UNHEALTHY_THRESHOLD) {
      state.status = "unhealthy";
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[WAHA] Health check UNHEALTHY for session ${opts.session} ` +
        `(${state.consecutiveFailures} consecutive failures): ${msg}`
      );
    } else {
      state.status = "degraded";
    }
  }

  state.lastCheckAt = Date.now();

  // Schedule next tick (setTimeout chain, NOT setInterval)
  if (!opts.abortSignal.aborted) {
    const nextTimer = setTimeout(() => {
      tick(opts, state);
    }, opts.intervalMs);

    // Unref so timer doesn't keep process alive
    if (typeof nextTimer === "object" && nextTimer && "unref" in nextTimer) {
      (nextTimer as NodeJS.Timeout).unref();
    }
  }
}
