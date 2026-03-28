---
phase: 59
slug: standalone-docker
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 59 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (via ts-jest compatible) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --bail 1` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --bail 1`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 59-01-01 | 01 | 1 | CORE-04 | unit+grep | `npx vitest run src/standalone.test.ts && grep "getDataDir" src/data-dir.ts` | ⬜ pending |
| 59-01-02 | 01 | 1 | CORE-06 | unit | `npx vitest run --bail 1` | ⬜ pending |
| 59-02-01 | 02 | 2 | CORE-04 | file | `test -f Dockerfile && test -f docker-compose.yml && test -f .dockerignore` | ⬜ pending |
| 59-02-02 | 02 | 2 | CORE-04,CORE-06 | docker | `docker compose build && docker compose up -d && sleep 5 && curl localhost:3100/health` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing test infrastructure covers all unit tests. Docker verification is new but uses standard tooling.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin panel loads in browser | CORE-04 | Requires visual browser check | Navigate to http://localhost:3100 in browser, verify all tabs render |
| SQLite persists across restart | CORE-06 | Requires stop+start cycle | `docker compose down && docker compose up -d`, check data survives |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
