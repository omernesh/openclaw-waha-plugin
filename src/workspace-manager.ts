// Phase 64-01 (TENANT-01..03): WorkspaceProcessManager — per-workspace child process isolation.
//
// Each workspace runs in its own child process with:
//   - CHATLYTICS_DATA_DIR scoped to {baseDataDir}/{workspaceId} (TENANT-02)
//   - CHATLYTICS_WORKSPACE_ID set to the workspaceId
//   - CHATLYTICS_PORT="0" for dynamic port assignment
//   - WAHA sessions namespaced as ctl_{hex32}_{baseName} (TENANT-03)
//
// Crash isolation: a crash in one workspace restarts only that workspace with exponential
// backoff (1s, 2s, 4s ... capped at 30s) — other workspaces are unaffected.
//
// DO NOT CHANGE: IPC message format { type: "ready", port } — workspace-entry.ts sends this.
// DO NOT CHANGE: env var names CHATLYTICS_DATA_DIR, CHATLYTICS_WORKSPACE_ID, CHATLYTICS_PORT.
// DO NOT CHANGE: session name format ctl_{hex32}_{baseName} — WAHA session registry depends on it.

import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger({ component: "workspace-manager" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ForkFn = typeof fork;

/** WAHA connection config for a workspace. */
export interface WahaConfig {
  baseUrl: string;
  apiKey: string;
}

/** Live state for a single forked workspace process. */
export interface WorkspaceEntry {
  workspaceId: string;
  child: ChildProcess;
  port: number | null;
  status: "starting" | "ready" | "crashed";
  restartCount: number;
  wahaConfig: WahaConfig;
}

/** Options for constructing WorkspaceProcessManager. */
export interface WorkspaceManagerOptions {
  /** Base directory under which per-workspace data dirs are created. */
  baseDataDir: string;
  /** Absolute path to workspace-entry.ts/.js child entry point. */
  entryPath: string;
  /** Dependency injection — replace fork() for unit tests. */
  _forkFn?: ForkFn;
}

// ─── Session name utilities ───────────────────────────────────────────────────

/**
 * Build a WAHA session name namespaced to a workspace.
 *
 * Format: ctl_{hex32}_{baseName}
 * Example: buildWorkspaceSessionName("550e8400-e29b-41d4-a716-446655440000", "logan")
 *          => "ctl_550e8400e29b41d4a716446655440000_logan"
 *
 * DO NOT CHANGE: format ctl_{hex32}_{baseName} — extractWorkspaceIdFromSession must match.
 */
export function buildWorkspaceSessionName(
  workspaceId: string,
  baseName: string
): string {
  // Strip hyphens from UUID to get 32-char hex
  const hex32 = workspaceId.replace(/-/g, "");
  return `ctl_${hex32}_${baseName}`;
}

/**
 * Extract workspace UUID from a namespaced WAHA session name.
 *
 * Returns the UUID (with hyphens) if the session matches ctl_{hex32}_{*},
 * returns null for non-namespaced sessions.
 *
 * DO NOT CHANGE: regex pattern must match buildWorkspaceSessionName output exactly.
 */
export function extractWorkspaceIdFromSession(
  sessionName: string
): string | null {
  const match = /^ctl_([0-9a-f]{32})_/.exec(sessionName);
  if (!match) return null;

  const hex = match[1];
  // Reconstruct UUID format: 8-4-4-4-12
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ─── WorkspaceProcessManager ──────────────────────────────────────────────────

/**
 * Manages isolated child processes for multi-tenant workspace isolation.
 *
 * Phase 64-01 (TENANT-01): Each workspace runs in its own child process.
 * Crash in one workspace does not affect others — processes are fully isolated.
 */
export class WorkspaceProcessManager {
  private readonly forkFn: ForkFn;
  private readonly baseDataDir: string;
  private readonly entryPath: string;
  private readonly registry = new Map<string, WorkspaceEntry>();

  constructor(opts: WorkspaceManagerOptions) {
    this.forkFn = opts._forkFn ?? fork;
    this.baseDataDir = opts.baseDataDir;
    this.entryPath = opts.entryPath;
  }

  /**
   * Start a workspace child process. No-op if already in registry.
   *
   * Phase 64-01 (TENANT-01): Fork with workspace-scoped env vars.
   * DO NOT CHANGE: env var names CHATLYTICS_DATA_DIR, CHATLYTICS_WORKSPACE_ID, CHATLYTICS_PORT.
   */
  async startWorkspace(workspaceId: string, wahaConfig: WahaConfig): Promise<void> {
    if (this.registry.has(workspaceId)) {
      log.debug("workspace already started, skipping", { workspaceId });
      return;
    }

    const entry: WorkspaceEntry = {
      workspaceId,
      child: null as unknown as ChildProcess, // set in _fork
      port: null,
      status: "starting",
      restartCount: 0,
      wahaConfig,
    };

    this.registry.set(workspaceId, entry);
    this._fork(entry);
  }

  /**
   * Fork the child process for a workspace entry.
   *
   * Phase 64-01 (TENANT-02): CHATLYTICS_DATA_DIR scoped to workspaceId.
   * Phase 64-01 (TENANT-03): CHATLYTICS_PORT="0" for dynamic port assignment.
   *
   * DO NOT CHANGE: stdio must include "ipc" for process.send() to work.
   * DO NOT CHANGE: CHATLYTICS_DATA_DIR path — child SQLite databases must land here.
   */
  private _fork(entry: WorkspaceEntry): void {
    const dataDir = join(this.baseDataDir, entry.workspaceId);

    const child = this.forkFn(this.entryPath, [], {
      env: {
        ...process.env,
        // DO NOT CHANGE: CHATLYTICS_DATA_DIR scopes all child SQLite DBs to workspace dir.
        CHATLYTICS_DATA_DIR: dataDir,
        // DO NOT CHANGE: CHATLYTICS_WORKSPACE_ID identifies the workspace in the child.
        CHATLYTICS_WORKSPACE_ID: entry.workspaceId,
        // DO NOT CHANGE: CHATLYTICS_PORT="0" requests dynamic port — child binds and reports actual port.
        CHATLYTICS_PORT: "0",
      },
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });

    entry.child = child;
    entry.status = "starting";
    entry.port = null;

    log.info("workspace child forked", {
      workspaceId: entry.workspaceId,
      dataDir,
      pid: child.pid,
    });

    // DO NOT CHANGE: IPC message format { type: "ready", port } — workspace-entry.ts sends this.
    child.on("message", (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "ready"
      ) {
        const port = (msg as Record<string, unknown>).port as number;
        entry.port = port;
        entry.status = "ready";
        entry.restartCount = 0;
        log.info("workspace ready", { workspaceId: entry.workspaceId, port });
      }
    });

    child.on("exit", (code, signal) => {
      log.warn("workspace child exited", {
        workspaceId: entry.workspaceId,
        code,
        signal,
        restartCount: entry.restartCount,
      });

      entry.status = "crashed";
      entry.port = null;

      // Exponential backoff restart: 1000 * 2^restartCount, capped at 30_000ms.
      // DO NOT CHANGE: backoff formula — prevents rapid restart storms.
      const delay = Math.min(1000 * 2 ** entry.restartCount, 30_000);
      entry.restartCount += 1;

      log.info("scheduling workspace restart", {
        workspaceId: entry.workspaceId,
        delayMs: delay,
        restartCount: entry.restartCount,
      });

      setTimeout(() => {
        // Phase 65 (ADMIN-02): Guard: if workspace was deleted via stopWorkspace(),
        // registry entry is gone — do not restart. DO NOT REMOVE.
        if (!this.registry.has(entry.workspaceId)) {
          log.info("workspace removed from registry, skipping restart", { workspaceId: entry.workspaceId });
          return;
        }
        log.info("restarting workspace child", { workspaceId: entry.workspaceId });
        this._fork(entry);
      }, delay).unref();
    });
  }

  /**
   * Get the port a workspace is listening on, or null if not yet ready / crashed.
   */
  getPort(workspaceId: string): number | null {
    const entry = this.registry.get(workspaceId);
    if (!entry || entry.status !== "ready") return null;
    return entry.port;
  }

  /**
   * Get the status of a workspace, or null if not in registry.
   */
  getStatus(workspaceId: string): WorkspaceEntry["status"] | null {
    return this.registry.get(workspaceId)?.status ?? null;
  }

  /**
   * Send shutdown IPC to all workspace children and kill after 5s timeout.
   *
   * DO NOT CHANGE: shutdown message format { type: "shutdown" } — workspace-entry.ts listens for this.
   */
  async stopAll(): Promise<void> {
    const entries = [...this.registry.values()];

    for (const entry of entries) {
      try {
        entry.child.send({ type: "shutdown" });
      } catch (err) {
        log.warn("failed to send shutdown to child", {
          workspaceId: entry.workspaceId,
          error: String(err),
        });
      }
    }

    // Kill any children that haven't exited after 5s
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        for (const entry of entries) {
          if (entry.status !== "crashed") {
            try {
              entry.child.kill();
            } catch (err) { log.debug("failed to kill child", { error: String(err) }); }
          }
        }
        resolve();
      }, 5_000);
    });
  }

  /**
   * Stop a single workspace child process and remove it from the registry.
   *
   * Phase 65 (ADMIN-02): Used by DELETE /api/admin/workspaces/:workspaceId.
   * Sends IPC shutdown message, kills after 5s timeout, then removes from registry
   * so the crash-restart loop does not re-fork the deleted workspace.
   *
   * DO NOT CHANGE: registry.delete() must happen BEFORE the process exits naturally
   * or the exit handler will schedule a restart for a deleted workspace.
   */
  async stopWorkspace(workspaceId: string): Promise<void> {
    const entry = this.registry.get(workspaceId);
    if (!entry) {
      log.debug("stopWorkspace: workspace not in registry, nothing to stop", { workspaceId });
      return;
    }

    // Remove from registry FIRST — prevents exit handler from re-forking.
    // DO NOT CHANGE: must delete before kill so the 'exit' listener sees no entry and skips restart.
    this.registry.delete(workspaceId);

    try {
      entry.child.send({ type: "shutdown" });
    } catch (err) {
      log.warn("stopWorkspace: failed to send shutdown IPC", { workspaceId, error: String(err) });
    }

    // Kill after 5s if still running
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try { entry.child.kill(); } catch (err) { log.debug("failed to kill child", { error: String(err) }); }
        resolve();
      }, 5_000);
      timeout.unref();
      entry.child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    log.info("workspace stopped", { workspaceId });
  }

  /**
   * List all registered workspaces with their current status and port.
   */
  listWorkspaces(): Array<{ workspaceId: string; status: string; port: number | null }> {
    return [...this.registry.values()].map((entry) => ({
      workspaceId: entry.workspaceId,
      status: entry.status,
      port: entry.port,
    }));
  }
}
