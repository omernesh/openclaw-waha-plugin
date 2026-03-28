# Phase 62: MCP Server - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous mode)

<domain>
## Phase Boundary

Any MCP-compatible AI agent (Claude, Cursor, etc.) can connect to Chatlytics and send/receive WhatsApp messages using 8-10 consolidated tools. StreamableHTTPServerTransport + stdio mode for npx chatlytics-mcp.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key areas:
- MCP SDK version and transport config
- Tool consolidation strategy (grouping actions into 8-10 tools)
- Resource URI scheme (chatlytics://)
- stdio wrapper implementation

</decisions>

<code_context>
## Existing Code Insights

Key files: api-v1.ts (REST API handlers), send.ts (WAHA operations), directory.ts (contacts/groups), monitor.ts (HTTP server).

</code_context>

<specifics>
## Specific Ideas

None beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
