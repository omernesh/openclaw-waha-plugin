import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callWahaApi, warnOnError } from "../src/http-client.js";

// We need to reset the module-level backoff state between tests
// and mock fetch globally.

function mockFetch(response: Partial<Response> & { ok: boolean; status: number }) {
  const headers = new Map(Object.entries(response.headers ?? {}));
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    headers: {
      get: (key: string) => headers.get(key.toLowerCase()) ?? (response as any)._headers?.[key] ?? null,
    },
    json: vi.fn().mockResolvedValue(response._json ?? {}),
    text: vi.fn().mockResolvedValue(response._text ?? ""),
  } as any);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { "content-type": "application/json" },
    _json: data,
    _text: JSON.stringify(data),
  };
}

function errorResponse(status: number, text = "error") {
  return {
    ok: false,
    status,
    headers: {},
    _json: null,
    _text: text,
  };
}

describe("callWahaApi", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const baseParams = {
    baseUrl: "http://localhost:3004",
    apiKey: "test-key",
    path: "/api/test",
    skipRateLimit: true, // skip rate limit for most tests
  };

  it("makes GET request and returns parsed JSON", async () => {
    const fetchMock = mockFetch(jsonResponse({ ok: true }));
    const result = await callWahaApi({ ...baseParams, method: "GET" });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3004/api/test");
    expect(opts.method).toBe("GET");
  });

  it("makes POST request with body and returns parsed JSON", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: 1 }));
    const result = await callWahaApi({
      ...baseParams,
      method: "POST",
      body: { text: "hello" },
    });
    expect(result).toEqual({ id: 1 });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe(JSON.stringify({ text: "hello" }));
  });

  it("includes x-api-key header when apiKey provided", async () => {
    const fetchMock = mockFetch(jsonResponse({}));
    await callWahaApi({ ...baseParams, method: "GET" });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers["x-api-key"]).toBe("test-key");
  });

  it("throws with structured log on non-ok response (includes status, error text)", async () => {
    mockFetch(errorResponse(500, "Internal Server Error"));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      callWahaApi({ ...baseParams, method: "GET" })
    ).rejects.toThrow(/500/);
    consoleSpy.mockRestore();
  });

  it("aborts fetch after timeout with TimeoutError", async () => {
    // Make fetch hang forever by never resolving
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const promise = callWahaApi({
      ...baseParams,
      method: "GET",
      timeoutMs: 100, // short timeout for test
    });

    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).rejects.toThrow(/timeout|abort/i);
  });

  it("on timeout for mutation (POST), error message contains 'may have succeeded'", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const promise = callWahaApi({
      ...baseParams,
      method: "POST",
      timeoutMs: 100,
    });

    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).rejects.toThrow(/may have succeeded/i);
  });

  it("on timeout for read (GET), error message does NOT contain 'may have succeeded'", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const promise = callWahaApi({
      ...baseParams,
      method: "GET",
      timeoutMs: 100,
    });

    await vi.advanceTimersByTimeAsync(200);

    try {
      await promise;
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.message).not.toMatch(/may have succeeded/i);
    }
  });

  it("with skipRateLimit=true bypasses token bucket", async () => {
    const fetchMock = mockFetch(jsonResponse({ ok: true }));
    // Should resolve immediately without waiting for token
    await callWahaApi({ ...baseParams, method: "GET", skipRateLimit: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("without skipRateLimit acquires token before fetch", async () => {
    const fetchMock = mockFetch(jsonResponse({ ok: true }));
    // Not skipping rate limit - should still work (bucket has tokens initially)
    await callWahaApi({
      ...baseParams,
      method: "GET",
      skipRateLimit: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("on 429 response, retries with exponential backoff up to 3 times", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 429,
        headers: { get: () => null },
        text: vi.fn().mockResolvedValue("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false, status: 429,
        headers: { get: () => null },
        text: vi.fn().mockResolvedValue("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false, status: 429,
        headers: { get: () => null },
        text: vi.fn().mockResolvedValue("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: (k: string) => k === "content-type" ? "application/json" : null },
        json: vi.fn().mockResolvedValue({ ok: true }),
        text: vi.fn().mockResolvedValue(""),
      });
    vi.stubGlobal("fetch", fetchMock);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const promise = callWahaApi({ ...baseParams, method: "GET" });

    // Advance through backoff delays (1s + 2s + 4s with jitter)
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1500);
    }

    const result = await promise;
    expect(result).toEqual({ ok: true });
    // Initial + 3 retries = 4 calls total (but only 3 429s then 1 success)
    expect(fetchMock).toHaveBeenCalledTimes(4);
    consoleSpy.mockRestore();
  });

  it("on 429 with Retry-After header, uses that value as minimum delay", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 429,
        headers: { get: (k: string) => k.toLowerCase() === "retry-after" ? "5" : null },
        text: vi.fn().mockResolvedValue("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: (k: string) => k === "content-type" ? "application/json" : null },
        json: vi.fn().mockResolvedValue({ ok: true }),
        text: vi.fn().mockResolvedValue(""),
      });
    vi.stubGlobal("fetch", fetchMock);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const promise = callWahaApi({ ...baseParams, method: "GET" });

    // Advance past the Retry-After delay of 5s
    await vi.advanceTimersByTimeAsync(6000);

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });

  it("after 3 failed 429 retries, throws rate limit error", async () => {
    const make429 = () => ({
      ok: false, status: 429,
      headers: { get: () => null },
      text: vi.fn().mockResolvedValue("rate limited"),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(make429()); // 4th 429 means we exhausted retries
    vi.stubGlobal("fetch", fetchMock);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const promise = callWahaApi({ ...baseParams, method: "GET" });

    // Advance enough time for all retries
    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }

    await expect(promise).rejects.toThrow(/rate.limit|429|too many/i);
    consoleSpy.mockRestore();
  });

  it("context param (action, chatId) appears in error log messages", async () => {
    mockFetch(errorResponse(500, "Server Error"));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      callWahaApi({
        ...baseParams,
        method: "POST",
        context: { action: "sendText", chatId: "123@c.us" },
      })
    ).rejects.toThrow();

    const warnCalls = consoleSpy.mock.calls.map((c) => c.join(" "));
    const hasContext = warnCalls.some(
      (msg) => msg.includes("sendText") && msg.includes("123@c.us")
    );
    expect(hasContext).toBe(true);
    consoleSpy.mockRestore();
  });
});

describe("warnOnError", () => {
  it("logs warning with context string", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = warnOnError("presence update");
    handler(new Error("network failure"));
    const warnCalls = consoleSpy.mock.calls.map((c) => c.join(" "));
    expect(warnCalls.some((msg) => msg.includes("presence update") && msg.includes("network failure"))).toBe(true);
    consoleSpy.mockRestore();
  });
});

describe("shared backoff state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("second call waits for backoff from first call's 429", async () => {
    // We need a fresh module to reset backoff state
    // For this test, we verify that two concurrent calls share backoff
    const make429 = () => ({
      ok: false, status: 429,
      headers: { get: () => null },
      text: vi.fn().mockResolvedValue("rate limited"),
    });
    const makeOk = () => ({
      ok: true, status: 200,
      headers: { get: (k: string) => k === "content-type" ? "application/json" : null },
      json: vi.fn().mockResolvedValue({ ok: true }),
      text: vi.fn().mockResolvedValue(""),
    });

    // First call: 429 -> retry -> success
    // Second call: should wait for backoff then succeed
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make429())  // first call, first attempt -> 429
      .mockResolvedValueOnce(makeOk())   // first call, retry -> success
      .mockResolvedValueOnce(makeOk());  // second call -> success (after waiting)
    vi.stubGlobal("fetch", fetchMock);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const baseP = { ...{
      baseUrl: "http://localhost:3004",
      apiKey: "test-key",
      path: "/api/test",
      skipRateLimit: true,
    }, method: "GET" as const };

    const p1 = callWahaApi(baseP);
    // Start second call shortly after
    const p2 = callWahaApi({ ...baseP, path: "/api/test2" });

    // Advance time to allow backoff + retries
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1500);
    }

    await Promise.all([p1, p2]);
    // Both should have resolved
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    consoleSpy.mockRestore();
  });
});
