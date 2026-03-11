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
import type { RuntimeEnv } from "openclaw/plugin-sdk";
import type { resolveWahaAccount } from "./accounts.js";

/** Stats exposed via admin panel Queue tab and /api/admin/queue endpoint. */
export interface QueueStats {
  dmDepth: number;
  groupDepth: number;
  dmOverflowDrops: number;
  groupOverflowDrops: number;
  totalProcessed: number;
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
        this.groupQueue.shift(); // drop oldest
        this.groupOverflowDrops++;
      }
      this.groupQueue.push(item);
    } else {
      if (this.dmQueue.length >= this.dmCapacity) {
        this.dmQueue.shift(); // drop oldest
        this.dmOverflowDrops++;
      }
      this.dmQueue.push(item);
    }
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
          ? this.dmQueue.shift()!
          : this.groupQueue.shift()!;

        try {
          await this.processor(item);
        } catch (err) {
          console.error(
            `[WAHA] InboundQueue processor error for ${item.message.chatId}: ${String(err)}`
          );
        }
        this.totalProcessed++;
      }
    } finally {
      this.processing = false;
    }
  }
}
