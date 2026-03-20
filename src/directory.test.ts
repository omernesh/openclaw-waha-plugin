/**
 * directory.ts CRUD test suite.
 * Uses real better-sqlite3 with ':memory:' path — no mocking of the DB layer.
 * Phase 31 (TST-03): DirectoryDb unit tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DirectoryDb, getDirectoryDb } from "./directory.js";

// ── Helpers ──

function makeDb(): DirectoryDb {
  // ':memory:' path — in-memory SQLite, isolated per test
  return new DirectoryDb(":memory:");
}

// ── contacts ──

describe("contacts", () => {
  let db: DirectoryDb;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it("upsertContact creates a new contact", () => {
    db.upsertContact("111@c.us", "Alice", false);
    const c = db.getContact("111@c.us");
    expect(c).not.toBeNull();
    expect(c!.jid).toBe("111@c.us");
    expect(c!.displayName).toBe("Alice");
    expect(c!.isGroup).toBe(false);
    expect(c!.messageCount).toBe(1);
  });

  it("upsertContact increments messageCount on subsequent calls", () => {
    db.upsertContact("111@c.us", "Alice", false);
    db.upsertContact("111@c.us", "Alice", false);
    const c = db.getContact("111@c.us");
    expect(c!.messageCount).toBe(2);
  });

  it("upsertContact updates displayName when provided", () => {
    db.upsertContact("111@c.us", "Alice", false);
    db.upsertContact("111@c.us", "Alice Updated", false);
    const c = db.getContact("111@c.us");
    expect(c!.displayName).toBe("Alice Updated");
  });

  it("getContact returns null for unknown JID", () => {
    expect(db.getContact("unknown@c.us")).toBeNull();
  });

  it("getContacts returns all inserted contacts", () => {
    db.upsertContact("aaa@c.us", "Alice", false);
    db.upsertContact("bbb@c.us", "Bob", false);
    const all = db.getContacts();
    expect(all.length).toBe(2);
  });

  it("getContacts filters by type=contact (excludes groups)", () => {
    db.upsertContact("aaa@c.us", "Alice", false);
    db.upsertContact("ggg@g.us", "MyGroup", true);
    const contacts = db.getContacts({ type: "contact" });
    expect(contacts.every(c => !c.isGroup)).toBe(true);
    expect(contacts.some(c => c.jid === "aaa@c.us")).toBe(true);
    expect(contacts.some(c => c.jid === "ggg@g.us")).toBe(false);
  });

  it("getContacts filters by type=group", () => {
    db.upsertContact("aaa@c.us", "Alice", false);
    db.upsertContact("ggg@g.us", "MyGroup", true);
    const groups = db.getContacts({ type: "group" });
    expect(groups.every(c => c.isGroup)).toBe(true);
  });

  it("getContacts paginates with limit and offset", () => {
    for (let i = 1; i <= 5; i++) {
      db.upsertContact(`${i}@c.us`, `Contact${i}`, false);
    }
    const page1 = db.getContacts({ limit: 2, offset: 0 });
    const page2 = db.getContacts({ limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    // No overlap
    const jids1 = page1.map(c => c.jid);
    const jids2 = page2.map(c => c.jid);
    expect(jids1.filter(j => jids2.includes(j)).length).toBe(0);
  });

  it("searchContacts finds contacts by name substring", () => {
    db.upsertContact("aaa@c.us", "Alice Johnson", false);
    db.upsertContact("bbb@c.us", "Bob Smith", false);
    // FTS5 prefix search
    const results = db.getContacts({ search: "Alice" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(c => c.jid === "aaa@c.us")).toBe(true);
  });
});

// ── dm_settings ──

describe("dm_settings", () => {
  let db: DirectoryDb;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it("getContactDmSettings returns defaults for contact with no settings", () => {
    db.upsertContact("111@c.us");
    const s = db.getContactDmSettings("111@c.us");
    expect(s.mode).toBe("active");
    expect(s.canInitiate).toBe(true);
    expect(s.canInitiateOverride).toBe("default");
    expect(s.mentionOnly).toBe(false);
  });

  it("setContactDmSettings persists partial update", () => {
    db.upsertContact("111@c.us");
    db.setContactDmSettings("111@c.us", { canInitiate: false, mode: "listen_only" });
    const s = db.getContactDmSettings("111@c.us");
    expect(s.canInitiate).toBe(false);
    expect(s.mode).toBe("listen_only");
    expect(s.canInitiateOverride).toBe("default"); // unchanged
  });

  it("setContactDmSettings updates canInitiateOverride", () => {
    db.upsertContact("111@c.us");
    db.setContactDmSettings("111@c.us", { canInitiateOverride: "block" });
    const s = db.getContactDmSettings("111@c.us");
    expect(s.canInitiateOverride).toBe("block");
  });

  it("canInitiateWith respects override=block over globalDefault=true", () => {
    db.upsertContact("111@c.us");
    db.setContactDmSettings("111@c.us", { canInitiateOverride: "block" });
    expect(db.canInitiateWith("111@c.us", true)).toBe(false);
  });

  it("canInitiateWith respects override=allow over globalDefault=false", () => {
    db.upsertContact("111@c.us");
    db.setContactDmSettings("111@c.us", { canInitiateOverride: "allow" });
    expect(db.canInitiateWith("111@c.us", false)).toBe(true);
  });

  it("canInitiateWith falls back to globalDefault when override=default", () => {
    db.upsertContact("111@c.us");
    // default override — follow global
    expect(db.canInitiateWith("111@c.us", true)).toBe(true);
    expect(db.canInitiateWith("111@c.us", false)).toBe(false);
  });
});

// ── allow_list ──

describe("allow_list", () => {
  let db: DirectoryDb;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it("setContactAllowDm allows a contact", () => {
    db.upsertContact("111@c.us");
    db.setContactAllowDm("111@c.us", true);
    expect(db.isContactAllowedDm("111@c.us")).toBe(true);
  });

  it("setContactAllowDm disallows a contact", () => {
    db.upsertContact("111@c.us");
    db.setContactAllowDm("111@c.us", true);
    db.setContactAllowDm("111@c.us", false);
    expect(db.isContactAllowedDm("111@c.us")).toBe(false);
  });

  it("isContactAllowedDm returns false for unknown contact", () => {
    expect(db.isContactAllowedDm("unknown@c.us")).toBe(false);
  });

  it("getAllowedDmJids returns all allowed JIDs", () => {
    db.upsertContact("aaa@c.us");
    db.upsertContact("bbb@c.us");
    db.setContactAllowDm("aaa@c.us", true);
    const jids = db.getAllowedDmJids();
    expect(jids).toContain("aaa@c.us");
    expect(jids).not.toContain("bbb@c.us");
  });
});

// ── group_participants ──

describe("group_participants", () => {
  let db: DirectoryDb;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it("bulkUpsertGroupParticipants inserts participants", () => {
    db.bulkUpsertGroupParticipants("grp@g.us", [
      { jid: "aaa@c.us", name: "Alice", isAdmin: true },
      { jid: "bbb@c.us", name: "Bob", isAdmin: false },
    ]);
    const participants = db.getGroupParticipants("grp@g.us");
    expect(participants.length).toBe(2);
    const alice = participants.find(p => p.participantJid === "aaa@c.us");
    expect(alice).not.toBeUndefined();
    expect(alice!.isAdmin).toBe(true);
    expect(alice!.displayName).toBe("Alice");
  });

  it("bulkUpsertGroupParticipants upserts (no duplicates on re-insert)", () => {
    db.bulkUpsertGroupParticipants("grp@g.us", [{ jid: "aaa@c.us", name: "Alice" }]);
    db.bulkUpsertGroupParticipants("grp@g.us", [{ jid: "aaa@c.us", name: "Alice Updated" }]);
    const participants = db.getGroupParticipants("grp@g.us");
    expect(participants.length).toBe(1);
    expect(participants[0]!.displayName).toBe("Alice Updated");
  });

  it("getGroupParticipantJids returns just JIDs", () => {
    db.bulkUpsertGroupParticipants("grp@g.us", [
      { jid: "aaa@c.us" },
      { jid: "bbb@c.us" },
    ]);
    const jids = db.getGroupParticipantJids("grp@g.us");
    expect(jids).toContain("aaa@c.us");
    expect(jids).toContain("bbb@c.us");
    expect(jids.length).toBe(2);
  });

  it("setParticipantAllowInGroup updates allow flag", () => {
    db.bulkUpsertGroupParticipants("grp@g.us", [{ jid: "aaa@c.us" }]);
    db.setParticipantAllowInGroup("grp@g.us", "aaa@c.us", true);
    const participants = db.getGroupParticipants("grp@g.us");
    expect(participants[0]!.allowInGroup).toBe(true);
  });

  it("setParticipantAllowDm updates allow_dm flag", () => {
    db.bulkUpsertGroupParticipants("grp@g.us", [{ jid: "aaa@c.us" }]);
    db.setParticipantAllowDm("grp@g.us", "aaa@c.us", true);
    const participants = db.getGroupParticipants("grp@g.us");
    expect(participants[0]!.allowDm).toBe(true);
  });
});

// ── group_filter_overrides ──

describe("group_filter_overrides", () => {
  let db: DirectoryDb;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it("getGroupFilterOverride returns null when no override set", () => {
    expect(db.getGroupFilterOverride("grp@g.us")).toBeNull();
  });

  it("setGroupFilterOverride creates an override", () => {
    db.setGroupFilterOverride("grp@g.us", { enabled: true, filterEnabled: false });
    const o = db.getGroupFilterOverride("grp@g.us");
    expect(o).not.toBeNull();
    expect(o!.enabled).toBe(true);
    expect(o!.filterEnabled).toBe(false);
  });

  it("setGroupFilterOverride updates existing override", () => {
    db.setGroupFilterOverride("grp@g.us", { enabled: true, filterEnabled: true });
    db.setGroupFilterOverride("grp@g.us", { filterEnabled: false });
    const o = db.getGroupFilterOverride("grp@g.us");
    expect(o!.enabled).toBe(true);  // preserved
    expect(o!.filterEnabled).toBe(false);  // updated
  });

  it("setGroupFilterOverride persists mentionPatterns as array", () => {
    db.setGroupFilterOverride("grp@g.us", { mentionPatterns: ["bot", "hey"] });
    const o = db.getGroupFilterOverride("grp@g.us");
    expect(o!.mentionPatterns).toEqual(["bot", "hey"]);
  });

  it("setGroupFilterOverride persists triggerOperator AND", () => {
    db.setGroupFilterOverride("grp@g.us", { triggerOperator: "AND" });
    const o = db.getGroupFilterOverride("grp@g.us");
    expect(o!.triggerOperator).toBe("AND");
  });
});

// ── lid_mapping ──

describe("lid_mapping", () => {
  let db: DirectoryDb;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it("upsertLidMapping and resolveLidToCus round-trip", () => {
    db.upsertLidMapping("271862907039996@lid", "972544329000@c.us");
    const result = db.resolveLidToCus("271862907039996@lid");
    expect(result).toBe("972544329000@c.us");
  });

  it("resolveLidToCus returns null for unknown LID", () => {
    expect(db.resolveLidToCus("unknown@lid")).toBeNull();
  });

  it("bulkUpsertLidMappings inserts multiple mappings", () => {
    db.bulkUpsertLidMappings([
      { lid: "111@lid", cus: "aaa@c.us" },
      { lid: "222@lid", cus: "bbb@c.us" },
    ]);
    expect(db.resolveLidToCus("111@lid")).toBe("aaa@c.us");
    expect(db.resolveLidToCus("222@lid")).toBe("bbb@c.us");
  });

  it("hasCusInLidMapping returns true when mapping exists", () => {
    db.upsertLidMapping("111@lid", "aaa@c.us");
    expect(db.hasCusInLidMapping("aaa@c.us")).toBe(true);
  });

  it("hasCusInLidMapping returns false when no mapping", () => {
    expect(db.hasCusInLidMapping("nothere@c.us")).toBe(false);
  });
});

// ── muted_groups ──

describe("muted_groups", () => {
  let db: DirectoryDb;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it("muteGroup marks a group as muted", () => {
    db.muteGroup("grp@g.us", "user@c.us", "acct1", 0, null);
    expect(db.isGroupMuted("grp@g.us")).toBe(true);
  });

  it("unmuteGroup removes the mute", () => {
    db.muteGroup("grp@g.us", "user@c.us", "acct1", 0, null);
    db.unmuteGroup("grp@g.us");
    expect(db.isGroupMuted("grp@g.us")).toBe(false);
  });

  it("unmuteGroup returns dm_backup when present", () => {
    const backup = { "aaa@c.us": true, "bbb@c.us": false };
    db.muteGroup("grp@g.us", "user@c.us", "acct1", 0, backup);
    const restored = db.unmuteGroup("grp@g.us");
    expect(restored).toEqual(backup);
  });

  it("isGroupMuted returns false for unknown group", () => {
    expect(db.isGroupMuted("unknown@g.us")).toBe(false);
  });

  it("getAllMutedGroups returns all muted groups", () => {
    db.muteGroup("grp1@g.us", "user@c.us", "acct1", 0, null);
    db.muteGroup("grp2@g.us", "user@c.us", "acct1", 0, null);
    const groups = db.getAllMutedGroups();
    expect(groups.length).toBe(2);
    expect(groups.map(g => g.groupJid)).toContain("grp1@g.us");
    expect(groups.map(g => g.groupJid)).toContain("grp2@g.us");
  });

  it("isGroupMuted auto-expires and returns false after expiry", async () => {
    // expiresAt in the past (1ms after epoch)
    db.muteGroup("grp@g.us", "user@c.us", "acct1", 1, null);
    // Should auto-expire and return false
    expect(db.isGroupMuted("grp@g.us")).toBe(false);
    // And be removed from the table
    expect(db.getMutedGroup("grp@g.us")).toBeNull();
  });
});

// ── pending_selections ──

describe("pending_selections", () => {
  let db: DirectoryDb;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it("setPendingSelection stores a selection", () => {
    db.setPendingSelection("sender@c.us", {
      type: "mute",
      groups: [{ jid: "grp@g.us", name: "My Group" }],
      durationStr: "30m",
    });
    const pending = db.getPendingSelection("sender@c.us");
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe("mute");
    expect(pending!.groups.length).toBe(1);
    expect(pending!.durationStr).toBe("30m");
    expect(pending!.senderId).toBe("sender@c.us");
  });

  it("getPendingSelection returns null when no selection", () => {
    expect(db.getPendingSelection("nobody@c.us")).toBeNull();
  });

  it("clearPendingSelection removes the selection", () => {
    db.setPendingSelection("sender@c.us", {
      type: "unmute",
      groups: [{ jid: "grp@g.us", name: "Group" }],
      durationStr: null,
    });
    db.clearPendingSelection("sender@c.us");
    expect(db.getPendingSelection("sender@c.us")).toBeNull();
  });

  it("setPendingSelection replaces existing pending selection", () => {
    db.setPendingSelection("sender@c.us", {
      type: "mute",
      groups: [{ jid: "grp1@g.us", name: "Group 1" }],
      durationStr: null,
    });
    db.setPendingSelection("sender@c.us", {
      type: "unmute",
      groups: [{ jid: "grp2@g.us", name: "Group 2" }],
      durationStr: null,
    });
    const pending = db.getPendingSelection("sender@c.us");
    expect(pending!.type).toBe("unmute");
    expect(pending!.groups[0]!.jid).toBe("grp2@g.us");
  });
});

// ── singleton ──

describe("singleton (getDirectoryDb)", () => {
  it("same accountId returns same instance", () => {
    const db1 = getDirectoryDb("test-acct-singleton-a");
    const db2 = getDirectoryDb("test-acct-singleton-a");
    expect(db1).toBe(db2);
  });

  it("different accountId returns different instance", () => {
    const db1 = getDirectoryDb("test-acct-singleton-b1");
    const db2 = getDirectoryDb("test-acct-singleton-b2");
    expect(db1).not.toBe(db2);
  });
});
