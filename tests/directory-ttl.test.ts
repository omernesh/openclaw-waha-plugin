import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DirectoryDb } from "../src/directory.js";

describe("DirectoryDb TTL access", () => {
  let db: DirectoryDb;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ttl-test-"));
    db = new DirectoryDb(join(tmpDir, "test.db"));

    // Seed contacts so foreign key constraints pass
    db.bulkUpsertContacts([
      { jid: "972544329000@c.us", name: "Alice", isGroup: false },
      { jid: "972501234567@c.us", name: "Bob", isGroup: false },
      { jid: "972509876543@c.us", name: "Charlie", isGroup: false },
      { jid: "972507777777@c.us", name: "Dave", isGroup: false },
    ]);
  });

  afterEach(() => {
    // Close SQLite connection before removing temp dir (Windows EBUSY fix)
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("setContactAllowDm with expiresAt", () => {
    it("stores TTL when expiresAt is provided", () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      db.setContactAllowDm("972544329000@c.us", true, futureExpiry);

      const ttl = db.getContactTtl("972544329000@c.us");
      expect(ttl).not.toBeNull();
      expect(ttl!.expiresAt).toBe(futureExpiry);
      expect(ttl!.expired).toBe(false);
    });

    it("stores null expiresAt for permanent access", () => {
      db.setContactAllowDm("972544329000@c.us", true, null);

      const ttl = db.getContactTtl("972544329000@c.us");
      expect(ttl).not.toBeNull();
      expect(ttl!.expiresAt).toBeNull();
      expect(ttl!.expired).toBe(false);
    });
  });

  describe("isContactAllowedDm", () => {
    it("returns true for allowed contact with future expiry", () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      db.setContactAllowDm("972544329000@c.us", true, futureExpiry);

      expect(db.isContactAllowedDm("972544329000@c.us")).toBe(true);
    });

    it("returns true for allowed contact with null expiry (permanent)", () => {
      db.setContactAllowDm("972544329000@c.us", true, null);

      expect(db.isContactAllowedDm("972544329000@c.us")).toBe(true);
    });

    it("returns false for expired entries", () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 100; // 100 seconds ago
      db.setContactAllowDm("972544329000@c.us", true, pastExpiry);

      expect(db.isContactAllowedDm("972544329000@c.us")).toBe(false);
    });

    it("returns false for contacts not in allow list", () => {
      expect(db.isContactAllowedDm("972599999999@c.us")).toBe(false);
    });
  });

  describe("isAllowListEntryExpired", () => {
    it("returns true for expired entries", () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 100;
      db.setContactAllowDm("972544329000@c.us", true, pastExpiry);

      expect(db.isAllowListEntryExpired("972544329000@c.us")).toBe(true);
    });

    it("returns false for non-expired entries", () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      db.setContactAllowDm("972544329000@c.us", true, futureExpiry);

      expect(db.isAllowListEntryExpired("972544329000@c.us")).toBe(false);
    });

    it("returns false for entries with no TTL (permanent)", () => {
      db.setContactAllowDm("972544329000@c.us", true, null);

      expect(db.isAllowListEntryExpired("972544329000@c.us")).toBe(false);
    });

    it("returns false for unknown JIDs", () => {
      expect(db.isAllowListEntryExpired("972599999999@c.us")).toBe(false);
    });
  });

  describe("getExpiredJids", () => {
    it("returns only expired entries", () => {
      const now = Math.floor(Date.now() / 1000);
      const past = now - 100;
      const future = now + 3600;

      db.setContactAllowDm("972544329000@c.us", true, past);    // expired
      db.setContactAllowDm("972501234567@c.us", true, future);  // active
      db.setContactAllowDm("972509876543@c.us", true, null);    // permanent

      const expired = db.getExpiredJids();
      expect(expired).toContain("972544329000@c.us");
      expect(expired).not.toContain("972501234567@c.us");
      expect(expired).not.toContain("972509876543@c.us");
    });

    it("returns empty array when no expired entries exist", () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      db.setContactAllowDm("972544329000@c.us", true, future);
      db.setContactAllowDm("972501234567@c.us", true, null);

      expect(db.getExpiredJids()).toEqual([]);
    });

    it("returns multiple expired entries", () => {
      const past = Math.floor(Date.now() / 1000) - 100;
      db.setContactAllowDm("972544329000@c.us", true, past);
      db.setContactAllowDm("972501234567@c.us", true, past);

      const expired = db.getExpiredJids();
      expect(expired.length).toBe(2);
      expect(expired).toContain("972544329000@c.us");
      expect(expired).toContain("972501234567@c.us");
    });
  });

  describe("cleanupExpiredAllowList", () => {
    it("removes entries expired more than 24 hours ago", () => {
      const now = Math.floor(Date.now() / 1000);
      const longAgo = now - 86401 - 100; // Expired > 24h ago

      db.setContactAllowDm("972544329000@c.us", true, longAgo);

      const cleaned = db.cleanupExpiredAllowList();
      expect(cleaned).toBe(1);

      // Entry should be gone
      expect(db.getContactTtl("972544329000@c.us")).toBeNull();
    });

    it("keeps recently expired entries (< 24h)", () => {
      const now = Math.floor(Date.now() / 1000);
      const recentlyExpired = now - 100; // Expired 100s ago

      db.setContactAllowDm("972544329000@c.us", true, recentlyExpired);

      const cleaned = db.cleanupExpiredAllowList();
      expect(cleaned).toBe(0);

      // Entry should still exist
      expect(db.getContactTtl("972544329000@c.us")).not.toBeNull();
    });

    it("keeps active (non-expired) entries", () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      db.setContactAllowDm("972544329000@c.us", true, future);

      const cleaned = db.cleanupExpiredAllowList();
      expect(cleaned).toBe(0);

      expect(db.isContactAllowedDm("972544329000@c.us")).toBe(true);
    });

    it("keeps permanent entries (null expiresAt)", () => {
      db.setContactAllowDm("972544329000@c.us", true, null);

      const cleaned = db.cleanupExpiredAllowList();
      expect(cleaned).toBe(0);

      expect(db.isContactAllowedDm("972544329000@c.us")).toBe(true);
    });

    it("returns 0 when no entries to clean", () => {
      expect(db.cleanupExpiredAllowList()).toBe(0);
    });
  });

  describe("setContactAllowDmWithSource", () => {
    it("stores source field for pairing grants", () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      db.setContactAllowDmWithSource("972544329000@c.us", true, future, "pairing");

      const ttl = db.getContactTtl("972544329000@c.us");
      expect(ttl).not.toBeNull();
      expect(ttl!.source).toBe("pairing");
    });

    it("removes entry when allow is false", () => {
      db.setContactAllowDm("972544329000@c.us", true, null);
      expect(db.isContactAllowedDm("972544329000@c.us")).toBe(true);

      db.setContactAllowDmWithSource("972544329000@c.us", false);
      expect(db.isContactAllowedDm("972544329000@c.us")).toBe(false);
    });
  });
});
