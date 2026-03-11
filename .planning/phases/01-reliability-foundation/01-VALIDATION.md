---
phase: 1
slug: reliability-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 0 | REL-01..11 | setup | `npx vitest run` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | REL-01 | unit | `npx vitest run tests/http-client.test.ts -t "error logging"` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | REL-02 | unit | `npx vitest run tests/http-client.test.ts -t "warn on error"` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | REL-03 | unit | `npx vitest run tests/http-client.test.ts -t "timeout"` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 1 | REL-04 | unit | `npx vitest run tests/http-client.test.ts -t "mutation timeout"` | ❌ W0 | ⬜ pending |
| 01-02-05 | 02 | 1 | REL-05 | unit | `npx vitest run tests/token-bucket.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-06 | 02 | 1 | REL-06 | unit | `npx vitest run tests/http-client.test.ts -t "skipRateLimit"` | ❌ W0 | ⬜ pending |
| 01-02-07 | 02 | 1 | REL-07 | unit | `npx vitest run tests/http-client.test.ts -t "429 backoff"` | ❌ W0 | ⬜ pending |
| 01-02-08 | 02 | 1 | REL-08 | unit | `npx vitest run tests/http-client.test.ts -t "retry-after"` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 2 | REL-09 | unit | `npx vitest run tests/dedup.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 2 | REL-10 | unit | `npx vitest run tests/lru-cache.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 2 | REL-11 | manual | Code review — verify no unbounded Maps | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install -D vitest` — install test framework
- [ ] `vitest.config.ts` — TypeScript + ESM config
- [ ] `tests/http-client.test.ts` — stubs for REL-01 through REL-08
- [ ] `tests/token-bucket.test.ts` — stubs for REL-05
- [ ] `tests/dedup.test.ts` — stubs for REL-09
- [ ] `tests/lru-cache.test.ts` — stubs for REL-10

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Memory audit — no unbounded Maps | REL-11 | Requires code review, not runtime check | Grep for `new Map()` without size limits, verify all replaced with LRU or bounded |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
