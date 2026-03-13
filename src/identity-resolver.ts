/**
 * identity-resolver.ts — JID/LID to stable ID normalization for the rules system.
 * Added in Phase 6, Plan 01 (2026-03-13).
 *
 * Stable IDs use a prefixed canonical format:
 *   @c:972544329000@c.us  — WhatsApp contact
 *   @lid:271862907039996@lid — LID (Linked Device Identity)
 *   @g:120363421825201386@g.us — Group
 *
 * DO NOT CHANGE: ID normalization is the foundation of the rules system.
 * Rule files are keyed by stable IDs — changing this breaks all override file lookup.
 */

import * as path from "path";
import * as os from "os";
import type { CoreConfig } from "./types.js";

/**
 * Normalize a raw WAHA JID (or bare phone number) to a stable prefixed ID.
 *
 * Inputs from WAHA are always raw JIDs like "972544329000@c.us" or "271862907039996@lid".
 * This function converts them to canonical stable IDs for consistent rule file lookup.
 *
 * Examples:
 *   "972544329000@c.us"          -> "@c:972544329000@c.us"
 *   "271862907039996@lid"        -> "@lid:271862907039996@lid"
 *   "120363421825201386@g.us"    -> "@g:120363421825201386@g.us"
 *   "972544329000"               -> "@c:972544329000@c.us"  (bare phone)
 *   "  972544329000@C.US  "      -> "@c:972544329000@c.us"  (trimmed, lowercased)
 */
export function normalizeToStableId(jid: string): string {
  const normalized = jid.trim().toLowerCase();

  if (normalized.endsWith("@g.us")) {
    return `@g:${normalized}`;
  }
  if (normalized.endsWith("@lid")) {
    return `@lid:${normalized}`;
  }
  if (normalized.endsWith("@c.us")) {
    return `@c:${normalized}`;
  }
  // Bare phone number — digits only
  if (/^\d+$/.test(normalized)) {
    return `@c:${normalized}@c.us`;
  }
  // Fallback — wrap as-is to ensure some stable form
  return `@c:${normalized}`;
}

/**
 * Convert a stable ID to a filesystem-safe slug for use in override filenames.
 *
 * Override files are named: {safeName}__{stableIdToFileSlug(stableId)}.yaml
 *
 * The slug strips the type prefix (@c:, @lid:, @g:) and replaces @ and . with _.
 *
 * Examples:
 *   "@c:972544329000@c.us"           -> "972544329000_c_us"
 *   "@g:120363421825201386@g.us"     -> "120363421825201386_g_us"
 *   "@lid:271862907039996@lid"       -> "271862907039996_lid"
 */
export function stableIdToFileSlug(stableId: string): string {
  // Strip known type prefixes
  let idPart = stableId;
  if (idPart.startsWith("@c:")) idPart = idPart.slice(3);
  else if (idPart.startsWith("@lid:")) idPart = idPart.slice(5);
  else if (idPart.startsWith("@g:")) idPart = idPart.slice(3);

  // Replace @ and . with _, remove other non-alphanumeric/underscore chars
  return idPart.replace(/[@.]/g, "_").replace(/[^a-z0-9_]/gi, "");
}

/**
 * Construct the path to an override file for a specific contact or group.
 *
 * Override file naming convention: {basePath}/{scope}/{safeName}__{slug}.yaml
 *
 * @param basePath - Base rules directory (e.g., /home/user/rules)
 * @param scope    - "contacts" or "groups"
 * @param stableId - Canonical stable ID (e.g., "@c:972544329000@c.us")
 * @param safeName - Human-readable name prefix for the file (e.g., "omer"). Defaults to "unknown".
 */
export function findOverrideFile(
  basePath: string,
  scope: "contacts" | "groups",
  stableId: string,
  safeName?: string
): string {
  const name = safeName || "unknown";
  const slug = stableIdToFileSlug(stableId);
  return path.join(basePath, scope, `${name}__${slug}.yaml`);
}

/**
 * Resolve the rules base path from plugin config.
 *
 * Priority:
 *   1. cfg.channels.waha.rulesPath (explicit config)
 *   2. ~/.openclaw/workspace/skills/waha-openclaw-channel/rules/ (default)
 *
 * DO NOT REMOVE: Called by rules-loader.ts to find rule files.
 */
export function getRulesBasePath(cfg: CoreConfig): string {
  const configured = cfg.channels?.waha?.rulesPath;
  if (configured) return configured;
  return path.join(
    os.homedir(),
    ".openclaw",
    "workspace",
    "skills",
    "waha-openclaw-channel",
    "rules"
  );
}
