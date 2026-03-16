---
phase: 10
slug: directory-group-enhancements
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual browser testing + curl API verification |
| **Config file** | none — embedded admin panel in monitor.ts |
| **Quick run command** | `curl -s http://127.0.0.1:3004/api/admin/directory?type=groups&limit=10 -H "X-Api-Key: ..."` |
| **Full suite command** | `curl -s http://127.0.0.1:3004/api/admin/stats && curl -s http://127.0.0.1:3004/api/admin/directory?type=groups` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick API check against admin endpoints
- **After every plan wave:** Full admin panel browser verification
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | DIR-01 | api+ui | `curl /api/admin/directory?type=groups&limit=10&offset=0` | ✅ | ⬜ pending |
| 10-01-02 | 01 | 1 | DIR-01 | ui | Browser: page nav renders, page size selector works | N/A | ⬜ pending |
| 10-02-01 | 02 | 1 | DIR-02 | api | `curl /api/admin/directory/group/{jid}/participants` returns names | ✅ | ⬜ pending |
| 10-02-02 | 02 | 1 | DIR-02 | ui | Browser: participants show names, allowlist buttons reflect state | N/A | ⬜ pending |
| 10-03-01 | 03 | 2 | DIR-03 | api+db | `sqlite3 directory.db "SELECT participant_role FROM group_participants LIMIT 1"` | ✅ | ⬜ pending |
| 10-03-02 | 03 | 2 | DIR-03 | ui | Browser: role dropdown renders, selection persists | N/A | ⬜ pending |
| 10-04-01 | 04 | 2 | DIR-04 | api | `curl -X POST /api/admin/directory/bulk` with selection payload | ✅ | ⬜ pending |
| 10-04-02 | 04 | 2 | DIR-04 | ui | Browser: checkboxes appear, bulk toolbar shows, actions execute | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — admin panel serves from monitor.ts, SQLite from directory.ts.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Page navigation UI | DIR-01 | Embedded HTML/JS in monitor.ts, no headless test | Open admin panel, click page numbers, verify table updates |
| Participant names display | DIR-02 | Visual verification of name resolution | Expand group, verify names not empty/JID-only |
| Role dropdown interaction | DIR-03 | UI interaction in embedded panel | Click dropdown, select role, reload page, verify persists |
| Bulk select + toolbar | DIR-04 | Complex UI state management | Toggle bulk mode, select items, verify toolbar actions |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
