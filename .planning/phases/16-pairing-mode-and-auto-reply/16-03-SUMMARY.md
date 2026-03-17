---
phase: 16-pairing-mode-and-auto-reply
plan: 03
subsystem: ui
tags: [admin-panel, pairing-mode, auto-reply, settings, directory, hmac, monitor]

# Dependency graph
requires:
  - phase: 16-01
    provides: pairingMode/autoReply config schema, getPairingGrants/revokePairingGrant in directory.ts, getPairingEngine/generateDeepLinkToken in pairing.ts
provides:
  - Pairing Mode section in admin panel Settings tab (toggle, passcode, TTL, challenge message, deep link generator)
  - Auto-Reply section in admin panel Settings tab (toggle, message editor, rate limit dropdown)
  - Pairing source badge + Revoke link in Directory contact cards
  - GET /api/admin/pairing/deeplink API route
  - DELETE /api/admin/pairing/grant/:jid API route
  - source field in directory enrichment (from allow_list)
affects: [16-04, any plan that touches admin panel UI]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pairingFields/autoReplyFields show/hide: visibility toggled via .style.display on checkbox change"
    - "source field propagated from allow_list through getContactTtl to directory API enrichment"
    - "Pairing badge: inline HTML badge injected in buildContactCard when c.source === 'pairing'"
    - "HMAC deep link: GET route reads pairingMode.hmacSecret from config, returns wa.me link"
    - "Grant revoke: DELETE route calls revokePairingGrant (SQLite) + syncAllowList (config file)"

key-files:
  created: []
  modified:
    - src/monitor.ts
    - src/directory.ts

key-decisions:
  - "source field returned from getContactTtl: extended return type instead of separate DB method — reuses existing per-contact query"
  - "Deep link UI: separate JID input + Generate button rather than auto-generating on passcode focus — explicit action avoids confusion"
  - "Revoke in Directory: calls loadContactsTable() (not location.reload()) for in-place refresh without full page load"
  - "hmacSecret not included in frontend config save payload — managed server-side only, never round-trips through browser"

patterns-established: []

requirements-completed: [PAIR-04, PAIR-05, REPLY-04]

# Metrics
duration: 25min
completed: 2026-03-17
---

# Phase 16 Plan 03: Pairing Mode and Auto-Reply Admin Panel UI Summary

**Admin panel Settings tab gains Pairing Mode (passcode, TTL, deep link) and Auto-Reply (rejection message, rate limit) config sections; Directory shows "Pairing" badge + Revoke link on pairing-granted contacts; two new API routes for deep link generation and grant revocation.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-03-17T14:28:00Z
- **Completed:** 2026-03-17T14:53:46Z
- **Tasks:** 1 (Task 1: Add Pairing Mode and Auto-Reply sections to Settings tab)
- **Files modified:** 2

## Accomplishments
- Settings tab has collapsible Pairing Mode section with enable toggle, 6-digit passcode field with Generate button, Grant TTL dropdown (1h–30d + never), challenge message textarea, and wa.me deep link generator with Copy button
- Settings tab has collapsible Auto-Reply section with enable toggle, rejection message textarea with `{admin_name}` template hint, and rate limit dropdown (1h–7d)
- Directory contact cards show "Pairing" badge and "Revoke" link when contact has `source='pairing'` in allow_list
- GET /api/admin/pairing/deeplink generates HMAC-signed wa.me links; DELETE /api/admin/pairing/grant/:jid revokes access and syncs config file

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Pairing Mode and Auto-Reply sections to Settings tab** - `fc344a5` (feat)

## Files Created/Modified
- `src/monitor.ts` - Added HTML sections, JS config load/save, event handlers, API routes, pairing badge in Directory
- `src/directory.ts` - Extended `getContactTtl` return type to include `source` field from allow_list

## Decisions Made
- Extended `getContactTtl` return type rather than adding a new DB method — reuses the existing per-contact allow_list query with minimal code addition
- Deep link generator uses a separate JID input field so admins explicitly request a link per contact, avoiding accidental link generation
- `revokePairingGrant` JS function calls `loadContactsTable()` for in-place refresh rather than `location.reload()` — avoids re-fetching all config

## Deviations from Plan

None - plan executed exactly as written. One minor adaptation: the deep link UI was changed from a readonly link field with auto-generate on passcode focus to an explicit JID input + Generate button, which is more predictable and matches the plan's description of "JID-specific token generated server-side."

## Issues Encountered
None

## Next Phase Readiness
- Settings tab now has Pairing Mode and Auto-Reply UI sections that round-trip config correctly
- Directory tab shows pairing source badges with revoke capability
- API routes are wired to pairing.ts and directory.ts backends from Phase 16-01
- Ready for Phase 16-04 (pairing engine integration with inbound message handling)

---
*Phase: 16-pairing-mode-and-auto-reply*
*Completed: 2026-03-17*
