# Phase 28: API Coverage Completion - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Close all remaining WAHA API coverage gaps — channel search metadata, bulk presence, group helpers, group webhook events, API keys CRUD, and presence verification/admin display.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — API coverage phase:

**Channel Search Metadata (API-01, API-02):**
- API-01: POST /channels/search/by-view — search channels by view criteria
- API-02: GET /channels/search/views, /channels/search/countries, /channels/search/categories — metadata for channel search filters
- Add send.ts functions, channel.ts ACTION_HANDLERS entries, SKILL.md docs

**Bulk Presence (API-03):**
- API-03: GET /presence — get ALL subscribed presence info (currently only individual GET /presence/{chatId} exists)
- Add send.ts function, channel.ts ACTION_HANDLERS entry

**Group Helpers (API-04, API-05):**
- API-04: GET /groups/{id}/join-info — preview group info before joining
- API-05: POST /groups/refresh — force refresh groups from WAHA server
- Add send.ts functions, channel.ts ACTION_HANDLERS entries

**Group Webhook Events (API-06):**
- API-06: Handle group.join, group.leave, group.participants webhook events from WAHA
- Add event handlers in monitor.ts webhook processor
- Create synthetic inbound messages or directory updates from these events
- WAHA sends these as webhook events — check WAHA docs for exact event names and payloads

**API Keys CRUD (API-07):**
- API-07: POST /api/keys, GET /api/keys, PUT /api/keys/{id}, DELETE /api/keys/{id}
- Add send.ts functions, channel.ts ACTION_HANDLERS entries
- These are WAHA server-level API keys, not plugin-level

**Presence Verification (PRES-01, PRES-02):**
- PRES-01: Verify all 4 presence endpoints work e2e (set, get, get-all, subscribe). Can use both sessions: omer (3cf11776_omer) and logan (3cf11776_logan) on hpg6.
- PRES-02: Surface presence data in admin panel Directory tab — show online/offline status for contacts

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/send.ts` — all existing WAHA API functions follow callWahaApi pattern
- `src/channel.ts` — ACTION_HANDLERS map for utility actions, UTILITY_ACTIONS array for exposure
- `src/monitor.ts` — webhook event routing in createWahaWebhookServer
- `src/directory.ts` — contact/group tracking, upsertContact

### Established Patterns
- New send function: export async function nameWaha(params: {cfg, chatId?, accountId?}) { const {baseUrl, apiKey, session} = resolveAccountParams(cfg, accountId); return callWahaApi({...}); }
- New action handler: actionName: (p, cfg, aid) => sendWahaFunction({cfg, ...params, accountId: aid})
- New webhook event: add case in the event routing switch/if chain in monitor.ts

### Integration Points
- send.ts — add functions
- channel.ts — add ACTION_HANDLERS entries + UTILITY_ACTIONS
- monitor.ts — add webhook event handlers
- directory.ts — update on group events
- SKILL.md — document new actions
- admin/DashboardTab or DirectoryTab — presence display

</code_context>

<specifics>
## Specific Ideas

- WAHA API base: http://127.0.0.1:3004 on hpg6
- API Key header: X-Api-Key
- E2E testing with both sessions available
- Group webhook events may use event names like "group.join", "group.leave", "group.update" — check WAHA swagger at https://waha.nesher.co/swagger/

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>
