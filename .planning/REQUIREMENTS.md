# Requirements: WAHA OpenClaw Plugin

**Defined:** 2026-03-17
**Core Value:** Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## v1.11 Requirements

Requirements for v1.11 milestone. Each maps to roadmap phases.

### UI Bug Fixes

- [x] **UI-01**: Dashboard Access Control card stops flickering/re-rendering every few seconds (BUG-02)
- [x] **UI-02**: DM Keyword Filter stats use clear labels — "Passed" vs "Filtered" instead of "Allowed" vs "Dropped" (BUG-03)
- [ ] **UI-03**: Sessions tab role/subRole dropdown updates visually immediately after save without page flicker (BUG-04)
- [ ] **UI-04**: Sessions tab handles 502 during restart gracefully with polling overlay instead of raw error (BUG-05)
- [ ] **UI-05**: Directory search bar 'x' button clears search text and resets results (BUG-07)
- [ ] **UI-06**: Tooltips render above container overflow boundaries and are fully readable (BUG-08)
- [ ] **UI-07**: Contact settings drawer stays open after saving, shows success toast (BUG-09)
- [ ] **UI-08**: DM Policy dropdown removes "pairing (not available)" option; auto-migrates config if set (BUG-13)
- [ ] **UI-09**: Queue tab Refresh button shows spinner and "Last refreshed" timestamp (BUG-14)
- [ ] **UI-10**: Per-group trigger operator visible even when inheriting global (grayed out with effective value) (BUG-17)
- [ ] **UI-11**: Channels tab Allow DM button is a toggle with clear visual state and undo capability (BUG-18)

### Dashboard Polish

- [x] **DASH-01**: Dashboard health section shows per-session health details (CR-01)
- [x] **DASH-02**: Dashboard filter cards (DM Keyword, Group Keyword) are collapsible (CR-02)
- [x] **DASH-03**: Dashboard labels use human-readable text — "wpm" → "Words Per Minute", etc. (CR-03)
- [x] **DASH-04**: Dashboard stats show per-session breakdowns with session name sub-headers (CR-04)

### Sessions & Settings UX

- [ ] **UX-01**: Sessions tab has labels above role/subRole dropdowns with explanatory text box (CR-05)
- [ ] **UX-02**: Log tab search bar has 'x' clear button (CR-06)
- [ ] **UX-03**: All Refresh buttons across all tabs show spinner + "Last refreshed" timestamp on click (CR-07)
- [ ] **UX-04**: Custom Keywords field in contact settings uses tag-style input with pill bubbles (CR-09)
- [ ] **UX-05**: Mention Patterns field uses tag-style input with pill bubbles (CR-11)
- [ ] **UX-06**: Group Filter Override Keywords field uses tag-style input with pill bubbles (CR-13)

### Background Sync & Directory

- [ ] **SYNC-01**: Background WAHA→SQLite sync continuously pulls contacts/groups/newsletters with rate limiting (CR-08)
- [ ] **SYNC-02**: Directory search queries local SQLite DB, not WAHA API — instant results (CR-08)
- [ ] **SYNC-03**: Sync status indicator shows "Last synced" timestamp and sync progress in Directory tab (CR-08)
- [ ] **SYNC-04**: Contacts tab has pagination matching Groups tab pattern (BUG-15)
- [ ] **SYNC-05**: Directory search finds contacts by name from locally synced data (BUG-06)

### Name Resolution

- [ ] **NAME-01**: Dashboard Access Control card resolves @lid JIDs to contact names, merges with @c.us equivalents (BUG-01)
- [ ] **NAME-02**: God Mode Users tag bubbles in Settings display resolved contact/group names (BUG-10)
- [ ] **NAME-03**: God Mode Users contact picker searches local SQLite directory successfully (BUG-11)
- [ ] **NAME-04**: Allow From, Group Allow From, Allowed Groups tag bubbles display resolved names with JID tooltips (BUG-12)
- [ ] **NAME-05**: Group participants display resolved contact names instead of raw LID numbers (BUG-16)

### Directory UX

- [ ] **DIR-01**: Directory excludes bot's own session JIDs from contact listing (CR-12)
- [ ] **DIR-02**: Bot session participants shown in groups with "bot" badge but without action buttons (CR-14)
- [ ] **DIR-03**: Contacts tab supports bulk select with checkboxes and bulk action toolbar (Allow DM, Revoke DM, Set Mode) (CR-15)
- [ ] **DIR-04**: Promoting participant to Bot Admin/Manager auto-enables Allow and Allow DM (CR-16)
- [ ] **DIR-05**: Channels tab supports bulk select with checkboxes and bulk action toolbar (CR-17)

### Can Initiate Global Setting

- [ ] **INIT-01**: Global "Can Initiate" toggle in Settings tab with default for all contacts (CR-10)
- [ ] **INIT-02**: Per-contact "Can Initiate" becomes override: "Default (use global)" / "Allow" / "Block" (CR-10)

### Pairing Mode

- [ ] **PAIR-01**: Unknown contact DMs bot → bot replies with scripted passcode challenge (zero LLM tokens) (FEATURE-01)
- [ ] **PAIR-02**: Correct passcode grants temporary allowlist entry with configurable TTL (FEATURE-01)
- [ ] **PAIR-03**: wa.me deep link with obfuscated passcode parameter enables zero-friction auto-authorization (FEATURE-01)
- [ ] **PAIR-04**: Passcode is configurable per-session in admin panel (FEATURE-01)
- [ ] **PAIR-05**: Admin panel shows active temporary grants with remaining TTL and manual revoke (FEATURE-01)
- [ ] **PAIR-06**: Passcode attempts are rate-limited to prevent brute force (FEATURE-01)

### TTL Access

- [ ] **TTL-01**: Contact/group settings card has "Access Expires" field with Never/datetime/duration options (FEATURE-02)
- [ ] **TTL-02**: SQLite allow_list table has expires_at column with automatic expiry enforcement (FEATURE-02)
- [ ] **TTL-03**: Inbound filter checks expires_at before granting access — expired entries treated as blocked (FEATURE-02)
- [ ] **TTL-04**: Admin panel shows remaining time on active TTL grants (FEATURE-02)
- [ ] **TTL-05**: Expired entries visually marked in Directory (grayed out or badge) (FEATURE-02)

### Auto-Reply

- [ ] **REPLY-01**: Unauthorized DMs receive a configurable canned rejection message (zero LLM tokens) (FEATURE-03)
- [ ] **REPLY-02**: Rejection message supports template variables (e.g., bot admin name) (FEATURE-03)
- [ ] **REPLY-03**: Auto-reply is rate-limited per contact (once per configurable interval, default 24h) (FEATURE-03)
- [ ] **REPLY-04**: "Send rejection message" toggle in Settings (on/off, some admins prefer silent drop) (FEATURE-03)

### Modules System

- [ ] **MOD-01**: Module interface defined (init, config schema, inbound hook, outbound hook) (FEATURE-04)
- [ ] **MOD-02**: Module registry for registering and discovering modules at init time (FEATURE-04)
- [ ] **MOD-03**: Modules admin tab between Sessions and Log with enable/disable toggles (FEATURE-04)
- [ ] **MOD-04**: Module assignment UI — which groups/contacts/newsletters each module applies to (FEATURE-04)
- [ ] **MOD-05**: Inbound pipeline checks active modules for incoming chat and routes accordingly (FEATURE-04)
- [ ] **MOD-06**: Modules are WhatsApp-specific — no cross-platform abstraction (FEATURE-04)

## v2 Requirements

Deferred to future release.

### Group Events

- **GRP-01**: Inbound group events (join/leave/promote/demote) detection and handling

### Media Multi-Send

- **MEDIA-01**: Media support for sendMulti (images, videos, files in multi-recipient sends)

### First-Party Modules

- **MODS-01**: Channel moderator module
- **MODS-02**: Event planner module

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-platform module abstraction | Modules are WhatsApp-specific by design decision (2026-03-17) |
| Claude Code / Cursor adapter | Deferred to future milestone |
| Scheduled messages | WAHA doesn't support |
| WhatsApp Business templates | Not applicable for personal assistant |
| Broadcast lists | WAHA limitation |
| Call initiation | WAHA limitation |
| Disappearing messages | Low priority |
| Hot-reload | Gateway requires restart, not worth engineering around |
| First-party modules (channel moderator, event planner) | Ship framework only in v1.11, modules in v1.12 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| UI-01 | Phase 12 | Complete |
| UI-02 | Phase 12 | Complete |
| UI-03 | Phase 12 | Pending |
| UI-04 | Phase 12 | Pending |
| UI-05 | Phase 12 | Pending |
| UI-06 | Phase 12 | Pending |
| UI-07 | Phase 12 | Pending |
| UI-08 | Phase 12 | Pending |
| UI-09 | Phase 12 | Pending |
| UI-10 | Phase 12 | Pending |
| UI-11 | Phase 12 | Pending |
| DASH-01 | Phase 12 | Complete |
| DASH-02 | Phase 12 | Complete |
| DASH-03 | Phase 12 | Complete |
| DASH-04 | Phase 12 | Complete |
| UX-01 | Phase 12 | Pending |
| UX-02 | Phase 12 | Pending |
| UX-03 | Phase 12 | Pending |
| UX-04 | Phase 12 | Pending |
| UX-05 | Phase 12 | Pending |
| UX-06 | Phase 12 | Pending |
| DIR-01 | Phase 12 | Pending |
| DIR-02 | Phase 12 | Pending |
| DIR-04 | Phase 12 | Pending |
| INIT-01 | Phase 12 | Pending |
| INIT-02 | Phase 12 | Pending |
| SYNC-01 | Phase 13 | Pending |
| SYNC-02 | Phase 13 | Pending |
| SYNC-03 | Phase 13 | Pending |
| SYNC-04 | Phase 13 | Pending |
| SYNC-05 | Phase 13 | Pending |
| NAME-01 | Phase 14 | Pending |
| NAME-02 | Phase 14 | Pending |
| NAME-03 | Phase 14 | Pending |
| NAME-04 | Phase 14 | Pending |
| NAME-05 | Phase 14 | Pending |
| TTL-01 | Phase 15 | Pending |
| TTL-02 | Phase 15 | Pending |
| TTL-03 | Phase 15 | Pending |
| TTL-04 | Phase 15 | Pending |
| TTL-05 | Phase 15 | Pending |
| PAIR-01 | Phase 16 | Pending |
| PAIR-02 | Phase 16 | Pending |
| PAIR-03 | Phase 16 | Pending |
| PAIR-04 | Phase 16 | Pending |
| PAIR-05 | Phase 16 | Pending |
| PAIR-06 | Phase 16 | Pending |
| REPLY-01 | Phase 16 | Pending |
| REPLY-02 | Phase 16 | Pending |
| REPLY-03 | Phase 16 | Pending |
| REPLY-04 | Phase 16 | Pending |
| DIR-03 | Phase 17 | Pending |
| DIR-05 | Phase 17 | Pending |
| MOD-01 | Phase 17 | Pending |
| MOD-02 | Phase 17 | Pending |
| MOD-03 | Phase 17 | Pending |
| MOD-04 | Phase 17 | Pending |
| MOD-05 | Phase 17 | Pending |
| MOD-06 | Phase 17 | Pending |

**Coverage:**
- v1.11 requirements: 59 total
- Mapped to phases: 59
- Unmapped: 0

---
*Requirements defined: 2026-03-17*
*Last updated: 2026-03-17 — traceability populated after roadmap creation*
