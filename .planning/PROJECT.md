# WAHA OpenClaw Plugin

## What This Is

A production-grade WhatsApp channel plugin for OpenClaw that enables AI agents (primarily Sammie) to fully interact with WhatsApp — messaging, group management, contact resolution, media handling, and more. Deployed on hpg6, serving as the bridge between OpenClaw's AI gateway and WAHA (WhatsApp HTTP API).

## Core Value

Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures.

## Requirements

### Validated

- ✓ Standard messaging actions (send, poll, react, edit, unsend, pin, unpin, read, delete, reply) — v1.10.4
- ✓ Auto name-to-JID resolution with fuzzy matching and 30s TTL cache — v1.10.0
- ✓ Rich message types (polls, locations, vCards, lists, link previews, buttons, events) — v1.9.x
- ✓ Media handling (images, videos, files, voice messages, stickers) — v1.9.3
- ✓ Search/listing action for groups, contacts, channels — v1.10.3
- ✓ Group management (create, delete, leave, join, rename, participants, invite codes) — v1.8.x
- ✓ Contact management (list, details, exists, block/unblock) — v1.8.x
- ✓ Channel/newsletter management (list, create, delete, follow, unfollow) — v1.8.x
- ✓ Labels CRUD and chat assignment — v1.8.x
- ✓ Status/stories (text, image, voice, video) — v1.8.x
- ✓ Presence management (online/offline, subscribe) — v1.8.x
- ✓ Profile management (name, status, picture) — v1.8.x
- ✓ LID resolution (phone-to-LID, LID-to-phone) — v1.8.x
- ✓ Admin panel with directory, config, filter stats, status tabs — v1.8.7
- ✓ SQLite-backed directory with DM settings, allow-lists, participant tracking — v1.8.7
- ✓ Webhook handler with duplicate event filtering (message vs message.any) — v1.8.x
- ✓ vCard interception in deliverWahaReply — v1.9.5
- ✓ Call rejection — v1.8.x

### Active

- [ ] R1: Structured error logging on all WAHA API calls (no silent failures)
- [ ] R2: Proactive outbound rate limiter (token bucket) + 429 backoff safety net
- [ ] R3: Session health monitoring (periodic ping, disconnect detection)
- [ ] R4: Cache bounds (LRU eviction, max size) and memory leak prevention
- [ ] R5: Request timeouts (AbortController, 30s) and webhook deduplication by messageId
- [ ] F1: Mute/unmute chat actions
- [ ] F2: Inbound group events (join/leave/promote/demote)
- [ ] F3: Mentions detection (@mentions extracted from inbound messages)
- [ ] F4: Multi-recipient send (batch with per-recipient results)
- [ ] F5: Message queue with flood protection (bounded queue, priority DMs)
- [ ] F6: URL preview send (WAHA link-preview endpoint)
- [ ] F7: Better error messages (context-rich, suggested fixes)
- [ ] M1: Multi-session support (session registry, roles, trigger word activation)
- [ ] D1: SKILL.md refresh, unit tests, integration tests, README

### Out of Scope

- Claude Code / Cursor adapter — deferred to Phase 6 (platform abstraction)
- Scheduled messages — WAHA doesn't support
- WhatsApp Business templates — not applicable for personal assistant
- Broadcast lists — WAHA limitation
- Call initiation — WAHA limitation
- Disappearing messages — low priority
- Hot-reload — gateway requires restart, not worth engineering around

## Context

- **Runtime**: TypeScript on Node.js, deployed to hpg6 Linux server
- **WAHA Engine**: NOWEB (has known limitations — poll.vote <5% capture, contacts API needs store.enabled)
- **Gateway**: OpenClaw at `/usr/lib/node_modules/openclaw/dist/` — READ-ONLY, not ours
- **Sessions**: `3cf11776_logan` (Sammie/bot), `3cf11776_omer` (Omer/human)
- **Primary user**: Sammie (AI assistant, he/him) on WhatsApp, model gpt-5.3-codex
- **Code is brittle**: Many hard-won fixes have DO NOT CHANGE markers — always read comments before modifying
- **~87% WAHA API coverage** as of v1.10.4

## Constraints

- **Gateway**: MESSAGE_ACTION_TARGET_MODE is hardcoded — plugins cannot extend it. Only standard action names support targets.
- **Deploy**: Must update BOTH `~/.openclaw/extensions/waha/` AND `~/.openclaw/workspace/skills/waha-openclaw-channel/`
- **Config**: Must write to `~/.openclaw/openclaw.json`, POST expects `{"waha": {...}}` wrapper
- **WAHA quirks**: Groups/contacts/lids APIs return dicts not arrays; media URLs are temporary; groupAllowFrom needs both @c.us and @lid JIDs
- **No hot-reload**: Gateway restart required after every code change

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Standard action names only in listActions() | Gateway rejects custom names with targets | ✓ Good |
| looksLikeId returns true for ALL non-empty strings | Enables name-based targeting (auto-resolve handles the rest) | ✓ Good |
| vCard interception in deliverWahaReply, not sendWahaText | Sammie's replies go through media path, bypassing sendWahaText | ✓ Good |
| SQLite for directory (not in-memory) | Persistence across restarts, proper querying | ✓ Good |
| Embedded admin panel (not separate app) | Single deployment unit, no CORS, shares webhook server | ✓ Good |
| DO NOT CHANGE markers on critical code | Prevents regression on hard-won fixes | ✓ Good |
| Proactive rate limiter + 429 backoff | Prevent overload rather than just react to it | — Pending |
| Multi-session with role-based access | Support bot + human sessions with configurable permissions | — Pending |

---
*Last updated: 2026-03-11 after initialization*
