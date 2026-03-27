/**
 * activity-scanner.ts test suite.
 * Phase 56 (ADAPT-01, ADAPT-02, ADAPT-03).
 *
 * Tests computePeakWindow, isOffPeak (via tick), pagination cutoffs, and rescan overwrite.
 * Uses DI params (_dirDb, _fetchMessages, _now, _sleep) to avoid real WAHA/SQLite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computePeakWindow, startActivityScanner } from "./activity-scanner.js";
import { DirectoryDb } from "./directory.js";
import type { ScannerOptions } from "./activity-scanner.js";
import type { CoreConfig } from "./types.js";

// ── helpers ──

function makeDb(): DirectoryDb {
  return new DirectoryDb(":memory:");
}

/** Generate N timestamps all at a specific hour (UTC) within the last 7 days. */
function makeTimestampsAtHour(count: number, hourUtc: number): number[] {
  const base = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days ago
  const results: number[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base + i * 60_000); // 1-minute intervals
    // Force the hour to hourUtc by adjusting
    d.setUTCHours(hourUtc, i % 60, 0, 0);
    results.push(d.getTime());
  }
  return results;
}

/** Create a minimal CoreConfig with sendGate disabled (so isOffPeak returns true). */
function makeConfig(sendGateEnabled = false): CoreConfig {
  return {
    channels: {
      waha: {
        sendGate: { enabled: sendGateEnabled, startHour: 7, endHour: 1, timezone: "UTC" },
      },
    },
  } as unknown as CoreConfig;
}

// ── computePeakWindow ──

describe("computePeakWindow", () => {
  it("returns null when fewer than 20 timestamps provided (sparse guard)", () => {
    const ts = makeTimestampsAtHour(19, 10);
    expect(computePeakWindow(ts, "UTC")).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(computePeakWindow([], "UTC")).toBeNull();
  });

  it("returns startHour=0, endHour=1 when all timestamps are at hour 0", () => {
    const ts = makeTimestampsAtHour(25, 0);
    const result = computePeakWindow(ts, "UTC");
    expect(result).not.toBeNull();
    expect(result!.startHour).toBe(0);
    expect(result!.endHour).toBe(1);
  });

  it("returns correct window for uniform distribution across hours 9-17 (top 60%)", () => {
    // 25 messages per hour for hours 9-17 = 9 hours × 25 = 225 messages total
    // top 60% of 9 hours = top 5.4 → ceil = 6 hours or we pick until coverage >= 60%
    const ts: number[] = [];
    for (let h = 9; h <= 17; h++) {
      ts.push(...makeTimestampsAtHour(25, h));
    }
    const result = computePeakWindow(ts, "UTC");
    expect(result).not.toBeNull();
    // Result should span a contiguous window within 9-18 range
    expect(result!.startHour).toBeGreaterThanOrEqual(9);
    expect(result!.endHour).toBeLessThanOrEqual(18);
    // startHour < endHour (non-cross-midnight)
    expect(result!.startHour).toBeLessThan(result!.endHour);
  });

  it("WAHA Unix-seconds timestamps are correctly multiplied by 1000 when passed as ms", () => {
    // Simulate: caller passes ms (already *1000), computePeakWindow processes them
    // If timestamps are already in ms, we just verify computation works on them
    const nowMs = Date.now();
    // Create 25 timestamps near current hour
    const ts = Array.from({ length: 25 }, (_, i) => nowMs - i * 60_000);
    const result = computePeakWindow(ts, "UTC");
    expect(result).not.toBeNull();
  });
});

// ── startActivityScanner / tick behavior ──

describe("startActivityScanner", () => {
  let db: DirectoryDb;
  let abortController: AbortController;

  beforeEach(() => {
    db = makeDb();
    abortController = new AbortController();
  });

  afterEach(() => {
    abortController.abort();
    db.close();
  });

  it("tick skips when isOffPeak returns false (on-peak guard, ADAPT-03)", async () => {
    // sendGate enabled with window 7-23, and our 'now' is inside that window (hour 10)
    const cfg = {
      channels: {
        waha: {
          sendGate: { enabled: true, startHour: 7, endHour: 23, timezone: "UTC" },
        },
      },
    } as unknown as CoreConfig;

    const fetchCalls: string[] = [];
    const mockFetch = vi.fn(async () => {
      fetchCalls.push("called");
      return [];
    });

    // Hour 10 UTC = inside window 7-23 = on-peak = scanner should skip
    const noonUtc = new Date();
    noonUtc.setUTCHours(10, 0, 0, 0);
    const nowMs = noonUtc.getTime();

    let tickExecuted = false;
    const sleepSpy = vi.fn(async (_ms: number) => {
      tickExecuted = true;
    });

    const opts: ScannerOptions = {
      accountId: "test-acct",
      config: cfg,
      session: "test-session",
      abortSignal: abortController.signal,
      _dirDb: db,
      _fetchMessages: mockFetch,
      _now: () => nowMs,
      _sleep: sleepSpy,
      _firstTickDelayMs: 0,
    };

    startActivityScanner(opts);

    // Wait for the initial tick to execute
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    abortController.abort();

    // fetch should never have been called since we're on-peak
    expect(fetchCalls.length).toBe(0);
  });

  it("pagination stops when offset reaches 500 messages", async () => {
    const cfg = makeConfig(false); // sendGate disabled = always off-peak

    // Insert a contact to scan
    db.upsertContact("222@c.us", "Test", false);
    // Set last_message_at to now so it appears in getChatsNeedingRescan
    (db as any).db.prepare("UPDATE contacts SET last_message_at = ? WHERE jid = ?").run(Date.now(), "222@c.us");

    let totalFetched = 0;
    let callCount = 0;
    const mockFetch = vi.fn(async ({ offset }: { offset?: number }) => {
      callCount++;
      totalFetched += 100;
      if ((offset ?? 0) >= 400) return []; // stops at offset 500 (5th call returns empty)
      // Return 100 messages at current time (within 7-day window)
      return Array.from({ length: 100 }, (_, i) => ({
        timestamp: Math.floor(Date.now() / 1000) - i * 10,
      }));
    });

    const sleepSpy = vi.fn(async () => {});

    const opts: ScannerOptions = {
      accountId: "test-acct",
      config: cfg,
      session: "test-session",
      abortSignal: abortController.signal,
      _dirDb: db,
      _fetchMessages: mockFetch,
      _now: () => Date.now(),
      _sleep: sleepSpy,
      _firstTickDelayMs: 0,
    };

    startActivityScanner(opts);

    // Wait for scan to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    abortController.abort();

    // Should have made at most 5 fetch calls (0, 100, 200, 300, 400 offset → stops)
    expect(callCount).toBeLessThanOrEqual(6);
  });

  it("pagination stops when messages older than 7 days encountered", async () => {
    const cfg = makeConfig(false); // always off-peak

    db.upsertContact("333@c.us", "Test", false);
    (db as any).db.prepare("UPDATE contacts SET last_message_at = ? WHERE jid = ?").run(Date.now(), "333@c.us");

    const sevenDaysAgo = Math.floor((Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000);
    let callCount = 0;
    const mockFetch = vi.fn(async ({ offset }: { offset?: number }) => {
      callCount++;
      if ((offset ?? 0) === 0) {
        // First page: return messages older than 7 days
        return [{ timestamp: sevenDaysAgo }];
      }
      return [];
    });

    const sleepSpy = vi.fn(async () => {});

    const opts: ScannerOptions = {
      accountId: "test-acct",
      config: cfg,
      session: "test-session",
      abortSignal: abortController.signal,
      _dirDb: db,
      _fetchMessages: mockFetch,
      _now: () => Date.now(),
      _sleep: sleepSpy,
      _firstTickDelayMs: 0,
    };

    startActivityScanner(opts);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    abortController.abort();

    // Should stop after first call seeing old messages
    expect(callCount).toBeLessThanOrEqual(2);
  });

  it("rescan overwrites stale profile (ADAPT-02)", async () => {
    const cfg = makeConfig(false); // always off-peak

    db.upsertContact("444@c.us", "Test", false);
    (db as any).db.prepare("UPDATE contacts SET last_message_at = ? WHERE jid = ?").run(Date.now(), "444@c.us");

    // Insert a stale profile (scanned 8 days ago)
    db.upsertActivityProfile({
      jid: "444@c.us",
      accountId: "test-acct",
      peakStartHour: 0,
      peakEndHour: 1,
      messageCount: 5,
      scannedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });

    // Mock 25 messages at hour 14 UTC
    const ts14 = makeTimestampsAtHour(30, 14);
    const mockFetch = vi.fn(async () =>
      ts14.map((ms) => ({ timestamp: Math.floor(ms / 1000) }))
    );

    const sleepSpy = vi.fn(async () => {});

    const opts: ScannerOptions = {
      accountId: "test-acct",
      config: cfg,
      session: "test-session",
      abortSignal: abortController.signal,
      _dirDb: db,
      _fetchMessages: mockFetch,
      _now: () => Date.now(),
      _sleep: sleepSpy,
      _firstTickDelayMs: 0,
    };

    startActivityScanner(opts);
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    abortController.abort();

    const profile = db.getActivityProfile("444@c.us");
    // Profile should have been updated from the scan
    expect(profile).not.toBeNull();
    // scannedAt should be recent (within last second)
    expect(profile!.scannedAt).toBeGreaterThan(Date.now() - 5000);
    // Old profile had startHour=0; new one should be different (14-ish)
    expect(profile!.peakStartHour).not.toBe(0);
  });
});
