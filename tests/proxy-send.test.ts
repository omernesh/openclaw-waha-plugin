/**
 * proxy-send.test.ts
 * Tests for Phase 55 Plan 01 (CC-01, CC-02): POST /api/admin/proxy-send endpoint.
 *
 * Tests the proxy-send handler logic extracted into a testable unit.
 * Mocks: enforceMimicry, recordMimicrySuccess, callWahaApi.
 *
 * Covers:
 *  - Happy path: valid send returns 200 + { ok: true, waha: ... }
 *  - Gate/cap block: enforceMimicry throws → 403 + { blocked: true }
 *  - Missing chatId → 400
 *  - Missing session → 400
 *  - enforceMimicry called with messageLength = body.text.length (CC-02)
 *  - enforceMimicry called with messageLength 0 when body has no text
 *  - recordMimicrySuccess called AFTER callWahaApi succeeds
 *  - recordMimicrySuccess NOT called when callWahaApi throws
 *  - type field maps to correct WAHA path
 *  - callWahaApi failure → 502 + { error: "WAHA API error: ..." }
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockEnforceMimicry,
  mockRecordMimicrySuccess,
  mockCallWahaApi,
} = vi.hoisted(() => ({
  mockEnforceMimicry: vi.fn(),
  mockRecordMimicrySuccess: vi.fn(),
  mockCallWahaApi: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../src/mimicry-enforcer.js", () => ({
  enforceMimicry: mockEnforceMimicry,
  recordMimicrySuccess: mockRecordMimicrySuccess,
}));

vi.mock("../src/http-client.js", () => ({
  callWahaApi: mockCallWahaApi,
}));

// ── Handler under test ────────────────────────────────────────────────────────
// We test the handler logic directly without spinning up an HTTP server.
// The handler is extracted from monitor.ts as a pure async function.

import { handleProxySend, SEND_TYPE_TO_PATH } from "../src/proxy-send-handler.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

type ResponseCapture = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

function makeReqRes(body: Record<string, unknown>): {
  req: IncomingMessage;
  res: ServerResponse;
  capture: () => ResponseCapture;
} {
  const bodyStr = JSON.stringify(body);
  const ee = new EventEmitter() as any;
  ee.headers = { "content-type": "application/json" };
  ee.url = "/api/admin/proxy-send";
  ee.method = "POST";
  // Simulate readable body
  ee.rawBody = bodyStr;

  let status = 0;
  let responseBody = "";
  const headers: Record<string, string> = {};

  const res = {
    writeHead: vi.fn((s: number, h?: Record<string, string>) => {
      status = s;
      if (h) Object.assign(headers, h);
    }),
    end: vi.fn((data?: string) => {
      if (data) responseBody = data;
    }),
  } as unknown as ServerResponse;

  return {
    req: ee as IncomingMessage,
    res,
    capture: () => ({ status, headers, body: responseBody }),
  };
}

/** Minimal CoreConfig shape for proxy-send handler */
function makeCfg(overrides: Record<string, unknown> = {}): any {
  return {
    channels: {
      waha: {
        apiUrl: "http://127.0.0.1:3004",
        apiKey: "test-key",
        ...overrides,
      },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleProxySend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceMimicry.mockResolvedValue(undefined);
    mockCallWahaApi.mockResolvedValue({ id: "msg123" });
    mockRecordMimicrySuccess.mockReturnValue(undefined);
  });

  // Test 1: Valid body returns 200 + { ok: true, waha: ... }
  it("returns 200 with ok:true and WAHA response on valid send", async () => {
    const body = { chatId: "972544329000@c.us", session: "3cf11776_omer", text: "Hello", type: "text" };
    const result = await handleProxySend({ body, cfg: makeCfg() });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, waha: { id: "msg123" } });
  });

  // Test 2: enforceMimicry throws → 403 + { blocked: true }
  it("returns 403 with blocked:true when enforceMimicry throws", async () => {
    mockEnforceMimicry.mockRejectedValue(new Error("[mimicry] Send blocked: outside send window"));
    const body = { chatId: "972544329000@c.us", session: "3cf11776_omer", text: "Hello", type: "text" };
    const result = await handleProxySend({ body, cfg: makeCfg() });

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ blocked: true });
    expect((result.body as any).error).toContain("[mimicry] Send blocked");
  });

  // Test 3: Missing chatId → 400
  it("returns 400 when chatId is missing", async () => {
    const body = { session: "3cf11776_omer", text: "Hello", type: "text" };
    const result = await handleProxySend({ body, cfg: makeCfg() });

    expect(result.status).toBe(400);
    expect((result.body as any).error).toBe("chatId and session are required");
  });

  // Test 4: Missing session → 400
  it("returns 400 when session is missing", async () => {
    const body = { chatId: "972544329000@c.us", text: "Hello", type: "text" };
    const result = await handleProxySend({ body, cfg: makeCfg() });

    expect(result.status).toBe(400);
    expect((result.body as any).error).toBe("chatId and session are required");
  });

  // Test 5: enforceMimicry called with messageLength = body.text.length (CC-02)
  it("calls enforceMimicry with messageLength equal to body.text.length", async () => {
    const text = "Hello, this is a test message!";
    const body = { chatId: "972544329000@c.us", session: "3cf11776_omer", text, type: "text" };
    await handleProxySend({ body, cfg: makeCfg() });

    expect(mockEnforceMimicry).toHaveBeenCalledOnce();
    const callArgs = mockEnforceMimicry.mock.calls[0][0];
    expect(callArgs.messageLength).toBe(text.length);
  });

  // Test 6: enforceMimicry called with messageLength 0 when body has no text
  it("calls enforceMimicry with messageLength 0 when body has no text field", async () => {
    const body = {
      chatId: "972544329000@c.us",
      session: "3cf11776_omer",
      type: "image",
      image: { url: "https://example.com/photo.jpg" },
    };
    await handleProxySend({ body, cfg: makeCfg() });

    expect(mockEnforceMimicry).toHaveBeenCalledOnce();
    const callArgs = mockEnforceMimicry.mock.calls[0][0];
    expect(callArgs.messageLength).toBe(0);
  });

  // Test 7: recordMimicrySuccess called with session AFTER callWahaApi succeeds
  it("calls recordMimicrySuccess with session after callWahaApi succeeds", async () => {
    const body = { chatId: "972544329000@c.us", session: "3cf11776_omer", text: "Hi", type: "text" };
    await handleProxySend({ body, cfg: makeCfg() });

    expect(mockRecordMimicrySuccess).toHaveBeenCalledOnce();
    expect(mockRecordMimicrySuccess).toHaveBeenCalledWith("3cf11776_omer");
    // Verify ordering: callWahaApi was called before recordMimicrySuccess
    const wahaOrder = mockCallWahaApi.mock.invocationCallOrder[0];
    const recordOrder = mockRecordMimicrySuccess.mock.invocationCallOrder[0];
    expect(recordOrder).toBeGreaterThan(wahaOrder);
  });

  // Test 8: recordMimicrySuccess NOT called when callWahaApi throws
  it("does NOT call recordMimicrySuccess when callWahaApi throws", async () => {
    mockCallWahaApi.mockRejectedValue(new Error("WAHA connection refused"));
    const body = { chatId: "972544329000@c.us", session: "3cf11776_omer", text: "Hi", type: "text" };
    const result = await handleProxySend({ body, cfg: makeCfg() });

    expect(result.status).toBe(502);
    expect(mockRecordMimicrySuccess).not.toHaveBeenCalled();
  });

  // Test 9: body.type maps to correct WAHA path
  it("maps send type to the correct WAHA API path", async () => {
    const cases: Array<{ type: string; expectedPath: string }> = [
      { type: "text", expectedPath: "/api/sendText" },
      { type: "image", expectedPath: "/api/sendImage" },
      { type: "video", expectedPath: "/api/sendVideo" },
      { type: "file", expectedPath: "/api/sendFile" },
    ];

    for (const { type, expectedPath } of cases) {
      vi.clearAllMocks();
      mockEnforceMimicry.mockResolvedValue(undefined);
      mockCallWahaApi.mockResolvedValue({ id: "msg123" });

      const body = { chatId: "972544329000@c.us", session: "3cf11776_omer", text: "Hi", type };
      await handleProxySend({ body, cfg: makeCfg() });

      expect(mockCallWahaApi).toHaveBeenCalledOnce();
      const callArgs = mockCallWahaApi.mock.calls[0][0];
      expect(callArgs.path).toBe(expectedPath);
    }
  });

  // Test 10: callWahaApi failure → 502 + { error: "WAHA API error: ..." }
  it("returns 502 with WAHA API error message when callWahaApi throws", async () => {
    mockCallWahaApi.mockRejectedValue(new Error("connection refused"));
    const body = { chatId: "972544329000@c.us", session: "3cf11776_omer", text: "Hi", type: "text" };
    const result = await handleProxySend({ body, cfg: makeCfg() });

    expect(result.status).toBe(502);
    expect((result.body as any).error).toContain("WAHA API error:");
    expect((result.body as any).error).toContain("connection refused");
  });
});

describe("SEND_TYPE_TO_PATH", () => {
  it("has correct mappings for all supported send types", () => {
    expect(SEND_TYPE_TO_PATH["text"]).toBe("/api/sendText");
    expect(SEND_TYPE_TO_PATH["image"]).toBe("/api/sendImage");
    expect(SEND_TYPE_TO_PATH["video"]).toBe("/api/sendVideo");
    expect(SEND_TYPE_TO_PATH["file"]).toBe("/api/sendFile");
  });
});
