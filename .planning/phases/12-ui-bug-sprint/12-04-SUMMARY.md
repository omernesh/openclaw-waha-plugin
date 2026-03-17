---
phase: 12-ui-bug-sprint
plan: 04
subsystem: ui
tags: [monitor.ts, tag-input, custom-keywords, mention-patterns, contact-drawer]

# Dependency graph
requires:
  - phase: 12-03
    provides: tooltip fix, contact-card overflow:visible, wrapRefreshButton
provides:
  - customKeywordTagInputs registry for per-contact tag inputs in buildContactCard
  - dmMentionPatternsInput and groupMentionPatternsInput for Settings tab mention patterns
  - Contact settings drawer stays open after save with success toast
affects: [buildContactCard, toggleContactSettings, saveContactSettings, loadConfig, saveSettings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy tag input init in toggleContactSettings: null-guard + data-init-kw attribute for seed value"
    - "Per-contact tag input registry (customKeywordTagInputs keyed by card id)"

key-files:
  created: []
  modified:
    - src/monitor.ts

key-decisions:
  - "UX-06 (Group Filter Override Keywords) was already implemented in Phase 9 (UX-03) via gfoTagInputs registry with gfo-patterns-cp- prefix — no change needed, documented as deviation"
  - "Custom Keywords tag input initialized lazily on first panel open via toggleContactSettings, not on card render, because innerHTML += cannot initialize DOM references until after insertion"
  - "Seed value stored as JSON in data-init-kw attribute on the container div so toggleContactSettings can populate the tag input on first open without a separate API call"
  - "UI-07 fix: removed panel.classList.remove('open') from saveContactSettings success path; replaced with showToast only"

requirements-completed: [UX-04, UX-05, UX-06, UI-07]

# Metrics
duration: 10min
completed: 2026-03-17
---

# Phase 12 Plan 04: UI Bug Sprint — Tag Inputs and Contact Drawer Fix Summary

**Pill-bubble tag inputs for Custom Keywords, DM/Group Mention Patterns; contact settings drawer stays open after save with toast confirmation**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-17T03:35:00Z
- **Completed:** 2026-03-17T03:47:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- **UX-04**: Custom Keywords field in contact settings panel replaced with pill-bubble tag input. Container div `kw-{id}` stores initial value as JSON in `data-init-kw` attribute. Tag input lazily initialized on first `toggleContactSettings()` open via `customKeywordTagInputs` registry. `saveContactSettings()` reads via `getValue()` and joins to comma-string for backend.
- **UX-05**: DM Mention Patterns textarea (`s-mentionPatterns`) and Group Mention Patterns textarea (`s-groupMentionPatterns`) replaced with container divs (`dm-mention-patterns`, `group-mention-patterns`). `dmMentionPatternsInput` and `groupMentionPatternsInput` instances lazily created in `loadConfig()` with null-guard. `saveSettings()` reads via `.getValue()` instead of `splitLines(getVal(...))`.
- **UI-07**: Removed `panel.classList.remove('open')` from `saveContactSettings` success path. Drawer stays open after save. Success toast `showToast('Settings saved')` confirms the save. User can continue editing without reopening.

## Task Commits

1. **Task 1 + Task 2 (combined): Tag inputs + drawer fix** — `1b0bb13` (feat)

Note: Tasks 1 and 2 were committed together as the `saveContactSettings` function changes (UX-04 read path + UI-07 drawer fix) were part of the same edit session in the same function.

## Files Created/Modified

- `src/monitor.ts` — new variable declarations (`dmMentionPatternsInput`, `groupMentionPatternsInput`, `customKeywordTagInputs`); HTML changes (2 textareas → divs, contact card input → div with data-init-kw); `toggleContactSettings` lazy init; `loadConfig` tag input init; `saveSettings` reads tag inputs; `saveContactSettings` drawer stays open

## Decisions Made

- **UX-06 already done (Phase 9)**: The Group Filter Override Keywords field already uses a tag input (`gfo-patterns-cp-{sfx}` via `gfoTagInputs`). Phase 9 (UX-03) implemented this. UX-06 was satisfied without code changes — documented below.
- **Lazy init via toggleContactSettings**: `buildContactCard` returns an HTML string inserted via `innerHTML +=`. DOM nodes don't exist until after insertion, so `createTagInput` cannot be called inside the builder. Calling it in `toggleContactSettings` on first open is the correct pattern (matches how GFO tag inputs work in `loadGroupParticipants`).
- **data-init-kw attribute**: Stores the initial keyword array as JSON on the container div so `toggleContactSettings` can seed the tag input without an extra API fetch.

## Deviations from Plan

### Already-Implemented Requirement

**UX-06 — Group Filter Override Keywords tag input**
- **Status**: Already implemented in Phase 9 (UX-03)
- **Existing implementation**: `gfoTagInputs[sfx] = createTagInput('gfo-patterns-cp-' + sfx, ...)` in `loadGroupParticipants()`; `saveGroupFilter()` reads via `gfoTagInputs[sfx].getValue()`
- **Action**: No code change. Requirement satisfied. Documented as deviation.

## Issues Encountered

None — all 313 existing tests pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All keyword/pattern fields now use consistent pill-bubble tag inputs
- Contact settings drawer stays open after save for iterative editing
- Ready for Phase 12 Plan 05 (next UI bug sprint plan)

## Self-Check: PASSED

- src/monitor.ts: FOUND
- 12-04-SUMMARY.md: FOUND
- Commit 1b0bb13: FOUND

---
*Phase: 12-ui-bug-sprint*
*Completed: 2026-03-17*
