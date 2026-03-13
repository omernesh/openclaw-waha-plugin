/**
 * manager-authorizer.ts — Authorization matrix for policy edits.
 * Added in Phase 6, Plan 02 (2026-03-14).
 *
 * DO NOT CHANGE: This enforces the authorization model defined in resolver-algorithm.md Section E.
 *
 * Authorization matrix (verified 2026-03-14):
 *   - Owner: always allowed for all actions (edit_policy, appoint_manager, revoke_manager)
 *   - Global manager: allowed edit_policy at any scope; denied appoint/revoke
 *   - Scope manager: allowed edit_policy at their specific scope only (not global scope)
 *   - Non-manager: denied all policy edit actions
 *   - appoint_manager / revoke_manager: owner-only; all others denied
 */

import { OWNER_ID } from "./rules-types";

export interface ManagerAuthorizationParams {
  /** The actor requesting the action (stable ID format, e.g. @c:...) */
  actorId: string;
  /** The owner's stable ID (defaults to OWNER_ID from rules-types) */
  ownerId: string;
  /** The action being requested */
  action: "edit_policy" | "appoint_manager" | "revoke_manager";
  /** The scope of the policy being modified */
  scope: "global" | "contact" | "group";
  /** Managers with edit access for this specific scope */
  scopeManagers: string[];
  /** Managers with edit access across all scopes */
  globalManagers: string[];
}

export interface AuthorizationResult {
  allowed: boolean;
  reason: string;
}

/**
 * Checks whether the actor is authorized to perform the given policy action.
 *
 * @param params - Authorization parameters
 * @returns { allowed: boolean; reason: string }
 */
export function checkManagerAuthorization(
  params: ManagerAuthorizationParams
): AuthorizationResult {
  const { actorId, ownerId, action, scope, scopeManagers, globalManagers } = params;

  // appoint/revoke: only the owner may do this
  if (action === "appoint_manager" || action === "revoke_manager") {
    if (isOwner(actorId, ownerId)) {
      return { allowed: true, reason: "owner" };
    }
    return { allowed: false, reason: "only owner can appoint/revoke managers" };
  }

  // edit_policy: owner always allowed
  if (isOwner(actorId, ownerId)) {
    return { allowed: true, reason: "owner" };
  }

  // edit_policy: global manager allowed at any scope
  if (globalManagers.includes(actorId)) {
    return { allowed: true, reason: "global_manager" };
  }

  // edit_policy: scope manager allowed only at non-global scopes
  if (scope !== "global" && scopeManagers.includes(actorId)) {
    return { allowed: true, reason: "scope_manager" };
  }

  // All other cases: denied
  return { allowed: false, reason: "not_authorized" };
}

/**
 * Checks whether the actor is the owner.
 * Simple equality check on stable IDs.
 */
export function isOwner(actorId: string, ownerId: string = OWNER_ID): boolean {
  return actorId === ownerId;
}
