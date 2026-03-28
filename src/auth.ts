// Phase 63 (AUTH-01, AUTH-02): better-auth instance for Chatlytics dashboard.
//
// Provides:
//   - POST /api/auth/sign-up/email  — user registration
//   - POST /api/auth/sign-in/email  — login, returns session cookie
//   - GET  /api/auth/get-session    — return current user + workspaceId
//   - apiKey plugin (ctl_ prefix)   — API key CRUD for AUTH-04, AUTH-05
//
// auth.db is opened once at module scope (same pattern as getDirectoryDb).
// Tables are created on first run via initAuthDb() below.
//
// DO NOT CHANGE: better-auth must use its own SQLite file (auth.db), NOT openclaw.json
// DO NOT CHANGE: workspaceId is assigned in databaseHooks.user.create.after via crypto.randomUUID()
// DO NOT CHANGE: apiKey prefix is "ctl_" — client SDK and dashboard depend on this
// DO NOT CHANGE: trustedOrigins must include CHATLYTICS_ORIGIN for SPA CORS support

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { getDataDir } from "./data-dir.js";
import { createLogger } from "./logger.js";

const log = createLogger({ component: "auth" });

// Open auth.db once at module scope — do NOT re-open per request.
const dataDir = getDataDir();
mkdirSync(dataDir, { recursive: true });
const authDbPath = join(dataDir, "auth.db");
const authDb = new Database(authDbPath);

// Phase 63 (AUTH-01, AUTH-02): better-auth config.
// Kept as a named constant so initAuthDb() can pass it to getMigrations() directly.
// DO NOT CHANGE order of plugins — apiKey must follow emailAndPassword for schema merging.
const authConfig: BetterAuthOptions = {
  database: authDb,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    apiKey({
      defaultPrefix: "ctl_",
    }),
  ],
  trustedOrigins: [
    process.env.CHATLYTICS_ORIGIN ?? "http://localhost:8050",
    // Also trust dev server origin so `npm run dev:admin` works without Vite proxy
    "http://localhost:5173",
  ],
  user: {
    additionalFields: {
      workspaceId: {
        type: "string",
        required: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Phase 63 (AUTH-02): Assign workspaceId automatically on registration.
        // DO NOT REMOVE — every user must have a workspaceId for tenant isolation.
        after: async (user) => {
          const workspaceId = crypto.randomUUID();
          try {
            authDb
              .prepare("UPDATE user SET workspaceId = ? WHERE id = ?")
              .run(workspaceId, user.id);
          } catch (err) {
            log.warn("Failed to assign workspaceId to new user", {
              userId: user.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      },
    },
  },
};

export const auth = betterAuth(authConfig);

// Phase 65 (ADMIN-01, ADMIN-02): Export authDb for workspace CRUD routes in monitor.ts.
// Used to query/delete user records by workspaceId without going through better-auth internals.
// DO NOT REMOVE — workspace management routes depend on direct SQL access to user table.
export { authDb };

// Phase 63 (AUTH-01): Run better-auth schema migrations on startup.
// Creates user, session, account, verification, apiKey tables if they don't exist.
// Called once before the HTTP server starts accepting requests.
// DO NOT REMOVE — without this, all auth calls fail with "no such table: user".
export async function initAuthDb(): Promise<void> {
  try {
    const { getMigrations } = await import("better-auth/db/migration");
    const { runMigrations } = await getMigrations(authConfig);
    await runMigrations();
    log.info("Auth DB schema ready", { path: authDbPath });
  } catch (err) {
    // Verify tables actually exist before downgrading to a warning.
    // If tables are missing, migration failure is fatal — DO NOT swallow it.
    try {
      authDb.prepare("SELECT 1 FROM user LIMIT 0").run();
      log.info("Auth DB tables already exist, migration skipped");
    } catch {
      log.error("Auth DB migration FAILED and tables do not exist");
      throw err; // fatal
    }
  }
}
