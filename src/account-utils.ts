// Account resolution utilities. Phase 58 — replaces openclaw/plugin-sdk/account-resolution.
//
// Behavior verified against SDK source at /usr/lib/node_modules/openclaw/dist/session-key-DAhnzjyr.js
// and pi-embedded-CswW9luA.js (2026-03-28).
//
// normalizeAccountId: lowercases, replaces invalid chars with "-", strips leading/trailing dashes,
// truncates to 64 chars. Falls back to "default" for empty input.
//
// listConfiguredAccountIds: takes { accounts, normalizeAccountId } — returns sorted unique normalized
// keys from the accounts record.
//
// resolveAccountWithDefaultFallback: resolves primary account; falls back to default when no
// explicit accountId given AND primary lacks credentials.

// ---------------------------------------------------------------------------
// DEFAULT_ACCOUNT_ID
// Replaces: openclaw/plugin-sdk/account-id -> DEFAULT_ACCOUNT_ID
// ---------------------------------------------------------------------------
export const DEFAULT_ACCOUNT_ID = "default" as const;

// ---------------------------------------------------------------------------
// normalizeAccountId
// Replaces: openclaw/plugin-sdk/account-id -> normalizeAccountId
// SDK behavior: lowercase, replace non-[a-z0-9_-] chars with "-",
// strip leading/trailing dashes, truncate to 64 chars. Falls back to "default".
// ---------------------------------------------------------------------------
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

export function normalizeAccountId(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return DEFAULT_ACCOUNT_ID;
  if (VALID_ID_RE.test(trimmed)) return trimmed.toLowerCase();
  const canonical = trimmed
    .toLowerCase()
    .replace(INVALID_CHARS_RE, "-")
    .replace(LEADING_DASH_RE, "")
    .replace(TRAILING_DASH_RE, "")
    .slice(0, 64);
  return canonical || DEFAULT_ACCOUNT_ID;
}

// ---------------------------------------------------------------------------
// listConfiguredAccountIds
// Replaces: openclaw/plugin-sdk/account-resolution -> listConfiguredAccountIds
// SDK behavior: returns normalized unique keys from accounts record.
// ---------------------------------------------------------------------------
export function listConfiguredAccountIds(params: {
  accounts: Record<string, unknown> | undefined;
  normalizeAccountId: (id: string) => string;
}): string[] {
  if (!params.accounts) return [];
  const ids = new Set<string>();
  for (const key of Object.keys(params.accounts)) {
    if (!key) continue;
    ids.add(params.normalizeAccountId(key));
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// resolveAccountWithDefaultFallback
// Replaces: openclaw/plugin-sdk/account-resolution -> resolveAccountWithDefaultFallback
// SDK behavior:
//   1. If explicit accountId given, resolve primary and return it.
//   2. If no explicit accountId, check if primary has credentials.
//      - If yes, return primary.
//      - If no, resolve the default account ID and return that.
// ---------------------------------------------------------------------------
export function resolveAccountWithDefaultFallback<T>(params: {
  accountId: string | null | undefined;
  normalizeAccountId: (id: string) => string;
  resolvePrimary: (accountId: string) => T;
  hasCredential: (account: T) => boolean;
  resolveDefaultAccountId: () => string;
}): T {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const normalizedAccountId = params.normalizeAccountId(params.accountId ?? DEFAULT_ACCOUNT_ID);
  const primary = params.resolvePrimary(normalizedAccountId);
  if (hasExplicitAccountId || params.hasCredential(primary)) return primary;
  const fallbackId = params.resolveDefaultAccountId();
  if (fallbackId === normalizedAccountId) return primary;
  const fallback = params.resolvePrimary(fallbackId);
  if (!params.hasCredential(fallback)) return primary;
  return fallback;
}
