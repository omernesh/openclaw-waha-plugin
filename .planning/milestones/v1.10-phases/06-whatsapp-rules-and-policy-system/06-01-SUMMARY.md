---
phase: 06-whatsapp-rules-and-policy-system
plan: 01
subsystem: rules-foundation
tags: [rules-system, zod, yaml, identity, types]
dependency_graph:
  requires: []
  provides:
    - ContactRuleSchema (src/rules-types.ts)
    - GroupRuleSchema (src/rules-types.ts)
    - ResolvedPolicy type (src/rules-types.ts)
    - SYSTEM_CONTACT_DEFAULTS (src/rules-types.ts)
    - SYSTEM_GROUP_DEFAULTS (src/rules-types.ts)
    - OWNER_ID (src/rules-types.ts)
    - normalizeToStableId (src/identity-resolver.ts)
    - stableIdToFileSlug (src/identity-resolver.ts)
    - findOverrideFile (src/identity-resolver.ts)
    - getRulesBasePath (src/identity-resolver.ts)
    - loadContactRule (src/rules-loader.ts)
    - loadGroupRule (src/rules-loader.ts)
    - loadDefaultContactRule (src/rules-loader.ts)
    - loadDefaultGroupRule (src/rules-loader.ts)
    - rulesPath config field (src/config-schema.ts, src/types.ts)
    - rules/contacts/_default.yaml seed file
    - rules/groups/_default.yaml seed file
  affects:
    - src/config-schema.ts (rulesPath field added)
    - src/types.ts (rulesPath field added)
    - package.json (yaml dependency installed)
tech_stack:
  added:
    - yaml@2.x (YAML parsing — parse() function)
  patterns:
    - Zod partial schemas (all fields optional for sparse override support)
    - Null-on-error file loading (never throws on missing/malformed files)
    - Stable prefixed ID format (@c:, @lid:, @g:)
    - System defaults as typed fallback constants
key_files:
  created:
    - src/rules-types.ts
    - src/identity-resolver.ts
    - src/rules-loader.ts
    - rules/contacts/_default.yaml
    - rules/groups/_default.yaml
    - tests/identity-resolver.test.ts
    - tests/rules-loader.test.ts
  modified:
    - src/config-schema.ts (rulesPath field)
    - src/types.ts (rulesPath field)
    - package.json (yaml dependency)
    - package-lock.json
decisions:
  - "Synchronous fs reads in rules-loader: YAML files are <1KB, async adds complexity with no benefit"
  - "All zod schemas use optional fields (no .strict()): sparse overrides must not fail validation on unknown keys in future"
  - "path.join used in identity-resolver for platform-safe path construction"
  - "SYSTEM_CONTACT_DEFAULTS and SYSTEM_GROUP_DEFAULTS are typed constants (not zod-validated): they are hardcoded guarantees"
metrics:
  duration: 5min
  completed_date: "2026-03-13"
  tasks_completed: 2
  files_created: 7
  files_modified: 4
  tests_added: 24
  tests_total: 196
---

# Phase 6 Plan 01: Rules System Foundation Summary

Zod schemas, YAML loader with null-on-error semantics, JID-to-stable-ID normalizer, seed YAML defaults, and rulesPath config field — the full foundation for the WhatsApp Rules and Policy System.

## What Was Built

### src/rules-types.ts
TypeScript types and zod schemas for the rules system:
- `ContactRuleSchema` / `GroupRuleSchema` — all fields optional for sparse override support
- `ResolvedPolicy` — output type for the rules resolver (Plan 02)
- `SYSTEM_CONTACT_DEFAULTS` / `SYSTEM_GROUP_DEFAULTS` — hardcoded fallback values
- `OWNER_ID` constant (`@c:972544329000@c.us`)

### src/identity-resolver.ts
JID normalization and file path construction:
- `normalizeToStableId()` — converts raw WAHA JIDs to `@c:`, `@lid:`, `@g:` prefixed stable IDs
- `stableIdToFileSlug()` — filesystem-safe slug for override file naming
- `findOverrideFile()` — constructs `{basePath}/{scope}/{name}__{slug}.yaml` paths
- `getRulesBasePath()` — reads `rulesPath` from config or defaults to `~/.openclaw/workspace/skills/waha-openclaw-channel/rules/`

### src/rules-loader.ts
YAML file loading with zod validation:
- `loadContactRule()` / `loadGroupRule()` — returns `Partial<Rule> | null`, never throws
- `loadDefaultContactRule()` / `loadDefaultGroupRule()` — returns full defaults, falls back to system constants on error

### Seed YAML files
- `rules/contacts/_default.yaml` — global contact defaults (trust_level: normal, can_reply: true, etc.)
- `rules/groups/_default.yaml` — global group defaults (participation_mode: mention_only, etc.)

### Config updates
- `rulesPath?: string` added to `WahaAccountSchemaBase` and `WahaAccountConfig`

## Tests (24 new, 196 total)

All 196 tests pass. New tests cover:
- Identity normalization: 6 cases (all JID formats, bare phone, trim/lowercase)
- File slug generation: 3 cases
- Override file path construction: 3 cases
- Contact rule loading: 5 cases (valid, missing, malformed schema, unparseable YAML, sparse)
- Group rule loading: 3 cases
- Default contact rule loading: 2 cases (valid file, missing file)
- Default group rule loading: 2 cases

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Windows path separator in findOverrideFile tests**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Test expectations used forward-slash strings (`/rules/contacts/...`) but `path.join` on Windows produces backslash paths. Tests failed with path mismatch.
- **Fix:** Updated test assertions to use `path.join()` for platform-independent path comparison.
- **Files modified:** tests/identity-resolver.test.ts
- **Commit:** 86c7c31

## Self-Check: PASSED
