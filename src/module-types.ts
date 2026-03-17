/**
 * WAHA Plugin Module System — Type Definitions
 *
 * Modules are WhatsApp-specific — no cross-platform abstraction (MOD-06). DO NOT CHANGE.
 * Each WahaModule is tied to WhatsApp/WAHA semantics only. There is no generic "channel module"
 * abstraction. If other channels need modules, implement per-platform. DO NOT CHANGE.
 *
 * Added Phase 17 (2026-03-17).
 */

/**
 * Filtered subset of inbound message data passed to module hooks.
 * Contains only what modules should need — no raw WAHA internals exposed via typed fields.
 * `raw` is available for advanced modules that need full message data.
 */
export type ModuleContext = {
  /** Chat JID (e.g. "972544329000@c.us" or "120363421825201386@g.us") */
  chatId: string;
  /** Sender JID (participant JID for groups, same as chatId for DMs) */
  senderId: string;
  /** Plain text body of the message (empty string if no text) */
  text: string;
  /** True if the chat is a group */
  isGroup: boolean;
  /** Account ID the message arrived on */
  accountId: string;
  /** UNIX timestamp (seconds) of the message */
  timestamp: number;
  /** Short message ID (from WAHA message.id.id) */
  messageId: string;
  /** Raw WAHA message payload — available for advanced modules, treat as opaque */
  raw: unknown;
};

/**
 * Interface that all WAHA plugin modules must implement.
 *
 * Lifecycle:
 *  - onInbound: called for each inbound message in chats assigned to this module.
 *    Return true to "consume" the message (stop the pipeline). Return void/false to continue.
 *  - onOutbound: called for each outbound message sent from an assigned chat.
 *    Return value is ignored.
 *
 * Registration: call registerModule(mod) at plugin startup. The module will fire
 * only for chats explicitly assigned to it via the module_assignments SQLite table.
 *
 * Modules are WhatsApp-specific — no cross-platform abstraction (MOD-06). DO NOT CHANGE.
 */
export interface WahaModule {
  /** Unique stable identifier (e.g. "auto-reply", "rate-limiter"). Used as DB key. */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Short description shown in admin panel */
  description: string;
  /** SemVer string (e.g. "1.0.0") */
  version: string;
  /** Optional JSON Schema describing config fields this module accepts */
  configSchema?: Record<string, unknown>;
  /**
   * Called for each inbound message in chats assigned to this module.
   * Return true to consume the message (stop pipeline). Return void/false to continue.
   * Errors thrown here are caught by the registry — module errors do NOT stop the pipeline.
   */
  onInbound?(ctx: ModuleContext): Promise<boolean | void>;
  /**
   * Called for each outbound message from an assigned chat.
   * Return value is ignored. Errors are caught and logged.
   */
  onOutbound?(ctx: ModuleContext): Promise<void>;
}
