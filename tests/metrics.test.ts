/**
 * Tests for metrics.ts — Prometheus metrics collection (Phase 41, OBS-02).
 *
 * Validates:
 * - collectMetrics() returns valid Prometheus text exposition format
 * - recordApiCall increments outbound API counters
 * - recordHttpRequest tracks route/method/status and histogram buckets
 * - updateQueueStats updates queue depth values
 * - updateSessionHealth tracks session states
 * - stopMetricsTimers cleans up event loop lag timer
 *
 * Phase 42, Plan 01 (REG-01).
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  collectMetrics,
  recordApiCall,
  recordHttpRequest,
  updateQueueStats,
  updateSessionHealth,
  stopMetricsTimers,
} from "../src/metrics.js";

// Stop the event loop lag timer after all tests to prevent hanging
afterAll(() => {
  stopMetricsTimers();
});

describe("metrics", () => {
  describe("collectMetrics", () => {
    it("returns string with Prometheus HELP and TYPE lines", () => {
      const output = collectMetrics();
      expect(typeof output).toBe("string");
      expect(output).toContain("# HELP");
      expect(output).toContain("# TYPE");
    });

    it("includes process heap metrics", () => {
      const output = collectMetrics();
      expect(output).toContain("process_heap_used_bytes");
      expect(output).toContain("process_heap_total_bytes");
      expect(output).toContain("process_rss_bytes");
    });

    it("includes event loop lag metric", () => {
      const output = collectMetrics();
      expect(output).toContain("nodejs_eventloop_lag_seconds");
    });

    it("includes queue depth metrics", () => {
      const output = collectMetrics();
      expect(output).toContain("waha_inbound_queue_depth");
      expect(output).toContain("waha_inbound_processed_total");
      expect(output).toContain("waha_inbound_errors_total");
    });

    it("includes HTTP request histogram", () => {
      const output = collectMetrics();
      expect(output).toContain("waha_http_request_duration_seconds");
      expect(output).toContain("waha_http_request_duration_seconds_bucket");
      expect(output).toContain("waha_http_request_duration_seconds_sum");
      expect(output).toContain("waha_http_request_duration_seconds_count");
    });

    it("ends with trailing newline", () => {
      const output = collectMetrics();
      expect(output.endsWith("\n")).toBe(true);
    });

    it("each HELP line is followed by matching TYPE line", () => {
      const output = collectMetrics();
      const lines = output.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("# HELP ")) {
          const metricName = lines[i].split(" ")[2];
          expect(lines[i + 1]).toMatch(new RegExp(`^# TYPE ${metricName} (counter|gauge|histogram)`));
        }
      }
    });
  });

  describe("recordApiCall", () => {
    it("increments API call counters and they appear in collectMetrics output", () => {
      recordApiCall("GET", true);
      recordApiCall("POST", true);
      recordApiCall("POST", false);

      const output = collectMetrics();
      expect(output).toContain("waha_api_calls_total");
      expect(output).toContain('method="GET",status="success"');
      expect(output).toContain('method="POST",status="success"');
      expect(output).toContain('method="POST",status="error"');
    });

    it("tracks errors separately in waha_api_errors_total", () => {
      recordApiCall("DELETE", false);
      const output = collectMetrics();
      expect(output).toContain("waha_api_errors_total");
      const match = output.match(/waha_api_errors_total (\d+)/);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThan(0);
    });
  });

  describe("recordHttpRequest", () => {
    it("records route/method/status and they appear in metrics", () => {
      recordHttpRequest("/api/admin/health", "GET", 200, 15);

      const output = collectMetrics();
      expect(output).toContain("waha_http_requests_total");
      expect(output).toContain('route="/api/admin/health"');
    });

    it("updates histogram buckets for request duration", () => {
      recordHttpRequest("/api/admin/stats", "GET", 200, 10);

      const output = collectMetrics();
      expect(output).toContain("waha_http_request_duration_seconds_bucket");
      const sumMatch = output.match(/waha_http_request_duration_seconds_sum ([\d.]+)/);
      expect(sumMatch).not.toBeNull();
      expect(Number(sumMatch![1])).toBeGreaterThan(0);
      const countMatch = output.match(/waha_http_request_duration_seconds_count (\d+)/);
      expect(countMatch).not.toBeNull();
      expect(Number(countMatch![1])).toBeGreaterThan(0);
    });
  });

  describe("updateQueueStats", () => {
    it("updates queue depth values in metrics output", () => {
      updateQueueStats({
        dmDepth: 5,
        groupDepth: 12,
        totalProcessed: 100,
        totalErrors: 3,
        dmCapacity: 50,
        groupCapacity: 100,
        dmOverflowDrops: 0,
        groupOverflowDrops: 0,
      });

      const output = collectMetrics();
      expect(output).toContain('waha_inbound_queue_depth{priority="dm"} 5');
      expect(output).toContain('waha_inbound_queue_depth{priority="group"} 12');
      expect(output).toContain("waha_inbound_processed_total 100");
      expect(output).toContain("waha_inbound_errors_total 3");
    });
  });

  describe("updateSessionHealth", () => {
    it("tracks session health states in metrics output", () => {
      updateSessionHealth("test-session-1", "healthy");
      updateSessionHealth("test-session-2", "unhealthy");

      const output = collectMetrics();
      expect(output).toContain("waha_session_health");
      expect(output).toContain('waha_session_health{session="test-session-1",status="healthy"} 1');
      expect(output).toContain('waha_session_health{session="test-session-1",status="unhealthy"} 0');
      expect(output).toContain('waha_session_health{session="test-session-2",status="healthy"} 0');
      expect(output).toContain('waha_session_health{session="test-session-2",status="unhealthy"} 1');
    });
  });

  describe("stopMetricsTimers", () => {
    it("can be called without error", () => {
      expect(() => stopMetricsTimers()).not.toThrow();
    });
  });
});
