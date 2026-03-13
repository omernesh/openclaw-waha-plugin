# Phase 6: WhatsApp Rules and Policy System - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning
**Source:** PRD Express Path (docs/extra phase/claude-code-handoff.md, resolver-algorithm.md, whatsapp-rules-loading-design.md, whatsapp-rules-schema.yaml)

<domain>
## Phase Boundary

This phase adds a lazy-loaded WhatsApp rules/policy system to the waha-oc plugin. The system supports hierarchical contact and group rules with sparse overrides, dynamic group participant allowlists, manager authorization for policy edits, and compact resolved-policy payload injection into model turns — all without increasing startup context load.

</domain>

<decisions>
## Implementation Decisions

### Rules Hierarchy
- Global contact default + optional specific contact override
- Global group default + optional specific group override
- Optional current-speaker contact rules when needed by group policy
- Merge precedence: system defaults → global scope → specific override → runtime constraints → owner explicit override
- Scalars: higher layer replaces lower. Arrays: replace (not append). Objects: deep merge by key. Missing fields = inherit.

### Lazy Loading (HARD REQUIREMENT)
- Rules load ONLY after message passes WAHA/OpenClaw hard filter (inbound) or before a specific outbound send
- NEVER load all rules at gateway startup
- NEVER pre-load all participant files for a group — only current speaker when needed
- Event-driven loading, not startup-driven

### DM Behavior
- Resolve target contact stable identity
- Load global contact defaults → specific contact override if present → merge → inject compact resolved payload

### Group Behavior
- Resolve target group identity + current speaker identity
- Load global group defaults → specific group override → merge
- Evaluate `contact_rule_mode`: apply/ignore/restricted — determines if speaker contact policy loads
- Evaluate `participants_allowlist.mode`: everyone/none/explicit/admins
- Handle unknown participants via `unknown_participant_policy`: fallback_to_global_contact/deny/observe_only
- Load current speaker contact policy ONLY when needed (not all participants)

### File Layout (YAML)
- Rules stored under a dedicated path (e.g., `rules/contacts/_default.yaml`, `rules/groups/_default.yaml`)
- Specific overrides: `rules/contacts/<safe-name>__<id>.yaml`, `rules/groups/<safe-name>__<id>.yaml`
- `_default.yaml` mandatory for both contacts and groups
- Specific files are sparse partial overrides, NOT full copies

### Identity Normalization
- Stable IDs: `@c:...` (phone JID), `@lid:...` (LID), `@g:...` (group)
- Use stable IDs for enforcement, never display names alone
- Normalize JID/LID for consistent policy resolution

### Manager Authorization
- Owner (super-admin) = only one who can appoint/revoke managers
- Global managers can edit lower-scope policy but NOT appoint/revoke
- Contact managers edit only that contact scope
- Group managers edit only that group scope
- Non-managers cannot change policy
- Authorization is code-enforced, not prompt-only

### Compact Resolved Payload
- Never inject raw rule files into model context
- Resolve/merge in plugin code → inject compact effective policy per event
- DM payload: chat_type, target_id, can_initiate, can_reply, privacy_level, tone, language, forbidden_actions, manager_edit_allowed
- Group payload: + speaker_id, participation_mode, proactive_allowed, contact_rule_mode, participants_allowlist_mode, speaker_allowed, unknown_participant_policy, forbidden_topics

### Caching Strategy
- Short TTL in-memory cache keyed by scope ID + file modification time
- Invalidate on file update or policy edit
- Cache resolved policy blobs, not full directory loads
- No preloading

### Error Handling
- Missing global default: fail closed for editing, use hardcoded safe defaults for messages, log loudly
- Malformed override: ignore override, fall back to global default, log validation error
- Unresolvable identity: use safest available normalized ID, never grant extra permissions
- Missing manager data: treat as no managers except owner

### Security Posture
- Never use display name alone for authorization
- Never let non-owner appoint/revoke managers
- Never assume unknown participant == trusted
- Never bypass policy load for proactive sends
- Never depend on model memory for rules

### Claude's Discretion
- Internal module organization (suggested: rules-loader, rules-merge, rules-resolver, policy-enforcer, manager-authorizer, policy-cache, resolved-payload-builder, identity-resolver)
- Exact file storage path for rules (workspace vs plugin directory)
- YAML parsing library choice
- Cache TTL values
- Hook integration points in existing inbound.ts/send.ts code
- Admin panel UI for rules management (if included)
- Whether to add admin API endpoints for CRUD operations on rules
- Test strategy and test file organization

</decisions>

<specifics>
## Specific Ideas

### Schema Reference (from whatsapp-rules-schema.yaml)
- Contact fields: enabled, identity, trust_level, privacy_level, can_initiate, can_reply, can_use_memory, can_reference_calendar, tone, language, allowed_triggers, forbidden_actions, managers, notes
- Group fields: enabled, identity, group_type, participation_mode, proactive_allowed, who_can_trigger_me, participants_allowlist, unknown_participant_policy, privacy_level, tone, language_policy, allowed_topics, forbidden_topics, contact_rule_mode, managers, notes
- Participation modes: silent_observer, mention_only, trigger_word_only, direct_question_only, allowed_participants_only, open
- Trust levels: blocked, low, normal, trusted, owner
- Privacy levels: none, low, limited, trusted, full

### Resolver Algorithm Flows (from resolver-algorithm.md)
- A: Inbound DM Resolution (10 steps)
- B: Inbound Group Resolution (16 steps with participant gate evaluation)
- C: Outbound DM Resolution (9 steps)
- D: Outbound Group Resolution (10 steps)
- E: Policy Edit Authorization Flow (12 steps with authorization matrix)
- F: Merge Algorithm (5 input layers, scalar/array/object rules)
- G: Resolved Policy Payload Construction (DM and group examples)
- H: Caching Strategy (scope ID + mtime keyed)
- I: Error Handling (4 failure modes)

### Owner Identity
- `@c:972544329000@c.us` (Omer)
- Only owner can appoint/revoke managers at any scope

### Existing Integration Points
- `inbound.ts` — webhook handler, message preprocessing (inbound pre-dispatch hook location)
- `send.ts` — all WAHA API calls, assertCanSend guardrail (outbound pre-send hook location)
- `channel.ts` — action routing, handleAction dispatch
- `monitor.ts` — admin panel, webhook HTTP server
- `accounts.ts` — multi-account/session resolution
- `normalize.ts` — JID/target normalization (extend for rules identity normalization)

</specifics>

<deferred>
## Deferred Ideas

- UI-based rules editor in admin panel (file-based for v1, UI later)
- Role buckets like `admins`, `vip`, `owner_only` for participants_allowlist (v2)
- Appendable array fields in merge (v2 — replace-only for v1)
- `null` as explicit value in overrides (document if supported later)
- Media URL expiration handling in context of rules
- Group participant join/leave event hooks
- Anti-spam moderator features (separate `sammie-anti-spam-moderator` design exists)

</deferred>

---

*Phase: 06-whatsapp-rules-and-policy-system*
*Context gathered: 2026-03-14 via PRD Express Path*
