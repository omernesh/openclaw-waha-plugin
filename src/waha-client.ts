// ╔══════════════════════════════════════════════════════════════════════╗
// ║  WahaClient — DO NOT CHANGE                                         ║
// ║                                                                     ║
// ║  Stateful WAHA API client that encapsulates connection parameters   ║
// ║  (baseUrl, apiKey, session) for a single resolved account.         ║
// ║                                                                     ║
// ║  Created: Phase 32, Plan 01 (2026-03-20).                          ║
// ║                                                                     ║
// ║  Wraps callWahaApi from http-client.ts — all reliability features  ║
// ║  (timeout, rate limiting, 429 backoff, dedup) are preserved.       ║
// ║                                                                     ║
// ║  DO NOT import from send.ts — would create a circular dependency.  ║
// ║  Import only from http-client.ts and accounts.ts.                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { callWahaApi, type CallWahaApiParams } from "./http-client.js";
import { resolveWahaAccount, type ResolvedWahaAccount } from "./accounts.js";
import type { CoreConfig } from "./types.js";

// ---------------------------------------------------------------------------
// WahaClient
// ---------------------------------------------------------------------------

export class WahaClient {
  /** WAHA API base URL (e.g. "http://127.0.0.1:3004"). */
  readonly baseUrl: string;
  /** WAHA API key (x-api-key header). */
  readonly apiKey: string;
  /** WAHA session name (e.g. "3cf11776_logan"). */
  readonly session: string;
  /** Resolved account ID this client belongs to. */
  readonly accountId: string;

  constructor(opts: {
    baseUrl: string;
    apiKey: string;
    session: string;
    accountId?: string;
  }) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.session = opts.session;
    this.accountId = opts.accountId ?? DEFAULT_ACCOUNT_ID;
  }

  // ---------------------------------------------------------------------------
  // Core request method
  // ---------------------------------------------------------------------------

  /**
   * Make a WAHA API request.
   * Delegates to callWahaApi — inherits timeout, rate limiting, 429 backoff, and dedup.
   */
  async request(opts: {
    path: string;
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: Record<string, unknown>;
    query?: Record<string, string>;
    context?: { action?: string; chatId?: string };
    skipRateLimit?: boolean;
    timeoutMs?: number;
  }): Promise<any> {
    const params: CallWahaApiParams = {
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      path: opts.path,
      ...(opts.method !== undefined ? { method: opts.method } : {}),
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(opts.query !== undefined ? { query: opts.query } : {}),
      ...(opts.context !== undefined ? { context: opts.context } : {}),
      ...(opts.skipRateLimit !== undefined ? { skipRateLimit: opts.skipRateLimit } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    };
    return callWahaApi(params);
  }

  // ---------------------------------------------------------------------------
  // Convenience HTTP methods
  // ---------------------------------------------------------------------------

  /** GET request. */
  get(path: string, query?: Record<string, string>): Promise<any> {
    return this.request({ path, method: "GET", ...(query ? { query } : {}) });
  }

  /** POST request. */
  post(path: string, body?: Record<string, unknown>): Promise<any> {
    return this.request({ path, method: "POST", ...(body !== undefined ? { body } : {}) });
  }

  /** PUT request. */
  put(path: string, body?: Record<string, unknown>): Promise<any> {
    return this.request({ path, method: "PUT", ...(body !== undefined ? { body } : {}) });
  }

  /** DELETE request. */
  del(path: string, body?: Record<string, unknown>): Promise<any> {
    return this.request({ path, method: "DELETE", ...(body !== undefined ? { body } : {}) });
  }

  // ---------------------------------------------------------------------------
  // Session path helper
  // ---------------------------------------------------------------------------

  /**
   * Replace `{session}` in a path template with this client's encoded session name.
   *
   * Example: client.sessionPath("/api/{session}/groups") → "/api/3cf11776_logan/groups"
   */
  sessionPath(template: string): string {
    return template.replace("{session}", encodeURIComponent(this.session));
  }

  // ---------------------------------------------------------------------------
  // Static factory
  // ---------------------------------------------------------------------------

  /**
   * Create a WahaClient from a ResolvedWahaAccount.
   * Used by getWahaClient() and can be called directly when an account is already resolved.
   */
  static fromAccount(account: ResolvedWahaAccount): WahaClient {
    return new WahaClient({
      baseUrl: account.baseUrl ?? "",
      apiKey: typeof account.apiKey === "string" ? account.apiKey : "",
      session: account.session ?? "default",
      accountId: account.accountId,
    });
  }
}

// ---------------------------------------------------------------------------
// Module-level client cache
// ---------------------------------------------------------------------------

/**
 * Per-account WahaClient cache.
 * Keyed by the resolved accountId string.
 * Cache is intentionally not TTL-bounded — accounts don't change during a session.
 * On config hot-reload, call clearWahaClientCache() to invalidate.
 */
const _clientCache = new Map<string, WahaClient>();

/**
 * Get (or create) a WahaClient for the given account.
 * Resolves the account via resolveWahaAccount and caches the result.
 *
 * Does NOT call assertCanSend — callers that need the send guard must call it separately.
 * This keeps WahaClient usable for read-only operations (e.g. getWahaGroups).
 */
export function getWahaClient(cfg: CoreConfig, accountId?: string): WahaClient {
  const account = resolveWahaAccount({ cfg, accountId: accountId ?? DEFAULT_ACCOUNT_ID });
  const cacheKey = account.accountId;
  const cached = _clientCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const client = WahaClient.fromAccount(account);
  _clientCache.set(cacheKey, client);
  return client;
}

/**
 * Clear the client cache. Call when plugin config changes so new credentials are picked up.
 * Also used in tests.
 */
export function clearWahaClientCache(): void {
  _clientCache.clear();
}
