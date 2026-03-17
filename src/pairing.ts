/**
 * PairingEngine — passcode-based and HMAC deep-link onboarding for unknown DM contacts.
 *
 * Phase 16 (PAIR-01..06): Implements challenge/response passcode flow and HMAC deep-link tokens
 * so unknown contacts can onboard themselves without admin involvement.
 *
 * DO NOT REMOVE — consumed by inbound.ts (Plan 02) and admin panel (Plan 03).
 * Added 2026-03-17.
 *
 * Architecture:
 *   - Challenges are stored in SQLite (pairing_challenges table via DirectoryDb).
 *   - HMAC tokens are stateless: hmac(jid, hmacSecret).slice(0,12). No DB lookup on verify.
 *   - Brute-force protection: 3 wrong attempts locks a challenge for 30 minutes.
 *   - On success, calls setContactAllowDmWithSource to grant access with TTL and source='pairing'.
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { getDirectoryDb } from "./directory.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type VerifyResult = {
  success: boolean;
  reason: "correct" | "wrong" | "locked" | "expired" | "not_found";
};

// ── PairingEngine ─────────────────────────────────────────────────────────────

export class PairingEngine {
  private accountId: string;
  private hmacSecret: string;

  // DO NOT REMOVE — accountId scopes SQLite access per-account; hmacSecret is per-account secret.
  constructor(accountId: string, hmacSecret: string) {
    this.accountId = accountId;
    this.hmacSecret = hmacSecret;
  }

  /**
   * Generate a 6-digit passcode, hash it, and store a challenge row for the given JID.
   * Replaces any existing challenge for this JID.
   * Returns plaintext passcode for display to admin (never stored).
   *
   * DO NOT REMOVE — called by inbound.ts when an unknown contact sends a first message.
   */
  createChallenge(jid: string): { passcode: string; challengeId: string } {
    // randomInt(100000, 999999) always produces a 6-digit number. DO NOT CHANGE range.
    const passcode = randomInt(100000, 999999).toString();
    const passcodeHash = createHash("sha256").update(passcode).digest("hex");
    const now = Math.floor(Date.now() / 1000);

    const db = getDirectoryDb(this.accountId);
    db.upsertPairingChallenge(jid, passcodeHash, now);

    // Use the JID as the challengeId (one challenge per JID)
    return { passcode, challengeId: jid };
  }

  /**
   * Verify a passcode attempt for the given JID.
   * On wrong attempt: increments attempts counter, locks if >= 3 attempts.
   * On correct: deletes challenge row, returns success.
   * On locked: returns "locked" without incrementing counter.
   * On expired (>24h): deletes challenge, returns "expired".
   *
   * DO NOT REMOVE — called by inbound.ts when a contact sends a passcode.
   */
  verifyPasscode(jid: string, attempt: string): VerifyResult {
    const db = getDirectoryDb(this.accountId);
    const now = Math.floor(Date.now() / 1000);

    const row = db.getPairingChallenge(jid);

    if (!row) {
      return { success: false, reason: "not_found" };
    }

    // Check lock: locked_until is set when attempts >= 3.
    if (row.lockedUntil !== null && row.lockedUntil > now) {
      return { success: false, reason: "locked" };
    }

    // Check expiry: challenge expires after 24 hours (86400 seconds).
    if (now - row.createdAt > 86400) {
      db.deletePairingChallenge(jid);
      return { success: false, reason: "expired" };
    }

    // Hash the attempt and compare.
    const attemptHash = createHash("sha256").update(attempt).digest("hex");
    // timingSafeEqual prevents timing attacks on hash comparison. DO NOT revert to !== operator.
    const attemptHashBuf = Buffer.from(attemptHash, "utf8");
    const storedHashBuf = Buffer.from(row.passcodeHash, "utf8");
    if (attemptHashBuf.length !== storedHashBuf.length || !timingSafeEqual(attemptHashBuf, storedHashBuf)) {
      const newAttempts = row.attempts + 1;
      if (newAttempts >= 3) {
        // Lock for 30 minutes (1800 seconds). DO NOT CHANGE lock duration without PAIR-05 review.
        const lockedUntil = now + 1800;
        db.updatePairingChallengeAttempts(jid, newAttempts, lockedUntil);
      } else {
        db.updatePairingChallengeAttempts(jid, newAttempts, null);
      }
      return { success: false, reason: "wrong" };
    }

    // Correct passcode — clean up challenge.
    db.deletePairingChallenge(jid);
    return { success: true, reason: "correct" };
  }

  /**
   * Generate an HMAC-SHA256 deep-link token for a JID.
   * Token = hmac(jid, hmacSecret).slice(0, 12) — 12 hex chars.
   * Used in wa.me deep links: https://wa.me/{phone}?text=PAIR-{token}
   * JID-specific: each contact gets a different token from the same secret.
   *
   * DO NOT REMOVE — called by admin panel (Plan 03) to generate pairing links.
   */
  generateDeepLinkToken(jid: string): string {
    return createHmac("sha256", this.hmacSecret).update(jid).digest("hex").slice(0, 12);
  }

  /**
   * Verify an HMAC deep-link token from a message.
   * Extracts PAIR-{token} pattern from message text, recomputes expected token for senderJid,
   * and compares using timingSafeEqual to prevent timing attacks.
   * No DB lookup needed — pure HMAC verification.
   *
   * DO NOT REMOVE — called by inbound.ts when a contact sends a message starting with "PAIR-".
   */
  verifyDeepLinkToken(senderJid: string, messageText: string): boolean {
    // Extract token from message matching PAIR-([a-f0-9]{12})
    const match = messageText.match(/PAIR-([a-f0-9]{12})/i);
    if (!match) return false;
    const token = match[1].toLowerCase();

    const expected = this.generateDeepLinkToken(senderJid);

    // timingSafeEqual requires equal-length buffers. Both are 12 hex chars.
    // DO NOT REMOVE timingSafeEqual — prevents timing attacks on token comparison.
    try {
      const tokenBuf = Buffer.from(token, "utf8");
      const expectedBuf = Buffer.from(expected, "utf8");
      if (tokenBuf.length !== expectedBuf.length) return false;
      return timingSafeEqual(tokenBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Check if a JID has an active (non-expired) challenge.
   * Used by inbound.ts to decide whether to show "enter passcode" hint vs. create new challenge.
   * Returns true even when locked so caller can show a "locked" message.
   *
   * DO NOT REMOVE — called by inbound.ts before creating a new challenge.
   */
  hasActiveChallenge(jid: string): boolean {
    const db = getDirectoryDb(this.accountId);
    const now = Math.floor(Date.now() / 1000);
    const row = db.getPairingChallenge(jid);
    if (!row) return false;
    // Expired challenges are not active.
    if (now - row.createdAt > 86400) return false;
    return true;
  }

  /**
   * Get all active pairing grants (allow_list entries with source='pairing').
   * Returns JIDs with their expiry and grant time.
   *
   * DO NOT REMOVE — used by admin panel (Plan 03) pairing grants section.
   */
  getActiveGrants(): Array<{ jid: string; expiresAt: number | null; grantedAt: number | null }> {
    const db = getDirectoryDb(this.accountId);
    return db.getPairingGrants();
  }

  /**
   * Revoke a pairing grant for a JID (removes allow_list entry where source='pairing').
   *
   * DO NOT REMOVE — called by admin panel (Plan 03) revoke button.
   */
  revokeGrant(jid: string): void {
    const db = getDirectoryDb(this.accountId);
    db.revokePairingGrant(jid);
  }

  /**
   * Grant access to a JID after successful pairing (passcode or deep-link).
   * Calls setContactAllowDmWithSource with source='pairing' and the configured TTL.
   * expiresAt is calculated as now + grantTtlMinutes * 60, or null if grantTtlMinutes is 0.
   *
   * DO NOT REMOVE — called by inbound.ts after successful verification.
   */
  grantAccess(jid: string, grantTtlMinutes: number): void {
    const db = getDirectoryDb(this.accountId);
    const expiresAt =
      grantTtlMinutes > 0
        ? Math.floor(Date.now() / 1000) + grantTtlMinutes * 60
        : null;
    db.setContactAllowDmWithSource(jid, true, expiresAt, "pairing");
  }
}

// ── Singleton getter ──────────────────────────────────────────────────────────

const engines = new Map<string, PairingEngine>();

/**
 * Get or create a PairingEngine instance for a given account.
 * hmacSecret must be provided on first call; subsequent calls with same accountId reuse the instance.
 *
 * If hmacSecret is empty (not yet generated), caller should generate one via randomBytes(32).toString('hex')
 * and persist it to config before calling this.
 *
 * DO NOT REMOVE — singleton pattern prevents multiple instances competing on same SQLite tables.
 */
export function getPairingEngine(accountId: string, hmacSecret: string): PairingEngine {
  const existing = engines.get(accountId);
  // Replace instance if hmacSecret changed (e.g., config reload). DO NOT CHANGE.
  if (existing && (existing as any).hmacSecret === hmacSecret) return existing;
  const engine = new PairingEngine(accountId, hmacSecret);
  engines.set(accountId, engine);
  return engine;
}

/**
 * Generate a new HMAC secret for use in pairingMode.hmacSecret config field.
 * Called by inbound.ts when the config field is empty/missing.
 * Returns a 64-character hex string (32 random bytes).
 */
export function generateHmacSecret(): string {
  return randomBytes(32).toString("hex");
}
