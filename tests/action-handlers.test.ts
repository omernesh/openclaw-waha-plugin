/**
 * action-handlers.test.ts
 * Tests for Phase 5 Plan 01: integration tests for send, poll, edit, search action handlers.
 *
 * Covers:
 *  - send handler: happy path (calls sendWahaText) and error path
 *  - poll handler: happy path (calls sendWahaPoll) and error path
 *  - edit handler: happy path (calls editWahaMessage) and error path
 *  - search handler: happy path (calls resolveWahaTarget) and error path
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock functions so they are available inside vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockSendWahaText,
  mockSendWahaPoll,
  mockEditWahaMessage,
  mockResolveWahaTarget,
} = vi.hoisted(() => ({
  mockSendWahaText: vi.fn(),
  mockSendWahaPoll: vi.fn(),
  mockEditWahaMessage: vi.fn(),
  mockResolveWahaTarget: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock all dependencies before importing channel.ts
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
  sendWahaText: mockSendWahaText,
  sendWahaPoll: mockSendWahaPoll,
  editWahaMessage: mockEditWahaMessage,
  resolveWahaTarget: mockResolveWahaTarget,
  // Stub all other exports with no-ops
  sendWahaMediaBatch: vi.fn(),
  sendWahaImage: vi.fn(),
  sendWahaVideo: vi.fn(),
  sendWahaFile: vi.fn(),
  sendWahaReaction: vi.fn(),
  sendWahaPollVote: vi.fn(),
  sendWahaLocation: vi.fn(),
  sendWahaContactVcard: vi.fn(),
  sendWahaList: vi.fn(),
  forwardWahaMessage: vi.fn(),
  sendWahaLinkPreview: vi.fn(),
  sendWahaButtonsReply: vi.fn(),
  sendWahaEvent: vi.fn(),
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
  toArr: vi.fn((v: unknown) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>) : [])),
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
// Import module under test (after mocks)
// ---------------------------------------------------------------------------

import { wahaPlugin } from "../src/channel.js";
import type { CoreConfig } from "../src/types.js";

type ActionResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

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
// send handler tests
// ---------------------------------------------------------------------------

describe("send action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: calls sendWahaText with the correct chatId and text", async () => {
    mockSendWahaText.mockResolvedValue({ key: { id: "msg-abc" } });

    const result = await wahaPlugin.actions.handleAction({
      action: "send",
      params: { chatId: "972544329000@c.us", text: "hello" },
      cfg: makeCfg(),
      accountId: undefined,
    });

    expect(mockSendWahaText).toHaveBeenCalledOnce();
    expect(mockSendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ to: "972544329000@c.us", text: "hello" })
    );
    expect((result as ActionResult).content[0].text).toContain("msg-abc");
  });

  it("error path: returns formatted error when sendWahaText throws", async () => {
    mockSendWahaText.mockRejectedValue(new Error("WAHA unreachable"));

    const result = await wahaPlugin.actions.handleAction({
      action: "send",
      params: { chatId: "972544329000@c.us", text: "hello" },
      cfg: makeCfg(),
      accountId: undefined,
    });

    // Error is formatted and returned (not thrown to caller)
    expect((result as ActionResult).content[0].text).toContain("WAHA unreachable");
  });
});

// ---------------------------------------------------------------------------
// poll handler tests
// ---------------------------------------------------------------------------

describe("poll action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: calls sendWahaPoll with correct chatId, name, and options", async () => {
    mockSendWahaPoll.mockResolvedValue({ key: { id: "poll-xyz" } });

    const result = await wahaPlugin.actions.handleAction({
      action: "poll",
      params: {
        chatId: "120363421825201386@g.us",
        pollQuestion: "Vote?",
        pollOption: ["A", "B", "C"],
      },
      cfg: makeCfg(),
      accountId: undefined,
    });

    expect(mockSendWahaPoll).toHaveBeenCalledOnce();
    expect(mockSendWahaPoll).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "120363421825201386@g.us",
        name: "Vote?",
        options: ["A", "B", "C"],
      })
    );
    expect((result as ActionResult).content[0].text).toContain("poll-xyz");
  });

  it("error path: returns formatted error when sendWahaPoll throws", async () => {
    mockSendWahaPoll.mockRejectedValue(new Error("Poll creation failed"));

    const result = await wahaPlugin.actions.handleAction({
      action: "poll",
      params: {
        chatId: "120363421825201386@g.us",
        pollQuestion: "Vote?",
        pollOption: ["A", "B"],
      },
      cfg: makeCfg(),
      accountId: undefined,
    });

    expect((result as ActionResult).content[0].text).toContain("Poll creation failed");
  });
});

// ---------------------------------------------------------------------------
// edit handler tests
// ---------------------------------------------------------------------------

describe("edit action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: calls editWahaMessage with correct chatId, messageId, and text", async () => {
    mockEditWahaMessage.mockResolvedValue({ key: { id: "true_xxx_yyy" } });

    const result = await wahaPlugin.actions.handleAction({
      action: "edit",
      params: {
        chatId: "972544329000@c.us",
        messageId: "true_972544329000@c.us_abc123",
        text: "edited text",
      },
      cfg: makeCfg(),
      accountId: undefined,
    });

    expect(mockEditWahaMessage).toHaveBeenCalledOnce();
    expect(mockEditWahaMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "972544329000@c.us",
        messageId: "true_972544329000@c.us_abc123",
        text: "edited text",
      })
    );
    expect((result as ActionResult).content[0].text).toContain("true_xxx_yyy");
  });

  it("error path: returns formatted error when editWahaMessage throws", async () => {
    mockEditWahaMessage.mockRejectedValue(new Error("Message not found"));

    const result = await wahaPlugin.actions.handleAction({
      action: "edit",
      params: {
        chatId: "972544329000@c.us",
        messageId: "true_972544329000@c.us_abc123",
        text: "edited",
      },
      cfg: makeCfg(),
      accountId: undefined,
    });

    expect((result as ActionResult).content[0].text).toContain("Message not found");
  });
});

// ---------------------------------------------------------------------------
// search handler tests
// search has gateway mode "none" — no target, receives only parameters
// ---------------------------------------------------------------------------

describe("search action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: calls resolveWahaTarget and returns results", async () => {
    const matches = [
      { jid: "120363421825201386@g.us", name: "Test Group", confidence: 0.9 },
    ];
    mockResolveWahaTarget.mockResolvedValue({ matches, query: "test", searchedTypes: ["group"] });

    const result = await wahaPlugin.actions.handleAction({
      action: "search",
      params: { query: "test" },
      cfg: makeCfg(),
      accountId: undefined,
    });

    expect(mockResolveWahaTarget).toHaveBeenCalledOnce();
    expect(mockResolveWahaTarget).toHaveBeenCalledWith(
      expect.objectContaining({ query: "test" })
    );
    const parsed = JSON.parse((result as ActionResult).content[0].text);
    expect(parsed.matches).toEqual(matches);
  });

  it("error path: returns formatted error when resolveWahaTarget throws", async () => {
    mockResolveWahaTarget.mockRejectedValue(new Error("WAHA search failed"));

    const result = await wahaPlugin.actions.handleAction({
      action: "search",
      params: { query: "test" },
      cfg: makeCfg(),
      accountId: undefined,
    });

    expect((result as ActionResult).content[0].text).toContain("WAHA search failed");
  });
});
