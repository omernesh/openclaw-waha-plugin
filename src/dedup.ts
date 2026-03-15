// ╔══════════════════════════════════════════════════════════════════════╗
// ║  WEBHOOK DEDUPLICATION — DO NOT CHANGE                             ║
// ║                                                                    ║
// ║  Safety net for duplicate webhook deliveries from WAHA.            ║
// ║  Primary guard: only processing "message" events (not "message.any") ║
// ║  This is SECONDARY protection using composite key eventType:messageId. ║
// ║                                                                    ║
// ║  Added in Phase 1, Plan 02 (2026-03-11) — REL-09.                ║
// ║  Bounded to DEDUP_MAX entries with TTL-based pruning.             ║
// ╚══════════════════════════════════════════════════════════════════════╝

const DEDUP_MAX = 200;
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

const _dedupEntries = new Map<string, number>(); // key -> timestamp

/**
 * Check if a webhook event is a duplicate based on composite key.
 * Returns true if this event has been seen before (within TTL window).
 * Returns false for first occurrence or if messageId is empty/undefined (skip dedup).
 *
 * Side effect: registers the event for future duplicate detection.
 */
export function isDuplicate(eventType: string, messageId: string | undefined): boolean {
  if (!messageId) return false;
  const key = `${eventType}:${messageId}`;

  // Prune expired entries when approaching max
  if (_dedupEntries.size > DEDUP_MAX) {
    const now = Date.now();
    for (const [k, ts] of _dedupEntries) {
      if (now - ts > DEDUP_TTL_MS) _dedupEntries.delete(k);
    }
    // Hard cap: remove oldest entries if still over limit after TTL pruning
    if (_dedupEntries.size > DEDUP_MAX) {
      const excess = _dedupEntries.size - DEDUP_MAX;
      const iter = _dedupEntries.keys();
      for (let i = 0; i < excess; i++) {
        const oldest = iter.next().value;
        if (oldest) _dedupEntries.delete(oldest);
      }
    }
  }

  if (_dedupEntries.has(key)) return true;
  _dedupEntries.set(key, Date.now());
  return false;
}

/**
 * Reset dedup state. For testing only.
 * DO NOT call in production code.
 */
export function _resetDedupForTesting(): void {
  _dedupEntries.clear();
}

/**
 * Get current dedup entries count. For testing only.
 */
export function _getDedupSizeForTesting(): number {
  return _dedupEntries.size;
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  CROSS-SESSION MESSAGE DEDUP — DO NOT CHANGE                       ║
// ║                                                                    ║
// ║  Prevents both bot and human sessions from processing the same     ║
// ║  inbound message. Bot sessions claim immediately. Human sessions   ║
// ║  defer 200ms, then check if a bot already claimed it.              ║
// ║                                                                    ║
// ║  This is SEPARATE from webhook dedup above (which deduplicates     ║
// ║  duplicate webhook deliveries within a single session).            ║
// ║  Cross-session dedup prevents double-processing and token waste    ║
// ║  when multiple sessions receive the same group message.            ║
// ║                                                                    ║
// ║  Bounded to CROSS_SESSION_MAX entries with TTL-based pruning.      ║
// ╚══════════════════════════════════════════════════════════════════════╝

interface ClaimedMessage {
  accountId: string;
  role: string;
  timestamp: number;
}

const _crossSessionCache = new Map<string, ClaimedMessage>();
const CROSS_SESSION_TTL_MS = 60_000; // 1 minute
const CROSS_SESSION_MAX = 500;

/**
 * Claim a message for a specific session/account.
 * Records that this accountId (with given role) is processing this messageId.
 * Prunes expired entries when cache exceeds max size.
 *
 * DO NOT CHANGE — cross-session dedup prevents double-processing and token waste.
 */
export function claimMessage(messageId: string, accountId: string, role: string): void {
  const now = Date.now();
  // Prune old entries when approaching max (same pattern as webhook dedup)
  if (_crossSessionCache.size > CROSS_SESSION_MAX) {
    for (const [key, val] of _crossSessionCache) {
      if (now - val.timestamp > CROSS_SESSION_TTL_MS) _crossSessionCache.delete(key);
    }
  }
  _crossSessionCache.set(messageId, { accountId, role, timestamp: now });
}

/**
 * Check if a message was already claimed by a DIFFERENT session.
 * Returns true if another accountId claimed it (within TTL).
 * Returns false if unclaimed, expired, or claimed by the same account.
 *
 * DO NOT CHANGE — cross-session dedup prevents double-processing and token waste.
 */
export function isClaimedByOtherSession(messageId: string, myAccountId: string): boolean {
  const entry = _crossSessionCache.get(messageId);
  if (!entry) return false;
  if (Date.now() - entry.timestamp > CROSS_SESSION_TTL_MS) {
    _crossSessionCache.delete(messageId);
    return false;
  }
  return entry.accountId !== myAccountId;
}

/**
 * Check if a message was claimed by a bot session specifically.
 * Used by human sessions to defer to bot processing.
 * Returns true if a bot-role session claimed it (within TTL).
 *
 * DO NOT CHANGE — cross-session dedup prevents double-processing and token waste.
 */
export function isClaimedByBotSession(messageId: string): boolean {
  const entry = _crossSessionCache.get(messageId);
  if (!entry) return false;
  if (Date.now() - entry.timestamp > CROSS_SESSION_TTL_MS) {
    _crossSessionCache.delete(messageId);
    return false;
  }
  return entry.role === "bot";
}

/**
 * Reset cross-session dedup state. For testing only.
 * DO NOT call in production code.
 */
export function _resetCrossSessionDedupForTesting(): void {
  _crossSessionCache.clear();
}

/**
 * Get current cross-session cache size. For testing only.
 */
export function _getCrossSessionSizeForTesting(): number {
  return _crossSessionCache.size;
}
