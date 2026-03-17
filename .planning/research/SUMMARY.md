# Project Research Summary

**Project:** WAHA OpenClaw Plugin v1.11
**Domain:** WhatsApp AI agent plugin — polish, background sync, access control, and extensibility milestone
**Researched:** 2026-03-17
**Confidence:** HIGH

## Executive Summary

v1.11 is a tightly scoped follow-on milestone to v1.10. It is not a greenfield build — it is a polish, robustness, and extensibility pass on a working production plugin. The dominant research finding is that background directory sync is the load-bearing foundation of the milestone: seven of the eighteen bugs from human verification (BUG-01, BUG-06, BUG-10, BUG-11, BUG-12, BUG-15, BUG-16) all trace back to the directory not having locally cached data. Ship background sync early or the downstream name-resolution and search fixes cannot land. Everything else — pairing mode, TTL access, auto-reply, and the modules framework — is additive and can be phased independently after sync.

The recommended approach is zero new npm dependencies. Every v1.11 feature is implementable with the existing stack: `better-sqlite3` for all persistence, `setTimeout` chains for background loops (matching the canonical `health.ts` pattern already in production), built-in `node:crypto` for passcode generation, and the existing TypeScript + Zod tooling for the module interface. The admin panel grows in place inside `monitor.ts`, following established tab and route patterns. The constraint is not capability — it is avoiding shortcuts that look like simplifications but create correctness traps: in-memory state lost on restart, mega-transactions that race with webhook writes, and the `setInterval` drift bug that the `setTimeout` chain pattern already solves.

The top risks are not technology risks — they are concurrency and security design risks. The SQLite write-concurrency problem between background sync batches and the inbound webhook handler is the most likely source of silent data loss. The auto-reply spam loop (bot replying to its own canned message) is the most likely source of a production incident. The passcode brute-force window is the most likely security gap. All three have documented prevention strategies and must be built in from day one, not added as a follow-up.

## Key Findings

### Recommended Stack

The existing dependency set is sufficient for all v1.11 features. No new packages required. Stack research confirmed this across all four planned features (background sync, TTL access, pairing mode, modules system) and cross-checked against the production constraint that the host Node.js version is not guaranteed to be v22.5+, ruling out the new built-in `node:sqlite`.

**Core technologies:**
- `better-sqlite3` (^11.10.0, existing): All new persistence — `expires_at` columns, `pairing_challenges`, `auto_reply_log`, `module_assignments`, `sync_state` tables. Migration-safe `ALTER TABLE` pattern already established.
- `setTimeout` chain (built-in, existing pattern): Background sync loop. Chosen over `setInterval` to prevent timer pile-up when a sync batch exceeds the interval duration. Matches `health.ts` canonical pattern.
- `node:crypto` (built-in, already imported): Passcode generation — `crypto.randomBytes(4).toString('hex')` for 8-character one-time tokens.
- Built-in `URL` + `encodeURIComponent` (built-in): wa.me deep link construction for pairing mode. Zero-dependency.
- `zod` (^4.3.6, existing): Per-module config schema validation. Consistent with `config-schema.ts` patterns.
- TypeScript interfaces (^5.9.3, existing): `WahaModule` interface for the modules system. Same pattern as the OpenClaw plugin SDK itself.

If time-of-day scheduling is ever needed in a future milestone, `croner` (zero-dep, ESM-native, TypeScript, used by PM2 and Uptime Kuma) is the correct choice — not `node-cron` (CJS-only). Not needed for v1.11.

### Expected Features

**Must have (table stakes — broken existing features):**
- Background WAHA-to-SQLite directory sync (CR-08) — without this, search is slow and name resolution is impossible
- Name resolution for @lid JIDs throughout the UI (BUG-01, BUG-10, BUG-12, BUG-16) — NOWEB exclusively sends @lid; raw JIDs everywhere is the top UX complaint
- Local SQLite directory search (BUG-06, BUG-11) — instant search vs. 2-5s live WAHA API calls
- Contacts tab pagination (BUG-15) — asymmetric with Groups tab, reads as a bug
- UI bug sprint (BUG-02 through CR-16): ~22 standalone UI fixes requiring no architecture changes — role change flicker, 502 restart overlay, tooltip clipping, drawer staying open, tag-style inputs, collapsible cards, human-readable labels, and more

**Should have (new capabilities, meaningful value):**
- TTL-based auto-expiring allowlist entries (FEATURE-02) — manual admin grants with auto-revocation; prerequisite for pairing mode
- Auto-reply canned message to unauthorized DMs (FEATURE-03) — zero-LLM rejection with rate limiting; prevents token waste
- Pairing mode — passcode-gated temporary access with wa.me URL injection (FEATURE-01) — controlled onboarding of unknown contacts
- Modules system framework (FEATURE-04) — TypeScript interface + registry + admin tab; transforms plugin from fixed-feature to extensible

**Defer (v1.12+):**
- First-party module implementations (channel moderator, event planner) — framework ships in v1.11 as empty registry
- Contacts/Channels bulk edit (CR-15, CR-17) — quality of life for large directories; depends on sync being settled
- Scheduled messages — requires external cron, out of scope for the plugin
- Cross-platform module abstraction — wrong abstraction; port by re-implementation per platform

### Architecture Approach

All v1.11 features integrate into the existing five-file core (channel.ts, send.ts, inbound.ts, monitor.ts, directory.ts). Two new top-level files are added (`src/directory-sync.ts`, `src/pairing.ts`) and a new subdirectory (`src/modules/` with three files). The three heaviest modified files are `inbound.ts` (pairing hook, auto-reply hook, module hooks, TTL expiry check), `directory.ts` (schema migrations, new tables, new methods), and `monitor.ts` (new routes, new Modules tab). Config additions go to `config-schema.ts` only.

**Major components:**
1. `src/directory-sync.ts` (new) — background `setTimeout` loop; pulls contacts/groups/newsletters from WAHA API, writes to `DirectoryDb` in page-sized batches; exposes `getSyncStatus()` for admin panel
2. `src/pairing.ts` (new) — passcode challenge/response state machine; reads/writes `pairing_challenges` and `allow_list` (with `expires_at`); sends scripted replies via `sendWahaText`
3. `src/modules/` (new, 3 files) — `WahaModule` interface, `ModuleRegistry` singleton backed by SQLite `modules` table, barrel export; inbound pipeline calls `onInbound` hooks serially
4. `src/directory.ts` (extended) — `expires_at` migration on `allow_list`; new tables: `auto_reply_log`, `pairing_challenges`, `modules`, `sync_state`; new methods: `upsertContactBatch`, `upsertTTLGrant`, `pruneExpiredGrants`, `getLastAutoReply`, `recordAutoReply`
5. `src/inbound.ts` (extended) — insertion points: pairing check after DM filter rejects, auto-reply after pairing non-intercept, module hooks after rules resolution

**Key patterns to follow:**
- `setTimeout` chain (not `setInterval`) for all background loops — `health.ts` is the canonical example
- Migration-safe `ALTER TABLE` with duplicate-column catch — every new column uses this
- `INSERT OR REPLACE` (upsert) for sync writes — shorter write window, concurrency-safe
- Serial module hook execution with early-exit on `false` — correct short-circuit semantics
- TTL check in SQL (`WHERE expires_at IS NULL OR expires_at > ?`) not in TypeScript — never load expired rows

### Critical Pitfalls

1. **Background sync race with inbound webhook writes** — Both the sync loop and webhook handler write to `contacts` and `group_participants` simultaneously. With a large-transaction approach, `SQLITE_BUSY` silently drops webhook writes. Prevention: page-sized batches (50-100 rows), async write mutex, `INSERT OR REPLACE` not DELETE+INSERT. Must be designed in from day one.

2. **Auto-reply spam loop** — Bot sends canned rejection, WAHA delivers the outbound webhook, inbound handler processes bot's own message, sends another reply. Repeat. Prevention: auto-reply hook must be inserted AFTER the `fromMe` check (not before it); also exclude bot's own session JIDs explicitly. Test by sending a DM from the bot session to itself.

3. **Auto-reply rate limit lost on gateway restart** — In-memory rate limit map is cleared on every deploy. Contact receives duplicate canned replies after each restart. Prevention: store `last_auto_reply_at` in SQLite from day one — not a later optimization.

4. **Passcode brute-force and replay** — Static 4-6 digit passcode is brute-forceable in seconds with no rate limiting. Static config passcode is replayable forever. Prevention: max 3 attempts per contact per 30 minutes with 24-hour lockout stored in SQLite; wa.me link tokens should be one-time use, not the static passcode.

5. **Background sync full-resync on every startup** — With 500+ contacts and frequent restarts (every deploy), sync never finishes. Prevention: store last sync timestamp in SQLite `sync_state` table; on startup, if last sync < 24h ago, run incremental; only full-resync if > 24h.

6. **TTL zombie grants accumulating** — Lazy expiry (check at read, never delete) causes the `allow_list` table to grow unbounded, degrading query performance. Prevention: periodic cleanup job (`DELETE WHERE expires_at < now()`), plus an index on `expires_at`.

7. **Module hook ordering breaks existing pipeline** — Inserting module hooks at the wrong position (before `fromMe`/dedup checks or after LLM dispatch) causes modules to fire on messages they should never see. Prevention: hooks slot defined as `POST_FILTER` only (after policy, before LLM delivery); `fromMe` messages must never reach module hooks.

## Implications for Roadmap

Based on combined research, the dependency structure and phase groupings are clear. The suggested order is: UI bug sprint first (fast wins, no dependencies), then background sync (unblocks everything else), then name resolution (depends on sync), then TTL + pairing + auto-reply as a coupled cluster, then modules framework as a self-contained final phase.

### Phase 1: UI Bug Sprint
**Rationale:** ~22 standalone UI fixes with no schema or architecture changes. All independent. Ship fast to clear the backlog and improve baseline quality before adding new features.
**Delivers:** Repaired admin panel UX — role change optimistic update, 502 restart overlay, tooltip CSS fix, drawer-stays-open, tag-style inputs, collapsible filter cards, human-readable labels, Clear button fixes, log tab search clear, refresh button feedback, bot JID exclusion from directory, per-session stats, promote-to-admin auto-grants.
**Addresses:** BUG-02, BUG-03, BUG-04, BUG-05, BUG-07, BUG-08, BUG-09, BUG-13, BUG-14, BUG-17, BUG-18, CR-01, CR-02, CR-03, CR-05, CR-06, CR-07, CR-09, CR-11, CR-12, CR-13, CR-14, CR-16
**Avoids:** Template literal double-escaping pitfall (any monitor.ts change requires double-backslash audit)

### Phase 2: Background Directory Sync
**Rationale:** Foundation for all name resolution and directory search fixes. Build this second so every subsequent phase can assume locally cached data.
**Delivers:** Continuous WAHA-to-SQLite sync for contacts, groups, newsletters, and @lid mappings. Local directory search. Sync status indicator in Directory tab. Cursor-based incremental sync on subsequent startups.
**Addresses:** CR-08, BUG-06 (local search), BUG-11 (contact picker from SQLite), BUG-15 (contacts pagination)
**Uses:** `setTimeout` chain (existing pattern), `better-sqlite3` `upsertContactBatch`, `callWahaApi` from `http-client.ts` for rate-limit compliance
**Avoids:** Race condition pitfall (page-sized batches, write mutex), rate-limiter starvation pitfall (separate sync throttle, 500ms inter-page delay), full-resync-on-restart pitfall (`sync_state` table with cursor)

### Phase 3: Name Resolution
**Rationale:** Depends on background sync populating the @lid-to-name mapping. Cannot fix raw @lid display until the SQLite lookup data exists.
**Delivers:** Resolved display names everywhere @lid JIDs appear — Access Control card, God Mode Users tag bubbles, Allow From / Group Allow From tags, group participants list.
**Addresses:** BUG-01, BUG-10, BUG-12, BUG-16
**Implements:** Frontend `resolveName(jid)` utility calling `/api/admin/directory/:jid`, progressive enhancement (raw JID until resolved)

### Phase 4: TTL-Based Access
**Rationale:** Schema changes for `expires_at` are shared with pairing mode. Land the TTL infrastructure and manual admin grants first as standalone value, then pairing mode builds on top.
**Delivers:** Manual admin-set expiring access for contacts and groups. "Expires in Xh Ym" display in Directory. Inbound filter checks `expires_at` in SQL. Periodic cleanup job. Index on `expires_at`.
**Addresses:** FEATURE-02
**Avoids:** Zombie grants pitfall (cleanup job + index from day one)

### Phase 5: Auto-Reply and Pairing Mode
**Rationale:** Auto-reply is the simpler building block; pairing mode uses it as the challenge delivery mechanism. Both depend on the `expires_at` infrastructure from Phase 4.
**Delivers:** Canned rejection message to unauthorized DMs with SQLite-backed rate limiting. Passcode challenge/response flow for unknown contacts. wa.me deep link injection for zero-friction passcode delivery. Active grants view and manual revoke in admin panel.
**Addresses:** FEATURE-03, FEATURE-01
**Avoids:** Auto-reply spam loop pitfall (insert after `fromMe` check, exclude own session JIDs); rate-limit persistence pitfall (SQLite `auto_reply_log` from day one); passcode brute-force pitfall (3 attempts / 30 min lockout, one-time tokens for wa.me links)

### Phase 6: Modules Framework
**Rationale:** Architecturally independent of pairing/TTL but depends on DirectoryDb patterns being settled. Ship last as the extensibility capstone.
**Delivers:** `WahaModule` interface, `ModuleRegistry` singleton, `modules` SQLite table, serial inbound hook pipeline with `POST_FILTER` slot, Modules tab in admin panel (enable/disable, config form, chat assignment picker). Empty registry — no first-party modules ship in v1.11.
**Addresses:** FEATURE-04
**Avoids:** Hook ordering pitfall (explicit `POST_FILTER` slot, `fromMe` messages never reach hooks); module isolation pitfall (`Object.freeze(structuredClone(config))` per module, module-scoped state namespaces)

### Phase Ordering Rationale

- **UI bug sprint first** because it has zero dependencies, fast delivery, and clears distracting regressions before adding new features.
- **Background sync second** because seven downstream bugs depend on it. Deferring it delays three subsequent phases.
- **Name resolution third** because it is a pure consumer of sync data — no new infrastructure, just read from what sync wrote.
- **TTL before pairing mode** because pairing mode creates TTL grants; the schema and methods must exist before the pairing challenge can grant access.
- **Auto-reply bundled with pairing mode** because the challenge message IS the auto-reply when pairing mode is active. The infrastructure is shared and shipping them together avoids a second round of inbound.ts surgery.
- **Modules last** because it is the most architecturally novel addition and benefits from all other phases being stable first.

### Research Flags

Phases with known complexity that may benefit from a focused planning pass:
- **Phase 2 (Background Sync):** SQLite write concurrency is the most technically risky part of v1.11. The async mutex design and batch size need to be explicit in the phase plan, not left to implementation.
- **Phase 5 (Pairing Mode):** Security design (attempt rate limiting, one-time token vs. static passcode, passcode storage hashing) must be decided in the plan, not during coding.

Phases with standard patterns (planning from existing code is sufficient):
- **Phase 1 (UI Bug Sprint):** All fixes are established patterns already in the codebase.
- **Phase 3 (Name Resolution):** Pure SQLite lookup + frontend utility. Well-trodden path.
- **Phase 4 (TTL Access):** Schema migration and SQL filter pattern are established. Cleanup job follows health.ts timer model.
- **Phase 6 (Modules Framework):** TypeScript interface + registry is a standard pattern. No novel infrastructure.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations verified — no new packages, confirmed against existing production code and npm registry |
| Features | HIGH | All features defined from first-party human verification (bugs.md). No inference from external sources. |
| Architecture | HIGH | Based on direct source inspection of all relevant files. Integration points and file modifications are specific. |
| Pitfalls | HIGH | Based on codebase analysis, bugs.md findings, and documented lessons-learned history from v1.10 |

**Overall confidence:** HIGH

### Gaps to Address

- **WAHA contacts API incremental sync parameter:** Research assumed a `updatedAfter` or similar parameter for incremental pulls. This needs verification against the live WAHA instance before the background sync phase plan is finalized. If WAHA NOWEB does not support it, the incremental strategy falls back to full-resync, with the `sync_state` cursor only preventing startup thrash on rapid restarts.
- **Passcode hashing approach:** Research recommends hashing (SHA-256 + salt minimum). The exact storage format — in `openclaw.json` vs. a dedicated SQLite secrets table — needs a decision before the pairing mode phase plan. Storing a hash in `openclaw.json` complicates the admin panel "change passcode" flow.
- **Module outbound hooks scope:** Whether `channel.ts` should call module `onOutbound` hooks before dispatching actions is listed as "optional, later" in the architecture research. This decision affects the module interface definition — if deferred, the interface should still reserve the hook slot to avoid a breaking change in v1.12.

## Sources

### Primary (HIGH confidence)
- `.planning/phases/11-dashboard-sessions-log/bugs.md` — direct human verification findings, 18 bugs and CRs
- `src/directory.ts`, `src/health.ts`, `src/inbound.ts`, `src/monitor.ts`, `src/channel.ts`, `src/config-schema.ts` — direct source inspection
- `.planning/PROJECT.md` — feature requirements and architectural decisions
- `CLAUDE.md` — architectural constraints, WAHA API quirks, critical rules
- `docs/LESSONS_LEARNED.md` — past regressions and hard-won fixes

### Secondary (MEDIUM confidence)
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) — WAL mode, ALTER TABLE migration pattern
- [wa.me deep link format — Meta Developers Community](https://developers.facebook.com/community/threads/957849225969148/) — `?text=` parameter with encodeURIComponent
- [Node.js Advanced Patterns: Plugin Manager — Medium](https://v-checha.medium.com/node-js-advanced-patterns-plugin-manager-44adb72aa6bb) — interface + registry pattern
- [TypeScript Plugin System Design — DEV Community](https://dev.to/hexshift/designing-a-plugin-system-in-typescript-for-modular-web-applications-4db5) — lifecycle hooks pattern
- [setInterval vs cron — Sabbir.co](https://www.sabbir.co/blogs/68e2852ae6f20e639fc2c9bc) — setTimeout chain preferred for long-running loops

### Tertiary (LOW confidence)
- [croner npm](https://www.npmjs.com/package/croner) — flagged for future use if time-of-day scheduling is ever needed; not required for v1.11
- WAHA `updatedAfter` incremental sync parameter — not verified against live instance; assumed from WAHA documentation patterns

---
*Research completed: 2026-03-17*
*Ready for roadmap: yes*
