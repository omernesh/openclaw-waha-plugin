---
phase: 18
slug: react-scaffold
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing — 313+ tests passing) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose 2>&1 | tail -20` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose 2>&1 | tail -20`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | SCAF-01 | build | `npm run build:admin 2>&1 \| tail -5` | ❌ W0 | ⬜ pending |
| 18-01-02 | 01 | 1 | SCAF-02 | build | `ls dist/admin/index.html && echo OK` | ❌ W0 | ⬜ pending |
| 18-01-03 | 01 | 1 | SCAF-04 | unit | `grep -r "fetchApi\|apiClient" src/admin/lib/` | ❌ W0 | ⬜ pending |
| 18-01-04 | 01 | 1 | SCAF-05 | config | `node -e "const p=require('./package.json'); console.log(p.files)"` | ✅ | ⬜ pending |
| 18-02-01 | 02 | 1 | SCAF-03 | manual | Navigate to admin URL, verify React app renders | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/admin/` directory structure created by Vite init
- [ ] `vite.config.ts` — Vite build configuration
- [ ] `tailwind.config.ts` — Tailwind CSS configuration with dark/light CSS variables
- [ ] `src/admin/lib/api-client.ts` — API client utility

*Existing vitest infrastructure covers backend tests; Wave 0 sets up frontend build validation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin panel URL serves React app | SCAF-03 | Requires running server + browser | Start dev server, navigate to admin URL, verify React app renders instead of old HTML |
| Dark/light theme CSS variables | SCAF-02 | Visual verification | Inspect rendered page, verify CSS custom properties for both themes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
