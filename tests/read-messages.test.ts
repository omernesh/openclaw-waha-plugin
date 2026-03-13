/**
 * read-messages.test.ts
 * Tests for Phase 4 Plan 03: readMessages utility action in channel.ts.
 *
 * Covers:
 *  - readMessages maps API response to lean format {from, text, timestamp}
 *  - Default limit is 10
 *  - Limit is capped at 50
 *  - Limit minimum is 1
 *  - readMessages is registered in UTILITY_ACTIONS (accessible via action dispatch)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock functions so they are available inside vi.mock factories
// ---------------------------------------------------------------------------
const { mockGetWahaChatMessages, mockResolveWahaTarget, mockSendWahaText } = vi.hoisted(() => ({
  mockGetWahaChatMessages: vi.fn(),
  mockResolveWahaTarget: vi.fn(),
  mockSendWahaText: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock all heavy dependencies before importing channel.ts
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
  getWahaChatMessages: mockGetWahaChatMessages,
  resolveWahaTarget: mockResolveWahaTarget,
  sendWahaText: mockSendWahaText,
  // Stub all other exports with no-ops
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
  formatActionError: vi.fn((err: unknown) => String(err)),
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
// Import module under test
// ---------------------------------------------------------------------------
import { wahaPlugin } from "../src/channel.js";
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
// Tests
// ---------------------------------------------------------------------------

describe("readMessages action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps WAHA API response to lean format {from, text, timestamp}", async () => {
    const rawMessages = [
      { from: "alice@c.us", body: "Hello", timestamp: 1700000001 },
      { from: "bob@c.us", body: "World", timestamp: 1700000002 },
    ];
    mockGetWahaChatMessages.mockResolvedValue(rawMessages);

    const result = await wahaPlugin.actions.handleAction({
      action: "readMessages",
      params: { chatId: "some-chat@g.us", limit: 2 },
      cfg: makeCfg(),
      accountId: undefined,
    });

    // Result is wrapped in content array
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed).toEqual([
      { from: "alice@c.us", text: "Hello", timestamp: 1700000001 },
      { from: "bob@c.us", text: "World", timestamp: 1700000002 },
    ]);
  });

  it("defaults to limit=10 when no limit specified", async () => {
    mockGetWahaChatMessages.mockResolvedValue([]);

    await wahaPlugin.actions.handleAction({
      action: "readMessages",
      params: { chatId: "some-chat@g.us" },
      cfg: makeCfg(),
      accountId: undefined,
    });

    expect(mockGetWahaChatMessages).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 })
    );
  });

  it("caps limit at 50", async () => {
    mockGetWahaChatMessages.mockResolvedValue([]);

    await wahaPlugin.actions.handleAction({
      action: "readMessages",
      params: { chatId: "some-chat@g.us", limit: 100 },
      cfg: makeCfg(),
      accountId: undefined,
    });

    expect(mockGetWahaChatMessages).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 })
    );
  });

  it("enforces minimum limit of 1", async () => {
    mockGetWahaChatMessages.mockResolvedValue([]);

    await wahaPlugin.actions.handleAction({
      action: "readMessages",
      params: { chatId: "some-chat@g.us", limit: 0 },
      cfg: makeCfg(),
      accountId: undefined,
    });

    expect(mockGetWahaChatMessages).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 })
    );
  });

  it("is registered in UTILITY_ACTIONS (supportsAction returns true)", () => {
    expect(wahaPlugin.actions.supportsAction({ action: "readMessages" })).toBe(true);
  });

  it("appears in listActions output", () => {
    const actions = wahaPlugin.actions.listActions();
    expect(actions).toContain("readMessages");
  });

  it("uses 'unknown' for from when neither from nor _data.notifyName is present", async () => {
    const rawMessages = [{ body: "orphan message", timestamp: 12345 }];
    mockGetWahaChatMessages.mockResolvedValue(rawMessages);

    const result = await wahaPlugin.actions.handleAction({
      action: "readMessages",
      params: { chatId: "some-chat@g.us", limit: 1 },
      cfg: makeCfg(),
      accountId: undefined,
    });

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed[0].from).toBe("unknown");
  });
});
