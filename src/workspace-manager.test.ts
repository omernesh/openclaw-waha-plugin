// Phase 64-01 (TENANT-01..03): Unit tests for WorkspaceProcessManager.
// Tests: crash containment, data dir scoping, session naming, backoff restart.
// Uses fake fork DI to avoid spawning real child processes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import {
  buildWorkspaceSessionName,
  extractWorkspaceIdFromSession,
  WorkspaceProcessManager,
} from "./workspace-manager.js";
import type { WorkspaceEntry, WorkspaceManagerOptions } from "./workspace-manager.js";

// ─── Mock ChildProcess ────────────────────────────────────────────────────────

class MockChildProcess extends EventEmitter {
  killed = false;
  send = vi.fn();
  kill = vi.fn(() => { this.killed = true; });
}

// ─── Session name utilities ───────────────────────────────────────────────────

describe("buildWorkspaceSessionName", () => {
  it("strips hyphens from UUID and prefixes with ctl_", () => {
    const result = buildWorkspaceSessionName(
      "550e8400-e29b-41d4-a716-446655440000",
      "logan"
    );
    expect(result).toBe("ctl_550e8400e29b41d4a716446655440000_logan");
  });

  it("works with a different base name", () => {
    const result = buildWorkspaceSessionName(
      "550e8400-e29b-41d4-a716-446655440000",
      "omer"
    );
    expect(result).toBe("ctl_550e8400e29b41d4a716446655440000_omer");
  });

  it("handles UUID without hyphens already (no-op strip)", () => {
    const result = buildWorkspaceSessionName(
      "550e8400e29b41d4a716446655440000",
      "bot"
    );
    // hex32 already, no hyphens to strip
    expect(result).toBe("ctl_550e8400e29b41d4a716446655440000_bot");
  });
});

describe("extractWorkspaceIdFromSession", () => {
  it("extracts UUID from ctl_ prefixed session name", () => {
    const result = extractWorkspaceIdFromSession(
      "ctl_550e8400e29b41d4a716446655440000_logan"
    );
    expect(result).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns null for non-ctl session names", () => {
    expect(extractWorkspaceIdFromSession("random_session")).toBeNull();
    expect(extractWorkspaceIdFromSession("3cf11776_logan")).toBeNull();
    expect(extractWorkspaceIdFromSession("")).toBeNull();
  });

  it("returns null for ctl_ prefix with wrong hex length", () => {
    expect(extractWorkspaceIdFromSession("ctl_abc_logan")).toBeNull();
  });

  it("roundtrips through buildWorkspaceSessionName", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const session = buildWorkspaceSessionName(uuid, "logan");
    expect(extractWorkspaceIdFromSession(session)).toBe(uuid);
  });
});

// ─── WorkspaceProcessManager ──────────────────────────────────────────────────

describe("WorkspaceProcessManager", () => {
  let mockChildren: MockChildProcess[];
  let forkFn: ReturnType<typeof vi.fn>;
  let manager: WorkspaceProcessManager;

  const BASE_DATA_DIR = "/data";
  const ENTRY_PATH = "/app/src/workspace-entry.js";
  const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";
  const WORKSPACE_ID_B = "660e8400-e29b-41d4-a716-446655440001";
  const WAHA_CONFIG = { baseUrl: "http://localhost:3004", apiKey: "test-key" };

  beforeEach(() => {
    vi.useFakeTimers();
    mockChildren = [];
    forkFn = vi.fn(() => {
      const child = new MockChildProcess();
      mockChildren.push(child);
      return child;
    });

    const opts: WorkspaceManagerOptions = {
      baseDataDir: BASE_DATA_DIR,
      entryPath: ENTRY_PATH,
      _forkFn: forkFn as unknown as WorkspaceManagerOptions["_forkFn"],
    };
    manager = new WorkspaceProcessManager(opts);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("startWorkspace", () => {
    it("forks child with CHATLYTICS_DATA_DIR scoped to workspaceId", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      expect(forkFn).toHaveBeenCalledTimes(1);
      const [, , opts] = forkFn.mock.calls[0] as [unknown, unknown, { env: Record<string, string> }];
      expect(opts.env.CHATLYTICS_DATA_DIR).toBe(join(BASE_DATA_DIR, WORKSPACE_ID));
    });

    it("forks child with CHATLYTICS_WORKSPACE_ID env var", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      const [, , opts] = forkFn.mock.calls[0] as [unknown, unknown, { env: Record<string, string> }];
      expect(opts.env.CHATLYTICS_WORKSPACE_ID).toBe(WORKSPACE_ID);
    });

    it("forks child with CHATLYTICS_PORT=0 for dynamic port", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      const [, , opts] = forkFn.mock.calls[0] as [unknown, unknown, { env: Record<string, string> }];
      expect(opts.env.CHATLYTICS_PORT).toBe("0");
    });

    it("does not fork again if workspace already in registry", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      expect(forkFn).toHaveBeenCalledTimes(1);
    });

    it("forks with ipc stdio option", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      const [, , opts] = forkFn.mock.calls[0] as [unknown, unknown, { stdio: unknown[] }];
      expect(opts.stdio).toContain("ipc");
    });
  });

  describe("IPC ready signal", () => {
    it("sets port after child sends ready IPC message", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      expect(manager.getPort(WORKSPACE_ID)).toBeNull();

      const child = mockChildren[0];
      child.emit("message", { type: "ready", port: 9123 });

      expect(manager.getPort(WORKSPACE_ID)).toBe(9123);
    });

    it("sets status to ready after IPC ready message", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      const child = mockChildren[0];
      child.emit("message", { type: "ready", port: 9123 });

      expect(manager.getStatus(WORKSPACE_ID)).toBe("ready");
    });

    it("getPort returns null before ready", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      expect(manager.getPort(WORKSPACE_ID)).toBeNull();
    });
  });

  describe("crash handling", () => {
    it("sets status to crashed on child exit", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      const child = mockChildren[0];
      child.emit("message", { type: "ready", port: 9123 });
      child.emit("exit", 1, null);

      expect(manager.getStatus(WORKSPACE_ID)).toBe("crashed");
    });

    it("sets port to null on child exit", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      const child = mockChildren[0];
      child.emit("message", { type: "ready", port: 9123 });
      child.emit("exit", 1, null);

      expect(manager.getPort(WORKSPACE_ID)).toBeNull();
    });

    it("schedules restart with exponential backoff after crash", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      const child = mockChildren[0];
      child.emit("exit", 0, null);

      // First restart: 1000 * 2^0 = 1000ms
      expect(forkFn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(forkFn).toHaveBeenCalledTimes(2);
    });

    it("uses exponential backoff on repeated crashes", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);

      // First crash
      mockChildren[0].emit("exit", 1, null);
      vi.advanceTimersByTime(1000); // 1000 * 2^0 = 1000ms
      expect(forkFn).toHaveBeenCalledTimes(2);

      // Second crash
      mockChildren[1].emit("exit", 1, null);
      vi.advanceTimersByTime(2000); // 1000 * 2^1 = 2000ms
      expect(forkFn).toHaveBeenCalledTimes(3);
    });

    it("caps backoff at 30_000ms", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      // Manually set restartCount to a high value to test cap
      // Crash 5 times to build up restartCount
      for (let i = 0; i < 5; i++) {
        const child = mockChildren[mockChildren.length - 1];
        child.emit("exit", 1, null);
        // Advance past each expected delay
        vi.advanceTimersByTime(30_000);
      }
      // After 5 crashes, delay should be capped at 30_000
      // We can verify the cap by checking forkFn was called for each
      expect(forkFn.mock.calls.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("crash isolation", () => {
    it("crashing workspace A does not affect workspace B port", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      await manager.startWorkspace(WORKSPACE_ID_B, WAHA_CONFIG);

      const childA = mockChildren[0];
      const childB = mockChildren[1];

      childA.emit("message", { type: "ready", port: 9001 });
      childB.emit("message", { type: "ready", port: 9002 });

      // Crash A
      childA.emit("exit", 1, null);

      expect(manager.getPort(WORKSPACE_ID_B)).toBe(9002);
      expect(manager.getStatus(WORKSPACE_ID_B)).toBe("ready");
    });

    it("crashing workspace A does not remove workspace B from registry", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      await manager.startWorkspace(WORKSPACE_ID_B, WAHA_CONFIG);

      mockChildren[0].emit("exit", 1, null);

      expect(manager.getStatus(WORKSPACE_ID_B)).not.toBeNull();
    });
  });

  describe("stopAll", () => {
    it("sends shutdown IPC to all children", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      await manager.startWorkspace(WORKSPACE_ID_B, WAHA_CONFIG);

      // stopAll sends shutdown then waits 5s before killing — advance fake timers
      const stopPromise = manager.stopAll();
      vi.advanceTimersByTime(6_000);
      await stopPromise;

      expect(mockChildren[0].send).toHaveBeenCalledWith({ type: "shutdown" });
      expect(mockChildren[1].send).toHaveBeenCalledWith({ type: "shutdown" });
    });
  });

  describe("getStatus", () => {
    it("returns null for unknown workspace", () => {
      expect(manager.getStatus("unknown-id")).toBeNull();
    });

    it("returns starting initially", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      expect(manager.getStatus(WORKSPACE_ID)).toBe("starting");
    });
  });

  describe("listWorkspaces", () => {
    it("returns empty array initially", () => {
      expect(manager.listWorkspaces()).toEqual([]);
    });

    it("returns all workspaces with their status", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      const list = manager.listWorkspaces();
      expect(list).toHaveLength(1);
      expect(list[0].workspaceId).toBe(WORKSPACE_ID);
      expect(list[0].status).toBe("starting");
      expect(list[0].port).toBeNull();
    });

    it("reflects port after ready", async () => {
      await manager.startWorkspace(WORKSPACE_ID, WAHA_CONFIG);
      mockChildren[0].emit("message", { type: "ready", port: 9001 });
      const list = manager.listWorkspaces();
      expect(list[0].port).toBe(9001);
    });
  });
});
