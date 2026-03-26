# Phase 51: Claude Code Skill Update - Research

**Researched:** 2026-03-26
**Domain:** Claude Code skill file authoring / whatsapp-messenger skill sync
**Confidence:** HIGH

## Summary

The whatsapp-messenger Claude Code skill exists in two locations and is severely outdated. The skill at `~/.claude/skills/whatsapp-messenger/SKILL.md` on SIMPC (and its mirror on hpg6 at `~/.openclaw/workspace/skills/waha-openclaw-channel/skills/whatsapp-messenger/SKILL.md`) is version 1.0.0 — a minimal file covering only 5 WAHA operations via raw SSH/curl. It does not mention the OpenClaw action gateway at all. It does not reference the modular skill structure created in Phase 49. The WAHA plugin SKILL.md (v6.0.0) already has the full modular index with 10 category files, but the Claude Code-facing whatsapp-messenger skill has never been updated to reflect this.

The whatsapp-messenger skill's job is different from the plugin's SKILL.md: the plugin SKILL.md teaches the OpenClaw LLM (the agent running on `3cf11776_logan`) how to use the whatsapp action system. The whatsapp-messenger skill teaches Claude Code sessions (on SIMPC) how to send WhatsApp messages from the developer's machine — currently via raw WAHA REST API calls over SSH. Phase 48 exposed ~45 new utility actions through the OpenClaw gateway; the whatsapp-messenger skill should reflect that the preferred invocation path is now through the OpenClaw action system, while also keeping the direct WAHA API fallback for simple sends.

Phase 49 created 10 category files (`skills/*.md`) as part of the plugin's modular skill architecture. The whatsapp-messenger Claude Code skill should reference these files (or summarize them) so Claude Code sessions know about all available actions post-v1.19, not just the 5 operations from v1.0.0.

**Primary recommendation:** Rewrite `skills/whatsapp-messenger/SKILL.md` to v2.0.0 — point to the plugin's modular category files, add OpenClaw gateway invocation as the primary path, keep SSH/WAHA direct as fallback. Deploy to both SIMPC (`~/.claude/skills/whatsapp-messenger/`) and hpg6 (`~/.openclaw/workspace/skills/waha-openclaw-channel/skills/whatsapp-messenger/`).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — infrastructure phase, all implementation choices are at Claude's discretion.

### Claude's Discretion
All implementation choices. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SKL-06 | whatsapp-messenger Claude Code skill updated to match new structure | Skill file located at `skills/whatsapp-messenger/SKILL.md` in repo + two deploy locations. Must reference Phase 49 category files and Phase 48 new actions. |
</phase_requirements>

## Current State — What Exists

### whatsapp-messenger Skill (Claude Code facing)

**File in repo:** `D:\docker\waha-oc-plugin\skills\whatsapp-messenger\SKILL.md`
**Version:** 2.0.0 (repo) / 1.0.0 (deployed)

**Repo version (v2.0.0)** — already written, 308 lines, covers all actions via OpenClaw gateway invocation format (Action/Target/Parameters tables). This is what Phase 49 produced for the local/repo copy.

**Deployed versions (v1.0.0)** — outdated, 95 lines, only covers:
- Send text message (raw WAHA API via Python/curl)
- Read recent messages (raw WAHA API)
- Create poll (raw WAHA API)
- Send reaction (raw WAHA API)
- Send location (raw WAHA API)
- List groups (raw WAHA API)

The deployed versions at both locations do NOT reflect the OpenClaw gateway invocation model, the modular skill structure, or any of the ~45 new actions from Phase 48.

### Deploy Locations for whatsapp-messenger Skill

| Location | Machine | Path | Current Version |
|----------|---------|------|-----------------|
| SIMPC user skills | SIMPC | `~/.claude/skills/whatsapp-messenger/SKILL.md` | v1.0.0 (outdated) |
| hpg6 plugin workspace | hpg6 | `~/.openclaw/workspace/skills/waha-openclaw-channel/skills/whatsapp-messenger/SKILL.md` | v1.0.0 (outdated) |

Note: The hpg6 plugin workspace also has the full plugin `SKILL.md` at `~/.openclaw/workspace/skills/waha-openclaw-channel/SKILL.md` — that is the v5.0.0 (outdated; deployed before Phase 49). It also needs updating to v6.0.0.

### Plugin SKILL.md (OpenClaw agent facing)

**File in repo:** `D:\docker\waha-oc-plugin\SKILL.md`
**Version:** 6.0.0 (Phase 49 output)
**Status:** Current — modular index with 10 category files. Already deployed? Unknown — check during plan.

### Category Skill Files (Phase 49 output)

Located in `D:\docker\waha-oc-plugin\skills/`:
- `messaging.md` — send, poll, react, reply, sendEvent, sendLocation, readMessages
- `groups.md` — createGroup, addParticipants, joinGroup, getInviteCode, all group admin actions
- `contacts.md` — getContacts, blockContact, sendContactVcard, createOrUpdateContact
- `channels.md` — followChannel, searchChannelsByText, createChannel
- `chats.md` — archiveChat, getChatMessages, muteChat, labels
- `status.md` — sendTextStatus, sendImageStatus, deleteStatus
- `presence.md` — setPresenceStatus, setPresence, getPresence, subscribePresence
- `profile.md` — getProfile, setProfileName, setProfilePicture
- `media.md` — sendImage, sendVideo, sendFile, convertVoice, LID lookups
- `slash-commands.md` — /join, /leave, /list, /shutup

These live in `skills/` subdirectory relative to the plugin root, not inside `skills/whatsapp-messenger/`.

## Architecture Patterns

### Two Distinct Audiences

The repo has two different skill file systems:

1. **Plugin SKILL.md + category files** — consumed by the OpenClaw gateway to instruct the AI agent (`3cf11776_logan`) on how to invoke plugin actions via the OpenClaw action system. Located at repo root `SKILL.md` + `skills/*.md`.

2. **whatsapp-messenger Claude Code skill** — consumed by Claude Code sessions on SIMPC. Tells human-side Claude Code how to send WhatsApp messages. Located at `skills/whatsapp-messenger/SKILL.md`.

The Claude Code skill's invocation model differs: it calls OpenClaw via `python3 -c` or the plugin's actions indirectly. However, the repo version (v2.0.0) already updated this to use the OpenClaw action invocation format (Action/Target/Parameters tables) and deprecated raw WAHA calls.

### What "Updated to Match New Structure" Means

Success criteria for SKL-06:
1. Skill references the new modular SKILL.md index structure (the 10 category files)
2. All newly exposed actions from Phase 48 appear in the skill with correct invocation examples
3. Skill accurately reflects the full action surface available post-v1.19

The repo file (`skills/whatsapp-messenger/SKILL.md`) is already at v2.0.0 and covers all actions. **The gap is deployment** — v1.0.0 is what's live at both deploy locations.

Additionally, the description frontmatter in v2.0.0 may need updating to mention the new action categories so Claude Code correctly routes to this skill for group/contact/channel/profile tasks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Action inventory | Manually re-documenting all ~110 actions | Reference the existing category files in `skills/*.md` — they are authoritative |
| Invocation examples | Custom SSH/curl snippets for each new action | The repo SKILL.md v2.0.0 already uses the OpenClaw gateway invocation format |

## Common Pitfalls

### Pitfall 1: Updating Repo File But Not Deploying
**What goes wrong:** Repo has v2.0.0 but Claude Code on SIMPC still reads v1.0.0 at `~/.claude/skills/whatsapp-messenger/SKILL.md`.
**How to avoid:** Copy file to `~/.claude/skills/whatsapp-messenger/SKILL.md` on SIMPC AND SCP to hpg6 location.

### Pitfall 2: Forgetting hpg6 Workspace Location
**What goes wrong:** Only update SIMPC, but hpg6 still has v1.0.0 at `~/.openclaw/workspace/skills/waha-openclaw-channel/skills/whatsapp-messenger/SKILL.md`.
**How to avoid:** Both deploy locations are listed above — must update both.

### Pitfall 3: Plugin SKILL.md Not Deployed to hpg6
**What goes wrong:** Phase 49 updated `SKILL.md` to v6.0.0 in repo, but `~/.openclaw/workspace/skills/waha-openclaw-channel/SKILL.md` on hpg6 still shows v5.0.0. The category files also need to be SCP'd to hpg6.
**How to avoid:** Deploy `SKILL.md` + all `skills/*.md` files to hpg6 as part of this phase (or verify Phase 49 already did it).

### Pitfall 4: Category Files Not at Expected Paths on hpg6
**What goes wrong:** The plugin SKILL.md references `[skills/messaging.md](skills/messaging.md)` — if the `skills/` subdirectory doesn't exist at hpg6, the links are broken.
**How to avoid:** Verify `skills/` directory exists at both hpg6 locations and contains all 10 files.

### Pitfall 5: Description Frontmatter Too Narrow
**What goes wrong:** Claude Code reads the `description` to decide when to use this skill. If description only mentions "send messages" and "create polls", it won't use the skill for "add someone to a group" or "get my profile".
**How to avoid:** Update the `description` frontmatter to enumerate the full action surface breadth (groups, contacts, channels, status, presence, profile, media).

## Code Examples

### Current Deployed Skill (v1.0.0) — outdated
The deployed file at `~/.claude/skills/whatsapp-messenger/SKILL.md` is 95 lines, raw WAHA API invocations only. Does not know about OpenClaw gateway, utility actions, or Phase 48/49 additions.

### Repo Skill (v2.0.0) — correct target
The file at `D:\docker\waha-oc-plugin\skills\whatsapp-messenger\SKILL.md` (308 lines) is what should be deployed. It covers all action categories in OpenClaw invocation format.

### Verification Command
```bash
# Check version deployed to SIMPC
head -5 ~/.claude/skills/whatsapp-messenger/SKILL.md

# Check version deployed to hpg6
ssh omer@100.114.126.43 'head -5 ~/.openclaw/workspace/skills/waha-openclaw-channel/skills/whatsapp-messenger/SKILL.md'

# Check category files exist on hpg6
ssh omer@100.114.126.43 'ls ~/.openclaw/workspace/skills/waha-openclaw-channel/skills/'
```

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| SSH to hpg6 | Deploy whatsapp-messenger to hpg6 | Yes | — | — |
| `~/.claude/skills/` on SIMPC | Deploy to SIMPC | Yes | — | — |
| `skills/whatsapp-messenger/` dir on hpg6 | Deploy target | Unknown — verify | — | `mkdir -p` |

## Validation Architecture

No automated test framework applies here — this is a documentation/deployment phase. Validation is manual:

| Req ID | Behavior | Test Type | Command |
|--------|----------|-----------|---------|
| SKL-06a | whatsapp-messenger skill at v2.0.0 on SIMPC | Manual check | `head -5 ~/.claude/skills/whatsapp-messenger/SKILL.md` |
| SKL-06b | whatsapp-messenger skill at v2.0.0 on hpg6 | Manual check | `ssh hpg6 'head -5 ~/.openclaw/.../SKILL.md'` |
| SKL-06c | Description mentions all action categories | Visual review | Read frontmatter description field |
| SKL-06d | Category files present on hpg6 | Manual check | `ssh hpg6 'ls ~/.openclaw/.../skills/'` |
| SKL-06e | Plugin SKILL.md v6.0.0 on hpg6 | Manual check | `ssh hpg6 'head -5 ~/.openclaw/.../waha-openclaw-channel/SKILL.md'` |

## Open Questions

1. **Was SKILL.md v6.0.0 deployed to hpg6 in Phase 49?**
   - What we know: Phase 49 is marked Complete in REQUIREMENTS.md. The hpg6 waha-openclaw-channel SKILL.md shows v5.0.0 in head.
   - What's unclear: Whether Phase 49 deployment step updated hpg6 or only the repo.
   - Recommendation: Check during plan execution; if not deployed, include as a task in this phase.

2. **Are the 10 category skill files deployed to hpg6?**
   - What we know: They exist in repo at `skills/*.md`. They exist in hpg6 workspace at `~/.openclaw/workspace/skills/waha-openclaw-channel/skills/whatsapp-messenger/` (only the whatsapp-messenger SKILL.md was found, not the category files).
   - Recommendation: Check `ls ~/.openclaw/workspace/skills/waha-openclaw-channel/skills/` on hpg6; deploy missing files.

3. **Should the whatsapp-messenger skill directly inline all actions or reference category files?**
   - Decision: Reference category files via links — keeps the whatsapp-messenger skill concise and avoids duplication. The v2.0.0 repo file already does this (uses OpenClaw action tables, not raw WAHA calls).
   - No further research needed.

## Sources

### Primary (HIGH confidence)
- Direct file inspection: `skills/whatsapp-messenger/SKILL.md` (repo v2.0.0)
- Direct file inspection: `~/.claude/skills/whatsapp-messenger/SKILL.md` (deployed v1.0.0)
- Direct SSH inspection: hpg6 deployed v1.0.0 at `~/.openclaw/workspace/skills/waha-openclaw-channel/skills/whatsapp-messenger/SKILL.md`
- Direct file inspection: `SKILL.md` (repo v6.0.0, Phase 49 output)
- Direct file inspection: all 10 `skills/*.md` category files

## Metadata

**Confidence breakdown:**
- Current state inventory: HIGH — files directly read from disk and SSH
- Deployment gap: HIGH — version mismatch confirmed by direct inspection
- Architecture (two audiences): HIGH — confirmed by file contents
- Deploy locations: HIGH — confirmed via SSH directory listing

**Research date:** 2026-03-26
**Valid until:** Until Phase 49/51 deployment completes (static files, no version drift risk)
