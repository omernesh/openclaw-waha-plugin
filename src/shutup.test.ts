/**
 * shutup.ts interactive flow test suite.
 * Mocks: send.js, directory.js, accounts.js, http-client.js, runtime.js
 * Phase 31 (TST-04): Shutup command flow tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock declarations BEFORE importing the module under test ──

vi.mock("./send.js", () => ({
  sendWahaText: vi.fn().mockResolvedValue(undefined),
  getWahaGroupParticipants: vi.fn().mockResolvedValue([]),
}));

vi.mock("./http-client.js", () => ({
  callWahaApi: vi.fn().mockResolvedValue({}),
  warnOnError: vi.fn(() => () => undefined),
}));

vi.mock("./runtime.js", () => ({
  getRuntime: vi.fn(),
}));

// Mock accounts — returns a predictable list of enabled accounts
vi.mock("./accounts.js", () => ({
  listEnabledWahaAccounts: vi.fn(() => [
    { accountId: "acct1", session: "sess1", baseUrl: "http://localhost:3000", apiKey: "key1", role: "bot" },
  ]),
  resolveWahaAccount: vi.fn(),
  resolveAccountSession: vi.fn(),
}));

// Mock directory — returns a controllable in-memory store
const mockMutedGroups: Map<string, { groupJid: string; mutedBy: string; expiresAt: number; accountId: string; dmBackup: Record<string, boolean> | null }> = new Map();
const mockPendingSelections: Map<string, { type: string; groups: { jid: string; name: string }[]; durationStr: string | null; timestamp: number }> = new Map();
const mockDmSettings: Map<string, { canInitiate: boolean }> = new Map();
const mockContacts: Set<string> = new Set();

const mockDirDb = {
  isGroupMuted: vi.fn((jid: string) => mockMutedGroups.has(jid)),
  muteGroup: vi.fn((groupJid: string, mutedBy: string, accountId: string, expiresAt: number, dmBackup: Record<string, boolean> | null) => {
    mockMutedGroups.set(groupJid, { groupJid, mutedBy, accountId, expiresAt, dmBackup: dmBackup ?? null });
  }),
  unmuteGroup: vi.fn((groupJid: string) => {
    const entry = mockMutedGroups.get(groupJid);
    mockMutedGroups.delete(groupJid);
    return entry?.dmBackup ?? null;
  }),
  getAllMutedGroups: vi.fn(() => [...mockMutedGroups.values()]),
  getPendingSelection: vi.fn((senderJid: string) => {
    const entry = mockPendingSelections.get(senderJid);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > 60_000) {
      mockPendingSelections.delete(senderJid);
      return null;
    }
    return { ...entry, senderId: senderJid };
  }),
  setPendingSelection: vi.fn((senderJid: string, sel: { type: string; groups: { jid: string; name: string }[]; durationStr: string | null }) => {
    mockPendingSelections.set(senderJid, { ...sel, timestamp: Date.now() });
  }),
  clearPendingSelection: vi.fn((senderJid: string) => {
    mockPendingSelections.delete(senderJid);
  }),
  getContactDmSettings: vi.fn((jid: string) => ({
    mode: "active" as const,
    mentionOnly: false,
    customKeywords: "",
    canInitiate: mockDmSettings.get(jid)?.canInitiate ?? true,
    canInitiateOverride: "default" as const,
  })),
  setContactDmSettings: vi.fn((jid: string, settings: Partial<{ canInitiate: boolean }>) => {
    mockDmSettings.set(jid, { canInitiate: settings.canInitiate ?? true });
  }),
  upsertContact: vi.fn((jid: string) => { mockContacts.add(jid); }),
  getContact: vi.fn((jid: string) => mockContacts.has(jid) ? { jid, displayName: jid } : null),
  getGroupParticipantJids: vi.fn((_groupJid: string) => []),
};

vi.mock("./directory.js", () => ({
  getDirectoryDb: vi.fn(() => mockDirDb),
}));

// ── Import module under test AFTER mocks ──
import {
  SHUTUP_RE,
  checkPendingSelection,
  clearPendingSelection,
  checkShutupAuthorization,
  handleShutupCommand,
  handleSelectionResponse,
} from "./shutup.js";
import { sendWahaText } from "./send.js";
import type { CoreConfig } from "./types.js";
import type { ResolvedWahaAccount } from "./accounts.js";

// ── Test fixtures ──

const mockRuntime = { log: vi.fn() };

function makeConfig(overrides?: Partial<CoreConfig["channels"]>): CoreConfig {
  return {
    channels: {
      waha: {
        accounts: {
          acct1: {
            session: "sess1",
            baseUrl: "http://localhost:3000",
            apiKey: "key1",
            enabled: true,
          },
        },
        dmFilter: {
          enabled: false,
          godModeSuperUsers: [{ identifier: "972544329000" }],
        },
        groupFilter: {
          enabled: false,
        },
        ...(overrides ?? {}),
      },
    } as CoreConfig["channels"],
  } as CoreConfig;
}

function makeAccount(): ResolvedWahaAccount {
  return {
    accountId: "acct1",
    session: "sess1",
    baseUrl: "http://localhost:3000",
    apiKey: "key1",
    role: "bot",
  } as ResolvedWahaAccount;
}

// ── Setup / teardown ──

beforeEach(() => {
  mockMutedGroups.clear();
  mockPendingSelections.clear();
  mockDmSettings.clear();
  mockContacts.clear();
  vi.clearAllMocks();
  // Re-apply mock implementations after clearAllMocks
  mockDirDb.isGroupMuted.mockImplementation((jid: string) => mockMutedGroups.has(jid));
  mockDirDb.muteGroup.mockImplementation((groupJid: string, mutedBy: string, accountId: string, expiresAt: number, dmBackup: Record<string, boolean> | null) => {
    mockMutedGroups.set(groupJid, { groupJid, mutedBy, accountId, expiresAt, dmBackup: dmBackup ?? null });
  });
  mockDirDb.unmuteGroup.mockImplementation((groupJid: string) => {
    const entry = mockMutedGroups.get(groupJid);
    mockMutedGroups.delete(groupJid);
    return entry?.dmBackup ?? null;
  });
  mockDirDb.getAllMutedGroups.mockImplementation(() => [...mockMutedGroups.values()]);
  mockDirDb.getPendingSelection.mockImplementation((senderJid: string) => {
    const entry = mockPendingSelections.get(senderJid);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > 60_000) {
      mockPendingSelections.delete(senderJid);
      return null;
    }
    return { ...entry, senderId: senderJid };
  });
  mockDirDb.setPendingSelection.mockImplementation((senderJid: string, sel: { type: string; groups: { jid: string; name: string }[]; durationStr: string | null }) => {
    mockPendingSelections.set(senderJid, { ...sel, timestamp: Date.now() });
  });
  mockDirDb.clearPendingSelection.mockImplementation((senderJid: string) => {
    mockPendingSelections.delete(senderJid);
  });
  mockDirDb.getContactDmSettings.mockImplementation((jid: string) => ({
    mode: "active" as const,
    mentionOnly: false,
    customKeywords: "",
    canInitiate: mockDmSettings.get(jid)?.canInitiate ?? true,
    canInitiateOverride: "default" as const,
  }));
  mockDirDb.setContactDmSettings.mockImplementation((jid: string, settings: Partial<{ canInitiate: boolean }>) => {
    mockDmSettings.set(jid, { canInitiate: settings.canInitiate ?? true });
  });
  mockDirDb.upsertContact.mockImplementation((jid: string) => { mockContacts.add(jid); });
  mockDirDb.getContact.mockImplementation((jid: string) => mockContacts.has(jid) ? { jid, displayName: jid } : null);
  mockDirDb.getGroupParticipantJids.mockImplementation((_groupJid: string) => []);
  (sendWahaText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

// ── SHUTUP_RE regex tests ──

describe("SHUTUP_RE regex", () => {
  it("matches /shutup", () => {
    expect(SHUTUP_RE.test("/shutup")).toBe(true);
  });

  it("matches /unshutup", () => {
    expect(SHUTUP_RE.test("/unshutup")).toBe(true);
  });

  it("matches /unmute", () => {
    expect(SHUTUP_RE.test("/unmute")).toBe(true);
  });

  it("matches /shutup all", () => {
    expect(SHUTUP_RE.test("/shutup all")).toBe(true);
  });

  it("matches /shutup 30m", () => {
    expect(SHUTUP_RE.test("/shutup 30m")).toBe(true);
  });

  it("matches /shutup all 2h", () => {
    expect(SHUTUP_RE.test("/shutup all 2h")).toBe(true);
  });

  it("matches /shutup 1d", () => {
    expect(SHUTUP_RE.test("/shutup 1d")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(SHUTUP_RE.test("/SHUTUP")).toBe(true);
  });

  it("rejects non-matching strings", () => {
    expect(SHUTUP_RE.test("shutup")).toBe(false); // no leading slash
    expect(SHUTUP_RE.test("/mute")).toBe(false); // wrong command
    expect(SHUTUP_RE.test("/shutup extra words here")).toBe(false); // too many words
    expect(SHUTUP_RE.test("")).toBe(false); // empty
  });

  it("captures command, all flag, and duration from /shutup all 30m", () => {
    const match = "/shutup all 30m".match(SHUTUP_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("shutup");
    expect(match![2]).toBe("all");
    expect(match![3]).toBe("30m");
  });

  it("captures duration from /shutup 2h (no all flag)", () => {
    const match = "/shutup 2h".match(SHUTUP_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("shutup");
    expect(match![2]).toBeUndefined();
    expect(match![3]).toBe("2h");
  });
});

// ── checkPendingSelection ──

describe("checkPendingSelection", () => {
  it("returns null when no pending selection exists", () => {
    const config = makeConfig();
    const result = checkPendingSelection("nobody@c.us", config);
    expect(result).toBeNull();
  });

  it("returns pending record when one exists", () => {
    const config = makeConfig();
    // Store a pending selection in the mock DB
    mockPendingSelections.set("sender@c.us", {
      type: "mute",
      groups: [{ jid: "grp@g.us", name: "Test Group" }],
      durationStr: null,
      timestamp: Date.now(),
    });
    const result = checkPendingSelection("sender@c.us", config);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("mute");
  });

  it("returns null when no config provided", () => {
    const result = checkPendingSelection("sender@c.us");
    expect(result).toBeNull();
  });
});

// ── clearPendingSelection ──

describe("clearPendingSelection", () => {
  it("clears existing pending selection", () => {
    const config = makeConfig();
    mockPendingSelections.set("sender@c.us", {
      type: "mute",
      groups: [{ jid: "grp@g.us", name: "Group" }],
      durationStr: null,
      timestamp: Date.now(),
    });
    clearPendingSelection("sender@c.us", config);
    // mockDirDb.clearPendingSelection should have been called
    expect(mockDirDb.clearPendingSelection).toHaveBeenCalledWith("sender@c.us");
    // And the entry should be gone
    expect(mockPendingSelections.has("sender@c.us")).toBe(false);
  });
});

// ── checkShutupAuthorization ──

describe("checkShutupAuthorization", () => {
  it("god mode superuser is authorized", async () => {
    const config = makeConfig();
    const result = await checkShutupAuthorization("972544329000@c.us", "somechat", false, config, mockRuntime);
    expect(result).toBe(true);
  });

  it("non-god-mode user is rejected", async () => {
    const config = makeConfig();
    const result = await checkShutupAuthorization("999999999@c.us", "somechat", false, config, mockRuntime);
    expect(result).toBe(false);
  });

  it("user in allowFrom is authorized", async () => {
    const config: CoreConfig = {
      channels: {
        waha: {
          allowFrom: ["allowed@c.us"],
          dmFilter: { godModeSuperUsers: [] },
        },
      } as CoreConfig["channels"],
    } as CoreConfig;
    const result = await checkShutupAuthorization("allowed@c.us", "somechat", false, config, mockRuntime);
    expect(result).toBe(true);
  });
});

// ── handleShutupCommand — GROUP context ──

describe("handleShutupCommand (group context)", () => {
  it("/shutup in a group sends confirmation then mutes", async () => {
    const config = makeConfig();
    const account = makeAccount();

    await handleShutupCommand({
      command: "shutup",
      allFlag: false,
      durationStr: null,
      chatId: "grp@g.us",
      senderId: "972544329000@c.us",
      isGroup: true,
      account,
      config,
      runtime: mockRuntime,
    });

    // Confirmation should be sent
    expect(sendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ to: "grp@g.us", text: expect.stringContaining("Shutting up") })
    );
    // Group should be muted
    expect(mockDirDb.muteGroup).toHaveBeenCalledWith(
      "grp@g.us",
      "972544329000@c.us",
      "acct1",
      0,
      expect.anything()
    );
  });

  it("/unshutup in a group unmutes then sends confirmation", async () => {
    const config = makeConfig();
    const account = makeAccount();
    // Pre-mute the group
    mockMutedGroups.set("grp@g.us", { groupJid: "grp@g.us", mutedBy: "user", accountId: "acct1", expiresAt: 0, dmBackup: null });

    await handleShutupCommand({
      command: "unshutup",
      allFlag: false,
      durationStr: null,
      chatId: "grp@g.us",
      senderId: "972544329000@c.us",
      isGroup: true,
      account,
      config,
      runtime: mockRuntime,
    });

    // Group should be unmuted first
    expect(mockDirDb.unmuteGroup).toHaveBeenCalledWith("grp@g.us");
    // Confirmation sent after unmute
    expect(sendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ to: "grp@g.us", text: expect.stringContaining("back") })
    );
  });
});

// ── handleShutupCommand — DM context ──

describe("handleShutupCommand (DM context)", () => {
  it("/shutup in DM with no groups sends 'not in any groups' message", async () => {
    const config = makeConfig();
    const account = makeAccount();

    // callWahaApi returns empty groups dict
    const { callWahaApi } = await import("./http-client.js");
    (callWahaApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

    await handleShutupCommand({
      command: "shutup",
      allFlag: false,
      durationStr: null,
      chatId: "sender@c.us",
      senderId: "sender@c.us",
      isGroup: false,
      account,
      config,
      runtime: mockRuntime,
    });

    expect(sendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("not in any groups") })
    );
  });

  it("/shutup in DM shows group list when groups available", async () => {
    const config = makeConfig();
    const account = makeAccount();

    // callWahaApi returns two groups
    const { callWahaApi } = await import("./http-client.js");
    (callWahaApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      "grp1@g.us": { id: "grp1@g.us", subject: "Group 1" },
      "grp2@g.us": { id: "grp2@g.us", subject: "Group 2" },
    });

    await handleShutupCommand({
      command: "shutup",
      allFlag: false,
      durationStr: null,
      chatId: "sender@c.us",
      senderId: "sender@c.us",
      isGroup: false,
      account,
      config,
      runtime: mockRuntime,
    });

    // Should show list and create pending selection
    expect(sendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Group 1") })
    );
    expect(mockDirDb.setPendingSelection).toHaveBeenCalled();
  });
});

// ── handleSelectionResponse ──

describe("handleSelectionResponse", () => {
  const config = makeConfig();
  const account = makeAccount();

  function makePending(type: "mute" | "unmute" = "mute") {
    return {
      type,
      groups: [
        { jid: "grp1@g.us", name: "Group 1" },
        { jid: "grp2@g.us", name: "Group 2" },
      ],
      senderId: "sender@c.us",
      durationStr: null,
      timestamp: Date.now(),
    };
  }

  it("valid selection number mutes the selected group", async () => {
    const pending = makePending("mute");

    const result = await handleSelectionResponse(pending, "1", "sender@c.us", account, config, mockRuntime);

    expect(result).toBe(true); // clear pending
    expect(mockDirDb.muteGroup).toHaveBeenCalledWith("grp1@g.us", "sender@c.us", "acct1", 0, expect.anything());
    expect(sendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Group 1") })
    );
  });

  it("invalid selection number sends error and keeps pending", async () => {
    const pending = makePending("mute");

    const result = await handleSelectionResponse(pending, "99", "sender@c.us", account, config, mockRuntime);

    expect(result).toBe(false); // don't clear pending
    expect(sendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Invalid selection") })
    );
    expect(mockDirDb.muteGroup).not.toHaveBeenCalled();
  });

  it('"cancel" text clears pending (non-numeric invalid input returns false, not cancel)', async () => {
    const pending = makePending("mute");

    // "cancel" is not a valid number — returns false (don't clear)
    const result = await handleSelectionResponse(pending, "cancel", "sender@c.us", account, config, mockRuntime);

    // "cancel" is treated as invalid input (not a number 1..N)
    expect(result).toBe(false);
  });

  it('"all" mutes all groups in the pending list', async () => {
    const pending = makePending("mute");

    const result = await handleSelectionResponse(pending, "all", "sender@c.us", account, config, mockRuntime);

    expect(result).toBe(true);
    expect(mockDirDb.muteGroup).toHaveBeenCalledTimes(2);
    expect(sendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("2/2") })
    );
  });

  it('"all" unmutes all groups when type=unmute', async () => {
    const pending = makePending("unmute");
    // Pre-mute the groups
    mockMutedGroups.set("grp1@g.us", { groupJid: "grp1@g.us", mutedBy: "x", accountId: "acct1", expiresAt: 0, dmBackup: null });
    mockMutedGroups.set("grp2@g.us", { groupJid: "grp2@g.us", mutedBy: "x", accountId: "acct1", expiresAt: 0, dmBackup: null });

    const result = await handleSelectionResponse(pending, "all", "sender@c.us", account, config, mockRuntime);

    expect(result).toBe(true);
    expect(mockDirDb.unmuteGroup).toHaveBeenCalledTimes(2);
  });

  it("valid selection unmutes selected group when type=unmute", async () => {
    const pending = makePending("unmute");
    mockMutedGroups.set("grp2@g.us", { groupJid: "grp2@g.us", mutedBy: "x", accountId: "acct1", expiresAt: 0, dmBackup: null });

    const result = await handleSelectionResponse(pending, "2", "sender@c.us", account, config, mockRuntime);

    expect(result).toBe(true);
    expect(mockDirDb.unmuteGroup).toHaveBeenCalledWith("grp2@g.us");
    expect(sendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Group 2") })
    );
  });

  it("empty groups list sends expiry message and returns true", async () => {
    const pending = { ...makePending(), groups: [] };

    const result = await handleSelectionResponse(pending, "1", "sender@c.us", account, config, mockRuntime);

    expect(result).toBe(true);
    expect(sendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("expired") })
    );
  });
});
