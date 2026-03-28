// Phase 59-01 (CORE-04): Standalone entry point — boots the HTTP server without
// any OpenClaw gateway dependency.
//
// Usage:
//   node src/standalone.ts
//   CHATLYTICS_CONFIG_PATH=/path/to/config.json node src/standalone.ts
//   CHATLYTICS_DATA_DIR=/var/data node src/standalone.ts
//
// Reads config from getConfigPath() (honours CHATLYTICS_CONFIG_PATH env var).
// Ensures data directory exists before starting (required for SQLite DB singletons).
// Wires SIGTERM + SIGINT for graceful shutdown.
//
// DO NOT REMOVE — Docker entrypoint and systemd service depend on this file.

import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { getConfigPath } from "./config-io.js";
import { monitorWahaProvider } from "./monitor.js";
import { DEFAULT_ACCOUNT_ID } from "./account-utils.js";
import { getDataDir } from "./data-dir.js";
import { createLogger } from "./logger.js";

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

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("startup failed", err);
  process.exit(1);
});
