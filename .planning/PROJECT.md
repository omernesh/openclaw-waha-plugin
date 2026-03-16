# WAHA OpenClaw Plugin

## What This Is

A production-grade WhatsApp channel plugin for OpenClaw that enables AI agents to fully interact with WhatsApp — messaging, group management, contact resolution, media handling, multi-session support, and a rules/policy enforcement system. Deployed on hpg6, serving as the bridge between OpenClaw's AI gateway and WAHA (WhatsApp HTTP API). Ships with an embedded admin panel for directory management, configuration, filter stats, session health, and logs. Includes a YAML-based rules engine that enforces policies on inbound and outbound messages across sessions with configurable merge strategies.

## Core Value

Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

## Current Milestone: v1.11 Polish, Sync & Features

**Goal:** Fix all bugs and CRs from v1.10 human verification, implement background directory sync, and add pairing mode, TTL access, auto-reply, and modules system.

**Target features:**
- Name resolution across all UI (dashboard, settings, directory, participants)
- Background WAHA→SQLite directory sync with local search
- Dashboard polish (per-session stats, collapsible cards, human-readable labels)
- Sessions tab UX (role change, labels, restart handling)
- Consistent tag-style inputs throughout settings
- Directory UX (search fix, tooltips, bulk edit, channels, pagination)
- Refresh button feedback across all tabs
- Pairing mode (passcode-gated temporary access with wa.me deep links)
- TTL-based access for contacts and groups
- Auto-reply canned message to unauthorized DMs
- Modules system with admin panel tab

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
- ✓ SQLite-backed directory with DM settings, allow-lists, participant tracking — v1.8.7
- ✓ Webhook handler with duplicate event filtering (message vs message.any) — v1.8.x
- ✓ vCard interception in deliverWahaReply — v1.9.5
- ✓ Call rejection — v1.8.x
- ✓ R1: Structured error logging on all WAHA API calls — Phase 1
- ✓ R2: Proactive outbound rate limiter (token bucket) + 429 backoff safety net — Phase 1
- ✓ R3: Session health monitoring (periodic ping, disconnect detection) — Phase 2
- ✓ R4: Cache bounds (LRU eviction, max size) and memory leak prevention — Phase 1
- ✓ R5: Request timeouts (AbortController, 30s) and webhook deduplication by messageId — Phase 1
- ✓ F5: Message queue with flood protection (bounded queue, priority DMs) — Phase 2
- ✓ F7: Better error messages (context-rich, suggested fixes) — Phase 2
- ✓ F1: Mute/unmute chat actions (muteChat/unmuteChat utility actions with duration support) — Phase 3
- ✓ F3: Mentions detection (@mentions extracted from inbound NOWEB messages, normalized to @c.us) — Phase 3
- ✓ F4: Multi-recipient send (sendMulti, sequential, 10-cap, per-recipient results, text-only v1) — Phase 3
- ✓ F6: URL preview send (auto linkPreview in sendWahaText + existing sendLinkPreview action) — Phase 3
- ✓ M1: Multi-session support (session registry, roles, trigger word activation, configurable routing) — v1.10
- ✓ M2: Participant roles (owner/admin/member tracking, per-participant allow/block in admin panel) — v1.10
- ✓ M3: Bulk participant edit (bulk select UI, bulk allow/block toolbar in admin panel) — v1.10
- ✓ D1: SKILL.md refresh, unit tests (313 passing), integration tests, README — v1.10
- ✓ Rules system: YAML-based policy definitions with merge engine and inbound/outbound enforcement — v1.10
- ✓ Admin panel: directory, config, filter stats, status tabs — v1.8.7, expanded v1.10
- ✓ Admin panel: logs tab with live tail and level filtering — v1.10
- ✓ Admin panel: shared UI component library (Button, Badge, Modal, Toast, Table, Form) — v1.10
- ✓ Admin panel: security hardening (textContent only, no innerHTML, input sanitization) — v1.10

### Active

<!-- v1.11 — bugs, CRs, and features from human verification -->

- [ ] Fix name resolution for @lid JIDs across dashboard, settings, directory, participants
- [ ] Background directory sync (WAHA→SQLite) with local search
- [ ] Dashboard per-session stats, collapsible cards, human-readable labels, flicker fix
- [ ] Sessions tab role change UX, labels, 502 restart handling
- [ ] Consistent tag-style inputs (custom keywords, mention patterns, group override keywords)
- [ ] Directory search fix, tooltip clipping, drawer persistence, pagination, bulk edit
- [ ] Refresh button visual feedback across all tabs
- [ ] Pairing mode — passcode-gated temporary access with wa.me deep links
- [ ] TTL-based auto-expiring access for contacts and groups
- [ ] Auto-reply canned message to unauthorized DMs
- [ ] Modules system with admin panel tab and module framework

### Out of Scope

- Claude Code / Cursor adapter — deferred to Phase 6 (platform abstraction)
- Scheduled messages — WAHA doesn't support
- WhatsApp Business templates — not applicable for personal assistant
- Broadcast lists — WAHA limitation
- Call initiation — WAHA limitation
- Disappearing messages — low priority
- Hot-reload — gateway requires restart, not worth engineering around
- Media multi-send (sendMulti v2) — deferred; text-only v1 shipped in Phase 3

## Context

- **Runtime**: TypeScript on Node.js, deployed to hpg6 Linux server
- **Codebase**: 13,026 LOC TypeScript (33 source files), 5,619 LOC tests (29 files), 313 passing tests
- **WAHA Engine**: NOWEB (has known limitations — poll.vote <5% capture, contacts API needs store.enabled)
- **Gateway**: OpenClaw at `/usr/lib/node_modules/openclaw/dist/` — READ-ONLY, not ours
- **Sessions**: `3cf11776_logan` (bot), `3cf11776_omer` (Omer/human)
- **Primary user**: OpenClaw agent on WhatsApp, model gpt-5.3-codex
- **Code is brittle**: Many hard-won fixes have DO NOT CHANGE markers — always read comments before modifying
- **~95% WAHA API coverage** as of v1.10

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
| vCard interception in deliverWahaReply, not sendWahaText | Bot replies go through media path, bypassing sendWahaText | ✓ Good |
| SQLite for directory (not in-memory) | Persistence across restarts, proper querying | ✓ Good |
| Embedded admin panel (not separate app) | Single deployment unit, no CORS, shares webhook server | ✓ Good |
| DO NOT CHANGE markers on critical code | Prevents regression on hard-won fixes | ✓ Good |
| Proactive rate limiter + 429 backoff | Prevent overload rather than just react to it | ✓ Good |
| Multi-session with role-based access | Support bot + human sessions with configurable permissions | ✓ Good |
| setTimeout chain for health pings (not setInterval) | Prevents timer pile-up when pings take longer than interval | ✓ Good |
| Two separate bounded queues (DM + group) | Simpler than priority queue, DM priority via drain order | ✓ Good |
| Always return HTTP 200 on webhook even on queue overflow | Prevents WAHA retry storms | ✓ Good |
| Auto link preview defaults to true | Most users want rich previews; opt-out via autoLinkPreview: false | ✓ Good |
| Sequential sends for sendMulti (not parallel) | Respects token-bucket rate limiter from Phase 1 | ✓ Good |
| Pure-function extraction for testability (mentions.ts) | inbound.ts has heavy openclaw deps that break vitest | ✓ Good |
| Text-only sendMulti v1 | Media multi-send deferred; keeps implementation simple | ✓ Good |
| 10-recipient cap on sendMulti | Prevents abuse, respects rate limits | ✓ Good |
| YAML rules engine with merge strategies | Declarative policies composable across sessions and scopes | ✓ Good |
| Shared UI component library in admin panel | Eliminates duplication, consistent styling, single place to harden | ✓ Good |
| textContent only (no innerHTML) in admin panel | Eliminates XSS attack surface on all dynamic content | ✓ Good |
| Rules enforcement at inbound/outbound layer (not action handler) | Policies apply uniformly regardless of action type | ✓ Good |

---
*Last updated: 2026-03-17 after v1.11 milestone start*
