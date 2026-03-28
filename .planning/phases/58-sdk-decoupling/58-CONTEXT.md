# Phase 58: SDK Decoupling - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Zero openclaw/plugin-sdk imports exist outside channel.ts and index.ts — the codebase can load and run without the OpenClaw SDK present. Create local type abstractions (platform-types.ts, account-utils.ts, request-utils.ts) to replace all SDK symbols. Ensure CHATLYTICS_CONFIG_PATH env var is respected by the config loader.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
