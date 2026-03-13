/**
 * rules-types.ts — TypeScript types and zod schemas for the WhatsApp Rules and Policy System.
 * Added in Phase 6, Plan 01 (2026-03-13).
 *
 * DO NOT REMOVE: These types are the contract for all rules system modules.
 * All schemas use .partial() / .optional() so files can be sparse overrides —
 * absence of a field means "inherit from lower precedence layer".
 */

import { z } from "zod";

// -- Sub-schemas --

const ManagersSchema = z.object({
  allowed_ids: z.array(z.string()).optional().default([]),
  owner_only_appoint_revoke: z.boolean().optional().default(true),
});

const ParticipantsAllowlistSchema = z.object({
  mode: z.enum(["everyone", "none", "explicit", "admins"]).optional().default("none"),
  ids: z.array(z.string()).optional().default([]),
  aliases: z.array(z.string()).optional().default([]),
});

export const IdentitySchema = z.object({
  id: z.string().optional(),
  aliases: z.array(z.string()).optional().default([]),
  display_name: z.string().optional(),
});

// -- Contact Rule Schema --
// All fields are optional — supports sparse override files.
// Validated via ContactRuleSchema.safeParse() in rules-loader.ts.
// DO NOT add .strict() here — future fields should not break existing files.

export const ContactRuleSchema = z.object({
  enabled: z.boolean().optional(),
  identity: IdentitySchema.optional(),
  trust_level: z.enum(["blocked", "low", "normal", "trusted", "owner"]).optional(),
  privacy_level: z.enum(["none", "low", "limited", "trusted", "full"]).optional(),
  can_initiate: z.boolean().optional(),
  can_reply: z.boolean().optional(),
  can_use_memory: z.boolean().optional(),
  can_reference_calendar: z.boolean().optional(),
  tone: z.enum(["neutral", "casual", "warm", "professional", "blunt"]).optional(),
  language: z.enum(["match_sender", "he", "en"]).optional(),
  allowed_triggers: z.array(z.string()).optional(),
  forbidden_actions: z.array(z.string()).optional(),
  managers: ManagersSchema.optional(),
  notes: z.array(z.string()).optional(),
});

export type ContactRule = z.infer<typeof ContactRuleSchema>;

// -- Group Rule Schema --
// All fields are optional — supports sparse override files.
// DO NOT add .strict() here — future fields should not break existing files.

export const GroupRuleSchema = z.object({
  enabled: z.boolean().optional(),
  identity: IdentitySchema.optional(),
  group_type: z.enum(["family", "friends", "work", "client", "community", "ops", "mixed", "other"]).optional(),
  participation_mode: z
    .enum([
      "silent_observer",
      "mention_only",
      "trigger_word_only",
      "direct_question_only",
      "allowed_participants_only",
      "open",
    ])
    .optional(),
  proactive_allowed: z.boolean().optional(),
  who_can_trigger_me: z
    .enum(["everyone", "managers_only", "allowed_participants_only", "owner_only", "none"])
    .optional(),
  participants_allowlist: ParticipantsAllowlistSchema.optional(),
  unknown_participant_policy: z
    .enum(["fallback_to_global_contact", "deny", "observe_only"])
    .optional(),
  privacy_level: z.enum(["none", "low", "limited", "trusted", "full"]).optional(),
  tone: z.enum(["neutral", "casual", "warm", "professional", "blunt"]).optional(),
  language_policy: z.enum(["match_room", "match_sender", "he", "en"]).optional(),
  allowed_topics: z.array(z.string()).optional(),
  forbidden_topics: z.array(z.string()).optional(),
  contact_rule_mode: z.enum(["apply", "ignore", "restricted"]).optional(),
  managers: ManagersSchema.optional(),
  notes: z.array(z.string()).optional(),
});

export type GroupRule = z.infer<typeof GroupRuleSchema>;

// -- Resolved Policy Output Type --
// This is an output type (not zod-validated) — produced by the rules resolver.
// Carries the effective policy for a single message event.
// DO NOT REMOVE: Used by the policy resolver (Plan 02) and enforcer (Plan 03).

export type ResolvedPolicy = {
  chat_type: "dm" | "group";
  target_id: string;
  speaker_id?: string;
  can_initiate?: boolean;
  can_reply?: boolean;
  participation_mode?: string;
  proactive_allowed?: boolean;
  privacy_level: string;
  tone: string;
  language?: string;
  language_policy?: string;
  contact_rule_mode?: string;
  participants_allowlist_mode?: string;
  speaker_allowed?: boolean;
  unknown_participant_policy?: string;
  forbidden_actions: string[];
  forbidden_topics: string[];
  manager_edit_allowed?: boolean;
};

// -- System Hardcoded Defaults --
// These are the fallback values used when _default.yaml files are missing or malformed.
// They match the schema defaults in whatsapp-rules-schema.yaml exactly.
// DO NOT CHANGE without updating the seed YAML files and schema documentation.

export const SYSTEM_CONTACT_DEFAULTS: Required<Omit<ContactRule, "identity">> = {
  enabled: true,
  trust_level: "normal",
  privacy_level: "low",
  can_initiate: false,
  can_reply: true,
  can_use_memory: false,
  can_reference_calendar: false,
  tone: "neutral",
  language: "match_sender",
  allowed_triggers: [],
  forbidden_actions: [],
  managers: { allowed_ids: [], owner_only_appoint_revoke: true },
  notes: [],
};

export const SYSTEM_GROUP_DEFAULTS: Required<Omit<GroupRule, "identity">> = {
  enabled: true,
  group_type: "other",
  participation_mode: "mention_only",
  proactive_allowed: false,
  who_can_trigger_me: "none",
  participants_allowlist: { mode: "none", ids: [], aliases: [] },
  unknown_participant_policy: "fallback_to_global_contact",
  privacy_level: "low",
  tone: "neutral",
  language_policy: "match_room",
  allowed_topics: [],
  forbidden_topics: [],
  contact_rule_mode: "restricted",
  managers: { allowed_ids: [], owner_only_appoint_revoke: true },
  notes: [],
};

// -- Owner Constant --
// The owner has super-admin authority over all scopes.
// DO NOT CHANGE: This is Omer's canonical stable ID. Verified 2026-03-13.

export const OWNER_ID = "@c:972544329000@c.us";
