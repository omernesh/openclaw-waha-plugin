# Milestones

## v1.18 Join/Leave/List & Skill Completeness (Shipped: 2026-03-26)

**Phases completed:** 5 phases, 8 plans, 9 tasks

**Key accomplishments:**

- regex-based /join, /leave, /list WhatsApp commands that bypass the LLM for direct group/channel management via invite links and fuzzy name matching
- Wired /join, /leave, /list into inbound.ts -- commands intercepted before LLM, pending selections routed by type.
- One-liner:
- alert-dialog.tsx
- Task 1: Audit all actions and rewrite SKILL.md with complete endpoint coverage
- v1.17.2 deployed to both hpg6 locations with clean gateway startup; WAHA sessions 3cf11776_omer and 3cf11776_logan both WORKING
- Status:

---

## v1.13 Close All Gaps (Shipped: 2026-03-20)

**Phases completed:** 8 phases, 19 plans, 2 tasks

**Key accomplishments:**

- (none recorded)

---

## v1.12 UI Overhaul & Feature Polish (Shipped: 2026-03-18)

**Phases completed:** 7 phases, 14 plans, 7 tasks

**Key accomplishments:**

- (none recorded)

---

## v1.11 Polish, Sync & Features (Shipped: 2026-03-17)

**Phases completed:** 6 phases, 18 plans, 6 tasks

**Key accomplishments:**

- (none recorded)

---

## v1.10 Admin Panel & Multi-Session (Shipped: 2026-03-16)

**Phases:** 11 | **Plans:** 28 | **Timeline:** 6 days (2026-03-11 → 2026-03-16)
**Commits:** 238 | **Source:** 13,026 LOC TypeScript | **Tests:** 5,619 LOC (313 passing)
**Requirements:** 65/65 satisfied | **Integration:** 65/65 wired | **E2E Flows:** 9/9 verified

**Key accomplishments:**

1. Reliability foundation — timeouts, rate limiting, exponential backoff on all WAHA API calls
2. Multi-session support — bot + human sessions with role-based permissions and trigger words
3. Rules & policy system — file-based hierarchical YAML policies with 5-layer merge engine
4. Full admin panel — directory, config, sessions, dashboard, structured logs with shared UI components
5. 313 passing tests — unit + integration coverage for core utilities and action handlers
6. Complete documentation — SKILL.md v4.0 and README with deployment guide

---
