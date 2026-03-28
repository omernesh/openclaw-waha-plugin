# Phase 64: Multi-Tenant Process Isolation - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous mode)

<domain>
## Phase Boundary

Multiple workspaces run in isolated processes so a crash or SQLite write storm in one workspace cannot affect any other. Per-workspace process, SQLite DBs, WAHA session namespacing, API gateway routing.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key areas:
- Process isolation model (child_process.fork vs worker_threads)
- Process manager implementation
- Workspace-scoped SQLite paths
- WAHA session naming convention
- API gateway routing (by API key → workspace)

</decisions>
