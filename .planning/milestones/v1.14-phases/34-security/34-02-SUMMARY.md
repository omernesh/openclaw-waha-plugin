---
phase: 34-security
plan: 02
subsystem: api
tags: [security, validation, jid, config-import]

requires:
  - phase: 34-security
    provides: Admin API security context
provides:
  - Config import top-level key validation (SEC-02)
  - JID path segment validation on all admin directory routes (SEC-03)
affects: [admin-api, directory, config]

tech-stack:
  added: []
  patterns: [isValidJid guard pattern on all JID-bearing routes]

key-files:
  created: []
  modified: [src/monitor.ts]

key-decisions:
  - "JID regex allows @c.us, @g.us, @lid, @newsletter suffixes only"
  - "Config import allows channels, providers, agents, tools, profiles, settings top-level keys"
  - "Non-JID params (sessionId, moduleId) intentionally excluded from validation"
  - "Pairing grant DELETE route also gets JID validation"

patterns-established:
  - "isValidJid guard: validate JID format before any DB/API operation on URL-extracted JIDs"
  - "allowedTopLevelKeys whitelist: reject unknown config sections before processing"

requirements-completed: [SEC-02, SEC-03]

review_status: skipped

duration: 4min
completed: 2026-03-25
---

# Phase 34 Plan 02: Config Import Key Validation + JID Path Segment Validation Summary

Config import rejects unknown top-level keys (SEC-02) and all JID path segments validated against `/@(c\.us|g\.us|lid|newsletter)$/` regex before DB/API operations (SEC-03).

## What Was Done

### Task 1: Validate config import top-level keys and JID path segments

**SEC-02 - Config import validation:**
- Added `allowedTopLevelKeys` whitelist (channels, providers, agents, tools, profiles, settings)
- Unknown keys rejected with HTTP 400 including the bad key names and allowed list
- Validation runs before existing `validateWahaConfig` call

**SEC-03 - JID path segment validation:**
- Added `isValidJid()` helper with `JID_PATTERN` regex near top of monitor.ts
- Applied to 16 route handlers across all JID-bearing admin API routes:
  - GET/PUT `/api/admin/directory/:jid/filter`
  - GET `/api/admin/directory/:jid`
  - PUT `/api/admin/directory/:jid/settings`
  - POST `/api/admin/directory/:jid/allow-dm`
  - PUT `/api/admin/directory/:jid/ttl`
  - GET `/api/admin/directory/group/:groupJid/participants`
  - POST `/api/admin/directory/group/:groupJid/participants/:participantJid/allow-group` (both JIDs)
  - POST `/api/admin/directory/group/:groupJid/participants/:participantJid/allow-dm` (both JIDs)
  - PUT `/api/admin/directory/group/:groupJid/participants/:participantJid/role` (both JIDs)
  - POST `/api/admin/directory/group/:groupJid/allow-all`
  - DELETE `/api/admin/modules/:id/assignments/:jid`
  - DELETE `/api/admin/pairing/grant/:jid`
- Non-JID params (sessionId, moduleId) intentionally excluded
- DO NOT CHANGE comments on security-critical code

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 5b30b6a | Config import key validation + JID path segment validation |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing coverage] Added JID validation to TTL and pairing grant routes**
- **Found during:** Task 1
- **Issue:** Plan listed specific routes but TTL and pairing grant routes also extract JIDs from URL paths
- **Fix:** Added isValidJid checks to PUT /:jid/ttl and DELETE /pairing/grant/:jid
- **Files modified:** src/monitor.ts

## Verification

- TypeScript compiles clean (`npx tsc --noEmit` passes)
- `allowedTopLevelKeys` present (3 references)
- `isValidJid` present (17 references)
- `JID_PATTERN` present (2 references)
- `Invalid JID format` error message present (16 locations)
- DO NOT CHANGE comments on security functions

## Known Stubs

None.
