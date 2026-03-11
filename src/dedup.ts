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
