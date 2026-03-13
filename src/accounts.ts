import { readFileSync } from "node:fs";
import {
  DEFAULT_ACCOUNT_ID,
  listConfiguredAccountIds as listConfiguredAccountIdsFromSection,
  normalizeAccountId,
  resolveAccountWithDefaultFallback,
} from "openclaw/plugin-sdk";
import { normalizeResolvedSecretInputString } from "./secret-input.js";
import type { CoreConfig, WahaAccountConfig } from "./types.js";


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
    } catch {
      // ignore
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

export function resolveWahaAccount(params: { cfg: CoreConfig; accountId?: string | null }): ResolvedWahaAccount {
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

export function listEnabledWahaAccounts(cfg: CoreConfig): ResolvedWahaAccount[] {
  return listWahaAccountIds(cfg)
    .map((accountId) => resolveWahaAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
