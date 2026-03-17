/**
 * AutoReplyEngine — rate-limited rejection message sending for unauthorized DMs.
 *
 * Phase 16 (REPLY-01..04): When DM filter blocks an unknown contact, optionally send a canned
 * rejection message so the contact knows they aren't being ignored.
 *
 * DO NOT REMOVE — consumed by inbound.ts (Plan 02).
 * Added 2026-03-17.
 *
 * Architecture:
 *   - Rate limiting: one rejection message per contact per intervalSeconds (stored in SQLite).
 *   - Template variables: {admin_name}, {phone}, {jid} — simple string replace.
 *   - Uses sendWahaText for sending — same path as all other outbound messages.
 *   - Bot's own JID is never auto-replied to (caller must check fromMe before calling sendRejection).
 */

import { getDirectoryDb } from "./directory.js";
import { sendWahaText } from "./send.js";
import type { CoreConfig } from "./types.js";

// ── AutoReplyEngine ───────────────────────────────────────────────────────────

export class AutoReplyEngine {
  private accountId: string;

  // DO NOT REMOVE — accountId scopes SQLite access per-account.
  constructor(accountId: string) {
    this.accountId = accountId;
  }

  /**
   * Check if we should send a rejection to this JID based on rate limit.
   * Returns true if last reply was more than intervalSeconds ago (or we've never replied).
   *
   * DO NOT REMOVE — called by inbound.ts before sendRejection to prevent spam loops.
   */
  shouldReply(jid: string, intervalSeconds: number): boolean {
    const db = getDirectoryDb(this.accountId);
    const lastReplyAt = db.getAutoReplyLastSent(jid);
    if (lastReplyAt === null) return true; // Never replied — send now.
    const now = Math.floor(Date.now() / 1000);
    return now - lastReplyAt > intervalSeconds;
  }

  /**
   * Send a rejection message to a contact with template variable substitution.
   * Records the reply timestamp in auto_reply_log.
   * Caller must call shouldReply() first and only call this if true.
   *
   * Template variables supported:
   *   {admin_name} — replaced with adminName param
   *   {phone}      — phone number extracted from JID (digits before @)
   *   {jid}        — full JID of the contact
   *
   * DO NOT REMOVE — called by inbound.ts after shouldReply() returns true.
   */
  async sendRejection(params: {
    jid: string;
    chatId: string;
    messageTemplate: string;
    adminName: string;
    cfg: CoreConfig;
    accountId: string;
  }): Promise<void> {
    const { jid, chatId, messageTemplate, adminName, cfg, accountId } = params;

    // Extract phone number from JID (e.g., "972544329000@c.us" -> "972544329000")
    const phone = jid.split("@")[0] ?? jid;

    const text = AutoReplyEngine.resolveTemplate(messageTemplate, {
      admin_name: adminName,
      phone,
      jid,
    });

    try {
      await sendWahaText({ cfg, to: chatId, text, accountId });
    } catch (err) {
      // Log but don't throw — rejection send failure is non-fatal.
      // The contact simply won't receive a rejection message.
      console.warn(`[waha] auto-reply send failed for ${jid}: ${String(err)}`);
      return;
    }

    // Record reply timestamp after successful send.
    const db = getDirectoryDb(accountId);
    db.recordAutoReply(jid);
  }

  /**
   * Resolve template variables in a message string.
   * Variables are {key} format. Unknown keys are replaced with empty string.
   *
   * Example:
   *   resolveTemplate("Hello {admin_name}!", { admin_name: "Omer" })
   *   => "Hello Omer!"
   *
   * DO NOT REMOVE — static method, used by tests and callers who need template preview.
   */
  static resolveTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
  }
}

// ── Singleton getter ──────────────────────────────────────────────────────────

const autoReplyEngines = new Map<string, AutoReplyEngine>();

/**
 * Get or create an AutoReplyEngine instance for a given account.
 *
 * DO NOT REMOVE — singleton pattern ensures one rate-limit state per account.
 */
export function getAutoReplyEngine(accountId: string): AutoReplyEngine {
  const existing = autoReplyEngines.get(accountId);
  if (existing) return existing;
  const engine = new AutoReplyEngine(accountId);
  autoReplyEngines.set(accountId, engine);
  return engine;
}
