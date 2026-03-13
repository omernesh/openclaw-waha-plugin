/**
 * channel-utils.test.ts
 * Tests for Phase 5 Plan 01: resolveChatId and autoResolveTarget utilities in channel.ts.
 *
 * Covers:
 *  - resolveChatId: resolution priority (chatId > to > toolContext.currentChannelId > "")
 *  - autoResolveTarget: JID passthrough and fuzzy name resolution via resolveWahaTarget
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock functions so they are available inside vi.mock factories
// ---------------------------------------------------------------------------

const { mockResolveWahaTarget } = vi.hoisted(() => ({
  mockResolveWahaTarget: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock all dependencies that channel.ts imports
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
    buildBaseChannelStatusSummary: vi.fn(() => ({ accounts: [] })),
    buildChannelConfigSchema: vi.fn((schema: unknown) => schema),
    createDefaultChannelRuntimeState: vi.fn(() => ({})),
    deleteAccountFromConfigSection: vi.fn(),
    formatPairingApproveHint: vi.fn(() => ""),
    resolveDefaultGroupPolicy: vi.fn(() => "open"),
    setAccountEnabledInConfigSection: vi.fn(),
    waitUntilAbort: vi.fn(),
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

vi.mock("../src/send.js", () => ({
  resolveWahaTarget: mockResolveWahaTarget,
  // Stub all other exports with no-ops
  sendWahaText: vi.fn(),
  sendWahaMediaBatch: vi.fn(),
  sendWahaImage: vi.fn(),
  sendWahaVideo: vi.fn(),
  sendWahaFile: vi.fn(),
  sendWahaReaction: vi.fn(),
  sendWahaPoll: vi.fn(),
  sendWahaPollVote: vi.fn(),
  sendWahaLocation: vi.fn(),
  sendWahaContactVcard: vi.fn(),
  sendWahaList: vi.fn(),
  forwardWahaMessage: vi.fn(),
  sendWahaLinkPreview: vi.fn(),
  sendWahaButtonsReply: vi.fn(),
  sendWahaEvent: vi.fn(),
  editWahaMessage: vi.fn(),
  deleteWahaMessage: vi.fn(),
  pinWahaMessage: vi.fn(),
  unpinWahaMessage: vi.fn(),
  starWahaMessage: vi.fn(),
  getWahaChats: vi.fn(),
  getWahaChatsOverview: vi.fn(),
  getWahaChatMessages: vi.fn(),
  getWahaChatMessage: vi.fn(),
  deleteWahaChat: vi.fn(),
  clearWahaChatMessages: vi.fn(),
  archiveWahaChat: vi.fn(),
  unarchiveWahaChat: vi.fn(),
  unreadWahaChat: vi.fn(),
  readWahaChatMessages: vi.fn(),
  getWahaChatPicture: vi.fn(),
  createWahaGroup: vi.fn(),
  getWahaGroups: vi.fn(),
  getWahaGroup: vi.fn(),
  deleteWahaGroup: vi.fn(),
  leaveWahaGroup: vi.fn(),
  setWahaGroupSubject: vi.fn(),
  setWahaGroupDescription: vi.fn(),
  setWahaGroupPicture: vi.fn(),
  deleteWahaGroupPicture: vi.fn(),
  getWahaGroupPicture: vi.fn(),
  addWahaGroupParticipants: vi.fn(),
  removeWahaGroupParticipants: vi.fn(),
  promoteWahaGroupAdmin: vi.fn(),
  demoteWahaGroupAdmin: vi.fn(),
  getWahaGroupParticipants: vi.fn(),
  setWahaGroupInfoAdminOnly: vi.fn(),
  getWahaGroupInfoAdminOnly: vi.fn(),
  setWahaGroupMessagesAdminOnly: vi.fn(),
  getWahaGroupMessagesAdminOnly: vi.fn(),
  getWahaGroupInviteCode: vi.fn(),
  revokeWahaGroupInviteCode: vi.fn(),
  joinWahaGroup: vi.fn(),
  getWahaGroupsCount: vi.fn(),
  getWahaContacts: vi.fn(),
  getWahaContact: vi.fn(),
  checkWahaContactExists: vi.fn(),
  getWahaContactAbout: vi.fn(),
  getWahaContactPicture: vi.fn(),
  blockWahaContact: vi.fn(),
  unblockWahaContact: vi.fn(),
  getWahaLabels: vi.fn(),
  createWahaLabel: vi.fn(),
  updateWahaLabel: vi.fn(),
  deleteWahaLabel: vi.fn(),
  getWahaChatLabels: vi.fn(),
  setWahaChatLabels: vi.fn(),
  getWahaChatsByLabel: vi.fn(),
  sendWahaTextStatus: vi.fn(),
  sendWahaImageStatus: vi.fn(),
  sendWahaVoiceStatus: vi.fn(),
  sendWahaVideoStatus: vi.fn(),
  deleteWahaStatus: vi.fn(),
  getWahaChannels: vi.fn(),
  createWahaChannel: vi.fn(),
  getWahaChannel: vi.fn(),
  deleteWahaChannel: vi.fn(),
  followWahaChannel: vi.fn(),
  unfollowWahaChannel: vi.fn(),
  muteWahaChannel: vi.fn(),
  unmuteWahaChannel: vi.fn(),
  muteWahaChat: vi.fn(),
  unmuteWahaChat: vi.fn(),
  searchWahaChannelsByText: vi.fn(),
  previewWahaChannelMessages: vi.fn(),
  setWahaPresenceStatus: vi.fn(),
  getWahaPresence: vi.fn(),
  subscribeWahaPresence: vi.fn(),
  getWahaProfile: vi.fn(),
  setWahaProfileName: vi.fn(),
  setWahaProfileStatus: vi.fn(),
  setWahaProfilePicture: vi.fn(),
  deleteWahaProfilePicture: vi.fn(),
  findWahaPhoneByLid: vi.fn(),
  findWahaLidByPhone: vi.fn(),
  getWahaAllLids: vi.fn(),
  rejectWahaCall: vi.fn(),
  assertCanSend: vi.fn(),
  toArr: vi.fn((v: unknown) => (Array.isArray(v) ? v : [])),
  fuzzyScore: vi.fn(),
}));

vi.mock("../src/http-client.js", () => ({
  callWahaApi: vi.fn(),
  warnOnError: vi.fn(),
  configureReliability: vi.fn(),
}));

vi.mock("../src/monitor.js", () => ({
  monitorWahaProvider: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock("../src/runtime.js", () => ({
  getWahaRuntime: vi.fn(() => ({
    config: { readConfigFileSnapshot: vi.fn() },
  })),
}));

vi.mock("../src/normalize.js", () => ({
  normalizeWahaAllowEntry: vi.fn((e: string) => e),
  normalizeWahaMessagingTarget: vi.fn((t: string) => t),
}));

vi.mock("../src/error-formatter.js", () => ({
  formatActionError: vi.fn((err: unknown, _opts?: Record<string, unknown>) => String(err)),
}));

vi.mock("../src/accounts.js", async () => {
  const actual = await vi.importActual("../src/accounts.js");
  return {
    ...actual,
    resolveSessionForTarget: vi.fn(),
    clearMembershipCache: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Import modules under test (after mocks)
// ---------------------------------------------------------------------------

import { resolveChatId, autoResolveTarget } from "../src/channel.js";
import type { CoreConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCfg(): CoreConfig {
  return {
    channels: {
      waha: {
        baseUrl: "http://localhost:3004",
        apiKey: "test-key",
        session: "test-session",
        enabled: true,
      },
    },
  } as unknown as CoreConfig;
}

// ---------------------------------------------------------------------------
// resolveChatId tests
// ---------------------------------------------------------------------------

describe("resolveChatId", () => {
  it("returns params.chatId when present", () => {
    expect(resolveChatId({ chatId: "123@c.us", to: "other@c.us" })).toBe("123@c.us");
  });

  it("returns params.to when chatId is absent", () => {
    expect(resolveChatId({ to: "other@c.us" })).toBe("other@c.us");
  });

  it("returns toolContext.currentChannelId as fallback when both chatId and to are absent", () => {
    expect(resolveChatId({}, { currentChannelId: "ctx-channel@g.us" })).toBe("ctx-channel@g.us");
  });

  it("returns empty string when no chatId source is available", () => {
    expect(resolveChatId({})).toBe("");
  });
});

// ---------------------------------------------------------------------------
// autoResolveTarget tests
// ---------------------------------------------------------------------------

describe("autoResolveTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a JID as-is when input already looks like a JID (contains @)", async () => {
    const jid = "120363421825201386@g.us";
    const result = await autoResolveTarget(jid, makeCfg());
    expect(result).toBe(jid);
    // resolveWahaTarget should NOT be called for JID inputs
    expect(mockResolveWahaTarget).not.toHaveBeenCalled();
  });

  it("returns a phone number as-is without calling resolveWahaTarget", async () => {
    const phone = "+972544329000";
    const result = await autoResolveTarget(phone, makeCfg());
    expect(result).toBe(phone);
    expect(mockResolveWahaTarget).not.toHaveBeenCalled();
  });

  it("calls resolveWahaTarget and returns resolved JID for a human-readable name", async () => {
    mockResolveWahaTarget.mockResolvedValue({
      matches: [{ jid: "resolved@g.us", name: "Sammie Group", confidence: 0.9 }],
    });

    const result = await autoResolveTarget("sammie group", makeCfg());
    expect(mockResolveWahaTarget).toHaveBeenCalledOnce();
    expect(result).toBe("resolved@g.us");
  });

  it("returns a bare phone number (no +) as-is", async () => {
    const result = await autoResolveTarget("972544329000", makeCfg());
    expect(result).toBe("972544329000");
    expect(mockResolveWahaTarget).not.toHaveBeenCalled();
  });

  it("triggers name resolution for short numbers (< 6 digits)", async () => {
    mockResolveWahaTarget.mockResolvedValue({ matches: [{ jid: "12345@c.us", name: "Short", confidence: 1 }] });
    const result = await autoResolveTarget("12345", makeCfg());
    expect(result).toBe("12345@c.us");
    expect(mockResolveWahaTarget).toHaveBeenCalled();
  });

  it("returns exactly 6 digits as phone (PHONE_RE boundary: {6,})", async () => {
    const result = await autoResolveTarget("123456", makeCfg());
    expect(result).toBe("123456");
    expect(mockResolveWahaTarget).not.toHaveBeenCalled();
  });

  it("throws an error when resolveWahaTarget finds no matches", async () => {
    mockResolveWahaTarget.mockResolvedValue({ matches: [] });

    await expect(autoResolveTarget("unknown contact", makeCfg())).rejects.toThrow(
      /Could not resolve "unknown contact"/
    );
  });
});
