// Phase 59-01 (CORE-06): Data directory utility — respects CHATLYTICS_DATA_DIR env var.
//
// Used by all SQLite database singletons (directory.ts, analytics.ts, mimicry-gate.ts)
// so that databases land in a configurable directory suitable for Docker volume mounts.
//
// Priority:
//   1. CHATLYTICS_DATA_DIR env var — Docker deployments set this to the volume mount path
//   2. ~/.openclaw/data — backward compat for existing hpg6 deployments
//
// DO NOT CHANGE fallback path — existing installations depend on ~/.openclaw/data.

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Returns the data directory path for SQLite databases.
 *
 * Phase 59 (CORE-06): CHATLYTICS_DATA_DIR env var support for Docker volume persistence.
 * DO NOT hardcode .openclaw/data anywhere else — always call this function.
 */
export function getDataDir(): string {
  return process.env.CHATLYTICS_DATA_DIR ?? join(homedir(), ".openclaw", "data");
}
