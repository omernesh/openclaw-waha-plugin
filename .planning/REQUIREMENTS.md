# Requirements: WAHA OpenClaw Plugin v1.20

**Defined:** 2026-03-26
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## v1.20 Requirements

Requirements for Human Mimicry Hardening. Each maps to roadmap phases.

### Time Gates

- [ ] **GATE-01**: Outbound messages are blocked outside configurable send window (default 7am-1am local time)
- [ ] **GATE-02**: Send window is configurable at global, per-session, and per-contact/group/newsletter levels
- [ ] **GATE-03**: Quiet hours policy is configurable as "reject" (return error) or "queue" (hold until window opens)
- [ ] **GATE-04**: Timezone is configurable per session via IANA timezone string (e.g., Asia/Jerusalem)

### Hourly Caps

- [ ] **CAP-01**: Hard hourly message cap enforced per session using rolling window counter (not top-of-hour reset)
- [ ] **CAP-02**: Account maturity tracked in 3 phases: New (0-7d), Warming (8-30d), Stable (30d+) derived from first_send_at
- [ ] **CAP-03**: Progressive default caps tied to maturity: New=15/hr, Warming=30/hr, Stable=50/hr (all configurable)
- [ ] **CAP-04**: Cap configurable at global, per-session, and per-contact/group/newsletter levels
- [ ] **CAP-05**: Cap counter persisted in SQLite to survive gateway restarts

### Infrastructure

- [ ] **INFRA-01**: New mimicry-gate.ts module with time gate check, cap tracker, config resolution
- [ ] **INFRA-02**: Config hierarchy follows existing merge pattern (global → session → contact/group)
- [ ] **INFRA-03**: Zod schemas for sendGate and hourlyCap with .optional().default() on all new fields
- [ ] **INFRA-04**: bypassPolicy flag skips all mimicry gates (preserves /shutup, /join, /leave)

### Claude Code Integration

- [ ] **CC-01**: Claude Code whatsapp-messenger sends routed through mimicry gate+cap enforcement
- [ ] **CC-02**: Typing simulation applied to outbound Claude Code sends (proportional to message length)

### Behavioral Polish

- [ ] **BEH-01**: Jittered inter-message delays on all outbound sends (random variance +/-30-50% of base delay)
- [ ] **BEH-02**: Typing indicator duration proportional to message length (~40-60 WPM simulation)
- [ ] **BEH-03**: Drain rate throttling: 3-8s jittered delay between consecutive queue drain sends

### Admin UI

- [ ] **UI-01**: Dashboard card showing maturity phase, days until upgrade, current cap usage vs limit, gate open/closed
- [ ] **UI-02**: Settings tab: send gate hours pickers, timezone selector, hourly cap limit inputs, progressive limits table
- [ ] **UI-03**: Mimicry status API endpoint (GET /api/admin/mimicry) for gate status and cap usage per session

### Adaptive Activity Patterns

- [ ] **ADAPT-01**: System scans group/contact message history (last 7 days) to build per-chat activity profiles (busiest hours, busiest days)
- [ ] **ADAPT-02**: Activity profiles stored in SQLite table for reuse, rescanned weekly
- [ ] **ADAPT-03**: Scanning runs incrementally — small portion of contact list per day, during off-peak hours, only when system is not under high usage
- [ ] **ADAPT-04**: Time gates adapt per-group/contact based on activity profile — sends aligned to match observed human activity patterns
- [ ] **ADAPT-05**: Fallback to global/session default gate when no activity profile exists for a chat

## Future Requirements

### Deferred from v1.20

- **EXEMPT-01**: Per-contact rateLimitExempt flag in directory settings UI
- **DIST-01**: Send-time distribution analytics chart (hourly histogram in admin panel)
- **AUTO-01**: Automatic maturity phase promotion based on read receipt engagement signals
- **AGG-01**: Cross-session aggregate cap (if multiple sessions share account context)
- **PEAK-01**: Active-hours soft preference queue (hold for next engagement peak window)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Message queuing with persistence | Reject-not-queue is safer default for v1.20; persistent queue adds SQLite complexity and message loss risk on restart |
| Session rotation / multi-number spreading | Dilutes account maturity; fresh numbers have lower trust |
| Read receipt suppression | Toggling privacy settings is itself an API call that may be monitored |
| "Urgent" bypass flag on individual messages | Gets overused by LLM; undermines entire mimicry system |
| Clockwork send scheduling | Creates perfectly regular machine signature; worse than jittered natural activity |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GATE-01 | Phase 53 | Pending |
| GATE-02 | Phase 53 | Pending |
| GATE-03 | Phase 53 | Pending |
| GATE-04 | Phase 53 | Pending |
| CAP-01 | Phase 53 | Pending |
| CAP-02 | Phase 53 | Pending |
| CAP-03 | Phase 53 | Pending |
| CAP-04 | Phase 53 | Pending |
| CAP-05 | Phase 53 | Pending |
| INFRA-01 | Phase 53 | Pending |
| INFRA-02 | Phase 53 | Pending |
| INFRA-03 | Phase 53 | Pending |
| INFRA-04 | Phase 53 | Pending |
| CC-01 | Phase 55 | Pending |
| CC-02 | Phase 55 | Pending |
| BEH-01 | Phase 54 | Pending |
| BEH-02 | Phase 54 | Pending |
| BEH-03 | Phase 54 | Pending |
| UI-01 | Phase 57 | Pending |
| UI-02 | Phase 57 | Pending |
| UI-03 | Phase 57 | Pending |
| ADAPT-01 | Phase 56 | Pending |
| ADAPT-02 | Phase 56 | Pending |
| ADAPT-03 | Phase 56 | Pending |
| ADAPT-04 | Phase 56 | Pending |
| ADAPT-05 | Phase 56 | Pending |

**Coverage:**
- v1.20 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 — traceability populated after roadmap creation*
