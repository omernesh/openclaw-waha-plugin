---
phase: 20
slug: dashboard-and-settings-tabs
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-18
---

# Phase 20 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (installed in Plan 01 Task 1) + build verification |
| **Config file** | vitest.config.ts (auto-detected by vitest) |
| **Quick run command** | `npm run build:admin 2>&1 \| tail -10` |
| **Full suite command** | `cd src/admin && npx vitest run && npm run build` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd src/admin && npm run build 2>&1 | tail -5 && npx vitest run 2>&1 | tail -10`
- **After every plan wave:** Run `cd src/admin && npx vitest run && npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 20-01-01 | 01 | 1 | DASH-01..05 | build+unit | `cd src/admin && npm run build 2>&1 \| tail -5 && npx vitest run 2>&1 \| tail -10` | pending |
| 20-01-02 | 01 | 1 | DASH-03 | build+unit | `cd src/admin && npm run build 2>&1 \| tail -5 && npx vitest run 2>&1 \| tail -10` | pending |
| 20-02-01 | 02 | 2 | SETT-01..04 | build+unit | `cd src/admin && npm run build 2>&1 \| tail -5 && npx vitest run 2>&1 \| tail -10` | pending |
| 20-02-02 | 02 | 2 | SETT-02,SETT-05 | build+unit | `cd src/admin && npm run build 2>&1 \| tail -5 && npx vitest run 2>&1 \| tail -10` | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] Radix UI primitives installed (collapsible, switch, select, label, checkbox, popover, cmdk)
- [ ] vitest installed as dev dependency in src/admin
- [ ] shadcn/ui component files created (card, collapsible, input, select, switch, label, badge, popover, command)
- [ ] `src/admin/src/lib/__tests__/labels.test.ts` created with labelFor() unit coverage

All Wave 0 items are covered by Plan 01 Task 1.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard cards show per-session stats | DASH-01 | Visual + live API | Open admin, verify per-session stat cards render |
| Settings Save & Restart overlay | SETT-05 | Requires gateway restart | Change setting, click Save & Restart, verify overlay polls |
| JID tag inputs resolve names | SETT-02 | Requires directory data | Type contact name in JID field, verify search dropdown |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands (build + vitest)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covered by Plan 01 Task 1 (vitest install + test file creation)
- [x] No watch-mode flags
- [x] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
