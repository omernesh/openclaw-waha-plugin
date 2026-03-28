---
phase: 58-sdk-decoupling
verified: 2026-03-28T03:14:30Z
status: gaps_found
score: 9/10 must-haves verified
re_verification: false
gaps:
  - truth: "/healthz includes webhook_registered field (CORE-05)"
    status: failed
    reason: "/healthz returns plain text 'ok', not JSON. /api/admin/health endpoint manually picks fields from HealthState but omits webhook_registered. The field exists in HealthState and setWebhookRegistered() is called, but no HTTP endpoint exposes it."
    artifacts:
      - path: "src/monitor.ts"
        issue: "/api/admin/health at line 700-712 serializes status/consecutiveFailures/lastSuccessAt/lastCheckAt — webhook_registered is absent. /api/admin/sessions at line 1499-1512 also omits it."
      - path: "src/health.ts"
        issue: "webhook_registered exists in HealthState interface and is set by setWebhookRegistered() — correct. But monitor.ts does not expose it."
    missing:
      - "Add webhook_registered: health?.webhook_registered ?? false to /api/admin/health response (line ~708)"
      - "Optionally expose it in /api/admin/sessions per-account entry as well"
human_verification:
  - test: "CORE-03 webhook registration fires on startup"
    expected: "After startup, WAHA session config contains the plugin webhook URL in its webhooks array"
    why_human: "Requires live hpg6 server with webhookPublicUrl configured — cannot verify programmatically without running server"
---

# Phase 58: SDK Decoupling Verification Report

**Phase Goal:** Zero openclaw/plugin-sdk imports exist outside channel.ts and index.ts — the codebase can load and run without the OpenClaw SDK present
**Verified:** 2026-03-28T03:14:30Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `platform-types.ts`, `account-utils.ts`, `request-utils.ts` exist with all SDK replacement symbols exported | ✓ VERIFIED | All 3 files exist (3.5KB, 4KB, 3.1KB). Export counts: platform-types=5, account-utils=4, request-utils=4. Zero openclaw references. |
| 2 | `types.ts`, `runtime.ts`, `secret-input.ts`, `config-io.ts`, `accounts.ts`, `waha-client.ts`, `proxy-send-handler.ts`, `inbound-queue.ts` have zero openclaw/plugin-sdk imports | ✓ VERIFIED | `grep -n 'from "openclaw/plugin-sdk'` returns zero results in all 8 files. Comments mention SDK but no import statements. |
| 3 | CHATLYTICS_CONFIG_PATH env var is respected by getConfigPath() with backward compat for OPENCLAW_CONFIG_PATH | ✓ VERIFIED | `config-io.ts` lines 37-38: `process.env.CHATLYTICS_CONFIG_PATH ?? process.env.OPENCLAW_CONFIG_PATH ?? ~/.chatlytics/config.json` with DO NOT CHANGE comment. |
| 4 | `monitor.ts` has zero openclaw/plugin-sdk imports | ✓ VERIFIED | `grep -n 'from "openclaw/plugin-sdk' src/monitor.ts` returns zero results. Imports from `./request-utils.js`, `./platform-types.js`, `./account-utils.js`. |
| 5 | `send.ts` has zero openclaw/plugin-sdk imports | ✓ VERIFIED | Zero SDK import statements. `DEFAULT_ACCOUNT_ID` from `./account-utils.js`. `detectMime` and `sendMediaWithLeadingCaption` inlined. |
| 6 | WAHA webhook self-registration fires on startup for each enabled account (CORE-03) | ✓ VERIFIED (code-level) | `monitor.ts` lines 2714-2770: full GET+merge+PUT webhook upsert loop per enabled account. Non-fatal, skipped if `webhookPublicUrl` not configured. `setWebhookRegistered()` called on success/failure. Marked with CORE-03 comment. |
| 7 | `/healthz` includes `webhook_registered` field (CORE-05) | ✗ FAILED | `/healthz` returns plain `"ok"` text (line 508-513). `/api/admin/health` at line 700-712 manually serializes only `status`, `consecutiveFailures`, `lastSuccessAt`, `lastCheckAt` — omits `webhook_registered`. The field exists in `HealthState` and is set correctly, but is never returned in any HTTP response. |
| 8 | `inbound.ts` has zero openclaw/plugin-sdk imports | ✓ VERIFIED | Zero SDK import statements. 15 symbols replaced with local shims (GROUP_POLICY_BLOCKED_LABEL, resolveDmGroupAccessWithCommandGate, etc.) all marked `// Phase 58: Local shim — DO NOT CHANGE`. |
| 9 | `inbound.test.ts` has zero openclaw/plugin-sdk mocks | ✓ VERIFIED | Zero SDK mock blocks. SDK vi.mock blocks replaced with local module mocks or removed. |
| 10 | All 683 tests still pass — zero regressions | ✓ VERIFIED | `npm test -- --reporter=dot --exclude ".claude/**"` reports 685 passed, 48 test files. (685 > 683 due to 2 new config-io tests added in Plan 01.) The 16 failures are all in `.claude/worktrees/agent-*/` directories — pre-existing path alias issues documented in Plan 01 summary, unrelated to Phase 58. |

**Score:** 9/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/platform-types.ts` | RuntimeEnv, PluginRuntime, OutboundReplyPayload, isWhatsAppGroupJid, StandaloneConfig | ✓ VERIFIED | Exists, 5 exports, zero SDK imports |
| `src/account-utils.ts` | DEFAULT_ACCOUNT_ID, normalizeAccountId, listConfiguredAccountIds, resolveAccountWithDefaultFallback | ✓ VERIFIED | Exists, 4 exports, zero SDK imports |
| `src/request-utils.ts` | readRequestBodyWithLimit, isRequestBodyLimitError, requestBodyErrorToText, RequestBodyLimitError | ✓ VERIFIED | Exists, 4 exports, zero SDK imports |
| `src/monitor.ts` | Webhook HTTP server, admin API, webhook self-registration | ✓ VERIFIED | Zero SDK imports, CORE-03 block at line 2714 |
| `src/send.ts` | All WAHA send operations | ✓ VERIFIED | Zero SDK imports, DEFAULT_ACCOUNT_ID from account-utils |
| `src/health.ts` | webhook_registered in HealthState | ✓ VERIFIED (partial) | Field exists in HealthState (line 70), setWebhookRegistered() exported (line 396). But not surfaced in HTTP response — see gap. |
| `src/inbound.ts` | Webhook inbound handler with all 15 SDK symbols replaced | ✓ VERIFIED | Zero SDK imports, all shims marked Phase 58 with DO NOT CHANGE |
| `src/inbound.test.ts` | Inbound handler test suite with zero SDK mocks | ✓ VERIFIED | Zero SDK mock blocks |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/accounts.ts` | `src/account-utils.js` | `import { DEFAULT_ACCOUNT_ID, normalizeAccountId, ... }` | ✓ WIRED | Line 7: `} from "./account-utils.js"` |
| `src/config-io.ts` | CHATLYTICS_CONFIG_PATH env var | `process.env.CHATLYTICS_CONFIG_PATH` | ✓ WIRED | Lines 37-38, primary env var |
| `src/monitor.ts` | `src/request-utils.js` | `import { readRequestBodyWithLimit, ... }` | ✓ WIRED | Line 14: `} from "./request-utils.js"` |
| `src/monitor.ts` | `src/platform-types.js` | `import { isWhatsAppGroupJid, RuntimeEnv }` | ✓ WIRED | Lines 15, 27 |
| `src/monitor.ts` | WAHA /api/sessions/{session} | `callWahaApi GET+PUT on startup` | ✓ WIRED | Lines 2714-2770, full upsert loop |
| `src/send.ts` | `src/account-utils.js` | `import { DEFAULT_ACCOUNT_ID }` | ✓ WIRED | Line 33: `from "./account-utils.js"` |
| `src/inbound.ts` | `src/platform-types.js` | `import type { RuntimeEnv, OutboundReplyPayload }` | ✓ WIRED | Line 2 |
| `src/inbound.ts` | `src/account-utils.js` | `import { normalizeAccountId }` | ✓ WIRED | Line 3 |
| `src/monitor.ts` | `src/health.ts` `setWebhookRegistered` | Called in CORE-03 loop | ✓ WIRED | Lines 2760, 2763 — but return value not surfaced in HTTP response |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/health.ts` `webhook_registered` | `state.webhook_registered` | `setWebhookRegistered(session, bool)` called from CORE-03 loop | Yes — set to true/false based on WAHA API call | ✓ FLOWING (internal state) |
| `/api/admin/health` response | HealthState fields | `getHealthState(session)` | Omits `webhook_registered` from serialization | ✗ DISCONNECTED — field flows to HealthState but not to HTTP response |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Zero SDK imports outside channel.ts/index.ts | `grep -rn 'from "openclaw/plugin-sdk' src/ --include="*.ts" \| grep -v ".bak\|channel.ts\|index.ts"` | Returns only channel.ts:9-14 (6 matches, all in channel.ts) | ✓ PASS |
| New modules export required symbols | `grep -c "export" src/platform-types.ts src/account-utils.ts src/request-utils.ts` | 5, 4, 4 | ✓ PASS |
| CHATLYTICS_CONFIG_PATH primary | `grep "CHATLYTICS_CONFIG_PATH" src/config-io.ts` | Lines 29, 37 | ✓ PASS |
| CORE-03 webhook registration code | `grep -A2 "CORE-03" src/monitor.ts` | 4 matches — loop + success/failure calls | ✓ PASS |
| CORE-05 HealthState field | `grep "webhook_registered" src/health.ts` | Lines 70, 399, 408, 419 | ✓ PASS (field exists) |
| CORE-05 HTTP exposure | Check `/api/admin/health` response fields | `webhook_registered` absent from serialized response at line 700-712 | ✗ FAIL |
| 685 tests pass | `npm test -- --exclude ".claude/**"` | 685 passed, 48 files | ✓ PASS |
| All 6 phase commits exist | `git log --oneline \| grep commit` | 0422903, 4283bc0, 9c2e0ac, e495939, bab328e, 60ccc7d all found | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CORE-01 | Plans 01, 02, 03 | Standalone process boots without any OpenClaw SDK dependency at runtime | ✓ SATISFIED | Zero SDK imports outside channel.ts/index.ts in all 48 test-passing source files |
| CORE-02 | Plan 01 | Config reads from standalone JSON file (CHATLYTICS_CONFIG_PATH or ~/.chatlytics/config.json) | ✓ SATISFIED | `config-io.ts` lines 37-39, 2 test cases added in config-io.test.ts |
| CORE-03 | Plan 02 | WAHA webhook self-registration on startup | ✓ SATISFIED (code-level) | GET+merge+PUT loop in `monitor.ts` line 2714, non-fatal, gated on `webhookPublicUrl` |
| CORE-05 | Plan 02 | Health endpoint reports webhook_registered and session connection status | ✗ BLOCKED | `webhook_registered` exists in HealthState (health.ts line 70) and is set by `setWebhookRegistered()`. But `/api/admin/health` and `/api/admin/sessions` endpoints do not include `webhook_registered` in their JSON response bodies. |

**Orphaned requirements check:** REQUIREMENTS.md maps CORE-01, CORE-02, CORE-03, CORE-05 to Phase 58. All four are covered by the plans. CORE-04 is mapped to Phase 59. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/secret-input.ts` | N/A | `normalizeResolvedSecretInputString` returns `undefined` for secret ref objects | ℹ️ Info | Documented intentional limitation — callers handle falsy return. Cannot resolve provider references without SDK runtime. No user-visible stub. |
| `src/send.ts` | N/A | `detectMime` stub always returns `undefined` | ℹ️ Info | Documented and intentional — SDK function was called with wrong type anyway (string not object). Extension-fallback path handles all real cases. |
| `src/monitor.ts` | 2724 | CORE-03 skipped silently if `webhookPublicUrl` not configured | ℹ️ Info | Intentional design decision. Non-fatal and logged. |

No blockers or warnings from anti-pattern scan.

### Human Verification Required

#### 1. CORE-03 Live Webhook Registration

**Test:** On hpg6 with `webhookPublicUrl` configured, restart the openclaw-gateway and check WAHA session config.
**Expected:** `curl http://127.0.0.1:3004/api/sessions/3cf11776_omer -H "X-Api-Key: ..."` shows the plugin webhook URL in `config.webhooks[].url`.
**Why human:** Requires live hpg6 server with `webhookPublicUrl` in config — cannot verify programmatically from dev machine.

### Gaps Summary

One gap found blocking CORE-05 goal achievement:

**Gap: `webhook_registered` not exposed in HTTP response**

The `HealthState` interface in `health.ts` has `webhook_registered: boolean` (line 70), `setWebhookRegistered()` is exported (line 396) and called correctly from the CORE-03 startup loop. However, the `/api/admin/health` endpoint at `monitor.ts` line 700-712 manually picks specific fields to serialize — and `webhook_registered` is not among them. The `/healthz` endpoint returns plain text "ok", not JSON. The `/api/admin/sessions` endpoint also omits it.

Fix required: Add `webhook_registered: health?.webhook_registered ?? false` to the `/api/admin/health` JSON response body (line ~708 in monitor.ts).

This is a 1-line fix: the infrastructure (HealthState field + setter + CORE-03 registration) is fully in place. Only the endpoint serialization is missing.

---

_Verified: 2026-03-28T03:14:30Z_
_Verifier: Claude (gsd-verifier)_
