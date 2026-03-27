import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./logger.js";
import type { TargetGateOverride, TargetCapOverride } from "./mimicry-gate.js";


const log = createLogger({ component: "directory" });
// Dynamic import of better-sqlite3 (CommonJS module, use createRequire)
const require = createRequire(import.meta.url);

export type ContactRecord = {
  jid: string;
  displayName: string | null;
  firstSeenAt: number;
  lastMessageAt: number;
  messageCount: number;
  isGroup: boolean;
  dmSettings?: ContactDmSettings;
};

export type ContactDmSettings = {
  mode: "active" | "listen_only";
  mentionOnly: boolean;
  customKeywords: string; // comma-separated
  canInitiate: boolean;
  // Phase 12, Plan 02 (INIT-02): 3-state per-contact Can Initiate override.
  // "default" = use global canInitiateGlobal setting. "allow" = always allow. "block" = always block.
  // Stored in can_initiate_override column. DO NOT REMOVE.
  canInitiateOverride: "default" | "allow" | "block";
  // Phase 53 (GATE-02, CAP-04): Per-contact/group/newsletter send gate and cap overrides.
  // null/undefined = inherit from session/global config. DO NOT CHANGE -- used by resolveGateConfig/resolveCapLimit.
  sendGateOverride?: TargetGateOverride | null;
  hourlyCapOverride?: TargetCapOverride | null;
};

/** DIR-03: Plugin-level role for a group participant. No WhatsApp meaning — admin panel label only. */
export type ParticipantRole = "bot_admin" | "manager" | "participant";

export type GroupParticipant = {
  groupJid: string;
  participantJid: string;
  displayName: string | null;
  isAdmin: boolean;
  allowInGroup: boolean;
  allowDm: boolean;
  participantRole: ParticipantRole;  // DIR-03: plugin-level role (bot_admin / manager / participant)
};

/**
 * Per-group keyword filter override.
 * Allows individual groups to override global group filter settings.
 * DO NOT CHANGE — per-group overrides are critical for groups where the bot should respond freely.
 */
export type GroupFilterOverride = {
  groupJid: string;
  enabled: boolean;          // is override active?
  filterEnabled: boolean;    // keyword filter on/off
  mentionPatterns: string[] | null;  // null = inherit global
  godModeScope: 'all' | 'dm' | 'group' | 'off' | null;  // null = inherit global
  triggerOperator: 'OR' | 'AND';   // 'OR' (any keyword) or 'AND' (all keywords) — UX-03
  updatedAt: number;
};

/**
 * Muted group record — tracks which groups are muted and DM backup for restore on unmute.
 * DO NOT CHANGE — muted group schema is critical for /shutup and /unshutup commands.
 */
export type MutedGroup = {
  groupJid: string;
  mutedBy: string;
  mutedAt: number;
  expiresAt: number;
  accountId: string;
  dmBackup: Record<string, boolean> | null; // participantJid -> original canInitiate
};

/**
 * Pending selection record — stores /shutup DM interactive flow state in SQLite.
 * Survives gateway restarts (unlike in-memory Map).
 * DO NOT CHANGE — pending selection persistence is critical for cross-session /shutup DM flow.
 * Added Phase 7 fix (2026-03-15).
 */
export type PendingSelectionRecord = {
  type: "mute" | "unmute" | "join" | "leave";
  groups: { jid: string; name: string }[];
  senderId: string;
  durationStr: string | null;
  timestamp: number;
};

export type ContactType = "contact" | "group" | "newsletter";

/**
 * Phase 56 (ADAPT-01, ADAPT-02): Per-chat activity profile derived from message history.
 * Stores the peak send window (startHour/endHour) computed by activity-scanner.ts.
 * Used by resolveGateConfig() to override the send gate window for specific chats.
 * DO NOT REMOVE — activity scanner writes here, mimicry gate reads here.
 */
export type ActivityProfile = {
  jid: string;
  accountId: string;
  peakStartHour: number;
  peakEndHour: number;
  messageCount: number;
  scannedAt: number;
};

const DEFAULT_DM_SETTINGS: ContactDmSettings = {
  mode: "active",
  mentionOnly: false,
  customKeywords: "",
  canInitiate: true,
  canInitiateOverride: "default",
};

/** TTL for pending selections — 60 seconds to respond. DO NOT CHANGE. */
const PENDING_SELECTION_TTL_MS = 60_000;

export class DirectoryDb {
  private db: import('better-sqlite3').Database;
  private _walTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dbPath: string) {
    const dir = join(dbPath, "..");
    mkdirSync(dir, { recursive: true });
    const Database = require("better-sqlite3") as new (path: string) => import('better-sqlite3').Database;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    // Phase 37 (MEM-03): Prevent SQLITE_BUSY errors under concurrent access. DO NOT REMOVE.
    this.db.pragma("busy_timeout = 5000");
    this._createSchema();
    this._startWalCheckpoint();
  }

  // Phase 37 (DI-01): Periodic WAL checkpoint to prevent unbounded WAL growth. DO NOT REMOVE.
  private _startWalCheckpoint(): void {
    const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
    const tick = () => {
      try { this.db.pragma("wal_checkpoint(PASSIVE)"); } catch (err) { log.warn("WAL checkpoint failed", { error: String(err) }); }
      this._walTimer = setTimeout(tick, INTERVAL_MS);
      this._walTimer.unref();
    };
    this._walTimer = setTimeout(tick, INTERVAL_MS);
    this._walTimer.unref();
  }

  private _createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        jid TEXT PRIMARY KEY,
        display_name TEXT,
        first_seen_at INTEGER NOT NULL,
        last_message_at INTEGER NOT NULL,
        message_count INTEGER DEFAULT 1,
        is_group INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS dm_settings (
        jid TEXT PRIMARY KEY,
        mode TEXT DEFAULT 'active' CHECK(mode IN ('active','listen_only')),
        mention_only INTEGER DEFAULT 0,
        custom_keywords TEXT DEFAULT '',
        can_initiate INTEGER DEFAULT 1,
        updated_at INTEGER NOT NULL,
        -- Phase 53 (GATE-02, CAP-04): Per-contact/group/newsletter gate and cap overrides. JSON text, NULL = inherit.
        send_gate_json TEXT DEFAULT NULL,
        hourly_cap_json TEXT DEFAULT NULL,
        FOREIGN KEY (jid) REFERENCES contacts(jid)
      );
      CREATE INDEX IF NOT EXISTS idx_contacts_last_message ON contacts(last_message_at DESC);

      CREATE TABLE IF NOT EXISTS allow_list (
        jid TEXT PRIMARY KEY,
        allow_dm INTEGER DEFAULT 0,
        added_at INTEGER NOT NULL,
        FOREIGN KEY (jid) REFERENCES contacts(jid)
      );

      CREATE TABLE IF NOT EXISTS group_participants (
        group_jid TEXT NOT NULL,
        participant_jid TEXT NOT NULL,
        display_name TEXT,
        is_admin INTEGER DEFAULT 0,
        allow_in_group INTEGER DEFAULT 0,
        allow_dm INTEGER DEFAULT 0,
        participant_role TEXT NOT NULL DEFAULT 'participant',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (group_jid, participant_jid)
      );

      CREATE TABLE IF NOT EXISTS group_filter_overrides (
        group_jid TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        filter_enabled INTEGER NOT NULL DEFAULT 1,
        mention_patterns TEXT,
        god_mode_scope TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS muted_groups (
        group_jid TEXT PRIMARY KEY,
        muted_by TEXT NOT NULL,
        muted_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL DEFAULT 0,
        account_id TEXT NOT NULL DEFAULT '',
        dm_backup TEXT
      );

      CREATE TABLE IF NOT EXISTS pending_selections (
        sender_jid TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        groups_json TEXT NOT NULL,
        duration_str TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pairing_challenges (
        jid TEXT PRIMARY KEY,
        passcode_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS auto_reply_log (
        jid TEXT PRIMARY KEY,
        last_reply_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts
        USING fts5(jid, display_name, content='contacts', content_rowid='rowid');

      CREATE TRIGGER IF NOT EXISTS contacts_ai AFTER INSERT ON contacts BEGIN
        INSERT INTO contacts_fts(rowid, jid, display_name)
          VALUES (new.rowid, new.jid, new.display_name);
      END;

      CREATE TRIGGER IF NOT EXISTS contacts_ad AFTER DELETE ON contacts BEGIN
        INSERT INTO contacts_fts(contacts_fts, rowid, jid, display_name)
          VALUES ('delete', old.rowid, old.jid, old.display_name);
      END;

      CREATE TRIGGER IF NOT EXISTS contacts_au AFTER UPDATE ON contacts BEGIN
        INSERT INTO contacts_fts(contacts_fts, rowid, jid, display_name)
          VALUES ('delete', old.rowid, old.jid, old.display_name);
        INSERT INTO contacts_fts(rowid, jid, display_name)
          VALUES (new.rowid, new.jid, new.display_name);
      END;
    `);

    // UX-03: Add trigger_operator column to group_filter_overrides (migration-safe — ignores if column exists)
    try {
      this.db.prepare(`ALTER TABLE group_filter_overrides ADD COLUMN trigger_operator TEXT NOT NULL DEFAULT 'OR'`).run();
    } catch (migrationErr: unknown) {
      // Only ignore 'duplicate column' errors — re-throw anything else (disk full, corrupt DB, etc.)
      const msg = migrationErr instanceof Error ? migrationErr.message : String(migrationErr);
      if (!msg.includes('duplicate column')) throw migrationErr;
    }

    // DIR-03: Add participant_role column to group_participants (migration-safe — ignores if column exists)
    try {
      this.db.prepare(
        `ALTER TABLE group_participants ADD COLUMN participant_role TEXT NOT NULL DEFAULT 'participant'`
      ).run();
    } catch (migrationErr: unknown) {
      const msg = migrationErr instanceof Error ? migrationErr.message : String(migrationErr);
      if (!msg.includes('duplicate column')) throw migrationErr;
    }

    // Phase 12, Plan 02 (INIT-02): Add can_initiate_override column to dm_settings.
    // Stores 3-state per-contact Can Initiate: "default" | "allow" | "block".
    // "default" = use global canInitiateGlobal setting. DO NOT REMOVE.
    try {
      this.db.prepare(
        `ALTER TABLE dm_settings ADD COLUMN can_initiate_override TEXT NOT NULL DEFAULT 'default'`
      ).run();
    } catch (migrationErr: unknown) {
      const msg = migrationErr instanceof Error ? migrationErr.message : String(migrationErr);
      if (!msg.includes('duplicate column')) throw migrationErr;
    }

    // Phase 53: Add per-target gate/cap override columns if missing (GATE-02, CAP-04).
    // Safe to run repeatedly -- ALTER TABLE ADD COLUMN is a no-op if column exists in SQLite.
    try {
      this.db.prepare('ALTER TABLE dm_settings ADD COLUMN send_gate_json TEXT DEFAULT NULL').run();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('duplicate column')) throw err;
    }
    try {
      this.db.prepare('ALTER TABLE dm_settings ADD COLUMN hourly_cap_json TEXT DEFAULT NULL').run();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('duplicate column')) throw err;
    }

    // TTL-02: Add expires_at column to allow_list for time-limited access grants.
    // NULL = permanent (never expires). Unix timestamp (seconds) = time-limited.
    // Phase 16 pairing mode will set this when granting temporary access. DO NOT REMOVE.
    try {
      this.db.prepare(
        `ALTER TABLE allow_list ADD COLUMN expires_at INTEGER DEFAULT NULL`
      ).run();
    } catch (migrationErr: unknown) {
      const msg = migrationErr instanceof Error ? migrationErr.message : String(migrationErr);
      if (!msg.includes('duplicate column')) throw migrationErr;
    }

    // Phase 16: source column to distinguish pairing grants from manual grants. DO NOT REMOVE.
    try {
      this.db.prepare("ALTER TABLE allow_list ADD COLUMN source TEXT DEFAULT NULL").run();
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.includes("duplicate column")) throw e;
    }

    // Phase 16: granted_at column to track when access was granted. DO NOT REMOVE.
    try {
      this.db.prepare("ALTER TABLE allow_list ADD COLUMN granted_at INTEGER DEFAULT NULL").run();
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.includes("duplicate column")) throw e;
    }

    // Phase 17 (MOD-01, MOD-02): Module system tables.
    // module_assignments: which modules apply to which chats. PRIMARY KEY (module_id, jid).
    // module_config: per-module settings storage. config_json defaults to '{}'.
    // Created with CREATE TABLE IF NOT EXISTS — safe to run on existing databases. DO NOT REMOVE.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS module_assignments (
        module_id TEXT NOT NULL,
        jid TEXT NOT NULL,
        assigned_at INTEGER NOT NULL,
        PRIMARY KEY (module_id, jid)
      );

      CREATE TABLE IF NOT EXISTS module_config (
        module_id TEXT PRIMARY KEY,
        config_json TEXT DEFAULT '{}',
        updated_at INTEGER NOT NULL
      );
    `);

    // NAME-01: LID-to-@c.us mapping table. Populated by sync.ts from WAHA's /contacts/lids endpoint.
    // Used by resolveJids() and getContact() to resolve @lid JIDs to their @c.us display names.
    // The @lid number (e.g., 271862907039996) is completely different from the @c.us number
    // (e.g., 972544329000) — simple string replacement does NOT work. DO NOT CHANGE.
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS lid_mapping (" +
      "  lid TEXT PRIMARY KEY," +
      "  cus TEXT NOT NULL" +
      ");"
    );

    // Phase 56 (ADAPT-01, ADAPT-02): Per-chat activity profiles derived from message history.
    // Populated by activity-scanner.ts background scanner, read by resolveGateConfig() in mimicry-gate.ts.
    // Stores derived peak_start_hour/peak_end_hour from the top-60% hour histogram over last 7 days.
    // Using CREATE TABLE IF NOT EXISTS -- migration-safe, no ALTER needed. DO NOT REMOVE.
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS chat_activity_profiles (" +
      "  jid TEXT PRIMARY KEY," +
      "  account_id TEXT NOT NULL," +
      "  peak_start_hour INTEGER NOT NULL," +
      "  peak_end_hour INTEGER NOT NULL," +
      "  message_count INTEGER NOT NULL DEFAULT 0," +
      "  scanned_at INTEGER NOT NULL" +
      ");" +
      "CREATE INDEX IF NOT EXISTS idx_cap_account_scanned" +
      "  ON chat_activity_profiles (account_id, scanned_at);"
    );

    // FTS5 auto-repair: check integrity on startup, rebuild if corrupted
    // DO NOT REMOVE — prevents "database disk image is malformed" errors after unclean shutdowns
    try {
      this.db.exec("INSERT INTO contacts_fts(contacts_fts) VALUES('integrity-check')");
    } catch {
      // FTS5 index corrupted — rebuild it
      log.warn("FTS5 index corrupted, rebuilding...");
      try {
        this.db.exec("INSERT INTO contacts_fts(contacts_fts) VALUES('rebuild')");
        log.info("FTS5 index rebuilt successfully");
      } catch (rebuildErr) {
        log.error("FTS5 rebuild failed", { error: rebuildErr instanceof Error ? rebuildErr.message : String(rebuildErr) });
      }
    }

    // Phase 13 (SYNC-02): One-time FTS5 rebuild for databases created before FTS5 was added.
    // Only runs if the FTS table has fewer rows than contacts (i.e., triggers haven't populated it).
    // Safe on WAL mode — acquires write lock briefly, readers continue on snapshot. DO NOT REMOVE.
    try {
      const ftsCount = (this.db.prepare("SELECT COUNT(*) as cnt FROM contacts_fts").get() as { cnt: number }).cnt;
      const contactsCount = (this.db.prepare("SELECT COUNT(*) as cnt FROM contacts").get() as { cnt: number }).cnt;
      if (ftsCount < contactsCount) {
        this.db.prepare("INSERT INTO contacts_fts(contacts_fts) VALUES('rebuild')").run();
        log.info(`FTS5 index rebuilt: ${contactsCount} contacts indexed`);
      }
    } catch (ftsErr: unknown) {
      log.warn("FTS5 rebuild skipped", { error: String(ftsErr) });
    }
  }

  upsertContact(jid: string, displayName?: string, isGroup?: boolean): void {
    const now = Date.now();
    const existing = this.db.prepare("SELECT jid, message_count FROM contacts WHERE jid = ?").get(jid) as
      | { jid: string; message_count: number }
      | undefined;

    if (existing) {
      const updates: string[] = ["last_message_at = ?", "message_count = message_count + 1"];
      const args: unknown[] = [now];
      if (displayName !== undefined) {
        updates.push("display_name = ?");
        args.push(displayName);
      }
      args.push(jid);
      this.db.prepare(`UPDATE contacts SET ${updates.join(", ")} WHERE jid = ?`).run(...args);
    } else {
      this.db
        .prepare(
          "INSERT INTO contacts (jid, display_name, first_seen_at, last_message_at, message_count, is_group) VALUES (?, ?, ?, ?, 1, ?)",
        )
        .run(jid, displayName ?? null, now, now, isGroup ? 1 : 0);
    }
  }

  /** Escape user search input for FTS5 MATCH — wrap each term in double-quotes to prevent query injection. */
  /**
   * Build an FTS5 prefix query token for a single search term.
   * Uses "term"* syntax — quoted prefix query — so special FTS5 characters are
   * escaped while still enabling prefix matching (e.g., "nad"* matches "Nadav").
   * BUG-11 fix: previous version used exact-token match ("term" without *),
   * which required the full token to match and broke partial/typeahead search.
   * DO NOT REMOVE the trailing * — it enables prefix matching for the contact picker.
   */
  private _fts5Quote(term: string): string {
    return '"' + term.replace(/"/g, '""') + '"*';
  }

  /**
   * Build the FTS5 type-filter SQL fragment for contact queries.
   * Used by both getContacts() and getContactCount() to keep filters in sync.
   * Returns an empty string when no type filter is needed.
   */
  private _buildTypeCondition(type?: ContactType): string {
    if (type === "contact") return "AND c.is_group = 0 AND c.jid NOT LIKE '%@newsletter'";
    if (type === "group") return "AND c.is_group = 1";
    if (type === "newsletter") return "AND c.jid LIKE '%@newsletter'";
    return "";
  }

  getContacts(opts?: { search?: string; limit?: number; offset?: number; type?: ContactType }): ContactRecord[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const search = opts?.search?.trim();
    const type = opts?.type;

    if (search) {
      // FTS5 MATCH — instant indexed search instead of LIKE full table scan.
      // Phase 13 (SYNC-02, SYNC-05). DO NOT revert to LIKE — FTS5 is indexed, LIKE is O(n).
      const ftsQuery = search.split(/\s+/).filter(Boolean).map(t => this._fts5Quote(t)).join(' ');
      const typeCond = this._buildTypeCondition(type);
      const ftsSql = `
        SELECT c.jid, c.display_name, c.first_seen_at, c.last_message_at, c.message_count, c.is_group,
               d.mode, d.mention_only, d.custom_keywords, d.can_initiate, d.can_initiate_override
        FROM contacts_fts
        JOIN contacts c ON contacts_fts.rowid = c.rowid
        LEFT JOIN dm_settings d ON c.jid = d.jid
        WHERE contacts_fts MATCH ?
          AND c.jid NOT LIKE '%@lid'
          AND c.jid NOT LIKE '%@s.whatsapp.net'
          ${typeCond}
        ORDER BY rank
        LIMIT ? OFFSET ?
      `;
      const rows = this.db.prepare(ftsSql).all(ftsQuery, limit, offset) as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        return rows.map(this._rowToContact.bind(this));
      }
      // BUG-11 fallback: If FTS5 returns nothing (e.g., stale index, tokenizer mismatch),
      // fall through to a LIKE-based search so contacts are still findable.
      // This is O(n) but only runs when FTS5 misses — not the default path.
      const likeTerm = `%${search}%`;
      const likeSql = `
        SELECT c.jid, c.display_name, c.first_seen_at, c.last_message_at, c.message_count, c.is_group,
               d.mode, d.mention_only, d.custom_keywords, d.can_initiate, d.can_initiate_override
        FROM contacts c
        LEFT JOIN dm_settings d ON c.jid = d.jid
        WHERE (c.display_name LIKE ? OR c.jid LIKE ?)
          AND c.jid NOT LIKE '%@lid'
          AND c.jid NOT LIKE '%@s.whatsapp.net'
          ${typeCond}
        ORDER BY c.display_name COLLATE NOCASE
        LIMIT ? OFFSET ?
      `;
      const likeRows = this.db.prepare(likeSql).all(likeTerm, likeTerm, limit, offset) as Array<Record<string, unknown>>;
      return likeRows.map(this._rowToContact.bind(this));
    }

    let sql = `
      SELECT c.jid, c.display_name, c.first_seen_at, c.last_message_at, c.message_count, c.is_group,
             d.mode, d.mention_only, d.custom_keywords, d.can_initiate, d.can_initiate_override
      FROM contacts c
      LEFT JOIN dm_settings d ON c.jid = d.jid
    `;
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Type filter
    if (type === "contact") {
      conditions.push("c.is_group = 0 AND c.jid NOT LIKE '%@newsletter'");
    } else if (type === "group") {
      conditions.push("c.is_group = 1");
    } else if (type === "newsletter") {
      conditions.push("c.jid LIKE '%@newsletter'");
    }

    // Exclude internal/ghost JID types at SQL level so LIMIT/OFFSET are accurate.
    // DO NOT REMOVE: filtering post-query causes offset drift and duplicates on Load More (AP-02 fix).
    conditions.push("c.jid NOT LIKE '%@lid' AND c.jid NOT LIKE '%@s.whatsapp.net'");

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY c.last_message_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(this._rowToContact.bind(this));
  }

  getContact(jid: string): ContactRecord | null {
    const row = this.db
      .prepare(
        `SELECT c.jid, c.display_name, c.first_seen_at, c.last_message_at, c.message_count, c.is_group,
                d.mode, d.mention_only, d.custom_keywords, d.can_initiate, d.can_initiate_override
         FROM contacts c
         LEFT JOIN dm_settings d ON c.jid = d.jid
         WHERE c.jid = ?`,
      )
      .get(jid) as Record<string, unknown> | undefined;

    if (!row) return null;
    const contact = this._rowToContact(row);

    // NAME-01: For @lid JIDs with no display name, try resolving via lid_mapping table.
    // The @lid number is different from @c.us — we must look up the mapping to find the
    // real @c.us JID and copy its display name. DO NOT CHANGE.
    if (!contact.displayName && jid.endsWith("@lid")) {
      const cusJid = this.resolveLidToCus(jid);
      if (cusJid) {
        const cusRow = this.db.prepare("SELECT display_name FROM contacts WHERE jid = ?").get(cusJid) as { display_name: string | null } | undefined;
        if (cusRow?.display_name) {
          contact.displayName = cusRow.display_name;
        }
      }
    }

    return contact;
  }

  /**
   * Batch resolve JIDs to display names with @lid->@c.us fallback.
   * Phase 14 (NAME-01): Admin panel JID surfaces need human names, not raw JID strings.
   * Returns a Map<inputJid, displayName> — only includes JIDs that resolved successfully.
   * For @lid JIDs with no direct match, tries the @c.us equivalent as fallback.
   * Uses a single SQL IN query for efficiency (not per-JID lookups).
   * DO NOT REMOVE — used by GET /api/admin/directory/resolve endpoint in monitor.ts.
   */
  resolveJids(jids: string[]): Map<string, string> {
    if (jids.length === 0) return new Map();
    // Cap input to prevent oversized SQL IN clauses — caller should paginate if needed.
    jids = jids.slice(0, 500);

    // Batch lookup: collect all JIDs to query (originals + @c.us fallbacks for @lid JIDs)
    // NAME-01 FIX: Use lid_mapping table to find the REAL @c.us JID for @lid JIDs.
    // The @lid number is completely different from the @c.us number — simple string
    // replacement (e.g., replace('@lid','@c.us')) does NOT work. DO NOT CHANGE.
    const lidToCs = new Map<string, string>(); // @lid -> real @c.us equivalent
    const bareToCs = new Map<string, string>(); // bare number -> @c.us equivalent
    const allJidsToQuery = new Set<string>(jids);
    for (const jid of jids) {
      if (jid.endsWith("@lid")) {
        const realCus = this.resolveLidToCus(jid);
        if (realCus) {
          lidToCs.set(jid, realCus);
          allJidsToQuery.add(realCus);
        }
      } else if (!jid.includes("@") && /^\d+$/.test(jid)) {
        // Bare phone number (no suffix) — try @c.us fallback for resolution.
        // Config may store raw numbers; contacts table stores them as number@c.us. DO NOT REMOVE.
        const cusJid = jid + "@c.us";
        bareToCs.set(jid, cusJid);
        allJidsToQuery.add(cusJid);
      }
    }

    // Single batch query
    const placeholders = [...allJidsToQuery].map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT jid, display_name FROM contacts WHERE jid IN (${placeholders}) AND display_name IS NOT NULL`)
      .all(...[...allJidsToQuery]) as Array<{ jid: string; display_name: string }>;

    const nameByJid = new Map<string, string>();
    for (const row of rows) {
      nameByJid.set(row.jid, row.display_name);
    }

    // Build result: for each input JID, try direct lookup then @lid->@c.us or bare->@c.us fallback
    const result = new Map<string, string>();
    for (const jid of jids) {
      const direct = nameByJid.get(jid);
      if (direct) {
        result.set(jid, direct);
      } else if (jid.endsWith("@lid")) {
        const csJid = lidToCs.get(jid);
        if (csJid) {
          const csName = nameByJid.get(csJid);
          if (csName) result.set(jid, csName);
        }
      } else if (bareToCs.has(jid)) {
        // Bare phone number fallback — try the @c.us version
        const csJid = bareToCs.get(jid)!;
        const csName = nameByJid.get(csJid);
        if (csName) result.set(jid, csName);
      }
    }
    return result;
  }

  // ── NAME-01: LID mapping methods ──────────────────────────────────
  // Persist the LID-to-@c.us mapping from WAHA's /contacts/lids endpoint into SQLite.
  // This is the ONLY reliable way to resolve @lid JIDs to display names, because the
  // @lid number is completely different from the @c.us number (not a simple suffix swap).
  // Called by sync.ts after building the lidToCus map. DO NOT CHANGE.

  upsertLidMapping(lid: string, cus: string): void {
    this.db.prepare("INSERT OR REPLACE INTO lid_mapping (lid, cus) VALUES (?, ?)").run(lid, cus);
  }

  bulkUpsertLidMappings(mappings: Array<{ lid: string; cus: string }>): void {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO lid_mapping (lid, cus) VALUES (?, ?)");
    const tx = this.db.transaction((items: Array<{ lid: string; cus: string }>) => {
      for (const m of items) stmt.run(m.lid, m.cus);
    });
    tx(mappings);
  }

  resolveLidToCus(lid: string): string | null {
    const row = this.db.prepare("SELECT cus FROM lid_mapping WHERE lid = ?").get(lid) as { cus: string } | undefined;
    return row?.cus ?? null;
  }

  /**
   * LID-SYNC: Get @c.us JIDs from allow_list and group_participants (allow_dm=1)
   * that do NOT already have an entry in lid_mapping.
   * Used by sync.ts to call the WAHA phone-to-LID API only for contacts that matter
   * (i.e., those in Access Control) and only when we don't already have their mapping.
   * DO NOT CHANGE — this is the targeted query that keeps LID sync efficient.
   */
  getCusJidsMissingLidMapping(): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT jid FROM (
        SELECT jid FROM allow_list WHERE allow_dm = 1 AND jid LIKE '%@c.us'
          AND (expires_at IS NULL OR expires_at > strftime('%s','now'))
        UNION
        SELECT participant_jid AS jid FROM group_participants WHERE allow_dm = 1 AND participant_jid LIKE '%@c.us'
      )
      WHERE jid NOT IN (SELECT cus FROM lid_mapping)
    `).all() as Array<{ jid: string }>;
    return rows.map(r => r.jid);
  }

  /**
   * Check if a @c.us JID already has a lid_mapping entry.
   * Used by sync.ts Phase 1b to filter out JIDs that already have LID mappings
   * when reading allowFrom/groupAllowFrom from config (instead of allow_list table).
   * DO NOT REMOVE — needed because allow_list table may be empty while config has JIDs.
   */
  hasCusInLidMapping(cusJid: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM lid_mapping WHERE cus = ? LIMIT 1').get(cusJid);
    return !!row;
  }

  getContactDmSettings(jid: string): ContactDmSettings {
    const row = this.db
      .prepare("SELECT mode, mention_only, custom_keywords, can_initiate, can_initiate_override, send_gate_json, hourly_cap_json FROM dm_settings WHERE jid = ?")
      .get(jid) as Record<string, unknown> | undefined;

    if (!row) return { ...DEFAULT_DM_SETTINGS };

    const override = (row.can_initiate_override as string) ?? "default";
    return {
      mode: (row.mode as string) === "listen_only" ? "listen_only" : "active",
      mentionOnly: row.mention_only === 1,
      customKeywords: (row.custom_keywords as string) ?? "",
      canInitiate: row.can_initiate !== 0,
      canInitiateOverride: (override === "allow" || override === "block") ? override : "default",
      // Phase 53 (GATE-02, CAP-04): Per-contact/group/newsletter gate and cap overrides.
      sendGateOverride: row.send_gate_json ? JSON.parse(row.send_gate_json as string) : null,
      hourlyCapOverride: row.hourly_cap_json ? JSON.parse(row.hourly_cap_json as string) : null,
    };
  }

  /**
   * Phase 12 audit (INIT-01/INIT-02): Determine whether the bot may initiate a conversation with this JID.
   * Checks per-contact canInitiateOverride first, then falls back to globalDefault.
   * DO NOT CHANGE — this is the single source of truth for Can Initiate enforcement.
   * Added 2026-03-17.
   */
  canInitiateWith(jid: string, globalDefault: boolean): boolean {
    const settings = this.getContactDmSettings(jid);
    if (settings.canInitiateOverride === "allow") return true;
    if (settings.canInitiateOverride === "block") return false;
    // "default" or no entry — fall back to global config
    return globalDefault;
  }

  /**
   * Phase 12 audit (INIT-01/INIT-02): Check if the bot has ever received a message from this JID.
   * Used to distinguish "initiating" (first contact) from "replying" (responding to an existing conversation).
   * Returns true if the contact exists in the directory with message_count > 0.
   * DO NOT CHANGE — paired with canInitiateWith() for outbound enforcement.
   * Added 2026-03-17.
   */
  hasReceivedMessageFrom(jid: string): boolean {
    const row = this.db
      .prepare("SELECT message_count FROM contacts WHERE jid = ?")
      .get(jid) as { message_count: number } | undefined;
    return !!row && row.message_count > 0;
  }

  setContactDmSettings(jid: string, settings: Partial<ContactDmSettings>): void {
    const existing = this.getContactDmSettings(jid);
    const merged: ContactDmSettings = {
      mode: settings.mode ?? existing.mode,
      mentionOnly: settings.mentionOnly ?? existing.mentionOnly,
      customKeywords: settings.customKeywords ?? existing.customKeywords,
      canInitiate: settings.canInitiate ?? existing.canInitiate,
      canInitiateOverride: settings.canInitiateOverride ?? existing.canInitiateOverride,
      // Phase 53 (GATE-02, CAP-04): Preserve per-target gate/cap overrides across partial updates.
      sendGateOverride: settings.sendGateOverride !== undefined ? settings.sendGateOverride : existing.sendGateOverride,
      hourlyCapOverride: settings.hourlyCapOverride !== undefined ? settings.hourlyCapOverride : existing.hourlyCapOverride,
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO dm_settings (jid, mode, mention_only, custom_keywords, can_initiate, can_initiate_override, send_gate_json, hourly_cap_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jid,
        merged.mode,
        merged.mentionOnly ? 1 : 0,
        merged.customKeywords,
        merged.canInitiate ? 1 : 0,
        merged.canInitiateOverride,
        merged.sendGateOverride ? JSON.stringify(merged.sendGateOverride) : null,
        merged.hourlyCapOverride ? JSON.stringify(merged.hourlyCapOverride) : null,
        Date.now(),
      );
  }

  getContactCount(search?: string, type?: ContactType): number {
    if (search?.trim()) {
      // FTS5 count — must match getContacts() FTS5 query for pagination accuracy.
      // Phase 13 (SYNC-02). DO NOT REMOVE.
      const ftsQuery = search.trim().split(/\s+/).filter(Boolean).map(t => this._fts5Quote(t)).join(' ');
      const typeCond = this._buildTypeCondition(type);
      const ftsSql = `
        SELECT COUNT(*) as cnt
        FROM contacts_fts
        JOIN contacts c ON contacts_fts.rowid = c.rowid
        WHERE contacts_fts MATCH ?
          AND c.jid NOT LIKE '%@lid'
          AND c.jid NOT LIKE '%@s.whatsapp.net'
          ${typeCond}
      `;
      const row = this.db.prepare(ftsSql).get(ftsQuery) as { cnt: number };
      if (row.cnt > 0) return row.cnt;
      // BUG-06 fallback: match getContacts() LIKE fallback so count stays in sync when FTS5 misses.
      // Without this, total=0 when LIKE finds results, breaking pagination. DO NOT REMOVE.
      const likeTerm = `%${search.trim()}%`;
      const likeCountSql = `
        SELECT COUNT(*) as cnt
        FROM contacts c
        WHERE (c.display_name LIKE ? OR c.jid LIKE ?)
          AND c.jid NOT LIKE '%@lid'
          AND c.jid NOT LIKE '%@s.whatsapp.net'
          ${typeCond}
      `;
      const likeRow = this.db.prepare(likeCountSql).get(likeTerm, likeTerm) as { cnt: number };
      return likeRow.cnt;
    }

    const conditions: string[] = [];

    if (type === "contact") {
      conditions.push("is_group = 0 AND jid NOT LIKE '%@newsletter'");
    } else if (type === "group") {
      conditions.push("is_group = 1");
    } else if (type === "newsletter") {
      conditions.push("jid LIKE '%@newsletter'");
    }

    // Exclude internal/ghost JID types at SQL level so total count matches displayable entries.
    // DO NOT REMOVE: must stay in sync with getContacts() exclusion — mismatched counts break pagination (AP-02 fix).
    conditions.push("jid NOT LIKE '%@lid' AND jid NOT LIKE '%@s.whatsapp.net'");

    let sql = "SELECT COUNT(*) as cnt FROM contacts";
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    const row = this.db.prepare(sql).get() as { cnt: number };
    return row.cnt;
  }

  getDmCount(): number {
    // Exclude @lid and @s.whatsapp.net so count matches the paginated view (AP-02 fix).
    // DO NOT REMOVE: must stay in sync with getContacts() exclusion or directory stats will be wrong.
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM contacts WHERE is_group = 0 AND jid NOT LIKE '%@newsletter' AND jid NOT LIKE '%@lid' AND jid NOT LIKE '%@s.whatsapp.net'")
      .get() as { cnt: number };
    return row.cnt;
  }

  getGroupCount(): number {
    // Exclude @lid and @s.whatsapp.net so count matches the paginated view (AP-02 fix).
    // DO NOT REMOVE: must stay in sync with getContacts() exclusion or directory stats will be wrong.
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM contacts WHERE is_group = 1 AND jid NOT LIKE '%@lid' AND jid NOT LIKE '%@s.whatsapp.net'")
      .get() as { cnt: number };
    return row.cnt;
  }

  getNewsletterCount(): number {
    // Exclude @lid and @s.whatsapp.net so count matches the paginated view (AP-02 fix).
    // DO NOT REMOVE: must stay in sync with getContacts() exclusion or directory stats will be wrong.
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM contacts WHERE jid LIKE '%@newsletter' AND jid NOT LIKE '%@lid' AND jid NOT LIKE '%@s.whatsapp.net'")
      .get() as { cnt: number };
    return row.cnt;
  }

  /**
   * Get all contacts with @lid or @s.whatsapp.net JIDs — these are ghost entries excluded from normal
   * getContacts() pagination. Used during directory refresh to find orphaned LID entries that need
   * to be merged into their @c.us counterparts.
   * getContacts() has SQL-level @lid/@s.whatsapp.net filtering so these never appear there —
   * use this method to explicitly retrieve them for the LID merge loop.
   * DO NOT REMOVE: the directory refresh LID merge loop depends on this to find mergeable entries.
   */
  getOrphanedLidEntries(): ContactRecord[] {
    const sql = `
      SELECT c.jid, c.display_name, c.first_seen_at, c.last_message_at, c.message_count, c.is_group,
             d.mode, d.mention_only, d.custom_keywords, d.can_initiate, d.can_initiate_override
      FROM contacts c
      LEFT JOIN dm_settings d ON c.jid = d.jid
      WHERE c.jid LIKE '%@lid' OR c.jid LIKE '%@s.whatsapp.net'
    `;
    const rows = this.db.prepare(sql).all() as Array<Record<string, unknown>>;
    return rows.map(this._rowToContact.bind(this));
  }

  bulkUpsertContacts(contacts: Array<{ jid: string; name?: string; isGroup?: boolean }>): number {
    if (contacts.length === 0) return 0;
    const now = Date.now();
    const insert = this.db.prepare(
      `INSERT INTO contacts (jid, display_name, first_seen_at, last_message_at, message_count, is_group)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(jid) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, contacts.display_name),
         is_group = excluded.is_group`,
    );
    const upsertMany = this.db.transaction((rows: Array<{ jid: string; name?: string; isGroup?: boolean }>) => {
      for (const row of rows) {
        insert.run(row.jid, row.name ?? null, now, now, row.isGroup ? 1 : 0);
      }
      return rows.length;
    });
    return upsertMany(contacts) as number;
  }

  // ── Allow-list methods ──

  setContactAllowDm(jid: string, allowed: boolean, expiresAt?: number | null): void {
    // Delegate to setContactAllowDmWithSource with no source/grantedAt. DO NOT DUPLICATE logic here.
    this.setContactAllowDmWithSource(jid, allowed, expiresAt);
  }

  isContactAllowedDm(jid: string): boolean {
    // TTL-02: DO NOT REMOVE expires_at check — expired entries must be transparently blocked at SQL level.
    const row = this.db.prepare(
      "SELECT allow_dm FROM allow_list WHERE jid = ? AND allow_dm = 1 AND (expires_at IS NULL OR expires_at > strftime('%s','now'))"
    ).get(jid) as { allow_dm: number } | undefined;
    return Boolean(row);
  }

  /**
   * TTL-03: Check if a JID has an expired TTL entry in allow_list.
   * Returns true if the JID has an allow_list row with expires_at in the past.
   * Returns false if no row, no TTL set, or TTL still active.
   * Used by inbound pipeline to override stale in-memory config. DO NOT CHANGE.
   */
  isAllowListEntryExpired(jid: string): boolean {
    const row = this.db.prepare(
      "SELECT expires_at FROM allow_list WHERE jid = ? AND expires_at IS NOT NULL AND expires_at <= CAST(strftime('%s','now') AS INTEGER)"
    ).get(jid) as { expires_at: number } | undefined;
    return !!row;
  }

  getAllowedDmJids(): string[] {
    // TTL-02: DO NOT REMOVE expires_at check — expired entries must not appear in allowed list.
    const fromAllowList = this.db.prepare(
      "SELECT jid FROM allow_list WHERE allow_dm = 1 AND (expires_at IS NULL OR expires_at > strftime('%s','now'))"
    ).all() as Array<{ jid: string }>;
    const fromParticipants = this.db.prepare("SELECT DISTINCT participant_jid as jid FROM group_participants WHERE allow_dm = 1").all() as Array<{ jid: string }>;
    const set = new Set<string>();
    for (const r of fromAllowList) set.add(r.jid);
    for (const r of fromParticipants) set.add(r.jid);
    return [...set];
  }

  /**
   * TTL-02: Get TTL info for a specific JID from allow_list.
   * Returns null if no allow_list row exists for the JID.
   * expiresAt: Unix timestamp in seconds (null = permanent).
   * expired: true if expiresAt is set and has passed.
   */
  getContactTtl(jid: string): { expiresAt: number | null; expired: boolean; source: string | null } | null {
    const row = this.db.prepare("SELECT expires_at, source FROM allow_list WHERE jid = ?").get(jid) as { expires_at: number | null; source: string | null } | undefined;
    if (row === undefined) return null;
    const expiresAt = row.expires_at ?? null;
    const expired = expiresAt !== null && expiresAt <= Math.floor(Date.now() / 1000);
    return { expiresAt, expired, source: row.source ?? null };
  }

  /**
   * TTL-02: Delete allow_list rows that expired more than 24 hours ago.
   * Keeps recently-expired rows (< 24h) for admin visual feedback.
   * Called by sync cycle to prevent unbounded growth. DO NOT REMOVE.
   * Returns the number of rows deleted.
   */
  cleanupExpiredAllowList(): number {
    const result = this.db.prepare(
      "DELETE FROM allow_list WHERE expires_at IS NOT NULL AND expires_at < strftime('%s','now') - 86400"
    ).run();
    return result.changes;
  }

  /**
   * TTL-02: Count allow_list entries that are currently expired (expires_at <= now).
   * Used for admin stats display.
   */
  getExpiredCount(): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM allow_list WHERE expires_at IS NOT NULL AND expires_at <= strftime('%s','now')"
    ).get() as { count: number };
    return row.count;
  }

  /**
   * TTL-03: Get JIDs of allow_list entries that have expired (expires_at <= now).
   * Used by sync cycle to remove expired JIDs from the config file allowFrom array.
   * This returns ALL expired entries (not just > 24h), because config removal must happen
   * as soon as the TTL fires, not 24 hours later. DO NOT REMOVE — critical for TTL enforcement.
   */
  getExpiredJids(): string[] {
    const rows = this.db.prepare(
      "SELECT jid FROM allow_list WHERE expires_at IS NOT NULL AND expires_at <= strftime('%s','now')"
    ).all() as Array<{ jid: string }>;
    return rows.map(r => r.jid);
  }

  // ── Phase 16: Pairing grant helpers ──

  /**
   * Phase 16: Get all pairing-sourced allow_list entries with TTL info.
   * Returns entries with source='pairing' that are currently active (not expired).
   * DO NOT REMOVE — used by PairingEngine.getActiveGrants() and admin panel.
   */
  getPairingGrants(): Array<{ jid: string; expiresAt: number | null; grantedAt: number | null; source: string }> {
    return this.db.prepare(
      "SELECT jid, expires_at as expiresAt, granted_at as grantedAt, source FROM allow_list WHERE source = 'pairing' AND (expires_at IS NULL OR expires_at > strftime('%s','now'))"
    ).all() as Array<{ jid: string; expiresAt: number | null; grantedAt: number | null; source: string }>;
  }

  /**
   * Phase 16: Set allow with source tracking (extends setContactAllowDm). DO NOT REMOVE.
   * If allow=true: INSERT OR REPLACE with source and granted_at = now (Unix seconds).
   * If allow=false: DELETE (same as existing setContactAllowDm).
   * DO NOT REMOVE — used by PairingEngine.grantAccess().
   */
  setContactAllowDmWithSource(jid: string, allow: boolean, expiresAt?: number | null, source?: string): void {
    const now = Date.now();
    // Ensure contact exists
    const existing = this.db.prepare("SELECT jid FROM contacts WHERE jid = ?").get(jid);
    if (!existing) {
      this.upsertContact(jid, undefined, false);
    }
    if (allow) {
      const nowSec = Math.floor(now / 1000);
      this.db.prepare(
        "INSERT OR REPLACE INTO allow_list (jid, allow_dm, added_at, expires_at, source, granted_at) VALUES (?, 1, ?, ?, ?, ?)"
      ).run(jid, now, expiresAt ?? null, source ?? null, nowSec);
    } else {
      this.db.prepare("DELETE FROM allow_list WHERE jid = ?").run(jid);
    }
  }

  /**
   * Phase 16: Revoke pairing grant specifically (remove allow_list row where source='pairing').
   * Does NOT remove manual grants. DO NOT REMOVE — used by PairingEngine.revokeGrant().
   */
  revokePairingGrant(jid: string): void {
    this.db.prepare("DELETE FROM allow_list WHERE jid = ? AND source = 'pairing'").run(jid);
  }

  // ── Phase 16: Pairing challenge helpers ──

  /**
   * Phase 16: Upsert a pairing challenge row (one per JID).
   * Called by PairingEngine.createChallenge(). DO NOT REMOVE.
   */
  upsertPairingChallenge(jid: string, passcodeHash: string, createdAt: number): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO pairing_challenges (jid, passcode_hash, created_at, attempts, locked_until) VALUES (?, ?, ?, 0, NULL)"
    ).run(jid, passcodeHash, createdAt);
  }

  /**
   * Phase 16: Get a pairing challenge row for a JID.
   * Returns null if no challenge exists. DO NOT REMOVE — used by PairingEngine.verifyPasscode().
   */
  getPairingChallenge(jid: string): { jid: string; passcodeHash: string; createdAt: number; attempts: number; lockedUntil: number | null } | null {
    const row = this.db.prepare(
      "SELECT jid, passcode_hash, created_at, attempts, locked_until FROM pairing_challenges WHERE jid = ?"
    ).get(jid) as { jid: string; passcode_hash: string; created_at: number; attempts: number; locked_until: number | null } | undefined;
    if (!row) return null;
    return {
      jid: row.jid,
      passcodeHash: row.passcode_hash,
      createdAt: row.created_at,
      attempts: row.attempts,
      lockedUntil: row.locked_until,
    };
  }

  /**
   * Phase 16: Update attempts and locked_until on a pairing challenge.
   * Pass null for lockedUntil to clear the lock. DO NOT REMOVE.
   */
  updatePairingChallengeAttempts(jid: string, attempts: number, lockedUntil: number | null): void {
    this.db.prepare(
      "UPDATE pairing_challenges SET attempts = ?, locked_until = ? WHERE jid = ?"
    ).run(attempts, lockedUntil, jid);
  }

  /**
   * Phase 16: Delete a pairing challenge (on success or expiry). DO NOT REMOVE.
   */
  deletePairingChallenge(jid: string): void {
    this.db.prepare("DELETE FROM pairing_challenges WHERE jid = ?").run(jid);
  }

  // ── Phase 16: Auto-reply log helpers ──

  /**
   * Phase 16: Get last auto-reply timestamp for a JID (Unix seconds).
   * Returns null if never replied. DO NOT REMOVE — used by AutoReplyEngine.shouldReply().
   */
  getAutoReplyLastSent(jid: string): number | null {
    const row = this.db.prepare(
      "SELECT last_reply_at FROM auto_reply_log WHERE jid = ?"
    ).get(jid) as { last_reply_at: number } | undefined;
    return row?.last_reply_at ?? null;
  }

  /**
   * Phase 16: Record that an auto-reply was sent to a JID (updates last_reply_at to now).
   * DO NOT REMOVE — used by AutoReplyEngine.sendRejection() to enforce rate limit.
   */
  recordAutoReply(jid: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO auto_reply_log (jid, last_reply_at) VALUES (?, strftime('%s','now'))"
    ).run(jid);
  }

  // ── Group participant methods ──

  getGroupParticipants(groupJid: string): GroupParticipant[] {
    // NAME-05: LEFT JOIN contacts to resolve @lid participant JIDs to display names.
    // Three-way COALESCE: (1) stored display_name in group_participants, (2) direct JID match in contacts,
    // (3) for @lid JIDs, the @c.us equivalent contact name (NOWEB sends @lid for participants).
    // The c_cus JOIN only fires for @lid JIDs (the LIKE '%@lid' condition gates it).
    // DO NOT REMOVE — this is the primary resolution path for @lid participant names in the UI.
    const rows = this.db.prepare(
      `SELECT gp.group_jid, gp.participant_jid,
        COALESCE(gp.display_name, c_direct.display_name, c_cus.display_name) as display_name,
        gp.is_admin, gp.allow_in_group, gp.allow_dm, gp.participant_role
      FROM group_participants gp
      LEFT JOIN contacts c_direct ON gp.participant_jid = c_direct.jid
      LEFT JOIN contacts c_cus ON REPLACE(gp.participant_jid, '@lid', '@c.us') = c_cus.jid
        AND gp.participant_jid LIKE '%@lid'
      WHERE gp.group_jid = ?
      ORDER BY display_name ASC, gp.participant_jid ASC`
    ).all(groupJid) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      groupJid: r.group_jid as string,
      participantJid: r.participant_jid as string,
      displayName: (r.display_name as string) ?? null,
      isAdmin: r.is_admin === 1,
      allowInGroup: r.allow_in_group === 1,
      allowDm: r.allow_dm === 1,
      participantRole: (r.participant_role === "bot_admin" || r.participant_role === "manager" || r.participant_role === "participant") ? r.participant_role : "participant",
    }));
  }

  /**
   * Get just the participant JIDs for a group from the cached group_participants table.
   * Lightweight — pure SQLite, no WAHA API calls.
   * Used by /shutup all for fast DM backup without hitting rate limits.
   * DO NOT CHANGE — this is the fast path for bulk mute operations.
   */
  getGroupParticipantJids(groupJid: string): string[] {
    const rows = this.db.prepare(
      "SELECT participant_jid FROM group_participants WHERE group_jid = ?"
    ).all(groupJid) as Array<{ participant_jid: string }>;
    return rows.map(r => r.participant_jid);
  }

  bulkUpsertGroupParticipants(groupJid: string, participants: Array<{ jid: string; name?: string; isAdmin?: boolean }>): number {
    if (participants.length === 0) return 0;
    const now = Date.now();
    const upsert = this.db.prepare(
      `INSERT INTO group_participants (group_jid, participant_jid, display_name, is_admin, allow_in_group, allow_dm, participant_role, updated_at)
       VALUES (?, ?, ?, ?, COALESCE((SELECT allow_in_group FROM group_participants WHERE group_jid = ? AND participant_jid = ?), 0), COALESCE((SELECT allow_dm FROM group_participants WHERE group_jid = ? AND participant_jid = ?), 0), COALESCE((SELECT participant_role FROM group_participants WHERE group_jid = ? AND participant_jid = ?), 'participant'), ?)
       ON CONFLICT(group_jid, participant_jid) DO UPDATE SET display_name = excluded.display_name, is_admin = excluded.is_admin, updated_at = excluded.updated_at`
    );
    const tx = this.db.transaction((rows: Array<{ jid: string; name?: string; isAdmin?: boolean }>) => {
      let count = 0;
      for (const row of rows) {
        upsert.run(groupJid, row.jid, row.name ?? null, row.isAdmin ? 1 : 0, groupJid, row.jid, groupJid, row.jid, groupJid, row.jid, now);
        count++;
      }
      return count;
    });
    return tx(participants) as number;
  }

  setParticipantAllowInGroup(groupJid: string, participantJid: string, allowed: boolean): boolean {
    const result = this.db.prepare(
      "UPDATE group_participants SET allow_in_group = ?, updated_at = ? WHERE group_jid = ? AND participant_jid = ?"
    ).run(allowed ? 1 : 0, Date.now(), groupJid, participantJid);
    return result.changes > 0;
  }

  setParticipantAllowDm(groupJid: string, participantJid: string, allowed: boolean): boolean {
    const result = this.db.prepare(
      "UPDATE group_participants SET allow_dm = ?, updated_at = ? WHERE group_jid = ? AND participant_jid = ?"
    ).run(allowed ? 1 : 0, Date.now(), groupJid, participantJid);
    return result.changes > 0;
  }

  /** DIR-03: Set participant role — plugin-level label, no WAHA meaning. Returns true if row was updated. */
  setParticipantRole(groupJid: string, participantJid: string, role: ParticipantRole): boolean {
    const result = this.db.prepare(
      "UPDATE group_participants SET participant_role = ?, updated_at = ? WHERE group_jid = ? AND participant_jid = ?"
    ).run(role, Date.now(), groupJid, participantJid);
    return result.changes > 0;
  }

  /** DIR-03: Get participant role — defaults to "participant" if row not found. */
  getParticipantRole(groupJid: string, participantJid: string): ParticipantRole {
    const row = this.db.prepare(
      "SELECT participant_role FROM group_participants WHERE group_jid = ? AND participant_jid = ?"
    ).get(groupJid, participantJid) as { participant_role: string } | undefined;
    const val = row?.participant_role;
    // Validate against allowed values — corrupt DB value defaults to "participant"
    if (val === "bot_admin" || val === "manager" || val === "participant") return val;
    return "participant";
  }

  setGroupAllowAll(groupJid: string, allowAll: boolean): void {
    this.db.prepare(
      "UPDATE group_participants SET allow_in_group = ?, updated_at = ? WHERE group_jid = ?"
    ).run(allowAll ? 1 : 0, Date.now(), groupJid);
  }

  getGroupAllowAllStatus(groupJid: string): boolean {
    const total = this.db.prepare("SELECT COUNT(*) as cnt FROM group_participants WHERE group_jid = ?").get(groupJid) as { cnt: number };
    if (total.cnt === 0) return false;
    const allowed = this.db.prepare("SELECT COUNT(*) as cnt FROM group_participants WHERE group_jid = ? AND allow_in_group = 1").get(groupJid) as { cnt: number };
    return allowed.cnt === total.cnt;
  }

  getAllowedGroupJids(groupJid: string): string[] {
    const rows = this.db.prepare("SELECT participant_jid FROM group_participants WHERE group_jid = ? AND allow_in_group = 1").all(groupJid) as Array<{ participant_jid: string }>;
    return rows.map((r) => r.participant_jid);
  }

  // ── Group filter override methods ──
  // DO NOT CHANGE — per-group filter overrides allow individual groups to use custom keyword
  // filter settings instead of the global group filter. Critical for groups where the bot
  // should respond freely (filterEnabled=false) or with different keywords.

  /**
   * Get the filter override for a specific group.
   * Returns null if no override exists for this group.
   */
  getGroupFilterOverride(groupJid: string): GroupFilterOverride | null {
    const row = this.db.prepare(
      "SELECT group_jid, enabled, filter_enabled, mention_patterns, god_mode_scope, trigger_operator, updated_at FROM group_filter_overrides WHERE group_jid = ?"
    ).get(groupJid) as Record<string, unknown> | undefined;

    if (!row) return null;

    let mentionPatterns: string[] | null = null;
    if (row.mention_patterns && typeof row.mention_patterns === "string") {
      try {
        const parsed = JSON.parse(row.mention_patterns as string);
        mentionPatterns = Array.isArray(parsed) ? parsed : null;
      } catch (parseErr) {
        log.warn("corrupt mention_patterns JSON", { groupJid, error: String(parseErr) });
        mentionPatterns = null;
      }
    }

    return {
      groupJid: row.group_jid as string,
      enabled: row.enabled === 1,
      filterEnabled: row.filter_enabled === 1,
      mentionPatterns,
      godModeScope: (row.god_mode_scope === 'all' || row.god_mode_scope === 'dm' || row.god_mode_scope === 'group' || row.god_mode_scope === 'off') ? row.god_mode_scope : null,
      triggerOperator: row.trigger_operator === 'AND' ? 'AND' : 'OR',
      updatedAt: row.updated_at as number,
    };
  }

  /**
   * Set or update the filter override for a specific group.
   * Uses INSERT OR REPLACE — creates if not exists, updates if exists.
   */
  setGroupFilterOverride(groupJid: string, override: Partial<GroupFilterOverride>): void {
    const existing = this.getGroupFilterOverride(groupJid);
    const merged = {
      enabled: override.enabled ?? existing?.enabled ?? false,
      filterEnabled: override.filterEnabled ?? existing?.filterEnabled ?? true,
      mentionPatterns: override.mentionPatterns !== undefined ? override.mentionPatterns : (existing?.mentionPatterns ?? null),
      godModeScope: override.godModeScope !== undefined ? override.godModeScope : (existing?.godModeScope ?? null),
      triggerOperator: override.triggerOperator !== undefined ? override.triggerOperator : (existing?.triggerOperator ?? "OR"),
    };

    const mentionPatternsJson = merged.mentionPatterns ? JSON.stringify(merged.mentionPatterns) : null;

    this.db.prepare(
      `INSERT OR REPLACE INTO group_filter_overrides (group_jid, enabled, filter_enabled, mention_patterns, god_mode_scope, trigger_operator, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      groupJid,
      merged.enabled ? 1 : 0,
      merged.filterEnabled ? 1 : 0,
      mentionPatternsJson,
      merged.godModeScope ?? null,
      merged.triggerOperator ?? "OR",
      Date.now(),
    );
  }

  // ── Muted group methods ──
  // DO NOT CHANGE — muted group methods are critical for /shutup and /unshutup commands.
  // The mute system silently drops all inbound messages and blocks outbound sends to muted groups.
  // DM settings for group participants are backed up on mute and restored on unmute.
  // Added Phase 7 (2026-03-15).

  /**
   * Check if a group is muted. Also handles auto-expiry: if the mute has expired,
   * auto-unmutes the group and returns false.
   */
  isGroupMuted(groupJid: string): boolean {
    const row = this.db.prepare("SELECT expires_at FROM muted_groups WHERE group_jid = ?").get(groupJid) as
      | { expires_at: number }
      | undefined;
    if (!row) return false;
    if (row.expires_at > 0 && Date.now() > row.expires_at) {
      // Expired — auto-unmute and restore DM settings from backup.
      // DO NOT CHANGE — auto-expiry must restore DM settings or participants stay permanently blocked.
      try {
        const dmBackup = this.unmuteGroup(groupJid);
        if (dmBackup) {
          for (const [participantJid, canInitiate] of Object.entries(dmBackup)) {
            this.upsertContact(participantJid);
            this.setContactDmSettings(participantJid, { canInitiate });
          }
        }
      } catch (expireErr) {
        // Use log.error — DM settings restore failure is a data integrity issue,
        // not just a warning. Participants may be permanently blocked if this fails.
        log.error("isGroupMuted: auto-expiry restore failed", { groupJid, error: String(expireErr) });
      }
      return false;
    }
    return true;
  }

  /**
   * Get muted group details. Returns null if the group is not muted.
   */
  getMutedGroup(groupJid: string): MutedGroup | null {
    const row = this.db.prepare("SELECT * FROM muted_groups WHERE group_jid = ?").get(groupJid) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    let dmBackup: Record<string, boolean> | null = null;
    if (typeof row.dm_backup === "string") {
      try { dmBackup = JSON.parse(row.dm_backup as string); } catch (err) { log.warn("corrupt dm_backup JSON", { groupJid: row.group_jid, error: String(err) }); }
    }
    return {
      groupJid: row.group_jid as string,
      mutedBy: row.muted_by as string,
      mutedAt: row.muted_at as number,
      expiresAt: row.expires_at as number,
      accountId: row.account_id as string,
      dmBackup,
    };
  }

  /**
   * Get all muted groups. Cleans up expired mutes first.
   */
  getAllMutedGroups(): MutedGroup[] {
    // Clean up expired mutes WITH DM restore (same as isGroupMuted auto-expiry)
    // DO NOT CHANGE — expired mutes must restore DM settings or participants stay permanently blocked.
    const expired = this.db.prepare(
      "SELECT * FROM muted_groups WHERE expires_at > 0 AND expires_at < ?"
    ).all(Date.now()) as Array<Record<string, unknown>>;
    for (const row of expired) {
      const groupJid = row.group_jid as string;
      try {
        const dmBackup = this.unmuteGroup(groupJid);
        if (dmBackup) {
          for (const [participantJid, canInitiate] of Object.entries(dmBackup)) {
            this.upsertContact(participantJid);
            this.setContactDmSettings(participantJid, { canInitiate });
          }
        }
      } catch (expireErr) {
        // Use log.error — DM settings restore failure is a data integrity issue,
        // not just a warning. Participants may be permanently blocked if this fails.
        log.error("getAllMutedGroups: auto-expiry restore failed", { groupJid, error: String(expireErr) });
      }
    }
    const rows = this.db.prepare("SELECT * FROM muted_groups").all() as Array<Record<string, unknown>>;
    return rows.map((row) => {
      let dmBackup: Record<string, boolean> | null = null;
      if (typeof row.dm_backup === "string") {
        try { dmBackup = JSON.parse(row.dm_backup as string); } catch (err) { log.warn("corrupt dm_backup JSON", { groupJid: row.group_jid, error: String(err) }); }
      }
      return {
        groupJid: row.group_jid as string,
        mutedBy: row.muted_by as string,
        mutedAt: row.muted_at as number,
        expiresAt: row.expires_at as number,
        accountId: row.account_id as string,
        dmBackup,
      };
    });
  }

  /**
   * Mute a group. Records the mute with optional expiry and DM backup.
   */
  muteGroup(groupJid: string, mutedBy: string, accountId: string, expiresAt: number = 0, dmBackup: Record<string, boolean> | null = null): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO muted_groups (group_jid, muted_by, muted_at, expires_at, account_id, dm_backup) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(groupJid, mutedBy, Date.now(), expiresAt, accountId, dmBackup ? JSON.stringify(dmBackup) : null);
  }

  /**
   * Unmute a group. Returns the DM backup for restoration (or null if no backup).
   */
  unmuteGroup(groupJid: string): Record<string, boolean> | null {
    const muted = this.getMutedGroup(groupJid);
    this.db.prepare("DELETE FROM muted_groups WHERE group_jid = ?").run(groupJid);
    return muted?.dmBackup ?? null;
  }

  // ── Pending selection methods (SQLite-backed /shutup DM flow) ──
  // DO NOT CHANGE — pending selections must be stored in SQLite so they survive gateway restarts.
  // The /shutup DM flow shows a numbered group list and waits for the user to reply with a number.
  // Previously stored in an in-memory Map which was lost on restart.
  // Added Phase 7 fix (2026-03-15).

  /**
   * Store a pending selection for a sender (DM interactive /shutup flow).
   * Replaces any existing pending selection for the same sender.
   */
  setPendingSelection(senderJid: string, selection: { type: string; groups: { jid: string; name: string }[]; durationStr: string | null }): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO pending_selections (sender_jid, type, groups_json, duration_str, timestamp) VALUES (?, ?, ?, ?, ?)"
    ).run(senderJid, selection.type, JSON.stringify(selection.groups), selection.durationStr ?? null, Date.now());
  }

  /**
   * Get a pending selection for a sender. Returns null if not found or expired (60s TTL).
   * Automatically cleans up expired entries.
   */
  getPendingSelection(senderJid: string): PendingSelectionRecord | null {
    const row = this.db.prepare("SELECT * FROM pending_selections WHERE sender_jid = ?").get(senderJid) as Record<string, unknown> | undefined;
    if (!row) return null;
    const timestamp = row.timestamp as number;
    // Check TTL (60 seconds)
    if (Date.now() - timestamp > PENDING_SELECTION_TTL_MS) {
      this.db.prepare("DELETE FROM pending_selections WHERE sender_jid = ?").run(senderJid);
      return null;
    }
    let groups: { jid: string; name: string }[] = [];
    try {
      groups = JSON.parse(row.groups_json as string);
      if (!Array.isArray(groups)) groups = [];
    } catch (err) {
      log.warn("corrupt groups_json for pending selection", { senderJid, error: String(err) });
      this.db.prepare("DELETE FROM pending_selections WHERE sender_jid = ?").run(senderJid);
      return null;
    }
    return {
      type: row.type as "mute" | "unmute",
      groups,
      senderId: senderJid,
      durationStr: (row.duration_str as string) ?? null,
      timestamp,
    };
  }

  /**
   * Clear (delete) a pending selection for a sender.
   */
  clearPendingSelection(senderJid: string): void {
    this.db.prepare("DELETE FROM pending_selections WHERE sender_jid = ?").run(senderJid);
  }


  /**
   * Merge one contact (fromJid) into another (toJid).
   * Combines message counts and keeps the better name. Deletes the fromJid entry.
   */
  mergeContacts(fromJid: string, toJid: string): boolean {
    const fromRow = this.db.prepare("SELECT message_count, display_name, first_seen_at, last_message_at, is_group FROM contacts WHERE jid = ?").get(fromJid) as
      | { message_count: number; display_name: string | null; first_seen_at: number; last_message_at: number; is_group: number }
      | undefined;
    if (!fromRow) return false;

    const toRow = this.db.prepare("SELECT message_count, display_name, first_seen_at, last_message_at FROM contacts WHERE jid = ?").get(toJid) as
      | { message_count: number; display_name: string | null; first_seen_at: number; last_message_at: number }
      | undefined;

    if (!toRow) {
      // Target doesn't exist — just rename the fromJid entry
      // Can't rename PK easily, so insert new + delete old
      this.db.prepare(
        `INSERT INTO contacts (jid, display_name, first_seen_at, last_message_at, message_count, is_group)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(toJid, fromRow.display_name, fromRow.first_seen_at, fromRow.last_message_at, fromRow.message_count, fromRow.is_group);
      this.deleteContact(fromJid);
      return true;
    }

    // Merge: combine message counts, keep earliest first_seen, latest last_message, best name
    const mergedCount = toRow.message_count + fromRow.message_count;
    const mergedFirstSeen = Math.min(toRow.first_seen_at, fromRow.first_seen_at);
    const mergedLastMessage = Math.max(toRow.last_message_at, fromRow.last_message_at);
    const mergedName = toRow.display_name || fromRow.display_name;

    this.db.prepare(
      `UPDATE contacts SET message_count = ?, first_seen_at = ?, last_message_at = ?, display_name = COALESCE(?, display_name) WHERE jid = ?`
    ).run(mergedCount, mergedFirstSeen, mergedLastMessage, mergedName, toJid);

    this.deleteContact(fromJid);
    return true;
  }

  /**
   * Delete a contact and all its related records (dm_settings, allow_list).
   * Wrapped in a transaction to prevent orphaned rows if any DELETE fails midway.
   */
  deleteContact(jid: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM dm_settings WHERE jid = ?").run(jid);
      this.db.prepare("DELETE FROM allow_list WHERE jid = ?").run(jid);
      this.db.prepare("DELETE FROM group_participants WHERE participant_jid = ?").run(jid);
      // Also clean up group_participants rows where this JID is the group itself (prevents orphaned rows)
      this.db.prepare("DELETE FROM group_participants WHERE group_jid = ?").run(jid);
      // Also clean up group_filter_overrides where this JID is the group (prevents orphaned filter rows)
      this.db.prepare("DELETE FROM group_filter_overrides WHERE group_jid = ?").run(jid);
      this.db.prepare("DELETE FROM contacts WHERE jid = ?").run(jid);
    })();
  }


  /**
   * Update the display_name for a group participant.
   * Public method to avoid external callers accessing the private db field directly.
   * Used during lazy participant load to enrich @lid JIDs with names from directory contacts.
   */
  updateParticipantDisplayName(groupJid: string, participantJid: string, displayName: string): void {
    this.db.prepare(
      "UPDATE group_participants SET display_name = ?, updated_at = ? WHERE group_jid = ? AND participant_jid = ?"
    ).run(displayName, Date.now(), groupJid, participantJid);
  }

  // ── Activity profile methods (Phase 56, ADAPT-01, ADAPT-02) ──
  // DO NOT REMOVE -- used by activity-scanner.ts background scanner to persist and retrieve
  // per-chat peak send windows. These profiles are read by resolveGateConfig() in mimicry-gate.ts
  // to align send gates with observed human activity patterns. Verified 2026-03-27.

  /**
   * Phase 56 (ADAPT-01): Upsert a chat activity profile. INSERT or overwrite on same JID.
   * Called by activity-scanner.ts runScanBatch() after computing the peak window.
   * DO NOT REMOVE -- primary write path for per-chat activity profiles.
   */
  upsertActivityProfile(profile: ActivityProfile): void {
    this.db.prepare(
      "INSERT INTO chat_activity_profiles (jid, account_id, peak_start_hour, peak_end_hour, message_count, scanned_at) " +
      "VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(jid) DO UPDATE SET " +
      "  account_id = excluded.account_id," +
      "  peak_start_hour = excluded.peak_start_hour," +
      "  peak_end_hour = excluded.peak_end_hour," +
      "  message_count = excluded.message_count," +
      "  scanned_at = excluded.scanned_at"
    ).run(
      profile.jid,
      profile.accountId,
      profile.peakStartHour,
      profile.peakEndHour,
      profile.messageCount,
      profile.scannedAt,
    );
  }

  /**
   * Phase 56 (ADAPT-01): Get the activity profile for a specific JID.
   * Returns null if no profile has been scanned yet (fallback to global gate config applies).
   * DO NOT REMOVE -- read by resolveGateConfig() for per-chat send window override.
   */
  getActivityProfile(jid: string): ActivityProfile | null {
    const row = this.db.prepare(
      "SELECT jid, account_id, peak_start_hour, peak_end_hour, message_count, scanned_at " +
      "FROM chat_activity_profiles WHERE jid = ?"
    ).get(jid) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      jid: row.jid as string,
      accountId: row.account_id as string,
      peakStartHour: row.peak_start_hour as number,
      peakEndHour: row.peak_end_hour as number,
      messageCount: row.message_count as number,
      scannedAt: row.scanned_at as number,
    };
  }

  /**
   * Phase 56 (ADAPT-02): Get JIDs of chats that need activity rescanning.
   * Returns contacts whose profile is missing or older than staleMs, and had a message
   * in the last recentMs (only scan active chats). Ordered by last_message_at DESC, max 200.
   * DO NOT REMOVE -- called by activity-scanner.ts runScanBatch() to pick chats for the next batch.
   */
  getChatsNeedingRescan(accountId: string, staleMs: number, recentMs: number): string[] {
    const now = Date.now();
    const staleThreshold = now - staleMs;
    const recentThreshold = now - recentMs;
    const rows = this.db.prepare(
      "SELECT c.jid FROM contacts c " +
      "LEFT JOIN chat_activity_profiles p ON c.jid = p.jid AND p.account_id = ? " +
      "WHERE (p.scanned_at IS NULL OR p.scanned_at < ?) " +
      "  AND c.last_message_at > ? " +
      "ORDER BY c.last_message_at DESC " +
      "LIMIT 200"
    ).all(accountId, staleThreshold, recentThreshold) as Array<{ jid: string }>;
    return rows.map(r => r.jid);
  }

  close(): void {
    if (this._walTimer) { clearTimeout(this._walTimer); this._walTimer = null; }
    this.db.close();
  }

  private _rowToContact(row: Record<string, unknown>): ContactRecord {
    const hasDmSettings = row.mode !== undefined && row.mode !== null;
    return {
      jid: row.jid as string,
      displayName: (row.display_name as string) ?? null,
      firstSeenAt: row.first_seen_at as number,
      lastMessageAt: row.last_message_at as number,
      messageCount: row.message_count as number,
      isGroup: row.is_group === 1,
      dmSettings: hasDmSettings
        ? {
            mode: (row.mode as string) === "listen_only" ? "listen_only" : "active",
            mentionOnly: row.mention_only === 1,
            customKeywords: (row.custom_keywords as string) ?? "",
            canInitiate: row.can_initiate !== 0,
            canInitiateOverride: (() => {
              const v = row.can_initiate_override as string | null | undefined;
              return (v === "allow" || v === "block") ? v : "default";
            })(),
          }
        : undefined,
    };
  }
  // ===========================================================================
  // Phase 17 (MOD-01, MOD-02): Module assignment and config methods.
  // These provide CRUD access to module_assignments and module_config tables.
  // Used by module-registry.ts. DO NOT REMOVE.
  // ===========================================================================

  /**
   * Return all JIDs assigned to a given module.
   */
  getModuleAssignments(moduleId: string): string[] {
    const rows = this.db.prepare(
      "SELECT jid FROM module_assignments WHERE module_id = ?"
    ).all(moduleId) as Array<{ jid: string }>;
    return rows.map((r) => r.jid);
  }

  /**
   * Return all module IDs assigned to a given chat JID.
   */
  getChatModules(jid: string): string[] {
    const rows = this.db.prepare(
      "SELECT module_id FROM module_assignments WHERE jid = ?"
    ).all(jid) as Array<{ module_id: string }>;
    return rows.map((r) => r.module_id);
  }

  /**
   * Assign a module to a chat. Upserts — safe to call if already assigned.
   */
  assignModule(moduleId: string, jid: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(
      "INSERT OR REPLACE INTO module_assignments (module_id, jid, assigned_at) VALUES (?, ?, ?)"
    ).run(moduleId, jid, now);
  }

  /**
   * Remove a module assignment from a chat. No-op if not assigned.
   */
  unassignModule(moduleId: string, jid: string): void {
    this.db.prepare(
      "DELETE FROM module_assignments WHERE module_id = ? AND jid = ?"
    ).run(moduleId, jid);
  }

  /**
   * Get stored config for a module. Returns {} if no config stored.
   */
  getModuleConfig(moduleId: string): Record<string, unknown> {
    const row = this.db.prepare(
      "SELECT config_json FROM module_config WHERE module_id = ?"
    ).get(moduleId) as { config_json: string } | undefined;
    if (!row) return {};
    try {
      return JSON.parse(row.config_json) as Record<string, unknown>;
    } catch (err) {
      log.warn("corrupt config JSON for module", { moduleId, error: err instanceof Error ? err.message : String(err) });
      return {};
    }
  }

  /**
   * Store config for a module. Replaces previous config entirely.
   */
  setModuleConfig(moduleId: string, config: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(
      "INSERT OR REPLACE INTO module_config (module_id, config_json, updated_at) VALUES (?, ?, ?)"
    ).run(moduleId, JSON.stringify(config), now);
  }
}

// Module-level singleton map keyed by "tenant:accountId"
const _directoryInstances = new Map<string, DirectoryDb>();

// PLAT-03: tenantId parameter for multi-tenant isolation.
// "default" tenant uses legacy path (no subdirectory) for backward compat.
// Non-default tenants get isolated subdirectories.
// DO NOT CHANGE default path — existing installations depend on it.
export function getDirectoryDb(accountId: string, tenantId: string = "default"): DirectoryDb {
  // Sanitize inputs to prevent path traversal
  const safeId = accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cacheKey = `${safeTenant}:${safeId}`;
  if (!_directoryInstances.has(cacheKey)) {
    // "default" tenant uses legacy path (no subdirectory) — DO NOT CHANGE for backward compat
    const dbPath = safeTenant === "default"
      ? join(homedir(), ".openclaw", "data", `waha-directory-${safeId}.db`)
      : join(homedir(), ".openclaw", "data", safeTenant, `waha-directory-${safeId}.db`);
    _directoryInstances.set(cacheKey, new DirectoryDb(dbPath));
  }
  return _directoryInstances.get(cacheKey)!;
}
