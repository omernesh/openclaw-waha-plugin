# Changelog

All notable changes to the OpenClaw WAHA Plugin are documented here.

## [1.16.12] - 2026-03-23

### Fixed
- **Human session no longer auto-replies** — Added `role === "bot"` guard to Phase 16. Human sessions never send pairing/rejection auto-replies to DMs.
- **God mode users bypass auto-reply** — God mode super-users are checked before auto-reply decision. Previously god mode check ran after auto-reply, so god users got rejected.
- **Auto-save handles gateway restarts** — Config saves that trigger a gateway restart no longer show "Failed to fetch" error. Retries once after 3s on network errors.

## [1.16.11] - 2026-03-23

### Changed
- **"WAHA" → "WhatsApp"** — All user-facing text in admin panel now says "WhatsApp" instead of "WAHA" (sidebar title, labels, tooltips).
- **Session persistence** — Active WhatsApp Session dropdown remembers last picked session across page reloads via localStorage.
- **Session role badge** — Dropdown shows role next to name, e.g. "Sammie Bot (bot)", "Omer (human)".

## [1.16.10] - 2026-03-23

### Fixed — Code Review
- **Bot JID data loss on save** — `excludeBotJids` was stripping bot JIDs from config arrays on every tag change. Now re-injects them in `onChange` to preserve config integrity.
- **GET /api/admin/config crash** — Handler had no try-catch; exceptions left HTTP response hanging. Now wrapped with error handling matching other endpoints.
- **clearWahaClientCache silent failures** — Empty `catch {}` blocks replaced with `console.warn` logging.
- **Unsafe array casts** — `allowFrom as string[] ?? []` replaced with `Array.isArray()` runtime guards.
- **Unsafe session type casts** — Added `role`, `subRole`, `wahaStatus` to session type; removed 3 `as unknown as` casts from DashboardTab.
- **Inconsistent dmCfg type guards** — Stats endpoint now uses same `Boolean()`/`Array.isArray()`/`typeof` guards for dmFilter as groupFilter.
- **TagInput cleanup** — Extracted `SEARCH_DEBOUNCE_MS` constant, removed redundant state updates, extracted `renderEmptyState` helper.

## [1.16.9] - 2026-03-23

### Fixed
- **Search shows contacts only** — Allow From and God Mode search fields now filter by type (contacts-only or groups-only), no more newsletters/groups in contact fields.
- **Search deduplicates @c.us/@lid** — Same person no longer appears multiple times in search results.
- **Phone numbers in search results** — Search dropdown shows formatted phone next to name, e.g. `Ran (+972-543090170)`.
- **Bot hidden from own filter lists** — The bot's own JIDs (phone + LID) are excluded from Allow From, Group Allow From, and God Mode Users displays.
- **Passcode Protection save** — Fixed `grantTtlMinutes` validator rejecting value 0 ("Never" expiry). Renamed UI from "Pairing Mode" to "Passcode Protection".

## [1.16.8] - 2026-03-22

### Fixed
- **Dashboard group filter god mode users** — Stats API now returns `godModeSuperUsers` for the group filter (was missing from the response entirely).
- **Dashboard/Settings data source** — Both now use the same global waha config source, eliminating mismatches between Dashboard and Settings tabs.
- **Config save validation** — Strips unknown top-level keys and relaxes `markdown` schema to accept gateway-written values. Config save no longer returns `validation_failed`.

### Added
- **Auto-save** — Settings tab now auto-saves 1.5 seconds after any change. Manual Save button replaced with subtle "Saving..."/"Saved" status indicator. Only "Restart Gateway" button remains.

## [1.16.7] - 2026-03-22

### Fixed
- **Dashboard/Settings filter mismatch** — Dashboard DM/Group filter widgets now show the global config (same source as Settings tab). Previously showed account-specific merged config, causing "Off" when the bot account had no filter configured.
- **Sidebar active tab highlight** — Active tab now visually prominent with blue foreground and slate-200 background instead of near-invisible light gray.
- **God mode user name resolution** — Bare numeric identifiers (e.g. `271862907039996`) now normalized to JID format (`@c.us`) before resolve API call, so names display correctly in both Settings and Dashboard.
- **Settings contact search** — TagInput search now shows server results by disabling cmdk's client-side JID-based filtering (`shouldFilter={false}`).

## [1.16.6] - 2026-03-22

### Fixed
- **Session health checks for all accounts** — Health check now runs for ALL enabled WAHA accounts, not just the default session. Previously, non-default accounts (e.g. human sessions) showed "unknown" health status in the admin panel Dashboard.
- **Stale recovery badge cleared on healthy** — Recovery state (attempt count, last outcome) is now cleared when a session returns to "healthy". Previously, a "failed" recovery badge persisted indefinitely even after the session recovered.
- **Removed stale `default` account from config** — Cleaned up a phantom account entry that had no session configured, causing a ghost "logan" entry with "unknown" health in the Dashboard.
- **Config validation accepts gateway-owned fields** — Changed config schema from `.strict()` to `.passthrough()` so fields written by other subsystems (`presence`, `mediaPreprocessing`, `markdown`, etc.) no longer cause `validation_failed` on Save & Restart.

## [1.16.4] - 2026-03-21

### Fixed
- **Trigger bypasses `allowedGroups`** — `!` trigger now works in ANY group, not just groups in `allowedGroups`. Explicit invocation should override the group whitelist.

## [1.16.3] - 2026-03-21

### Added — Session-Aware Trigger Reply Routing
- **Trigger session routing** — When `!` trigger fires in a group, the bot now auto-selects the best session for the reply: bot session if the bot is a member (no robot emoji prefix), human session with proxy prefix if not. DMs always use the human session (unchanged).
- **Exported `checkGroupMembership`** from channel.ts for reuse in inbound trigger routing.

### Fixed — Code Review
- **`checkGroupMembership` error handling** — Now re-throws infrastructure errors (network, auth, 500) instead of silently returning `false`. Only returns `false` for genuine 404/not-found responses.
- **Trigger routing catch** — Distinguishes expected errors (no sessions available) from unexpected errors (infra failures), logging at appropriate severity levels.
- **`tenantId` forwarding** — Both inbound trigger routing and outbound cross-session routing now pass `tenantId` to `resolveSessionForTarget`, preventing wrong-tenant resolution in multi-tenant setups.
- **Outbound routing error handling** — `handleAction` cross-session routing catch block now differentiates expected vs unexpected errors (parity with inbound fix).

## [1.16.2] - 2026-03-21

### Fixed — Code Review (Perfection Pass)
- **ApiError class** — `api.request()` now throws proper `Error` instances with `.data` preserving server JSON. `err instanceof Error` works everywhere.
- **Presence fetch** — Migrated from raw `fetch()` to typed `api.getPresence()` with AbortController cleanup, `res.ok` check, and toast on failure.
- **Double-click protection** — Allow DM buttons in Contacts and Channels tabs disabled during API call to prevent race conditions.
- **Toast ordering** — `handleAllowAll` success toast moved after both API calls complete (was firing before re-fetch).
- **Empty results display** — "Showing 1-0 of 0" replaced with "No results" when directory page is empty.
- **Column memoization** — All column definitions wrapped in `useMemo()` to prevent unnecessary re-renders.
- **Shared column factories** — Extracted `makeSelectColumn`, `makeDmAccessColumn`, `makeSettingsColumn`, `makeMessagesColumn`, and `formatDate` into `shared-columns.tsx`. Eliminated ~80 lines of duplication.
- **GroupFilterOverride guard** — Save button disabled after load failure; error banner with retry button prevents overwriting server data with defaults.
- **Type safety** — Added `participantCount` to `DirectoryContact`, `PresenceEntry` type, narrowed `handleRoleChange` parameter. Removed unsafe `as` casts.
- **Dead code** — Removed unused `pageRef` block from DataTable, duplicate `min-w-0` class from ParticipantRow.

## [1.16.1] - 2026-03-20

### Added — Directory Tab Overhaul & Missing Feature Restoration
- **Avatar circles** — Colored initial avatars on all directory rows (contacts, groups, channels, participants). Deterministic color from name hash.
- **Stacked name + JID layout** — Display name on top, JID below in muted text. Replaces separate columns.
- **Allow DM buttons** — Clickable "Allow DM" / "Revoke" buttons directly in contact and channel list rows.
- **Settings buttons** — Explicit "Settings" button per contact and channel row (opens side sheet).
- **Participants button** — Explicit "Participants" button per group row (was click-only chevron).
- **Full numbered pagination** — Page number buttons with first/last jump (« 1 2 3 4 5 »). Replaces prev/next only.
- **Per-page dropdown** — Select 10, 25, 50, or 100 items per page across all directory sub-tabs.
- **Filter badge** — Header shows green "Filter ON" or red "Filter OFF" indicator.
- **Settings tab enhancements** — Active WAHA Session dropdown, Pairing link generator, Multi-Session Filtering Guide.
- **Dashboard enhancements** — Role/sub-role badges and WAHA status per session card.
- **Sessions tab** — Last Check timestamp in health details.
- **Directory header** — Sync status indicator, summary counts row, Refresh All button.
- **Channels settings** — Row click opens ContactSettingsSheet (same per-entity settings as contacts).
- **Groups** — Members column showing participant count.
- **Footer** — Creator credit with GitHub link.

## [1.15.3] - 2026-03-18

### Fixed — Code Review & Production Fixes
- **Security: path traversal** — Static file serving now validates resolved path stays within admin dist directory.
- **Bug: GroupsTab expand chevron** — Chevron indicator now reads meta from column (was reading from table, always undefined).
- **Bug: godModeSuperUsers crash** — Dashboard and Settings crashed with React error #31 when API returned `{identifier}` objects instead of strings. Now handles both formats.
- **Bug: gateway crash on startup** — `path.resolve` import shadowed Promise `resolve` callbacks in log handler, preventing webhook server from starting.
- **Bug: SettingsTab name resolution** — Fired on every keystroke due to unstable `[config]` dependency. Now uses memoized JID key.
- **Bug: premature success toast** — SettingsTab showed "Restarting..." before config save completed.
- **Bug: SessionsTab missing error feedback** — Added catch block with toast.error to handleSaveAndRestart.
- **Error handling** — Replaced 12 empty `.catch(() => {})` blocks with `console.error`/`console.warn` logging across all tabs.
- **DirectoryTab** — Added AbortController for fetch cleanup and error state UI.

### Added
- **Mission Control theme** — Indigo/navy color palette matching sammie.nesher.co branding. Inter font. Both light and dark variants.
- **Dark mode fix** — Changed `@theme inline` to `@theme` so CSS variable references work at runtime.
- **Sidebar layout fix** — Added explicit `@layer utilities` rules for `w-[--sidebar-width]` (Tailwind v4 JIT scanner issue).
- **55 help tooltips restored** — All legacy admin panel tooltips recreated as React Tooltip components across Settings, Dashboard, and Contact Settings.
- **14 Dashboard tooltips** — Session Health, Keyword Filters, Presence System, Access Control sections.
- **Type improvements** — Narrowed union types in api.ts, BulkEditToolbar, ContactsTab, ChannelsTab, DirectoryParams.
- **localStorage safety** — useTheme wrapped in try/catch for Safari private browsing.

## [1.15.2] - 2026-03-18

### Fixed — Bug Sweep (18 bugs from human verification)
- **BUG-01: @lid name resolution in Access Control** — Server-side `resolveLidToCus()` replaces broken string-replace approach. Dedup now queries WAHA `/lids/{lid}` API for unmapped LIDs. Resolve endpoint falls back to all account DBs. Access Control card redesigned as name pills with pagination.
- **BUG-02: Dashboard flicker on 30s refresh** — Stat values update via `textContent` instead of rebuilding innerHTML. `_filterStatsBuilt` guard prevents DOM recreation.
- **BUG-04: Sessions role dropdown reverts** — `saveSessionRole()` no longer calls `loadSessions()`. Updates dropdown in-place with amber "Restart required" notice.
- **BUG-05: 502 after session restart** — Added "Save & Restart" button with polling overlay that waits for server recovery.
- **BUG-06: Directory search misses contacts** — FTS5 prefix matching (`"term"*`), LIKE fallback, and WAHA API fallback when local DB has no results.
- **BUG-07: Directory clear button broken** — Resets page counters before reloading.
- **BUG-08: Tooltips clipped** — `overflow: visible` on all ancestor containers.
- **BUG-09: Settings drawer closes on save** — `stopPropagation()` on save button click.
- **BUG-10: God Mode Users raw numbers** — `resolveJids()` handles bare phone numbers without @c.us suffix.
- **BUG-11: Contact picker search broken** — Same FTS5 prefix matching fix as BUG-06.
- **BUG-12: Settings tag inputs show raw JIDs** — Batch resolve via `resolveNames: true` on tag inputs.
- **BUG-14: Queue refresh no feedback** — Wrapped in `.refresh-wrap` for spinner animation + timestamp.
- **BUG-15: Contacts tab missing pagination indicator** — Stats bar shows "X-Y of Z" range + "Page X/Y".
- **BUG-16: Group participants raw LIDs** — Server-side `resolveLidToCus()` for participant names. Bot session participants marked with `isBotSession` flag server-side; action buttons suppressed for bot sessions only (human sessions keep controls).
- **BUG-18: Channel Allow DM no toggle** — Green/gray toggle with "DM Allowed"/"Allow DM" text states.
- **Directory initial load race** — `currentDirTab` defaulted to `undefined` on `#directory` hash load (var hoisting). Now defaults to `'contacts'`.
- **WAHA contacts endpoint 404** — Changed `getWahaContacts()` from `/api/{session}/contacts` to `/api/contacts/all?session=` (correct WAHA API path).
- **WAHA sessions `/me` endpoint** — Fixed `fetchBotJids()` from `/api/{session}/me` to `/api/sessions/{session}/me`.

### Added
- **Light/dark mode** — Theme toggle (☀/☽) in header. CSS custom properties for all colors. Persists in localStorage.
- **Wildcard warning** — Access Control card detects `*` in allowFrom, shows amber warning banner and grays out other entries.
- **Bot session exclusion** — Bot-role session JIDs excluded from Access Control display and group participant action buttons.
- **LID mapping cross-account sync** — `sync.ts` writes LID mappings to ALL account DBs, not just the syncing account.
- **WAHA API fallback for name resolution** — `/api/admin/directory/:jid` endpoint fetches from WAHA API when contact not in local DB, caches result.
- **`<meta format-detection>` telephone=no** — Prevents browsers from auto-linking phone numbers in the admin panel.

### Removed
- **Trigger operator (AND/OR)** — Removed from UI (global settings + per-group override). OR is hardcoded. Backend schema kept for backwards compatibility.
- **"Pairing" DM policy option** — Already removed in prior version; confirmed clean.

## [1.15.1] - 2026-03-17

### Fixed
- **Critical: Admin panel JS broken** — Template literal apostrophe in TTL tooltip (`contact\'s` → `contact\\'s`) prevented all JavaScript from loading.
- **Critical: @lid name resolution** — LID API endpoints used wrong path (`/contacts/lids` → `/lids`). Now correctly fetches all LID-to-phone mappings from WAHA bulk endpoint. 101+ LID mappings populated per sync cycle.
- **LID mapping persistence** — New `lid_mapping` SQLite table stores LID-to-@c.us mappings. `resolveJids()` and `getContact()` use it for @lid→name resolution. Also captured from inbound webhook messages.
- **Sessions tab "Failed to fetch"** — Added `fetchWithRetry()` helper with 8s timeout + 1 automatic retry on all read-only admin panel fetches.
- **FTS5 index corruption** — Auto-rebuild on startup if `integrity-check` fails. Prevents "database disk image is malformed" errors after unclean shutdowns.
- **dmPolicy "pairing" stale config** — Live config on hpg6 updated from "pairing" to "allowlist".
- **RateLimiter duplication** — Extracted to shared `src/rate-limiter.ts`, imported by both `sync.ts` and `monitor.ts`.

### New Files
- `src/rate-limiter.ts` — Shared rate limiter (extracted from monitor.ts)

## [1.15.0] - 2026-03-17

### Added
- **Background directory sync**: Continuous WAHA-to-SQLite sync with configurable interval (default 30min). All contacts, groups, and newsletters automatically cached locally. Uses setTimeout chain pattern (`src/sync.ts`).
- **FTS5 full-text search**: Directory search queries local SQLite FTS5 index instead of WAHA API for instant results. Virtual table with auto-sync triggers.
- **Name resolution**: All @lid JIDs resolved to contact names across dashboard, settings tag bubbles, contact picker, and group participants. Batch resolve endpoint with @lid-to-@c.us fallback.
- **TTL-based access**: Auto-expiring allowlist entries with `expires_at` column and SQL-level enforcement. Color-coded TTL badges (green >1h, yellow <1h, red <15m). Expired entries grayed out and sorted to bottom.
- **Pairing mode**: Passcode-gated temporary access for unknown contacts. 6-digit numeric passcode with SHA-256 hashing. wa.me deep links with HMAC-SHA256 tokens for zero-friction authorization. 3-attempt brute-force lockout (30 min). Admin panel config with passcode generator and wa.me link generator.
- **Auto-reply**: Configurable canned rejection message for unauthorized DMs with template variables ({admin_name}, {phone}, {jid}). Rate-limited per contact (configurable interval). Zero LLM tokens consumed (`src/auto-reply.ts`).
- **Modules framework**: Extensible `WahaModule` interface with `onInbound`/`onOutbound` hooks. Module registry with SQLite-backed assignments. Admin panel "Modules" tab with enable/disable toggles and chat assignment UI. Pipeline integration after fromMe+dedup+pairing checks (`src/module-registry.ts`, `src/module-types.ts`).
- **Can Initiate**: Global toggle + per-contact 3-state override (Default/Allow/Block). Enforced in outbound path — bot can only initiate DMs to contacts who have messaged first (unless overridden).
- **Contacts pagination**: Contacts tab now paginated matching Groups tab pattern (page nav + size selector 10/25/50/100).
- **Contacts bulk select**: Checkbox per contact with "Select" toggle and bulk toolbar (Allow DM, Revoke DM).
- **Channels bulk select**: Checkboxes with "Select" toggle and bulk toolbar (Allow DM, Revoke DM, Follow, Unfollow).
- **Sync status indicator**: "Last synced: Xm ago" / "Syncing..." status bar in Directory tab.

### Changed
- **Dashboard**: Per-session health details and stat breakdowns with session sub-headers. Filter cards (DM/Group keyword) now collapsible. Human-readable labels throughout ("wpm" to "Words Per Minute"). Access Control card no longer flickers.
- **Sessions tab**: Role/subRole dropdowns update immediately (optimistic UI). 502 during restart shows polling overlay. Labels above dropdowns with explanatory text box.
- **Settings tab**: Custom Keywords and Mention Patterns use tag-style pill inputs. DM Policy "pairing" option removed with auto-migration to "allowlist".
- **Directory**: Search bar clear button fixed. Tooltips no longer clipped by card overflow. Contact settings drawer stays open after save. Per-group trigger operator visible when inheriting global. Channel Allow DM is now a proper toggle. Bot sessions excluded from contacts listing. Bot participants show badge without action controls. Promoting to Bot Admin/Manager auto-enables Allow + Allow DM.
- **Refresh buttons**: All tabs show spinner ("Refreshing...") + "Last refreshed: Xm ago" timestamp via shared `wrapRefreshButton()` helper.

### Fixed
- Dashboard Access Control card flickering (re-rendered every 30s, now guarded by `_accessKvBuilt`).
- DM Keyword Filter stats labels ("Allowed"/"Dropped" changed to "Passed"/"Filtered").
- Stale "pairing" defaults in config-schema.ts and inbound.ts fallback.
- `bulkUpsertContacts` message_count set to 0 for sync-discovered contacts (was 1, breaking Can Initiate).
- Passcode hash comparison uses `timingSafeEqual` (was vulnerable to timing attacks).
- PairingEngine singleton now detects rotated hmacSecret.
- Sync API failures tracked in `state.lastError` (previously reported silent success).
- TTL config sync failure tracked (returns -1, caller sets lastError).
- Config migration POST failure now shows error toast (was silently swallowed).
- Module config JSON corruption now logged.
- `enableModule`/`disableModule` reject unregistered module IDs.
- Clipboard copy error handler added for pairing deep links.
- HMAC secret generation deduplicated (channel.ts uses `generateHmacSecret` from pairing.ts).

### New Files
- `src/sync.ts` — Background directory sync engine
- `src/pairing.ts` — Passcode pairing engine
- `src/auto-reply.ts` — Auto-reply engine
- `src/module-registry.ts` — Module registry
- `src/module-types.ts` — WahaModule interface
- `src/rate-limiter.ts` — Shared rate limiter (extracted from monitor.ts)

## [1.14.3] - 2026-03-15

### Added
- **Mutation deduplication**: POST/PUT/DELETE calls to WAHA that timeout are now tracked. If the gateway retries the same mutation within 60 seconds, the retry is suppressed — preventing duplicate WhatsApp messages caused by timeout-then-retry cycles.

### Fixed
- Hash function for dedup keys now recursively sorts nested object keys (polls, events, locations hash correctly).
- DELETE requests exclude body from dedup key (body is not sent in HTTP DELETE).
- Timeout detection no longer matches non-timeout errors containing the word "abort".
- `response.text()` fallback wrapped in try-catch with structured error context.
- `hashBody` handles circular references gracefully (logs warning, skips dedup for that call).

## [1.14.2] - 2026-03-15

### Fixed
- **Critical**: Keyword filters now check `textBody` (human-written text) instead of `rawBody`, preventing voice messages, images, locations, polls, and other media-only messages from bypassing DM and group keyword filters via synthetic `[media]` tags.
- `mentionOnly` per-DM setting also checks `textBody` for consistency.
- Global group filter and DM filter drops now log the reason (were previously silent).
- `DmFilter` uses structured logging instead of `console.warn` for errors and invalid regex patterns.
- Poll options fallback handles both string and object shapes from WAHA (was rendering `[object Object]`).

### Improved
- Replaced `as any` casts with typed `WahaPollCreationMessage` and `WahaEventMessage` interfaces.
- Eliminated non-null assertions on `Map.get` with local variable pattern.
- Consolidated duplicate `DmFilterConfig` type definition.

## [1.14.1] - 2026-03-15

### Fixed
- `/shutup all` now backs up DM settings from SQLite (lightweight, no WAHA API calls). Previously passed `null` backup, causing all contacts to revert to `canInitiate=true` on unmute.
- `/shutup all` sends confirmation immediately, then mutes in background with completion DM.
- `/unshutup all` deduplicates group count (was showing 244 instead of 122 with 2 accounts).
- `bypassPolicy` now also skips mute check so system command messages can reach muted groups.
- `getAllMutedGroups` restores DM settings before deleting expired mutes (was permanently losing backups).
- Pending selections stored in SQLite (survives gateway restarts). Early check runs before cross-session dedup.
- Default contact rule `can_initiate` changed to `true` (synced with `SYSTEM_CONTACT_DEFAULTS`).
- Empty catch blocks replaced with logging throughout shutup module.

## [1.14.0] - 2026-03-15

### Added
- **`/shutup` command**: Mute the bot in a group directly from WhatsApp. Regex-based (not LLM-dependent). Supports duration (`/shutup 5m`, `/shutup 2h`, `/shutup 1d`) and auto-unmute.
- **`/unshutup` command**: Unmute the bot in a group. Also accepts `/unmute` as alias.
- **DM interactive flow**: Send `/shutup` or `/unshutup` in a DM to see a numbered group list and select by number or "all".
- **`/shutup all`**: Mute/unmute the bot in all groups at once.
- **DM backup on mute**: When a group is muted, DM settings for all group participants are backed up and blocked. On unmute, settings are restored to pre-mute state.
- **Outbound send block**: Messages to muted groups are blocked at the send level, not just inbound.
- **Role-based authorization**: Only superusers and allowed senders can mute/unmute the bot.
- **Persistence**: Mute state survives gateway restarts (SQLite-backed).

## [1.13.0] - 2026-03-15

### Added
- **Per-group filter overrides**: Individual groups can override the global keyword filter. Disable filtering entirely (the bot responds freely), set custom keywords, or override god mode scope per group.
- **Admin panel UI**: Groups in the Directory tab now show an inline "Group Filter Override" section when expanded, with toggles for override enable, keyword filter on/off, custom patterns, and god mode scope.
- **API endpoints**: `GET/PUT /api/admin/directory/:jid/filter` for reading and saving per-group filter overrides.
- **Cross-account sync**: Per-group overrides are written to all account DBs so they work regardless of which session processes the message.

### Changed
- Group filter override lookup happens before global filter — per-group settings take priority

## [1.12.1] - 2026-03-15

### Fixed
- fromMe messages with trigger prefix now bypass the self-message filter (required for human session trigger activation)
- Accept `message.any` webhook events for fromMe trigger messages (WAHA NOWEB only fires `message.any` for self-sent messages)
- Fixed `message.body` field name (was incorrectly `message.text`) in fromMe trigger check
- Dedup key normalized so `message` and `message.any` events dedup against each other

## [1.12.0] - 2026-03-15

### Added
- **Cross-session message dedup**: Bot sessions claim messages first (200ms priority), human sessions drop duplicates. Prevents double-processing and token waste in multi-session setups.
- **Trigger operator for DMs**: Trigger word detection now works for both DMs and group messages (previously groups only). DM filter respects trigger bypass.
- **God mode scope**: New `godModeScope` config field ("all", "dm", "off") controls where superuser filter bypass applies. Prevents bot from accidentally responding in groups on behalf of human users.
- **Bot proxy prefix**: When bot sends through a human session (cross-session routing), messages are prefixed with 🤖 to distinguish bot responses from human messages.
- **Configurable trigger operator**: Admin panel now has Trigger Operator section with text input for trigger word and response mode dropdown.
- **Multi-session filtering guide**: Admin panel Config tab includes collapsible documentation explaining message flow, scenarios, and guardrail layers.

### Changed
- Human sessions defer 200ms before processing to give bot sessions priority for claiming messages
- God mode scope defaults to "all" (backward compatible) but recommended "dm" for group safety

### Fixed
- Race condition in cross-session dedup: `claimMessage` now uses claim-if-unclaimed semantics (prevents double-processing)
- Empty messageId guard prevents all ID-less messages from being treated as duplicates
- Added `groupFilter` to Zod strict schema (prevents potential startup crash)
- Bot proxy prefix now applied to media captions (was only on text replies)
- Invalid regex patterns in keyword filter are skipped individually instead of disabling all filtering
- Unrecognized `godModeScope` values now log a warning instead of silently disabling bypass

## [1.11.1] - 2026-03-14

### Fixed
- Plugin name mismatch on deploy: `openclaw.plugin.json` now included in npm package
- Excluded `.bak` files and internal design docs from npm package
- Added `rules/` seed YAML files to npm package

## [1.11.0] - 2026-03-14

### Added
- **Phase 6**: File-based YAML rules/policy system with hierarchical contact/group policies
- **Phase 6**: Manager authorization for policy edits (owner-only appoint/revoke)
- **Phase 6**: Compact resolved-policy injection into model context per event
- **Phase 6**: Identity normalization for stable JID/LID mapping
- **Phase 6**: Outbound policy enforcement (fail-open design)
- **Phase 5**: Human mimicry presence system with realistic typing indicators, read receipts, and random pauses
- **Phase 4**: Multi-session roles (`bot`/`human` with `full-access`/`listener` sub-roles)
- **Phase 4**: Trigger word activation for group chats
- **Phase 4**: Cross-session routing (bot session with human session fallback)
- **Phase 4**: `readMessages` action for reading recent messages from any chat (1-50)
- **Phase 4**: Sessions tab in admin panel
- **Phase 3**: `muteChat`/`unmuteChat` actions
- **Phase 3**: `sendMulti` action for sending text to multiple chats
- **Phase 3**: Auto link preview for URLs in text messages
- **Phase 3**: Mention extraction from inbound messages
- **Phase 2**: Session health monitoring with automatic health pings
- **Phase 2**: Inbound message queue with separate DM and group queues
- **Phase 1**: Request timeouts on all WAHA API calls (configurable `timeoutMs`)
- **Phase 1**: Token-bucket rate limiting (`rateLimitCapacity`/`rateLimitRefillRate`)
- **Phase 1**: Automatic retry with exponential backoff (up to 3 retries)
- **Phase 1**: Webhook deduplication by messageId

## [1.9.4] - 2026-03-10

### Added
- Contact card (vCard) sending
- `joinGroup` action
- `followChannel`/`unfollowChannel` actions
- `sendImage`, `sendVideo`, `sendFile` as explicit actions

## [1.9.3] - 2026-03-10

### Fixed
- Media sent as proper WhatsApp media types (not document attachments)
- MIME detection for URLs with query parameters

## [1.9.0] - 2026-03-10

### Changed
- **BREAKING**: `listActions()` returns only gateway-standard action names

### Added
- Auto name-to-JID resolution via `autoResolveTarget`
- Session role guardrails

## [1.8.x] - 2026-03-08 to 2026-03-09

### Fixed
- Directory fixes
- Duplicate webhook prevention
- Config save path fix

### Added
- Admin panel

## [1.4.0] - 2026-03-08

### Fixed
- Typing indicator flicker fix

### Added
- Admin panel media preprocessing toggles
- Directory refresh
