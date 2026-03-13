/**
 * rules-merge.ts — 5-layer merge engine for the WhatsApp Rules and Policy System.
 * Added in Phase 6, Plan 02 (2026-03-14).
 *
 * DO NOT CHANGE: This is the canonical merge engine for rule inheritance.
 * Merge semantics (verified 2026-03-14):
 *   - Scalars: replace (later layer wins)
 *   - Arrays: replace entirely (NOT append — later layer's array replaces earlier array)
 *   - Objects (non-array): deep merge recursively
 *   - Missing fields (undefined): inherit from lower layer
 *   - null/undefined layers: skipped entirely
 *
 * Example: mergeRuleLayers([systemDefaults, globalDefault, override, runtimeConstraints, ownerOverride])
 */

/**
 * Merges an ordered array of sparse rule layers into a single flat object.
 * Layers are processed left-to-right: later layers override earlier layers.
 * null and undefined layers are skipped.
 *
 * @param layers - Array of partial rule objects (any order from lowest to highest precedence)
 * @returns Merged result as a Partial<T>
 */
export function mergeRuleLayers<T extends Record<string, unknown>>(
  layers: Array<Partial<T> | null | undefined>
): Partial<T> {
  const result: Record<string, unknown> = {};

  for (const layer of layers) {
    // Skip null and undefined layers entirely
    if (layer == null) continue;

    for (const key of Object.keys(layer) as (keyof typeof layer)[]) {
      const value = layer[key];

      // Undefined values mean "inherit from lower layer" — skip
      if (value === undefined) continue;

      const existing = result[key as string];

      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        existing !== null &&
        typeof existing === "object" &&
        !Array.isArray(existing)
      ) {
        // Both values are plain objects (not arrays, not null) — deep merge
        result[key as string] = mergeRuleLayers([
          existing as Record<string, unknown>,
          value as Record<string, unknown>,
        ]);
      } else {
        // Scalar, array, or null — replace
        result[key as string] = value;
      }
    }
  }

  return result as Partial<T>;
}
