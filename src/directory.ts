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

  getContacts(opts?: { search?: string; limit?: number; offset?: number }): ContactRecord[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const search = opts?.search?.trim();

    let sql = `
      SELECT c.jid, c.display_name, c.first_seen_at, c.last_message_at, c.message_count, c.is_group,
             d.mode, d.mention_only, d.custom_keywords, d.can_initiate
      FROM contacts c
      LEFT JOIN dm_settings d ON c.jid = d.jid
    `;
    const params: unknown[] = [];

    if (search) {
      sql += " WHERE (c.jid LIKE ? OR c.display_name LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
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

  getContactCount(search?: string): number {
    if (search?.trim()) {
      const s = `%${search.trim()}%`;
      const row = this.db
        .prepare("SELECT COUNT(*) as cnt FROM contacts WHERE jid LIKE ? OR display_name LIKE ?")
        .get(s, s) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM contacts").get() as { cnt: number };
    return row.cnt;
  }

  getDmCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM contacts WHERE is_group = 0")
      .get() as { cnt: number };
    return row.cnt;
  }

  getGroupCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM contacts WHERE is_group = 1")
      .get() as { cnt: number };
    return row.cnt;
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
  if (!_directoryInstances.has(accountId)) {
    const dbPath = join(homedir(), ".openclaw", "data", `waha-directory-${accountId}.db`);
    _directoryInstances.set(accountId, new DirectoryDb(dbPath));
  }
  return _directoryInstances.get(accountId)!;
}
