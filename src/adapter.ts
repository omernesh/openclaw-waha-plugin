// ╔══════════════════════════════════════════════════════════════════════╗
// ║  PlatformAdapter — DO NOT CHANGE                                     ║
// ║                                                                     ║
// ║  Defines the contract for messaging platform integrations.          ║
// ║  WahaPlatformAdapter implements it by delegating to send.ts.        ║
// ║                                                                     ║
// ║  Purpose: Decouples channel.ts from WAHA-specific implementation.  ║
// ║  Swapping transport = new adapter class only, no channel.ts edits. ║
// ║                                                                     ║
// ║  Created: Phase 32, Plan 02 (2026-03-20).                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  sendWahaText,
  sendWahaMediaBatch,
  sendWahaPoll,
  sendWahaReaction,
  editWahaMessage,
  deleteWahaMessage,
  pinWahaMessage,
  unpinWahaMessage,
  setWahaPresenceStatus,
  getWahaPresence,
  getWahaGroups,
  getWahaGroupParticipants,
  getWahaContacts,
  getWahaContact,
} from "./send.js";
import type { CoreConfig } from "./types.js";

// ---------------------------------------------------------------------------
// PlatformAdapter interface
// ---------------------------------------------------------------------------

/**
 * Minimal interface covering the core messaging operations that channel.ts
 * dispatches through the ChannelMessageActionAdapter.
 *
 * Kept PRACTICAL — only operations needed for core send/receive dispatch.
 * WAHA-specific extras (group management, labels, etc.) remain on
 * WahaPlatformAdapter and are accessed via direct imports in channel.ts.
 */
export interface PlatformAdapter {
  // Core messaging
  sendText(params: { to: string; text: string; accountId?: string; replyToId?: string }): Promise<{ id: string }>;
  sendMedia(params: { to: string; mediaUrls: string[]; caption?: string; accountId?: string; replyToId?: string }): Promise<void>;
  sendPoll(params: { to: string; question: string; options: string[]; multipleAnswers?: boolean; accountId?: string }): Promise<{ id: string }>;
  sendReaction(params: { messageId: string; reaction: string; accountId?: string }): Promise<void>;

  // Message management
  editMessage(params: { chatId: string; messageId: string; text: string; accountId?: string }): Promise<void>;
  deleteMessage(params: { chatId: string; messageId: string; accountId?: string }): Promise<void>;
  pinMessage(params: { chatId: string; messageId: string; accountId?: string }): Promise<void>;
  unpinMessage(params: { chatId: string; messageId: string; accountId?: string }): Promise<void>;

  // Presence
  setPresence(params: { status: "online" | "offline"; accountId?: string }): Promise<void>;
  getPresence(params: { contactId: string; accountId?: string }): Promise<any>;

  // Groups
  getGroups(params: { accountId?: string }): Promise<any[]>;
  getGroupParticipants(params: { groupId: string; accountId?: string }): Promise<any[]>;

  // Contacts
  getContacts(params: { accountId?: string }): Promise<any[]>;
  getContact(params: { contactId: string; accountId?: string }): Promise<any>;
}

// ---------------------------------------------------------------------------
// WahaPlatformAdapter
// ---------------------------------------------------------------------------

/**
 * WAHA implementation of PlatformAdapter.
 * Delegates to send.ts functions — no business logic here.
 */
export class WahaPlatformAdapter implements PlatformAdapter {
  private readonly cfg: CoreConfig;

  constructor(opts: { cfg: CoreConfig }) {
    this.cfg = opts.cfg;
  }

  // Core messaging

  async sendText(params: { to: string; text: string; accountId?: string; replyToId?: string }): Promise<{ id: string }> {
    const result = await sendWahaText({
      cfg: this.cfg,
      to: params.to,
      text: params.text,
      accountId: params.accountId,
      replyToId: params.replyToId,
    });
    return { id: (result as any)?.key?.id ?? "" };
  }

  async sendMedia(params: { to: string; mediaUrls: string[]; caption?: string; accountId?: string; replyToId?: string }): Promise<void> {
    await sendWahaMediaBatch({
      cfg: this.cfg,
      to: params.to,
      mediaUrls: params.mediaUrls,
      caption: params.caption,
      accountId: params.accountId,
      replyToId: params.replyToId,
    });
  }

  async sendPoll(params: { to: string; question: string; options: string[]; multipleAnswers?: boolean; accountId?: string }): Promise<{ id: string }> {
    const result = await sendWahaPoll({
      cfg: this.cfg,
      chatId: params.to,
      name: params.question,
      options: params.options,
      multipleAnswers: params.multipleAnswers,
      accountId: params.accountId,
    });
    return { id: (result as any)?.key?.id ?? "" };
  }

  async sendReaction(params: { messageId: string; reaction: string; accountId?: string }): Promise<void> {
    await sendWahaReaction({
      cfg: this.cfg,
      messageId: params.messageId,
      emoji: params.reaction,
      accountId: params.accountId,
    });
  }

  // Message management

  async editMessage(params: { chatId: string; messageId: string; text: string; accountId?: string }): Promise<void> {
    await editWahaMessage({
      cfg: this.cfg,
      chatId: params.chatId,
      messageId: params.messageId,
      text: params.text,
      accountId: params.accountId,
    });
  }

  async deleteMessage(params: { chatId: string; messageId: string; accountId?: string }): Promise<void> {
    await deleteWahaMessage({
      cfg: this.cfg,
      chatId: params.chatId,
      messageId: params.messageId,
      accountId: params.accountId,
    });
  }

  async pinMessage(params: { chatId: string; messageId: string; accountId?: string }): Promise<void> {
    await pinWahaMessage({
      cfg: this.cfg,
      chatId: params.chatId,
      messageId: params.messageId,
      accountId: params.accountId,
    });
  }

  async unpinMessage(params: { chatId: string; messageId: string; accountId?: string }): Promise<void> {
    await unpinWahaMessage({
      cfg: this.cfg,
      chatId: params.chatId,
      messageId: params.messageId,
      accountId: params.accountId,
    });
  }

  // Presence

  async setPresence(params: { status: "online" | "offline"; accountId?: string }): Promise<void> {
    await setWahaPresenceStatus({
      cfg: this.cfg,
      status: params.status,
      accountId: params.accountId,
    });
  }

  async getPresence(params: { contactId: string; accountId?: string }): Promise<any> {
    return getWahaPresence({
      cfg: this.cfg,
      contactId: params.contactId,
      accountId: params.accountId,
    });
  }

  // Groups

  async getGroups(params: { accountId?: string }): Promise<any[]> {
    return getWahaGroups({
      cfg: this.cfg,
      accountId: params.accountId,
    });
  }

  async getGroupParticipants(params: { groupId: string; accountId?: string }): Promise<any[]> {
    return getWahaGroupParticipants({
      cfg: this.cfg,
      groupId: params.groupId,
      accountId: params.accountId,
    });
  }

  // Contacts

  async getContacts(params: { accountId?: string }): Promise<any[]> {
    return getWahaContacts({
      cfg: this.cfg,
      accountId: params.accountId,
    });
  }

  async getContact(params: { contactId: string; accountId?: string }): Promise<any> {
    return getWahaContact({
      cfg: this.cfg,
      contactId: params.contactId,
      accountId: params.accountId,
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a PlatformAdapter for the given config.
 * Returns a WahaPlatformAdapter — the only implementation for now.
 */
export function createPlatformAdapter(cfg: CoreConfig): PlatformAdapter {
  return new WahaPlatformAdapter({ cfg });
}
