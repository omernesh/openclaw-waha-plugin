---
phase: 06-whatsapp-rules-and-policy-system
plan: 02
subsystem: rules-merge-cache-auth
tags: [rules-system, merge-engine, lru-cache, authorization, tdd]
dependency_graph:
  requires:
    - src/rules-types.ts (ContactRule, GroupRule, ResolvedPolicy, OWNER_ID, SYSTEM_CONTACT_DEFAULTS, SYSTEM_GROUP_DEFAULTS)
    - lru-cache (npm, already installed)
  provides:
    - mergeRuleLayers (src/rules-merge.ts)
    - PolicyCache (src/policy-cache.ts)
    - policyCache singleton (src/policy-cache.ts)
    - checkManagerAuthorization (src/manager-authorizer.ts)
    - isOwner (src/manager-authorizer.ts)
  affects:
    - src/rules-resolver.ts (Plan 03 — will compose all three modules)
tech_stack:
  added: []
  patterns:
    - TDD (RED-GREEN cycle for both tasks)
    - Pure computation modules (no file I/O or integration dependencies)
    - LRU cache keyed by scope+mtime for stale-mtime-as-miss semantics
    - Authorization matrix with explicit reason strings
key_files:
  created:
    - src/rules-merge.ts
    - src/policy-cache.ts
    - src/manager-authorizer.ts
    - tests/rules-merge.test.ts
    - tests/policy-cache.test.ts
    - tests/manager-authorizer.test.ts
  modified: []
decisions:
  - "Arrays in mergeRuleLayers use replace semantics (not append): later layer's array fully replaces lower layer's array"
  - "PolicyCache key is `${scopeId}:${mtime}`: different mtime for same scope is a natural miss, no explicit invalidation needed for file changes"
  - "isOwner exported separately from checkManagerAuthorization for use in resolver without full authorization context"
  - "Scope manager denied at global scope: scope managers can only edit their specific scope, not cross-scope policies"
metrics:
  duration: 3min
  completed_date: "2026-03-14"
  tasks_completed: 2
  files_created: 6
  files_modified: 0
  tests_added: 29
  tests_total: 225
---

# Phase 6 Plan 02: Merge Engine, Policy Cache, and Manager Authorization Summary

Pure-logic compute modules with no I/O: 5-layer rule merge engine (scalar replace, array replace, object deep merge), LRU policy cache keyed by scope+mtime, and owner/manager authorization matrix for policy edits.

## What Was Built

### src/rules-merge.ts

5-layer merge engine for sparse rule inheritance:

- `mergeRuleLayers<T>(layers: Array<Partial<T> | null | undefined>): Partial<T>` — processes layers left-to-right (lowest to highest precedence)
- Scalars: later layer wins (replace)
- Arrays: later layer wins entirely (replace, NOT append)
- Objects (non-array, non-null): recursive deep merge
- Missing fields (undefined): inherit from lower layer
- null/undefined layers: skipped entirely

This is a pure function with zero external dependencies. No file I/O, no side effects.

### src/policy-cache.ts

LRU cache wrapper keyed by `${scopeId}:${mtime}`:

- `PolicyCache` class wrapping `LRUCache<string, ResolvedPolicy>` from lru-cache
- Constructor options: `max` (default 500), `ttl` (default 30,000ms)
- `get(scopeId, mtime)` — returns cached policy or undefined
- `set(scopeId, mtime, policy)` — stores under composite key
- `invalidate(scopeId)` — deletes all entries with matching scope prefix (for forced re-resolution)
- `clear()` — full cache clear
- Module-level `policyCache` singleton for shared use by the resolver

Stale-mtime-as-miss: when a rule file changes, its mtime changes and the old entry is a natural miss. No explicit invalidation needed for normal file change scenarios.

### src/manager-authorizer.ts

Authorization matrix for policy edit actions:

- `checkManagerAuthorization(params): { allowed: boolean; reason: string }`
- `isOwner(actorId, ownerId): boolean` — exported separately for lightweight checks
- Authorization matrix:
  - appoint/revoke: owner-only, all others get "only owner can appoint/revoke managers"
  - Owner: always allowed (reason: "owner")
  - Global manager: allowed edit_policy at any scope (reason: "global_manager")
  - Scope manager: allowed edit_policy at non-global scopes only (reason: "scope_manager")
  - All others: denied (reason: "not_authorized")

## Tests (29 new, 225 total)

All 225 tests pass. New tests:

- `tests/rules-merge.test.ts` — 10 cases: scalar replace, array replace, object deep merge, missing=inherit, null/undefined skip, single-layer passthrough, 5-layer simulation, subfield preservation, empty array input, all-null input
- `tests/policy-cache.test.ts` — 8 cases: miss, hit, stale mtime miss, multi-scope, invalidate prefix, clear, LRU eviction, overwrite
- `tests/manager-authorizer.test.ts` — 11 cases covering all 10 authorization matrix cells (owner×3 + global_manager×3 + scope_manager×2 + non_manager×2)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED
