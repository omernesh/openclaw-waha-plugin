---
phase: 49
slug: modular-skill-architecture
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 49 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | File existence checks + content grep |
| **Config file** | none |
| **Quick run command** | `ls skills/*.md && wc -l SKILL.md` |
| **Full suite command** | `ls skills/*.md && grep -l "## Actions" skills/*.md` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `ls skills/*.md`
- **After every plan wave:** Run `ls skills/*.md && grep -l "## Actions" skills/*.md`
- **Before `/gsd:verify-work`:** All 10 category files exist with required sections
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 49-01-01 | 01 | 1 | SKL-01 | file-check | `test -f SKILL.md` | ✅ | ⬜ pending |
| 49-01-02 | 01 | 1 | SKL-02 | file-check | `ls skills/*.md \| wc -l` | ❌ W0 | ⬜ pending |
| 49-01-03 | 01 | 1 | SKL-03 | grep | `grep -l "vCard\|vcf" skills/contacts.md` | ❌ W0 | ⬜ pending |
| 49-01-04 | 01 | 1 | SKL-07 | grep | `grep -l "iCal\|ics" skills/messaging.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements (documentation only — no test framework needed).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent can use category file to invoke actions | SKL-02 | Requires LLM testing | Have agent read one category file and attempt to invoke an action |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
