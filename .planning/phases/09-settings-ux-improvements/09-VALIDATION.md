---
phase: 9
slug: settings-ux-improvements
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/ui-group-filter.test.ts --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green + live browser test of admin panel
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | UX-01 | manual | N/A (live test) | N/A | ⬜ pending |
| 09-01-02 | 01 | 1 | UX-02 | manual | N/A (visual) | N/A | ⬜ pending |
| 09-02-01 | 02 | 1 | UX-03 | unit | `npx vitest run tests/ui-group-filter.test.ts -x` | ❌ W0 | ⬜ pending |
| 09-02-02 | 02 | 1 | UX-04 | manual | N/A (DOM behavior) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/ui-group-filter.test.ts` — stubs for UX-03 keyword serialization helpers (only if new pure functions extracted beyond `normalizeTags`)

*If group filter reuses `normalizeTags` directly: "Existing infrastructure covers all phase requirements via `tests/ui-tag-input.test.ts`"*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pairing mode sends code reply or is disabled | UX-01 | Requires live WAHA session and DM from unknown sender | Set dmPolicy to "pairing", send DM from unknown sender, check logs + WhatsApp for code reply |
| Contact settings tooltips visible on hover | UX-02 | Visual CSS behavior, no extractable logic | Open admin panel → Directory → expand contact → hover over each ? icon |
| Tab switch clears search bar | UX-04 | DOM manipulation behavior | Type in search → switch tab → verify search input is empty |
| Search bar 'x' button clears and reloads | UX-04 | DOM manipulation behavior | Type in search → click 'x' → verify input cleared and directory reloaded |
| "Newsletters" tab renamed to "Channels" | UX-04 | Visual label check | Open admin panel → verify tab reads "Channels" not "Newsletters" |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
