---
phase: 8
slug: shared-ui-components
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (existing) |
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
| 08-01-01 | 01 | 0 | UI-01 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 0 | UI-02 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 0 | UI-03 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 08-01-04 | 01 | 0 | UI-04 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 08-01-05 | 01 | 1 | UI-01 | manual | visual inspection | N/A | ⬜ pending |
| 08-01-06 | 01 | 1 | UI-02 | manual | visual inspection | N/A | ⬜ pending |
| 08-01-07 | 01 | 1 | UI-03 | manual | visual inspection | N/A | ⬜ pending |
| 08-01-08 | 01 | 1 | UI-04 | manual | visual inspection | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/ui-components.test.ts` — pure logic tests: tag normalization, paired JID serialization, identifier extraction
- [ ] `tests/name-resolver.test.ts` — name resolution cache, fallback behavior
- [ ] `tests/contact-picker.test.ts` — fuzzy search logic, UTF-8 handling, multi-select state

*DOM-bound component behavior cannot be unit-tested; pure logic extracted as testable helpers.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Name resolver displays human-readable names | UI-01 | DOM rendering in embedded HTML | Load admin panel, verify JIDs show contact names |
| Tag input creates/deletes bubbles on key events | UI-02 | Keyboard interaction in browser | Type in tag input, press comma/space/enter, verify bubbles, click x to delete |
| Contact picker fuzzy search with Hebrew | UI-03 | UTF-8 rendering + dropdown interaction | Open picker, type Hebrew name, verify fuzzy matches appear |
| God Mode paired JID add/remove | UI-04 | Complex DOM interaction | Add user via picker, verify both @c.us + @lid saved, remove and verify both gone |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
