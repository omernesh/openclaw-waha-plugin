---
phase: 5
slug: documentation-and-testing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- --reporter=dot` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --reporter=dot`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | DOC-02 | unit | `npm test -- tests/send-utils.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | DOC-02 | unit | `npm test -- tests/channel-utils.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | DOC-02 | prerequisite | `npm test` (verify no regressions from exports) | ✅ | ⬜ pending |
| 05-02-01 | 02 | 1 | DOC-03 | integration | `npm test -- tests/action-handlers.test.ts` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 2 | DOC-01 | manual | N/A — review SKILL.md sections | N/A | ⬜ pending |
| 05-03-02 | 03 | 2 | DOC-04 | manual | N/A — review README.md sections | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/send-utils.test.ts` — stubs for DOC-02 (fuzzyScore, toArr)
- [ ] `tests/channel-utils.test.ts` — stubs for DOC-02 (resolveChatId, autoResolveTarget)
- [ ] `tests/action-handlers.test.ts` — stubs for DOC-03 (send, poll, edit, search)
- [ ] Export additions to `src/send.ts` (fuzzyScore) and `src/channel.ts` (resolveChatId, autoResolveTarget)

*Existing infrastructure covers LRU cache and token bucket requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SKILL.md error/rate-limit/multi-session sections | DOC-01 | Content review, not code behavior | Read SKILL.md, verify 3 new sections exist with correct info |
| README installation/config/deploy/troubleshoot | DOC-04 | Content review, not code behavior | Read README.md, verify version, config fields, deploy instructions |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
