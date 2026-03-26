---
phase: 50
slug: skill-creator-evals
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 50 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Python scripts (skill-creator) + JSON validation |
| **Config file** | none |
| **Quick run command** | `python skills/evals/quick_validate.py && cat skills/evals/evals.json \| python -c "import json,sys; d=json.load(sys.stdin); print(len(d),'evals')"` |
| **Full suite command** | `python skills/evals/quick_validate.py && ls skills/evals/*.json` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick validation
- **After every plan wave:** Run full validation
- **Before `/gsd:verify-work`:** All validation passes, evals exist
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 50-01-01 | 01 | 1 | SKL-04 | script | `python skills/evals/quick_validate.py` | ❌ W0 | ⬜ pending |
| 50-01-02 | 01 | 1 | SKL-05 | json-check | `cat skills/evals/evals.json` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements (validation scripts created during execution).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Skill-creator review report quality | SKL-04 | Requires human judgment | Run generate_review.py --static, inspect output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
