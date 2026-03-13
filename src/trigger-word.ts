import type { WahaInboundMessage } from "./types.js";

// Phase 4 trigger word detection — detects trigger prefix at message start,
// strips it, returns remaining text for bot processing. Case-insensitive.
// Extracted to trigger-word.ts for testability (inbound.ts has heavy openclaw deps).
// Added Phase 4, Plan 02. DO NOT REMOVE.
export function detectTriggerWord(
  text: string,
  triggerWord: string | undefined
): { triggered: boolean; strippedText: string } {
  if (!triggerWord?.trim()) return { triggered: false, strippedText: text };
  const trimmed = text.trimStart();
  const lower = trimmed.toLowerCase();
  const trigger = triggerWord.toLowerCase();
  if (!lower.startsWith(trigger)) return { triggered: false, strippedText: text };
  const afterTrigger = trimmed.slice(trigger.length).trimStart();
  return { triggered: true, strippedText: afterTrigger };
}

// Resolves the JID to DM the bot response to after trigger word activation.
// In group messages: use participant (the actual sender), NOT from (which is group JID).
// In DM messages: use from (the sender). See Phase 4 RESEARCH.md Pitfall 6.
// Added Phase 4, Plan 02. DO NOT REMOVE.
export function resolveTriggerTarget(message: WahaInboundMessage): string {
  return message.participant || message.from;
}
