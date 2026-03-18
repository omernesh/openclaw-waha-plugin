---
phase: 20
slug: dashboard-and-settings-tabs
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) + build verification |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm run build:admin 2>&1 \| tail -10` |
| **Full suite command** | `npx vitest run && npm run build:admin` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build:admin 2>&1 | tail -10`
- **After every plan wave:** Run `npx vitest run && npm run build:admin`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | DASH-01..05 | build | `npm run build:admin 2>&1 \| tail -5` | ❌ W0 | ⬜ pending |
| 20-01-02 | 01 | 1 | DASH-03 | unit | `npx vitest run --reporter=verbose 2>&1 \| grep labelFor` | ❌ W0 | ⬜ pending |
| 20-02-01 | 02 | 2 | SETT-01..05 | build | `npm run build:admin 2>&1 \| tail -5` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Radix UI primitives installed (collapsible, switch, select, label, checkbox, popover)
- [ ] shadcn/ui component files created (card, collapsible, input, select, switch, label, badge, popover, command)
- [ ] `tests/labels.test.ts` stub for labelFor() unit coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard cards show per-session stats | DASH-01 | Visual + live API | Open admin, verify per-session stat cards render |
| Settings Save & Restart overlay | SETT-05 | Requires gateway restart | Change setting, click Save & Restart, verify overlay polls |
| JID tag inputs resolve names | SETT-02 | Requires directory data | Type contact name in JID field, verify search dropdown |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
