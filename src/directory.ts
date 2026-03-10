import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
};

export type GroupParticipant = {
  groupJid: string;
  participantJid: string;
  displayName: string | null;
  isAdmin: boolean;
  allowInGroup: boolean;
  allowDm: boolean;
};

export type ContactType = "contact" | "group" | "newsletter";

const DEFAULT_DM_SETTINGS: ContactDmSettings = {
  mode: "active",
  mentionOnly: false,
  customKeywords: "",
  canInitiate: true,
};

export class DirectoryDb {
  private db: ReturnType<typeof require>;

  constructor(dbPath: string) {
    const dir = join(dbPath, "..");
    mkdirSync(dir, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Database = require("better-sqlite3") as any;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this._createSchema();
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
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (group_jid, participant_jid)
      );
    `);
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

  getContacts(opts?: { search?: string; limit?: number; offset?: number; type?: ContactType }): ContactRecord[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const search = opts?.search?.trim();
    const type = opts?.type;

    let sql = `
      SELECT c.jid, c.display_name, c.first_seen_at, c.last_message_at, c.message_count, c.is_group,
             d.mode, d.mention_only, d.custom_keywords, d.can_initiate
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

    // Search filter
    if (search) {
      conditions.push("(c.jid LIKE ? OR c.display_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY c.last_message_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(this._rowToContact);
  }

  getContact(jid: string): ContactRecord | null {
    const row = this.db
      .prepare(
        `SELECT c.jid, c.display_name, c.first_seen_at, c.last_message_at, c.message_count, c.is_group,
                d.mode, d.mention_only, d.custom_keywords, d.can_initiate
         FROM contacts c
         LEFT JOIN dm_settings d ON c.jid = d.jid
         WHERE c.jid = ?`,
      )
      .get(jid) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this._rowToContact(row);
  }

  getContactDmSettings(jid: string): ContactDmSettings {
    const row = this.db
      .prepare("SELECT mode, mention_only, custom_keywords, can_initiate FROM dm_settings WHERE jid = ?")
      .get(jid) as Record<string, unknown> | undefined;

    if (!row) return { ...DEFAULT_DM_SETTINGS };

    return {
      mode: (row.mode as string) === "listen_only" ? "listen_only" : "active",
      mentionOnly: row.mention_only === 1,
      customKeywords: (row.custom_keywords as string) ?? "",
      canInitiate: row.can_initiate !== 0,
    };
  }

  setContactDmSettings(jid: string, settings: Partial<ContactDmSettings>): void {
    const existing = this.getContactDmSettings(jid);
    const merged: ContactDmSettings = {
      mode: settings.mode ?? existing.mode,
      mentionOnly: settings.mentionOnly ?? existing.mentionOnly,
      customKeywords: settings.customKeywords ?? existing.customKeywords,
      canInitiate: settings.canInitiate ?? existing.canInitiate,
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO dm_settings (jid, mode, mention_only, custom_keywords, can_initiate, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jid,
        merged.mode,
        merged.mentionOnly ? 1 : 0,
        merged.customKeywords,
        merged.canInitiate ? 1 : 0,
        Date.now(),
      );
  }

  getContactCount(search?: string, type?: ContactType): number {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (type === "contact") {
      conditions.push("is_group = 0 AND jid NOT LIKE '%@newsletter'");
    } else if (type === "group") {
      conditions.push("is_group = 1");
    } else if (type === "newsletter") {
      conditions.push("jid LIKE '%@newsletter'");
    }

    if (search?.trim()) {
      const s = `%${search.trim()}%`;
      conditions.push("(jid LIKE ? OR display_name LIKE ?)");
      params.push(s, s);
    }

    let sql = "SELECT COUNT(*) as cnt FROM contacts";
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    const row = this.db.prepare(sql).get(...params) as { cnt: number };
    return row.cnt;
  }

  getDmCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM contacts WHERE is_group = 0 AND jid NOT LIKE '%@newsletter'")
      .get() as { cnt: number };
    return row.cnt;
  }

  getGroupCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM contacts WHERE is_group = 1")
      .get() as { cnt: number };
    return row.cnt;
  }

  getNewsletterCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM contacts WHERE jid LIKE '%@newsletter'")
      .get() as { cnt: number };
    return row.cnt;
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

  setContactAllowDm(jid: string, allowed: boolean): void {
    const now = Date.now();
    // Ensure contact exists
    const existing = this.db.prepare("SELECT jid FROM contacts WHERE jid = ?").get(jid);
    if (!existing) {
      this.upsertContact(jid, undefined, false);
    }
    if (allowed) {
      this.db.prepare(
        "INSERT OR REPLACE INTO allow_list (jid, allow_dm, added_at) VALUES (?, 1, ?)"
      ).run(jid, now);
    } else {
      this.db.prepare("DELETE FROM allow_list WHERE jid = ?").run(jid);
    }
  }

  isContactAllowedDm(jid: string): boolean {
    const row = this.db.prepare("SELECT allow_dm FROM allow_list WHERE jid = ? AND allow_dm = 1").get(jid) as { allow_dm: number } | undefined;
    return Boolean(row);
  }

  getAllowedDmJids(): string[] {
    const fromAllowList = this.db.prepare("SELECT jid FROM allow_list WHERE allow_dm = 1").all() as Array<{ jid: string }>;
    const fromParticipants = this.db.prepare("SELECT DISTINCT participant_jid as jid FROM group_participants WHERE allow_dm = 1").all() as Array<{ jid: string }>;
    const set = new Set<string>();
    for (const r of fromAllowList) set.add(r.jid);
    for (const r of fromParticipants) set.add(r.jid);
    return [...set];
  }

  // ── Group participant methods ──

  getGroupParticipants(groupJid: string): GroupParticipant[] {
    const rows = this.db.prepare(
      "SELECT group_jid, participant_jid, display_name, is_admin, allow_in_group, allow_dm FROM group_participants WHERE group_jid = ? ORDER BY display_name ASC, participant_jid ASC"
    ).all(groupJid) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      groupJid: r.group_jid as string,
      participantJid: r.participant_jid as string,
      displayName: (r.display_name as string) ?? null,
      isAdmin: r.is_admin === 1,
      allowInGroup: r.allow_in_group === 1,
      allowDm: r.allow_dm === 1,
    }));
  }

  bulkUpsertGroupParticipants(groupJid: string, participants: Array<{ jid: string; name?: string; isAdmin?: boolean }>): number {
    if (participants.length === 0) return 0;
    const now = Date.now();
    const upsert = this.db.prepare(
      `INSERT INTO group_participants (group_jid, participant_jid, display_name, is_admin, allow_in_group, allow_dm, updated_at)
       VALUES (?, ?, ?, ?, COALESCE((SELECT allow_in_group FROM group_participants WHERE group_jid = ? AND participant_jid = ?), 0), COALESCE((SELECT allow_dm FROM group_participants WHERE group_jid = ? AND participant_jid = ?), 0), ?)
       ON CONFLICT(group_jid, participant_jid) DO UPDATE SET display_name = excluded.display_name, is_admin = excluded.is_admin, updated_at = excluded.updated_at`
    );
    const tx = this.db.transaction((rows: Array<{ jid: string; name?: string; isAdmin?: boolean }>) => {
      let count = 0;
      for (const row of rows) {
        upsert.run(groupJid, row.jid, row.name ?? null, row.isAdmin ? 1 : 0, groupJid, row.jid, groupJid, row.jid, now);
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

  /**
   * Merge one contact (fromJid) into another (toJid).
   * Combines message counts and keeps the better name. Deletes the fromJid entry.
   */
  mergeContacts(fromJid: string, toJid: string): boolean {
    const fromRow = this.db.prepare("SELECT message_count, display_name, first_seen_at, last_message_at FROM contacts WHERE jid = ?").get(fromJid) as
      | { message_count: number; display_name: string | null; first_seen_at: number; last_message_at: number }
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
         VALUES (?, ?, ?, ?, ?, 0)`
      ).run(toJid, fromRow.display_name, fromRow.first_seen_at, fromRow.last_message_at, fromRow.message_count);
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
   */
  deleteContact(jid: string): void {
    this.db.prepare("DELETE FROM dm_settings WHERE jid = ?").run(jid);
    this.db.prepare("DELETE FROM allow_list WHERE jid = ?").run(jid);
    this.db.prepare("DELETE FROM group_participants WHERE participant_jid = ?").run(jid);
    this.db.prepare("DELETE FROM contacts WHERE jid = ?").run(jid);
  }


  close(): void {
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
          }
        : undefined,
    };
  }
}

// Module-level singleton map keyed by accountId
const _directoryInstances = new Map<string, DirectoryDb>();

export function getDirectoryDb(accountId: string): DirectoryDb {
  // Sanitize accountId to prevent path traversal
  const safeId = accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!_directoryInstances.has(safeId)) {
    const dbPath = join(homedir(), ".openclaw", "data", `waha-directory-${safeId}.db`);
    _directoryInstances.set(safeId, new DirectoryDb(dbPath));
  }
  return _directoryInstances.get(safeId)!;
}
