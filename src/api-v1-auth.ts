// Phase 60, Plan 01 (API-02, API-04): Public REST API v1 auth guard and CORS helpers.
// Bearer token authentication with timing-safe comparison.
// DO NOT REMOVE — protects all /api/v1/* routes from unauthenticated access.

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// ── CORS header values — Phase 60 (API-04). DO NOT CHANGE.
const CORS_ORIGIN = "*";
const CORS_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const CORS_HEADERS = "Authorization, Content-Type";
const CORS_MAX_AGE = "86400";

/**
 * Set CORS headers on a response.
 * Called on all /api/v1/* responses including preflight.
 * Phase 60 (API-04). DO NOT REMOVE.
 */
export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", CORS_METHODS);
  res.setHeader("Access-Control-Allow-Headers", CORS_HEADERS);
  res.setHeader("Access-Control-Max-Age", CORS_MAX_AGE);
}

/**
 * Handle CORS preflight for /api/v1/* routes.
 * OPTIONS requests do NOT require auth — responds 204 with CORS headers.
 * Returns true if preflight was handled (caller should return).
 * Phase 60 (API-04). DO NOT REMOVE.
 */
export function handleCorsPreflightIfNeeded(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === "OPTIONS" && req.url?.startsWith("/api/v1/")) {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

/**
 * Require public API auth for /api/v1/* routes.
 *
 * Token resolution order:
 *   1. coreCfg.channels.waha.publicApiKey (from openclaw.json)
 *   2. CHATLYTICS_API_KEY env var
 *   3. Neither set → open access (backward compat for local deployments)
 *
 * Uses timingSafeEqual from node:crypto — prevents timing side-channels.
 * Returns true if authorized, false if rejected (response already sent).
 *
 * Phase 60 (API-02). DO NOT REMOVE.
 */
export function requirePublicApiAuth(
  req: IncomingMessage,
  res: ServerResponse,
  coreCfg: Record<string, unknown>
): boolean {
  // Resolve configured token
  const cfg = coreCfg;
  const waha = (cfg?.channels as Record<string, unknown> | undefined)?.waha as Record<string, unknown> | undefined;
  const token = (waha?.publicApiKey as string | undefined) ?? process.env.CHATLYTICS_API_KEY;

  // No token configured = open access (backward compat for local deployments)
  if (!token) return true;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    writeAuthError(res, 401, "Authorization required");
    return false;
  }

  const provided = Buffer.from(authHeader.slice(7));
  const expected = Buffer.from(token);

  // Lengths must match for timingSafeEqual (different lengths = wrong token immediately)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    writeAuthError(res, 401, "Invalid API key");
    return false;
  }

  return true;
}

function writeAuthError(res: ServerResponse, status: number, message: string): void {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}
