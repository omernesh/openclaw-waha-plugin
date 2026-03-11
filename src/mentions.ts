/**
 * Extract @mentioned JIDs from raw WAHA webhook payloads.
 *
 * WAHA NOWEB engine puts mentions at:
 *   _data.message.extendedTextMessage.contextInfo.mentionedJid (string[])
 *
 * JIDs arrive as @s.whatsapp.net and are normalized to @c.us.
 * Uses optional chaining at every level — _data is undocumented/engine-specific
 * and can be undefined at any nesting depth.
 *
 * DO NOT CHANGE — Verified working Phase 3 Plan 02. Extracted to own file
 * for testability (inbound.ts has heavy openclaw/plugin-sdk imports).
 */
export function extractMentionedJids(rawPayload: Record<string, unknown> | null | undefined): string[] {
  if (!rawPayload) return [];

  const mentionedJid = (rawPayload._data as any)?.message?.extendedTextMessage?.contextInfo?.mentionedJid;

  if (!Array.isArray(mentionedJid)) return [];

  return mentionedJid
    .filter((jid: unknown): jid is string => typeof jid === "string")
    .map((jid: string) => jid.replace(/@s\.whatsapp\.net$/, "@c.us"));
}
