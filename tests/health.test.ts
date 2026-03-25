import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock callWahaApi before importing health module
const mockCallWahaApi = vi.fn();
vi.mock("../src/http-client.js", () => ({
  callWahaApi: (...args: any[]) => mockCallWahaApi(...args),
  setSessionHealthChecker: vi.fn(),
}));

import { startHealthCheck, getHealthState, type HealthState } from "../src/health.js";

describe("startHealthCheck", () => {
  beforeEach(() => {
    mockCallWahaApi.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls callWahaApi with correct /api/sessions/{session} path", async () => {
    const ac = new AbortController();
    mockCallWahaApi.mockResolvedValue({ id: "123" });

    startHealthCheck({
      baseUrl: "http://localhost:3004",
      apiKey: "test-key",
      session: "test_session",
      intervalMs: 100,
      abortSignal: ac.signal,
      initialDelayMs: 10,
    });

    // Wait for first tick after 10ms initial delay
    await new Promise((r) => setTimeout(r, 80));
    ac.abort();

    expect(mockCallWahaApi).toHaveBeenCalled();
    const call = mockCallWahaApi.mock.calls[0][0];
    expect(call.path).toBe("/api/sessions/test_session");
  });

  it("uses skipRateLimit: true and timeoutMs: 10000", async () => {
    const ac = new AbortController();
    mockCallWahaApi.mockResolvedValue({ id: "123" });

    startHealthCheck({
      baseUrl: "http://localhost:3004",
      apiKey: "test-key",
      session: "test_session",
      intervalMs: 100,
      abortSignal: ac.signal,
      initialDelayMs: 10,
    });

    await new Promise((r) => setTimeout(r, 80));
    ac.abort();

    const call = mockCallWahaApi.mock.calls[0][0];
    expect(call.skipRateLimit).toBe(true);
    expect(call.timeoutMs).toBe(10_000);
  });

  it("after 1 failed ping, state.status is 'degraded' and consecutiveFailures is 1", async () => {
    const ac = new AbortController();
    mockCallWahaApi.mockRejectedValue(new Error("connection refused"));

    const state = startHealthCheck({
      baseUrl: "http://localhost:3004",
      apiKey: "test-key",
      session: "test_session",
      intervalMs: 500, // long interval so only 1 ping fires before abort
      abortSignal: ac.signal,
      initialDelayMs: 10,
    });

    // Wait for first ping (10ms delay + execution) then abort before second
    await new Promise((r) => setTimeout(r, 80));
    ac.abort();

    expect(state.status).toBe("degraded");
    expect(state.consecutiveFailures).toBe(1);
  });

  it("after 3 consecutive failed pings, state.status is 'unhealthy'", async () => {
    const ac = new AbortController();
    mockCallWahaApi.mockRejectedValue(new Error("connection refused"));

    const state = startHealthCheck({
      baseUrl: "http://localhost:3004",
      apiKey: "test-key",
      session: "test_session",
      intervalMs: 30,
      abortSignal: ac.signal,
      initialDelayMs: 5,
    });

    // Wait long enough for 3 pings: 5ms initial + 3 * 30ms intervals + buffer
    await new Promise((r) => setTimeout(r, 200));
    ac.abort();

    expect(state.consecutiveFailures).toBeGreaterThanOrEqual(3);
    expect(state.status).toBe("unhealthy");
  });

  it("after success following failures, state resets to 'healthy' with consecutiveFailures 0", async () => {
    const ac = new AbortController();
    let callCount = 0;
    mockCallWahaApi.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return Promise.reject(new Error("fail"));
      return Promise.resolve({ id: "123" });
    });

    const state = startHealthCheck({
      baseUrl: "http://localhost:3004",
      apiKey: "test-key",
      session: "test_session",
      intervalMs: 30,
      abortSignal: ac.signal,
      initialDelayMs: 5,
    });

    // Wait for 2 failures + 1 success
    await new Promise((r) => setTimeout(r, 200));
    ac.abort();

    expect(state.status).toBe("healthy");
    expect(state.consecutiveFailures).toBe(0);
  });

  it("lastSuccessAt is updated on successful ping", async () => {
    const ac = new AbortController();
    mockCallWahaApi.mockResolvedValue({ id: "123" });

    const state = startHealthCheck({
      baseUrl: "http://localhost:3004",
      apiKey: "test-key",
      session: "test_session",
      intervalMs: 50,
      abortSignal: ac.signal,
      initialDelayMs: 10,
    });

    expect(state.lastSuccessAt).toBeNull();

    await new Promise((r) => setTimeout(r, 100));
    ac.abort();

    expect(state.lastSuccessAt).toBeTypeOf("number");
    expect(state.lastSuccessAt).toBeGreaterThan(0);
  });

  it("timer stops when abortSignal is aborted (no more pings after abort)", async () => {
    const ac = new AbortController();
    mockCallWahaApi.mockResolvedValue({ id: "123" });

    startHealthCheck({
      baseUrl: "http://localhost:3004",
      apiKey: "test-key",
      session: "test_session",
      intervalMs: 30,
      abortSignal: ac.signal,
      initialDelayMs: 5,
    });

    await new Promise((r) => setTimeout(r, 100));
    const countAtAbort = mockCallWahaApi.mock.calls.length;
    ac.abort();

    // Wait more and verify no additional calls
    await new Promise((r) => setTimeout(r, 100));
    expect(mockCallWahaApi.mock.calls.length).toBe(countAtAbort);
  });
});
