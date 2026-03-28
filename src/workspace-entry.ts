// Phase 64-01 (TENANT-01..03): Workspace child process entry point.
//
// Forked by WorkspaceProcessManager for each tenant workspace.
// Boots monitorWahaProvider on a dynamic port and reports readiness via IPC.
//
// Key differences from standalone.ts:
//   - Dynamic port: CHATLYTICS_PORT="0" -> bind to OS-assigned port -> send { type: "ready", port }
//   - Session namespacing: WAHA session names prefixed with ctl_{hex32}_ per TENANT-03
//   - NO auth.db: must never import or call auth.ts — auth is parent-only
//   - Data dir: CHATLYTICS_DATA_DIR already set by parent (workspace-scoped)
//
// DO NOT REMOVE — forked by WorkspaceProcessManager for each tenant workspace.
// DO NOT import auth.ts here — child processes must not open auth.db in scoped data dir.

import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { getConfigPath } from "./config-io.js";
import { monitorWahaProvider } from "./monitor.js";
import { DEFAULT_ACCOUNT_ID } from "./account-utils.js";
import { getDataDir } from "./data-dir.js";
import { createLogger } from "./logger.js";
import { buildWorkspaceSessionName } from "./workspace-manager.js";

const log = createLogger({ component: "workspace-entry" });

// DO NOT CHANGE: CHATLYTICS_WORKSPACE_ID is set by WorkspaceProcessManager._fork()
const workspaceId = process.env.CHATLYTICS_WORKSPACE_ID;

if (!workspaceId) {
  log.error("CHATLYTICS_WORKSPACE_ID not set — workspace-entry must be run via WorkspaceProcessManager");
  process.exit(1);
}

/**
 * Find a free port by binding a temporary HTTP server to port 0 on 127.0.0.1.
 * Returns the OS-assigned port number.
 *
 * DO NOT CHANGE: This is the canonical dynamic port discovery method.
 * CHATLYTICS_PORT="0" in the fork env triggers this path.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("failed to get dynamic port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/**
 * Prefix all WAHA session names in config with the workspace namespace.
 *
 * Phase 64-01 (TENANT-03): WAHA sessions namespaced as ctl_{hex32}_{baseName}.
 * Ensures session isolation across workspaces on the same WAHA instance.
 *
 * DO NOT CHANGE: session name prefixing — WAHA session registry depends on this format.
 */
function prefixSessionNames(
  config: Record<string, unknown>,
  wsId: string
): Record<string, unknown> {
  const waha = config.waha as Record<string, unknown> | undefined;
  if (!waha) return config;

  const accounts = waha.accounts as Record<string, unknown> | undefined;
  if (!accounts || typeof accounts !== "object") return config;

  const prefixedAccounts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(accounts)) {
    const acct = value as Record<string, unknown>;
    const originalSession = typeof acct.session === "string" ? acct.session : key;
    prefixedAccounts[key] = {
      ...acct,
      // DO NOT CHANGE: buildWorkspaceSessionName format ctl_{hex32}_{baseName}
      session: buildWorkspaceSessionName(wsId, originalSession),
    };
  }

  return {
    ...config,
    waha: {
      ...waha,
      accounts: prefixedAccounts,
    },
  };
}

async function main(): Promise<void> {
  log.info("workspace child starting", { workspaceId });

  // Read config from getConfigPath() — same as standalone.ts
  const configPath = getConfigPath();
  log.info("loading config", { configPath });

  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (err) {
    log.error("failed to read config file", { configPath, error: String(err) });
    process.exit(1);
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    log.error("failed to parse config JSON", { configPath, error: String(err) });
    process.exit(1);
  }

  // Ensure workspace-scoped data directory exists before SQLite singletons open databases.
  // CHATLYTICS_DATA_DIR is already set to {baseDataDir}/{workspaceId} by the parent fork.
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  log.info("workspace data directory ready", { dataDir, workspaceId });

  // Determine dynamic port.
  // DO NOT CHANGE: CHATLYTICS_PORT="0" is set by WorkspaceProcessManager._fork().
  const portEnv = process.env.CHATLYTICS_PORT;
  let actualPort: number;

  if (portEnv === "0" || !portEnv) {
    // Dynamic port: bind to OS-assigned port
    actualPort = await findFreePort();
    log.info("dynamic port assigned", { port: actualPort, workspaceId });
  } else {
    actualPort = parseInt(portEnv, 10);
  }

  // Override webhookPort in config with dynamic port so monitorWahaProvider listens there.
  const waha = (config.waha ?? {}) as Record<string, unknown>;
  config = {
    ...config,
    waha: {
      ...waha,
      webhookPort: actualPort,
    },
  };

  // Prefix WAHA session names with workspace namespace for tenant isolation (TENANT-03).
  // DO NOT CHANGE: session prefixing must happen before monitorWahaProvider is called.
  config = prefixSessionNames(config, workspaceId);

  const ac = new AbortController();

  // Boot the webhook HTTP server — same call as standalone.ts.
  // initAuthDb() is skipped inside monitorWahaProvider because CHATLYTICS_WORKSPACE_ID is set.
  // DO NOT REMOVE — workspace operation depends on this call.
  const { stop } = await monitorWahaProvider({
    accountId: DEFAULT_ACCOUNT_ID,
    config,
    runtime: { log: undefined },
    abortSignal: ac.signal,
  });

  // Notify parent that we are ready and listening on actualPort.
  // DO NOT CHANGE: IPC message format { type: "ready", port } — WorkspaceProcessManager listens for this.
  process.send?.({ type: "ready", port: actualPort });
  log.info("workspace ready, IPC sent", { workspaceId, port: actualPort });

  // Graceful shutdown: listen for shutdown IPC from parent.
  // DO NOT CHANGE: IPC message format { type: "shutdown" } — WorkspaceProcessManager.stopAll() sends this.
  process.on("message", async (msg: unknown) => {
    if (
      typeof msg === "object" &&
      msg !== null &&
      (msg as Record<string, unknown>).type === "shutdown"
    ) {
      log.info("shutdown IPC received", { workspaceId });
      ac.abort();
      await stop();
      process.exit(0);
    }
  });

  // Graceful shutdown on SIGTERM (Docker stop) and SIGINT (Ctrl+C).
  const shutdown = async (signal: string): Promise<void> => {
    log.info("shutdown signal received", { signal, workspaceId });
    ac.abort();
    await stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT",  () => { void shutdown("SIGINT"); });
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("workspace startup failed", err);
  process.exit(1);
});
