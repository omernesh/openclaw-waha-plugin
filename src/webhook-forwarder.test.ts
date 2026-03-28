// Phase 61-01: Webhook forwarder unit tests.
// TDD RED phase — all tests written before implementation.
// DI-based: _fetch, _sleep, _now injected to avoid mocking globals.

import { describe, it, expect, beforeEach } from "vitest";
import {
  signWebhookPayload,
  forwardWebhook,
  resetCircuitBreakers,
  type WebhookSubscription,
  type ForwardWebhookParams,
} from "./webhook-forwarder.js";

// ─── signWebhookPayload ────────────────────────────────────────────────────────

describe("signWebhookPayload", () => {
  it("returns sha256= prefix", () => {
    const sig = signWebhookPayload("hello", "secret");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is deterministic for same input", () => {
    const a = signWebhookPayload("body", "secret");
    const b = signWebhookPayload("body", "secret");
    expect(a).toBe(b);
  });

  it("differs when body changes", () => {
    const a = signWebhookPayload("body1", "secret");
    const b = signWebhookPayload("body2", "secret");
    expect(a).not.toBe(b);
  });

  it("differs when secret changes", () => {
    const a = signWebhookPayload("body", "secret1");
    const b = signWebhookPayload("body", "secret2");
    expect(a).not.toBe(b);
  });

  it("produces verifiable HMAC", async () => {
    const { createHmac } = await import("node:crypto");
    const body = '{"event":"message"}';
    const secret = "my-api-key";
    const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(signWebhookPayload(body, secret)).toBe(expected);
  });
});

// ─── forwardWebhook — happy path ───────────────────────────────────────────────

describe("forwardWebhook - delivery", () => {
  beforeEach(() => resetCircuitBreakers());

  const makeOkFetch = () =>
    async (_url: string, _init: unknown) => ({ ok: true, status: 200 }) as Response;

  const baseSub: WebhookSubscription = {
    url: "https://example.com/hook",
    events: ["message"],
    enabled: true,
  };

  it("POSTs to the subscription URL with correct Content-Type header", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const mockFetch = async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return { ok: true, status: 200 } as Response;
    };
    await forwardWebhook({
      subscriptions: [baseSub],
      secret: "key",
      eventType: "message",
      payload: { type: "message" },
      _fetch: mockFetch,
      _sleep: async () => {},
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.com/hook");
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
  });

  it("includes X-Chatlytics-Signature header with correct HMAC", async () => {
    const { createHmac } = (await import("node:crypto")) as typeof import("node:crypto");
    const payload = { type: "message" };
    const body = JSON.stringify(payload);
    const secret = "test-secret";
    const expectedSig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

    let capturedHeaders: Record<string, string> = {};
    const mockFetch = async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return { ok: true, status: 200 } as Response;
    };

    await forwardWebhook({
      subscriptions: [baseSub],
      secret,
      eventType: "message",
      payload,
      _fetch: mockFetch,
      _sleep: async () => {},
    });
    expect(capturedHeaders["X-Chatlytics-Signature"]).toBe(expectedSig);
  });

  it("skips subscriptions where enabled=false", async () => {
    const calls: string[] = [];
    const mockFetch = async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200 } as Response;
    };
    await forwardWebhook({
      subscriptions: [{ ...baseSub, enabled: false }],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: async () => {},
    });
    expect(calls).toHaveLength(0);
  });

  it("skips subscriptions where event type not in events array", async () => {
    const calls: string[] = [];
    const mockFetch = async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200 } as Response;
    };
    await forwardWebhook({
      subscriptions: [{ ...baseSub, events: ["session.status"] }],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: async () => {},
    });
    expect(calls).toHaveLength(0);
  });

  it("posts to multiple matching subscriptions", async () => {
    const calls: string[] = [];
    const mockFetch = async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200 } as Response;
    };
    await forwardWebhook({
      subscriptions: [
        { url: "https://a.example.com/hook", events: ["message"], enabled: true },
        { url: "https://b.example.com/hook", events: ["message"], enabled: true },
      ],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: async () => {},
    });
    expect(calls).toHaveLength(2);
    expect(calls).toContain("https://a.example.com/hook");
    expect(calls).toContain("https://b.example.com/hook");
  });
});

// ─── deliverWithRetry — retry behavior ────────────────────────────────────────

describe("forwardWebhook - retry on 5xx", () => {
  beforeEach(() => resetCircuitBreakers());

  it("returns delivered on 200", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return { ok: true, status: 200 } as Response;
    };
    await forwardWebhook({
      subscriptions: [{ url: "https://example.com/hook", events: ["message"], enabled: true }],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: async () => {},
    });
    expect(calls).toBe(1);
  });

  it("retries on 500 up to 3 times before dead-lettering", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return { ok: false, status: 500 } as Response;
    };
    const sleepDelays: number[] = [];
    const mockSleep = async (ms: number) => { sleepDelays.push(ms); };

    await forwardWebhook({
      subscriptions: [{ url: "https://example.com/hook", events: ["message"], enabled: true }],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: mockSleep,
    });

    // 1 initial + 3 retries = 4 calls
    expect(calls).toBe(4);
    // delays: 1000, 2000, 4000
    expect(sleepDelays).toEqual([1000, 2000, 4000]);
  });

  it("dead-letters immediately on 400 (no retry)", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return { ok: false, status: 400 } as Response;
    };
    const sleepDelays: number[] = [];
    const mockSleep = async (ms: number) => { sleepDelays.push(ms); };

    await forwardWebhook({
      subscriptions: [{ url: "https://example.com/hook", events: ["message"], enabled: true }],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: mockSleep,
    });

    expect(calls).toBe(1);
    expect(sleepDelays).toHaveLength(0);
  });

  it("dead-letters immediately on 401 (4xx, no retry)", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return { ok: false, status: 401 } as Response;
    };

    await forwardWebhook({
      subscriptions: [{ url: "https://example.com/hook", events: ["message"], enabled: true }],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: async () => {},
    });
    expect(calls).toBe(1);
  });

  it("succeeds on second attempt after first 500", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 500 } as Response;
      return { ok: true, status: 200 } as Response;
    };
    const sleepDelays: number[] = [];
    const mockSleep = async (ms: number) => { sleepDelays.push(ms); };

    await forwardWebhook({
      subscriptions: [{ url: "https://example.com/hook", events: ["message"], enabled: true }],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: mockSleep,
    });

    expect(calls).toBe(2);
    expect(sleepDelays).toEqual([1000]);
  });
});

// ─── Circuit breaker ───────────────────────────────────────────────────────────

describe("forwardWebhook - circuit breaker", () => {
  beforeEach(() => resetCircuitBreakers());

  const makeTimeoutFetch = () => async () => {
    const err = new Error("AbortError");
    (err as NodeJS.ErrnoException).name = "AbortError";
    throw err;
  };

  it("opens circuit after 3 consecutive timeouts", async () => {
    // Each call triggers 4 fetch attempts (initial + 3 retries) but circuit opens after 3 timeouts
    // For a single subscription with 3 consecutive full-round-trip timeouts:
    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      const err = new Error("AbortError");
      err.name = "AbortError";
      throw err;
    };

    const sub = { url: "https://example.com/hook", events: ["message"], enabled: true };

    // First delivery attempt — should exhaust all retries and record timeouts
    await forwardWebhook({
      subscriptions: [sub],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: async () => {},
    });

    // Second delivery attempt — circuit should be open, no fetch calls
    const callsBefore = fetchCalls;
    await forwardWebhook({
      subscriptions: [sub],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: async () => {},
    });

    // If circuit opened, second call made 0 fetch calls
    expect(fetchCalls).toBe(callsBefore);
  });

  it("half-opens circuit after 60s", async () => {
    // Saturate circuit with timeouts
    const mockFetch = async () => {
      const err = new Error("AbortError");
      err.name = "AbortError";
      throw err;
    };
    const sub = { url: "https://example.com/hook", events: ["message"], enabled: true };

    await forwardWebhook({
      subscriptions: [sub],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: mockFetch,
      _sleep: async () => {},
    });

    // Now inject a _now that's 61s in the future
    let calls = 0;
    const probeFetch = async () => {
      calls++;
      return { ok: true, status: 200 } as Response;
    };

    await forwardWebhook({
      subscriptions: [sub],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: probeFetch,
      _sleep: async () => {},
      _now: () => Date.now() + 61_000,
    });

    // Probe should have been attempted
    expect(calls).toBeGreaterThan(0);
  });

  it("closes circuit on successful probe", async () => {
    // Saturate circuit
    const timeoutFetch = async () => {
      const err = new Error("AbortError");
      err.name = "AbortError";
      throw err;
    };
    const sub = { url: "https://example.com/hook", events: ["message"], enabled: true };

    await forwardWebhook({
      subscriptions: [sub],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: timeoutFetch,
      _sleep: async () => {},
    });

    // Probe succeeds (61s later)
    await forwardWebhook({
      subscriptions: [sub],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: async () => ({ ok: true, status: 200 }) as Response,
      _sleep: async () => {},
      _now: () => Date.now() + 61_000,
    });

    // After probe succeeds, circuit should be closed — normal delivery resumes
    let nextCalls = 0;
    await forwardWebhook({
      subscriptions: [sub],
      secret: "key",
      eventType: "message",
      payload: {},
      _fetch: async () => {
        nextCalls++;
        return { ok: true, status: 200 } as Response;
      },
      _sleep: async () => {},
      _now: () => Date.now() + 61_000,
    });
    expect(nextCalls).toBe(1);
  });
});

// ─── Config schema integration ─────────────────────────────────────────────────

import { validateWahaConfig } from "./config-schema.js";

describe("config schema - webhookSubscriptions", () => {
  it("validates webhookSubscriptions as optional array defaulting to []", () => {
    const result = validateWahaConfig({});
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.webhookSubscriptions).toEqual([]);
    }
  });

  it("accepts valid webhookSubscriptions entry", () => {
    const result = validateWahaConfig({
      webhookSubscriptions: [
        { url: "https://example.com/hook" },
      ],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.webhookSubscriptions).toHaveLength(1);
      expect(result.data.webhookSubscriptions[0].events).toEqual(["message"]);
      expect(result.data.webhookSubscriptions[0].enabled).toBe(true);
    }
  });

  it("rejects invalid URL in webhookSubscriptions", () => {
    const result = validateWahaConfig({
      webhookSubscriptions: [{ url: "not-a-url" }],
    });
    expect(result.valid).toBe(false);
  });

  it("accepts custom events array", () => {
    const result = validateWahaConfig({
      webhookSubscriptions: [
        { url: "https://example.com/hook", events: ["message", "session.status"] },
      ],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.webhookSubscriptions[0].events).toEqual(["message", "session.status"]);
    }
  });
});
