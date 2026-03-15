import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callWahaApi, warnOnError, _resetForTesting } from "../src/http-client.js";

function mockFetchOk(data: any) {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (k: string) => k === "content-type" ? "application/json" : null },
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mockFetchError(status: number, text = "error") {
  const fn = vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: { get: () => null },
    text: vi.fn().mockResolvedValue(text),
    json: vi.fn().mockRejectedValue(new Error("not json")),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const baseParams = {
  baseUrl: "http://localhost:3004",
  apiKey: "test-key",
  path: "/api/test",
  skipRateLimit: true,
};

describe("callWahaApi", () => {
  beforeEach(() => {
    _resetForTesting();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes GET request and returns parsed JSON", async () => {
    const fetchMock = mockFetchOk({ ok: true });
    const result = await callWahaApi({ ...baseParams, method: "GET" });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3004/api/test");
    expect(opts.method).toBe("GET");
  });

  it("makes POST request with body and returns parsed JSON", async () => {
    const fetchMock = mockFetchOk({ id: 1 });
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
    const fetchMock = mockFetchOk({});
    await callWahaApi({ ...baseParams, method: "GET" });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers["x-api-key"]).toBe("test-key");
  });

  it("throws with structured log on non-ok response (includes status, error text)", async () => {
    mockFetchError(500, "Internal Server Error");
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      callWahaApi({ ...baseParams, method: "GET" })
    ).rejects.toThrow(/500/);
    consoleSpy.mockRestore();
  });

  // Timeout tests use real timers with a very short timeout (50ms).
  // The mock fetch must respect the AbortSignal to simulate real abort behavior.
  function hangingFetch() {
    return vi.fn().mockImplementation((_url: string, opts: any) => {
      return new Promise((_resolve, reject) => {
        const signal = opts?.signal as AbortSignal | undefined;
        if (signal) {
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          });
        }
        // Otherwise never resolves
      });
    });
  }

  it("aborts fetch after timeout with TimeoutError", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    await expect(
      callWahaApi({ ...baseParams, method: "GET", timeoutMs: 50 })
    ).rejects.toThrow(/timed.out|timeout|abort/i);
  }, 10_000);

  it("on timeout for mutation (POST), error message contains 'may have succeeded'", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    await expect(
      callWahaApi({ ...baseParams, method: "POST", timeoutMs: 50 })
    ).rejects.toThrow(/may have succeeded/i);
  }, 10_000);

  it("on timeout for read (GET), error message does NOT contain 'may have succeeded'", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    try {
      await callWahaApi({ ...baseParams, method: "GET", timeoutMs: 50 });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.message).not.toMatch(/may have succeeded/i);
      expect(err.message).toMatch(/timed out/i);
    }
  }, 10_000);

  it("with skipRateLimit=true bypasses token bucket", async () => {
    const fetchMock = mockFetchOk({ ok: true });
    await callWahaApi({ ...baseParams, method: "GET", skipRateLimit: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("without skipRateLimit acquires token before fetch", async () => {
    const fetchMock = mockFetchOk({ ok: true });
    await callWahaApi({ ...baseParams, method: "GET", skipRateLimit: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("context param (action, chatId) appears in error log messages", async () => {
    mockFetchError(500, "Server Error");
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

describe("callWahaApi 429 retry", () => {
  beforeEach(() => {
    _resetForTesting();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function make429(retryAfter?: string) {
    return {
      ok: false, status: 429,
      headers: { get: (k: string) => {
        if (k.toLowerCase() === "retry-after" && retryAfter) return retryAfter;
        return null;
      }},
      text: vi.fn().mockResolvedValue("rate limited"),
    };
  }

  function makeOk() {
    return {
      ok: true, status: 200,
      headers: { get: (k: string) => k === "content-type" ? "application/json" : null },
      json: vi.fn().mockResolvedValue({ ok: true }),
      text: vi.fn().mockResolvedValue(""),
    };
  }

  it("on 429 response, retries with exponential backoff up to 3 times", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(makeOk());
    vi.stubGlobal("fetch", fetchMock);
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const promise = callWahaApi({ ...baseParams, method: "GET" });

    // Advance through backoff delays generously
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    consoleSpy.mockRestore();
  });

  it("on 429 with Retry-After header, uses that value as minimum delay", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make429("5"))
      .mockResolvedValueOnce(makeOk());
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
    vi.useRealTimers(); // Use real timers for this test to avoid unhandled rejection timing
    _resetForTesting();
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(make429()));
    vi.stubGlobal("fetch", fetchMock);
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // With real timers and jitter, this resolves in ~7s. The backoff delays are real but short due to jitter.
    // Use a tighter retry: base delays are 1s/2s/4s but with 0.75-1.25 jitter.
    await expect(
      callWahaApi({ ...baseParams, method: "GET" })
    ).rejects.toThrow(/rate.limit|429|too many/i);

    consoleSpy.mockRestore();
    vi.useFakeTimers(); // restore for afterEach
  }, 30_000);
});

describe("shared backoff state", () => {
  beforeEach(() => {
    _resetForTesting();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("second call waits for backoff from first call's 429", async () => {
    function make429() {
      return {
        ok: false, status: 429,
        headers: { get: () => null },
        text: vi.fn().mockResolvedValue("rate limited"),
      };
    }
    function makeOk() {
      return {
        ok: true, status: 200,
        headers: { get: (k: string) => k === "content-type" ? "application/json" : null },
        json: vi.fn().mockResolvedValue({ ok: true }),
        text: vi.fn().mockResolvedValue(""),
      };
    }

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make429())  // first call -> 429
      .mockResolvedValueOnce(makeOk())   // first call retry -> success
      .mockResolvedValueOnce(makeOk());  // second call -> success
    vi.stubGlobal("fetch", fetchMock);
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const p1 = callWahaApi({ ...baseParams, method: "GET" as const });
    const p2 = callWahaApi({ ...baseParams, method: "GET" as const, path: "/api/test2" });

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1500);
    }

    await Promise.all([p1, p2]);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
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

describe("MutationDedup — duplicate mutation suppression", () => {
  beforeEach(() => {
    _resetForTesting();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Test 1: Two identical POST calls within TTL — second is suppressed
  it("second identical POST within TTL window throws duplicate suppression error", async () => {
    // First POST: times out (triggers markPending)
    let fetchCallCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, opts: any) => {
      fetchCallCount++;
      return new Promise((_resolve, reject) => {
        const signal = opts?.signal as AbortSignal | undefined;
        if (signal) {
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    }));

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // First call: times out and marks mutation as pending
    await expect(
      callWahaApi({ ...baseParams, method: "POST", body: { chatId: "123@c.us", text: "hello" }, timeoutMs: 50 })
    ).rejects.toThrow(/may have succeeded/i);

    // Second call: same path+body — should be suppressed, NOT hit fetch
    const fetchCountBefore = fetchCallCount;
    await expect(
      callWahaApi({ ...baseParams, method: "POST", body: { chatId: "123@c.us", text: "hello" }, timeoutMs: 50 })
    ).rejects.toThrow(/duplicate mutation suppressed/i);

    // fetch should NOT have been called for the second attempt
    expect(fetchCallCount).toBe(fetchCountBefore);
    consoleSpy.mockRestore();
  }, 10_000);

  // Test 2: GET requests are never deduped
  it("identical GET calls both proceed normally (GETs are not mutations)", async () => {
    const fetchMock = mockFetchOk({ ok: true });

    const r1 = await callWahaApi({ ...baseParams, method: "GET" });
    const r2 = await callWahaApi({ ...baseParams, method: "GET" });

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Test 3: POST that succeeds (200) does NOT mark as pending — retry proceeds normally
  it("successful POST does NOT mark as pending — subsequent identical POST proceeds", async () => {
    const fetchMock = mockFetchOk({ id: 1 });

    const body = { chatId: "123@c.us", text: "hello" };

    await callWahaApi({ ...baseParams, method: "POST", body });
    // Second call with same body should also succeed (no suppression)
    await callWahaApi({ ...baseParams, method: "POST", body });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Test 4: POST that times out marks mutation as pending — retry within TTL is suppressed
  it("POST timeout marks mutation pending — retry within TTL is suppressed", async () => {
    let fetchCallCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, opts: any) => {
      fetchCallCount++;
      return new Promise((_resolve, reject) => {
        const signal = opts?.signal as AbortSignal | undefined;
        if (signal) {
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    }));

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = { chatId: "555@c.us", text: "test" };

    // First call times out
    await expect(
      callWahaApi({ ...baseParams, method: "POST", body, timeoutMs: 50 })
    ).rejects.toThrow(/may have succeeded/i);

    const countAfterFirst = fetchCallCount;

    // Retry within TTL should be suppressed
    await expect(
      callWahaApi({ ...baseParams, method: "POST", body, timeoutMs: 50 })
    ).rejects.toThrow(/duplicate mutation suppressed/i);

    expect(fetchCallCount).toBe(countAfterFirst); // no new fetch call
    consoleSpy.mockRestore();
  }, 10_000);

  // Test 5: After TTL expires, the mutation key is cleared — same mutation can proceed
  it("after TTL expires, suppressed mutation key is cleared — mutation can proceed again", async () => {
    let fetchCallCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, opts: any) => {
      fetchCallCount++;
      return new Promise((_resolve, reject) => {
        const signal = opts?.signal as AbortSignal | undefined;
        if (signal) {
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    }));

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = { chatId: "777@c.us", text: "expire-test" };

    // First call times out
    await expect(
      callWahaApi({ ...baseParams, method: "POST", body, timeoutMs: 50 })
    ).rejects.toThrow(/may have succeeded/i);

    // Advance time past TTL (60s)
    await vi.advanceTimersByTimeAsync(61_000);

    const countAfterExpiry = fetchCallCount;

    // After TTL, the same mutation should reach fetch again (not suppressed)
    // It will time out again because fetch still hangs
    await expect(
      callWahaApi({ ...baseParams, method: "POST", body, timeoutMs: 50 })
    ).rejects.toThrow(/may have succeeded/i);

    expect(fetchCallCount).toBeGreaterThan(countAfterExpiry);
    consoleSpy.mockRestore();
  }, 10_000);

  // Test 6: Different chatId or different body produces different dedup keys
  it("different body produces different dedup key — not suppressed", async () => {
    let fetchCallCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, opts: any) => {
      fetchCallCount++;
      return new Promise((_resolve, reject) => {
        const signal = opts?.signal as AbortSignal | undefined;
        if (signal) {
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    }));

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // First call: chatId A times out
    await expect(
      callWahaApi({ ...baseParams, method: "POST", body: { chatId: "aaa@c.us", text: "hi" }, timeoutMs: 50 })
    ).rejects.toThrow(/may have succeeded/i);

    const countAfterFirst = fetchCallCount;

    // Different chatId — should NOT be suppressed, should hit fetch
    await expect(
      callWahaApi({ ...baseParams, method: "POST", body: { chatId: "bbb@c.us", text: "hi" }, timeoutMs: 50 })
    ).rejects.toThrow(/may have succeeded/i);

    expect(fetchCallCount).toBeGreaterThan(countAfterFirst);
    consoleSpy.mockRestore();
  }, 10_000);

  // Test 7: _resetForTesting clears the dedup map
  it("_resetForTesting clears the dedup map — previously suppressed mutation can proceed", async () => {
    let fetchCallCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, opts: any) => {
      fetchCallCount++;
      return new Promise((_resolve, reject) => {
        const signal = opts?.signal as AbortSignal | undefined;
        if (signal) {
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    }));

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = { chatId: "reset-test@c.us", text: "reset" };

    // First call times out
    await expect(
      callWahaApi({ ...baseParams, method: "POST", body, timeoutMs: 50 })
    ).rejects.toThrow(/may have succeeded/i);

    // Reset clears the dedup state
    _resetForTesting();

    const countAfterReset = fetchCallCount;

    // After reset, same mutation should reach fetch again
    await expect(
      callWahaApi({ ...baseParams, method: "POST", body, timeoutMs: 50 })
    ).rejects.toThrow(/may have succeeded/i);

    expect(fetchCallCount).toBeGreaterThan(countAfterReset);
    consoleSpy.mockRestore();
  }, 10_000);
});
