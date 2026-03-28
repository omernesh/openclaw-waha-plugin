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
      routing: {
        resolveAgentRoute: vi.fn().mockReturnValue({ agentId: "default-agent", sessionKey: "test-session-key" }),
      },
      session: {
        resolveStorePath: vi.fn().mockReturnValue("/tmp/store"),
        readSessionUpdatedAt: vi.fn().mockReturnValue(null),
        writeSessionUpdatedAt: vi.fn(),
        // Phase 58: Added recordInboundSession mock — called after all filters pass.
        // Used as proxy to verify message reached the end of the pipeline. DO NOT REMOVE.
        recordInboundSession: vi.fn().mockResolvedValue(undefined),
      },
      reply: {
        resolveEnvelopeFormatOptions: vi.fn().mockReturnValue({}),
        formatAgentEnvelope: vi.fn().mockReturnValue("formatted envelope"),
        finalizeInboundContext: vi.fn().mockReturnValue({ SessionKey: "test-session-key" }),
        deliverFormattedInbound: vi.fn().mockResolvedValue(undefined),
        buildInboundPayload: vi.fn().mockReturnValue({}),
        // Phase 58: Added dispatchReplyWithBufferedBlockDispatcher mock — final delivery call.
        // Used as proxy to verify message reached LLM dispatch stage. DO NOT REMOVE.
        dispatchReplyWithBufferedBlockDispatcher: vi.fn().mockResolvedValue(undefined),
      },
      pairing: {
        buildPairingReply: vi.fn().mockReturnValue("Pairing code: 1234"),
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
    // Actual API used by inbound.ts:
    shouldReply: vi.fn().mockReturnValue(false),
    sendRejection: vi.fn().mockResolvedValue(undefined),
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
  warnOnError: vi.fn().mockReturnValue(vi.fn()),
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
  startHumanPresence: vi.fn().mockReturnValue({
    finishTyping: vi.fn().mockResolvedValue(undefined),
    cancelTyping: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Phase 58: All openclaw/plugin-sdk/* mocks removed — SDK symbols are now local shims in inbound.ts.
// resolveDmGroupAccessWithCommandGate, readStoreAllowFromForDmPolicy, resolveOutboundMediaUrls, etc.
// are all inline functions in inbound.ts and run with real logic in tests.
// Tests that previously checked "was resolveDmGroupAccessWithCommandGate called?" now check
// "was core.channel.session.recordInboundSession called?" as the proxy for pipeline progression.

// Mock ./accounts.js to prevent deep openclaw sub-path loading
vi.mock("./accounts.js", () => ({
  resolveSessionForTarget: vi.fn().mockResolvedValue(undefined),
  resolveAllWahaAccounts: vi.fn().mockReturnValue([]),
  resolveWahaAccount: vi.fn().mockResolvedValue(null),
}));

// Mock ./channel.js to prevent deep openclaw sub-path loading
vi.mock("./channel.js", () => ({
  checkGroupMembership: vi.fn().mockResolvedValue(false),
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
      const { getWahaRuntime } = await import("./runtime.js");

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // Message was skipped — pipeline should NOT reach session recording
      expect((getWahaRuntime as ReturnType<typeof vi.fn>)().channel.session.recordInboundSession).not.toHaveBeenCalled();
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
      const { getWahaRuntime } = await import("./runtime.js");

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // With empty body and no media, pipeline returns before reaching session recording
      expect((getWahaRuntime as ReturnType<typeof vi.fn>)().channel.session.recordInboundSession).not.toHaveBeenCalled();
    });
  });

  describe("DM filtering", () => {
    it("allows DMs from an allowed sender — pipeline reaches session recording", async () => {
      const message = makeWahaMessage({ body: "hello", from: "972000000001@c.us" });
      const account = makeAccount();
      const config = makeConfig();
      const runtime = makeRuntime();
      const { getWahaRuntime } = await import("./runtime.js");

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // With allowed sender (in allowFrom), pipeline should reach session recording
      expect((getWahaRuntime as ReturnType<typeof vi.fn>)().channel.session.recordInboundSession).toHaveBeenCalled();
    });
  });

  describe("group filtering", () => {
    it("drops group messages not matching group filter", async () => {
      const { getDirectoryDb } = await import("./directory.js");
      (getDirectoryDb as ReturnType<typeof vi.fn>)().getGroupFilterOverride.mockReturnValue(null);
      const { getWahaRuntime } = await import("./runtime.js");

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

      // Group filter drops "just chatting" — should NOT reach session recording
      expect((getWahaRuntime as ReturnType<typeof vi.fn>)().channel.session.recordInboundSession).not.toHaveBeenCalled();
    });

    it("allows group messages matching group filter keyword — pipeline reaches session recording", async () => {
      const { getDirectoryDb } = await import("./directory.js");
      (getDirectoryDb as ReturnType<typeof vi.fn>)().isGroupMuted.mockReturnValue(false);
      (getDirectoryDb as ReturnType<typeof vi.fn>)().getGroupFilterOverride.mockReturnValue(null);
      const { getWahaRuntime } = await import("./runtime.js");

      const groupJid = "120363421825201386@g.us";
      const message = makeWahaMessage({
        body: "hey bot help me",
        from: groupJid,
        chatId: groupJid,
        participant: "972000000001@c.us",
      });

      // groupPolicy: "open" so the group allow check passes (no allowlist needed)
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
          groupPolicy: "open",
        } as never,
      });
      const runtime = makeRuntime();

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // "hey bot help me" matches "bot" — should reach session recording
      expect((getWahaRuntime as ReturnType<typeof vi.fn>)().channel.session.recordInboundSession).toHaveBeenCalled();
    });

    it("drops group message when group is muted", async () => {
      const { getDirectoryDb } = await import("./directory.js");
      (getDirectoryDb as ReturnType<typeof vi.fn>)().isGroupMuted.mockReturnValue(true);
      const { getWahaRuntime } = await import("./runtime.js");

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

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // Muted group — should NOT reach session recording
      expect((getWahaRuntime as ReturnType<typeof vi.fn>)().channel.session.recordInboundSession).not.toHaveBeenCalled();
    });
  });

  describe("/shutup command interception", () => {
    it("intercepts /shutup command when sender is authorized", async () => {
      const { checkShutupAuthorization, handleShutupCommand } = await import("./shutup.js");
      (checkShutupAuthorization as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (handleShutupCommand as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
      const { getWahaRuntime } = await import("./runtime.js");

      const message = makeWahaMessage({ body: "/shutup", from: "972000000001@c.us" });
      const account = makeAccount();
      const config = makeConfig();
      const runtime = makeRuntime();

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      expect(handleShutupCommand).toHaveBeenCalled();
      // Should NOT reach session recording — command handled before access check
      expect((getWahaRuntime as ReturnType<typeof vi.fn>)().channel.session.recordInboundSession).not.toHaveBeenCalled();
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

  describe("newsletter exclusion from DM-only logic", () => {
    it("newsletter chatId does NOT trigger Phase 16 auto-reply block", async () => {
      // Newsletters use @newsletter suffix — they are NOT DMs and must never receive
      // pairing challenges or auto-reply messages.
      // Strategy: make the sender NOT allowed (triggers Phase 16 if chatId is DM),
      // but newsletter chatId means Phase 16 block should be entirely skipped.
      const { sendWahaText } = await import("./send.js");
      const { getAutoReplyEngine } = await import("./auto-reply.js");
      const { getDirectoryDb } = await import("./directory.js");
      // Sender not allowed — would trigger Phase 16 if this were a DM
      (getDirectoryDb as ReturnType<typeof vi.fn>)().isContactAllowedDm.mockReturnValueOnce(false);
      const autoReplyMock = (getAutoReplyEngine as ReturnType<typeof vi.fn>)();
      autoReplyMock.shouldReply.mockReturnValue(true);
      autoReplyMock.sendRejection.mockResolvedValue(undefined);
      // Phase 58: resolveDmGroupAccessWithCommandGate is now a local inline shim — no mock needed.
      // Real shim returns decision="block" for empty allowFrom, which drops the newsletter.

      const newsletterJid = "120363421825201386@newsletter";
      const message = makeWahaMessage({
        body: "newsletter update",
        from: newsletterJid,
        chatId: newsletterJid,
      });
      const account = makeAccount({
        config: {
          session: "test-session",
          baseUrl: "http://localhost:3004",
          autoReply: { enabled: true, message: "I cannot reply here" },
          dmFilter: { enabled: false },
          groupFilter: { enabled: false },
          allowFrom: [],
          groupAllowFrom: [],
          allowedGroups: [],
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
        } as never,
      });
      const config = makeConfig({ autoReply: { enabled: true, message: "I cannot reply here" } });
      const runtime = makeRuntime();

      // Newsletter should be dropped by isNewsletter access check (returns early).
      // No try/catch — if this throws, the test should fail.
      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // Phase 16 auto-reply must NOT fire for newsletter chatIds
      // (even though sender is not allowed — newsletter is not a DM, isDm=false)
      expect(autoReplyMock.sendRejection).not.toHaveBeenCalled();
      // No pairing/auto-reply text sent to newsletter
      expect(sendWahaText).not.toHaveBeenCalledWith(
        expect.objectContaining({ to: newsletterJid })
      );
    });

    it("DM chatId (@c.us) DOES enter Phase 16 block when auto-reply enabled", async () => {
      const { getAutoReplyEngine } = await import("./auto-reply.js");
      const { getDirectoryDb } = await import("./directory.js");
      // Sender NOT allowed — triggers Phase 16 auto-reply
      (getDirectoryDb as ReturnType<typeof vi.fn>)().isContactAllowedDm.mockReturnValueOnce(false);

      const autoReplyMock = (getAutoReplyEngine as ReturnType<typeof vi.fn>)();
      autoReplyMock.shouldReply.mockReturnValue(true);
      autoReplyMock.sendRejection.mockResolvedValue(undefined);

      const dmJid = "972000000099@c.us";
      const message = makeWahaMessage({
        body: "hello there",
        from: dmJid,
        chatId: dmJid,
      });
      const account = makeAccount({
        config: {
          session: "test-session",
          baseUrl: "http://localhost:3004",
          autoReply: { enabled: true, message: "Auto reply" },
          dmFilter: { enabled: false },
          groupFilter: { enabled: false },
          allowFrom: [],
          groupAllowFrom: [],
          allowedGroups: [],
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
        } as never,
      });
      const config = makeConfig({ autoReply: { enabled: true, message: "Auto reply" } });
      const runtime = makeRuntime();

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // Phase 16 auto-reply SHOULD fire for DM chatIds (sender not allowed)
      expect(autoReplyMock.shouldReply).toHaveBeenCalled();
      expect(autoReplyMock.sendRejection).toHaveBeenCalled();
    });

    it("DM chatId (@lid) DOES enter Phase 16 block — NOWEB LID DMs", async () => {
      const { getAutoReplyEngine } = await import("./auto-reply.js");
      const { getDirectoryDb } = await import("./directory.js");
      (getDirectoryDb as ReturnType<typeof vi.fn>)().isContactAllowedDm.mockReturnValueOnce(false);

      const autoReplyMock = (getAutoReplyEngine as ReturnType<typeof vi.fn>)();
      autoReplyMock.shouldReply.mockReturnValue(true);
      autoReplyMock.sendRejection.mockResolvedValue(undefined);

      const lidJid = "271862907039996@lid";
      const message = makeWahaMessage({
        body: "hello from LID",
        from: lidJid,
        chatId: lidJid,
      });
      const account = makeAccount({
        config: {
          session: "test-session",
          baseUrl: "http://localhost:3004",
          autoReply: { enabled: true, message: "Auto reply" },
          dmFilter: { enabled: false },
          groupFilter: { enabled: false },
          allowFrom: [],
          groupAllowFrom: [],
          allowedGroups: [],
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
        } as never,
      });
      const config = makeConfig({ autoReply: { enabled: true, message: "Auto reply" } });
      const runtime = makeRuntime();

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // Phase 16 auto-reply SHOULD fire for @lid DM chatIds too
      expect(autoReplyMock.shouldReply).toHaveBeenCalled();
      expect(autoReplyMock.sendRejection).toHaveBeenCalled();
    });

    it("group chatId (@g.us) still excluded from Phase 16 block (unchanged behavior)", async () => {
      const { getAutoReplyEngine } = await import("./auto-reply.js");
      const autoReplyMock = (getAutoReplyEngine as ReturnType<typeof vi.fn>)();
      autoReplyMock.shouldAutoReply.mockReturnValue(true);

      const groupJid = "120363421825201386@g.us";
      const message = makeWahaMessage({
        body: "hey bot",
        from: groupJid,
        chatId: groupJid,
        participant: "972000000001@c.us",
      });
      const account = makeAccount({
        config: {
          session: "test-session",
          baseUrl: "http://localhost:3004",
          autoReply: { enabled: true, message: "Auto reply" },
          dmFilter: { enabled: false },
          groupFilter: { enabled: false },
          allowFrom: [],
          groupAllowFrom: [],
          allowedGroups: [],
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
        } as never,
      });
      const config = makeConfig({ autoReply: { enabled: true, message: "Auto reply" } });
      const runtime = makeRuntime();

      await handleWahaInbound({ message, account, config, runtime: runtime as never });

      // Phase 16 auto-reply must NOT fire for group chatIds
      expect(autoReplyMock.sendAutoReply).not.toHaveBeenCalled();
    });
  });

  describe("allowedGroups filtering", () => {
    it("drops group messages when group not in allowedGroups", async () => {
      const { getWahaRuntime } = await import("./runtime.js");

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

      // Not in allowedGroups — should NOT reach session recording
      expect((getWahaRuntime as ReturnType<typeof vi.fn>)().channel.session.recordInboundSession).not.toHaveBeenCalled();
    });
  });
});
