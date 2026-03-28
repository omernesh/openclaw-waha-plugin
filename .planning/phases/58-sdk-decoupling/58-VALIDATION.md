---
phase: 58
slug: sdk-decoupling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 58 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x (via ts-jest) |
| **Config file** | jest.config.js |
| **Quick run command** | `npx jest --bail --no-coverage` |
| **Full suite command** | `npx jest` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --bail --no-coverage`
- **After every plan wave:** Run `npx jest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 58-01-01 | 01 | 1 | CORE-01 | grep | `grep -r "openclaw/plugin-sdk" src/ \| grep -v channel.ts \| grep -v index.ts` | ✅ | ⬜ pending |
| 58-01-02 | 01 | 1 | CORE-01 | unit | `npx jest --bail --no-coverage` | ✅ | ⬜ pending |
| 58-02-01 | 02 | 1 | CORE-02 | grep | `grep "CHATLYTICS_CONFIG_PATH" src/config-io.ts` | ❌ W0 | ⬜ pending |
| 58-02-02 | 02 | 1 | CORE-03 | grep | `grep "registerWebhook\|selfRegister" src/monitor.ts` | ✅ | ⬜ pending |
| 58-03-01 | 03 | 2 | CORE-05 | integration | `node -e "require('./src/monitor.ts')"` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — 594 tests already passing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| monitor.ts loads in isolation | CORE-05 | Requires runtime environment | Start HTTP server with `node -e` and check it listens |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
