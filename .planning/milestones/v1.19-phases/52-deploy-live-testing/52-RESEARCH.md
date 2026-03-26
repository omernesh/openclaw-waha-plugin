# Phase 52: Deploy & Live Testing - Research

**Researched:** 2026-03-26
**Domain:** Deployment (SCP + jiti cache) + live WhatsApp agent verification
**Confidence:** HIGH

## Summary

Phase 52 is purely operational: deploy Phase 48's source code changes to hpg6, then drive the agent through 12 live test scenarios covering the newly exposed actions. No code is written in this phase — only deployment commands and agent-driven test interactions.

**What's deployed vs what's pending:** The deployed code on hpg6 (both locations) is v1.18 state. Phase 48 committed `5c8c9b5` added 54+ handler entries and replaced UTILITY_ACTIONS (35 entries → 109 entries) in `src/channel.ts`, plus 4 new exported functions in `src/send.ts`. These changes exist locally but have NOT been SCP'd to hpg6. Phase 51 already deployed SKILL.md v6.0.0 and all 10 category skill files — those are already live.

**WAHA status note:** At research time, `postgres-waha` container was "unhealthy" and in DB recovery mode (WAHA returned 500 on all API calls). This is likely transient — the plan must include a health check step before starting live tests.

**Primary recommendation:** SCP `src/channel.ts` and `src/send.ts` to both hpg6 locations, clear jiti, restart gateway, wait 90s, health-check WAHA, then run 12 test scenarios in order.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion — deployment and testing phase. Use ROADMAP phase goal, success criteria, and CLAUDE.md deploy workflow to guide decisions.

### Claude's Discretion
All implementation choices — deployment and testing phase.

### Deferred Ideas (OUT OF SCOPE)
None — deployment/testing phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TST-01 | Agent adds Michael Greenberg (972556839823@c.us) to test group and removes him | `addParticipants`/`removeParticipants` in UTILITY_ACTIONS after deploy |
| TST-02 | Agent promotes Michael to admin and demotes back to member | `promoteToAdmin`/`demoteToMember` in UTILITY_ACTIONS after deploy |
| TST-03 | Agent updates group subject and description | `setGroupSubject`/`setGroupDescription` in UTILITY_ACTIONS after deploy |
| TST-04 | Agent sets and deletes group picture | `setGroupPicture`/`deleteGroupPicture` in UTILITY_ACTIONS after deploy |
| TST-05 | Agent toggles info-admin-only and messages-admin-only settings | `setInfoAdminOnly`/`setMessagesAdminOnly` in UTILITY_ACTIONS after deploy |
| TST-06 | Agent gets and revokes invite code | `getInviteCode`/`revokeInviteCode` in UTILITY_ACTIONS after deploy |
| TST-07 | Agent gets group participants list | `getParticipants` — already in old UTILITY_ACTIONS, should work pre-deploy |
| TST-08 | Agent creates a test group and deletes it | `createGroup`/`deleteGroup` in UTILITY_ACTIONS after deploy |
| TST-09 | Agent gets contact about info and profile picture | `getContactAbout`/`getContactPicture` in UTILITY_ACTIONS after deploy |
| TST-10 | Agent posts a text status and deletes it | `sendTextStatus`/`deleteStatus` in UTILITY_ACTIONS after deploy |
| TST-11 | Agent sets bot presence to online | `setPresence` in UTILITY_ACTIONS after deploy |
| TST-12 | /join, /leave, /list still work after refactoring (regression check) | slash commands in commands.ts — not affected by Phase 48 changes |
</phase_requirements>

## Standard Stack

### Deployment Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| `scp` | Transfer files to hpg6 | Must target `src/` subdirectory |
| `ssh` | Remote execution | Key auth, omer@100.114.126.43 |
| `systemctl --user` | Start/stop gateway | `openclaw-gateway` unit |
| `rm -rf /tmp/jiti/` | Clear jiti cache | CRITICAL — must do before start |
| `curl` | WAHA API calls + verification | With `X-Api-Key` header |

### Test Infrastructure
| Item | Value |
|------|-------|
| Bot session | `3cf11776_logan` |
| Omer trigger session | `3cf11776_omer` |
| Test group JID | `120363421825201386@g.us` |
| Michael Greenberg JID | `972556839823@c.us` |
| WAHA API base | `http://127.0.0.1:3004` |
| WAHA API key header | `X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=` |

## Architecture Patterns

### Deploy Sequence (CLAUDE.md mandated)
1. SCP `src/channel.ts` → both hpg6 `src/` dirs
2. SCP `src/send.ts` → both hpg6 `src/` dirs
3. SCP `package.json` → both hpg6 roots (version bump)
4. `systemctl --user stop openclaw-gateway`
5. `rm -rf /tmp/jiti/`
6. `systemctl --user start openclaw-gateway`
7. Wait 90 seconds (agent loading time)
8. Check logs: `journalctl --user -u openclaw-gateway --since "2 minutes ago" --no-pager`

### Both hpg6 Locations (must update both)
- `~/.openclaw/extensions/waha/src/` — runtime (gateway loads from here)
- `~/.openclaw/workspace/skills/waha-openclaw-channel/src/` — workspace backup

### Test Trigger Pattern
Send message to test group via Omer session → agent (logan session) reads it → agent executes action → verify via WAHA API or bot reply:
```bash
ssh omer@100.114.126.43 'curl -s -X POST http://127.0.0.1:3004/api/sendText \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=" \
  -d "{\"chatId\":\"120363421825201386@g.us\",\"text\":\"INSTRUCTION HERE\",\"session\":\"3cf11776_omer\"}"'
```

### Verification Pattern
After each test action, verify via WAHA API (not just gateway logs):
```bash
# Check recent bot messages
ssh omer@100.114.126.43 'curl -s "http://127.0.0.1:3004/api/3cf11776_logan/chats/120363421825201386@g.us/messages?limit=3&downloadMedia=false" \
  -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA="'

# Verify group participants changed
ssh omer@100.114.126.43 'curl -s "http://127.0.0.1:3004/api/3cf11776_logan/groups/120363421825201386@g.us/participants" \
  -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA="'
```

### Anti-Patterns to Avoid
- **Deploy to root instead of `src/`**: jiti resolves `.ts` from `src/` subdir — root SCP silently does nothing
- **Skip jiti cache clear**: Cache is path-hash based. Old compiled version serves stale code even after source change
- **Test before 90s startup wait**: Agent wiring takes ~90s — testing immediately gives false negatives
- **Rely only on gateway logs**: Structured logger output is unreliable in logs; verify via WAHA messages API
- **Testing with WAHA unhealthy**: If `postgres-waha` is in recovery mode, all tests will fail at WAHA level — check health first

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| File deployment | Custom script | Direct `scp` commands |
| Test orchestration | Test harness | Manual WAHA `sendText` → observe agent reply |
| Action verification | Parser | Direct WAHA API calls to check state |

## Runtime State Inventory

> Phase 48 modified `src/channel.ts` and `src/send.ts`. These files are compiled by jiti at runtime from the `src/` subdirectory. Cache path: `/tmp/jiti/` on hpg6.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 48 changes are code-only, no DB schema changes | None |
| Live service config | Gateway loaded with v1.18 `channel.ts` (pre-Phase-48 UTILITY_ACTIONS) | Deploy + restart to pick up Phase 48 changes |
| OS-registered state | jiti cache at `/tmp/jiti/` on hpg6 has pre-Phase-48 compiled `channel.ts` and `send.ts` | `rm -rf /tmp/jiti/` after stop, before start |
| Secrets/env vars | None affected | None |
| Build artifacts | Both hpg6 locations (`extensions/waha/src/`, `workspace/.../src/`) have v1.18 source | SCP both files to both locations |

**Deployment gap confirmed:**
- Deployed `channel.ts` line count: 1,167 (v1.18 state)
- Local `channel.ts` line count: 1,229 (Phase 48 — 109-entry UTILITY_ACTIONS)
- Deployed `send.ts` line count: 1,668 (v1.18 — missing `createOrUpdateWahaContact`, `getWahaNewMessageId`, `convertWahaVoice`, `convertWahaVideo`)
- Local `send.ts` line count: 1,722 (Phase 48 additions)
- Phase 51 skill files: already deployed to both hpg6 locations (SKILL.md v6.0.0, 10 category files)

## Common Pitfalls

### Pitfall 1: WAHA DB Unhealthy at Test Time
**What goes wrong:** All WAHA API calls return 500 "database system is in recovery mode". Agent actions fail silently or with errors.
**Why it happens:** `postgres-waha` container showed "unhealthy" status during research. DB recovery can take several minutes.
**How to avoid:** Before running any tests, poll `GET http://127.0.0.1:3004/api/sessions` until it returns 200. If still unhealthy after 5 min, restart WAHA container.
**Warning signs:** `postgres-waha` docker status shows `(unhealthy)`, API returns 500 with `"code":"57P03"`.

### Pitfall 2: Gateway Health Check Shows "Invalid URL" Loop
**What goes wrong:** Logs show `"Health check UNHEALTHY","error":"Invalid URL"` in a loop for logan session — consecutiveFailures in the millions. This is pre-existing and does NOT indicate the new code is broken.
**Why it happens:** Health monitor has a stale/missing WAHA URL for the logan session health endpoint.
**How to avoid:** Ignore this specific error in logs; test agent response via sendText instead.
**Warning signs:** `consecutiveFailures` in millions — this is old, pre-existing.

### Pitfall 3: addParticipants / removeParticipants Requires JID Array
**What goes wrong:** Agent passes a string instead of array for `participants` parameter.
**Why it happens:** LLM may serialize single participant as string.
**How to avoid:** Include explicit parameter examples in test instructions. Verify agent uses `["972556839823@c.us"]` format.

### Pitfall 4: deleteStatus Requires Message ID
**What goes wrong:** Agent tries `deleteStatus` without a valid status message ID to delete.
**Why it happens:** Must first call `sendTextStatus` and capture the returned message ID.
**How to avoid:** Structure TST-10 as two sequential steps: send status → get ID from response → delete using that ID.

### Pitfall 5: setGroupPicture Requires File Path or URL
**What goes wrong:** `setGroupPicture` requires `file` param (URL or local path to image). Agent may not have a suitable image readily available.
**How to avoid:** Use a known public image URL (e.g., `https://picsum.photos/200`) in the test instruction.

### Pitfall 6: getInviteCode / revokeInviteCode Modifies Real Group State
**What goes wrong:** Revoking invite code on the main test group breaks existing invite links.
**How to avoid:** Note this in test — revoke the code, then immediately re-get to confirm new code was generated. Existing members not affected.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| hpg6 SSH (Tailscale) | All deploy steps | ✓ | key auth confirmed | LAN: 192.168.1.120 |
| openclaw-gateway | Agent execution | ✓ | systemctl active (1513972) | — |
| WAHA API (port 3004) | Live tests | Degraded | 2026.3.2 NOWEB PLUS | Wait for DB recovery |
| postgres-waha | WAHA sessions | Degraded | "unhealthy" at research time | Restart container |
| waha-noweb container | WAHA engine | ✓ | Up 2 hours | — |
| jiti | .ts runtime compile | ✓ | in /tmp/jiti/ | — |
| Logan session (3cf11776_logan) | Agent bot | ✓ | WORKING status | — |
| Omer session (3cf11776_omer) | Test triggers | Likely OK (DB-dependent) | — | — |

**Missing dependencies with no fallback:**
- WAHA DB fully recovered — all live tests depend on WAHA API returning 200. Plan must start with health wait.

**Missing dependencies with fallback:**
- postgres-waha unhealthy — restart container if still failing after 5 min wait.

## Validation Architecture

> nyquist_validation not explicitly disabled in config — include section.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual live testing via WAHA API + agent observation |
| Config file | none — manual test protocol |
| Quick run command | Send single WhatsApp message, observe agent reply |
| Full suite command | All 12 TST-XX scenarios in sequence |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Verification Method | Automated? |
|--------|----------|-----------|---------------------|-----------|
| TST-01 | addParticipants / removeParticipants | live | Check `/groups/{jid}/participants` via WAHA API before/after | Manual |
| TST-02 | promoteToAdmin / demoteToMember | live | Check participants list for `isAdmin` flag | Manual |
| TST-03 | setGroupSubject / setGroupDescription | live | Check `/groups/{jid}` for updated fields | Manual |
| TST-04 | setGroupPicture / deleteGroupPicture | live | Agent confirms via reply | Manual |
| TST-05 | setInfoAdminOnly / setMessagesAdminOnly | live | Check `/groups/{jid}` `restrict`/`announce` fields | Manual |
| TST-06 | getInviteCode / revokeInviteCode | live | Agent returns invite URL, then returns new URL after revoke | Manual |
| TST-07 | getParticipants | live | Agent replies with participant list | Manual |
| TST-08 | createGroup / deleteGroup | live | Check groups list before/after | Manual |
| TST-09 | getContactAbout / getContactPicture | live | Agent replies with about text and picture URL | Manual |
| TST-10 | sendTextStatus / deleteStatus | live | Agent replies with status ID, then confirms deletion | Manual |
| TST-11 | setPresence (online) | live | Agent replies confirming presence set | Manual |
| TST-12 | /join, /leave, /list regression | live | Slash commands produce expected output | Manual |

### Wave 0 Gaps
None — no test infrastructure to create. All tests are live agent interactions.

## Code Examples

### Deploy Both Source Files to Both Locations
```bash
# Extensions location (runtime)
scp D:/docker/waha-oc-plugin/src/channel.ts omer@100.114.126.43:~/.openclaw/extensions/waha/src/channel.ts
scp D:/docker/waha-oc-plugin/src/send.ts omer@100.114.126.43:~/.openclaw/extensions/waha/src/send.ts

# Workspace location (backup)
scp D:/docker/waha-oc-plugin/src/channel.ts omer@100.114.126.43:~/.openclaw/workspace/skills/waha-openclaw-channel/src/channel.ts
scp D:/docker/waha-oc-plugin/src/send.ts omer@100.114.126.43:~/.openclaw/workspace/skills/waha-openclaw-channel/src/send.ts
```

### Clear Cache and Restart
```bash
ssh omer@100.114.126.43 'systemctl --user stop openclaw-gateway && rm -rf /tmp/jiti/ && systemctl --user start openclaw-gateway'
```

### Wait and Check Gateway Health
```bash
# Wait 90s then check logs
ssh omer@100.114.126.43 'sleep 90 && journalctl --user -u openclaw-gateway --since "2 minutes ago" --no-pager | tail -20'
```

### Verify UTILITY_ACTIONS Expansion (post-deploy sanity check)
```bash
# Count UTILITY_ACTIONS entries in deployed file — should be ~109
ssh omer@100.114.126.43 'grep -c "addParticipants\|removeParticipants\|promoteToAdmin\|demoteToMember\|setGroupSubject\|setGroupDescription\|setInfoAdminOnly\|setMessagesAdminOnly\|getInviteCode\|revokeInviteCode\|getContactAbout\|getContactPicture\|sendVoiceStatus\|sendVideoStatus\|deleteStatus\|createOrUpdateContact" ~/.openclaw/extensions/waha/src/channel.ts'
# Expected: ~16 matches (vs 1 in current deployed version)
```

### Check WAHA Health Before Testing
```bash
ssh omer@100.114.126.43 'curl -s "http://127.0.0.1:3004/api/sessions" -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=" | head -c 50'
# Look for JSON array (not 500 error) before proceeding to tests
```

### Send Test Trigger to Test Group
```bash
ssh omer@100.114.126.43 'curl -s -X POST http://127.0.0.1:3004/api/sendText \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=" \
  -d "{\"chatId\":\"120363421825201386@g.us\",\"text\":\"[INSTRUCTION]\",\"session\":\"3cf11776_omer\"}"'
```

### Verify Group Participants After TST-01/TST-02
```bash
ssh omer@100.114.126.43 'curl -s "http://127.0.0.1:3004/api/3cf11776_logan/groups/120363421825201386@g.us/participants" \
  -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=" | python3 -m json.tool | grep -E "\"id\"|\"isAdmin\""'
```

### Version Bump + Git Tag (final step)
```bash
cd D:/docker/waha-oc-plugin
# Edit package.json version to 1.19.0
git add src/channel.ts src/send.ts package.json
git commit -m "feat(v1.19): expose 109 WAHA actions and modular skill architecture"
git tag v1.19.0
git push origin main --tags
npm publish --access public
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 35-entry UTILITY_ACTIONS | 109-entry UTILITY_ACTIONS | Phase 48 (2026-03-26) | Agent can now invoke all group admin, contact, status, presence, profile, label actions |
| SKILL.md monolithic 574-line file | 145-line index + 10 category files | Phase 49 (2026-03-26) | Agent reads targeted sub-files instead of full monolith |
| send.ts missing createOrUpdateContact, getNewMessageId, convertVoice, convertVideo | 4 new exported functions | Phase 48 (2026-03-26) | Complete ACT-03, ACT-04, ACT-07 implementation |

## Open Questions

1. **WAHA postgres-waha unhealthy status**
   - What we know: Container showed "unhealthy" at research time; DB in recovery mode with 57P03 error
   - What's unclear: Whether this is transient (just recovering) or ongoing (needs restart/fix)
   - Recommendation: Plan starts with a WAHA health poll step with 5-min timeout before any tests

2. **Test group as second "sammie test group 2" for TST-08**
   - What we know: TST-08 creates a new group and deletes it — better to use a fresh group not the main test group
   - What's unclear: Name to use for the test group
   - Recommendation: Plan uses "v1.19 temp test" as group name, verify deletion, no impact on main test group

3. **setGroupPicture image source**
   - What we know: Action needs `file` param (URL or path)
   - Recommendation: Use `https://picsum.photos/200` as public image URL in test instruction

## Sources

### Primary (HIGH confidence)
- Direct SSH inspection of hpg6 deployed files — line counts, grep for specific functions confirmed
- Local `src/channel.ts` Phase 48 code — UTILITY_ACTIONS array directly read
- `48-01-SUMMARY.md` — Phase 48 deliverables confirmed
- `51-01-SUMMARY.md` — Phase 51 deployment confirmed (skill files already live)
- CLAUDE.md deploy workflow — SCP/jiti/restart procedure

### Secondary (MEDIUM confidence)
- WAHA API endpoint structure — from existing code patterns in send.ts
- Docker container status — `docker ps` output at research time

### Tertiary (LOW confidence)
- WAHA postgres-waha recovery time estimate — based on general PostgreSQL behavior, not confirmed

## Metadata

**Confidence breakdown:**
- Deployment procedure: HIGH — CLAUDE.md mandated workflow, confirmed by multiple prior phases
- What's deployed vs pending: HIGH — confirmed by line count diffs and direct grep on hpg6 files
- Test scenarios: HIGH — requirement IDs from REQUIREMENTS.md, JIDs from CLAUDE.md
- WAHA health state: MEDIUM — transient, may recover before plan execution

**Research date:** 2026-03-26
**Valid until:** 2026-03-27 (deployment is time-sensitive — jiti cache state may change)
