/**
 * session-router.test.ts
 * Tests for Phase 4 Plan 03: cross-session routing via resolveSessionForTarget.
 *
 * Covers:
 *  - Bot full-access session selected when it is a member of target group
 *  - Human full-access session selected as fallback when bot is not a member
 *  - Listener sessions excluded from selection
 *  - DM targets always use bot session (no membership check)
 *  - Error thrown when no session can reach group
 *  - Caching: second call with same session+group doesn't invoke checkMembership
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

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
    // Zod schema helpers
    DmPolicySchema: z.string().optional(),
    GroupPolicySchema: z.string().optional(),
    MarkdownConfigSchema: z.any().optional(),
    ToolPolicySchema: z.any().optional(),
    ReplyRuntimeConfigSchemaShape: {},
    BlockStreamingCoalesceSchema: z.any().optional(),
    requireOpenAllowFrom: () => {},
    detectMime: vi.fn(),
    sendMediaWithLeadingCaption: vi.fn(),
    isWhatsAppGroupJid: (jid: string) => jid.endsWith("@g.us"),
    createLoggerBackedRuntime: vi.fn(() => ({})),
    isRequestBodyLimitError: vi.fn(() => false),
    readRequestBodyWithLimit: vi.fn(),
    requestBodyErrorToText: vi.fn(),
  };
});

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
// Now import the actual modules under test
// ---------------------------------------------------------------------------
import { resolveSessionForTarget, clearMembershipCache } from "../src/accounts.js";
import type { CoreConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCfgWithAccounts(accounts: Record<string, Record<string, unknown>>): CoreConfig {
  return {
    channels: {
      waha: {
        accounts,
      },
    },
  } as unknown as CoreConfig;
}

const GROUP_JID = "120363421825201386@g.us";
const DM_JID = "972544329000@c.us";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveSessionForTarget", () => {
  beforeEach(() => {
    clearMembershipCache();
  });

  it("selects the bot full-access session when it is a member of the group", async () => {
    const cfg = makeCfgWithAccounts({
      bot: { session: "bot-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "bot", subRole: "full-access", enabled: true },
    });
    const checkMembership = vi.fn().mockResolvedValue(true);

    const result = await resolveSessionForTarget({
      cfg,
      targetChatId: GROUP_JID,
      checkMembership,
    });

    expect(result.session).toBe("bot-session");
    expect(result.role).toBe("bot");
  });

  it("falls back to human full-access session when bot is not a group member", async () => {
    const cfg = makeCfgWithAccounts({
      bot: { session: "bot-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "bot", subRole: "full-access", enabled: true },
      human: { session: "human-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "human", subRole: "full-access", enabled: true },
    });
    // Bot is NOT a member, human IS a member
    const checkMembership = vi.fn().mockImplementation(async (session: string) => {
      return session === "human-session";
    });

    const result = await resolveSessionForTarget({
      cfg,
      targetChatId: GROUP_JID,
      checkMembership,
    });

    expect(result.session).toBe("human-session");
    expect(result.role).toBe("human");
  });

  it("never selects listener sessions for sending", async () => {
    const cfg = makeCfgWithAccounts({
      listener: { session: "listener-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "bot", subRole: "listener", enabled: true },
      human: { session: "human-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "human", subRole: "full-access", enabled: true },
    });
    // Only human is a member
    const checkMembership = vi.fn().mockImplementation(async (session: string) => {
      return session === "human-session";
    });

    const result = await resolveSessionForTarget({
      cfg,
      targetChatId: GROUP_JID,
      checkMembership,
    });

    expect(result.session).toBe("human-session");
    // Listener was never checked
    expect(checkMembership).not.toHaveBeenCalledWith("listener-session", expect.anything(), expect.anything(), expect.anything());
  });

  it("uses bot session for DM targets without calling checkMembership", async () => {
    const cfg = makeCfgWithAccounts({
      bot: { session: "bot-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "bot", subRole: "full-access", enabled: true },
      human: { session: "human-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "human", subRole: "full-access", enabled: true },
    });
    const checkMembership = vi.fn();

    const result = await resolveSessionForTarget({
      cfg,
      targetChatId: DM_JID,
      checkMembership,
    });

    expect(result.session).toBe("bot-session");
    expect(checkMembership).not.toHaveBeenCalled();
  });

  it("throws error when no session is a member of the group", async () => {
    const cfg = makeCfgWithAccounts({
      bot: { session: "bot-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "bot", subRole: "full-access", enabled: true },
      human: { session: "human-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "human", subRole: "full-access", enabled: true },
    });
    const checkMembership = vi.fn().mockResolvedValue(false);

    await expect(
      resolveSessionForTarget({
        cfg,
        targetChatId: GROUP_JID,
        checkMembership,
      })
    ).rejects.toThrow(/No session is a member/);
  });

  it("throws error containing available session names when no member found", async () => {
    const cfg = makeCfgWithAccounts({
      bot: { session: "my-bot", baseUrl: "http://localhost:3004", apiKey: "key", role: "bot", subRole: "full-access", enabled: true },
    });
    const checkMembership = vi.fn().mockResolvedValue(false);

    await expect(
      resolveSessionForTarget({ cfg, targetChatId: GROUP_JID, checkMembership })
    ).rejects.toThrow(/my-bot/);
  });

  it("caches membership result — second call with same session+group doesn't invoke checkMembership", async () => {
    const cfg = makeCfgWithAccounts({
      bot: { session: "bot-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "bot", subRole: "full-access", enabled: true },
    });
    const checkMembership = vi.fn().mockResolvedValue(true);

    // First call
    await resolveSessionForTarget({ cfg, targetChatId: GROUP_JID, checkMembership });
    // Second call — should use cache
    await resolveSessionForTarget({ cfg, targetChatId: GROUP_JID, checkMembership });

    expect(checkMembership).toHaveBeenCalledTimes(1);
  });

  it("throws when no full-access sessions are available at all", async () => {
    const cfg = makeCfgWithAccounts({
      listener: { session: "listener-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "bot", subRole: "listener", enabled: true },
    });
    const checkMembership = vi.fn();

    await expect(
      resolveSessionForTarget({ cfg, targetChatId: GROUP_JID, checkMembership })
    ).rejects.toThrow(/No full-access sessions/);
  });

  it("falls back to first sendable session for DM when no bot session exists", async () => {
    const cfg = makeCfgWithAccounts({
      human: { session: "human-session", baseUrl: "http://localhost:3004", apiKey: "key", role: "human", subRole: "full-access", enabled: true },
    });
    const checkMembership = vi.fn();

    const result = await resolveSessionForTarget({
      cfg,
      targetChatId: DM_JID,
      checkMembership,
    });

    expect(result.session).toBe("human-session");
    expect(checkMembership).not.toHaveBeenCalled();
  });
});
