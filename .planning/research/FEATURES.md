# Feature Landscape

**Domain:** WhatsApp AI agent plugin — v1.11 polish, sync, and access control features
**Researched:** 2026-03-17
**Context:** Subsequent milestone for WAHA OpenClaw Plugin (v1.10.4). v1.10 shipped admin panel, multi-session, rules engine. v1.11 fixes bugs from human verification and adds background sync, pairing mode, TTL access, auto-reply, and modules system.
**Confidence:** HIGH (all features defined from direct user verification — bugs.md is first-party evidence)

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are the bugs and CRs that make the existing admin panel feel broken. "Already built" features that don't work correctly. Missing or broken = product feels unfinished.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Name resolution for @lid JIDs everywhere | @lid JIDs are raw strings in dashboard, settings, directory, participants. NOWEB exclusively uses @lid. Users see "271862907039996@lid" instead of "Omer Nesher" everywhere. | MEDIUM | Requires SQLite lookup by lid column. Applies to: Access Control card (BUG-01), God Mode Users (BUG-10), Allow From / Group Allow From tags (BUG-12), group participants (BUG-16). Root fix is background sync storing the lid→name mapping. |
| Background WAHA→SQLite directory sync | Directory search hits WAHA API in realtime — slow, rate-limited, incomplete. Users with hundreds of contacts see broken search (BUG-06, BUG-11). Standard practice for any app that needs fast local search over an external dataset. | HIGH | Periodic background pull of contacts/groups/newsletters → store in SQLite. Run throughout the day, rate-limited. Show sync status ("Last synced", "X/Y contacts"). This is the foundation that fixes BUG-06, BUG-11, BUG-15, and enables name resolution (BUG-01, BUG-10, BUG-12, BUG-16). |
| Directory search from local SQLite | Search currently queries WAHA API (slow, incomplete). Expected behavior for any directory/contact book: instant local search. | LOW | Once background sync is in place, search queries SQLite. Fixes BUG-06 directly. |
| Directory 'x' clear button actually works | 'x' button in Directory search bar does not clear or reset results (BUG-07). Basic broken control. | LOW | Frontend bug — the clear handler is wired wrong or the state is not being reset. |
| Contacts tab pagination | Groups tab has pagination (shipped Phase 10). Contacts tab shows only a handful with no load-more (BUG-15). Asymmetric behavior reads as a bug. | LOW | Copy Groups tab pagination pattern. Queries SQLite once background sync is populated. |
| Consistent tag-style inputs | Custom Keywords (Directory), Mention Patterns (Settings), and Group Filter Override Keywords (Directory) all use plain text. All other tag fields use pill bubbles from Phase 8. Inconsistency creates cognitive friction. | LOW | Wire `createTagInput()` to the three remaining plain-text fields (CR-09, CR-11, CR-13). Pattern already established. |
| Sessions tab role change doesn't flicker | Changing role dropdown reverts visually on save (BUG-04). Save appears to trigger full `loadSessions()` re-render. Standard pattern: optimistic update the UI, then confirm. | LOW | Optimistic update: update dropdown value immediately, show "Restart required" notice, do not re-render whole tab on save. |
| Sessions tab 502 restart handled gracefully | Saving session role triggers a restart, which returns a raw 502 (BUG-05). Settings tab already has polling overlay for this case. | LOW | Reuse the restart-polling overlay from Settings tab. |
| Refresh buttons give visual feedback | All tab Refresh buttons give no confirmation (CR-07, BUG-14). Standard UI feedback. | LOW | Add spinner/loading state on click, "Last refreshed: HH:MM:SS" after completion. Consistent pattern across all tabs. |
| Dashboard filter cards collapsible | DM Keyword Filter and Group Keyword Filter cards always expanded, take up full screen (CR-02). | LOW | Add collapse/expand toggle using existing `<details>` pattern from Settings. |
| Dashboard human-readable labels | Config keys like "wpm", "readDelayMs", "pauseChance" shown raw in dashboard cards (CR-03). Non-developers don't know what these mean. | LOW | Static label map: "wpm" → "Words Per Minute", "readDelayMs" → "Read Delay", etc. Applied at render time. |
| Per-session stats in dashboard | Filter stats (DM Keyword Filter, Group Keyword Filter, Presence, Access Control) show aggregated data without indicating which session (CR-04). With two sessions, users can't tell whose stats are shown. | MEDIUM | Split stats by session. Each card shows session sub-header with that session's data inline. No dropdown needed for 2-3 sessions. |
| Dashboard health section per-session | Health section shows once at bottom of Sessions card, unclear which session (CR-01). | LOW | Move health detail inline under each session row, or label it "Overall" clearly. |
| DM filter stat labels clarified | "0 Allowed, 33 Dropped" is confusing — 0 allowed but 33 dropped doesn't add up semantically (BUG-03). | LOW | Rename: "Allowed" → "Passed", "Dropped" → "Filtered". Add total: "Total: X". |
| Sessions tab labels and explanatory text | Role and subRole dropdowns have no labels or explanation (CR-05). New users don't know what "bot/human" or "full-access/listener" means. | LOW | Add label above each dropdown. Add explanatory text block at bottom of Sessions card. |
| Log tab search clear button | Log tab search bar has no 'x' clear button (CR-06). Directory tab already has one. | LOW | Add 'x' button to Log tab search bar, same pattern as Directory. |
| Tooltip clipping fixed | Tooltips in Directory contact card are clipped by parent container overflow (BUG-08). | LOW | CSS fix: `overflow: visible` on tooltip container, high z-index, position relative to viewport. |
| Contact settings drawer stays open after save | Drawer closes after Save in contact settings (BUG-09). User must reopen to make additional edits. | LOW | Keep drawer open, show success toast instead of closing. |
| Pairing mode removed from DM Policy dropdown | "pairing (not available)" appears as a selectable option in DM Policy dropdown (BUG-13). If unsupported, it should not be an option. | LOW | Remove from dropdown. Auto-migrate config from "pairing" to "allowlist" on load, show one-time notice. |
| Allow DM button on Channels is a toggle | Allow DM on Channels tab has no state or undo (BUG-18). Clicking twice shows same "granted" toast. | LOW | Make it a stateful toggle: green "Allowed" vs gray "Allow DM". Second click revokes with confirmation. |
| Session bot JIDs excluded from Directory | Bot's own session JIDs appear in contacts list — noise (CR-12). | LOW | Filter out JIDs from `listEnabledWahaAccounts()` from contact listing results. |
| Bot sessions shown in participants without controls | Bot's own sessions should appear in group participants (confirm it's in the group) but without Allow/Allow DM/role controls (CR-14). | LOW | Identify bot participant JIDs via `listEnabledWahaAccounts()`, render with "bot" badge, suppress action buttons. |

### Differentiators (Competitive Advantage)

New capabilities that meaningfully extend what the plugin can do. Not expected from a WhatsApp bot plugin, but high-value for the OpenClaw personal assistant use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Pairing mode — passcode-gated temporary access | Unknown contacts can DM the bot, receive a scripted challenge ("What's the passcode?"), reply with a code, and get auto-added to a temporary allowlist. Prevents token abuse while enabling controlled temporary access. URL-based injection (wa.me deep link with pre-filled passcode) makes it zero-friction for legitimate contacts — click link, WhatsApp opens, first message contains passcode, auto-authorized. | HIGH | Three sub-components: (1) challenge/response handler in inbound.ts (pre-LLM, zero tokens), (2) TTL-based allowlist entries in SQLite (FEATURE-01 + FEATURE-02 are coupled), (3) admin panel settings for passcode, TTL, active grants, manual revoke. Passcode is per-session or per-contact scoped. URL injection: wa.me link encodes obfuscated passcode as query param, customer pre-fills it, bot auto-detects on first DM. |
| TTL-based auto-expiring allowlist entries | Admin can grant a contact or group temporary access that auto-expires after a configured duration (30 min, 24h, 7 days, custom datetime). Expired entries treated as blocked without manual cleanup. | MEDIUM | Schema change: add `expires_at` column to `dm_settings` and `allow_list` SQLite tables. Inbound filter checks `expires_at < now()`. Admin panel shows "Expires in 2h 15m" on active TTL grants. Expired entries grayed out in Directory. Pairs with pairing mode (pairing auto-creates TTL entries), but also useful standalone for manual grants. |
| Auto-reply canned message to unauthorized DMs | When unauthorized contact DMs the bot, bot sends a scripted response instead of silently dropping — zero LLM, zero tokens. Configurable message with template variable for admin name. Rate-limited to one reply per contact per N hours. | MEDIUM | Pre-LLM hook in inbound.ts. Rate limiting via SQLite (store last-replied timestamp per JID). Default message: "Thanks for reaching out. Please ask [admin name] to add you to my allow list." Toggle on/off. Admin configures message in Settings tab. Admin name resolves from God Mode Users list. |
| Modules system — pluggable higher-level capabilities | Standard interface for adding higher-level bot behaviors (channel moderator, event planner) scoped to specific groups/contacts/newsletters. Admin panel "Modules" tab to enable/disable, configure, and assign modules. Transforms plugin from fixed-feature to extensible platform. | HIGH | Framework: standard module interface (init, config schema, inbound hook, outbound hook), module registry, inbound pipeline routing by active modules per chat. Admin panel: new "Modules" tab with enable toggle, config form, assignment picker (group/contact/newsletter). First candidate modules: channel moderator, event planner. WhatsApp-specific only — no cross-platform abstraction yet. |
| "Can Initiate" global default with per-contact override | Global "Can Initiate" setting in Settings tab (default for all contacts), with per-contact override in Directory (Allow / Block / Default). Currently only per-contact, no global default. Enables "bot cannot initiate by default, except for VIP contacts." | LOW | Settings tab: add global canInitiate toggle under DM Policy section. Directory contact settings: change to 3-state (Default / Allow / Block). Logic: resolve effective value = per-contact ?? global. |
| Promote-to-admin auto-grants access | Changing participant role to "Bot Admin" or "Manager" auto-enables Allow and Allow DM for that participant, without requiring separate clicks. Demoting removes Allow DM. | LOW | After role change API call, if new role is admin/manager: fire PUT allow and PUT allow-dm for the participant. Show toast confirming auto-grant. Demote: revoke allow-dm only (keep group allow — they're still in the group). |
| Contacts tab bulk edit | Groups tab has bulk select + bulk action toolbar (Phase 10). Contacts tab requires per-contact clicks. Bulk edit enables mass allowlist management. | MEDIUM | Port bulk select pattern from Groups tab: checkboxes per contact, "Select" toggle button, bulk action toolbar (Allow DM, Revoke DM, Set Mode). Same UI pattern, different entity type. |
| Channels tab bulk edit | Channels tab has no bulk select (Groups tab does). Useful for bulk Allow DM / Follow / Unfollow across channels. | MEDIUM | Same pattern as Contacts bulk edit but for channel-specific actions (Allow DM, Revoke DM, Follow, Unfollow, Mute, Unmute). |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|--------------|-----------|-------------------|-------------|
| Cross-platform module abstraction | "Write once, run on Telegram/Discord too" sounds efficient | WhatsApp, Telegram, and Discord each have platform-specific quirks — group events, permissions, media handling, mention formats all differ. Abstraction forces lowest-common-denominator design and makes each platform worse. Modules today are WhatsApp-specific. | Document modules thoroughly. Port by re-implementation on each platform. Shared abstraction can be designed later with concrete examples from multiple platforms. |
| Persistent passcode replay protection via external store | "Use Redis for rate limiting" for pairing mode | Adds infrastructure dependency. Plugin is self-contained, deploys as a single unit. Redis would require external service, credentials, network latency. | SQLite is already the persistence layer. Store `last_challenged_at` per JID in SQLite. Sufficient for single-instance deployment. |
| Agent-triggered TTL revocation ("task complete" signal) | "Agent signals when task is done, access auto-revoked" | OpenClaw gateway doesn't expose a plugin-to-plugin signaling interface. The plugin cannot reliably intercept "task complete" events from the LLM's reasoning. | Use time-based TTL. Admin can manually revoke from admin panel. If agent needs to signal completion, implement as a plugin action (e.g., `revokeAccess`) that the agent calls explicitly. |
| Real-time sync (WebSocket to WAHA for directory updates) | "Keep SQLite in sync instantly as contacts change" | WAHA's NOWEB engine does not reliably deliver contact-update webhook events. Building real-time sync on unreliable webhook delivery creates false confidence. | Periodic background polling (every N minutes). Incremental: only pull contacts updated since last sync. Cheap, predictable, reliable. |
| Full module sandboxing / plugin isolation | "Modules should run in separate processes" | Gateway restart is already required on code changes. Process isolation adds IPC complexity and debugging difficulty with no clear benefit at current scale. | Module interface contract (init, config schema, hooks) provides logical isolation. Full sandboxing is a future concern when untrusted modules are loaded. |
| Scheduled messages as a module | "Schedule a WhatsApp message for tomorrow at 9am" | WAHA's NOWEB engine has no scheduled send API. Building a scheduler in the plugin adds persistent timer state that survives restarts. Heavy for the scope. | Explicitly out of scope (documented in PROJECT.md). External cron that calls the plugin's send action is the correct approach. |

---

## Feature Dependencies

```
Background WAHA→SQLite Sync (CR-08)
    └──enables──> Name resolution everywhere (BUG-01, BUG-10, BUG-12, BUG-16)
    └──enables──> Directory local search (BUG-06, BUG-11)
    └──enables──> Contacts tab pagination (BUG-15)
    └──enables──> Contact picker in God Mode Users (BUG-11)

Pairing Mode (FEATURE-01)
    └──requires──> TTL-based allowlist (FEATURE-02, schema change in SQLite)
    └──requires──> Auto-reply canned message (FEATURE-03, for the challenge message)
    └──enhances──> Background sync (needs name resolution to display active grants)

TTL-based access (FEATURE-02)
    └──requires──> SQLite schema change (expires_at column in dm_settings + allow_list)
    └──standalone──> Can be used without pairing mode (manual admin grants)

Auto-reply to unauthorized DMs (FEATURE-03)
    └──requires──> SQLite (store last_replied_at per JID for rate limiting)
    └──standalone──> Can work without pairing mode (just send canned reply, no challenge)
    └──enhances──> Pairing mode (challenge message IS the canned reply with passcode prompt)

Modules System (FEATURE-04)
    └──requires──> Background sync (module assignment uses contact/group pickers that need local DB)
    └──standalone──> Framework and admin tab can be built before specific modules

Name resolution in tag bubbles (BUG-10, BUG-12)
    └──requires──> Background sync (needs lid→name mapping in SQLite)
    └──requires──> Tag input components (already exist from Phase 8)

Per-session stats (CR-04)
    └──requires──> Multi-session registry (already exists from v1.10)
    └──standalone──> Just splitting existing stats by session

Pairing mode "pairing" removed from DM Policy dropdown (BUG-13)
    └──must-precede──> Pairing mode implementation (FEATURE-01) — remove placeholder first, then add real feature
    └──standalone──> Can ship immediately as a cleanup

Promote-to-admin auto-grants (CR-16)
    └──requires──> Existing participant role API (already wired from v1.10)
    └──standalone──> Just adding side effects to the existing role change handler

Contacts/Channels bulk edit (CR-15, CR-17)
    └──requires──> Background sync (need enough contacts/channels loaded to make bulk edit useful)
    └──enhances──> Groups bulk edit (same pattern, already shipped)
```

### Dependency Notes

- **Background sync is the foundation:** BUG-06, BUG-11, BUG-15, BUG-16, BUG-01, BUG-10, BUG-12 all trace back to the directory not having locally-cached data. Ship background sync early to unblock all downstream fixes.
- **Pairing mode requires TTL access:** FEATURE-01 and FEATURE-02 are coupled at the SQLite schema level. TTL schema must land before pairing mode challenge/response can grant expiring access. However, TTL manual grants (FEATURE-02 standalone) can ship as a smaller phase.
- **Auto-reply standalone or as pairing challenge:** FEATURE-03 can ship independently (send canned message to unauthorized DMs). When pairing mode ships, the challenge message becomes a specialization of this same mechanism.
- **Modules system is architecturally independent:** FEATURE-04 doesn't depend on sync, TTL, or pairing. Admin tab and framework can be built in parallel. Specific module implementations (channel moderator, event planner) depend on whatever data they need.
- **UI bugs are independent:** Most BUG-* and CR-* items are standalone UI fixes that don't require the new features to be in place. They can be batched into early phases for fast wins.

---

## MVP Definition

### Phase A — Bug Sprint (ship first, quick wins, no new features)

All standalone UI bugs and CRs that require no schema or architecture changes. Shippable as a single polished release.

- [ ] BUG-02: Dashboard flickering — stop periodic full re-render of Access Control card
- [ ] BUG-03: Rename "Allowed/Dropped" → "Passed/Filtered" with total count
- [ ] BUG-04: Sessions role change optimistic update, no page re-render
- [ ] BUG-05: Sessions 502 on restart — reuse Settings tab polling overlay
- [ ] BUG-07: Directory 'x' clear button actually resets results
- [ ] BUG-08: Tooltip CSS clipping fix
- [ ] BUG-09: Contact settings drawer stays open after save
- [ ] BUG-13: Remove "pairing (not available)" from DM Policy dropdown, migrate config
- [ ] BUG-14: Queue tab Refresh button spinner/feedback
- [ ] BUG-17: Per-group trigger operator visibility
- [ ] BUG-18: Channels Allow DM toggle state
- [ ] CR-01: Dashboard health per-session (label or move inline)
- [ ] CR-02: Dashboard filter cards collapsible
- [ ] CR-03: Dashboard human-readable labels
- [ ] CR-05: Sessions tab labels + explanatory text
- [ ] CR-06: Log tab search clear button
- [ ] CR-07: Refresh button visual feedback (all tabs)
- [ ] CR-09: Custom Keywords tag-style input
- [ ] CR-11: Mention Patterns tag-style input
- [ ] CR-12: Exclude bot's own session JIDs from Directory contact listing
- [ ] CR-13: Group Filter Override Keywords tag-style input
- [ ] CR-14: Bot sessions in participants shown without action controls
- [ ] CR-16: Promote-to-admin auto-grants Allow + Allow DM

### Phase B — Background Sync (foundation for everything else)

- [ ] CR-08: Background WAHA→SQLite sync (contacts, groups, newsletters, LIDs)
- [ ] BUG-06: Directory search from local SQLite (not WAHA API)
- [ ] BUG-11: Contact picker in God Mode Users from local SQLite
- [ ] BUG-15: Contacts tab pagination from local SQLite
- [ ] Sync status indicator in Directory tab ("Last synced", "X/Y contacts")

### Phase C — Name Resolution (depends on background sync)

- [ ] BUG-01: Resolve @lid JIDs in dashboard Access Control card
- [ ] BUG-10: Resolve raw phone numbers in God Mode Users + Allowed Groups tag bubbles
- [ ] BUG-12: Resolve JIDs in Allow From / Group Allow From / Allowed Groups tags
- [ ] BUG-16: Resolve participant JIDs/LIDs to names in group participants list

### Phase D — Per-Session Stats + Remaining Dashboard CRs (depends on multi-session, already shipped)

- [ ] CR-04: Per-session stats inline within dashboard cards

### Phase E — TTL Access (schema change, standalone value)

- [ ] FEATURE-02: TTL-based auto-expiring allowlist entries
- [ ] Schema: `expires_at` column on `dm_settings` and `allow_list`
- [ ] Directory UI: "Access Expires" field, "Expires in Xh Ym" display, grayed expired entries
- [ ] Inbound filter: check `expires_at` before granting access

### Phase F — Auto-Reply + Pairing Mode

- [ ] FEATURE-03: Auto-reply canned message to unauthorized DMs (configure in Settings, rate-limit in SQLite)
- [ ] FEATURE-01: Pairing mode challenge/response (depends on FEATURE-02 TTL + FEATURE-03 auto-reply)
- [ ] FEATURE-01: wa.me URL-based passcode injection
- [ ] Admin panel: passcode config, active grants view, manual revoke

### Phase G — Modules System (architecturally independent)

- [ ] FEATURE-04: Module framework (standard interface: init, config schema, inbound hook, outbound hook)
- [ ] FEATURE-04: Module registry in plugin
- [ ] FEATURE-04: Inbound pipeline routing by active modules per chat
- [ ] FEATURE-04: Admin panel "Modules" tab (enable/disable, config form, assignment picker)
- [ ] First module: channel moderator (placeholder implementation to prove framework)

### Phase H — Directory Bulk Edit (depends on background sync + Groups bulk edit pattern)

- [ ] CR-10: "Can Initiate" global default in Settings with per-contact override in Directory
- [ ] CR-15: Contacts tab bulk edit (checkboxes, bulk toolbar: Allow DM, Revoke DM, Set Mode)
- [ ] CR-17: Channels tab bulk edit (checkboxes, bulk toolbar: Allow DM, Revoke DM, Follow, Unfollow)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Background WAHA→SQLite sync (CR-08) | HIGH | HIGH | P1 — foundation for name resolution, search, pagination |
| UI bug sprint (BUG-02 through CR-16) | HIGH | LOW | P1 — already-built features that feel broken |
| Name resolution everywhere (BUG-01, 10, 12, 16) | HIGH | MEDIUM | P1 — depends on sync |
| Per-session dashboard stats (CR-04) | MEDIUM | MEDIUM | P1 — visibility into multi-session operation |
| TTL-based access (FEATURE-02) | HIGH | MEDIUM | P1 — prerequisite for pairing mode |
| Auto-reply canned message (FEATURE-03) | HIGH | LOW | P1 — standalone value, no token waste on unauthorized DMs |
| Pairing mode (FEATURE-01) | HIGH | HIGH | P2 — depends on TTL + auto-reply |
| Modules system framework (FEATURE-04) | HIGH | HIGH | P2 — major architectural addition |
| Contacts bulk edit (CR-15) | MEDIUM | MEDIUM | P2 — quality of life for large directories |
| Channels bulk edit (CR-17) | MEDIUM | MEDIUM | P2 — quality of life |
| "Can Initiate" global default (CR-10) | MEDIUM | LOW | P2 — policy completeness |
| First module implementation (channel moderator) | MEDIUM | MEDIUM | P3 — depends on modules framework |

**Priority key:**
- P1: Must have for v1.11 milestone
- P2: Should have, include if phase budget allows
- P3: Nice to have, can slip to v1.12

---

## How Each Feature Works — Expected Behavior

### Background Directory Sync

**Pattern:** Periodic background polling loop, not event-driven.

The sync service runs continuously in the background (started at plugin init). It pulls contacts, groups, and newsletters from WAHA API endpoints and upserts them into the existing SQLite `DirectoryDb` tables. The loop rate-limits itself (e.g., 1 request per second) to avoid WAHA API pressure.

**Initial sync:** On first run, paginate through all `/contacts`, `/groups`, and `/newsletters` endpoints until WAHA reports nothing left. WAHA's NOWEB engine does not push contact updates reliably, so polling is the only reliable approach.

**Incremental updates:** After full sync, re-poll on a schedule (e.g., every 30 minutes). Track `last_synced_at` per entity type. Only fetch pages with `updatedAfter` parameter if WAHA supports it; otherwise full re-pull is acceptable at low frequency.

**LID mapping:** WAHA contacts response includes both `@c.us` and `@lid` JIDs for each contact. Store both, with the `@lid` → display name mapping in the SQLite contacts table. This is the root fix for all @lid name resolution bugs.

**Sync status:** Expose current sync state via `/api/admin/directory/sync-status` endpoint. Admin panel Directory tab shows "Last synced: 3 min ago" and "1,247 / 1,312 contacts synced" during initial sync.

**Dependency on existing code:** `DirectoryDb` in `directory.ts` already has the SQLite tables. The sync service adds a new module that imports `DirectoryDb` and the WAHA HTTP client, then runs a setInterval-style loop.

---

### Pairing Mode

**Pattern:** Pre-LLM challenge/response hook in inbound message pipeline.

When DM policy is set to "pairing", the inbound handler (before routing to LLM) checks if the sender is on the allowlist. If not:

1. **First contact:** Bot sends scripted challenge message ("Hi! To chat with me, please reply with the access code."). Stores challenge state in SQLite (`pairing_challenges` table: JID, issued_at, passcode).
2. **Reply with correct passcode:** Bot adds JID to `allow_list` with `expires_at = now() + configured_ttl`. Sends "Access granted! You're connected for [TTL duration]." Deletes challenge record.
3. **Reply with wrong passcode:** Bot replies "That code doesn't match. Please try again or contact [admin name]." Up to 3 attempts, then rate-limit for 1 hour.
4. **TTL expiry:** SQLite background check marks expired entries. Next DM from expired contact triggers fresh challenge.

**wa.me URL injection:** The admin generates a wa.me deep link in the admin panel: `https://wa.me/[botphone]?text=ACCESS-[obfuscated_code]`. Contact clicks link → WhatsApp opens → first message is pre-filled with the passcode → bot's challenge handler detects the pattern and auto-grants without manual challenge/response. The "obfuscated code" is base64 or a short-lived token that encodes the actual passcode and prevents replay.

**Admin panel:** Settings section for pairing mode — set passcode (per session or per contact scope), TTL duration, view active grants (JID, granted_at, expires_at, remaining), manual revoke button.

**Dependencies:** TTL-based allowlist schema (FEATURE-02), auto-reply infrastructure (FEATURE-03 provides the send mechanism), SQLite for challenge state.

---

### TTL-Based Access

**Pattern:** Time-bounded allowlist entry, checked at filter time.

Schema change: add `expires_at INTEGER NULL` column to `dm_settings` (contacts) and `allow_list` (group/channel participants) tables. NULL means "never expires" — backward compatible.

**Filter check:** Inbound filter reads `expires_at` for the contact. If `expires_at IS NOT NULL AND expires_at < unixepoch()`, treat as blocked (same as not on allowlist). Do not delete the record — just treat as inactive. Allows admin to see and re-enable.

**Admin UI:** Directory contact settings card gets "Access Expires" field with options: Never (default), Duration picker (e.g., "24 hours", "7 days", "30 days"), Custom datetime. Shows countdown "Expires in 2h 15m" when active TTL exists. Expired entries get a visual badge/gray-out in Directory listing.

**Standalone value:** Admin can manually grant a contact temporary access (e.g., for a support session) without involving pairing mode. Set TTL, grant access, it auto-revokes.

---

### Auto-Reply to Unauthorized DMs

**Pattern:** Pre-LLM scripted reply with rate limiting via SQLite.

When a DM arrives and the sender is not authorized (not on allowlist, or expired TTL), instead of silently dropping:

1. Check `auto_reply_log` table: has this JID received a reply in the last N hours (configurable, default 24h)?
2. If no recent reply: send the canned message via WAHA send API. Insert row into `auto_reply_log` (JID, sent_at).
3. If already replied recently: silently drop (no spam).

**Template variable:** `[admin name]` in the canned message resolves to the display names of users with "god mode" or "Bot Admin" role in the session config.

**Settings UI:** Admin panel Settings tab → Access Control or DM Policy section → "Rejection message" toggle (on/off) + text area for the message. Save via existing config save flow.

**Works standalone or as pairing mode component:** When pairing mode is active, the challenge message IS the auto-reply (the canned message becomes the challenge). When pairing mode is off and auto-reply is on, it's just a friendly rejection.

---

### Modules System

**Pattern:** Plugin-internal module interface with inbound/outbound hooks, managed via admin panel tab.

A module is a TypeScript class implementing a standard interface:

```typescript
interface WahaModule {
  id: string;
  name: string;
  description: string;
  configSchema: JsonSchema;
  init(config: unknown, db: DirectoryDb): Promise<void>;
  onInbound?(msg: InboundMessage): Promise<InboundMessage | null>;  // null = drop
  onOutbound?(action: OutboundAction): Promise<OutboundAction | null>;
}
```

**Module registry:** Plugin loads all modules at init, stores in a `ModuleRegistry`. Admin panel fetches registry to populate the Modules tab. Config stores per-module enable state and config object.

**Inbound routing:** After dedup and rate limit checks, before routing to LLM, inbound pipeline checks: which modules are active for this chat (group/contact/newsletter)? Runs each active module's `onInbound` hook sequentially. Module can transform, enrich, or drop the message.

**Assignment model:** Each module has an assignment list (group JIDs, contact JIDs, newsletter JIDs, or "all"). Stored in SQLite `module_assignments` table. Admin panel uses existing contact/group pickers to assign.

**Admin panel "Modules" tab:** New tab between Sessions and Log. Lists registered modules with enable/disable toggle, "Configure" button (opens config form generated from configSchema), "Assigned to" picker (contact/group/newsletter multi-select).

**First module — channel moderator (placeholder):** Minimal implementation that logs "channel moderator hook called for [chat]" and returns message unchanged. Proves the framework works. Full moderation logic is a v1.12 concern.

---

### Name Resolution Across UI

**Pattern:** Synchronous lookup from local SQLite after background sync is populated.

The SQLite `contacts` table stores: JID (`@c.us`), LID (`@lid`), display name, phone number. Name resolution is a simple SQL `SELECT name FROM contacts WHERE jid = ? OR lid = ?`.

**Admin panel resolver:** A frontend utility function `resolveName(jid)` calls `GET /api/admin/directory/:jid` which queries SQLite. Returns `{name, jid, lid}`. UI components call this for each JID they display and replace the raw JID with the display name, showing the raw JID as a tooltip.

**@lid merging:** For the Access Control card and tag inputs, where the same person has both `@c.us` and `@lid` entries: the backend resolver returns a unified entry with both JIDs. The frontend collapses them into a single pill/display showing the name.

**Progressive enhancement:** Before background sync completes, unknown JIDs fall back to displaying the raw JID. After sync, they resolve. No blocking on resolution — display raw immediately, update when resolved.

---

## Sources

- `.planning/phases/11-dashboard-sessions-log/bugs.md` — direct human verification findings (HIGH confidence, first-party)
- `.planning/PROJECT.md` — feature requirements and architectural decisions (HIGH confidence, first-party)
- CLAUDE.md — architectural constraints and WAHA API quirks (HIGH confidence, first-party)
- v1.10 implementation (existing code in src/) — confirms what's already built (HIGH confidence)

---

*Feature research for: WAHA OpenClaw Plugin v1.11*
*Researched: 2026-03-17*
