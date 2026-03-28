// Phase 59-01 (CORE-04): Standalone entry point — boots the HTTP server without
// any OpenClaw gateway dependency.
//
// Usage:
//   node src/standalone.ts
//   CHATLYTICS_CONFIG_PATH=/path/to/config.json node src/standalone.ts
//   CHATLYTICS_DATA_DIR=/var/data node src/standalone.ts
//   CHATLYTICS_MULTI_TENANT=true node src/standalone.ts  (Phase 64-02 multi-tenant mode)
//
// Reads config from getConfigPath() (honours CHATLYTICS_CONFIG_PATH env var).
// Ensures data directory exists before starting (required for SQLite DB singletons).
// Wires SIGTERM + SIGINT for graceful shutdown.
//
// DO NOT REMOVE — Docker entrypoint and systemd service depend on this file.

import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { join } from "node:path";
import { getConfigPath } from "./config-io.js";
import { monitorWahaProvider } from "./monitor.js";
import { DEFAULT_ACCOUNT_ID } from "./account-utils.js";
import { getDataDir } from "./data-dir.js";
import { createLogger } from "./logger.js";
// Phase 64-02 (TENANT-01, TENANT-04): Multi-tenant mode imports.
// DO NOT REMOVE — required for CHATLYTICS_MULTI_TENANT=true boot path.
import { initAuthDb } from "./auth.js";
import { WorkspaceProcessManager } from "./workspace-manager.js";
import { WorkspaceGateway } from "./workspace-gateway.js";

const log = createLogger({ component: "standalone" });

async function main(): Promise<void> {
  // Read config from getConfigPath() — honours CHATLYTICS_CONFIG_PATH and OPENCLAW_CONFIG_PATH.
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

  // Ensure data directory exists before SQLite singletons try to open databases.
  // Phase 59 (CORE-06): CHATLYTICS_DATA_DIR → Docker volume mount point.
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  log.info("data directory ready", { dataDir });

  // Phase 64-02 (TENANT-01, TENANT-04): Multi-tenant mode — boots WorkspaceGateway.
  // DO NOT CHANGE: CHATLYTICS_MULTI_TENANT env var check — controls boot mode.
  if (process.env.CHATLYTICS_MULTI_TENANT === "true") {
    await bootMultiTenant(config, dataDir);
    return;
  }

  const ac = new AbortController();

  // Phase 59 (CORE-04): Boot the webhook HTTP server via monitorWahaProvider.
  // This is the same function the OpenClaw gateway calls — no code duplication.
  // DO NOT REMOVE — standalone operation depends on this call.
  const { stop } = await monitorWahaProvider({
    accountId: DEFAULT_ACCOUNT_ID,
    config,
    runtime: { log: undefined },
    abortSignal: ac.signal,
  });

  log.info("standalone server started");

  // Graceful shutdown on SIGTERM (Docker stop) and SIGINT (Ctrl+C).
  // DO NOT REMOVE — ensures in-flight requests complete before exit.
  const shutdown = async (signal: string): Promise<void> => {
    log.info("shutdown signal received", { signal });
    ac.abort();
    await stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT",  () => { void shutdown("SIGINT"); });
}

/**
 * Multi-tenant boot path — active when CHATLYTICS_MULTI_TENANT=true.
 *
 * Phase 64-02 (TENANT-01, TENANT-04):
 *   1. Call initAuthDb() — parent owns auth.db; children must never open it.
 *   2. Discover existing workspaceIds from auth.db user table.
 *   3. Fork one child process per workspace via WorkspaceProcessManager.
 *   4. Start WorkspaceGateway to route API requests and webhooks to children.
 *
 * DO NOT CHANGE: initAuthDb() must be called in parent only — children skip it via
 *   the CHATLYTICS_WORKSPACE_ID guard in monitor.ts.
 * DO NOT CHANGE: workspace discovery query — SELECT DISTINCT workspaceId FROM user.
 * DO NOT CHANGE: entryPath resolution via fileURLToPath(import.meta.url) — ESM shim.
 */
async function bootMultiTenant(
  config: Record<string, unknown>,
  dataDir: string
): Promise<void> {
  log.info("booting in multi-tenant mode");

  // Step 1: Initialize auth.db schema (parent only).
  // DO NOT CHANGE: initAuthDb() must be called before querying auth.db for workspaceIds.
  await initAuthDb();

  // Step 2: Discover all workspaceIds from auth.db.
  // DO NOT CHANGE: workspace discovery query — finds all registered tenants.
  const authDbPath = join(dataDir, "auth.db");
  let workspaceIds: string[] = [];
  try {
    const authDb = new Database(authDbPath, { readonly: true });
    const rows = authDb
      .prepare("SELECT DISTINCT workspaceId FROM user WHERE workspaceId IS NOT NULL")
      .all() as Array<{ workspaceId: string }>;
    authDb.close();
    workspaceIds = rows.map((r) => r.workspaceId);
    log.info("discovered workspaces", { count: workspaceIds.length });
  } catch (err) {
    log.warn("failed to query auth.db for workspaces — starting with 0 tenants", {
      error: String(err),
    });
  }

  // Step 3: Build WorkspaceProcessManager.
  // DO NOT CHANGE: entryPath uses fileURLToPath + import.meta.url — ESM shim for __dirname.
  const entryPath = fileURLToPath(new URL("./workspace-entry.js", import.meta.url));
  const manager = new WorkspaceProcessManager({
    baseDataDir: dataDir,
    entryPath,
  });

  // Extract WAHA config for all child processes.
  const wahaSection = (config.waha ?? {}) as Record<string, unknown>;
  const wahaConfig = {
    baseUrl: (wahaSection.baseUrl as string | undefined) ?? "http://localhost:3000",
    apiKey: (wahaSection.apiKey as string | undefined) ?? "",
  };

  // Step 4: Fork child process for each existing workspace.
  for (const workspaceId of workspaceIds) {
    log.info("starting workspace child", { workspaceId });
    await manager.startWorkspace(workspaceId, wahaConfig);
  }

  // Step 5: Start WorkspaceGateway to route requests to children.
  const gatewayPort = (wahaSection.webhookPort as number | undefined) ?? 8050;
  const gatewayHost = (wahaSection.webhookHost as string | undefined) ?? "0.0.0.0";

  const gateway = new WorkspaceGateway({
    manager,
    port: gatewayPort,
    host: gatewayHost,
  });
  await gateway.start();

  log.info("multi-tenant gateway started", {
    port: gatewayPort,
    workspaces: workspaceIds.length,
  });

  // Graceful shutdown on SIGTERM (Docker stop) and SIGINT (Ctrl+C).
  // DO NOT REMOVE — gateway.stop() calls manager.stopAll() to clean up all children.
  const shutdown = async (signal: string): Promise<void> => {
    log.info("shutdown signal received", { signal });
    await gateway.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT",  () => { void shutdown("SIGINT"); });
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("startup failed", err);
  process.exit(1);
});
