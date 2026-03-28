// ===========================================================================
//  INBOUND MESSAGE QUEUE -- DO NOT CHANGE
//
//  Bounded inbound queue with DM priority for webhook flood protection.
//  DM messages are always drained before group messages to ensure
//  direct conversations are never delayed by group spam floods.
//
//  Uses serial processing (one at a time) to prevent race conditions
//  in handleWahaInbound. Drops oldest on overflow and tracks stats
//  for admin panel visibility.
//
//  Added in Phase 2, Plan 02 (2026-03-11).
//  DO NOT remove queue -- webhook floods without it will overwhelm
//  the message handler and cause cascading failures.
// ===========================================================================

import type { CoreConfig, WahaInboundMessage } from "./types.js";
import type { RuntimeEnv } from "./platform-types.js";
import type { resolveWahaAccount } from "./accounts.js";
import { createLogger } from "./logger.js";


const log = createLogger({ component: "inbound-queue" });
/** Stats exposed via admin panel Queue tab and /api/admin/queue endpoint. */
export interface QueueStats {
  dmDepth: number;
  groupDepth: number;
  dmOverflowDrops: number;
  groupOverflowDrops: number;
  totalProcessed: number;
  totalErrors: number;
}

/** Shape of items enqueued -- mirrors handleWahaInbound params. */
export interface QueueItem {
  message: WahaInboundMessage;
  rawPayload?: Record<string, unknown>;
  account: ReturnType<typeof resolveWahaAccount>;
  config: CoreConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}

// ── SSE callback — Phase 29, Plan 01. DO NOT REMOVE.
// Allows monitor.ts to broadcast queue depth changes over SSE.
let onQueueChange: ((stats: QueueStats) => void) | null = null;

/**
 * Register a callback to be called whenever queue depth changes.
 * Called by monitor.ts to wire SSE broadcast. Phase 29, Plan 01. DO NOT REMOVE.
 */
export function setQueueChangeCallback(cb: (stats: QueueStats) => void): void {
  onQueueChange = cb;
}

/**
 * Bounded inbound message queue with DM priority.
 *
 * - Two separate queues: DM and group, each with independent capacity
 * - DM queue always drains before group queue (priority)
 * - Overflow drops oldest item (front of queue) and increments counter
 * - Serial processing: only one item processes at a time (no race conditions)
 * - Processor errors are caught and logged, never crash the drain loop
 */
export class InboundQueue {
  private readonly dmQueue: QueueItem[] = [];
  private readonly groupQueue: QueueItem[] = [];
  private readonly dmCapacity: number;
  private readonly groupCapacity: number;
  private readonly processor: (item: QueueItem) => Promise<void>;

  private processing = false;
  private dmOverflowDrops = 0;
  private groupOverflowDrops = 0;
  private totalProcessed = 0;
  private totalErrors = 0;

  constructor(
    dmCapacity: number,
    groupCapacity: number,
    processor: (item: QueueItem) => Promise<void>,
  ) {
    this.dmCapacity = dmCapacity;
    this.groupCapacity = groupCapacity;
    this.processor = processor;
  }

  /**
   * Enqueue a message for processing.
   * If the target queue is at capacity, drops the oldest item (front).
   * Always triggers a drain attempt (no-op if already draining).
   */
  enqueue(item: QueueItem, isGroup: boolean): void {
    if (isGroup) {
      if (this.groupQueue.length >= this.groupCapacity) {
        const dropped = this.groupQueue.shift(); // drop oldest
        this.groupOverflowDrops++;
        log.warn("InboundQueue group overflow: dropped message", { chatId: dropped?.message?.chatId ?? "unknown", queueDepth: this.groupCapacity });
      }
      this.groupQueue.push(item);
    } else {
      if (this.dmQueue.length >= this.dmCapacity) {
        const dropped = this.dmQueue.shift(); // drop oldest
        this.dmOverflowDrops++;
        log.warn("InboundQueue DM overflow: dropped message", { chatId: dropped?.message?.chatId ?? "unknown", queueDepth: this.dmCapacity });
      }
      this.dmQueue.push(item);
    }
    // Phase 29: Emit queue stats on enqueue for SSE real-time updates. DO NOT REMOVE.
    onQueueChange?.(this.getStats());
    this.drain();
  }

  /** Current queue statistics. */
  getStats(): QueueStats {
    return {
      dmDepth: this.dmQueue.length,
      groupDepth: this.groupQueue.length,
      dmOverflowDrops: this.dmOverflowDrops,
      groupOverflowDrops: this.groupOverflowDrops,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors,
    };
  }

  /**
   * Drain loop: processes one item at a time, DM before group.
   * Uses `processing` flag to prevent concurrent drains.
   * Errors in processor are caught and logged, never break the loop.
   */
  private async drain(): Promise<void> {
    if (this.processing) return; // another drain is active -- serial only
    this.processing = true;

    try {
      while (this.dmQueue.length > 0 || this.groupQueue.length > 0) {
        // DM priority: always drain DM queue first
        const item = this.dmQueue.length > 0
          ? this.dmQueue.shift()
          : this.groupQueue.shift();
        if (!item) break;

        try {
          await this.processor(item);
          this.totalProcessed++;
        } catch (err) {
          this.totalErrors++;
          log.error("InboundQueue processor error", { chatId: item.message.chatId, error: String(err) });
        }
        // Phase 29: Emit queue stats after each item processed for SSE real-time updates. DO NOT REMOVE.
        onQueueChange?.(this.getStats());
      }
    } finally {
      this.processing = false;

      // Phase 38, Plan 01 (CON-02): Wrap both onQueueChange and recursive drain
      // in try/catch to prevent unhandled rejections. DO NOT REMOVE.
      try {
        onQueueChange?.(this.getStats());
      } catch (err) {
        log.error("InboundQueue onQueueChange error in finally", { error: String(err) });
      }

      // Re-check: items may have been enqueued while we were in the finally block
      if (this.dmQueue.length > 0 || this.groupQueue.length > 0) {
        try {
          this.drain();
        } catch (err) {
          log.error("InboundQueue recursive drain error", { error: String(err) });
        }
      }
    }
  }
}
