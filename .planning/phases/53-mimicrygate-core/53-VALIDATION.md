---
phase: 53
slug: mimicrygate-core
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-26
---

# Phase 53 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run src/mimicry-gate.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/mimicry-gate.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 53-01-01 | 01 | 1 | INFRA-03 | unit | `npx vitest run src/config-io.test.ts` | Yes | pending |
| 53-01-02 | 01 | 1 | INFRA-01, INFRA-02, GATE-02, CAP-04 | structural | `grep -c "export class MimicryDb" src/mimicry-gate.ts && grep -c "targetOverride" src/mimicry-gate.ts && grep -c "send_gate_json" src/directory.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | GATE-01 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | GATE-01 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | GATE-03 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | GATE-04 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | GATE-02 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | CAP-01 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | CAP-02 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | CAP-03 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | CAP-04 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | CAP-05 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | INFRA-02 | unit | `npx vitest run src/mimicry-gate.test.ts` | Wave 0 | pending |
| 53-02-01 | 02 | 2 | INFRA-03 | unit | `npx vitest run src/config-io.test.ts` | Yes | pending |

*Status: pending -- all tests created in Plan 02 (TDD plan)*

---

## Wave 0 Requirements

- [ ] `src/mimicry-gate.test.ts` -- covers GATE-01..04, CAP-01..05, INFRA-02..04 (created as part of Plan 02 TDD)
- [ ] Config schema tests via existing `src/config-io.test.ts` -- covers INFRA-03

*(Both the mimicry-gate test file is new -- this is a new module. Config-io tests already exist.)*

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
