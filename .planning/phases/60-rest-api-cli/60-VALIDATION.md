---
phase: 60
slug: rest-api-cli
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 60 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Quick run command** | `npx vitest run --bail 1` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 60-01-01 | 01 | 1 | API-01,API-02 | unit | `npx vitest run src/api-v1-auth.test.ts` | ⬜ |
| 60-01-02 | 01 | 1 | API-01,API-04 | unit+grep | `npx vitest run --bail 1` | ⬜ |
| 60-02-01 | 02 | 2 | API-03 | lint | `npx @stoplight/spectral-cli lint src/openapi.yaml` | ⬜ |
| 60-02-02 | 02 | 2 | API-03 | unit | `npx vitest run tests/openapi.test.ts` | ⬜ |
| 60-03-01 | 03 | 2 | CLI-01,CLI-02 | cli | `node bin/chatlytics.mjs --help` | ⬜ |
| 60-03-02 | 03 | 2 | CLI-03,CLI-04 | cli | `node bin/chatlytics.mjs --json status` | ⬜ |

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Swagger UI renders interactively | API-03 | Browser required | Navigate to http://localhost:PORT/docs |
| CLI colored table output | CLI-02 | Terminal color check | Run `npx chatlytics search "test"` in terminal |

## Validation Sign-Off

- [ ] All tasks have automated verify
- [ ] Sampling continuity maintained
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
