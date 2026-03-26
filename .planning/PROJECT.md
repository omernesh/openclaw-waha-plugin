# WAHA OpenClaw Plugin

## What This Is

A production-grade WhatsApp channel plugin for OpenClaw that enables AI agents to fully interact with WhatsApp — messaging, group management, contact resolution, media handling, multi-session support, and a rules/policy enforcement system. Deployed on hpg6, serving as the bridge between OpenClaw's AI gateway and WAHA (WhatsApp HTTP API). Ships with a React admin panel (shadcn/ui, Tailwind CSS, Vite) with real-time SSE updates, analytics charts, directory management, configuration, filter stats, session health, and logs. Includes a YAML-based rules engine, session auto-recovery, config validation/backup, and platform abstraction groundwork for future SaaS deployment. v1.13 closed all remaining gaps: session auto-recovery with alerting, config safety (Zod validation, backup rotation, export/import), full WAHA API coverage, real-time admin panel via SSE, analytics tab with SQLite event store and recharts charts, 149 new tests, and WahaClient/PlatformAdapter abstraction layer.

## Core Value

Reliable, always-on WhatsApp communication for AI agents — messages must send, receive, and resolve targets without silent failures, across multiple sessions, with policy-level control over what the agent can and cannot do.

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
- ✓ Background directory sync (WAHA→SQLite) with FTS5 full-text search — v1.11
- ✓ Name resolution for @lid JIDs across dashboard, settings, directory, participants — v1.11
- ✓ Dashboard polish (per-session stats, collapsible cards, human-readable labels) — v1.11
- ✓ Sessions tab UX improvements (optimistic role save, 502 overlay, labels) — v1.11
- ✓ Consistent tag-style inputs throughout settings (custom keywords, mention patterns, group overrides) — v1.11
- ✓ Directory UX (search fix, tooltips, bulk edit, pagination, bot exclusion) — v1.11
- ✓ Refresh button feedback across all tabs — v1.11
- ✓ Can Initiate global setting with per-contact override — v1.11
- ✓ TTL-based auto-expiring access for contacts and groups — v1.11
- ✓ Pairing mode (passcode-gated temporary access with wa.me deep links) — v1.11
- ✓ Auto-reply canned message to unauthorized DMs — v1.11
- ✓ Modules system with admin panel tab and module framework — v1.11
- ✓ Full admin panel UI rewrite with React + shadcn/ui + Tailwind CSS + Vite — v1.12
- ✓ Mobile-responsive admin panel layout — v1.12
- ✓ All existing admin panel functionality preserved in new UI framework — v1.12
- ✓ Session auto-recovery with cooldown and alerting — v1.13
- ✓ Config validation, backup rotation, export/import — v1.13
- ✓ Pairing cleanup, bot echo fix, code quality fixes — v1.13
- ✓ Full WAHA API coverage (channels, presence, groups, API keys, webhooks) — v1.13
- ✓ Real-time admin panel via SSE (health, queue, logs) — v1.13
- ✓ Analytics tab with SQLite event store and recharts charts — v1.13
- ✓ Test coverage sprint (149 new tests: monitor, inbound, directory, shutup, React) — v1.13
- ✓ Platform abstraction (WahaClient, PlatformAdapter, tenant-aware config) — v1.13

- ✓ Slash commands (/join, /leave, /list) bypassing LLM — v1.18
- ✓ Channel invite link support (resolve code → JID → follow) — v1.18
- ✓ Admin UI Leave/Unfollow buttons + Join by Link input — v1.18
- ✓ whatsapp-messenger skill: 109 actions across 16 categories — v1.18
- ✓ SKILL.md invite link and slash command documentation — v1.18
- ✓ Friendly error messages (extract clean reasons from WAHA errors) — v1.18
- ✓ Pending selection in groups (not just DMs) — v1.18

### Active

(Next milestone TBD)

### Out of Scope

- Claude Code / Cursor adapter — deferred to Phase 6 (platform abstraction)
- Scheduled messages — WAHA doesn't support
- WhatsApp Business templates — not applicable for personal assistant
- Broadcast lists — WAHA limitation
- Call initiation — WAHA limitation
- Disappearing messages — low priority
- Hot-reload — gateway requires restart, not worth engineering around
- Media multi-send (sendMulti v2) — deferred; text-only v1 shipped in Phase 3

## Current Milestone: v1.19 Full WAHA Capabilities & Modular Skill Architecture

**Goal:** Expose every implemented WAHA action to the agent and restructure SKILL.md into modular per-category instruction files with evals.

**Target features:**
- Expose all hidden ACTION_HANDLERS to the LLM via UTILITY_ACTIONS (group admin, chats, contacts, status, presence, profile, labels, media, events)
- Restructure SKILL.md into modular per-category instruction files with an index
- Use Anthropic skill-creator for structure and evals
- Live testing all capabilities with test groups and test bot participant

## Context

- **Runtime**: TypeScript on Node.js, deployed to hpg6 Linux server
- **Codebase**: 16,000+ LOC TypeScript (40+ source files including WahaClient, PlatformAdapter, AnalyticsDb, SSE, commands.ts; src/admin/ React SPA ~4500+ lines TSX), 7,500+ LOC tests, 594 passing tests
- **WAHA Engine**: NOWEB (has known limitations — poll.vote <5% capture, contacts API needs store.enabled)
- **Gateway**: OpenClaw at `/usr/lib/node_modules/openclaw/dist/` — READ-ONLY, not ours
- **Sessions**: `3cf11776_logan` (bot), `3cf11776_omer` (Omer/human)
- **Primary user**: OpenClaw agent on WhatsApp, model gpt-5.3-codex
- **Code is brittle**: Many hard-won fixes have DO NOT CHANGE markers — always read comments before modifying
- **~99% WAHA API coverage** as of v1.13

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
| FTS5 for directory search | Instant local full-text search without WAHA API round-trips | ✓ Good |
| setTimeout chain for background sync (not setInterval) | Prevents sync pile-up when syncs take longer than interval | ✓ Good |
| SQLite-level TTL enforcement (expires_at WHERE clause) | Access expiry checked at query time, no background reaper needed | ✓ Good |
| HMAC-SHA256 deep link tokens (one-use, verifiable without DB) | Stateless token verification for pairing mode, no token table needed | ✓ Good |
| Module hooks after fromMe+dedup+pairing (pipeline ordering) | Modules only see validated, deduplicated, authorized messages | ✓ Good |
| Can Initiate enforcement via message_count check | Distinguishes first contact (initiation) from ongoing replies | ✓ Good |
| shadcn/ui over React Aria for admin panel UI | React Aria is headless (must design everything from scratch), shadcn/ui is pre-styled on Radix primitives with Tailwind — better fit for internal dashboard | ✓ Good |
| Vite for admin panel build | First-class React support, HMR for dev, optimized builds, shadcn/ui official integration | ✓ Good |
| Full UI rewrite (not incremental) | Current code was concatenated HTML strings — no component structure to migrate incrementally | ✓ Good |
| SSE for real-time admin panel (not WebSocket) | Simpler, unidirectional, auto-reconnect built in, no ws library needed | ✓ Good |
| Zod for config validation | Type-safe schema with structured error messages, composable with TypeScript types | ✓ Good |
| WahaClient class extraction | Consolidates all WAHA API calls behind a single class, enables testing and future transport swap | ✓ Good |
| PlatformAdapter interface | Decouples business logic from transport — future platforms only need a new adapter | ✓ Good |
| SQLite analytics event store | Reuses existing SQLite infrastructure, no external dependencies, simple aggregation queries | ✓ Good |
| 5-failure threshold for auto-recovery | Prevents premature restarts from transient blips while catching real failures | ✓ Good |

---
*Last updated: 2026-03-26 — v1.19 milestone started*
