# Phase 31: Test Coverage Sprint - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add test suites to all critical untested modules — monitor.ts admin API routes, inbound.ts pipeline, directory.ts CRUD, shutup.ts interactive flow, and React admin panel components.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — test phase:

- TST-01: monitor.ts admin API route tests. Mock HTTP req/res objects, test each endpoint (stats, config, health, directory, recovery, analytics, presence, modules). Verify correct status codes, JSON response shapes, error handling. Use vitest.
- TST-02: inbound.ts pipeline tests. Mock OpenClaw SDK imports that prevent direct testing. Test filter/dedup/queue flow, DM filter, group filter, trigger word detection, fromMe skip, command interception. Use vitest.
- TST-03: directory.ts CRUD tests. Test contact CRUD, participant management, group filter overrides, LID mapping, DM settings, allow list. Use in-memory SQLite for fast tests. Use vitest.
- TST-04: shutup.ts interactive flow tests. Test mute/unmute with pending selections, duration parsing, group selection, confirmation flow. Use vitest.
- TST-05: React admin panel component tests. Use vitest + @testing-library/react. Test at least one component per tab (DashboardTab, SettingsTab, DirectoryTab, LogTab, AnalyticsTab). Test rendering, user interactions, API call mocking.
- Test files colocated: src/*.test.ts for backend, src/admin/src/**/*.test.tsx for frontend
- All tests must pass with `npx vitest run`
- Target: every exported function in tested modules has at least one test

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Existing test files: 35+ in src/ (vitest, pattern established)
- vitest.config.ts — already configured
- Test utilities in existing test files (mock patterns, helpers)

### Established Patterns
- vitest with describe/it/expect
- Mock WAHA API calls with vi.mock
- Test pure functions extracted from modules
- In-memory SQLite for directory tests (existing pattern in src/directory.test.ts if exists)

### Integration Points
- src/monitor.test.ts — new
- src/inbound.test.ts — new
- src/directory.test.ts — extend or create
- src/shutup.test.ts — new
- src/admin/src/**/*.test.tsx — new

</code_context>

<specifics>
## Specific Ideas

- For monitor.ts: create mock req/res objects, call route handlers directly
- For inbound.ts: mock the OpenClaw SDK imports, test the filter/dedup logic
- For directory.ts: use :memory: SQLite database
- For React: use @testing-library/react with vitest, mock api.ts calls

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>
