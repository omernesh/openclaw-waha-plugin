---
phase: 51
slug: claude-code-skill-update
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 51 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | File content checks + grep |
| **Config file** | none |
| **Quick run command** | `grep -c "action" skills/whatsapp-messenger/SKILL.md` |
| **Full suite command** | `grep "skills/" skills/whatsapp-messenger/SKILL.md && grep "version" skills/whatsapp-messenger/SKILL.md` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick content check
- **After every plan wave:** Run full validation
- **Before `/gsd:verify-work`:** Skill references all categories, version correct
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 51-01-01 | 01 | 1 | SKL-06 | grep | `grep "modular" skills/whatsapp-messenger/SKILL.md` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Skill triggers correctly in Claude Code | SKL-06 | Requires Claude Code session | Ask Claude Code to send a WhatsApp message, verify skill activates |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
