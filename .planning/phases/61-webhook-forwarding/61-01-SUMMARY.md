---
phase: 61-webhook-forwarding
plan: 01
subsystem: api
tags: [webhook, hmac, circuit-breaker, retry, zod]

requires:
  - phase: 60-rest-api-v1
    provides: publicApiKey config field used as HMAC signing secret

provides:
  - "forwardWebhook(): fire-and-forget delivery to operator callback URLs"
  - "signWebhookPayload(): HMAC-SHA256 sha256= signatures"
  - "Per-URL circuit breaker: opens after 3 consecutive timeouts, half-opens after 60s"
  - "Exponential backoff retry: 1s/2s/4s on 5xx, immediate dead-letter on 4xx"
  - "webhookSubscriptions config field in WahaConfigSchema with Zod validation"

affects: [61-02-inbound-wiring, monitor.ts, inbound.ts]

tech-stack:
  added: []
  patterns:
    - "DI params (_fetch, _sleep, _now) for test isolation without fake timers"
    - "Per-URL circuit breaker via module-level Map<string, CircuitState>"
    - "Fire-and-forget with .catch() safety net — never await forwardWebhook on inbound path"

key-files:
  created:
    - src/webhook-forwarder.ts
    - src/webhook-forwarder.test.ts
  modified:
    - src/config-schema.ts

key-decisions:
  - "Use publicApiKey as HMAC signing secret (operators already have this key, simpler than dedicated webhookSecret)"
  - "In-memory circuit breaker (Map per URL) rather than opossum library — zero deps, 50 lines"
  - "Dead-letter on 3 consecutive timeouts (AbortError only) — 5xx errors retry normally"
  - "4xx responses dead-lettered immediately — client errors are not transient"
  - "webhookSubscriptions on WahaConfigSchema (not WahaAccountSchemaBase) — top-level config concern, not per-account"

patterns-established:
  - "Pattern: DI-injected _fetch/_sleep/_now for test isolation — mirrors mimicry-gate.ts pattern"
  - "Pattern: resetCircuitBreakers() exported for test cleanup, not for production use"

requirements-completed: [HOOK-01, HOOK-02, HOOK-03, HOOK-04]

duration: 15min
completed: 2026-03-28
---

# Phase 61 Plan 01: Webhook Forwarder Module Summary

**HMAC-signed webhook delivery engine with exponential backoff retry and per-URL circuit breaker — 22 tests green, zero regressions.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-28T13:18:29Z
- **Completed:** 2026-03-28T13:33:00Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments

- `signWebhookPayload()` produces `sha256=<hex>` HMAC-SHA256 matching GitHub webhook format
- `forwardWebhook()` delivers to all enabled subscriptions matching event type, with correct Content-Type and X-Chatlytics-Signature headers
- Circuit breaker opens after 3 consecutive timeouts per URL, half-opens after 60s, closes on successful probe
- 5xx retried at 1s/2s/4s delays; 4xx dead-lettered immediately (no retry)
- Config schema extended: `webhookSubscriptions` optional array with `url` (validated), `events` (default `["message"]`), `enabled` (default `true`)
- `webhookSubscriptions` added to `knownKeys` in `validateWahaConfig` so it survives strip-unknown-keys filter

## Task Commits

1. **Task 1: Config schema + webhook forwarder with tests (TDD)** - `5c2d33a` (feat)

## Files Created/Modified

- `src/webhook-forwarder.ts` — `forwardWebhook`, `signWebhookPayload`, `resetCircuitBreakers`, circuit breaker state machine
- `src/webhook-forwarder.test.ts` — 22 unit tests covering HOOK-01..04 (sign, deliver, skip, retry, dead-letter, circuit open/half-open/close)
- `src/config-schema.ts` — `webhookSubscriptions` added to `WahaConfigSchema` and `knownKeys`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — `forwardWebhook` is fully implemented. Plan 02 will wire it into `inbound.ts` and `monitor.ts`.

## Self-Check: PASSED

- `src/webhook-forwarder.ts` — exists
- `src/webhook-forwarder.test.ts` — exists
- `src/config-schema.ts` — contains `webhookSubscriptions` (2 occurrences)
- Commit `5c2d33a` — verified in git log
- 22 tests pass, 746 total tests pass (no regressions)
