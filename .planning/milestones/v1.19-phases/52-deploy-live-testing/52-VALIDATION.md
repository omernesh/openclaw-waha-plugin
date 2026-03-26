---
phase: 52
slug: deploy-live-testing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 52 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Live WAHA API calls + SSH verification |
| **Config file** | none |
| **Quick run command** | `ssh omer@100.114.126.43 'curl -s http://127.0.0.1:3004/api/sessions -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=" \| head -20'` |
| **Full suite command** | Live WhatsApp test sequence |
| **Estimated runtime** | ~5 minutes |

---

## Sampling Rate

- **After every task commit:** Run quick health check
- **After every plan wave:** Verify deployment state
- **Before `/gsd:verify-work`:** All live tests must pass
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 52-01-01 | 01 | 1 | TST-01 | live | SSH health check | N/A | ⬜ pending |
| 52-01-02 | 01 | 1 | TST-02-12 | live | WAHA API calls | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements (live WAHA API testing).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| All live WhatsApp tests | TST-01 through TST-12 | Requires live WAHA + WhatsApp | Execute WAHA API calls, verify responses |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
