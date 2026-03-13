---
phase: 04-multi-session
plan: 01
subsystem: multi-session
tags: [typescript, zod, session-management, role-based-access, webhook]

# Dependency graph
requires:
  - phase: 03-feature-gaps
    provides: autoLinkPreview config pattern, Phase 3 config comment blocks

provides:
  - WahaAccountConfig with role, subRole, triggerWord, triggerResponseMode fields
  - ResolvedWahaAccount with role and subRole fields (populated on resolve)
  - Zod schema accepting role/subRole/trigger fields with backward-compatible defaults
  - assertCanSend(session, cfg) replacing hardcoded assertAllowedSession
  - isRegisteredSession() in monitor.ts for config-driven webhook session validation
  - 20 unit tests in tests/role-guardrail.test.ts covering schema, accounts, and guardrail

affects:
  - 04-02 (session routing)
  - 04-03 (trigger word activation)
  - All future plans using send.ts or webhook handling

# Tech tracking
tech-stack:
  added: []
  patterns:
    - String-based roles (not enum) — new roles addable without code changes
    - assertCanSend checks subRole from config, defaults to full-access for backward compat
    - isRegisteredSession for webhook validation — accepts all config-registered sessions
    - vi.mock with async factory for mocking openclaw/plugin-sdk in tests

key-files:
  created:
    - tests/role-guardrail.test.ts
  modified:
    - src/types.ts
    - src/config-schema.ts
    - src/accounts.ts
    - src/send.ts
    - src/monitor.ts
    - tests/chat-mute.test.ts
    - tests/link-preview.test.ts

key-decisions:
  - "String-based roles (not enum) — new roles addable without code changes (per Phase 4 plan decision)"
  - "assertCanSend defaults to full-access for unregistered sessions — non-blocking for backward compat"
  - "isRegisteredSession in monitor.ts replaces assertAllowedSession — accepts all config sessions"
  - "listEnabledWahaAccounts added to accounts.js mocks in existing tests (deviation Rule 3)"

patterns-established:
  - "Role-based send guardrail: read subRole from config, throw on listener"
  - "Webhook session check: accept all registered sessions, ignore unregistered silently"

requirements-completed: [MSESS-01, MSESS-02, MSESS-03]

# Metrics
duration: 10min
completed: 2026-03-13
---

# Phase 4 Plan 01: Role-Based Session Foundation Summary

**Config-driven role/subRole/trigger fields on WahaAccountConfig plus assertCanSend replacing hardcoded session name allowlist**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-13T22:50:34Z
- **Completed:** 2026-03-13T23:00:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Extended WahaAccountConfig, ResolvedWahaAccount, and Zod schema with role/subRole/triggerWord/triggerResponseMode fields (all string, backward compatible)
- Replaced hardcoded `assertAllowedSession` (which only allowed `*_logan` sessions) with config-driven `assertCanSend` that reads subRole from config
- Updated webhook handler in monitor.ts to accept messages from ALL registered config sessions (not just hardcoded names)
- 20 unit tests pass covering schema backward compatibility, resolved account fields, and assertCanSend guardrail behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend types, config schema, and accounts with role/subRole/trigger fields** - `e550fb3` (feat)
2. **Task 2: Replace assertAllowedSession with role-based assertCanSend and update webhook validation** - `64b9e29` (feat)

_Note: TDD tasks written with failing tests first (RED), then implementation (GREEN)._

## Files Created/Modified
- `src/types.ts` - Added role, subRole, triggerWord, triggerResponseMode to WahaAccountConfig
- `src/config-schema.ts` - Added Zod schema fields with defaults (bot/full-access/dm)
- `src/accounts.ts` - Added role/subRole to ResolvedWahaAccount type, populated in resolveWahaAccount()
- `src/send.ts` - Replaced assertAllowedSession with assertCanSend, updated all call sites (9 total)
- `src/monitor.ts` - Added isRegisteredSession helper, replaced webhook try/catch with config-based check
- `tests/role-guardrail.test.ts` - New: 20 TDD tests for schema, accounts, and assertCanSend
- `tests/chat-mute.test.ts` - Updated accounts.js mock to include listEnabledWahaAccounts
- `tests/link-preview.test.ts` - Updated accounts.js mock to include listEnabledWahaAccounts

## Decisions Made
- String-based roles (not enum) per original plan decision — new roles addable without code changes
- assertCanSend defaults to full-access for sessions not found in config — non-breaking backward compat
- isRegisteredSession returns false for unregistered sessions (silently ignored with 200 OK response)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated existing test mocks to include listEnabledWahaAccounts**
- **Found during:** Task 2 (replace assertAllowedSession with assertCanSend)
- **Issue:** chat-mute.test.ts and link-preview.test.ts mock accounts.js without listEnabledWahaAccounts, which is now called by assertCanSend — tests failed with "No listEnabledWahaAccounts export defined on mock"
- **Fix:** Added listEnabledWahaAccounts mock returning a full-access account in both test files
- **Files modified:** tests/chat-mute.test.ts, tests/link-preview.test.ts
- **Verification:** Full test suite (104 tests) passes after fix
- **Committed in:** 64b9e29 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Necessary to unblock tests broken by new import in assertCanSend. No scope creep.

## Issues Encountered
- Vitest mocks with async factories need `async () => {}` syntax (not `() => { const z = await ... }`) — fixed in test file
- openclaw/plugin-sdk must be mocked in tests since it's not available in test environment — used async vi.mock factory with zod schemas

## Next Phase Readiness
- Role/subRole foundation complete — Phase 4 Plan 02 (session routing) can now read session roles from ResolvedWahaAccount
- assertCanSend in place — listener sessions already blocked from sending in production
- Webhook session validation now config-driven — ready for multi-account webhook routing in 04-02/04-03

---
*Phase: 04-multi-session*
*Completed: 2026-03-13*
