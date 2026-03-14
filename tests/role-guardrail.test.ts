/**
 * role-guardrail.test.ts
 * Tests for Phase 4 Plan 01: role/subRole config fields and assertCanSend guardrail.
 *
 * Covers:
 *  - WahaAccountConfig / ResolvedWahaAccount extended with role, subRole, triggerWord, triggerResponseMode
 *  - Zod schema backward-compatible defaults
 *  - assertCanSend: listener blocked, full-access allowed
 */

import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock openclaw/plugin-sdk BEFORE any imports that transitively use it.
// ---------------------------------------------------------------------------
vi.mock("openclaw/plugin-sdk", async () => {
  const { z } = await import("zod");
  return {
    DEFAULT_ACCOUNT_ID: "default",
    normalizeAccountId: (id: string) => id.trim().toLowerCase(),
    listConfiguredAccountIds: ({ accounts }: { accounts?: Record<string, unknown> }) =>
      accounts ? Object.keys(accounts) : [],
    resolveAccountWithDefaultFallback: ({
      accountId,
      resolvePrimary,
      resolveDefaultAccountId,
    }: {
      accountId?: string | null;
      resolvePrimary: (id: string) => unknown;
      resolveDefaultAccountId: () => string;
      hasCredential: (a: unknown) => boolean;
      normalizeAccountId: (id: string) => string;
    }) => resolvePrimary(accountId ?? resolveDefaultAccountId()),
    // Zod schema helpers used by config-schema.ts
    DmPolicySchema: z.string().optional(),
    GroupPolicySchema: z.string().optional(),
    MarkdownConfigSchema: z.any().optional(),
    ToolPolicySchema: z.any().optional(),
    ReplyRuntimeConfigSchemaShape: {},
    BlockStreamingCoalesceSchema: z.any().optional(),
    requireOpenAllowFrom: () => {},
    // Other SDK exports used by send.ts
    detectMime: vi.fn(),
    sendMediaWithLeadingCaption: vi.fn(),
    isWhatsAppGroupJid: (jid: string) => jid.endsWith("@g.us"),
    createLoggerBackedRuntime: vi.fn(() => ({})),
    isRequestBodyLimitError: vi.fn(() => false),
    readRequestBodyWithLimit: vi.fn(),
    requestBodyErrorToText: vi.fn(),
  };
});

// Mock other heavy deps so we can import accounts.ts and send.ts
vi.mock("../src/secret-input.js", async () => {
  const { z } = await import("zod");
  return {
    buildSecretInputSchema: () =>
      z.union([z.string(), z.object({ source: z.string(), provider: z.string(), id: z.string() })]).optional(),
    normalizeResolvedSecretInputString: ({ value }: { value: unknown }) =>
      typeof value === "string" ? value : null,
  };
});

vi.mock("../src/http-client.js", () => ({
  callWahaApi: vi.fn(),
  warnOnError: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Now we can import the actual modules under test
// ---------------------------------------------------------------------------
import { WahaAccountSchemaBase } from "../src/config-schema.js";
import { resolveWahaAccount, listEnabledWahaAccounts } from "../src/accounts.js";
import { assertCanSend } from "../src/send.js";
import type { CoreConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCfg(overrides: Record<string, unknown> = {}): CoreConfig {
  return {
    channels: {
      waha: {
        baseUrl: "http://localhost:3004",
        apiKey: "test-key",
        session: "test-session",
        enabled: true,
        ...overrides,
      },
    },
  } as unknown as CoreConfig;
}

// ---------------------------------------------------------------------------
// Schema backward compatibility
// ---------------------------------------------------------------------------

describe("WahaAccountSchemaBase — role/subRole/trigger fields", () => {
  it("parses config without role/subRole and defaults to bot/full-access", () => {
    const result = WahaAccountSchemaBase.parse({});
    expect(result.role).toBe("bot");
    expect(result.subRole).toBe("full-access");
  });

  it("parses config with explicit role and subRole", () => {
    const result = WahaAccountSchemaBase.parse({ role: "human", subRole: "full-access" });
    expect(result.role).toBe("human");
    expect(result.subRole).toBe("full-access");
  });

  it("parses config with listener subRole", () => {
    const result = WahaAccountSchemaBase.parse({ role: "bot", subRole: "listener" });
    expect(result.subRole).toBe("listener");
  });

  it("accepts unknown role strings without code changes (extensible)", () => {
    const result = WahaAccountSchemaBase.parse({ role: "observer" });
    expect(result.role).toBe("observer");
  });

  it("accepts unknown subRole strings (extensible)", () => {
    const result = WahaAccountSchemaBase.parse({ subRole: "custom-role" });
    expect(result.subRole).toBe("custom-role");
  });

  it("accepts triggerWord as optional string", () => {
    const result = WahaAccountSchemaBase.parse({ triggerWord: "!bot" });
    expect(result.triggerWord).toBe("!bot");
  });

  it("defaults triggerResponseMode to 'dm'", () => {
    const result = WahaAccountSchemaBase.parse({});
    expect(result.triggerResponseMode).toBe("dm");
  });

  it("accepts triggerResponseMode override", () => {
    const result = WahaAccountSchemaBase.parse({ triggerResponseMode: "reply-in-chat" });
    expect(result.triggerResponseMode).toBe("reply-in-chat");
  });

  it("does not break existing config parsing (backward compat)", () => {
    // A config that previously worked without role/subRole should still parse cleanly
    const result = WahaAccountSchemaBase.parse({
      session: "3cf11776_logan",
      baseUrl: "http://localhost:3004",
    });
    expect(result.role).toBe("bot");
    expect(result.subRole).toBe("full-access");
  });
});

// ---------------------------------------------------------------------------
// ResolvedWahaAccount — role/subRole fields
// ---------------------------------------------------------------------------

describe("resolveWahaAccount — role/subRole fields", () => {
  it("includes role and subRole in resolved account (defaults)", () => {
    const cfg = makeCfg();
    const account = resolveWahaAccount({ cfg });
    expect(account).toHaveProperty("role");
    expect(account).toHaveProperty("subRole");
    expect(account.role).toBe("bot");
    expect(account.subRole).toBe("full-access");
  });

  it("resolves explicit role from config", () => {
    const cfg = makeCfg({ role: "human" });
    const account = resolveWahaAccount({ cfg });
    expect(account.role).toBe("human");
  });

  it("resolves explicit subRole from config", () => {
    const cfg = makeCfg({ subRole: "listener" });
    const account = resolveWahaAccount({ cfg });
    expect(account.subRole).toBe("listener");
  });
});

// ---------------------------------------------------------------------------
// assertCanSend — role-based guardrail
// ---------------------------------------------------------------------------

describe("assertCanSend", () => {
  it("allows bot/full-access session to send", () => {
    const cfg = makeCfg({ session: "bot-session", role: "bot", subRole: "full-access" });
    expect(() => assertCanSend("bot-session", cfg)).not.toThrow();
  });

  it("allows human/full-access session to send", () => {
    const cfg = makeCfg({ session: "human-session", role: "human", subRole: "full-access" });
    expect(() => assertCanSend("human-session", cfg)).not.toThrow();
  });

  it("blocks bot/listener session from sending", () => {
    const cfg = makeCfg({ session: "listener-session", role: "bot", subRole: "listener" });
    expect(() => assertCanSend("listener-session", cfg)).toThrow(/listener/);
  });

  it("blocks human/listener session from sending", () => {
    const cfg = makeCfg({ session: "human-listener", role: "human", subRole: "listener" });
    expect(() => assertCanSend("human-listener", cfg)).toThrow(/listener/);
  });

  it("error message contains session name", () => {
    const cfg = makeCfg({ session: "my-listener-session", subRole: "listener" });
    expect(() => assertCanSend("my-listener-session", cfg)).toThrow(/my-listener-session/);
  });

  it("error message mentions how to fix (sub-role or subRole)", () => {
    const cfg = makeCfg({ session: "blocked-session", subRole: "listener" });
    let errMsg = "";
    try {
      assertCanSend("blocked-session", cfg);
    } catch (e) {
      errMsg = String(e);
    }
    expect(errMsg).toMatch(/sub.?role|subRole/i);
  });

  it("defaults to full-access when no role config exists (backward compat)", () => {
    const cfg = makeCfg({ session: "old-session" }); // no role/subRole
    expect(() => assertCanSend("old-session", cfg)).not.toThrow();
  });

  it("allows unregistered session without throwing — defaults to full-access", () => {
    const cfg = makeCfg({ session: "registered-session" });
    expect(() => assertCanSend("unregistered-session", cfg)).not.toThrow();
  });
});
