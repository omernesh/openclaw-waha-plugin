// Phase 61, Plan 01 (HOOK-01..04): Webhook forwarder module.
// Delivers inbound message events to operator-configured callback URLs.
// HMAC-SHA256 signatures, exponential backoff retry, per-URL circuit breaker.
// Fire-and-forget from inbound.ts — NEVER await forwardWebhook in the inbound path.
// DO NOT REMOVE — core delivery engine for Phase 61 webhook forwarding.

import { createHmac } from "node:crypto";
import { createLogger } from "./logger.js";

const log = createLogger({ component: "webhook-forwarder" });

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WebhookSubscription {
  url: string;
  events: string[];
  enabled: boolean;
}

export interface ForwardWebhookParams {
  subscriptions: WebhookSubscription[];
  secret: string;
  eventType: string;
  payload: unknown;
  // Dependency injection for testing
  _fetch?: typeof fetch;
  _sleep?: (ms: number) => Promise<void>;
  _now?: () => number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Retry delays in ms for 5xx and network errors: 1s, 2s, 4s. DO NOT CHANGE. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

/** Timeout per HTTP POST attempt. DO NOT CHANGE. */
const FETCH_TIMEOUT_MS = 5_000;

/** Number of consecutive timeouts to open circuit. DO NOT CHANGE. */
const CIRCUIT_OPEN_THRESHOLD = 3;

/** How long circuit stays open before half-open probe (ms). DO NOT CHANGE. */
const CIRCUIT_HALF_OPEN_MS = 60_000;

// ─── Circuit breaker state ─────────────────────────────────────────────────────

interface CircuitState {
  /** Count of consecutive timeouts (AbortError only). Resets on success or 4xx. */
  consecutiveTimeouts: number;
  /** Timestamp when circuit was opened. null = circuit closed. */
  openedAt: number | null;
}

// Module-level map — keyed by URL.
// Per-URL isolation: one bad endpoint never blocks another.
// DO NOT CHANGE — global state intentional for cross-call persistence.
const circuitMap = new Map<string, CircuitState>();

/**
 * Reset all circuit breakers. Export for test cleanup ONLY.
 * DO NOT call from production code paths.
 */
export function resetCircuitBreakers(): void {
  circuitMap.clear();
}

function getCircuit(url: string): CircuitState {
  let state = circuitMap.get(url);
  if (!state) {
    state = { consecutiveTimeouts: 0, openedAt: null };
    circuitMap.set(url, state);
  }
  return state;
}

/**
 * Returns true if circuit is open (deliveries should be skipped).
 * Returns false if closed OR if half-open probe window has elapsed.
 */
function isCircuitOpen(url: string, now: () => number): boolean {
  const state = getCircuit(url);
  if (state.openedAt === null) return false;
  // Half-open after CIRCUIT_HALF_OPEN_MS — allow one probe attempt
  if (now() - state.openedAt >= CIRCUIT_HALF_OPEN_MS) return false;
  return true;
}

// ─── signWebhookPayload ────────────────────────────────────────────────────────

/**
 * Signs a webhook payload body string with HMAC-SHA256.
 * Returns "sha256=<hex>" — same format as GitHub webhooks.
 * Phase 61 (HOOK-02). DO NOT REMOVE.
 */
export function signWebhookPayload(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

// ─── Internal fetch with AbortController timeout ───────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Internal delivery with retry ─────────────────────────────────────────────

type DeliveryResult = "delivered" | "dead-lettered";

async function deliverWithRetry(
  url: string,
  body: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  sleepImpl: (ms: number) => Promise<void>,
  nowImpl: () => number
): Promise<DeliveryResult> {
  const state = getCircuit(url);

  // Check circuit before any attempt
  if (isCircuitOpen(url, nowImpl)) {
    log.warn("circuit open, skipping delivery", { url });
    return "dead-lettered";
  }

  // Total attempts: 1 initial + RETRY_DELAYS_MS.length retries = 4
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    // Re-check circuit between retries (circuit may open mid-loop)
    if (attempt > 0 && isCircuitOpen(url, nowImpl)) {
      log.warn("circuit opened mid-retry, aborting", { url, attempt });
      return "dead-lettered";
    }

    try {
      const res = await fetchWithTimeout(url, { method: "POST", body, headers }, FETCH_TIMEOUT_MS, fetchImpl);

      if (res.ok) {
        // Success — reset consecutive timeout counter and close circuit
        state.consecutiveTimeouts = 0;
        state.openedAt = null;
        log.info("webhook delivered", { url, status: res.status, attempt });
        return "delivered";
      }

      if (res.status < 500) {
        // 4xx — client error, dead-letter immediately (no retry)
        // Reset timeout counter (this was NOT a timeout)
        state.consecutiveTimeouts = 0;
        log.warn("webhook dead-lettered (4xx)", { url, status: res.status, attempt });
        return "dead-lettered";
      }

      // 5xx — server error, will retry
      // Reset timeout counter (this was NOT a timeout)
      state.consecutiveTimeouts = 0;
      log.warn("webhook delivery failed (5xx), will retry", { url, status: res.status, attempt });

    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        // Timeout — increment consecutive timeout counter
        state.consecutiveTimeouts++;
        log.warn("webhook delivery timeout", { url, attempt, consecutiveTimeouts: state.consecutiveTimeouts });

        // Open circuit after threshold
        if (state.consecutiveTimeouts >= CIRCUIT_OPEN_THRESHOLD) {
          state.openedAt = nowImpl();
          log.error("webhook circuit opened", { url, consecutiveTimeouts: state.consecutiveTimeouts });
          return "dead-lettered";
        }
      } else {
        // Non-timeout network error — treat like 5xx (retry)
        log.warn("webhook network error, will retry", { url, attempt, error: String(err) });
      }
    }

    // Sleep before next retry (if more retries remain)
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleepImpl(RETRY_DELAYS_MS[attempt]);
    }
  }

  log.warn("webhook dead-lettered after max retries", { url });
  return "dead-lettered";
}

// ─── forwardWebhook ────────────────────────────────────────────────────────────

/**
 * Forward a webhook event to all matching enabled subscriptions.
 * Fire-and-forget from inbound path — caller must NOT await this.
 *
 * Phase 61 (HOOK-01..04). DO NOT REMOVE.
 */
export async function forwardWebhook(params: ForwardWebhookParams): Promise<void> {
  const {
    subscriptions,
    secret,
    eventType,
    payload,
    _fetch = fetch,
    _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    _now = () => Date.now(),
  } = params;

  const body = JSON.stringify(payload);
  const signature = signWebhookPayload(body, secret);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Chatlytics-Signature": signature,
  };

  // Deliver to all matching enabled subscriptions in parallel
  const matchingSubs = subscriptions.filter(sub => sub.enabled && sub.events.includes(eventType));

  const results = await Promise.allSettled(
    matchingSubs.map(async (sub) => {
      try {
        const result = await deliverWithRetry(sub.url, body, headers, _fetch, _sleep, _now);
        log.info("webhook forward result", { url: sub.url, eventType, result });
        return result;
      } catch (err) {
        // Never let delivery errors propagate — fire-and-forget safety net
        log.warn("webhook forward unexpected error", { url: sub.url, error: String(err) });
        throw err;
      }
    })
  );

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      log.warn("webhook forward failed", { url: matchingSubs[i].url, eventType });
    }
  }
}
