import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock directory.js before importing pairing module
const mockDb = {
  upsertPairingChallenge: vi.fn(),
  getPairingChallenge: vi.fn(),
  updatePairingChallengeAttempts: vi.fn(),
  deletePairingChallenge: vi.fn(),
  setContactAllowDmWithSource: vi.fn(),
  upsertContact: vi.fn(),
};

vi.mock("../src/directory.js", () => ({
  getDirectoryDb: () => mockDb,
}));

import { PairingEngine } from "../src/pairing.js";

describe("PairingEngine", () => {
  let engine: PairingEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new PairingEngine("test-account", "test-hmac-secret-key-1234567890abcdef");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createChallenge", () => {
    it("generates a 6-digit passcode string", () => {
      const { passcode } = engine.createChallenge("972544329000@c.us");
      expect(passcode).toMatch(/^\d{6}$/);
      expect(Number(passcode)).toBeGreaterThanOrEqual(100000);
      expect(Number(passcode)).toBeLessThanOrEqual(999999);
    });

    it("calls db.upsertPairingChallenge with JID and hashed passcode", () => {
      const { passcode } = engine.createChallenge("972544329000@c.us");
      expect(mockDb.upsertPairingChallenge).toHaveBeenCalledOnce();

      const [jid, hash, createdAt] = mockDb.upsertPairingChallenge.mock.calls[0];
      expect(jid).toBe("972544329000@c.us");
      // Hash should be a 64-char hex string (SHA-256)
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      // Hash should NOT be the plaintext passcode
      expect(hash).not.toBe(passcode);
      expect(createdAt).toBeTypeOf("number");
    });

    it("returns challengeId equal to the JID", () => {
      const { challengeId } = engine.createChallenge("972544329000@c.us");
      expect(challengeId).toBe("972544329000@c.us");
    });
  });

  describe("verifyPasscode", () => {
    it("returns success with correct passcode", () => {
      // Create a challenge to get the passcode
      const { passcode } = engine.createChallenge("972544329000@c.us");
      const [, storedHash, createdAt] = mockDb.upsertPairingChallenge.mock.calls[0];

      // Mock the DB to return the challenge
      mockDb.getPairingChallenge.mockReturnValue({
        jid: "972544329000@c.us",
        passcodeHash: storedHash,
        createdAt,
        attempts: 0,
        lockedUntil: null,
      });

      const result = engine.verifyPasscode("972544329000@c.us", passcode);
      expect(result.success).toBe(true);
      expect(result.reason).toBe("correct");
      expect(mockDb.deletePairingChallenge).toHaveBeenCalledWith("972544329000@c.us");
    });

    it("returns wrong with incorrect passcode", () => {
      const now = Math.floor(Date.now() / 1000);
      mockDb.getPairingChallenge.mockReturnValue({
        jid: "972544329000@c.us",
        passcodeHash: "aaaa".repeat(16), // fake hash
        createdAt: now,
        attempts: 0,
        lockedUntil: null,
      });

      const result = engine.verifyPasscode("972544329000@c.us", "000000");
      expect(result.success).toBe(false);
      expect(result.reason).toBe("wrong");
      expect(mockDb.updatePairingChallengeAttempts).toHaveBeenCalledWith("972544329000@c.us", 1, null);
    });

    it("returns not_found when no challenge exists", () => {
      mockDb.getPairingChallenge.mockReturnValue(null);

      const result = engine.verifyPasscode("972544329000@c.us", "123456");
      expect(result.success).toBe(false);
      expect(result.reason).toBe("not_found");
    });

    it("locks after 3 wrong attempts (30 min lockout)", () => {
      const now = Math.floor(Date.now() / 1000);
      mockDb.getPairingChallenge.mockReturnValue({
        jid: "972544329000@c.us",
        passcodeHash: "bbbb".repeat(16),
        createdAt: now,
        attempts: 2, // Already 2 wrong attempts
        lockedUntil: null,
      });

      const result = engine.verifyPasscode("972544329000@c.us", "000000");
      expect(result.success).toBe(false);
      expect(result.reason).toBe("wrong");

      // Should set locked_until = now + 1800 (30 min)
      const [jid, newAttempts, lockedUntil] = mockDb.updatePairingChallengeAttempts.mock.calls[0];
      expect(jid).toBe("972544329000@c.us");
      expect(newAttempts).toBe(3);
      expect(lockedUntil).toBeGreaterThan(now);
      expect(lockedUntil).toBeLessThanOrEqual(now + 1801); // within ~1s tolerance
    });

    it("returns locked when challenge is locked", () => {
      const now = Math.floor(Date.now() / 1000);
      mockDb.getPairingChallenge.mockReturnValue({
        jid: "972544329000@c.us",
        passcodeHash: "cccc".repeat(16),
        createdAt: now - 100,
        attempts: 3,
        lockedUntil: now + 1700, // Still locked
      });

      const result = engine.verifyPasscode("972544329000@c.us", "123456");
      expect(result.success).toBe(false);
      expect(result.reason).toBe("locked");
      // Should NOT increment attempts during lockout
      expect(mockDb.updatePairingChallengeAttempts).not.toHaveBeenCalled();
    });

    it("returns expired for challenges older than 24 hours", () => {
      const now = Math.floor(Date.now() / 1000);
      mockDb.getPairingChallenge.mockReturnValue({
        jid: "972544329000@c.us",
        passcodeHash: "dddd".repeat(16),
        createdAt: now - 86401, // 24h + 1s ago
        attempts: 0,
        lockedUntil: null,
      });

      const result = engine.verifyPasscode("972544329000@c.us", "123456");
      expect(result.success).toBe(false);
      expect(result.reason).toBe("expired");
      expect(mockDb.deletePairingChallenge).toHaveBeenCalledWith("972544329000@c.us");
    });
  });

  describe("generateDeepLinkToken", () => {
    it("produces a 12-character hex string", () => {
      const token = engine.generateDeepLinkToken("972544329000@c.us");
      expect(token).toMatch(/^[a-f0-9]{12}$/);
    });

    it("produces different tokens for different JIDs", () => {
      const token1 = engine.generateDeepLinkToken("972544329000@c.us");
      const token2 = engine.generateDeepLinkToken("972501234567@c.us");
      expect(token1).not.toBe(token2);
    });

    it("produces the same token for the same JID (deterministic)", () => {
      const token1 = engine.generateDeepLinkToken("972544329000@c.us");
      const token2 = engine.generateDeepLinkToken("972544329000@c.us");
      expect(token1).toBe(token2);
    });
  });

  describe("verifyDeepLinkToken", () => {
    it("returns true for a valid PAIR-{token} message", () => {
      const token = engine.generateDeepLinkToken("972544329000@c.us");
      const message = `PAIR-${token}`;
      expect(engine.verifyDeepLinkToken("972544329000@c.us", message)).toBe(true);
    });

    it("returns true when PAIR- token is embedded in longer message", () => {
      const token = engine.generateDeepLinkToken("972544329000@c.us");
      const message = `Hello PAIR-${token} please add me`;
      expect(engine.verifyDeepLinkToken("972544329000@c.us", message)).toBe(true);
    });

    it("returns false for wrong token", () => {
      expect(engine.verifyDeepLinkToken("972544329000@c.us", "PAIR-abcdef123456")).toBe(false);
    });

    it("returns false for malformed message without PAIR- prefix", () => {
      const token = engine.generateDeepLinkToken("972544329000@c.us");
      expect(engine.verifyDeepLinkToken("972544329000@c.us", token)).toBe(false);
    });

    it("returns false for empty message", () => {
      expect(engine.verifyDeepLinkToken("972544329000@c.us", "")).toBe(false);
    });

    it("rejects token generated for a different JID", () => {
      const token = engine.generateDeepLinkToken("972501234567@c.us");
      const message = `PAIR-${token}`;
      // Verifying with a different sender should fail
      expect(engine.verifyDeepLinkToken("972544329000@c.us", message)).toBe(false);
    });
  });

  describe("hasActiveChallenge", () => {
    it("returns true when an active challenge exists", () => {
      const now = Math.floor(Date.now() / 1000);
      mockDb.getPairingChallenge.mockReturnValue({
        jid: "972544329000@c.us",
        passcodeHash: "eeee".repeat(16),
        createdAt: now - 100, // Created 100s ago — well within 24h
        attempts: 0,
        lockedUntil: null,
      });

      expect(engine.hasActiveChallenge("972544329000@c.us")).toBe(true);
    });

    it("returns false when no challenge exists", () => {
      mockDb.getPairingChallenge.mockReturnValue(null);
      expect(engine.hasActiveChallenge("972544329000@c.us")).toBe(false);
    });

    it("returns false when challenge is expired (>24h)", () => {
      const now = Math.floor(Date.now() / 1000);
      mockDb.getPairingChallenge.mockReturnValue({
        jid: "972544329000@c.us",
        passcodeHash: "ffff".repeat(16),
        createdAt: now - 86401, // Expired
        attempts: 0,
        lockedUntil: null,
      });

      expect(engine.hasActiveChallenge("972544329000@c.us")).toBe(false);
    });

    it("returns true even when challenge is locked (lock is still active)", () => {
      const now = Math.floor(Date.now() / 1000);
      mockDb.getPairingChallenge.mockReturnValue({
        jid: "972544329000@c.us",
        passcodeHash: "1111".repeat(16),
        createdAt: now - 50,
        attempts: 3,
        lockedUntil: now + 1700,
      });

      expect(engine.hasActiveChallenge("972544329000@c.us")).toBe(true);
    });
  });

  describe("grantAccess", () => {
    it("calls setContactAllowDmWithSource with TTL when grantTtlMinutes > 0", () => {
      engine.grantAccess("972544329000@c.us", 60); // 60 minutes

      expect(mockDb.setContactAllowDmWithSource).toHaveBeenCalledOnce();
      const [jid, allow, expiresAt, source] = mockDb.setContactAllowDmWithSource.mock.calls[0];
      expect(jid).toBe("972544329000@c.us");
      expect(allow).toBe(true);
      expect(expiresAt).toBeTypeOf("number");
      expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(source).toBe("pairing");
    });

    it("calls setContactAllowDmWithSource with null expiresAt when grantTtlMinutes is 0", () => {
      engine.grantAccess("972544329000@c.us", 0);

      expect(mockDb.setContactAllowDmWithSource).toHaveBeenCalledOnce();
      const [jid, allow, expiresAt, source] = mockDb.setContactAllowDmWithSource.mock.calls[0];
      expect(jid).toBe("972544329000@c.us");
      expect(allow).toBe(true);
      expect(expiresAt).toBeNull();
      expect(source).toBe("pairing");
    });
  });
});
