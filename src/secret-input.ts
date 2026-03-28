// Phase 58: Local implementations replacing openclaw/plugin-sdk/secret-input exports.
// Behavior verified against SDK source at /usr/lib/node_modules/openclaw/dist/types.secrets-DgX397vI.js
//
// normalizeSecretInputString: returns trimmed string for non-empty strings, undefined otherwise.
// normalizeResolvedSecretInputString: for plain strings, returns trimmed value; for secret ref objects,
//   returns undefined (cannot resolve secret provider refs without the SDK runtime).
//   Callers (accounts.ts, monitor.ts) treat a falsy return as "no inline value" and fall back to "".
// hasConfiguredSecretInput: true if value is a non-empty string OR a secret ref object.

import { z } from "zod";

type SecretRef = { source: "env" | "file" | "exec"; provider: string; id: string };

function isSecretRef(value: unknown): value is SecretRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.source === "env" || v.source === "file" || v.source === "exec") &&
    typeof v.provider === "string" &&
    v.provider.trim().length > 0 &&
    typeof v.id === "string" &&
    v.id.trim().length > 0
  );
}

/** Returns the trimmed string for non-empty string values, undefined otherwise. */
export function normalizeSecretInputString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolves a string-or-secret-ref config value to a plain string.
 * For plain strings: returns the trimmed value (or undefined if empty).
 * For secret ref objects ({source, provider, id}): returns undefined — secret provider
 *   resolution requires the SDK runtime which is not available in standalone mode.
 *   Callers treat falsy return as "no configured value".
 *
 * Note: The `path` parameter is accepted for API compatibility but used only in error messages.
 */
export function normalizeResolvedSecretInputString(params: {
  value: unknown;
  path?: string;
}): string | undefined {
  return normalizeSecretInputString(params.value);
}

/**
 * Returns true if `value` is a configured secret input — either a non-empty string
 * or a secret ref object ({source, provider, id}).
 */
export function hasConfiguredSecretInput(value: unknown, _defaults?: unknown): boolean {
  if (normalizeSecretInputString(value)) return true;
  return isSecretRef(value);
}

export function buildSecretInputSchema() {
  return z.union([
    z.string(),
    z.object({
      source: z.enum(["env", "file", "exec"]),
      provider: z.string().min(1),
      id: z.string().min(1),
    }),
  ]);
}
