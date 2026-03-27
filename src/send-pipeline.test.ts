// Phase 54-01: Send pipeline enforcement tests.
// TDD: RED phase — tests written before implementation of enforceMimicry, recordMimicrySuccess.
// All timestamps are fixed constants — no Date.now() in tests.
// sendWahaPresence is mocked; sleep is injectable via module mock.
// Real MimicryDb instances use temp SQLite files.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MimicryDb, resolveGateConfig, type ResolvedGateConfig } from "./mimicry-gate.js";

// ─── Mock sendWahaPresence from send.ts ──────────────────────────────────────
vi.mock("./send.js", () => ({
  sendWahaPresence: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock directory.js for activity profile tests ────────────────────────────
// Default: getDmSettings returns null, getActivityProfile returns null.
// Individual tests override via vi.mocked(getDirectoryDb).mockReturnValue(...).
const mockGetDmSettings = vi.fn().mockReturnValue(null);
const mockGetActivityProfile = vi.fn().mockReturnValue(null);
vi.mock("./directory.js", () => ({
  getDirectoryDb: vi.fn(() => ({
    getDmSettings: mockGetDmSettings,
    getActivityProfile: mockGetActivityProfile,
  })),
}));

// ─── Fixed timestamps ─────────────────────────────────────────────────────────
// 2025-01-15 14:00:00 UTC — within default 7am-1am window for any UTC+X timezone
const BASE_NOW = 1736949600000; // new Date(1736949600000).toISOString() = "2025-01-15T14:00:00.000Z"

// 2025-01-15 03:00:00 UTC — outside 7am-1am window in UTC
const BLOCKED_NOW = 1736906400000; // new Date(1736906400000).toISOString() = "2025-01-15T03:00:00.000Z"

// ─── Helpers ──────────────────────────────────────────────────────────────────
let tmpDir: string;
let db: MimicryDb;

function makeTmpDir(): string {
  const dir = join(tmpdir(), `send-pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
  db = new MimicryDb(join(tmpDir, "mimicry.db"));
  vi.clearAllMocks();
});

afterEach(() => {
  try { db.close(); } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ─── Import under test ────────────────────────────────────────────────────────
// NOTE: Import after mocks are set up so mock injection is effective.
const { enforceMimicry, recordMimicrySuccess } = await import("./mimicry-enforcer.js");
const { sendWahaPresence } = await import("./send.js");

// ─── Minimal CoreConfig for tests ─────────────────────────────────────────────
function makeCfg(overrides: Record<string, any> = {}): any {
  return {
    channels: {
      waha: {
        wahaApiUrl: "http://localhost:3004",
        wahaApiKey: "test-key",
        webhookPort: 9999,
        ...overrides,
      },
    },
  };
}

// Gate config: enabled, UTC, 7am-1am (cross-midnight: endHour=1 < startHour=7)
const GATE_ENABLED: ResolvedGateConfig = {
  enabled: true,
  timezone: "UTC",
  startHour: 7,
  endHour: 1,
  onBlock: "reject",
};

const GATE_DISABLED: ResolvedGateConfig = {
  enabled: false,
  timezone: "UTC",
  startHour: 7,
  endHour: 1,
  onBlock: "reject",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("enforceMimicry", () => {
  // Test 1: bypassPolicy=true skips all checks
  it("bypassPolicy=true returns immediately without any gate/cap/delay check", async () => {
    const cfg = makeCfg({ sendGate: { enabled: true, startHour: 7, endHour: 1, timezone: "UTC" }, hourlyCap: { limits: { new: 1 } } });

    // Fill cap to 0 remaining
    for (let i = 0; i < 2; i++) db.recordSend("test-session", BASE_NOW);

    // Should NOT throw despite cap exhaustion and time gate enabled
    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "123@c.us",
        accountId: "test-account",
        cfg,
        bypassPolicy: true,
        _db: db,
        _now: BLOCKED_NOW, // outside window too
      })
    ).resolves.toBeUndefined();

    // No presence calls made
    expect(sendWahaPresence).not.toHaveBeenCalled();
  });

  // Test 2: Time gate blocked
  it("throws '[mimicry] Send blocked:' with 'outside send window' when outside time gate", async () => {
    const cfg = makeCfg({ sendGate: { enabled: true, startHour: 7, endHour: 1, timezone: "UTC" } });

    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "123@c.us",
        accountId: "test-account",
        cfg,
        _db: db,
        _now: BLOCKED_NOW, // 3am UTC, outside 7am-1am
      })
    ).rejects.toThrow(/\[mimicry\] Send blocked:.*outside send window/i);
  });

  // Test 3: Cap exceeded
  it("throws '[mimicry] Send blocked:' with 'Hourly cap' when cap is exhausted", async () => {
    const cfg = makeCfg({
      sendGate: { enabled: false },
      hourlyCap: { limits: { new: 2, warming: 2, stable: 2 } },
    });

    // Record 2 sends to hit limit
    db.recordSend("test-session", BASE_NOW - 1000);
    db.recordSend("test-session", BASE_NOW - 500);

    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "123@c.us",
        accountId: "test-account",
        cfg,
        _db: db,
        _now: BASE_NOW,
      })
    ).rejects.toThrow(/\[mimicry\] Send blocked:.*Hourly cap/i);
  });

  // Test 4: Jitter delay applied (3000-7000ms range)
  it("calls sleep with a value between 3000 and 7000ms", async () => {
    const cfg = makeCfg({ sendGate: { enabled: false } });
    const sleepTimes: number[] = [];

    await enforceMimicry({
      session: "test-session",
      chatId: "123@c.us",
      accountId: "test-account",
      cfg,
      _db: db,
      _now: BASE_NOW,
      _sleep: (ms: number) => { sleepTimes.push(ms); return Promise.resolve(); },
    });

    expect(sleepTimes.length).toBeGreaterThanOrEqual(1);
    const jitterMs = sleepTimes[0];
    expect(jitterMs).toBeGreaterThanOrEqual(3000);
    expect(jitterMs).toBeLessThanOrEqual(7000);
  });

  // Test 5: Typing indicator fired with correct duration
  it("fires typing:true then typing:false with duration=min(messageLength/4*1000, 8000)", async () => {
    const cfg = makeCfg({ sendGate: { enabled: false } });
    const sleepTimes: number[] = [];

    // Message with 20 chars -> typing duration = 20/4*1000 = 5000ms
    const messageLength = 20;

    await enforceMimicry({
      session: "test-session",
      chatId: "123@c.us",
      accountId: "test-account",
      cfg,
      messageLength,
      _db: db,
      _now: BASE_NOW,
      _sleep: (ms: number) => { sleepTimes.push(ms); return Promise.resolve(); },
    });

    expect(sendWahaPresence).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = (sendWahaPresence as any).mock.calls;
    expect(firstCall[0]).toMatchObject({ chatId: "123@c.us", typing: true });
    expect(secondCall[0]).toMatchObject({ chatId: "123@c.us", typing: false });

    // Sleep calls: [jitterDelay, typingDuration]
    // jitter is first sleep, typing duration is second
    const typingDurationCall = sleepTimes[sleepTimes.length - 1];
    expect(typingDurationCall).toBe(5000); // 20/4*1000
  });

  // Test 6: No messageLength — no typing indicator, only jitter delay
  it("skips typing indicator when messageLength is 0 or undefined", async () => {
    const cfg = makeCfg({ sendGate: { enabled: false } });

    await enforceMimicry({
      session: "test-session",
      chatId: "123@c.us",
      accountId: "test-account",
      cfg,
      messageLength: 0,
      _db: db,
      _now: BASE_NOW,
      _sleep: () => Promise.resolve(),
    });

    expect(sendWahaPresence).not.toHaveBeenCalled();

    vi.clearAllMocks();

    await enforceMimicry({
      session: "test-session",
      chatId: "123@c.us",
      accountId: "test-account",
      cfg,
      // messageLength undefined
      _db: db,
      _now: BASE_NOW,
      _sleep: () => Promise.resolve(),
    });

    expect(sendWahaPresence).not.toHaveBeenCalled();
  });

  // Test 7: Batch pre-check — count=5, cap remaining=3 => throws
  it("throws cap exceeded when batch count would exceed remaining cap", async () => {
    const cfg = makeCfg({
      sendGate: { enabled: false },
      hourlyCap: { limits: { new: 5, warming: 5, stable: 5 } },
    });

    // 3 sends already recorded — remaining = 5-3 = 2; batch of 3 would exceed
    db.recordSend("test-session", BASE_NOW - 3000);
    db.recordSend("test-session", BASE_NOW - 2000);
    db.recordSend("test-session", BASE_NOW - 1000);

    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "123@c.us",
        accountId: "test-account",
        cfg,
        count: 3, // 3 + 3 > 5
        _db: db,
        _now: BASE_NOW,
        _sleep: () => Promise.resolve(),
      })
    ).rejects.toThrow(/\[mimicry\] Send blocked:.*Hourly cap/i);
  });

  // Test 8: Batch pre-check — count=3, remaining cap=5 => passes
  it("allows batch when count is within remaining cap", async () => {
    const cfg = makeCfg({
      sendGate: { enabled: false },
      hourlyCap: { limits: { new: 10, warming: 10, stable: 10 } },
    });

    // 2 sends recorded — remaining = 10-2 = 8; batch of 3 fits
    db.recordSend("test-session", BASE_NOW - 2000);
    db.recordSend("test-session", BASE_NOW - 1000);

    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "123@c.us",
        accountId: "test-account",
        cfg,
        count: 3,
        _db: db,
        _now: BASE_NOW,
        _sleep: () => Promise.resolve(),
      })
    ).resolves.toBeUndefined();
  });

  // Test 9: recordMimicrySuccess calls db.recordSend
  it("recordMimicrySuccess records a send in the DB", () => {
    const countBefore = db.countRecentSends("test-session", BASE_NOW);
    recordMimicrySuccess("test-session", db);
    const countAfter = db.countRecentSends("test-session", BASE_NOW + 1000);
    expect(countAfter).toBe(countBefore + 1);
  });

  // Test 10: Status sends skip cap check but still check time gate
  it("isStatusSend=true skips cap check but enforces time gate", async () => {
    const cfg = makeCfg({
      sendGate: { enabled: true, startHour: 7, endHour: 1, timezone: "UTC" },
      hourlyCap: { limits: { new: 1, warming: 1, stable: 1 } },
    });

    // Fill cap beyond limit
    db.recordSend("test-session", BASE_NOW - 1000);
    db.recordSend("test-session", BASE_NOW - 500);

    // Status send inside window: should pass even though cap is full
    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "123@c.us",
        accountId: "test-account",
        cfg,
        isStatusSend: true,
        _db: db,
        _now: BASE_NOW, // 14:00 UTC — inside 7am-1am window
        _sleep: () => Promise.resolve(),
      })
    ).resolves.toBeUndefined();

    // Status send OUTSIDE window: should still be blocked by time gate
    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "123@c.us",
        accountId: "test-account",
        cfg,
        isStatusSend: true,
        _db: db,
        _now: BLOCKED_NOW, // 3am UTC — outside window
        _sleep: () => Promise.resolve(),
      })
    ).rejects.toThrow(/\[mimicry\] Send blocked:.*outside send window/i);
  });

  // Test: typing duration capped at 8000ms for long messages
  it("caps typing indicator duration at 8000ms for very long messages", async () => {
    const cfg = makeCfg({ sendGate: { enabled: false } });
    const sleepTimes: number[] = [];

    // 400 chars -> raw typing = 400/4*1000 = 100000ms, should be capped at 8000
    await enforceMimicry({
      session: "test-session",
      chatId: "123@c.us",
      accountId: "test-account",
      cfg,
      messageLength: 400,
      _db: db,
      _now: BASE_NOW,
      _sleep: (ms: number) => { sleepTimes.push(ms); return Promise.resolve(); },
    });

    const typingDurationCall = sleepTimes[sleepTimes.length - 1];
    expect(typingDurationCall).toBe(8000);
  });
});

// ─── Activity profile gate adaptation tests ───────────────────────────────────
// Phase 56 (ADAPT-04, ADAPT-05): Verify that enforceMimicry applies per-chat
// activity profiles when no manual sendGateOverride is set, and falls back to
// global config when no profile exists. Manual overrides always win.

describe("activity profile gate adaptation", () => {
  beforeEach(() => {
    // Reset mocks to defaults before each test
    mockGetDmSettings.mockReturnValue(null);
    mockGetActivityProfile.mockReturnValue(null);
    vi.clearAllMocks();
    // Re-reset after clearAllMocks since clearAllMocks resets return values too
    mockGetDmSettings.mockReturnValue(null);
    mockGetActivityProfile.mockReturnValue(null);
  });

  // ADAPT-04: Activity profile peak hours used when no manual override.
  // Global gate would BLOCK at 14:00 UTC (window: 20-23), but activity profile
  // allows 10-18. With profile applied, the send should be allowed.
  it("uses activity profile peak hours when no manual override (ADAPT-04)", async () => {
    // Profile window: 10:00-18:00. BASE_NOW is 14:00 UTC — inside window.
    mockGetActivityProfile.mockReturnValue({
      jid: "chat-123@c.us",
      accountId: "test-account",
      peakStartHour: 10,
      peakEndHour: 18,
      messageCount: 50,
      scannedAt: BASE_NOW - 1000,
    });
    mockGetDmSettings.mockReturnValue(null); // no manual override

    // Global gate: 20:00-23:00 (would BLOCK at 14:00 UTC without profile override)
    const cfg = makeCfg({ sendGate: { enabled: true, startHour: 20, endHour: 23, timezone: "UTC" } });

    // enforceMimicry should NOT throw at 14:00 UTC because activity profile (10-18) overrides global gate
    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "chat-123@c.us",
        accountId: "test-account",
        cfg,
        _db: db,
        _now: BASE_NOW, // 14:00 UTC — inside profile (10-18) but outside global (20-23)
        _sleep: () => Promise.resolve(),
      })
    ).resolves.toBeUndefined();
  });

  // Manual sendGateOverride takes precedence over activity profile
  it("manual sendGateOverride takes precedence over activity profile", async () => {
    // Profile says peak 10-18, but manual override says only 22-23.
    // At 14:00 (inside profile window, outside manual window) -> should throw.
    mockGetDmSettings.mockReturnValue({
      sendGateOverride: { startHour: 22, endHour: 23 },
      hourlyCapOverride: null,
    });
    mockGetActivityProfile.mockReturnValue({
      jid: "chat-123@c.us",
      accountId: "test-account",
      peakStartHour: 10,
      peakEndHour: 18,
      messageCount: 50,
      scannedAt: BASE_NOW - 1000,
    });

    const cfg = makeCfg({ sendGate: { enabled: true, startHour: 7, endHour: 23, timezone: "UTC" } });

    // 14:00 UTC is inside the profile window but outside manual override (22-23).
    // Manual override wins -> should throw "Send blocked"
    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "chat-123@c.us",
        accountId: "test-account",
        cfg,
        _db: db,
        _now: BASE_NOW, // 14:00 UTC
        _sleep: () => Promise.resolve(),
      })
    ).rejects.toThrow(/\[mimicry\] Send blocked/i);
  });

  // ADAPT-05: Falls back to global config when no activity profile
  it("falls back to global config when no activity profile (ADAPT-05)", async () => {
    mockGetActivityProfile.mockReturnValue(null); // no profile
    mockGetDmSettings.mockReturnValue(null); // no manual override

    // Global gate: 7am-11pm (23). BASE_NOW = 14:00 UTC — inside.
    const cfg = makeCfg({ sendGate: { enabled: true, startHour: 7, endHour: 23, timezone: "UTC" } });

    // Should NOT throw — global config allows 14:00
    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "chat-123@c.us",
        accountId: "test-account",
        cfg,
        _db: db,
        _now: BASE_NOW, // 14:00 UTC
        _sleep: () => Promise.resolve(),
      })
    ).resolves.toBeUndefined();
  });

  // Graceful error handling: getActivityProfile throws -> falls back silently
  it("handles getActivityProfile errors gracefully (falls back to global config)", async () => {
    mockGetActivityProfile.mockImplementation(() => {
      throw new Error("DB not ready");
    });
    mockGetDmSettings.mockReturnValue(null);

    // Global gate: 7am-11pm. BASE_NOW = 14:00 — inside.
    const cfg = makeCfg({ sendGate: { enabled: true, startHour: 7, endHour: 23, timezone: "UTC" } });

    // Should NOT throw — error caught, falls back to global
    await expect(
      enforceMimicry({
        session: "test-session",
        chatId: "chat-123@c.us",
        accountId: "test-account",
        cfg,
        _db: db,
        _now: BASE_NOW, // 14:00 UTC
        _sleep: () => Promise.resolve(),
      })
    ).resolves.toBeUndefined();
  });
});
