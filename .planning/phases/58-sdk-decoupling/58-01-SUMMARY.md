---
phase: 58-sdk-decoupling
plan: "01"
subsystem: sdk-decoupling
tags: [sdk-decoupling, platform-types, account-utils, request-utils, config-io, CORE-02]
dependency_graph:
  requires: []
  provides: [platform-types.ts, account-utils.ts, request-utils.ts, CORE-02]
  affects: [src/types.ts, src/runtime.ts, src/secret-input.ts, src/config-io.ts, src/accounts.ts, src/waha-client.ts, src/proxy-send-handler.ts, src/inbound-queue.ts]
tech_stack:
  added: []
  patterns: [local-sdk-replacement, type-compatibility-shim, backward-compat-env-var]
key_files:
  created:
    - src/platform-types.ts
    - src/account-utils.ts
    - src/request-utils.ts
  modified:
    - src/types.ts
    - src/runtime.ts
    - src/secret-input.ts
    - src/config-io.ts
    - src/accounts.ts
    - src/waha-client.ts
    - src/proxy-send-handler.ts
    - src/inbound-queue.ts
    - src/config-io.test.ts
decisions:
  - "StandaloneConfig uses open index signature to remain structurally compatible with OpenClawConfig in channel.ts"
  - "normalizeResolvedSecretInputString returns undefined for secret ref objects (SDK provider resolution not available standalone)"
  - "CHATLYTICS_CONFIG_PATH primary, OPENCLAW_CONFIG_PATH backward compat, ~/.chatlytics/config.json new default"
metrics:
  duration: "9m 21s"
  completed_date: "2026-03-28"
  tasks_completed: 2
  files_modified: 12
---

# Phase 58 Plan 01: SDK Decoupling — Local Replacement Modules Summary

**One-liner:** Three new SDK-free modules (platform-types.ts, account-utils.ts, request-utils.ts) replace openclaw/plugin-sdk imports in 8 easy files with CHATLYTICS_CONFIG_PATH as the new primary config env var.

## What Was Built

### Task 1: Create local SDK-replacement modules

Three new files created with zero SDK imports:

**src/platform-types.ts** — SDK-free type definitions:
- `RuntimeEnv` type — minimal shape used in codebase (log?, channel?.pairing)
- `PluginRuntime` type — passed by OpenClaw gateway, compatible superset of RuntimeEnv
- `OutboundReplyPayload` type — agent reply payload with text, mediaUrls, replyToId, attachments
- `isWhatsAppGroupJid(jid: string): boolean` — `jid.endsWith("@g.us")`
- `StandaloneConfig` type — structurally compatible with OpenClawConfig (open index signature)

**src/account-utils.ts** — Account resolution utilities verified against SDK source:
- `DEFAULT_ACCOUNT_ID = "default"`
- `normalizeAccountId(value)` — lowercase, replace invalid chars with `-`, truncate to 64, fallback to "default"
- `listConfiguredAccountIds({ accounts, normalizeAccountId })` — normalized unique keys from accounts record
- `resolveAccountWithDefaultFallback({ accountId, resolvePrimary, hasCredential, resolveDefaultAccountId })` — primary or default fallback

**src/request-utils.ts** — HTTP request body utilities:
- `RequestBodyLimitError` class with `type: "size" | "timeout"`
- `isRequestBodyLimitError(err)` — type guard
- `requestBodyErrorToText(err)` — converts to message string
- `readRequestBodyWithLimit(req, maxBytesOrOptions, timeoutMsArg?)` — bounded stream read with timeout

### Task 2: Swap SDK imports in 8 files + CORE-02 config path

| File | Old Import | New Import |
|------|-----------|------------|
| src/types.ts | `openclaw/plugin-sdk/core` → OpenClawConfig | `./platform-types.js` → StandaloneConfig |
| src/runtime.ts | `openclaw/plugin-sdk/core` → PluginRuntime | `./platform-types.js` → PluginRuntime |
| src/secret-input.ts | `openclaw/plugin-sdk/secret-input` (re-export) | Local implementations |
| src/config-io.ts | No SDK import; added CHATLYTICS_CONFIG_PATH | CORE-02 compliant |
| src/accounts.ts | `openclaw/plugin-sdk/account-resolution` | `./account-utils.js` |
| src/waha-client.ts | `openclaw/plugin-sdk/account-id` | `./account-utils.js` |
| src/proxy-send-handler.ts | `openclaw/plugin-sdk/account-id` | `./account-utils.js` |
| src/inbound-queue.ts | `openclaw/plugin-sdk/runtime` → RuntimeEnv | `./platform-types.js` → RuntimeEnv |

**CORE-02 (config path priority):**
```
CHATLYTICS_CONFIG_PATH  (new standalone primary)
  ?? OPENCLAW_CONFIG_PATH  (backward compat for hpg6)
  ?? ~/.chatlytics/config.json  (new default)
```

## Test Results

- All 1371 tests pass (previous: 1369 + 2 new config-io tests)
- 5 pre-existing failures in `.claude/worktrees/agent-a6e7bd25/` (different worktree, unrelated `@/components/ui/card` path alias issue)
- TypeScript `--noEmit` passes with zero errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] config-io.test.ts expected old default path**
- **Found during:** Task 2
- **Issue:** Test at line 33-44 asserted `.openclaw/openclaw.json` as default, but CORE-02 changes default to `~/.chatlytics/config.json`
- **Fix:** Updated test to assert new default path; added 2 new tests for CHATLYTICS_CONFIG_PATH priority and OPENCLAW_CONFIG_PATH backward compat
- **Files modified:** src/config-io.test.ts
- **Commit:** 4283bc0

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 0422903 | feat(58-01): create local SDK-replacement modules |
| Task 2 | 4283bc0 | feat(58-01): swap SDK imports in 8 easy files + CORE-02 config path |

## Known Stubs

None — all implementations are functional and tested. `normalizeResolvedSecretInputString` returns undefined for secret ref objects (cannot resolve provider references without SDK runtime), but this is intentional and callers handle falsy return correctly.
