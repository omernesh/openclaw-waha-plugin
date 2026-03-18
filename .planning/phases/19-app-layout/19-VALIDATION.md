---
phase: 19
slug: app-layout
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 19 — Validation Strategy

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
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | LYOT-01 | build | `npm run build:admin 2>&1 \| tail -5` | ❌ W0 | ⬜ pending |
| 19-01-02 | 01 | 1 | LYOT-02 | build | `grep -r "localStorage" src/admin/src/` | ❌ W0 | ⬜ pending |
| 19-01-03 | 01 | 1 | LYOT-03 | build | `grep -r "isMobile\|offcanvas\|Sheet" src/admin/src/` | ❌ W0 | ⬜ pending |
| 19-01-04 | 01 | 1 | LYOT-04 | build | `grep -r "selectedSession\|refreshKey" src/admin/src/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] shadcn/ui components installed (sidebar, sheet, button, dropdown-menu, separator)
- [ ] Tab placeholder components created for all 7 tabs

*Existing build infrastructure covers verification needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sidebar visible with 7 tabs | LYOT-01 | Visual verification | Open admin panel, verify all 7 tab names visible in sidebar |
| Theme toggle persists | LYOT-02 | Browser storage | Toggle theme, reload page, verify theme persisted |
| Mobile sidebar as drawer | LYOT-03 | Viewport resize | Resize to <768px, verify sidebar becomes sheet/drawer |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
