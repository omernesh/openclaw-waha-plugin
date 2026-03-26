# Phase 27: Pairing Cleanup and Code Quality - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove dead pairing code, fix bot echo pairing bug, ensure deploy reliability, and resolve 5 code quality issues.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — small fixes phase:

**Pairing (PAIR-01, PAIR-02, PAIR-03):**
- PAIR-01: The plugin's PairingEngine (src/pairing.ts) is dead code — gateway-level pairing runs instead. Remove the PairingEngine class and its initialization in channel.ts. Keep pairing.ts if it has other used exports, otherwise remove entirely. Clean up imports.
- PAIR-02: Bot echo messages (fromMe) trigger pairing challenges for the bot itself. Fix by skipping pairing check for fromMe messages in inbound.ts.
- PAIR-03: pairing.ts was missing from deploy artifacts during testing. Ensure the file is included in the npm package files list and deployed correctly. If PairingEngine is removed (PAIR-01), this becomes moot.

**Code Quality (CQ-01 through CQ-05):**
- CQ-01: Fix remaining .catch(() => {}) in shutup.ts:239 — replace with warnOnError() from http-client.ts
- CQ-02: Resolve inbound.ts:704 TODO — resolve actual admin name from Bot Admin role contacts instead of hardcoded placeholder
- CQ-03: Add guard for _cachedConfig singleton in channel.ts:90 — throw descriptive error if outbound methods called before handleAction populates the cache
- CQ-04: Add prefers-color-scheme auto-detect to admin panel theme toggle — respect system preference on first load, then user toggle overrides
- CQ-05: Add log tab export/download button — CSV or plain text download of visible log entries

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/pairing.ts` — PairingEngine class (to be evaluated for removal)
- `src/shutup.ts` — mute/unmute flow with the .catch(() => {}) at line 239
- `src/inbound.ts` — TODO at line 704 for admin name resolution
- `src/channel.ts` — _cachedConfig at line 90
- `src/http-client.ts` — warnOnError() helper
- `src/admin/src/components/tabs/LogTab.tsx` — log viewer component

### Integration Points
- channel.ts — PairingEngine initialization, _cachedConfig
- inbound.ts — pairing check, admin name TODO
- admin panel — theme toggle (App.tsx or layout), LogTab export button

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the listed fixes.

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>
