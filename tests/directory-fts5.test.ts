import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DirectoryDb } from "../src/directory.js";

describe("DirectoryDb FTS5 search", () => {
  let db: DirectoryDb;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fts5-test-"));
    db = new DirectoryDb(join(tmpDir, "test.db"));

    // Seed test contacts
    db.bulkUpsertContacts([
      { jid: "972544329000@c.us", name: "Alice Johnson", isGroup: false },
      { jid: "972501234567@c.us", name: "Bob Smith", isGroup: false },
      { jid: "972509876543@c.us", name: "Charlie Brown", isGroup: false },
      { jid: "120363421825201386@g.us", name: "Test Group Alpha", isGroup: true },
      { jid: "120363421825201387@g.us", name: "Development Team", isGroup: true },
      { jid: "newsletter123@newsletter", name: "Daily Digest", isGroup: false },
    ]);
  });

  afterEach(() => {
    // Close SQLite connection before removing temp dir (Windows EBUSY fix)
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds contacts by name", () => {
    const results = db.getContacts({ search: "Alice" });
    expect(results.length).toBe(1);
    expect(results[0].jid).toBe("972544329000@c.us");
    expect(results[0].displayName).toBe("Alice Johnson");
  });

  it("finds contacts by partial name match", () => {
    const results = db.getContacts({ search: "Smith" });
    expect(results.length).toBe(1);
    expect(results[0].jid).toBe("972501234567@c.us");
  });

  it("finds contacts by full JID token", () => {
    // FTS5 tokenizes JID at @ boundary — "972544329000" is one token
    const results = db.getContacts({ search: "972544329000" });
    expect(results.length).toBe(1);
    expect(results[0].jid).toBe("972544329000@c.us");
  });

  it("search is case-insensitive", () => {
    const lower = db.getContacts({ search: "alice" });
    const upper = db.getContacts({ search: "ALICE" });
    const mixed = db.getContacts({ search: "aLiCe" });

    expect(lower.length).toBe(1);
    expect(upper.length).toBe(1);
    expect(mixed.length).toBe(1);
    expect(lower[0].jid).toBe(upper[0].jid);
    expect(lower[0].jid).toBe(mixed[0].jid);
  });

  it("returns multiple matches when name token is shared", () => {
    // Add contacts that share a name token
    db.bulkUpsertContacts([
      { jid: "11111@c.us", name: "Team Alpha", isGroup: false },
      { jid: "22222@c.us", name: "Team Beta", isGroup: false },
      { jid: "33333@c.us", name: "Team Gamma", isGroup: false },
    ]);

    const results = db.getContacts({ search: "Team" });
    // 3 new contacts + "Development Team" group = 4, but groups also match
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it("finds groups by name", () => {
    const results = db.getContacts({ search: "Alpha" });
    expect(results.length).toBe(1);
    expect(results[0].jid).toBe("120363421825201386@g.us");
    expect(results[0].isGroup).toBe(true);
  });

  it("finds newsletters by name", () => {
    const results = db.getContacts({ search: "Digest" });
    expect(results.length).toBe(1);
    expect(results[0].jid).toBe("newsletter123@newsletter");
  });

  it("returns empty array for no matches", () => {
    const results = db.getContacts({ search: "Nonexistent" });
    expect(results.length).toBe(0);
  });

  it("handles FTS5 special characters by quoting them", () => {
    // Characters like quotes, colons, and operators should be safely escaped
    // This should not throw — the _fts5Quote method wraps terms in double-quotes
    const results = db.getContacts({ search: 'test"colon:star*' });
    expect(Array.isArray(results)).toBe(true);
    // No matches expected, just verify no crash
  });

  it("handles search with multiple space-separated terms", () => {
    const results = db.getContacts({ search: "Alice Johnson" });
    expect(results.length).toBe(1);
    expect(results[0].jid).toBe("972544329000@c.us");
  });

  it("type filter works with FTS5 search", () => {
    // Search for contacts only by name token "c" won't work; use a name shared between types
    // Add a contact named "Test Person" so "Test" matches both a group and a contact
    db.bulkUpsertContacts([{ jid: "55555@c.us", name: "Test Person", isGroup: false }]);

    const contacts = db.getContacts({ search: "Test", type: "contact" });
    expect(contacts.every((c) => !c.isGroup)).toBe(true);
    expect(contacts.length).toBeGreaterThanOrEqual(1);

    const groups = db.getContacts({ search: "Test", type: "group" });
    expect(groups.every((c) => c.isGroup)).toBe(true);
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("getContactCount with search matches getContacts result length", () => {
    const results = db.getContacts({ search: "Alice" });
    const count = db.getContactCount("Alice");
    expect(count).toBe(results.length);
  });
});
