# Phase 46: Skill Completeness Audit - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning
**Mode:** Auto-generated (audit/docs phase)

<domain>
## Phase Boundary

Audit ALL WAHA API endpoints implemented in send.ts and channel.ts. Update the whatsapp-messenger Claude Code skill to document every available endpoint, organized by category. Exclude "hijacked" endpoints (e.g., sendText used for human behavior mimicry). Also document the new /join, /leave, /list slash commands.

</domain>

<decisions>
## Implementation Decisions

### Scope
- The whatsapp-messenger skill is a Claude Code skill file (not SKILL.md)
- Must audit send.ts (~1600 lines) and channel.ts for all exported API functions
- Exclude hijacked endpoints: sendText when used to mimic human behavior, any internal-only functions
- Include: messaging, groups, contacts, channels, labels, status, presence, profile, media, calls, LID resolution
- Document new /join, /leave, /list slash commands from Phase 43

### Claude's Discretion
- Skill file location and structure
- Category organization
- Level of detail per endpoint
- Whether to include parameter details or just action names

</decisions>

<code_context>
## Existing Code Insights

### Key Files to Audit
- src/send.ts — all WAHA API wrapper functions
- src/channel.ts — action dispatch map (handleAction), listActions()
- src/commands.ts — new slash commands from Phase 43

### Integration Points
- The whatsapp-messenger skill is used by Claude Code sessions to interact with WhatsApp

</code_context>

<specifics>
## Specific Ideas

- User explicitly said: "make sure the skill is updated with all the available waha api endpoints"
- User explicitly said: "don't include the api endpoints we hijacked"
- Organize by category matching WAHA API structure

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
