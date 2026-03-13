/**
 * rules-resolver.ts — Policy resolution orchestration for the WhatsApp Rules System.
 * Added in Phase 6, Plan 03 (2026-03-14).
 *
 * This is the core intelligence of the rules system — it decides WHAT policy applies
 * to a given event by loading, merging, and caching rule files.
 *
 * Resolution is lazy: only loads files needed for the specific event.
 * All functions are non-throwing: errors produce null (non-fatal degradation).
 *
 * DO NOT REMOVE: Used by inbound handler (Plan 04) to inject context into model turns.
 *
 * Algorithms follow resolver-algorithm.md sections A (DM), B (Group), C/D (Outbound).
 */

import * as fs from "fs";
import {
  loadDefaultContactRule,
  loadContactRule,
  loadDefaultGroupRule,
  loadGroupRule,
} from "./rules-loader.js";
import { normalizeToStableId, findOverrideFile } from "./identity-resolver.js";
import { mergeRuleLayers } from "./rules-merge.js";
import { policyCache } from "./policy-cache.js";
import { buildDmPayload, buildGroupPayload } from "./resolved-payload-builder.js";
import type { ContactRule, GroupRule, ResolvedPolicy } from "./rules-types.js";
import { SYSTEM_CONTACT_DEFAULTS } from "./rules-types.js";

// -- Internal helpers --

/**
 * Get the mtime of a file, or 0 if the file doesn't exist.
 * Used as cache key component — different mtime = natural cache miss.
 */
function getMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Compute a combined mtime for a scope — max of all files that contribute to it.
 * This ensures a cache miss when ANY contributing file changes.
 */
function combinedMtime(...mtimes: number[]): number {
  return Math.max(...mtimes, 0);
}

// -- DM / Contact Resolution (Flow A from resolver-algorithm.md) --

/**
 * Resolve the effective contact policy for a DM chat.
 *
 * Flow:
 *   1. Normalize chatId to stable ID.
 *   2. Find override file path; get mtime of default + override.
 *   3. Check policyCache — return if hit.
 *   4. Load global default + optional override.
 *   5. Merge layers.
 *   6. Build compact DM payload.
 *   7. Cache and return.
 *
 * @param params.chatId   - Raw WAHA JID of the contact (sender or DM target)
 * @param params.basePath - Rules base directory
 * @param params.safeName - Optional human-readable name prefix for override files
 */
export async function resolveContactPolicy(params: {
  chatId: string;
  basePath: string;
  safeName?: string;
}): Promise<ResolvedPolicy> {
  const { chatId, basePath, safeName } = params;
  const stableId = normalizeToStableId(chatId);

  // File paths
  const defaultFilePath = `${basePath}/contacts/_default.yaml`;
  const overrideFilePath = findOverrideFile(basePath, "contacts", stableId, safeName);

  // Combined mtime for cache key
  const mtime = combinedMtime(getMtime(defaultFilePath), getMtime(overrideFilePath));

  // Cache check
  const cached = policyCache.get(stableId, mtime);
  if (cached) return cached;

  // Load global default
  const globalDefault = loadDefaultContactRule(basePath);

  // Load override (null if missing or malformed — graceful degradation)
  const override = fs.existsSync(overrideFilePath) ? loadContactRule(overrideFilePath) : null;

  // Merge layers: [globalDefault, override]
  const merged = mergeRuleLayers<ContactRule>([globalDefault, override]);
  const effective: ContactRule = { ...SYSTEM_CONTACT_DEFAULTS, ...merged };

  // Build payload
  const policy = buildDmPayload({ contactRule: effective, targetId: stableId });

  // Cache
  policyCache.set(stableId, mtime, policy);
  return policy;
}

// -- Group Resolution (Flow B from resolver-algorithm.md) --

/**
 * Resolve the effective group policy for a group message event.
 *
 * Flow:
 *   1. Normalize group chatId and senderId to stable IDs.
 *   2. Load global group default + optional group override; merge.
 *   3. Evaluate participants_allowlist to determine speaker_allowed.
 *   4. For unknown speakers: evaluate unknown_participant_policy.
 *   5. Evaluate contact_rule_mode to decide if speaker contact policy is loaded.
 *   6. Build compact group payload.
 *   7. Cache and return.
 *
 * @param params.chatId   - Raw WAHA JID of the group (@g.us)
 * @param params.senderId - Raw WAHA JID of the message sender
 * @param params.basePath - Rules base directory
 */
export async function resolveGroupPolicy(params: {
  chatId: string;
  senderId: string;
  basePath: string;
  safeName?: string;
  senderSafeName?: string;
}): Promise<ResolvedPolicy> {
  const { chatId, senderId, basePath, safeName, senderSafeName } = params;

  const stableGroupId = normalizeToStableId(chatId);
  const stableSenderId = senderId ? normalizeToStableId(senderId) : "";

  // File paths
  const groupDefaultPath = `${basePath}/groups/_default.yaml`;
  const groupOverridePath = findOverrideFile(basePath, "groups", stableGroupId, safeName);

  const mtime = combinedMtime(getMtime(groupDefaultPath), getMtime(groupOverridePath));

  // Cache check (group scope, keyed by group ID)
  const cacheKey = `${stableGroupId}:${stableSenderId}`;
  const cached = policyCache.get(cacheKey, mtime);
  if (cached) return cached;

  // Load and merge group rule
  const globalGroupDefault = loadDefaultGroupRule(basePath);
  const groupOverride = fs.existsSync(groupOverridePath) ? loadGroupRule(groupOverridePath) : null;
  const mergedGroup = mergeRuleLayers<GroupRule>([globalGroupDefault, groupOverride]);
  const effectiveGroup: GroupRule = { ...globalGroupDefault, ...mergedGroup };

  // -- Step 3: Evaluate participants_allowlist --
  const allowlist = effectiveGroup.participants_allowlist ?? { mode: "none", ids: [], aliases: [] };
  let speakerAllowed: boolean;
  let isKnownParticipant = false;

  switch (allowlist.mode) {
    case "everyone":
      speakerAllowed = true;
      isKnownParticipant = true;
      break;
    case "none":
      speakerAllowed = false;
      isKnownParticipant = false;
      break;
    case "explicit": {
      // Check if sender's stable ID is in the allowlist
      const normalizedIds = (allowlist.ids ?? []).map((id) => normalizeToStableId(id));
      isKnownParticipant = normalizedIds.includes(stableSenderId);
      speakerAllowed = isKnownParticipant;
      break;
    }
    case "admins":
      // v1: treat admins mode as "none" (admin list requires WAHA call, not supported here)
      speakerAllowed = false;
      isKnownParticipant = false;
      break;
    default:
      speakerAllowed = false;
      isKnownParticipant = false;
  }

  // -- Step 4: Evaluate unknown_participant_policy (only when speaker is not in allowlist) --
  let participationModeOverride: string | undefined;

  if (!isKnownParticipant) {
    const unknownPolicy = effectiveGroup.unknown_participant_policy ?? "deny";
    switch (unknownPolicy) {
      case "deny":
        speakerAllowed = false;
        break;
      case "observe_only":
        speakerAllowed = true;
        participationModeOverride = "silent_observer";
        break;
      case "fallback_to_global_contact": {
        // Load contact global default to determine trust_level
        const contactDefault = loadDefaultContactRule(basePath);
        // trust_level != "blocked" => allowed
        speakerAllowed = contactDefault.trust_level !== "blocked";
        break;
      }
      default:
        speakerAllowed = false;
    }
  }

  // Apply participation_mode override from observe_only policy
  if (participationModeOverride) {
    (effectiveGroup as GroupRule).participation_mode = participationModeOverride as GroupRule["participation_mode"];
  }

  // -- Step 5: Evaluate contact_rule_mode --
  let speakerContactRule: Partial<ContactRule> | undefined;
  const contactRuleMode = effectiveGroup.contact_rule_mode ?? "ignore";

  if (contactRuleMode === "apply" || contactRuleMode === "restricted") {
    // Load speaker's contact policy (global default + override)
    const contactDefault = loadDefaultContactRule(basePath);
    const contactOverridePath = findOverrideFile(basePath, "contacts", stableSenderId, senderSafeName);
    const contactOverride = fs.existsSync(contactOverridePath)
      ? loadContactRule(contactOverridePath)
      : null;

    const mergedContact = mergeRuleLayers<ContactRule>([contactDefault, contactOverride]);
    const effectiveContact: ContactRule = { ...contactDefault, ...mergedContact };

    if (contactRuleMode === "apply") {
      // Full merge: all fields from speaker contact policy
      speakerContactRule = effectiveContact;
    } else {
      // restricted: only trust_level and forbidden_actions
      speakerContactRule = {
        trust_level: effectiveContact.trust_level,
        forbidden_actions: effectiveContact.forbidden_actions,
      };
    }
  }

  // -- Step 6: Build payload --
  const policy = buildGroupPayload({
    groupRule: effectiveGroup,
    targetId: stableGroupId,
    speakerId: stableSenderId,
    speakerAllowed,
    speakerContactRule,
  });

  // Cache and return
  policyCache.set(cacheKey, mtime, policy);
  return policy;
}

// -- Dispatcher (resolveInboundPolicy) --

/**
 * Dispatch to DM or group resolver based on event type.
 *
 * Wraps in try/catch — returns null on any error (non-fatal, logs warning).
 *
 * @param params.isGroup  - True for group messages, false for DMs
 * @param params.chatId   - Raw WAHA chat JID
 * @param params.senderId - Raw WAHA sender JID (used for DMs: sender = contact)
 * @param params.basePath - Rules base directory
 */
export async function resolveInboundPolicy(params: {
  isGroup: boolean;
  chatId: string;
  senderId: string;
  basePath: string;
}): Promise<ResolvedPolicy | null> {
  const { isGroup, chatId, senderId, basePath } = params;

  try {
    if (isGroup) {
      return await resolveGroupPolicy({ chatId, senderId, basePath });
    } else {
      // For DM: the sender IS the contact (not the chatId, which may differ from sender in some systems)
      return await resolveContactPolicy({ chatId: senderId, basePath });
    }
  } catch (err) {
    console.warn("[waha] rules resolution failed:", err);
    return null;
  }
}

// -- Outbound resolver --

/**
 * Resolve the effective policy for an outbound event (send/initiate).
 *
 * Detects group vs. contact target by @g.us suffix.
 * For group outbound: senderId = "" (no speaker for outbound context).
 *
 * Returns null on error (non-fatal).
 */
export async function resolveOutboundPolicy(params: {
  chatId: string;
  basePath: string;
}): Promise<ResolvedPolicy | null> {
  const { chatId, basePath } = params;

  try {
    const normalized = chatId.trim().toLowerCase();
    if (normalized.endsWith("@g.us")) {
      return await resolveGroupPolicy({ chatId, senderId: "", basePath });
    } else {
      return await resolveContactPolicy({ chatId, basePath });
    }
  } catch (err) {
    console.warn("[waha] rules outbound resolution failed:", err);
    return null;
  }
}
