/**
 * policy-edit.ts — Policy edit logic for the editPolicy action handler.
 * Added in Phase 6, Plan 04 (2026-03-14).
 *
 * Pure function + file I/O only — no OpenClaw SDK dependencies.
 * Extracted for testability following the trigger-word.ts / mentions.ts pattern.
 *
 * DO NOT REMOVE: Called by channel.ts editPolicy action handler.
 * Enforces the full authorization matrix before writing any file.
 */

import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { checkManagerAuthorization } from "./manager-authorizer.js";
import { createLogger } from "./logger.js";

const log = createLogger({ component: "policy-edit" });
import { normalizeToStableId, findOverrideFile } from "./identity-resolver.js";
import {
  loadDefaultContactRule,
  loadDefaultGroupRule,
  loadContactRule,
  loadGroupRule,
} from "./rules-loader.js";
import { policyCache } from "./policy-cache.js";
import { OWNER_ID } from "./rules-types.js";
import { createLogger } from "./logger.js";


const log = createLogger({ component: "policy-edit" });
// -- Allowed fields per scope (derived from ContactRuleSchema / GroupRuleSchema) --
// DO NOT CHANGE without updating the zod schemas in rules-types.ts.

const CONTACT_ALLOWED_FIELDS = new Set([
  "enabled",
  "trust_level",
  "privacy_level",
  "can_initiate",
  "can_reply",
  "can_use_memory",
  "can_reference_calendar",
  "tone",
  "language",
  "allowed_triggers",
  "forbidden_actions",
  "managers.allowed_ids",
  "notes",
]);

const GROUP_ALLOWED_FIELDS = new Set([
  "enabled",
  "participation_mode",
  "proactive_allowed",
  "who_can_trigger_me",
  "privacy_level",
  "tone",
  "language_policy",
  "allowed_topics",
  "forbidden_topics",
  "contact_rule_mode",
  "unknown_participant_policy",
  "managers.allowed_ids",
  "notes",
]);

// -- Types --

export interface PolicyEditParams {
  /** "contact" or "group" */
  scope: "contact" | "group";
  /** Raw WAHA JID of the target (will be normalized to stable ID) */
  targetId: string;
  /** The field to edit (e.g. "can_initiate", "participation_mode", "managers.allowed_ids") */
  field: string;
  /** The new value for the field */
  value: unknown;
  /** Stable ID of the actor requesting the change */
  actorId: string;
  /** Rules base directory */
  basePath: string;
  /** Optional human-readable name for override filename (defaults to "unknown") */
  safeName?: string;
}

export interface PolicyEditResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Execute a policy field edit with full authorization enforcement.
 *
 * Authorization matrix:
 *   - Owner: always allowed for all actions at all scopes
 *   - Global manager (in default rules managers.allowed_ids): can edit any scope
 *   - Scope manager (in scope override managers.allowed_ids): can edit their scope only
 *   - Non-manager: denied
 *   - managers.allowed_ids field: owner-only (appoint_manager action)
 *
 * @returns { success, message, error? }
 */
export function executePolicyEdit(params: PolicyEditParams): PolicyEditResult {
  const { scope, targetId, field, value, actorId, basePath, safeName } = params;

  // Step 1: Normalize targetId to stable ID
  const stableId = normalizeToStableId(targetId);

  // Step 2: Determine action type
  // managers.allowed_ids is an appoint/revoke action (owner-only)
  const action: "edit_policy" | "appoint_manager" | "revoke_manager" =
    field === "managers.allowed_ids" ? "appoint_manager" : "edit_policy";

  // Step 3: Load scope's current rule to get scopeManagers
  const overrideFilePath = findOverrideFile(basePath, scope === "contact" ? "contacts" : "groups", stableId, safeName);
  let scopeManagers: string[] = [];
  if (fs.existsSync(overrideFilePath)) {
    const override = scope === "contact"
      ? loadContactRule(overrideFilePath)
      : loadGroupRule(overrideFilePath);
    scopeManagers = override?.managers?.allowed_ids ?? [];
  }

  // Step 4: Load global default to get globalManagers
  const globalDefault = scope === "contact"
    ? loadDefaultContactRule(basePath)
    : loadDefaultGroupRule(basePath);
  const globalManagers: string[] = globalDefault.managers?.allowed_ids ?? [];

  // Step 5: Check authorization
  const authResult = checkManagerAuthorization({
    actorId,
    ownerId: OWNER_ID,
    action,
    scope,
    scopeManagers,
    globalManagers,
  });

  if (!authResult.allowed) {
    return {
      success: false,
      message: `Not authorized to edit policy for ${targetId}.`,
      error: `Not authorized: ${authResult.reason}. Only the owner or authorized managers can edit policies.`,
    };
  }

  // Step 6: Validate field name
  const allowedFields = scope === "contact" ? CONTACT_ALLOWED_FIELDS : GROUP_ALLOWED_FIELDS;
  if (!allowedFields.has(field)) {
    return {
      success: false,
      message: `Invalid field "${field}" for ${scope} scope.`,
      error: `Invalid field name "${field}". Allowed fields for ${scope}: ${Array.from(allowedFields).join(", ")}`,
    };
  }

  // Step 7: Load existing override (if any) and merge
  let existingData: Record<string, unknown> = {};
  if (fs.existsSync(overrideFilePath)) {
    try {
      const raw = fs.readFileSync(overrideFilePath, "utf8");
      const parsed = parseYaml(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existingData = parsed as Record<string, unknown>;
      }
    } catch (err) {
      log.warn("policy-edit: failed to parse existing override, starting fresh", { overrideFilePath, error: err instanceof Error ? err.message : String(err) });
      existingData = {};
    }
  }

  // Step 8: Apply field update
  // Handle nested field "managers.allowed_ids"
  if (field === "managers.allowed_ids") {
    const managers = (existingData.managers as Record<string, unknown> | undefined) ?? {};
    existingData.managers = { ...managers, allowed_ids: value };
  } else {
    existingData[field] = value;
  }

  // Step 9: Ensure parent directory exists and write updated YAML
  const parentDir = path.dirname(overrideFilePath);
  try {
    fs.mkdirSync(parentDir, { recursive: true });
    const yamlStr = stringifyYaml(existingData);
    fs.writeFileSync(overrideFilePath, yamlStr, "utf8");
  } catch (err) {
    return {
      success: false,
      message: `Failed to write policy override for ${targetId}.`,
      error: `File write failed: ${String(err)}`,
    };
  }

  // Step 11: Invalidate policy cache for the affected scope
  // Cache key is stableId (contacts) or stableId:senderId (groups with compound key)
  // Invalidate by stableId prefix — covers all compound keys
  policyCache.invalidate(stableId);

  return {
    success: true,
    message: `Policy updated: ${scope} ${targetId} → ${field} = ${JSON.stringify(value)}. Override file: ${path.basename(overrideFilePath)}`,
  };
}
