---
phase: 6
slug: whatsapp-rules-and-policy-system
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --reporter=verbose` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --reporter=verbose`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | RULES-01 | unit | `npm test -- tests/rules-loader.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | RULES-02 | unit | `npm test -- tests/identity-resolver.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | RULES-03 | unit | `npm test -- tests/rules-merge.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 2 | RULES-04, RULES-05 | unit | `npm test -- tests/rules-resolver.test.ts` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 3 | RULES-06 | unit | `npm test -- tests/policy-enforcer.test.ts` | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 3 | RULES-07 | unit | `npm test -- tests/policy-cache.test.ts` | ❌ W0 | ⬜ pending |
| 06-04-01 | 04 | 4 | RULES-08 | unit | `npm test -- tests/manager-authorizer.test.ts` | ❌ W0 | ⬜ pending |
| 06-04-02 | 04 | 4 | RULES-09 | unit | `npm test -- tests/resolved-payload-builder.test.ts` | ❌ W0 | ⬜ pending |
| 06-05-01 | 05 | 4 | RULES-10 | integration | manual verification via gateway logs | N/A | ⬜ pending |
| 06-05-02 | 05 | 4 | RULES-11 | unit | `npm test -- tests/policy-edit.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/rules-loader.test.ts` — stubs for RULES-01
- [ ] `tests/identity-resolver.test.ts` — stubs for RULES-02
- [ ] `tests/rules-merge.test.ts` — stubs for RULES-03
- [ ] `tests/rules-resolver.test.ts` — stubs for RULES-04, RULES-05
- [ ] `tests/policy-enforcer.test.ts` — stubs for RULES-06
- [ ] `tests/policy-cache.test.ts` — stubs for RULES-07
- [ ] `tests/manager-authorizer.test.ts` — stubs for RULES-08
- [ ] `tests/resolved-payload-builder.test.ts` — stubs for RULES-09
- [ ] `tests/policy-edit.test.ts` — stubs for RULES-11
- [ ] `rules/contacts/_default.yaml` — required seed file
- [ ] `rules/groups/_default.yaml` — required seed file
- [ ] `npm install yaml` — YAML parsing dependency

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ctxPayload includes resolved policy | RULES-10 | Requires live gateway + WAHA session | Deploy to hpg6, send DM, check gateway logs for WahaResolvedPolicy in ctxPayload |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
