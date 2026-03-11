---
phase: 2
slug: resilience-and-observability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts (exists from Phase 1) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | RES-01 | unit | `npx vitest run tests/health.test.ts -t "pings" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | RES-01 | unit | `npx vitest run tests/health.test.ts -t "skipRateLimit" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | RES-02 | unit | `npx vitest run tests/health.test.ts -t "unhealthy" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | RES-02 | unit | `npx vitest run tests/health.test.ts -t "resets" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | RES-03 | unit | `npx vitest run tests/inbound-queue.test.ts -t "overflow" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | RES-03 | unit | `npx vitest run tests/inbound-queue.test.ts -t "counter" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | RES-04 | unit | `npx vitest run tests/inbound-queue.test.ts -t "priority" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 1 | RES-05 | unit | `npx vitest run tests/error-formatter.test.ts -t "rate limit" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 1 | RES-05 | unit | `npx vitest run tests/error-formatter.test.ts -t "timeout" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 02-03-03 | 03 | 1 | RES-05 | unit | `npx vitest run tests/error-formatter.test.ts -t "not found" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 02-03-04 | 03 | 1 | RES-05 | unit | `npx vitest run tests/error-formatter.test.ts -t "auth" --reporter=verbose` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/health.test.ts` — stubs for RES-01, RES-02
- [ ] `tests/inbound-queue.test.ts` — stubs for RES-03, RES-04
- [ ] `tests/error-formatter.test.ts` — stubs for RES-05

*Existing test infrastructure (vitest, vitest.config.ts) carries over from Phase 1.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin panel Status tab shows health indicator | RES-02 | Requires browser UI inspection | Open admin panel, verify green/yellow/red dot per session |
| Admin panel Queue tab shows depth and overflow stats | RES-03 | Requires browser UI inspection | Open admin panel Queue tab, verify DM/group counts display |
| `/api/admin/health` returns JSON | RES-02 | Integration test (curl against running server) | `curl localhost:{port}/api/admin/health` and verify JSON structure |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
