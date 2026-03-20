/**
 * Tests for inbound.ts — message pipeline, DM filter helpers, group filter helpers.
 *
 * Strategy:
 * - getDmFilterForAdmin and getGroupFilterForAdmin are tested as pure functions
 * - handleWahaInbound is tested with mocked external dependencies
 *   (dedup, directory, shutup, pairing, analytics, send)
 * - A makeWahaMessage helper builds valid WahaInboundMessage objects
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResolvedWahaAccount } from "./accounts.js";
import type { CoreConfig } from "./types.js";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("./send.js", () => ({
  sendWahaText: vi.fn().mockResolvedValue(undefined),
  sendWahaMediaBatch: vi.fn().mockResolvedValue(undefined),
  sendWahaPresence: vi.fn().mockResolvedValue(undefined),
  BOT_PROXY_PREFIX: "[bot]",
}));

vi.mock("./directory.js", () => ({
  getDirectoryDb: vi.fn().mockReturnValue({
    upsertLidMapping: vi.fn(),
    isGroupMuted: vi.fn().mockReturnValue(false),
    getGroupFilterOverride: vi.fn().mockReturnValue(null),
    isContactAllowedDm: vi.fn().mockReturnValue(true),
    getDmSettings: vi.fn().mockReturnValue(null),
    getContact: vi.fn().mockReturnValue(null),
  }),
}));

vi.mock("./runtime.js", () => ({
  getWahaRuntime: vi.fn().mockReturnValue({
    channel: {
      commands: {
        shouldHandleTextCommands: vi.fn().mockReturnValue(true),
      },
      text: {
        hasControlCommand: vi.fn().mockReturnValue(false),
      },
    },
  }),
}));

vi.mock("./shutup.js", () => ({
  SHUTUP_RE: /^\/(shutup|unshutup|unmute)\s*(all)?\s*(\d+[mhd])?\s*$/i,
  checkShutupAuthorization: vi.fn().mockResolvedValue(false),
  handleShutupCommand: vi.fn().mockResolvedValue(undefined),
  checkPendingSelection: vi.fn().mockReturnValue(null),
  clearPendingSelection: vi.fn(),
  handleSelectionResponse: vi.fn().mockResolvedValue(false),
}));

vi.mock("./pairing.js", () => ({
  getPairingEngine: vi.fn().mockReturnValue({
    verifyDeepLinkToken: vi.fn().mockReturnValue(false),
    verifyPasscode: vi.fn().mockReturnValue({ success: false, reason: "not_found" }),
    grantAccess: vi.fn(),
    checkAccess: vi.fn().mockReturnValue(false),
  }),
}));

vi.mock("./auto-reply.js", () => ({
  getAutoReplyEngine: vi.fn().mockReturnValue({
    shouldAutoReply: vi.fn().mockReturnValue(false),
    sendAutoReply: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("./analytics.js", () => ({
  recordAnalyticsEvent: vi.fn(),
}));

vi.mock("./dedup.js", () => ({
  claimMessage: vi.fn().mockReturnValue(true),
  isClaimedByBotSession: vi.fn().mockReturnValue(false),
}));

vi.mock("./mentions.js", () => ({
  extractMentionedJids: vi.fn().mockReturnValue([]),
}));

vi.mock("./media.js", () => ({
  preprocessInboundMessage: vi.fn().mockImplementation(async ({ message }) => message),
  downloadWahaMedia: vi.fn().mockResolvedValue({ path: "/tmp/test.jpg", cleanup: vi.fn() }),
}));

vi.mock("./http-client.js", () => ({
  warnOnError: vi.fn().mockReturnValue((err: unknown) => {
    console.warn(String(err));
  }),
}));

vi.mock("./rules-resolver.js", () => ({
  resolveInboundPolicy: vi.fn().mockResolvedValue({ action: "allow" }),
}));

vi.mock("./identity-resolver.js", () => ({
  getRulesBasePath: vi.fn().mockReturnValue(null),
}));

vi.mock("./module-registry.js", () => ({
  getModuleRegistry: vi.fn().mockReturnValue({
    listModules: vi.fn().mockReturnValue([]),
    handleInboundMessage: vi.fn().mockResolvedValue(false),
    getModulesForChat: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock("./presence.js", () => ({
  startHumanPresence: vi.fn().mockReturnValue({ finishTyping: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("openclaw/plugin-sdk", async () => ({
  isWhatsAppGroupJid: vi.fn().mockImplementation((jid: string) => jid?.endsWith("@g.us") ?? false),
  GROUP_POLICY_BLOCKED_LABEL: "GROUP_POLICY_BLOCKED",
  createNormalizedOutboundDeliverer: vi.fn().mockReturnValue(vi.fn().mockResolvedValue(undefined)),
  createReplyPrefixOptions: vi.fn().mockReturnValue({}),
  createScopedPairingAccess: vi.fn().mockReturnValue({ grantAccess: vi.fn(), checkAccess: vi.fn().mockReturnValue(false) }),
  formatTextWithAttachmentLinks: vi.fn().mockReturnValue(""),
  logInboundDrop: vi.fn(),
  readStoreAllowFromForDmPolicy: vi.fn().mockResolvedValue([]),
  resolveAllowlistProviderRuntimeGroupPolicy: vi.fn().mockResolvedValue(null),
  resolveDefaultGroupPolicy: vi.fn().mockReturnValue("allowlist"),
  resolveDmGroupAccessWithCommandGate: vi.fn().mockResolvedValue({ access: "allow", deliverer: vi.fn().mockResolvedValue(undefined) }),
  warnMissingProviderGroupPolicyFallbackOnce: vi.fn(),
  resolveOutboundMediaUrls: vi.fn().mockReturnValue([]),
  DEFAULT_ACCOUNT_ID: "__default__",
}));

// ── Import module under test AFTER mocks ─────────────────────────────────────
import { getDmFilterForAdmin, getGroupFilterForAdmin, handleWahaInbound } from "./inbound.js";
import { DmFilter } from "./dm-filter.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, unknown> = {}): CoreConfig {
  return {
    channels: {
      waha: {
        session: "test-session",
        baseUrl: "http://localhost:3004",
        dmFilter: { enabled: false },
        groupFilter: { enabled: false },
        allowFrom: ["972000000001@c.us"],
        groupAllowFrom: [],
        allowedGroups: [],
        dmPolicy: "allowlist",
        groupPolicy: "allowlist",
        ...overrides,
      },
    },
  } as CoreConfig;
}

function makeAccount(overrides: Partial<ResolvedWahaAccount> = {}): ResolvedWahaAccount {
  return {
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
      dmFilter: { enabled: false },
      groupFilter: { enabled: false },
      allowFrom: ["972000000001@c.us"],
      groupAllowFrom: [],
      allowedGroups: [],
      dmPolicy: "allowlist",
      groupPolicy: "allowlist",
    } as never,
    ...overrides,
  };
}

function makeRuntime() {
  return { log: vi.fn(), error: vi.fn() };
}

interface WahaMessageOverrides {
  messageId?: string;
  from?: string;
  chatId?: string;
  body?: string;
  fromMe?: boolean;
  hasMedia?: boolean;
  mediaUrl?: string;
  mediaMime?: string;
  participant?: string;
  timestamp?: number;
}

function makeWahaMessage(overrides: WahaMessageOverrides = {}) {
  return {
    messageId: overrides.messageId ?? `msg-${Date.now()}`,
    timestamp: overrides.timestamp ?? Date.now(),
    from: overrides.from ?? "972000000001@c.us",
    chatId: overrides.chatId ?? overrides.from ?? "972000000001@c.us",
    body: overrides.body ?? "hello",
    fromMe: overrides.fromMe ?? false,
    hasMedia: overrides.hasMedia ?? false,
    mediaUrl: overrides.mediaUrl,
    mediaMime: overrides.mediaMime,
    participant: overrides.participant,
  };
}

// ── getDmFilterForAdmin tests ─────────────────────────────────────────────────

describe("getDmFilterForAdmin", () => {
  it("returns a DmFilter instance for the given account", () => {
    const cfg = makeConfig();
    const filter = getDmFilterForAdmin(cfg, "default");
    expect(filter).toBeInstanceOf(DmFilter);
  });

  it("returns the same instance on repeated calls (singleton per accountId)", () => {
    const cfg = makeConfig();
    const filter1 = getDmFilterForAdmin(cfg, "account-singleton-test");
    const filter2 = getDmFilterForAdmin(cfg, "account-singleton-test");
    expect(filter1).toBe(filter2);
  });

  it("filter is disabled when dmFilter.enabled=false", () => {
    const cfg = makeConfig({ dmFilter: { enabled: false } });
    const filter = getDmFilterForAdmin(cfg, "acct-disabled");
    const result = filter.check({ text: "anything", senderId: "972000000001@c.us" });
    expect(result.pass).toBe(true);
    expect(result.reason).toBe("filter_disabled");
  });

  it("filter passes messages matching keyword pattern when enabled", () => {
    const cfg = makeConfig({ dmFilter: { enabled: true, mentionPatterns: ["bot", "help"] } });
    const filter = getDmFilterForAdmin(cfg, "acct-enabled");
    const result = filter.check({ text: "help me bot", senderId: "972000000001@c.us" });
    expect(result.pass).toBe(true);
    expect(result.reason).toBe("keyword_match");
  });

  it("filter drops messages not matching keyword pattern", () => {
    const cfg = makeConfig({ dmFilter: { enabled: true, mentionPatterns: ["bot", "help"] } });
    const filter = getDmFilterForAdmin(cfg, "acct-drop");
    const result = filter.check({ text: "random unrelated message", senderId: "972000000001@c.us" });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("no_keyword_match");
  });
});

// ── getGroupFilterForAdmin tests ──────────────────────────────────────────────

describe("getGroupFilterForAdmin", () => {
  it("returns a DmFilter instance for the given account", () => {
    const cfg = makeConfig();
    const filter = getGroupFilterForAdmin(cfg, "default");
    expect(filter).toBeInstanceOf(DmFilter);
  });

  it("applies default group patterns when none configured", () => {
    const cfg = makeConfig({ groupFilter: {} });
    const filter = getGroupFilterForAdmin(cfg, "acct-group-default");
    // Default patterns include "bot" — should match
    const result = filter.check({ text: "hey bot answer me", senderId: "972000000001@c.us", filterType: "group" });
    expect(result.pass).toBe(true);
  });

  it("drops group messages not matching any pattern", () => {
    const cfg = makeConfig({ groupFilter: { enabled: true, mentionPatterns: ["bot"] } });
    const filter = getGroupFilterForAdmin(cfg, "acct-group-drop");
    const result = filter.check({ text: "just a regular chat message", senderId: "972000000001@c.us", filterType: "group" });
    expect(result.pass).toBe(false);
  });
});

// ── handleWahaInbound tests ───────────────────────────────────────────────────

describe("handleWahaInbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fromMe messages", () => {
    it("skips messages where fromMe=true and no trigger word", async () => {
      // fromMe messages without trigger word should fall through dedup and claim,
      // then hit an early return path (checked in monitor.ts webhook handler, not here)
      // handleWahaInbound itself receives already-filtered messages in production,
      // but we test it directly — fromMe messages hit the rawBody check
      const message = makeWahaMessage({ fromMe: true, body: "I sent this" });
      const account = makeAccount();
      const config = makeConfig();
      const runtime = makeRuntime();
      const { claimMessage } = await import("./dedup.js");

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // Claim should have been attempted (bot session claims first)
      expect(claimMessage).toHaveBeenCalledWith(message.messageId, "default", "bot");
    });
  });

  describe("cross-session dedup", () => {
    it("skips already-claimed messages", async () => {
      const { claimMessage } = await import("./dedup.js");
      (claimMessage as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      const message = makeWahaMessage({ body: "hello bot" });
      const account = makeAccount();
      const config = makeConfig();
      const runtime = makeRuntime();
      const { resolveDmGroupAccessWithCommandGate } = await import("openclaw/plugin-sdk");

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // resolveDmGroupAccessWithCommandGate should NOT be called — message was skipped
      expect(resolveDmGroupAccessWithCommandGate).not.toHaveBeenCalled();
    });

    it("processes messages that are successfully claimed", async () => {
      const { claimMessage } = await import("./dedup.js");
      (claimMessage as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

      const message = makeWahaMessage({ body: "hello bot" });
      const account = makeAccount();
      const config = makeConfig();
      const runtime = makeRuntime();

      // Should not throw
      await expect(handleWahaInbound({ message, account, config, runtime: runtime as never }))
        .resolves.not.toThrow();
    });
  });

  describe("empty body messages", () => {
    it("returns early when body is empty after processing", async () => {
      const message = makeWahaMessage({ body: "", hasMedia: false });
      const account = makeAccount();
      const config = makeConfig();
      const runtime = makeRuntime();
      const { resolveDmGroupAccessWithCommandGate } = await import("openclaw/plugin-sdk");

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // With empty body and no media, pipeline returns before reaching DM access check
      expect(resolveDmGroupAccessWithCommandGate).not.toHaveBeenCalled();
    });
  });

  describe("DM filtering", () => {
    it("allows DMs from an allowed sender via SDK deliverer", async () => {
      const message = makeWahaMessage({ body: "hello", from: "972000000001@c.us" });
      const account = makeAccount();
      const config = makeConfig();
      const runtime = makeRuntime();
      const { resolveDmGroupAccessWithCommandGate } = await import("openclaw/plugin-sdk");

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // With allowed sender, pipeline should reach the DM access/deliverer step
      expect(resolveDmGroupAccessWithCommandGate).toHaveBeenCalled();
    });
  });

  describe("group filtering", () => {
    it("drops group messages not matching group filter", async () => {
      const { resolveDmGroupAccessWithCommandGate } = await import("openclaw/plugin-sdk");
      const { getDirectoryDb } = await import("./directory.js");
      (getDirectoryDb as ReturnType<typeof vi.fn>)().getGroupFilterOverride.mockReturnValue(null);

      const groupJid = "120363421825201386@g.us";
      const message = makeWahaMessage({
        body: "just chatting",
        from: groupJid,
        chatId: groupJid,
        participant: "972000000001@c.us",
      });

      // Config with group filter ENABLED and pattern "bot" — "just chatting" won't match
      const config = makeConfig({
        groupFilter: { enabled: true, mentionPatterns: ["bot"] },
        allowedGroups: [],
      });
      const account = makeAccount({
        config: {
          session: "test-session",
          baseUrl: "http://localhost:3004",
          groupFilter: { enabled: true, mentionPatterns: ["bot"] },
          allowedGroups: [],
          allowFrom: [],
          groupAllowFrom: [],
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
        } as never,
      });
      const runtime = makeRuntime();

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // Group filter drops "just chatting" — should NOT reach DM/group access check
      expect(resolveDmGroupAccessWithCommandGate).not.toHaveBeenCalled();
    });

    it("allows group messages matching group filter keyword", async () => {
      const { resolveDmGroupAccessWithCommandGate } = await import("openclaw/plugin-sdk");
      const { getDirectoryDb } = await import("./directory.js");
      (getDirectoryDb as ReturnType<typeof vi.fn>)().isGroupMuted.mockReturnValue(false);
      (getDirectoryDb as ReturnType<typeof vi.fn>)().getGroupFilterOverride.mockReturnValue(null);

      const groupJid = "120363421825201386@g.us";
      const message = makeWahaMessage({
        body: "hey bot help me",
        from: groupJid,
        chatId: groupJid,
        participant: "972000000001@c.us",
      });

      const config = makeConfig({
        groupFilter: { enabled: true, mentionPatterns: ["bot"] },
        allowedGroups: [],
      });
      const account = makeAccount({
        config: {
          session: "test-session",
          baseUrl: "http://localhost:3004",
          groupFilter: { enabled: true, mentionPatterns: ["bot"] },
          allowedGroups: [],
          allowFrom: [],
          groupAllowFrom: [],
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
        } as never,
      });
      const runtime = makeRuntime();

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // "hey bot help me" matches "bot" — should reach group policy check
      expect(resolveDmGroupAccessWithCommandGate).toHaveBeenCalled();
    });

    it("drops group message when group is muted", async () => {
      const { getDirectoryDb } = await import("./directory.js");
      (getDirectoryDb as ReturnType<typeof vi.fn>)().isGroupMuted.mockReturnValue(true);

      const groupJid = "120363421825201386@g.us";
      const message = makeWahaMessage({
        body: "hey bot",
        from: groupJid,
        chatId: groupJid,
        participant: "972000000001@c.us",
      });
      const config = makeConfig();
      const account = makeAccount({
        config: {
          session: "test-session",
          baseUrl: "http://localhost:3004",
          groupFilter: {},
          allowedGroups: [],
          allowFrom: [],
          groupAllowFrom: [],
        } as never,
      });
      const runtime = makeRuntime();
      const { resolveDmGroupAccessWithCommandGate } = await import("openclaw/plugin-sdk");

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // Muted group — should NOT reach access check
      expect(resolveDmGroupAccessWithCommandGate).not.toHaveBeenCalled();
    });
  });

  describe("/shutup command interception", () => {
    it("intercepts /shutup command when sender is authorized", async () => {
      const { checkShutupAuthorization, handleShutupCommand } = await import("./shutup.js");
      (checkShutupAuthorization as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (handleShutupCommand as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const message = makeWahaMessage({ body: "/shutup", from: "972000000001@c.us" });
      const account = makeAccount();
      const config = makeConfig();
      const runtime = makeRuntime();
      const { resolveDmGroupAccessWithCommandGate } = await import("openclaw/plugin-sdk");

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      expect(handleShutupCommand).toHaveBeenCalled();
      // Should NOT reach DM access check — command handled
      expect(resolveDmGroupAccessWithCommandGate).not.toHaveBeenCalled();
    });

    it("does NOT intercept /shutup if sender is not authorized", async () => {
      const { checkShutupAuthorization, handleShutupCommand } = await import("./shutup.js");
      (checkShutupAuthorization as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const message = makeWahaMessage({ body: "/shutup", from: "972000000001@c.us" });
      const account = makeAccount();
      const config = makeConfig();
      const runtime = makeRuntime();

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      expect(handleShutupCommand).not.toHaveBeenCalled();
    });
  });

  describe("media message handling", () => {
    it("processes media message and passes to pipeline", async () => {
      const { preprocessInboundMessage } = await import("./media.js");
      (preprocessInboundMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        messageId: "media-msg-1",
        from: "972000000001@c.us",
        chatId: "972000000001@c.us",
        body: "[voice message transcription: hello there]",
        fromMe: false,
        hasMedia: true,
        mediaUrl: "http://localhost:3004/api/media/file.ogg",
        mediaMime: "audio/ogg",
        timestamp: Date.now(),
      });

      const message = makeWahaMessage({
        body: "",
        hasMedia: true,
        mediaUrl: "http://localhost:3004/api/media/file.ogg",
        mediaMime: "audio/ogg",
      });
      const rawPayload = {
        id: message.messageId,
        from: message.from,
        body: "",
        hasMedia: true,
        _data: { message: { audioMessage: {} } },
      };
      const account = makeAccount();
      const config = makeConfig();
      const runtime = makeRuntime();

      await handleWahaInbound({ message, rawPayload, account, config, runtime: runtime as never });

      // preprocessInboundMessage should have been called
      expect(preprocessInboundMessage).toHaveBeenCalled();
    });
  });

  describe("allowedGroups filtering", () => {
    it("drops group messages when group not in allowedGroups", async () => {
      const { resolveDmGroupAccessWithCommandGate } = await import("openclaw/plugin-sdk");

      const groupJid = "999999999999@g.us"; // not in allowedGroups
      const message = makeWahaMessage({
        body: "hey bot",
        from: groupJid,
        chatId: groupJid,
        participant: "972000000001@c.us",
      });
      const config = makeConfig({ allowedGroups: ["120363421825201386@g.us"] });
      const account = makeAccount({
        config: {
          session: "test-session",
          baseUrl: "http://localhost:3004",
          allowedGroups: ["120363421825201386@g.us"],
          allowFrom: [],
          groupAllowFrom: [],
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
        } as never,
      });
      const runtime = makeRuntime();

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // Not in allowedGroups — should NOT reach access check
      expect(resolveDmGroupAccessWithCommandGate).not.toHaveBeenCalled();
    });
  });
});
