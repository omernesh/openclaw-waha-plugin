/**
 * tests/rules-merge.test.ts — Tests for the 5-layer merge engine.
 * Added in Phase 6, Plan 02 (2026-03-14).
 */

import { describe, it, expect } from "vitest";
import { mergeRuleLayers } from "../src/rules-merge";
import { SYSTEM_CONTACT_DEFAULTS, SYSTEM_GROUP_DEFAULTS } from "../src/rules-types";

describe("mergeRuleLayers", () => {
  // Scalar replace
  it("replaces scalar values with later-layer value", () => {
    const result = mergeRuleLayers([{ tone: "neutral" }, { tone: "warm" }]);
    expect(result.tone).toBe("warm");
  });

  // Array replace (NOT append)
  it("replaces arrays entirely (not appending)", () => {
    const result = mergeRuleLayers([
      { forbidden_actions: ["a"] },
      { forbidden_actions: ["b"] },
    ]);
    expect(result.forbidden_actions).toEqual(["b"]);
  });

  // Object deep merge
  it("deep merges plain objects", () => {
    const result = mergeRuleLayers([
      { managers: { allowed_ids: ["x"] } },
      { managers: { allowed_ids: ["y"], owner_only_appoint_revoke: true } },
    ]);
    expect(result.managers).toEqual({
      allowed_ids: ["y"],
      owner_only_appoint_revoke: true,
    });
  });

  // Missing=inherit
  it("inherits values from lower layer when upper layer has missing field", () => {
    const result = mergeRuleLayers([{ tone: "neutral", can_initiate: true }, {}]);
    expect(result.tone).toBe("neutral");
    expect(result.can_initiate).toBe(true);
  });

  // Null/undefined layers skipped
  it("skips null and undefined layers", () => {
    const result = mergeRuleLayers([null, { tone: "warm" }, undefined]);
    expect(result.tone).toBe("warm");
  });

  // Single-layer passthrough
  it("returns the single layer unchanged for one-layer input", () => {
    const result = mergeRuleLayers([{ tone: "professional", can_reply: false }]);
    expect(result.tone).toBe("professional");
    expect(result.can_reply).toBe(false);
  });

  // 5-layer merge test simulating the real pipeline:
  // [systemDefaults, globalDefault, override, runtimeConstraints, ownerOverride]
  it("produces correct output for 5-layer merge", () => {
    const systemDefaults = { ...SYSTEM_CONTACT_DEFAULTS };

    const globalDefault = {
      tone: "casual",
      can_initiate: false,
    };

    const override = {
      tone: "warm",
      can_reply: true,
      forbidden_actions: ["send_file"],
    };

    const runtimeConstraints = {
      // no tone override — inherit from override layer
      can_initiate: true,
    };

    const ownerOverride = {
      forbidden_actions: [], // owner clears forbidden actions
    };

    const result = mergeRuleLayers([
      systemDefaults,
      globalDefault,
      override,
      runtimeConstraints,
      ownerOverride,
    ]);

    // Owner layer clears forbidden_actions (array replace)
    expect(result.forbidden_actions).toEqual([]);

    // runtimeConstraints sets can_initiate = true (overrides globalDefault's false)
    expect(result.can_initiate).toBe(true);

    // override sets tone = "warm" (overrides globalDefault's "casual"), ownerOverride has no tone
    expect(result.tone).toBe("warm");

    // systemDefaults trust_level is preserved (no upper layer changed it)
    expect(result.trust_level).toBe("normal");

    // can_reply is true from override layer, not overridden
    expect(result.can_reply).toBe(true);
  });

  // Deep merge preserves non-overridden subfields
  it("deep merge preserves lower-layer subfields not overridden by upper layer", () => {
    const result = mergeRuleLayers([
      { managers: { allowed_ids: ["alice"], owner_only_appoint_revoke: false } },
      { managers: { allowed_ids: ["bob"] } },
    ]);
    // allowed_ids replaced, owner_only_appoint_revoke from lower layer preserved
    expect(result.managers?.allowed_ids).toEqual(["bob"]);
    expect(result.managers?.owner_only_appoint_revoke).toBe(false);
  });

  // Empty array input returns empty object
  it("returns empty object for empty layers array", () => {
    const result = mergeRuleLayers([]);
    expect(result).toEqual({});
  });

  // All null layers returns empty object
  it("returns empty object when all layers are null or undefined", () => {
    const result = mergeRuleLayers([null, undefined, null]);
    expect(result).toEqual({});
  });
});
