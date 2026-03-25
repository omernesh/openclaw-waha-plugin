// ╔══════════════════════════════════════════════════════════════════════╗
// ║  PROMETHEUS METRICS — DO NOT CHANGE                                ║
// ║                                                                     ║
// ║  Exposes process-level metrics in Prometheus text exposition format. ║
// ║  No external libraries — hand-formatted text output.               ║
// ║                                                                     ║
// ║  Metrics endpoint at /metrics is public (no admin auth) for         ║
// ║  scraper compatibility.                                             ║
// ║                                                                     ║
// ║  Phase 41, Plan 01 (OBS-02). Added 2026-03-25.                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import type { QueueStats } from "./inbound-queue.js";

// ── Event loop lag measurement ───────────────────────────────────────
let _eventLoopLagMs = 0;
let _lagTimer: ReturnType<typeof setTimeout> | null = null;

function measureEventLoopLag(): void {
  const start = performance.now();
  const t = setTimeout(() => {
    _eventLoopLagMs = performance.now() - start;
    measureEventLoopLag(); // schedule next
  }, 1000);
  // Unref so timer doesn't keep process alive
  if (typeof t === "object" && t && "unref" in t) {
    (t as NodeJS.Timeout).unref();
  }
  _lagTimer = t;
}

// Start measuring on module load
measureEventLoopLag();

// ── Counters & Gauges ────────────────────────────────────────────────

/** HTTP request counter: Map<"route:method:status", count> */
const httpRequestCounts = new Map<string, number>();

/** HTTP request duration histogram buckets */
const HISTOGRAM_BUCKETS = [0.01, 0.05, 0.1, 0.5, 1, 5];

/** Per-bucket counts for HTTP request durations: Map<bucketUpperBound, count> */
const httpDurationBuckets = new Map<number, number>();
let httpDurationSum = 0;
let httpDurationCount = 0;

// Initialize histogram buckets
for (const b of HISTOGRAM_BUCKETS) {
  httpDurationBuckets.set(b, 0);
}

/** Outbound WAHA API call counters */
let apiCallsErrors = 0;

// Per-method API call counters: Map<"method:status", count>
const apiCallCounts = new Map<string, number>();

/** Inbound queue stats (updated via callback) */
let queueDmDepth = 0;
let queueGroupDepth = 0;
let queueProcessedTotal = 0;
let queueErrorsTotal = 0;

/** Session health states: Map<session, status> */
const sessionHealthMap = new Map<string, string>();

// ── Exported recording functions ─────────────────────────────────────

/**
 * Record an HTTP request to admin API routes.
 * Called by monitor.ts after each response. Phase 41 (OBS-02). DO NOT REMOVE.
 */
export function recordHttpRequest(route: string, method: string, status: number, durationMs: number): void {
  const key = `${route}:${method}:${status}`;
  httpRequestCounts.set(key, (httpRequestCounts.get(key) ?? 0) + 1);

  // Update histogram
  const durationSec = durationMs / 1000;
  httpDurationSum += durationSec;
  httpDurationCount++;
  for (const b of HISTOGRAM_BUCKETS) {
    if (durationSec <= b) {
      httpDurationBuckets.set(b, (httpDurationBuckets.get(b) ?? 0) + 1);
      break; // Only increment first matching bucket — collectMetrics does cumulative summing
    }
  }
}

/**
 * Record an outbound WAHA API call result.
 * Called by http-client.ts after each fetch. Phase 41 (OBS-02). DO NOT REMOVE.
 */
export function recordApiCall(method: string, success: boolean): void {
  const statusLabel = success ? "success" : "error";
  if (!success) {
    apiCallsErrors++;
  }
  const key = `${method}:${statusLabel}`;
  apiCallCounts.set(key, (apiCallCounts.get(key) ?? 0) + 1);
}

/**
 * Update queue depth stats from InboundQueue callback.
 * Called by monitor.ts queue change callback. Phase 41 (OBS-02). DO NOT REMOVE.
 */
export function updateQueueStats(stats: QueueStats): void {
  queueDmDepth = stats.dmDepth;
  queueGroupDepth = stats.groupDepth;
  queueProcessedTotal = stats.totalProcessed;
  queueErrorsTotal = stats.totalErrors;
}

/**
 * Update session health status.
 * Called by monitor.ts health state change callback. Phase 41 (OBS-02). DO NOT REMOVE.
 */
export function updateSessionHealth(session: string, status: string): void {
  sessionHealthMap.set(session, status);
}

// ── Prometheus text formatter ────────────────────────────────────────

function line(name: string, value: number, labels?: Record<string, string>): string {
  if (labels && Object.keys(labels).length > 0) {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return `${name}{${labelStr}} ${value}`;
  }
  return `${name} ${value}`;
}

/**
 * Collect all metrics and return Prometheus text exposition format.
 * Phase 41 (OBS-02). DO NOT REMOVE.
 */
export function collectMetrics(): string {
  const lines: string[] = [];
  const mem = process.memoryUsage();

  // ── Process metrics ──
  lines.push("# HELP process_heap_used_bytes Node.js heap used in bytes");
  lines.push("# TYPE process_heap_used_bytes gauge");
  lines.push(line("process_heap_used_bytes", mem.heapUsed));

  lines.push("# HELP process_heap_total_bytes Node.js heap total in bytes");
  lines.push("# TYPE process_heap_total_bytes gauge");
  lines.push(line("process_heap_total_bytes", mem.heapTotal));

  lines.push("# HELP process_rss_bytes Resident set size in bytes");
  lines.push("# TYPE process_rss_bytes gauge");
  lines.push(line("process_rss_bytes", mem.rss));

  // ── Event loop lag ──
  lines.push("# HELP nodejs_eventloop_lag_seconds Event loop lag in seconds");
  lines.push("# TYPE nodejs_eventloop_lag_seconds gauge");
  lines.push(line("nodejs_eventloop_lag_seconds", Math.max(0, (_eventLoopLagMs - 1000)) / 1000));

  // ── HTTP request counter ──
  lines.push("# HELP waha_http_requests_total Total HTTP requests to admin API");
  lines.push("# TYPE waha_http_requests_total counter");
  for (const [key, count] of httpRequestCounts) {
    const [route, method, status] = key.split(":");
    lines.push(line("waha_http_requests_total", count, { route, method, status }));
  }

  // ── HTTP request duration histogram ──
  lines.push("# HELP waha_http_request_duration_seconds Admin API request duration histogram");
  lines.push("# TYPE waha_http_request_duration_seconds histogram");
  let cumulative = 0;
  for (const b of HISTOGRAM_BUCKETS) {
    cumulative += httpDurationBuckets.get(b) ?? 0;
    lines.push(line("waha_http_request_duration_seconds_bucket", cumulative, { le: String(b) }));
  }
  lines.push(line("waha_http_request_duration_seconds_bucket", httpDurationCount, { le: "+Inf" }));
  lines.push(line("waha_http_request_duration_seconds_sum", httpDurationSum));
  lines.push(line("waha_http_request_duration_seconds_count", httpDurationCount));

  // ── Inbound queue ──
  lines.push("# HELP waha_inbound_queue_depth Current inbound queue depth");
  lines.push("# TYPE waha_inbound_queue_depth gauge");
  lines.push(line("waha_inbound_queue_depth", queueDmDepth, { priority: "dm" }));
  lines.push(line("waha_inbound_queue_depth", queueGroupDepth, { priority: "group" }));

  lines.push("# HELP waha_inbound_processed_total Total inbound messages processed");
  lines.push("# TYPE waha_inbound_processed_total counter");
  lines.push(line("waha_inbound_processed_total", queueProcessedTotal));

  lines.push("# HELP waha_inbound_errors_total Total inbound processing errors");
  lines.push("# TYPE waha_inbound_errors_total counter");
  lines.push(line("waha_inbound_errors_total", queueErrorsTotal));

  // ── Outbound WAHA API calls ──
  lines.push("# HELP waha_api_calls_total Total outbound WAHA API calls");
  lines.push("# TYPE waha_api_calls_total counter");
  for (const [key, count] of apiCallCounts) {
    const [method, status] = key.split(":");
    lines.push(line("waha_api_calls_total", count, { method, status }));
  }

  lines.push("# HELP waha_api_errors_total Total outbound WAHA API errors");
  lines.push("# TYPE waha_api_errors_total counter");
  lines.push(line("waha_api_errors_total", apiCallsErrors));

  // ── Session health ──
  lines.push("# HELP waha_session_health Session health status (1=current, 0=not)");
  lines.push("# TYPE waha_session_health gauge");
  const healthStatuses = ["healthy", "degraded", "unhealthy"];
  for (const [session, currentStatus] of sessionHealthMap) {
    for (const s of healthStatuses) {
      lines.push(line("waha_session_health", currentStatus === s ? 1 : 0, { session, status: s }));
    }
  }

  lines.push(""); // trailing newline
  return lines.join("\n");
}

/**
 * Stop the event loop lag measurement timer.
 * Called during graceful shutdown. Phase 41 (OBS-02). DO NOT REMOVE.
 */
export function stopMetricsTimers(): void {
  if (_lagTimer !== null) {
    clearTimeout(_lagTimer);
    _lagTimer = null;
  }
}
