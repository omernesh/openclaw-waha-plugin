# Phase 61: Webhook Forwarding - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous mode)

<domain>
## Phase Boundary

Every inbound WhatsApp message is delivered to the operator's registered callback URL with a cryptographic signature and automatic retry on failure. HMAC-signed inbound delivery to callback URLs, exponential backoff, circuit breaker.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key areas:
- Queue implementation (in-memory vs SQLite-backed)
- Circuit breaker thresholds
- Dead letter storage
- Retry timing parameters

</decisions>

<code_context>
## Existing Code Insights

Key files: inbound.ts (webhook handler), monitor.ts (HTTP server), config-schema.ts (config validation), api-v1-auth.ts (HMAC patterns).

</code_context>

<specifics>
## Specific Ideas

None beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
