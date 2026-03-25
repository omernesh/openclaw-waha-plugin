# Phase 44: Invite Link Documentation - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure/docs phase)

<domain>
## Phase Boundary

Update SKILL.md to clearly document getInviteCode, revokeInviteCode, and joinGroup actions so agents can confidently retrieve and share invite links. Also document the new /join, /leave, /list slash commands.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure documentation phase. Use ROADMAP phase goal, success criteria, and existing SKILL.md structure to guide updates.

Key context:
- getInviteCode already exists in channel.ts (line 214) and send.ts (line 1004)
- revokeInviteCode exists in channel.ts (line 215) and send.ts (line 1014)
- joinGroup exists in channel.ts (line 216) and send.ts (line 1026)
- SKILL.md already mentions these briefly but lacks clear examples and parameter docs
- New slash commands (/join, /leave, /list) from Phase 43 need documentation

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- SKILL.md already has sections for group management, channel management
- Existing action documentation pattern in SKILL.md

### Integration Points
- SKILL.md is read by the LLM at runtime — clear docs = agent can use features

</code_context>

<specifics>
## Specific Ideas

No specific requirements — documentation phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
