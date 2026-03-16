---
phase: 11
slug: dashboard-sessions-log
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual browser testing (embedded admin panel) |
| **Config file** | none — admin panel is embedded in monitor.ts |
| **Quick run command** | `curl -s http://127.0.0.1:3004/api/admin/sessions \| jq .` |
| **Full suite command** | `curl -s http://127.0.0.1:3004/api/admin/stats && curl -s http://127.0.0.1:3004/api/admin/sessions` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command to verify API responses
- **After every plan wave:** Full suite + browser check of admin panel
- **Before `/gsd:verify-work`:** Full suite must return valid JSON
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | DASH-01 | manual+api | `curl -s http://127.0.0.1:3004/api/admin/sessions` | N/A | ⬜ pending |
| 11-01-02 | 01 | 1 | SESS-01 | manual+api | `curl -X PUT http://127.0.0.1:3004/api/admin/sessions/:id/role` | N/A | ⬜ pending |
| 11-02-01 | 02 | 1 | LOG-01 | manual | Browser inspect log tab | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test framework needed — admin panel is tested via API calls and browser inspection.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard shows all sessions with status | DASH-01 | Visual layout verification | Open admin panel, check Dashboard tab shows both omer and logan sessions |
| Session role dropdown editable | SESS-01 | UI interaction testing | Click role dropdown, change role, verify toast/save |
| Log entries have formatted timestamps | LOG-01 | Visual formatting check | Open Log tab, verify timestamps are visually separated from message content |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
