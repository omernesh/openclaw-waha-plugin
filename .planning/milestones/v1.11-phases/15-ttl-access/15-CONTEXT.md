# Phase 15: TTL Access - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Add time-limited access grants to the allowlist system. Contacts and groups can receive auto-expiring access via an `expires_at` column on `allow_list`. Expired entries are transparently blocked at the SQL layer. Admin panel shows remaining TTL with color-coded badges and grayed-out expired entries. Periodic cleanup removes stale rows during sync cycles.

</domain>

<decisions>
## Implementation Decisions

### TTL Schema & Enforcement
- `allow_list` table gets `expires_at INTEGER` column (Unix timestamp, NULL = never expires) — migration-safe ALTER TABLE
- SQL-level enforcement: all allow_list queries add `AND (expires_at IS NULL OR expires_at > strftime('%s','now'))` — expired entries transparently blocked
- Periodic cleanup during sync cycle (Phase 13 sync.ts) — delete rows where `expires_at < now - 24h` (keep recently expired for 24h visual feedback window)

### Admin Panel UI
- "Access Expires" dropdown in contact/group settings: "Never" / "30 minutes" / "1 hour" / "4 hours" / "24 hours" / "7 days" / "Custom..." (Custom shows datetime picker)
- Remaining time badge next to contact/group name: "Expires in 2h 14m" — green >1h, yellow <1h, red <15m
- Expired entries: grayed out row with "Expired" badge, sorted to bottom of list

### Claude's Discretion
- Exact SQL for cleanup query (DELETE WHERE expires_at < ?)
- Whether to add expires_at to dm_settings too or just allow_list
- PUT endpoint for setting/clearing TTL on existing allowlist entries
- How "Custom..." datetime picker renders in the embedded admin panel
- Whether expired entries show in directory by default or behind a toggle

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `allow_list` table in directory.ts — jid, allow_dm, added_at columns
- `isAllowed()` / `isDmAllowed()` queries in directory.ts
- `buildContactCard()` in monitor.ts — contact settings drawer
- `showToast()` — feedback notifications
- `sync.ts` runSyncCycle — place to add periodic cleanup

### Established Patterns
- Migration-safe ALTER TABLE with try/catch for idempotent column additions
- Badge CSS: `.badge` class with color variants
- Contact card settings: mode dropdown, Can Initiate dropdown
- textContent-only rendering for all user-supplied data

### Integration Points
- `directory.ts` isAllowed/isDmAllowed — must add expires_at check
- `inbound.ts` — calls isAllowed during message filtering (no changes needed if SQL handles it)
- Contact/group settings card — add "Access Expires" field
- Directory listing — show TTL badges and visual expired state
- `sync.ts` — add cleanup step to runSyncCycle

</code_context>

<specifics>
## Specific Ideas

- FEATURE-02: TTL-based auto-expiring access for contacts and groups
- Ties into FEATURE-01 (pairing mode) in Phase 16 — pairing grants can set TTL automatically

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
