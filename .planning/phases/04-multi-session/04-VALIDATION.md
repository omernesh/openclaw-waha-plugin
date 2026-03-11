---
phase: 04
slug: multi-session
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | vitest.config.ts |
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
| 04-01-01 | 01 | 1 | MSESS-01, MSESS-02, MSESS-03 | unit | `npx vitest run tests/role-guardrail.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | MSESS-05, MSESS-06, MSESS-07 | unit | `npx vitest run tests/trigger-word.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | MSESS-08, MSESS-09 | unit | `npx vitest run tests/session-router.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | MSESS-10 | unit | `npx vitest run tests/read-messages.test.ts` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04 | 2 | MSESS-04 | manual-only | Manual browser check | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/role-guardrail.test.ts` — stubs for MSESS-01, MSESS-02, MSESS-03
- [ ] `tests/trigger-word.test.ts` — stubs for MSESS-05, MSESS-06, MSESS-07
- [ ] `tests/session-router.test.ts` — stubs for MSESS-08, MSESS-09
- [ ] `tests/read-messages.test.ts` — stubs for MSESS-10

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin Sessions tab renders correctly | MSESS-04 | Embedded HTML in monitor.ts, needs browser | Open admin panel, verify Sessions tab shows all sessions with roles and connection status |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
