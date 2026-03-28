---
phase: 65
slug: admin-standalone
status: draft
nyquist_compliant: true
created: 2026-03-28
---

# Phase 65 — Validation Strategy

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Automated Command | Status |
|---------|------|------|-------------|-------------------|--------|
| 65-01-01 | 01 | 1 | ADMIN-01,02 | `npx vitest run --bail 1` | ⬜ |
| 65-01-02 | 01 | 1 | ADMIN-02 | Browser visual check | ⬜ |
| 65-02-01 | 02 | 1 | SKILL-01 | `grep "chatlytics" SKILL.md` | ⬜ |
| 65-03-01 | 03 | 1 | SITE-01,02 | `test -f docs/site/index.html && test -f docs/site/docs.html` | ⬜ |
