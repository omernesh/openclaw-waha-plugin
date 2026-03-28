// Phase 59-01 (CORE-04, CORE-06): Unit tests for standalone entry point utilities.
// Tests: getDataDir env var handling, standalone.ts file existence.
// No fake timers needed — pure function / env var injection.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

// ── getDataDir tests ─────────────────────────────────────────────────────────

describe("getDataDir", () => {
  const originalEnv = process.env.CHATLYTICS_DATA_DIR;

  afterEach(() => {
    // Restore env var after each test
    if (originalEnv === undefined) {
      delete process.env.CHATLYTICS_DATA_DIR;
    } else {
      process.env.CHATLYTICS_DATA_DIR = originalEnv;
    }
    // Reset module cache so getDataDir re-reads env
    vi.resetModules();
  });

  it("returns CHATLYTICS_DATA_DIR when env var is set", async () => {
    process.env.CHATLYTICS_DATA_DIR = "/custom/data/dir";
    const { getDataDir } = await import("./data-dir.js");
    expect(getDataDir()).toBe("/custom/data/dir");
  });

  it("returns ~/.openclaw/data when env var is NOT set", async () => {
    delete process.env.CHATLYTICS_DATA_DIR;
    const { getDataDir } = await import("./data-dir.js");
    expect(getDataDir()).toBe(join(homedir(), ".openclaw", "data"));
  });

  it("returns CHATLYTICS_DATA_DIR with trailing slash preserved", async () => {
    process.env.CHATLYTICS_DATA_DIR = "/var/data/chatlytics/";
    const { getDataDir } = await import("./data-dir.js");
    expect(getDataDir()).toBe("/var/data/chatlytics/");
  });
});
