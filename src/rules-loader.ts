/**
 * rules-loader.ts — YAML file loading with zod schema validation for the rules system.
 * Added in Phase 6, Plan 01 (2026-03-13).
 *
 * Loads contact and group rule override files from disk.
 * Uses synchronous fs reads — YAML files are small (<1KB), async adds complexity with no benefit.
 * Returns null (never throws) on missing or malformed files.
 *
 * DO NOT REMOVE: Core module for the rules system. Used by rules-resolver (Plan 02).
 */

import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import {
  ContactRuleSchema,
  GroupRuleSchema,
  SYSTEM_CONTACT_DEFAULTS,
  SYSTEM_GROUP_DEFAULTS,
  type ContactRule,
  type GroupRule,
} from "./rules-types.js";

/**
 * Load and validate a contact rule override file.
 *
 * @param filePath - Absolute path to the YAML file.
 * @returns Parsed partial ContactRule, or null if missing/malformed.
 *
 * Error handling:
 *   ENOENT   -> return null (missing file is normal — no override for this contact)
 *   Parse error -> return null + log warning
 *   Validation error -> return null + log warning
 */
export function loadContactRule(filePath: string): Partial<ContactRule> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    if (isEnoentError(err)) return null;
    console.warn(`[waha] rules: error reading contact rule ${filePath}:`, err);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    console.warn(`[waha] rules: malformed YAML in contact rule ${filePath}:`, err);
    return null;
  }

  const result = ContactRuleSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(
      `[waha] rules: malformed override ${filePath}: ${result.error.message}`
    );
    return null;
  }

  return result.data;
}

/**
 * Load and validate a group rule override file.
 *
 * @param filePath - Absolute path to the YAML file.
 * @returns Parsed partial GroupRule, or null if missing/malformed.
 */
export function loadGroupRule(filePath: string): Partial<GroupRule> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    if (isEnoentError(err)) return null;
    console.warn(`[waha] rules: error reading group rule ${filePath}:`, err);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    console.warn(`[waha] rules: malformed YAML in group rule ${filePath}:`, err);
    return null;
  }

  const result = GroupRuleSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(
      `[waha] rules: malformed override ${filePath}: ${result.error.message}`
    );
    return null;
  }

  return result.data;
}

/**
 * Load the global contact defaults file (_default.yaml).
 *
 * Falls back to SYSTEM_CONTACT_DEFAULTS if the file is missing or malformed.
 * Logs ERROR (not warn) on missing default — the seed file should always exist.
 *
 * @param basePath - Rules base directory (contains contacts/ and groups/ subdirs).
 */
export function loadDefaultContactRule(basePath: string): ContactRule {
  const filePath = path.join(basePath, "contacts", "_default.yaml");
  const partial = loadContactRule(filePath);
  if (partial === null) {
    console.error(
      `[waha] rules: global contact default missing or malformed at ${filePath}. Using system defaults.`
    );
    return { ...SYSTEM_CONTACT_DEFAULTS };
  }
  // Merge with system defaults to fill any gaps in the default file
  return { ...SYSTEM_CONTACT_DEFAULTS, ...partial };
}

/**
 * Load the global group defaults file (_default.yaml).
 *
 * Falls back to SYSTEM_GROUP_DEFAULTS if the file is missing or malformed.
 *
 * @param basePath - Rules base directory (contains contacts/ and groups/ subdirs).
 */
export function loadDefaultGroupRule(basePath: string): GroupRule {
  const filePath = path.join(basePath, "groups", "_default.yaml");
  const partial = loadGroupRule(filePath);
  if (partial === null) {
    console.error(
      `[waha] rules: global group default missing or malformed at ${filePath}. Using system defaults.`
    );
    return { ...SYSTEM_GROUP_DEFAULTS };
  }
  // Merge with system defaults to fill any gaps in the default file
  return { ...SYSTEM_GROUP_DEFAULTS, ...partial };
}

// -- Internal helpers --

function isEnoentError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
