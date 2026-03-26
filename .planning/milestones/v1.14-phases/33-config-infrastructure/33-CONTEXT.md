# Phase 33: Config Infrastructure - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — infrastructure phase)

<domain>
## Phase Boundary

Config file operations are safe under concurrent access — no data loss, no blocking, no corruption. Implements promise-based mutex for serializing config read-modify-write operations, converts blocking readFileSync/writeFileSync to async fs/promises, and adds atomic write-to-temp-then-rename pattern.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

### Key Files
- `src/monitor.ts` — contains `syncAllowListBatch` with readFileSync/writeFileSync and concurrent write race condition
- `src/monitor.ts` — config save handler at POST `/api/admin/config`
- Config file path: `~/.openclaw/openclaw.json`

### Established Patterns
- Config reads/writes currently use `fs.readFileSync`/`fs.writeFileSync`
- No mutex or write lock exists
- `rotateConfigBackups` does backup rotation before writes

### Integration Points
- All admin API routes that modify config
- `syncAllowListBatch` for allow-list persistence
- Config import/export endpoints

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped.

</deferred>
