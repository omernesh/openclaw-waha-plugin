---
phase: 06-whatsapp-rules-and-policy-system
plan: "04"
subsystem: rules-integration
tags: [rules, policy, enforcement, inbound, outbound, edit]
dependency_graph:
  requires: [06-01, 06-02, 06-03]
  provides: [rules-integration, policy-enforcement, policy-edit-action]
  affects: [src/inbound.ts, src/send.ts, src/channel.ts]
tech_stack:
  added: [src/policy-enforcer.ts, src/policy-edit.ts]
  patterns: [fail-open-enforcement, sparse-yaml-override, manager-authorization]
key_files:
  created:
    - src/policy-enforcer.ts
    - src/policy-edit.ts
    - tests/policy-enforcer.test.ts
    - tests/policy-edit.test.ts
  modified:
    - src/inbound.ts
    - src/send.ts
    - src/channel.ts
decisions:
  - "Fail-open design for assertPolicyCanSend: rules errors never block sends, only explicit policy denials do"
  - "assertPolicyCanSend added to sendWahaText/Image/Video/File after assertCanSend (role check)"
  - "resolveInboundPolicy placed after all existing filters to only resolve for messages being handled"
  - "WahaResolvedPolicy injected as JSON string in ctxPayload (matches existing pattern for MentionedJids)"
  - "executePolicyEdit extracted to policy-edit.ts for testability (follows trigger-word.ts pattern)"
  - "managers.allowed_ids field triggers appoint_manager action (owner-only) not edit_policy"
  - "YAML stringify from yaml package (same as rules-loader.ts) ensures consistent format"
metrics:
  duration: "9 minutes"
  completed_date: "2026-03-13"
  tasks_completed: 2
  files_changed: 7
---

# Phase 6 Plan 04: Rules Integration — Live Policy Enforcement Summary

Wire the rules system into the existing plugin: inbound policy injection, outbound enforcement, and policy edit action handler.

## What Was Built

**New modules (2):**
- `src/policy-enforcer.ts` — Outbound policy enforcement gate. `assertPolicyCanSend(chatId, cfg)` with fail-open design.
- `src/policy-edit.ts` — Policy edit logic extracted for testability. `executePolicyEdit(params)` pure function with file I/O.

**Modified files (3):**
- `src/send.ts` — Added `assertPolicyCanSend` call after `assertCanSend` in sendWahaText, sendWahaImage, sendWahaVideo, sendWahaFile.
- `src/inbound.ts` — Added `resolveInboundPolicy` hook after all existing filters; injects `WahaResolvedPolicy` into ctxPayload.
- `src/channel.ts` — Added `editPolicy` to ACTION_HANDLERS and UTILITY_ACTIONS.

**New tests (2 files, 16 cases total):**
- `tests/policy-enforcer.test.ts` — 7 cases for assertPolicyCanSend (blocks, passes, fail-open paths)
- `tests/policy-edit.test.ts` — 9 cases for executePolicyEdit (auth matrix, field validation, file ops)

## Key Design Decisions

**Fail-open enforcement:** `assertPolicyCanSend` only blocks when policy explicitly says so (can_initiate=false or silent_observer). If rules directory doesn't exist, or resolution returns null, sends proceed normally. This prevents the rules system from silently breaking all sends due to misconfiguration.

**Inbound hook placement:** `resolveInboundPolicy` is called AFTER all existing hard filters (group whitelist, keyword filter, DM settings, access control). Policy resolution is lazy — only runs for messages we're actually going to dispatch.

**Policy edit authorization:** `executePolicyEdit` enforces the full authorization matrix via `checkManagerAuthorization`. The `managers.allowed_ids` field triggers `appoint_manager` action (owner-only). All other fields trigger `edit_policy` (global/scope managers allowed).

**Cache invalidation:** After a successful edit, `policyCache.invalidate(stableId)` removes all cached entries for the edited scope, forcing fresh resolution on the next inbound message.

## Test Results

- Task 1 (policy-enforcer + inbound hook): 7/7 tests pass
- Task 2 (policy-edit + channel.ts): 9/9 tests pass
- Full suite: 274/274 tests pass (0 regressions)

## Deviations from Plan

**None** — plan executed exactly as written.

## Self-Check: PASSED

All created files exist and both task commits are present:
- `src/policy-enforcer.ts` — FOUND
- `src/policy-edit.ts` — FOUND
- Commit ed62fc1 (Task 1) — FOUND
- Commit 09fe202 (Task 2) — FOUND
