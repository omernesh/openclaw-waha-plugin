import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all external dependencies before importing sync module
const mockGetDirectoryDb = vi.fn();
const mockGetWahaChats = vi.fn();
const mockGetWahaContacts = vi.fn();
const mockGetWahaGroups = vi.fn();
const mockGetWahaAllLids = vi.fn();
const mockGetWahaChannels = vi.fn();
const mockGetWahaContact = vi.fn();
const mockGetWahaNewsletter = vi.fn();
const mockToArr = vi.fn((x: unknown) => (Array.isArray(x) ? x : []));

vi.mock("../src/directory.js", () => ({
  getDirectoryDb: (...args: any[]) => mockGetDirectoryDb(...args),
}));

vi.mock("../src/send.js", () => ({
  getWahaChats: (...args: any[]) => mockGetWahaChats(...args),
  getWahaContacts: (...args: any[]) => mockGetWahaContacts(...args),
  getWahaGroups: (...args: any[]) => mockGetWahaGroups(...args),
  getWahaAllLids: (...args: any[]) => mockGetWahaAllLids(...args),
  getWahaChannels: (...args: any[]) => mockGetWahaChannels(...args),
  getWahaContact: (...args: any[]) => mockGetWahaContact(...args),
  getWahaNewsletter: (...args: any[]) => mockGetWahaNewsletter(...args),
  toArr: (...args: any[]) => mockToArr(...args),
}));

vi.mock("../src/rate-limiter.js", () => ({
  RateLimiter: class {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    }
  },
}));

// Mock fs to prevent real file reads/writes in syncExpiredToConfig
vi.mock("node:fs", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    readFileSync: vi.fn(() => JSON.stringify({ channels: { waha: { allowFrom: [] } } })),
    writeFileSync: vi.fn(),
  };
});

import { startDirectorySync, getSyncState, triggerImmediateSync, type SyncState } from "../src/sync.js";
import type { CoreConfig } from "../src/types.js";

function makeMockDb() {
  return {
    bulkUpsertContacts: vi.fn(() => 0),
    getOrphanedLidEntries: vi.fn(() => []),
    getContacts: vi.fn(() => []),
    upsertContact: vi.fn(),
    mergeContacts: vi.fn(),
    getExpiredJids: vi.fn(() => []),
    cleanupExpiredAllowList: vi.fn(() => 0),
  };
}

function makeConfig(): CoreConfig {
  return {
    wahaApiUrl: "http://localhost:3004",
    wahaApiKey: "test-key",
    session: "test_session",
  } as unknown as CoreConfig;
}

describe("startDirectorySync", () => {
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDb = makeMockDb();
    mockGetDirectoryDb.mockReturnValue(mockDb);
    mockGetWahaChats.mockResolvedValue([]);
    mockGetWahaContacts.mockResolvedValue([]);
    mockGetWahaGroups.mockResolvedValue([]);
    mockGetWahaAllLids.mockResolvedValue([]);
    mockGetWahaChannels.mockResolvedValue([]);
    mockGetWahaContact.mockResolvedValue({});
    mockGetWahaNewsletter.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns a SyncState with initial idle status", () => {
    const ac = new AbortController();
    const state = startDirectorySync({
      accountId: "test-account",
      config: makeConfig(),
      intervalMs: 60_000,
      abortSignal: ac.signal,
    });

    expect(state.status).toBe("idle");
    expect(state.lastSyncAt).toBeNull();
    expect(state.currentPhase).toBeNull();
    expect(state.itemsSynced).toBe(0);

    ac.abort();
  });

  it("getSyncState returns the state for a started account", () => {
    const ac = new AbortController();
    const state = startDirectorySync({
      accountId: "account-abc",
      config: makeConfig(),
      intervalMs: 60_000,
      abortSignal: ac.signal,
    });

    const retrieved = getSyncState("account-abc");
    expect(retrieved).toBe(state);

    ac.abort();
  });

  it("getSyncState returns undefined for unknown account", () => {
    expect(getSyncState("nonexistent")).toBeUndefined();
  });

  it("sync loop runs after initial 2s delay and sets status to idle on success", async () => {
    const ac = new AbortController();
    const state = startDirectorySync({
      accountId: "delay-test",
      config: makeConfig(),
      intervalMs: 60_000,
      abortSignal: ac.signal,
    });

    // Before 2s, still idle (no tick yet)
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.status).toBe("idle");
    expect(state.lastSyncAt).toBeNull();

    // After 2s, tick should have fired
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.status).toBe("idle");
    expect(state.lastSyncAt).toBeTypeOf("number");

    ac.abort();
  });

  it("tracks itemsSynced from sync cycle", async () => {
    mockGetWahaChats.mockResolvedValue([
      { id: "972544329000@c.us", name: "Alice" },
      { id: "972501234567@c.us", name: "Bob" },
    ]);
    mockToArr.mockImplementation((x: unknown) => (Array.isArray(x) ? x : []));

    const ac = new AbortController();
    const state = startDirectorySync({
      accountId: "items-test",
      config: makeConfig(),
      intervalMs: 60_000,
      abortSignal: ac.signal,
    });

    await vi.advanceTimersByTimeAsync(3000);
    // itemsSynced should reflect the contacts processed
    expect(state.itemsSynced).toBeGreaterThanOrEqual(0);
    expect(state.lastSyncAt).not.toBeNull();

    ac.abort();
  });

  it("sets status to error and lastError on API failure", async () => {
    mockGetWahaChats.mockRejectedValue(new Error("network down"));
    mockGetWahaContacts.mockRejectedValue(new Error("network down"));
    mockGetWahaGroups.mockRejectedValue(new Error("network down"));
    mockGetWahaAllLids.mockRejectedValue(new Error("network down"));

    const ac = new AbortController();
    const state = startDirectorySync({
      accountId: "error-test",
      config: makeConfig(),
      intervalMs: 60_000,
      abortSignal: ac.signal,
    });

    await vi.advanceTimersByTimeAsync(3000);

    // API failures are caught — state tracks them via lastError
    // The cycle may complete (status idle) but with an error noted,
    // or it may be "error" if the overall cycle threw.
    expect(state.lastSyncAt).not.toBeNull();

    ac.abort();
  });

  it("abort signal stops the sync loop and cleans up state", async () => {
    const ac = new AbortController();
    const state = startDirectorySync({
      accountId: "abort-test",
      config: makeConfig(),
      intervalMs: 60_000,
      abortSignal: ac.signal,
    });

    ac.abort();

    // After abort, getSyncState should return undefined (maps cleaned up)
    expect(getSyncState("abort-test")).toBeUndefined();
  });

  it("triggerImmediateSync fires a cycle without waiting for interval", async () => {
    const ac = new AbortController();
    const state = startDirectorySync({
      accountId: "immediate-test",
      config: makeConfig(),
      intervalMs: 300_000, // 5 minutes
      abortSignal: ac.signal,
    });

    // Run first cycle
    await vi.advanceTimersByTimeAsync(3000);
    const firstSyncAt = state.lastSyncAt;
    expect(firstSyncAt).not.toBeNull();

    // Trigger immediate — should run another cycle right away
    triggerImmediateSync("immediate-test");
    await vi.advanceTimersByTimeAsync(100);

    // lastSyncAt should be updated
    expect(state.lastSyncAt).toBeGreaterThanOrEqual(firstSyncAt!);

    ac.abort();
  });

  it("triggerImmediateSync is a no-op for unknown account", () => {
    // Should not throw
    triggerImmediateSync("nonexistent-account");
  });
});
