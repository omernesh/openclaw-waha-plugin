/**
 * Tests for monitor.ts — admin API routes and utility functions.
 *
 * Strategy: createWahaWebhookServer registers an HTTP request handler on a node:http Server.
 * We create the server (without starting it on a port) and emit 'request' events with mock
 * IncomingMessage / ServerResponse objects to test each route.
 *
 * readBody is injected via opts.readBody so we can control request bodies without I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

// ── Module mocks (must be before imports of the module under test) ─────────

vi.mock("./send.js", () => ({
  getWahaContacts: vi.fn().mockResolvedValue([]),
  getWahaGroupParticipants: vi.fn().mockResolvedValue([]),
  getAllWahaPresence: vi.fn().mockResolvedValue({}),
  toArr: vi.fn().mockReturnValue([]),
  findWahaPhoneByLid: vi.fn().mockResolvedValue(null),
  getWahaContact: vi.fn().mockResolvedValue(null),
}));

vi.mock("./directory.js", () => ({
  getDirectoryDb: vi.fn().mockReturnValue({
    getContacts: vi.fn().mockReturnValue([]),
    getContactCount: vi.fn().mockReturnValue(0),
    getDmCount: vi.fn().mockReturnValue(0),
    getGroupCount: vi.fn().mockReturnValue(0),
    getNewsletterCount: vi.fn().mockReturnValue(0),
    getContact: vi.fn().mockReturnValue(null),
    getContactTtl: vi.fn().mockReturnValue(null),
    getDmSettings: vi.fn().mockReturnValue(null),
    setContactDmSettings: vi.fn(),
    setParticipantAllowInGroup: vi.fn(),
    setParticipantAllowDm: vi.fn(),
    setGroupFilterOverride: vi.fn(),
    getGroupFilterOverride: vi.fn().mockReturnValue(null),
    getGroupParticipants: vi.fn().mockReturnValue([]),
    bulkUpsertGroupParticipants: vi.fn(),
    upsertContact: vi.fn(),
    upsertLidMapping: vi.fn(),
    resolveLidToCus: vi.fn().mockReturnValue(null),
    resolveJids: vi.fn().mockReturnValue(new Map()),
    getModuleAssignments: vi.fn().mockReturnValue([]),
    isGroupMuted: vi.fn().mockReturnValue(false),
    setParticipantRole: vi.fn().mockReturnValue(true),
    getGroupAllowAllStatus: vi.fn().mockReturnValue(false),
    revokePairingGrant: vi.fn(),
    setGroupAllowAllStatus: vi.fn(),
    updateParticipantDisplayName: vi.fn(),
  }),
}));

vi.mock("./accounts.js", () => ({
  resolveWahaAccount: vi.fn().mockReturnValue({
    accountId: "default",
    enabled: true,
    baseUrl: "http://localhost:3004",
    apiKey: "test-api-key",
    session: "test-session",
    role: "bot",
    subRole: "full-access",
    config: {
      baseUrl: "http://localhost:3004",
      session: "test-session",
      webhookPort: 8050,
      dmFilter: {},
      groupFilter: {},
      allowFrom: [],
      groupAllowFrom: [],
      allowedGroups: [],
    },
  }),
  listEnabledWahaAccounts: vi.fn().mockReturnValue([
    {
      accountId: "default",
      session: "test-session",
      name: "Test Session",
      role: "bot",
      subRole: "full-access",
      apiKey: "test-api-key",
      config: {
        baseUrl: "http://localhost:3004",
        session: "test-session",
      },
    },
  ]),
  resolveDefaultWahaAccountId: vi.fn().mockReturnValue("default"),
}));

vi.mock("./inbound.js", () => ({
  getDmFilterForAdmin: vi.fn().mockReturnValue({ stats: { dropped: 0, allowed: 0, tokensEstimatedSaved: 0 }, recentEvents: [] }),
  getGroupFilterForAdmin: vi.fn().mockReturnValue({ stats: { dropped: 0, allowed: 0, tokensEstimatedSaved: 0 }, recentEvents: [] }),
  handleWahaInbound: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./health.js", () => ({
  startHealthCheck: vi.fn().mockReturnValue({ status: "unknown", consecutiveFailures: 0, lastSuccessAt: null, lastCheckAt: null }),
  getHealthState: vi.fn().mockReturnValue({ status: "healthy", consecutiveFailures: 0, lastSuccessAt: Date.now(), lastCheckAt: Date.now() }),
  getRecoveryState: vi.fn().mockReturnValue(null),
  getRecoveryHistory: vi.fn().mockReturnValue([]),
  setHealthStateChangeCallback: vi.fn(),
}));

vi.mock("./analytics.js", () => ({
  getAnalyticsDb: vi.fn().mockReturnValue({
    query: vi.fn().mockReturnValue([]),
    getSummary: vi.fn().mockReturnValue({ total: 0, dm: 0, group: 0 }),
    getTopChats: vi.fn().mockReturnValue([]),
    recordEvent: vi.fn(),
  }),
  recordAnalyticsEvent: vi.fn(),
}));

vi.mock("./inbound-queue.js", () => {
  class InboundQueue {
    enqueue = vi.fn();
    getStats = vi.fn().mockReturnValue({ dmDepth: 0, groupDepth: 0, dmCapacity: 50, groupCapacity: 100 });
    constructor() {}
  }
  return {
    InboundQueue,
    setQueueChangeCallback: vi.fn(),
  };
});

vi.mock("./pairing.js", () => ({
  getPairingEngine: vi.fn().mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("./module-registry.js", () => ({
  getModuleRegistry: vi.fn().mockReturnValue({
    listModules: vi.fn().mockReturnValue([]),
    enableModule: vi.fn(),
    disableModule: vi.fn(),
    getModuleAssignments: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock("./sync.js", () => ({
  getSyncState: vi.fn().mockReturnValue(null),
  triggerImmediateSync: vi.fn(),
}));

vi.mock("./signature.js", () => ({
  verifyWahaWebhookHmac: vi.fn().mockReturnValue(true),
}));

vi.mock("./secret-input.js", () => ({
  normalizeResolvedSecretInputString: vi.fn().mockReturnValue(null),
}));

vi.mock("./dedup.js", () => ({
  isDuplicate: vi.fn().mockReturnValue(false),
}));

vi.mock("./config-schema.js", () => ({
  validateWahaConfig: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock("./config-io.js", () => ({
  getConfigPath: vi.fn().mockReturnValue("/mock/openclaw.json"),
  readConfig: vi.fn().mockResolvedValue({
    channels: {
      waha: {
        session: "test-session",
        baseUrl: "http://localhost:3004",
        dmFilter: { enabled: false },
        groupFilter: { enabled: false },
      },
    },
  }),
  writeConfig: vi.fn().mockResolvedValue(undefined),
  modifyConfig: vi.fn().mockResolvedValue(undefined),
  withConfigMutex: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
}));

const { mockReadRequestBodyWithLimit } = vi.hoisted(() => ({
  mockReadRequestBodyWithLimit: vi.fn().mockResolvedValue(""),
}));

// Phase 58: SDK mocks replaced with local module mocks. DO NOT REMOVE.
vi.mock("./request-utils.js", () => ({
  isRequestBodyLimitError: vi.fn().mockReturnValue(false),
  readRequestBodyWithLimit: mockReadRequestBodyWithLimit,
  requestBodyErrorToText: vi.fn().mockReturnValue("error"),
  RequestBodyLimitError: class RequestBodyLimitError extends Error {
    constructor(type: "size" | "timeout") { super(type); this.name = "RequestBodyLimitError"; }
  },
}));

vi.mock("./platform-types.js", async () => {
  const actual = await vi.importActual<typeof import("./platform-types.js")>("./platform-types.js");
  return { ...actual };
});

vi.mock("./account-utils.js", async () => {
  const actual = await vi.importActual<typeof import("./account-utils.js")>("./account-utils.js");
  return { ...actual };
});

// ── fs mocks (config file I/O) ──────────────────────────────────────────────
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({
      channels: {
        waha: {
          session: "test-session",
          baseUrl: "http://localhost:3004",
          dmFilter: { enabled: false },
          groupFilter: { enabled: false },
        },
      },
    })),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    copyFileSync: vi.fn(),
    renameSync: vi.fn(),
  };
});

// ── Import module under test AFTER all mocks ───────────────────────────────
import { createWahaWebhookServer, broadcastSSE, readWahaWebhookBody } from "./monitor.js";

// ── Test helpers ────────────────────────────────────────────────────────────

function makeMinimalConfig() {
  return {
    channels: {
      waha: {
        session: "test-session",
        baseUrl: "http://localhost:3004",
        dmFilter: { enabled: false },
        groupFilter: { enabled: false },
        allowFrom: [],
        groupAllowFrom: [],
        allowedGroups: [],
        dmPolicy: "allowlist",
        groupPolicy: "allowlist",
      },
    },
  };
}

function makeRuntime() {
  return { log: vi.fn() };
}

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  headersSent: boolean;
}

function makeReq(overrides: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.url = overrides.url ?? "/";
  emitter.method = overrides.method ?? "GET";
  emitter.headers = overrides.headers ?? {};
  (emitter as any).socket = { remoteAddress: "127.0.0.1" };
  (emitter as any).destroy = vi.fn();
  return emitter;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    body: "",
    headersSent: false,
    writeHead: vi.fn().mockImplementation(function (this: MockRes, code: number, hdrs?: Record<string, string>) {
      res.statusCode = code;
      if (hdrs) Object.assign(res.headers, hdrs);
      res.headersSent = true;
    }),
    end: vi.fn().mockImplementation(function (this: MockRes, data?: string | Buffer) {
      if (data) res.body += typeof data === "string" ? data : data.toString();
    }),
    setHeader: vi.fn().mockImplementation(function (this: MockRes, name: string, value: string) {
      res.headers[name] = value;
    }),
    write: vi.fn(),
    on: vi.fn(),
  };
  return res;
}

function makeServer(bodyFn?: (req: IncomingMessage) => Promise<string>) {
  const cfg = makeMinimalConfig();
  const runtime = makeRuntime();
  const readBody = bodyFn ?? (async () => "{}");

  return createWahaWebhookServer({
    accountId: "default",
    config: cfg as never,
    runtime: runtime as never,
    readBody,
  });
}

async function callRoute(
  server: ReturnType<typeof createWahaWebhookServer>["server"],
  req: IncomingMessage,
  res: MockRes,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`callRoute timed out after ${timeoutMs}ms`)), timeoutMs);

    // Resolve when res.end() is called
    const origEnd = res.end;
    res.end = vi.fn().mockImplementation((...args: Parameters<typeof origEnd>) => {
      origEnd(...args as Parameters<typeof origEnd>);
      clearTimeout(timer);
      resolve();
    });

    server.emit("request", req, res as unknown as ServerResponse);
  });
}

// ── readWahaWebhookBody tests ────────────────────────────────────────────────

describe("readWahaWebhookBody", () => {
  it("delegates to readRequestBodyWithLimit with correct maxBytes", async () => {
    mockReadRequestBodyWithLimit.mockReset();
    mockReadRequestBodyWithLimit.mockResolvedValueOnce("hello");

    const req = makeReq({});
    const result = await readWahaWebhookBody(req, 512);

    expect(mockReadRequestBodyWithLimit).toHaveBeenCalledWith(req, expect.objectContaining({ maxBytes: 512 }));
    expect(result).toBe("hello");
  });
});

// ── broadcastSSE tests ───────────────────────────────────────────────────────

describe("broadcastSSE", () => {
  it("is a callable function with no clients — no-op", () => {
    // With zero SSE clients, broadcastSSE should not throw
    expect(() => broadcastSSE("health", { status: "healthy" })).not.toThrow();
  });
});

// ── Admin API route tests ────────────────────────────────────────────────────

describe("admin API routes", () => {
  let serverCtx: ReturnType<typeof makeServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    serverCtx = makeServer();
  });

  afterEach(() => {
    serverCtx.server.removeAllListeners();
  });

  describe("GET /healthz", () => {
    it("returns 200 ok", async () => {
      const req = makeReq({ url: "/healthz", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("ok");
    });
  });

  describe("GET /api/admin/health", () => {
    it("returns JSON with session health state", async () => {
      const req = makeReq({ url: "/api/admin/health", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed).toHaveProperty("session");
      expect(parsed).toHaveProperty("status");
    });
  });

  describe("GET /api/admin/queue", () => {
    it("returns queue stats", async () => {
      const req = makeReq({ url: "/api/admin/queue", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed).toHaveProperty("dmDepth");
      expect(parsed).toHaveProperty("groupDepth");
    });
  });

  describe("GET /api/admin/recovery", () => {
    it("returns recovery state per session", async () => {
      const req = makeReq({ url: "/api/admin/recovery", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed).toHaveProperty("sessions");
      expect(Array.isArray(parsed.sessions)).toBe(true);
    });
  });

  describe("GET /api/admin/config", () => {
    it("returns waha config section", async () => {
      const req = makeReq({ url: "/api/admin/config", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed).toHaveProperty("waha");
    });
  });

  describe("POST /api/admin/config", () => {
    it("accepts valid config and returns 200 ok", async () => {
      const bodyStr = JSON.stringify({ waha: { dmFilter: { enabled: true } } });
      const srv = makeServer(async () => bodyStr);
      const req = makeReq({ url: "/api/admin/config", method: "POST" });
      const res = makeRes();
      await callRoute(srv.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.ok).toBe(true);
      srv.server.removeAllListeners();
    });

    it("returns 400 when validateWahaConfig fails", async () => {
      const { validateWahaConfig } = await import("./config-schema.js");
      (validateWahaConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        valid: false,
        errors: [{ path: ["dmFilter", "enabled"], message: "Expected boolean" }],
      });
      const bodyStr = JSON.stringify({ waha: { dmFilter: { enabled: "bad" } } });
      const srv = makeServer(async () => bodyStr);
      const req = makeReq({ url: "/api/admin/config", method: "POST" });
      const res = makeRes();
      await callRoute(srv.server, req, res);
      expect(res.statusCode).toBe(400);
      const parsed = JSON.parse(res.body);
      expect(parsed.error).toBe("validation_failed");
      expect(Array.isArray(parsed.fields)).toBe(true);
      srv.server.removeAllListeners();
    });
  });

  describe("GET /api/admin/sessions", () => {
    it("returns array of session objects", async () => {
      // Mock global fetch for WAHA sessions endpoint
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ name: "test-session", status: "WORKING" }],
      });

      const req = makeReq({ url: "/api/admin/sessions", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(Array.isArray(parsed)).toBe(true);
      if (parsed.length > 0) {
        expect(parsed[0]).toHaveProperty("sessionId");
        expect(parsed[0]).toHaveProperty("role");
      }

      global.fetch = origFetch;
    });
  });

  describe("GET /api/admin/directory", () => {
    it("returns paginated directory listing with contacts array", async () => {
      const req = makeReq({ url: "/api/admin/directory", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed).toHaveProperty("contacts");
      expect(parsed).toHaveProperty("total");
      expect(Array.isArray(parsed.contacts)).toBe(true);
    });

    it("accepts type= query param", async () => {
      const req = makeReq({ url: "/api/admin/directory?type=contact", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed).toHaveProperty("contacts");
    });
  });

  describe("GET /api/admin/directory/:jid", () => {
    it("returns 404 when contact not found", async () => {
      const req = makeReq({ url: "/api/admin/directory/972000000000%40c.us", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(404);
    });

    it("returns contact when found in DB", async () => {
      const { getDirectoryDb } = await import("./directory.js");
      const mockDb = (getDirectoryDb as ReturnType<typeof vi.fn>)();
      mockDb.getContact.mockReturnValueOnce({ jid: "972000000000@c.us", displayName: "Alice", type: "contact" });

      const req = makeReq({ url: "/api/admin/directory/972000000000%40c.us", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.displayName).toBe("Alice");
    });
  });

  describe("PUT /api/admin/directory/:jid/settings", () => {
    it("saves DM settings and returns ok", async () => {
      const { getDirectoryDb } = await import("./directory.js");
      const mockDb = (getDirectoryDb as ReturnType<typeof vi.fn>)();
      mockDb.getContact.mockReturnValueOnce({ jid: "972000000000@c.us", displayName: "Alice", type: "contact" });

      const bodyStr = JSON.stringify({ mode: "active", mentionOnly: false });
      const srv = makeServer(async () => bodyStr);
      const req = makeReq({ url: "/api/admin/directory/972000000000%40c.us/settings", method: "PUT" });
      const res = makeRes();
      await callRoute(srv.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.ok).toBe(true);
      srv.server.removeAllListeners();
    });
  });

  describe("GET /api/admin/analytics", () => {
    it("returns analytics data with timeseries and summary", async () => {
      const req = makeReq({ url: "/api/admin/analytics?range=24h", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed).toHaveProperty("timeseries");
      expect(parsed).toHaveProperty("summary");
      expect(parsed).toHaveProperty("range");
    });
  });

  describe("POST /api/admin/restart", () => {
    it("returns 200 ok (exit is deferred)", async () => {
      // Patch process.exit to prevent test runner from exiting
      const origExit = process.exit;
      process.exit = vi.fn() as never;

      const req = makeReq({ url: "/api/admin/restart", method: "POST" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.ok).toBe(true);

      process.exit = origExit;
    });
  });

  describe("GET /api/admin/modules", () => {
    it("returns empty modules array", async () => {
      const req = makeReq({ url: "/api/admin/modules", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed).toHaveProperty("modules");
      expect(Array.isArray(parsed.modules)).toBe(true);
    });
  });

  describe("GET /api/admin/stats", () => {
    it("returns stats with dmFilter, groupFilter, sessions", async () => {
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
      });

      const req = makeReq({ url: "/api/admin/stats", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed).toHaveProperty("dmFilter");
      expect(parsed).toHaveProperty("groupFilter");
      expect(parsed).toHaveProperty("sessions");

      global.fetch = origFetch;
    });
  });

  describe("GET /api/admin/directory/group/:groupJid/participants", () => {
    it("returns participants array for a group", async () => {
      const req = makeReq({ url: "/api/admin/directory/group/120363421825201386%40g.us/participants", method: "GET" });
      const res = makeRes();
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({ ok: false });
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed).toHaveProperty("participants");
      expect(Array.isArray(parsed.participants)).toBe(true);
      global.fetch = origFetch;
    });
  });

  describe("POST /api/admin/config/import", () => {
    it("returns 200 ok for valid config", async () => {
      const importedConfig = {
        channels: {
          waha: {
            session: "test-session",
            baseUrl: "http://localhost:3004",
          },
        },
      };
      const srv = makeServer(async () => JSON.stringify(importedConfig));
      const req = makeReq({ url: "/api/admin/config/import", method: "POST" });
      const res = makeRes();
      await callRoute(srv.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.ok).toBe(true);
      srv.server.removeAllListeners();
    });
  });

  describe("catch-all 404", () => {
    it("returns 404 for unknown routes", async () => {
      const req = makeReq({ url: "/api/admin/unknown-route-that-does-not-exist", method: "GET" });
      const res = makeRes();
      await callRoute(serverCtx.server, req, res);
      expect(res.statusCode).toBe(404);
    });
  });

  describe("webhook POST processing", () => {
    it("returns 200 queued for valid message event", async () => {
      const payload = {
        event: "message",
        session: "test-session",
        payload: {
          id: "msg-001",
          from: "972000000001@c.us",
          body: "hello bot",
          timestamp: Math.floor(Date.now() / 1000),
          fromMe: false,
          hasMedia: false,
        },
      };
      const srv = makeServer(async () => JSON.stringify(payload));
      const req = makeReq({ url: "/webhook/waha", method: "POST" });
      const res = makeRes();
      await callRoute(srv.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.status).toBe("queued");
      srv.server.removeAllListeners();
    });

    it("ignores message from unregistered session", async () => {
      const payload = {
        event: "message",
        session: "unknown-session",
        payload: {
          id: "msg-002",
          from: "972000000001@c.us",
          body: "hello",
          timestamp: Math.floor(Date.now() / 1000),
          fromMe: false,
          hasMedia: false,
        },
      };
      const srv = makeServer(async () => JSON.stringify(payload));
      const req = makeReq({ url: "/webhook/waha", method: "POST" });
      const res = makeRes();
      await callRoute(srv.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.status).toBe("ignored");
      srv.server.removeAllListeners();
    });

    it("skips fromMe messages without trigger word", async () => {
      const payload = {
        event: "message.any",
        session: "test-session",
        payload: {
          id: "msg-003",
          from: "972000000001@c.us",
          body: "not a trigger",
          timestamp: Math.floor(Date.now() / 1000),
          fromMe: true,
          hasMedia: false,
        },
      };
      const srv = makeServer(async () => JSON.stringify(payload));
      const req = makeReq({ url: "/webhook/waha", method: "POST" });
      const res = makeRes();
      await callRoute(srv.server, req, res);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.status).toBe("ignored");
      srv.server.removeAllListeners();
    });
  });
});
