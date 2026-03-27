// Phase 53-02: MimicryGate enforcement function tests.
// TDD: RED phase — tests written before implementation of checkTimeOfDay, checkAndConsumeCap, getCapStatus.
// All timestamps are fixed constants — no Date.now() in tests.
// No vi.useFakeTimers() — injectable now parameter handles all time control.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MimicryDb,
  checkTimeOfDay,
  checkAndConsumeCap,
  getCapStatus,
  getMaturityPhase,
  resolveGateConfig,
  resolveCapLimit,
  type ResolvedGateConfig,
} from "./mimicry-gate.js";
import { validateWahaConfig } from "./config-schema.js";

// Fixed base timestamp: 2025-01-15 12:00:00 UTC (Wednesday, noon UTC)
const BASE_NOW = 1736942400000; // new Date(1736942400000).toISOString() = "2025-01-15T12:00:00.000Z"

// Helper: create a timestamp where UTC hour = h on 2025-01-15.
// BASE_NOW is 12:00 UTC, so: utcHour(h) = BASE_NOW - 12*3600*1000 + h*3600*1000
function utcHour(h: number): number {
  return BASE_NOW - 12 * 3_600_000 + h * 3_600_000;
}

// ─── MimicryDb fixture helpers ────────────────────────────────────────────────

let testDbDir: string;
let db: MimicryDb;

function createTestDb(): MimicryDb {
  testDbDir = join(tmpdir(), `mimicry-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDbDir, { recursive: true });
  return new MimicryDb(join(testDbDir, "test.db"));
}

function destroyTestDb(d: MimicryDb): void {
  try { d.close(); } catch {}
  try { rmSync(testDbDir, { recursive: true, force: true }); } catch {}
}

// ─── getMaturityPhase ─────────────────────────────────────────────────────────

describe("getMaturityPhase", () => {
  const NOW = BASE_NOW;

  it("returns 'new' when firstSendAt is null", () => {
    expect(getMaturityPhase(null, NOW)).toBe("new");
  });

  it("returns 'new' when account is 3 days old", () => {
    const firstSendAt = NOW - 3 * 86_400_000;
    expect(getMaturityPhase(firstSendAt, NOW)).toBe("new");
  });

  it("returns 'new' when account is just under 7 days old", () => {
    const firstSendAt = NOW - (7 * 86_400_000 - 1);
    expect(getMaturityPhase(firstSendAt, NOW)).toBe("new");
  });

  it("returns 'warming' when account is 10 days old", () => {
    const firstSendAt = NOW - 10 * 86_400_000;
    expect(getMaturityPhase(firstSendAt, NOW)).toBe("warming");
  });

  it("returns 'warming' when account is 29 days old", () => {
    const firstSendAt = NOW - 29 * 86_400_000;
    expect(getMaturityPhase(firstSendAt, NOW)).toBe("warming");
  });

  it("returns 'stable' when account is 35 days old", () => {
    const firstSendAt = NOW - 35 * 86_400_000;
    expect(getMaturityPhase(firstSendAt, NOW)).toBe("stable");
  });
});

// ─── resolveCapLimit ──────────────────────────────────────────────────────────

describe("resolveCapLimit", () => {
  it("returns default limits when no overrides", () => {
    expect(resolveCapLimit(undefined, "new", {})).toBe(15);
    expect(resolveCapLimit(undefined, "warming", {})).toBe(30);
    expect(resolveCapLimit(undefined, "stable", {})).toBe(50);
  });

  it("global hourlyCap.limits overrides defaults", () => {
    const cfg = { hourlyCap: { limits: { new: 20 } } };
    expect(resolveCapLimit(undefined, "new", cfg)).toBe(20);
    expect(resolveCapLimit(undefined, "warming", cfg)).toBe(30); // still default
  });

  it("per-session override wins over global", () => {
    const cfg = {
      hourlyCap: { limits: { new: 20 } },
      accounts: { mySession: { hourlyCap: { limits: { new: 25 } } } },
    };
    expect(resolveCapLimit("mySession", "new", cfg)).toBe(25);
  });

  it("per-target override wins over per-session (CAP-04)", () => {
    const cfg = {
      hourlyCap: { limits: { new: 20 } },
      accounts: { mySession: { hourlyCap: { limits: { new: 25 } } } },
    };
    const targetOverride = { limits: { new: 10 } };
    expect(resolveCapLimit("mySession", "new", cfg, targetOverride)).toBe(10);
  });

  it("per-target with no limits falls through to session/global", () => {
    const cfg = {
      hourlyCap: { limits: { new: 20 } },
      accounts: { mySession: { hourlyCap: { limits: { new: 25 } } } },
    };
    const targetOverride = {}; // no limits field
    expect(resolveCapLimit("mySession", "new", cfg, targetOverride)).toBe(25);
  });

  it("per-target null falls through to session/global", () => {
    const cfg = {
      accounts: { mySession: { hourlyCap: { limits: { new: 25 } } } },
    };
    expect(resolveCapLimit("mySession", "new", cfg, null)).toBe(25);
  });
});

// ─── resolveGateConfig ───────────────────────────────────────────────────────

describe("resolveGateConfig", () => {
  it("returns defaults when no config", () => {
    const result = resolveGateConfig(undefined, {});
    expect(result.enabled).toBe(false);
    expect(result.timezone).toBe("UTC");
    expect(result.startHour).toBe(7);
    expect(result.endHour).toBe(1);
    expect(result.onBlock).toBe("reject");
  });

  it("global sendGate overrides defaults", () => {
    const cfg = { sendGate: { enabled: true, timezone: "Asia/Jerusalem" } };
    const result = resolveGateConfig(undefined, cfg);
    expect(result.enabled).toBe(true);
    expect(result.timezone).toBe("Asia/Jerusalem");
    expect(result.startHour).toBe(7); // still default
  });

  it("per-session override wins over global (GATE-02)", () => {
    const cfg = {
      sendGate: { enabled: true, startHour: 7 },
      accounts: { mySession: { sendGate: { startHour: 9 } } },
    };
    const result = resolveGateConfig("mySession", cfg);
    expect(result.startHour).toBe(9);
    expect(result.enabled).toBe(true); // inherited from global
  });

  it("per-target override wins over session (GATE-02)", () => {
    const cfg = {
      sendGate: { enabled: true, startHour: 7, timezone: "UTC" },
      accounts: { mySession: { sendGate: { startHour: 9 } } },
    };
    const targetOverride = { startHour: 10, timezone: "America/New_York" };
    const result = resolveGateConfig("mySession", cfg, targetOverride);
    expect(result.startHour).toBe(10);
    expect(result.timezone).toBe("America/New_York");
  });

  it("per-target null falls through to session/global", () => {
    const cfg = { sendGate: { enabled: true, startHour: 9 } };
    const result = resolveGateConfig(undefined, cfg, null);
    expect(result.startHour).toBe(9);
  });
});

// ─── checkTimeOfDay ───────────────────────────────────────────────────────────

describe("checkTimeOfDay", () => {
  const makeConfig = (overrides: Partial<ResolvedGateConfig> = {}): ResolvedGateConfig => ({
    enabled: true,
    timezone: "UTC",
    startHour: 7,
    endHour: 1,
    onBlock: "reject",
    ...overrides,
  });

  it("gate disabled -> always allowed", () => {
    const config = makeConfig({ enabled: false });
    const result = checkTimeOfDay(config, utcHour(3));
    expect(result.allowed).toBe(true);
  });

  // Cross-midnight window: 7am to 1am (startHour=7, endHour=1)
  // Allowed hours: 7, 8, 9, ..., 23, 0
  // Blocked hours: 1, 2, 3, 4, 5, 6

  it("allows hour=13 in 7am-1am cross-midnight window", () => {
    const result = checkTimeOfDay(makeConfig(), utcHour(13));
    expect(result.allowed).toBe(true);
  });

  it("allows hour=0 in 7am-1am cross-midnight window (cross-midnight)", () => {
    const result = checkTimeOfDay(makeConfig(), utcHour(0));
    expect(result.allowed).toBe(true);
  });

  it("allows hour=7 (start boundary, inclusive)", () => {
    const result = checkTimeOfDay(makeConfig(), utcHour(7));
    expect(result.allowed).toBe(true);
  });

  it("blocks hour=6 (just before start)", () => {
    const result = checkTimeOfDay(makeConfig(), utcHour(6));
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Outside send window/);
  });

  it("blocks hour=1 (endHour is exclusive)", () => {
    const result = checkTimeOfDay(makeConfig(), utcHour(1));
    expect(result.allowed).toBe(false);
  });

  it("blocks hour=3 (inside blocked range)", () => {
    const result = checkTimeOfDay(makeConfig(), utcHour(3));
    expect(result.allowed).toBe(false);
  });

  it("allows hour=23 (last allowed hour before midnight)", () => {
    const result = checkTimeOfDay(makeConfig(), utcHour(23));
    expect(result.allowed).toBe(true);
  });

  // Same-day window: 9am to 5pm (startHour=9, endHour=17)
  // Allowed: 9..16, Blocked: 0..8, 17..23

  it("allows hour=13 in 9am-5pm same-day window", () => {
    const config = makeConfig({ startHour: 9, endHour: 17 });
    const result = checkTimeOfDay(config, utcHour(13));
    expect(result.allowed).toBe(true);
  });

  it("blocks hour=20 in 9am-5pm same-day window", () => {
    const config = makeConfig({ startHour: 9, endHour: 17 });
    const result = checkTimeOfDay(config, utcHour(20));
    expect(result.allowed).toBe(false);
  });

  it("allows hour=9 (start boundary, same-day window)", () => {
    const config = makeConfig({ startHour: 9, endHour: 17 });
    const result = checkTimeOfDay(config, utcHour(9));
    expect(result.allowed).toBe(true);
  });

  it("blocks hour=17 (endHour exclusive, same-day window)", () => {
    const config = makeConfig({ startHour: 9, endHour: 17 });
    const result = checkTimeOfDay(config, utcHour(17));
    expect(result.allowed).toBe(false);
  });

  it("timezone='Asia/Jerusalem' adjusts hour (UTC+2 in winter)", () => {
    // Israel is UTC+2 in winter. hour=5 UTC = hour=7 Israel = allowed in 7am-1am window
    const config = makeConfig({ timezone: "Asia/Jerusalem" });
    const result = checkTimeOfDay(config, utcHour(5));
    // Hour 5 UTC = hour 7 Jerusalem = start of window = allowed
    expect(result.allowed).toBe(true);
  });

  it("timezone='Asia/Jerusalem': hour=3 UTC = hour=5 Jerusalem = blocked", () => {
    const config = makeConfig({ timezone: "Asia/Jerusalem" });
    const result = checkTimeOfDay(config, utcHour(3));
    // Hour 3 UTC = hour 5 Jerusalem = outside 7am-1am = blocked
    expect(result.allowed).toBe(false);
  });

  it("reason string includes start/end hour and timezone", () => {
    const config = makeConfig({ startHour: 7, endHour: 1, timezone: "UTC" });
    const result = checkTimeOfDay(config, utcHour(3));
    expect(result.reason).toContain("7:00");
    expect(result.reason).toContain("1:00");
    expect(result.reason).toContain("UTC");
  });
});

// ─── checkAndConsumeCap ───────────────────────────────────────────────────────

describe("checkAndConsumeCap", () => {
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { destroyTestDb(db); });

  const SESSION = "test-session";
  const LIMIT = 15;
  const NOW = BASE_NOW;

  it("allows and records first send (count 0 -> 1)", () => {
    const result = checkAndConsumeCap(SESSION, LIMIT, db, NOW);
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.limit).toBe(LIMIT);
    expect(result.reason).toBeUndefined();
  });

  it("allows send when count is 14 out of 15 (at limit-1)", () => {
    // Pre-populate 14 sends
    for (let i = 0; i < 14; i++) {
      db.recordSend(SESSION, NOW - i * 1000);
    }
    const result = checkAndConsumeCap(SESSION, LIMIT, db, NOW);
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(15);
    expect(result.limit).toBe(LIMIT);
  });

  it("blocks when count is already at limit (15/15)", () => {
    for (let i = 0; i < 15; i++) {
      db.recordSend(SESSION, NOW - i * 1000);
    }
    const result = checkAndConsumeCap(SESSION, LIMIT, db, NOW);
    expect(result.allowed).toBe(false);
    expect(result.count).toBe(15);
    expect(result.limit).toBe(LIMIT);
    expect(result.reason).toMatch(/Hourly cap reached/);
  });

  it("blocked send does NOT record (count stays same)", () => {
    for (let i = 0; i < 15; i++) {
      db.recordSend(SESSION, NOW - i * 1000);
    }
    checkAndConsumeCap(SESSION, LIMIT, db, NOW);
    // Count should still be 15, not 16
    expect(db.countRecentSends(SESSION, NOW)).toBe(15);
  });

  it("sends older than 60 minutes do NOT count (rolling window)", () => {
    // Add 15 sends that are 61 minutes old
    const OLD = NOW - 61 * 60 * 1000;
    for (let i = 0; i < 15; i++) {
      db.recordSend(SESSION, OLD - i * 1000);
    }
    // Should allow — old sends don't count
    const result = checkAndConsumeCap(SESSION, LIMIT, db, NOW);
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
  });

  it("sends exactly at 60 minutes ago still count", () => {
    const AT_BOUNDARY = NOW - 3_600_000; // exactly 60 min ago — on boundary, outside window
    for (let i = 0; i < 15; i++) {
      // All at or older than boundary
      db.recordSend(SESSION, AT_BOUNDARY - i * 1000);
    }
    // windowStart = NOW - 3_600_000 = AT_BOUNDARY
    // Query: sent_at >= AT_BOUNDARY - 3_600_000 ... wait, countRecentSends uses now - 3_600_000
    // So AT_BOUNDARY itself is the boundary: sent_at >= AT_BOUNDARY means AT_BOUNDARY IS included
    // But these were inserted at AT_BOUNDARY, AT_BOUNDARY-1000, etc
    // AT_BOUNDARY is included (>=), so 1 send counts
    const count = db.countRecentSends(SESSION, NOW);
    // Only AT_BOUNDARY itself should count (AT_BOUNDARY-1000 is older)
    expect(count).toBeGreaterThan(0);
  });

  it("ensureFirstSendAt is set on allowed send (maturity baseline)", () => {
    checkAndConsumeCap(SESSION, LIMIT, db, NOW);
    const firstSend = db.getFirstSendAt(SESSION);
    expect(firstSend).toBe(NOW);
  });

  it("blocked send does not change firstSendAt (idempotent ensureFirstSendAt)", () => {
    // Pre-populate 15 sends (recordSend sets firstSendAt internally)
    for (let i = 0; i < 15; i++) {
      db.recordSend(SESSION, NOW - i * 1000);
    }
    const firstSendAtBefore = db.getFirstSendAt(SESSION);
    expect(firstSendAtBefore).not.toBeNull();

    // Blocked call should not change firstSendAt
    const result = checkAndConsumeCap(SESSION, LIMIT, db, NOW);
    expect(result.allowed).toBe(false);
    expect(db.getFirstSendAt(SESSION)).toBe(firstSendAtBefore);
  });
});

// ─── getCapStatus ─────────────────────────────────────────────────────────────

describe("getCapStatus", () => {
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { destroyTestDb(db); });

  const SESSION = "cap-status-session";
  const LIMIT = 30;
  const NOW = BASE_NOW;

  it("returns zero count and full remaining when no sends", () => {
    const status = getCapStatus(SESSION, LIMIT, db, NOW);
    expect(status.count).toBe(0);
    expect(status.limit).toBe(LIMIT);
    expect(status.remaining).toBe(LIMIT);
    expect(status.maturity).toBe("new");
  });

  it("does NOT record a send (read-only)", () => {
    getCapStatus(SESSION, LIMIT, db, NOW);
    getCapStatus(SESSION, LIMIT, db, NOW);
    // Count should still be 0 after two reads
    expect(db.countRecentSends(SESSION, NOW)).toBe(0);
  });

  it("returns correct count and remaining after sends", () => {
    for (let i = 0; i < 5; i++) {
      db.recordSend(SESSION, NOW - i * 1000);
    }
    const status = getCapStatus(SESSION, LIMIT, db, NOW);
    expect(status.count).toBe(5);
    expect(status.remaining).toBe(25);
  });

  it("remaining is clamped to 0 when count exceeds limit", () => {
    // Manually insert 35 sends (more than limit of 30)
    for (let i = 0; i < 35; i++) {
      db.recordSend(SESSION, NOW - i * 1000);
    }
    const status = getCapStatus(SESSION, LIMIT, db, NOW);
    expect(status.remaining).toBe(0); // never negative
  });

  it("returns maturity based on firstSendAt", () => {
    // Set first_send_at to 15 days ago -> warming
    db.ensureFirstSendAt(SESSION, NOW - 15 * 86_400_000);
    const status = getCapStatus(SESSION, LIMIT, db, NOW);
    expect(status.maturity).toBe("warming");
  });

  it("windowStartMs is NOW - 3_600_000", () => {
    const status = getCapStatus(SESSION, LIMIT, db, NOW);
    expect(status.windowStartMs).toBe(NOW - 3_600_000);
  });
});

// ─── Config schema integration (INFRA-03) ────────────────────────────────────

describe("validateWahaConfig — sendGate and hourlyCap defaults", () => {
  it("empty config is valid (sendGate/hourlyCap default)", () => {
    const result = validateWahaConfig({});
    expect(result.valid).toBe(true);
  });

  it("sendGate with enabled=true and valid timezone is valid", () => {
    const result = validateWahaConfig({
      sendGate: { enabled: true, timezone: "Asia/Jerusalem" },
    });
    expect(result.valid).toBe(true);
  });

  it("hourlyCap with enabled=true is valid", () => {
    const result = validateWahaConfig({
      hourlyCap: { enabled: true },
    });
    expect(result.valid).toBe(true);
  });

  it("sendGate with custom hours is valid", () => {
    const result = validateWahaConfig({
      sendGate: { enabled: true, startHour: 9, endHour: 22, timezone: "UTC" },
    });
    expect(result.valid).toBe(true);
  });
});
