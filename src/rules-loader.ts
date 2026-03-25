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
import { z } from "zod";
import {
  ContactRuleSchema,
  GroupRuleSchema,
  SYSTEM_CONTACT_DEFAULTS,
  SYSTEM_GROUP_DEFAULTS,
  type ContactRule,
  type GroupRule,
} from "./rules-types.js";
import { createLogger } from "./logger.js";


const log = createLogger({ component: "rules-loader" });
/**
 * Generic rule file loader — reads YAML, parses, and validates against a zod schema.
 * Returns null (never throws) on missing or malformed files.
 */
function loadRule<T>(filePath: string, schema: z.ZodType<T>, label: string): Partial<T> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    if (isEnoentError(err)) return null;
    log.warn("rules: error reading rule file", { label, filePath, error: err instanceof Error ? (err as Error).message : String(err) });
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    log.warn("rules: malformed YAML in rule file", { label, filePath, error: err instanceof Error ? (err as Error).message : String(err) });
    return null;
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    log.warn("rules: malformed override", { filePath, error: result.error.message });
    return null;
  }

  return result.data as Partial<T>;
}

/**
 * Load and validate a contact rule override file.
 *
 * @param filePath - Absolute path to the YAML file.
 * @returns Parsed partial ContactRule, or null if missing/malformed.
 */
export function loadContactRule(filePath: string): Partial<ContactRule> | null {
  return loadRule(filePath, ContactRuleSchema, "contact");
}

/**
 * Load and validate a group rule override file.
 *
 * @param filePath - Absolute path to the YAML file.
 * @returns Parsed partial GroupRule, or null if missing/malformed.
 */
export function loadGroupRule(filePath: string): Partial<GroupRule> | null {
  return loadRule(filePath, GroupRuleSchema, "group");
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
    log.error("rules: global contact default missing or malformed, using system defaults", { filePath });
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
    log.error("rules: global group default missing or malformed, using system defaults", { filePath });
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
