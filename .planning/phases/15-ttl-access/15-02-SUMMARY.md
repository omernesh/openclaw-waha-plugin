---
phase: 15-ttl-access
plan: 02
subsystem: ui
tags: [monitor.ts, admin-panel, ttl, access-control, directory]

# Dependency graph
requires:
  - phase: 15-ttl-access/15-01
    provides: PUT /api/admin/directory/:jid/ttl endpoint and expiresAt/expired fields in directory API response

provides:
  - Access Expires dropdown in contact settings card (Never/30min/1h/4h/24h/7days/Custom)
  - Custom datetime picker for arbitrary expiry
  - ttlChanged() and ttlCustomApply() handlers for immediate API updates
  - formatTtlBadge() helper generating color-coded time badges
  - TTL badges on contact cards (green >1h, yellow <1h, red <15m, gray for expired)
  - expired-card CSS dimming for expired entries
  - Expired contacts sorted to bottom of directory listing

affects: [admin-panel, directory-ui, contact-settings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - IIFE in buildContactCard for local variable scoping in dropdown selection logic
    - formatTtlBadge() helper pattern for badge HTML generation from raw timestamps

key-files:
  created: []
  modified:
    - src/monitor.ts

key-decisions:
  - "Access Expires dropdown fires immediately on change (no separate Save) — separate UX from DM settings Save"
  - "Custom picker uses display:flex/none toggle rather than creating/removing DOM elements"
  - "formatTtlBadge placed before buildContactCard so it is defined before use"
  - "Sort is stable-order: only expired float to bottom, relative order within active/expired groups preserved"

patterns-established:
  - "IIFE in buildContactCard for TTL preset selection logic keeps local vars out of outer scope"
  - "ttlChanged/ttlCustomApply follow same async fetch+showToast pattern as other admin panel handlers"

requirements-completed:
  - TTL-01
  - TTL-04
  - TTL-05

# Metrics
duration: 20min
completed: 2026-03-17
---

# Phase 15 Plan 02: TTL Access UI Summary

**Access Expires dropdown with color-coded TTL badges and expired-entry dimming in the admin panel directory**

## Performance

- **Duration:** 20 min
- **Started:** 2026-03-17T13:35:00Z
- **Completed:** 2026-03-17T13:55:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Contact settings card now has "Access Expires" dropdown with Never/30min/1h/4h/24h/7days/Custom options that immediately PUT to `/api/admin/directory/:jid/ttl` on change
- Custom option shows a `datetime-local` picker with Apply button for arbitrary expiry
- Color-coded TTL badges appear next to contact names: green (>1h), yellow (<1h), red (<15m), gray "Expired"
- Expired contacts are visually dimmed (opacity 0.5, gray left border) and sorted to the bottom of the directory listing

## Task Commits

1. **Task 1: Add Access Expires control to contact settings card** - `18a0dfc` (feat)
2. **Task 2: Add TTL badges and expired entry styling to directory listing** - `bf759f9` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified
- `src/monitor.ts` - Added TTL CSS classes, Access Expires dropdown + handlers, formatTtlBadge helper, badge in buildContactCard, expired-card styling, sort in loadContactsTable

## Decisions Made
- Access Expires dropdown fires immediately on change (no separate Save button needed) — consistent with other inline toggles in the admin panel, faster UX for admins
- Selected preset is determined from remaining seconds with a 60-second tolerance — close enough to a preset snaps to it, otherwise shows "Custom..."
- `formatTtlBadge` placed before `buildContactCard` in source order so it is defined before first use (JS hoisting would handle `function` declarations, but IIFE logic inside buildContactCard calls it at call time, so order does not strictly matter — defensive placement)
- Expired entries sort stable-last: only expired bubble to bottom, relative order within each group preserved

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed duplicate `display` property in custom datetime picker div**
- **Found during:** Task 1 review
- **Issue:** Initial implementation set `display:none/block` then `display:flex` in same style attribute — second value always overrides, breaking show/hide logic
- **Fix:** Changed to `display:flex/none` only (no second display property), flex layout restored via gap+align-items
- **Files modified:** src/monitor.ts
- **Verification:** Style attribute has single display value
- **Committed in:** 18a0dfc (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix was essential for custom picker show/hide to work correctly.

## Issues Encountered
- No tsconfig.json in project root — `npx tsc --noEmit` (plan's verify command) is not applicable. Verified via acceptance criteria grep checks instead. The project uses openclaw runtime for type checking at deploy time.

## Next Phase Readiness
- TTL access UI complete — admins can set, view, and visually track time-limited grants
- Phase 15 (15-ttl-access) is now feature-complete on both backend (15-01) and UI (15-02)
- Ready for Phase 16 (Pairing Mode) or whichever phase comes next

---
*Phase: 15-ttl-access*
*Completed: 2026-03-17*
