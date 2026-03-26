# Phase 47: Live WhatsApp Testing - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning
**Mode:** Auto-generated (testing phase)

<domain>
## Phase Boundary

Deploy v1.18 changes to hpg6, then test all new features end-to-end via WhatsApp and browser. Tests require real WhatsApp messages and admin panel interaction.

</domain>

<decisions>
## Implementation Decisions

### Deployment
- Build locally, SCP to BOTH hpg6 locations, restart gateway
- Verify no startup errors in logs

### Test Plan
- TST-01: Join by invite link — send /join with a real invite link
- TST-02: Join by name — send /join with exact group name, then ambiguous name
- TST-03: Leave group/channel — send /leave with a group name
- TST-04: /list commands — send /list, /list groups, /list channels
- TST-05: Invite link retrieval — ask agent to get invite link for a group
- TST-06: Admin UI — test Leave button and Join by Link in browser

### Claude's Discretion
- Which test group/channel to use
- Order of tests
- How to handle test failures

</decisions>

<code_context>
## Existing Code Insights

### Deployment Steps
1. npm run build (or tsc)
2. SCP dist/ + package.json + SKILL.md to both hpg6 locations
3. systemctl --user restart openclaw-gateway
4. Check logs for errors

### Test Infrastructure
- WAHA API at http://127.0.0.1:3004 on hpg6
- Bot session: 3cf11776_logan
- Omer session: 3cf11776_omer
- Test group: 120363421825201386@g.us
- Admin panel at the webhook server port

</code_context>

<specifics>
## Specific Ideas

- User said "sammie and you can use whatsapp" for testing
- Use the whatsapp-messenger skill to send test messages
- Check gateway logs after each test

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
