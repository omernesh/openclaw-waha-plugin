/**
 * tests/manager-authorizer.test.ts — Tests for the manager authorization matrix.
 * Added in Phase 6, Plan 02 (2026-03-14).
 *
 * Covers all 10 authorization cases defined in resolver-algorithm.md Section E.
 */

import { describe, it, expect } from "vitest";
import { checkManagerAuthorization } from "../src/manager-authorizer";
import { OWNER_ID } from "../src/rules-types";

const GLOBAL_MANAGER = "@c:global-manager@c.us";
const SCOPE_MANAGER = "@c:scope-manager@c.us";
const NON_MANAGER = "@c:random-user@c.us";
const SCOPE_ID = "@g:some-group@g.us";
const OTHER_SCOPE_ID = "@g:other-group@g.us";

describe("checkManagerAuthorization", () => {
  // Case 1: Owner + edit_policy at any scope => allowed
  it("Owner can edit_policy at global scope", () => {
    const result = checkManagerAuthorization({
      actorId: OWNER_ID,
      ownerId: OWNER_ID,
      action: "edit_policy",
      scope: "global",
      scopeManagers: [],
      globalManagers: [],
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("owner");
  });

  it("Owner can edit_policy at contact scope", () => {
    const result = checkManagerAuthorization({
      actorId: OWNER_ID,
      ownerId: OWNER_ID,
      action: "edit_policy",
      scope: "contact",
      scopeManagers: [],
      globalManagers: [],
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("owner");
  });

  // Case 2: Owner + appoint_manager => allowed
  it("Owner can appoint_manager", () => {
    const result = checkManagerAuthorization({
      actorId: OWNER_ID,
      ownerId: OWNER_ID,
      action: "appoint_manager",
      scope: "global",
      scopeManagers: [],
      globalManagers: [],
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("owner");
  });

  // Case 3: Owner + revoke_manager => allowed
  it("Owner can revoke_manager", () => {
    const result = checkManagerAuthorization({
      actorId: OWNER_ID,
      ownerId: OWNER_ID,
      action: "revoke_manager",
      scope: "global",
      scopeManagers: [],
      globalManagers: [],
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("owner");
  });

  // Case 4: Global manager + edit_policy at global scope => allowed
  it("Global manager can edit_policy at global scope", () => {
    const result = checkManagerAuthorization({
      actorId: GLOBAL_MANAGER,
      ownerId: OWNER_ID,
      action: "edit_policy",
      scope: "global",
      scopeManagers: [],
      globalManagers: [GLOBAL_MANAGER],
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("global_manager");
  });

  // Case 5: Global manager + edit_policy at contact scope => allowed
  it("Global manager can edit_policy at contact scope", () => {
    const result = checkManagerAuthorization({
      actorId: GLOBAL_MANAGER,
      ownerId: OWNER_ID,
      action: "edit_policy",
      scope: "contact",
      scopeManagers: [],
      globalManagers: [GLOBAL_MANAGER],
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("global_manager");
  });

  // Case 6: Global manager + appoint_manager => denied
  it("Global manager cannot appoint_manager (owner-only)", () => {
    const result = checkManagerAuthorization({
      actorId: GLOBAL_MANAGER,
      ownerId: OWNER_ID,
      action: "appoint_manager",
      scope: "global",
      scopeManagers: [],
      globalManagers: [GLOBAL_MANAGER],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("only owner can appoint/revoke managers");
  });

  // Case 7: Scope manager + edit_policy at their scope => allowed
  it("Scope manager can edit_policy at their own scope", () => {
    const result = checkManagerAuthorization({
      actorId: SCOPE_MANAGER,
      ownerId: OWNER_ID,
      action: "edit_policy",
      scope: "group",
      scopeManagers: [SCOPE_MANAGER],
      globalManagers: [],
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("scope_manager");
  });

  // Case 8: Scope manager + edit_policy at different scope => denied
  it("Scope manager cannot edit_policy at a different scope", () => {
    const result = checkManagerAuthorization({
      actorId: SCOPE_MANAGER,
      ownerId: OWNER_ID,
      action: "edit_policy",
      scope: "global", // scope manager is not global manager
      scopeManagers: [SCOPE_MANAGER],
      globalManagers: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("not_authorized");
  });

  // Case 9: Non-manager + edit_policy => denied
  it("Non-manager cannot edit_policy", () => {
    const result = checkManagerAuthorization({
      actorId: NON_MANAGER,
      ownerId: OWNER_ID,
      action: "edit_policy",
      scope: "contact",
      scopeManagers: [],
      globalManagers: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("not_authorized");
  });

  // Case 10: Non-manager + appoint_manager => denied
  it("Non-manager cannot appoint_manager", () => {
    const result = checkManagerAuthorization({
      actorId: NON_MANAGER,
      ownerId: OWNER_ID,
      action: "appoint_manager",
      scope: "global",
      scopeManagers: [],
      globalManagers: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("only owner can appoint/revoke managers");
  });
});
