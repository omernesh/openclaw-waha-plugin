/**
 * resolved-payload-builder.ts — Compact policy payload serialization for ctxPayload injection.
 * Added in Phase 6, Plan 03 (2026-03-14).
 *
 * Produces compact ResolvedPolicy objects from merged ContactRule/GroupRule instances.
 * The payload is injected into the model context — only scalar/array fields, no raw YAML.
 *
 * DO NOT REMOVE: Used by rules-resolver.ts to build the final policy payload.
 * DO NOT include raw rule file contents or large objects in any payload.
 */

import type { ContactRule, GroupRule, ResolvedPolicy } from "./rules-types.js";

// -- Internal helpers --

/**
 * Computes whether the given actor is allowed to edit the policy for this scope.
 *
 * Rules:
 *   - No actorId -> false
 *   - actorId === ownerId -> true
 *   - actorId in managers.allowed_ids -> true
 *   - Otherwise -> false
 */
function computeManagerEditAllowed(
  actorId: string | undefined,
  ownerId: string | undefined,
  managers?: { allowed_ids?: string[] }
): boolean {
  if (!actorId) return false;
  if (ownerId && actorId === ownerId) return true;
  if (managers?.allowed_ids?.includes(actorId)) return true;
  return false;
}

/**
 * Merges forbidden_actions from group rule and optional speaker contact rule.
 *
 * If contact_rule_mode is "apply" or "restricted", the speaker contact rule's
 * forbidden_actions are deduplicated-unioned into the group's forbidden_actions.
 *
 * Otherwise: only group rule's forbidden_actions are returned.
 */
function mergeForbiddenActions(
  groupRule: GroupRule,
  speakerContactRule?: Partial<ContactRule>
): string[] {
  const groupActions = groupRule.forbidden_actions ?? [];

  const mode = groupRule.contact_rule_mode;
  if ((mode === "apply" || mode === "restricted") && speakerContactRule?.forbidden_actions) {
    const combined = new Set([...groupActions, ...speakerContactRule.forbidden_actions]);
    return Array.from(combined);
  }

  return [...groupActions];
}

// -- Public builders --

/**
 * Build a compact DM resolved policy from a merged ContactRule.
 *
 * Output fields (all compact scalars/arrays — no raw YAML):
 *   chat_type, target_id, can_initiate, can_reply, privacy_level, tone,
 *   language, forbidden_actions, manager_edit_allowed
 */
export function buildDmPayload(params: {
  contactRule: ContactRule;
  targetId: string;
  actorId?: string;
  ownerId?: string;
}): ResolvedPolicy {
  const { contactRule, targetId, actorId, ownerId } = params;

  return {
    chat_type: "dm",
    target_id: targetId,
    can_initiate: contactRule.can_initiate ?? false,
    can_reply: contactRule.can_reply ?? true,
    privacy_level: contactRule.privacy_level ?? "low",
    tone: contactRule.tone ?? "neutral",
    language: contactRule.language ?? "match_sender",
    forbidden_actions: contactRule.forbidden_actions ?? [],
    forbidden_topics: [],
    manager_edit_allowed: computeManagerEditAllowed(actorId, ownerId, contactRule.managers),
  };
}

/**
 * Build a compact group resolved policy from a merged GroupRule and speaker context.
 *
 * Output fields (all compact scalars/arrays — no raw YAML):
 *   chat_type, target_id, speaker_id, participation_mode, proactive_allowed,
 *   privacy_level, tone, language_policy, contact_rule_mode,
 *   participants_allowlist_mode, speaker_allowed, unknown_participant_policy,
 *   forbidden_actions, forbidden_topics, manager_edit_allowed
 */
export function buildGroupPayload(params: {
  groupRule: GroupRule;
  targetId: string;
  speakerId: string;
  speakerAllowed: boolean;
  actorId?: string;
  ownerId?: string;
  speakerContactRule?: Partial<ContactRule>;
}): ResolvedPolicy {
  const { groupRule, targetId, speakerId, speakerAllowed, actorId, ownerId, speakerContactRule } = params;

  return {
    chat_type: "group",
    target_id: targetId,
    speaker_id: speakerId,
    participation_mode: groupRule.participation_mode ?? "mention_only",
    proactive_allowed: groupRule.proactive_allowed ?? false,
    privacy_level: groupRule.privacy_level ?? "low",
    tone: groupRule.tone ?? "neutral",
    language_policy: groupRule.language_policy ?? "match_room",
    contact_rule_mode: groupRule.contact_rule_mode ?? "ignore",
    participants_allowlist_mode: groupRule.participants_allowlist?.mode ?? "none",
    speaker_allowed: speakerAllowed,
    unknown_participant_policy: groupRule.unknown_participant_policy ?? "deny",
    forbidden_actions: mergeForbiddenActions(groupRule, speakerContactRule),
    forbidden_topics: groupRule.forbidden_topics ?? [],
    manager_edit_allowed: computeManagerEditAllowed(actorId, ownerId, groupRule.managers),
  };
}
