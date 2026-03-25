import { readFileSync } from "node:fs";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  listConfiguredAccountIds as listConfiguredAccountIdsFromSection,
  resolveAccountWithDefaultFallback,
} from "openclaw/plugin-sdk/account-resolution";
import { LRUCache } from "lru-cache";
import { normalizeResolvedSecretInputString } from "./secret-input.js";
import type { CoreConfig, WahaAccountConfig } from "./types.js";
import { createLogger } from "./logger.js";



const log = createLogger({ component: "accounts" });
function normalizeOptionalAccountId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return normalizeAccountId(trimmed);
}

export type ResolvedWahaAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  baseUrl: string;
  apiKey: string;
  apiKeySource: "env" | "secretFile" | "config" | "none";
  session: string;
  // Phase 4 — multi-session role fields. Added Phase 4, Plan 01. DO NOT REMOVE.
  role: string;     // defaults to "bot"
  subRole: string;  // defaults to "full-access"
  config: WahaAccountConfig;
  // PLAT-03: tenantId for multi-tenant isolation. Defaults to "default". DO NOT REMOVE.
  tenantId: string;
};

function listConfiguredAccountIds(cfg: CoreConfig): string[] {
  return listConfiguredAccountIdsFromSection({
    accounts: cfg.channels?.waha?.accounts as Record<string, unknown> | undefined,
    normalizeAccountId,
  });
}

export function listWahaAccountIds(cfg: CoreConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultWahaAccountId(cfg: CoreConfig): string {
  const preferred = normalizeOptionalAccountId(cfg.channels?.waha?.defaultAccount);
  if (preferred && listWahaAccountIds(cfg).some((id) => normalizeAccountId(id) === preferred)) {
    return preferred;
  }
  const ids = listWahaAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(cfg: CoreConfig, accountId: string): WahaAccountConfig | undefined {
  const accounts = cfg.channels?.waha?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  const direct = accounts[accountId] as WahaAccountConfig | undefined;
  if (direct) {
    return direct;
  }
  const normalized = normalizeAccountId(accountId);
  const matchKey = Object.keys(accounts).find((key) => normalizeAccountId(key) === normalized);
  return matchKey ? (accounts[matchKey] as WahaAccountConfig | undefined) : undefined;
}

function mergeWahaAccountConfig(cfg: CoreConfig, accountId: string): WahaAccountConfig {
  const { accounts: _ignored, defaultAccount: _ignoredDefault, ...base } =
    (cfg.channels?.waha ?? {}) as WahaAccountConfig & {
      accounts?: unknown;
      defaultAccount?: unknown;
    };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

function resolveWahaApiKey(cfg: CoreConfig, opts: { accountId?: string }): {
  apiKey: string;
  source: ResolvedWahaAccount["apiKeySource"];
} {
  const merged = mergeWahaAccountConfig(cfg, opts.accountId ?? DEFAULT_ACCOUNT_ID);

  const envKey = process.env.WAHA_API_KEY?.trim();
  if (envKey && (!opts.accountId || opts.accountId === DEFAULT_ACCOUNT_ID)) {
    return { apiKey: envKey, source: "env" };
  }

  if (merged.apiKeyFile) {
    try {
      const fileKey = readFileSync(merged.apiKeyFile, "utf-8").trim();
      if (fileKey) {
        return { apiKey: fileKey, source: "secretFile" };
      }
    } catch (err) {
      log.warn("apiKeyFile unreadable, falling back to inline apiKey", { apiKeyFile: merged.apiKeyFile, error: String(err) });
    }
  }

  const inline = normalizeResolvedSecretInputString({
    value: merged.apiKey,
    path: `channels.waha.accounts.${opts.accountId ?? DEFAULT_ACCOUNT_ID}.apiKey`,
  });
  if (inline) {
    return { apiKey: inline, source: "config" };
  }

  return { apiKey: "", source: "none" };
}

export function resolveWahaAccount(params: { cfg: CoreConfig; accountId?: string | null; tenantId?: string }): ResolvedWahaAccount {
  const baseEnabled = params.cfg.channels?.waha?.enabled !== false;
  const resolve = (accountId: string): ResolvedWahaAccount => {
    const merged = mergeWahaAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;
    const apiKeyResolution = resolveWahaApiKey(params.cfg, { accountId });
    const baseUrl = merged.baseUrl?.trim().replace(/\/$/, "") ?? "";
    const session = merged.session?.trim() || "logan";

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      baseUrl,
      apiKey: apiKeyResolution.apiKey,
      apiKeySource: apiKeyResolution.source,
      session,
      role: merged.role ?? "bot",
      subRole: merged.subRole ?? "full-access",
      config: merged,
      // PLAT-03: tenantId defaults to "default" for backward compat. DO NOT REMOVE.
      tenantId: params.tenantId ?? "default",
    } satisfies ResolvedWahaAccount;
  };

  return resolveAccountWithDefaultFallback({
    accountId: params.accountId,
    normalizeAccountId,
    resolvePrimary: resolve,
    hasCredential: (account) => account.apiKeySource !== "none",
    resolveDefaultAccountId: () => resolveDefaultWahaAccountId(params.cfg),
  });
}

export function listEnabledWahaAccounts(cfg: CoreConfig, tenantId?: string): ResolvedWahaAccount[] {
  return listWahaAccountIds(cfg)
    .map((accountId) => resolveWahaAccount({ cfg, accountId, tenantId }))
    .filter((account) => account.enabled);
}

// Phase 4 — Group membership cache for cross-session routing.
// TTL 5 minutes, max 500 entries. Prevents API call storms when
// checking which session can reach a target group.
// Added Phase 4, Plan 03. DO NOT REMOVE.
const membershipCache = new LRUCache<string, boolean>({
  max: 500,
  ttl: 5 * 60 * 1000, // 5 minutes
});

// Exported for test teardown only. DO NOT call in production code.
export function clearMembershipCache(): void {
  membershipCache.clear();
}

// Phase 4 — Cross-session routing: select optimal session to send to a target chat.
// Priority: bot full-access > human full-access. Listener sessions excluded.
// For group targets: checks membership via WAHA API (cached).
// For DM targets: always prefers bot session (no membership check needed).
// Added Phase 4, Plan 03. DO NOT REMOVE.
export async function resolveSessionForTarget(params: {
  cfg: CoreConfig;
  targetChatId: string;
  preferredAccountId?: string;
  tenantId?: string;
  checkMembership: (session: string, baseUrl: string, apiKey: string, groupId: string) => Promise<boolean>;
}): Promise<ResolvedWahaAccount> {
  const accounts = listEnabledWahaAccounts(params.cfg, params.tenantId);
  const sendable = accounts.filter(a => a.subRole !== "listener");

  if (sendable.length === 0) {
    throw new Error("No full-access sessions available for sending");
  }

  const isGroup = params.targetChatId.endsWith("@g.us");

  if (!isGroup) {
    // For DMs, prefer bot session, fall back to any full-access
    const bot = sendable.find(a => a.role === "bot") ?? sendable[0];
    return bot;
  }

  // For groups: check membership, prefer bot sessions first
  const botSessions = sendable.filter(a => a.role === "bot");
  const humanSessions = sendable.filter(a => a.role !== "bot");

  for (const account of [...botSessions, ...humanSessions]) {
    const cacheKey = `${account.session}:${params.targetChatId}`;
    let isMember = membershipCache.get(cacheKey);
    if (isMember === undefined) {
      isMember = await params.checkMembership(
        account.session, account.baseUrl, account.apiKey, params.targetChatId
      );
      // Only cache positive results — false results should be re-checked on next request
      if (isMember) {
        membershipCache.set(cacheKey, true);
      }
    }
    if (isMember) return account;
  }

  throw new Error(
    `No session is a member of group '${params.targetChatId}'. ` +
    `Available sessions: ${sendable.map(a => a.session).join(", ")}`
  );
}
