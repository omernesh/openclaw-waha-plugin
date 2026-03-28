// Phase 64-02 (TENANT-01, TENANT-04): Parent gateway — routes API requests and WAHA webhooks
// to the correct workspace child process.
//
// Architecture:
//   - API key (Bearer token) is resolved to a workspaceId via better-auth verifyApiKey.
//   - Resolved keys are cached in an LRU cache (max 500, TTL 60s) to avoid per-request DB hits.
//   - Webhook events are routed by session name prefix (ctl_{hex32}_*) to the owning workspace.
//   - Each workspace runs on a dynamic port managed by WorkspaceProcessManager.
//   - 401 is returned before any proxy attempt when the key is unknown/invalid (TENANT-04).
//   - 503 (with Retry-After) is returned when workspace is crashed/starting.
//
// DO NOT CHANGE: routing order — healthz must come before auth before webhook before api.
//   Changing order could expose auth routes or proxy unauthenticated requests.
// DO NOT CHANGE: 401 vs 503 distinction — 401 = bad key, 503 = key valid but workspace down.
// DO NOT CHANGE: webhook session extraction logic — must use extractWorkspaceIdFromSession.

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { LRUCache } from "lru-cache";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import type { WorkspaceProcessManager } from "./workspace-manager.js";
import { extractWorkspaceIdFromSession } from "./workspace-manager.js";
import { setCorsHeaders, handleCorsPreflightIfNeeded } from "./api-v1-auth.js";
import { createLogger } from "./logger.js";

const log = createLogger({ component: "workspace-gateway" });

// ─── API Key Cache ────────────────────────────────────────────────────────────

// DO NOT CHANGE: LRU cache avoids per-request auth.db queries.
// max=500: handles plenty of concurrent users. TTL=60s: tolerable staleness on key revocation.
const apiKeyCache = new LRUCache<string, string>({
  max: 500,
  ttl: 60_000,
});

// ─── resolveWorkspaceFromKey ──────────────────────────────────────────────────

/**
 * Resolve a Bearer token to a workspaceId via better-auth verifyApiKey.
 * Caches successful resolutions for TTL=60s to avoid per-request DB queries.
 * Returns null if the key is invalid or has no associated workspaceId.
 *
 * DO NOT CHANGE: cache must be checked before calling verifyApiKey — DB call is expensive.
 */
export async function resolveWorkspaceFromKey(bearerToken: string): Promise<string | null> {
  // Cache hit
  const cached = apiKeyCache.get(bearerToken);
  if (cached !== undefined) {
    return cached;
  }

  // Cache miss — call auth
  let result: { valid?: boolean; user?: { workspaceId?: string } | null } | null = null;
  try {
    result = await auth.api.verifyApiKey({ body: { key: bearerToken } }) as typeof result;
  } catch (err) {
    log.warn("verifyApiKey threw", { error: String(err) });
    return null;
  }

  if (!result || !result.valid || !result.user?.workspaceId) {
    return null;
  }

  const workspaceId = result.user.workspaceId;
  apiKeyCache.set(bearerToken, workspaceId);
  return workspaceId;
}

// ─── proxyToWorkspace ─────────────────────────────────────────────────────────

/**
 * HTTP-proxy the incoming request to the child workspace at the given port.
 * Pipes both request body and response body. Returns 502 on connection error.
 *
 * DO NOT CHANGE: uses node:http.request (not fetch) — allows streaming without buffering.
 */
export async function proxyToWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  port: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    const proxyReq = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: req.url ?? "/",
        method: req.method ?? "GET",
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
        proxyRes.on("end", resolve);
      }
    );

    proxyReq.on("error", (err) => {
      log.warn("proxy error — workspace unavailable", { port, error: String(err) });
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Workspace unavailable" }));
      }
      resolve();
    });

    req.pipe(proxyReq, { end: true });
  });
}

// ─── WorkspaceGateway ─────────────────────────────────────────────────────────

export interface WorkspaceGatewayOptions {
  manager: WorkspaceProcessManager;
  port: number;
  host?: string;
}

/**
 * Parent HTTP gateway for multi-tenant mode.
 *
 * Routes:
 *   GET  /healthz          — parent health (no auth, not proxied)
 *   *    /api/auth/*       — delegated to better-auth toNodeHandler (not proxied)
 *   POST /webhook/waha     — routes by session name prefix to child workspace
 *   *    /api/v1/*         — resolves Bearer token → workspaceId → child port → proxy
 *   *    /mcp              — same as /api/v1/* (API key → workspace → proxy)
 *   *    /                 — 404 (admin panel not served in multi-tenant mode)
 *
 * Phase 64-02 (TENANT-01, TENANT-04).
 */
export class WorkspaceGateway {
  private readonly manager: WorkspaceProcessManager;
  private readonly port: number;
  private readonly host: string;
  private readonly server: Server;
  private readonly authHandler: ReturnType<typeof toNodeHandler>;

  constructor(opts: WorkspaceGatewayOptions) {
    this.manager = opts.manager;
    this.port = opts.port;
    this.host = opts.host ?? "0.0.0.0";
    // DO NOT CHANGE: toNodeHandler bridges better-auth Web API to Node.js streams.
    // Handles /api/auth/* (sign-up, sign-in, get-session, API key CRUD).
    this.authHandler = toNodeHandler(auth.handler as Parameters<typeof toNodeHandler>[0]);
    this.server = createServer((req, res) => {
      void this._handleRequest(req, res);
    });
  }

  /**
   * Main request dispatcher.
   *
   * DO NOT CHANGE: routing order — healthz first, then auth, then webhook, then api/v1.
   * If order changes, unauthenticated requests could reach proxy paths.
   */
  private async _handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";

    // 1. /healthz — parent liveness, no auth required
    if (url === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", workspaces: this.manager.listWorkspaces() }));
      return;
    }

    // 2. /api/auth/* — handled by parent (better-auth), not proxied to child
    if (url.startsWith("/api/auth/")) {
      this.authHandler(req, res);
      return;
    }

    // 3. /webhook/waha — route by session name prefix to child workspace
    if (url === "/webhook/waha" || url.startsWith("/webhook/waha?")) {
      await this._handleWebhook(req, res);
      return;
    }

    // 4. CORS preflight for /api/v1/*
    if (handleCorsPreflightIfNeeded(req, res)) {
      return;
    }

    // 5. /api/v1/* and /mcp — resolve API key → workspace → proxy
    if (url.startsWith("/api/v1/") || url === "/mcp" || url.startsWith("/mcp?") || url.startsWith("/mcp/")) {
      await this._handleApiRequest(req, res);
      return;
    }

    // 6. Everything else — 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  /**
   * Handle /api/v1/* and /mcp — resolve Bearer token to workspaceId, proxy to child.
   *
   * DO NOT CHANGE: 401 must be returned before any proxy attempt when key is invalid.
   * DO NOT CHANGE: 503 with Retry-After for crashed workspaces (client can retry).
   */
  private async _handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setCorsHeaders(res);

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Authorization required" }));
      return;
    }

    const bearerToken = authHeader.slice(7);

    // Resolve workspaceId from API key
    const workspaceId = await resolveWorkspaceFromKey(bearerToken);
    if (!workspaceId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid API key" }));
      return;
    }

    // Check workspace status
    const status = this.manager.getStatus(workspaceId);
    if (status === "crashed" || status === "starting") {
      // DO NOT CHANGE: 503 with Retry-After — client knows workspace is temporarily down.
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Retry-After": "30",
      });
      res.end(JSON.stringify({ error: "Workspace unavailable", status }));
      return;
    }

    // Get child port
    const childPort = this.manager.getPort(workspaceId);
    if (!childPort) {
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Retry-After": "30",
      });
      res.end(JSON.stringify({ error: "Workspace not ready" }));
      return;
    }

    await proxyToWorkspace(req, res, childPort);
  }

  /**
   * Handle /webhook/waha — read body, extract session name, route to child workspace.
   *
   * DO NOT CHANGE: webhook session extraction uses extractWorkspaceIdFromSession.
   * DO NOT CHANGE: 404 on unknown session prefix — don't proxy to wrong workspace.
   */
  private async _handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Read body
    let rawBody = "";
    try {
      rawBody = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const MAX_BYTES = 10 * 1024 * 1024; // 10MB
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy();
            reject(new Error("Request body too large"));
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
      });
    } catch (err) {
      log.warn("failed to read webhook body", { error: String(err) });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to read body" }));
      return;
    }

    // Parse JSON and extract session
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const session = typeof parsed.session === "string" ? parsed.session : null;
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No session in webhook body" }));
      return;
    }

    // DO NOT CHANGE: extract workspaceId from session name prefix ctl_{hex32}_{*}
    const workspaceId = extractWorkspaceIdFromSession(session);
    if (!workspaceId) {
      log.debug("webhook session has no workspace prefix, ignoring", { session });
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unknown session prefix" }));
      return;
    }

    const childPort = this.manager.getPort(workspaceId);
    if (!childPort) {
      log.warn("workspace not ready for webhook", { workspaceId, session });
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Workspace not ready" }));
      return;
    }

    // Proxy webhook body to child's /webhook/waha endpoint
    return new Promise<void>((resolve) => {
      const proxyReq = httpRequest(
        {
          hostname: "127.0.0.1",
          port: childPort,
          path: "/webhook/waha",
          method: "POST",
          headers: {
            ...req.headers,
            "content-length": Buffer.byteLength(rawBody).toString(),
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
          proxyRes.on("end", resolve);
        }
      );

      proxyReq.on("error", (err) => {
        log.warn("webhook proxy error", { workspaceId, error: String(err) });
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Workspace unavailable" }));
        }
        resolve();
      });

      proxyReq.write(rawBody);
      proxyReq.end();
    });
  }

  /**
   * Start the gateway HTTP server.
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.server.listen(this.port, this.host, () => {
        log.info("workspace gateway started", { port: this.port, host: this.host });
        resolve();
      });
    });
  }

  /**
   * Stop the gateway HTTP server and all workspace child processes.
   * DO NOT CHANGE: manager.stopAll() must be called to clean up child processes.
   */
  async stop(): Promise<void> {
    await this.manager.stopAll();
    return new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
