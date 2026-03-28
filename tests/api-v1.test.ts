// Phase 60, Plan 01 (API-01, API-04): Tests for /api/v1/ route handlers.
// Mocks all external dependencies (handleProxySend, getDirectoryDb, etc.)
// DO NOT REMOVE — covers all 6 REST API endpoints.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

// ── Module mocks ──────────────────────────────────────────────────────
vi.mock("../src/proxy-send-handler.js", () => ({
  handleProxySend: vi.fn(),
}));
vi.mock("../src/directory.js", () => ({
  getDirectoryDb: vi.fn(),
}));
vi.mock("../src/accounts.js", () => ({
  listEnabledWahaAccounts: vi.fn(),
}));
vi.mock("../src/health.js", () => ({
  getHealthState: vi.fn(),
}));
const mockMimicryDb = {
  getFirstSendAt: vi.fn().mockReturnValue(null),
  countRecentSends: vi.fn().mockReturnValue(0),
};

vi.mock("../src/mimicry-gate.js", () => ({
  getCapStatus: vi.fn(),
  getMimicryDb: vi.fn(() => mockMimicryDb),
  getMaturityPhase: vi.fn().mockReturnValue("new"),
  resolveCapLimit: vi.fn().mockReturnValue(30),
  resolveGateConfig: vi.fn().mockReturnValue({ enabled: false }),
  checkTimeOfDay: vi.fn().mockReturnValue({ allowed: true }),
}));
vi.mock("../src/send.js", () => ({
  getWahaChatMessages: vi.fn(),
}));

import { handleApiV1Request } from "../src/api-v1.js";
import { handleProxySend } from "../src/proxy-send-handler.js";
import { getDirectoryDb } from "../src/directory.js";
import { listEnabledWahaAccounts } from "../src/accounts.js";
import { getHealthState } from "../src/health.js";
import { getCapStatus } from "../src/mimicry-gate.js";
import { getWahaChatMessages } from "../src/send.js";

// ── Test helpers ──────────────────────────────────────────────────────
function makeMockRes() {
  const chunks: string[] = [];
  const headers: Record<string, string | number> = {};
  const res = {
    statusCode: 200,
    writeHead: vi.fn((status: number, hdrs?: Record<string, string>) => {
      res.statusCode = status;
      if (hdrs) Object.assign(headers, hdrs);
    }),
    setHeader: vi.fn((k: string, v: string | number) => { headers[k] = v; }),
    end: vi.fn((data?: string) => { if (data) chunks.push(data); }),
    getBody: () => {
      const raw = chunks.join("");
      return raw ? JSON.parse(raw) : null;
    },
    getHeaders: () => headers,
  } as unknown as ServerResponse & { getBody: () => unknown; getHeaders: () => Record<string, string | number> };
  return res;
}

function makeMockReq(opts: {
  method?: string;
  url?: string;
  body?: unknown;
}): IncomingMessage {
  const bodyStr = opts.body ? JSON.stringify(opts.body) : "";
  let consumed = false;
  const req = {
    method: opts.method ?? "GET",
    url: opts.url ?? "/api/v1/sessions",
    headers: {},
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === "data" && !consumed) {
        consumed = true;
        if (bodyStr) cb(Buffer.from(bodyStr));
      }
      if (event === "end") {
        setTimeout(() => cb(), 0);
      }
    }),
  } as unknown as IncomingMessage;
  return req;
}

const mockConfig = { channels: { waha: {} } };
const mockOpts = { config: mockConfig as unknown as Parameters<typeof handleApiV1Request>[2]["config"] };

// ── Tests ──────────────────────────────────────────────────────────────
describe("api-v1 route handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    (listEnabledWahaAccounts as ReturnType<typeof vi.fn>).mockReturnValue([
      { accountId: "default", session: "logan", tenantId: "default" }
    ]);
    (getHealthState as ReturnType<typeof vi.fn>).mockReturnValue({
      healthy: true,
      consecutiveFailures: 0,
      lastCheckedAt: Date.now(),
    });
    (getDirectoryDb as ReturnType<typeof vi.fn>).mockReturnValue({
      getContacts: vi.fn().mockReturnValue([]),
      getContactCount: vi.fn().mockReturnValue(0),
      getDmCount: vi.fn().mockReturnValue(0),
      getGroupCount: vi.fn().mockReturnValue(0),
      getNewsletterCount: vi.fn().mockReturnValue(0),
    });
  });

  // ── POST /api/v1/send ──────────────────────────────────────────────
  describe("POST /api/v1/send", () => {
    it("calls handleProxySend and returns result on valid body", async () => {
      (handleProxySend as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 200,
        body: { ok: true, waha: { id: "msg_123" } },
      });
      const req = makeMockReq({
        method: "POST",
        url: "/api/v1/send",
        body: { chatId: "120363@g.us", session: "logan", text: "hello" },
      });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      expect(handleProxySend).toHaveBeenCalled();
      const body = (res as ReturnType<typeof makeMockRes>).getBody();
      expect(body.ok).toBe(true);
    });

    it("returns 400 on invalid JSON body", async () => {
      const req = {
        method: "POST",
        url: "/api/v1/send",
        headers: {},
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (event === "data") cb(Buffer.from("{ invalid json "));
          if (event === "end") setTimeout(() => cb(), 0);
        }),
      } as unknown as IncomingMessage;
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      expect(res.statusCode).toBe(400);
      const body = (res as ReturnType<typeof makeMockRes>).getBody();
      expect(body.error).toBeTruthy();
    });
  });

  // ── GET /api/v1/messages ──────────────────────────────────────────
  describe("GET /api/v1/messages", () => {
    it("returns messages array on valid chatId and session", async () => {
      (getWahaChatMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "m1", body: "hello" }
      ]);
      const req = makeMockReq({
        url: "/api/v1/messages?chatId=120363@g.us&session=logan",
      });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      const body = (res as ReturnType<typeof makeMockRes>).getBody();
      expect(body).toEqual([{ id: "m1", body: "hello" }]);
    });

    it("returns 400 when chatId is missing", async () => {
      const req = makeMockReq({ url: "/api/v1/messages?session=logan" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      expect(res.statusCode).toBe(400);
      const body = (res as ReturnType<typeof makeMockRes>).getBody();
      expect(body.error).toContain("chatId");
    });

    it("returns 400 when session is missing", async () => {
      const req = makeMockReq({ url: "/api/v1/messages?chatId=120363@g.us" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /api/v1/search ───────────────────────────────────────────
  describe("GET /api/v1/search", () => {
    it("returns contacts and groups from directory", async () => {
      const mockDb = {
        getContacts: vi.fn().mockReturnValue([
          { jid: "123@c.us", displayName: "Alice" }
        ]),
        getContactCount: vi.fn().mockReturnValue(1),
        getDmCount: vi.fn().mockReturnValue(0),
        getGroupCount: vi.fn().mockReturnValue(0),
        getNewsletterCount: vi.fn().mockReturnValue(0),
      };
      (getDirectoryDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
      const req = makeMockReq({ url: "/api/v1/search?q=alice" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      const body = (res as ReturnType<typeof makeMockRes>).getBody();
      expect(body).toHaveProperty("contacts");
      expect(body).toHaveProperty("groups");
    });

    it("returns 400 when q param is missing", async () => {
      const req = makeMockReq({ url: "/api/v1/search" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /api/v1/directory ────────────────────────────────────────
  describe("GET /api/v1/directory", () => {
    it("returns paginated contacts listing", async () => {
      const mockDb = {
        getContacts: vi.fn().mockReturnValue([]),
        getContactCount: vi.fn().mockReturnValue(0),
        getDmCount: vi.fn().mockReturnValue(5),
        getGroupCount: vi.fn().mockReturnValue(2),
        getNewsletterCount: vi.fn().mockReturnValue(1),
      };
      (getDirectoryDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
      const req = makeMockReq({ url: "/api/v1/directory" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      const body = (res as ReturnType<typeof makeMockRes>).getBody();
      expect(body).toHaveProperty("contacts");
      expect(body).toHaveProperty("total");
    });

    it("passes type, search, limit, offset to getContacts", async () => {
      const mockDb = {
        getContacts: vi.fn().mockReturnValue([]),
        getContactCount: vi.fn().mockReturnValue(0),
        getDmCount: vi.fn().mockReturnValue(0),
        getGroupCount: vi.fn().mockReturnValue(0),
        getNewsletterCount: vi.fn().mockReturnValue(0),
      };
      (getDirectoryDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
      const req = makeMockReq({ url: "/api/v1/directory?type=contact&search=alice&limit=10&offset=20" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      expect(mockDb.getContacts).toHaveBeenCalledWith(
        expect.objectContaining({ type: "contact", search: "alice", limit: 10, offset: 20 })
      );
    });
  });

  // ── GET /api/v1/sessions ─────────────────────────────────────────
  describe("GET /api/v1/sessions", () => {
    it("returns session array with health status", async () => {
      (listEnabledWahaAccounts as ReturnType<typeof vi.fn>).mockReturnValue([
        { accountId: "default", session: "logan", tenantId: "default" }
      ]);
      (getHealthState as ReturnType<typeof vi.fn>).mockReturnValue({
        status: "healthy",
        consecutiveFailures: 0,
        lastCheckAt: 1711574400000,
        lastSuccessAt: 1711574400000,
        webhook_registered: true,
      });
      const req = makeMockReq({ url: "/api/v1/sessions" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      const body = (res as ReturnType<typeof makeMockRes>).getBody();
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toHaveProperty("session", "logan");
      expect(body[0]).toHaveProperty("healthy", true);
    });
  });

  // ── GET /api/v1/mimicry ──────────────────────────────────────────
  describe("GET /api/v1/mimicry", () => {
    it("returns mimicry cap status array (read-only)", async () => {
      (listEnabledWahaAccounts as ReturnType<typeof vi.fn>).mockReturnValue([
        { accountId: "default", session: "logan", tenantId: "default" }
      ]);
      (getCapStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        count: 5,
        limit: 30,
        remaining: 25,
        maturity: "new",
        windowStartMs: Date.now() - 3600000,
      });
      const req = makeMockReq({ url: "/api/v1/mimicry" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      const body = (res as ReturnType<typeof makeMockRes>).getBody();
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toHaveProperty("count");
      expect(body[0]).toHaveProperty("remaining");
      // Must never call checkAndConsumeCap — only getCapStatus
      expect(getCapStatus).toHaveBeenCalled();
    });
  });

  // ── CORS headers on all responses ────────────────────────────────
  describe("CORS headers", () => {
    it("includes Access-Control-Allow-Origin on sessions response", async () => {
      const req = makeMockReq({ url: "/api/v1/sessions" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      const headers = (res as ReturnType<typeof makeMockRes>).getHeaders();
      expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    });

    it("includes Access-Control-Allow-Origin on directory response", async () => {
      const req = makeMockReq({ url: "/api/v1/directory" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      const headers = (res as ReturnType<typeof makeMockRes>).getHeaders();
      expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    });
  });

  // ── Unknown route ─────────────────────────────────────────────────
  describe("unknown route", () => {
    it("returns 404 with error message for unknown /api/v1/ path", async () => {
      const req = makeMockReq({ url: "/api/v1/unknown-endpoint" });
      const res = makeMockRes();
      await handleApiV1Request(req, res, mockOpts);
      expect(res.statusCode).toBe(404);
      const body = (res as ReturnType<typeof makeMockRes>).getBody();
      expect(body.error).toBeTruthy();
    });
  });
});
