// Phase 64-02 (TENANT-01, TENANT-04): Unit tests for WorkspaceGateway.
// Tests: API key routing, webhook routing, 401 on unknown key, 503 on crashed workspace.
// Uses mock WorkspaceProcessManager and mock auth.api.verifyApiKey.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

// ─── Module mocks ────────────────────────────────────────────────────────────

// Mock auth module — must be hoisted
vi.mock("./auth.js", () => ({
  auth: {
    api: {
      verifyApiKey: vi.fn(),
    },
    handler: vi.fn(),
  },
  initAuthDb: vi.fn().mockResolvedValue(undefined),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { WorkspaceGateway, resolveWorkspaceFromKey } from "./workspace-gateway.js";
import { auth } from "./auth.js";

// ─── Mock WorkspaceProcessManager ─────────────────────────────────────────────

function makeMockManager(overrides: {
  getPort?: (id: string) => number | null;
  getStatus?: (id: string) => "starting" | "ready" | "crashed" | null;
  listWorkspaces?: () => Array<{ workspaceId: string; status: string; port: number | null }>;
  stopAll?: () => Promise<void>;
} = {}) {
  return {
    getPort: vi.fn(overrides.getPort ?? ((_id: string) => 9000)),
    getStatus: vi.fn(overrides.getStatus ?? ((_id: string) => "ready" as const)),
    listWorkspaces: vi.fn(overrides.listWorkspaces ?? (() => [])),
    stopAll: vi.fn(overrides.stopAll ?? (() => Promise.resolve())),
  };
}

// ─── HTTP helper: make a raw Node.js HTTP request to a running server ──────────

function makeRequest(opts: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: opts.port,
        path: opts.path,
        method: opts.method ?? "GET",
        headers: opts.headers ?? {},
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      }
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ─── resolveWorkspaceFromKey tests ────────────────────────────────────────────

describe("resolveWorkspaceFromKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns workspaceId when verifyApiKey reports valid", async () => {
    vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
      valid: true,
      user: { workspaceId: "ws-uuid-001" },
    } as never);

    const result = await resolveWorkspaceFromKey("ctl_validkey");
    expect(result).toBe("ws-uuid-001");
  });

  it("returns null when verifyApiKey reports invalid", async () => {
    vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
      valid: false,
      user: null,
    } as never);

    const result = await resolveWorkspaceFromKey("ctl_invalidkey");
    expect(result).toBeNull();
  });

  it("returns null when verifyApiKey returns null result", async () => {
    vi.mocked(auth.api.verifyApiKey).mockResolvedValue(null as never);

    const result = await resolveWorkspaceFromKey("ctl_nullresult");
    expect(result).toBeNull();
  });

  it("caches result — second call does not re-query auth", async () => {
    vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
      valid: true,
      user: { workspaceId: "ws-uuid-cached" },
    } as never);

    const key = "ctl_cachekey_" + Date.now(); // unique key per test run
    const r1 = await resolveWorkspaceFromKey(key);
    const r2 = await resolveWorkspaceFromKey(key);

    expect(r1).toBe("ws-uuid-cached");
    expect(r2).toBe("ws-uuid-cached");
    // Should only have called verifyApiKey once (cached on second call)
    expect(auth.api.verifyApiKey).toHaveBeenCalledTimes(1);
  });
});

// ─── WorkspaceGateway HTTP routing tests ──────────────────────────────────────

describe("WorkspaceGateway HTTP routing", () => {
  let gateway: WorkspaceGateway;
  let port: number;
  let manager: ReturnType<typeof makeMockManager>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Use a random port in the ephemeral range to avoid conflicts
    port = 47000 + Math.floor(Math.random() * 1000);
    manager = makeMockManager({
      getPort: (id) => id === "ws-a" ? 19001 : id === "ws-b" ? 19002 : null,
      getStatus: (id) => (id === "ws-a" || id === "ws-b") ? "ready" : null,
    });

    gateway = new WorkspaceGateway({
      manager: manager as never,
      port,
      host: "127.0.0.1",
    });

    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
  });

  // ── /healthz ──────────────────────────────────────────────────────────────

  it("GET /healthz returns 200 with workspace list (no auth required)", async () => {
    manager.listWorkspaces.mockReturnValue([
      { workspaceId: "ws-a", status: "ready", port: 19001 },
    ]);

    const res = await makeRequest({ port, path: "/healthz" });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
    expect(Array.isArray(body.workspaces)).toBe(true);
  });

  // ── /api/v1/* — API key auth ──────────────────────────────────────────────

  it("returns 401 for /api/v1/* with no Authorization header", async () => {
    const res = await makeRequest({ port, path: "/api/v1/sessions" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for /api/v1/* with invalid Bearer token", async () => {
    vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
      valid: false,
      user: null,
    } as never);

    const res = await makeRequest({
      port,
      path: "/api/v1/sessions",
      headers: { Authorization: "Bearer ctl_invalid" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 503 when workspace status is crashed", async () => {
    vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
      valid: true,
      user: { workspaceId: "ws-crashed" },
    } as never);

    manager.getStatus.mockImplementation((id: string) =>
      id === "ws-crashed" ? "crashed" : null
    );

    const key = "ctl_crashedkey_" + Date.now();
    const res = await makeRequest({
      port,
      path: "/api/v1/sessions",
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  // ── /webhook/waha routing ─────────────────────────────────────────────────

  it("returns 404 for /webhook/waha with unknown session prefix", async () => {
    const body = JSON.stringify({ session: "unknown_session", event: "message" });
    const res = await makeRequest({
      port,
      path: "/webhook/waha",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
      body,
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for /webhook/waha when session has no registered workspace port", async () => {
    manager.getPort.mockReturnValue(null);

    const body = JSON.stringify({ session: "ctl_550e8400e29b41d4a716446655440000_logan", event: "message" });
    const res = await makeRequest({
      port,
      path: "/webhook/waha",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
      body,
    });
    expect(res.status).toBe(404);
  });

  // ── Unmatched routes ──────────────────────────────────────────────────────

  it("returns 404 for completely unknown routes", async () => {
    const res = await makeRequest({ port, path: "/unknown/route/xyz" });
    expect(res.status).toBe(404);
  });
});
