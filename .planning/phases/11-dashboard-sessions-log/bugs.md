# Phase 11 — Bugs & CRs from Human Verification

## CR-01: Dashboard health section doesn't indicate which session it refers to
**Type:** CR (clarity)
**Location:** Dashboard tab → Sessions card → Health section below session rows
**Issue:** The "Health: healthy", "Consecutive Failures: 0", "Last Success", "Last Check" fields appear once at the bottom of the sessions card without specifying which session they refer to. If one session is unhealthy, it's unclear which one has the problem.
**Expected:** Either show per-session health details, or clarify that this is the aggregate/overall health status.

## BUG-01: Access Control card doesn't resolve @lid JIDs to names
**Type:** Bug
**Status:** FIXED — pending post-fix review
**Location:** Dashboard tab → Access Control card → allowFrom / groupAllowFrom lists
**Issue:** The name resolver only resolves `@c.us` JIDs to contact names. `@lid` JIDs (e.g., `271862907039996@lid`) are shown raw without resolving to the same contact name. Since NOWEB uses `@lid` format, these should be merged/resolved to show the contact name just like their `@c.us` counterpart.
**Expected:** `@lid` JIDs should either resolve to contact names or be visually paired/merged with their `@c.us` equivalent so the user sees one entry per person, not two.
**Fix applied:** Server-side dedupLidServer() uses db.resolveLidToCus() instead of broken string replace. @lid JIDs now correctly resolve via lid_mapping table.

## BUG-02: Access Control card keeps refreshing every few seconds
**Type:** Bug (UX)
**Status:** FIXED — pending post-fix review
**Location:** Dashboard tab → Access Control card
**Issue:** The card visibly re-renders every few seconds, causing flickering/jumping. Likely the name resolver is re-fetching and re-rendering the entire card on each resolution callback, or `loadStats()` is being called on a timer that rebuilds the whole dashboard.
**Expected:** Dashboard should load once and stay stable. Either stop the periodic refresh, or only update changed data without re-rendering the entire card.
**Fix applied:** Added _filterStatsBuilt guard. On 30s refresh, stat values update via textContent instead of rebuilding innerHTML. No more flicker.

## BUG-03: DM Keyword Filter stats confusing — "0 allowed" but "33 dropped"
**Type:** Bug (data/labeling)
**Status:** FIXED — pending post-fix review
**Location:** Dashboard tab → DM Keyword Filter card → stats
**Issue:** Shows "0 Allowed, 33 Dropped, 85000 Tokens Saved". If 0 were allowed, what was dropped? The "allowed" counter likely only counts messages that passed the keyword filter, while "dropped" counts messages blocked by it. But the labeling is confusing — "allowed" suggests total messages received, and 0 implies nothing happened. The counter may reset on gateway restart while "dropped" persists, or the semantics are just unclear.
**Expected:** Clarify labels. Consider "Passed" vs "Filtered" instead of "Allowed" vs "Dropped". Or show total received = passed + filtered.
**Fix applied:** Already fixed — labels already read "Passed"/"Filtered" not "Allowed"/"Dropped". Confirmed no changes needed.

## CR-02: Make Dashboard filter cards collapsible
**Type:** CR (UX)
**Location:** Dashboard tab → DM Keyword Filter card, Group Keyword Filter card
**Issue:** Both cards are always expanded and take up significant vertical space.
**Expected:** Make both cards collapsible (like the Settings sections use `<details>` elements) so users can collapse cards they don't need to see.

## CR-03: Dashboard labels should be human-readable
**Type:** CR (UX)
**Location:** Dashboard tab → all cards (especially Presence System)
**Issue:** Labels use raw config field names like "wpm", "readDelayMs", "typingDurationMs", "pauseChance" etc. Not human-readable for non-developers.
**Expected:** Replace with plain English: "wpm" → "Words Per Minute", "readDelayMs" → "Read Delay", "typingDurationMs" → "Typing Duration", "pauseChance" → "Pause Chance", etc. Same treatment throughout the GUI wherever config keys are displayed as labels.

## CR-04: Dashboard stats don't indicate which session they belong to
**Type:** CR (clarity/architecture)
**Location:** Dashboard tab → DM Keyword Filter, Group Keyword Filter, Presence System, Access Control cards
**Issue:** Stats are displayed without indicating which session they refer to. With two sessions (omer & logan) it's unclear whose filter stats, presence settings, and access control are being shown.
**Decision:** For 2-3 sessions, show per-session stats inline within the same cards — add the session name as a sub-header within each card. Each session gets its own stats row/section inside the card. No dropdown/toggle needed until session count grows large. If >5 sessions in future, revisit with a dropdown selector.
**Example layout:**
```
DM KEYWORD FILTER
  Sammie Bot (logan)
    Passed: 0 | Filtered: 33 | Tokens Saved: 85,000
    Patterns: sammie
  Omer
    Passed: 0 | Filtered: 0 | Tokens Saved: 0
    Patterns: (none)
```

## BUG-04: Sessions tab — role change doesn't update the dropdown visually
**Type:** Bug (UX)
**Status:** FIXED — pending post-fix review
**Location:** Sessions tab → role/subRole dropdowns
**Issue:** When changing a dropdown (e.g., Omer's subRole from "full-access" to "listener"), the page flickers and the dropdown reverts back to the old value ("full-access") even though the change was saved to config. The toast says it'll take effect after restart, but the dropdown should reflect the newly saved value immediately.
**Expected behavior:**
1. Dropdown updates to the new value immediately (shows "listener")
2. A bold notification appears under the dropdown: "Restart required for changes to take effect"
3. Add "Save" and "Save & Restart" buttons at the bottom of the Sessions tab (same pattern as the Settings tab)
4. No page flicker — the save should NOT trigger a full `loadSessions()` re-render that resets dropdowns to the running config
**Fix applied:** saveSessionRole() no longer calls loadSessions(). Updates dropdown data-prev and adds amber "Restart required" notice.

## BUG-05: 502 Bad Gateway after saving session role change
**Type:** Bug (may be expected)
**Status:** FIXED — pending post-fix review
**Location:** Sessions tab → save role change
**Issue:** After changing Omer's subRole back to "full-access", got a 502 Bad Gateway. Gateway logs show it restarted cleanly — the 502 was during the restart window. The save likely triggered a restart (or the user clicked Save & Restart).
**Notes:** Config persisted correctly after restart. May be expected behavior if the save triggers a restart, but the UI should handle the restart gracefully (show polling overlay like Settings tab does) rather than showing a raw 502.
**Fix applied:** Added "Save & Restart" button with polling overlay. Shows restart overlay during gateway restart, polls every 2s until responsive.

## CR-05: Sessions tab — add labels above dropdowns and explanatory text
**Type:** CR (UX)
**Location:** Sessions tab → role/subRole dropdowns
**Issue:** The role and subRole dropdowns have no labels above them — it's not obvious what each dropdown controls. Also, the terms "human/bot" and "full-access/listener" are not self-explanatory for new users.
**Expected:**
1. Add labels above each dropdown: "Role" above the role dropdown, "Sub-Role" above the subRole dropdown
2. Add a small explanatory text box at the bottom of the Sessions card explaining the options:
   - **bot** — AI-controlled session, processes messages automatically
   - **human** — User-controlled session, messages are monitored but not auto-responded to
   - **full-access** — Can send and receive messages
   - **listener** — Can only receive/monitor messages, outgoing sends are blocked

## CR-06: Log tab — add clear button ('x') to search bar
**Type:** CR (UX)
**Location:** Log tab → search/filter input
**Issue:** No quick way to clear the search bar. User has to manually select and delete text.
**Expected:** Add an 'x' clear button inside the search bar (same pattern as the Directory tab search bar which already has one).

## CR-07: Refresh buttons need visual feedback
**Type:** CR (UX)
**Location:** All tabs — Refresh buttons (Dashboard, Sessions, Log, Queue, Directory)
**Issue:** Clicking Refresh gives no visual confirmation. Can't tell if the click registered or if data was actually refreshed.
**Expected:** Add visual feedback on click — e.g., brief spinner/loading state on the button, button text changes to "Refreshing..." momentarily, or a subtle flash/pulse animation. Show "Last refreshed: HH:MM:SS" timestamp after completion.

## BUG-06: Directory search doesn't find known contacts (e.g., "nadav")
**Type:** Bug
**Status:** FIXED — pending post-fix review
**Location:** Directory tab → search bar
**Issue:** Searching for "nadav" returns no results despite having a contact named "Nadav Nesher" in WhatsApp.
**Root cause:** Likely searching against limited data — either only locally cached contacts or only what's been loaded so far via pagination.
**Fix applied:** getContactCount() now has LIKE fallback matching getContacts(). WAHA API fallback added when local DB search returns 0 results on first page.

## BUG-07: Directory search bar 'x' button doesn't clear the search
**Type:** Bug
**Status:** FIXED — pending post-fix review
**Location:** Directory tab → search bar → clear ('x') button
**Issue:** Clicking the 'x' button in the search bar does not erase the search text or reset results.
**Fix applied:** clearDirSearch() now resets dirGroupPage and dirContactPage to 1 before reloading.

## CR-08: Directory search architecture — use background sync + local SQLite, not realtime WAHA API
**Type:** CR (architecture, high priority)
**Location:** Directory tab → search and data loading
**Issue:** Current implementation hits the WAHA API for search/listing in realtime. This won't scale — users may have thousands of contacts/groups/newsletters. WAHA API calls are slow and rate-limited.
**Expected architecture:**
1. **Background sync**: Continuously pull contacts/groups/newsletters from WAHA API in a rate-limited way throughout the day until WAHA reports everything has been pulled
2. **SQLite storage**: Store all details WAHA reports — @c.us, @lid, resolved names, profile pics, last seen, etc.
3. **Search queries local DB**: Directory search should query the SQLite DB, not the WAHA API. This is instant and works offline.
4. **Incremental updates**: After initial full sync, only pull deltas (new contacts, updated names, etc.)
5. **Sync status indicator**: Show "Last synced: HH:MM" and "X/Y contacts synced" in the Directory tab
**Note:** We already have a `DirectoryDb` class in `directory.ts` with SQLite tables. The question is whether search currently queries the DB or bypasses it to hit WAHA directly.

## BUG-08: Tooltips clipped by card/container overflow
**Type:** Bug (CSS)
**Status:** FIXED — pending post-fix review
**Location:** Directory tab → contact settings card → tooltips (e.g., on Mode, Can Initiate)
**Issue:** Tooltip text is cut off by the parent card's overflow boundaries. The tooltip renders behind/under the card border so the user can't read the full text. Visible in screenshot: "ot responds to this contact." and "ly: messages arrive but bot does" are clipped on the left edge.
**Expected:** Tooltips should render above the overflow boundary (use `z-index` and `overflow: visible` on the tooltip, or position tooltips relative to the viewport rather than the card container).
**Fix applied:** Added overflow:visible to .card, .settings-section, .field-group, .contact-settings-panel, .settings-fields, .settings-field CSS rules.

## BUG-09: Contact settings drawer closes after saving
**Type:** Bug (UX)
**Status:** FIXED — pending post-fix review
**Location:** Directory tab → contact card → Settings → Save button
**Issue:** After changing a contact's setting (e.g., mode from "Active" to "Listen Only") and clicking Save, the settings drawer/panel closes. User has to reopen it to make additional changes.
**Expected:** The settings drawer should stay open after saving. Show a success toast confirming the save, but keep the drawer expanded so the user can continue editing other fields without re-opening.
**Fix applied:** Added event.stopPropagation() to Save button onclick to prevent click bubbling from closing the settings panel.

## CR-09: Custom Keywords field should use tag-style input (word bubbles)
**Type:** CR (UX)
**Location:** Directory tab → contact card → Settings → Custom Keywords field
**Issue:** Custom Keywords is a plain text input where user types comma-separated values. Inconsistent with the tag-style inputs used elsewhere (e.g., allowFrom, groupAllowFrom in Settings tab).
**Expected:** Use the same `createTagInput()` pattern from Phase 8 (UI-02). When user types a keyword and presses space, comma, or Enter, it becomes a pill/bubble. Each bubble has an 'x' to delete it. Same UX as the JID tag inputs in the Settings tab.

## CR-10: "Can Initiate" should be a global setting with per-contact override
**Type:** CR (feature)
**Location:** Settings tab (global) + Directory tab → contact card (per-contact override)
**Issue:** "Can Initiate" currently only exists as a per-contact setting in the Directory contact card. There's no global default. User may want to globally disable bot-initiated chats but allow it for specific contacts as exceptions.
**Expected:**
1. Add a global "Can Initiate" toggle in the Settings tab (under Access Control or DM Policy section) — default for all contacts
2. Per-contact "Can Initiate" in Directory becomes an override: "Default (use global)" / "Allow" / "Block"
3. Logic: if global=off and per-contact=allow → bot can initiate with that contact. If global=on and per-contact=block → bot cannot initiate with that contact.

## BUG-10: God Mode Users shows raw phone numbers instead of contact names
**Type:** Bug
**Status:** FIXED — pending post-fix review
**Location:** Settings tab → DM Keyword Filter AND Group Keyword Filter → God Mode Users fields
**Issue:** The tag bubbles show raw numbers (e.g., "972544329000") instead of resolved contact names. Same issue for Allowed Groups showing raw group JIDs (e.g., "120363421825201386@g.us") instead of group names. Applies to both DM and Group keyword filter sections.
**Expected:** Tag bubbles should resolve and display contact/group names using the name resolver. Show the name with the number as a tooltip or secondary text.
**Fix applied:** resolveJids() in directory.ts now handles bare phone numbers (no @c.us suffix) by appending @c.us as fallback. Covers God Mode Users config entries.

## BUG-11: God Mode Users contact search doesn't find contacts
**Type:** Bug
**Status:** FIXED — pending post-fix review
**Location:** Settings tab → DM Keyword Filter AND Group Keyword Filter → God Mode Users → contact picker search
**Issue:** Searching for "nadav" in the contact picker returns "No contacts found. Try a different name or phone number." despite having a contact named Nadav Nesher. Applies to both DM and Group keyword filter sections. Same root cause as BUG-06 — the contact picker searches the WAHA API or an incomplete local DB.
**Expected:** Contact picker should search the local SQLite directory (same fix as CR-08 — background sync + local DB search).
**Fix applied:** FTS5 _fts5Quote() now appends * for prefix matching. Added LIKE fallback when FTS5 returns 0 results.

## CR-11: Mention Patterns should use tag-style input
**Type:** CR (UX)
**Location:** Settings tab → DM Keyword Filter AND Group Keyword Filter → Mention Patterns field
**Issue:** Mention Patterns is currently a plain textarea where patterns are entered one per line. Inconsistent with the tag-style inputs used for JID fields.
**Expected:** Use `createTagInput()` so each pattern becomes a pill/bubble on Enter, comma, or space. Each bubble has an 'x' to delete. Same UX as the other tag fields throughout Settings.

## BUG-12: Allow From, Group Allow From, and Allowed Groups show raw JIDs instead of names
**Type:** Bug
**Status:** FIXED — pending post-fix review
**Location:** Settings tab → Access Control → Allow From (DMs), Group Allow From, Allowed Groups
**Issue:** All tag bubbles show raw JIDs/numbers (e.g., "972544329000@c.us", "271862907039996@lid", "120363421825201386@g.us") instead of resolved contact/group names. Same issue as BUG-10 but in the Access Control section.
**Expected:** Tag bubbles should display resolved names (e.g., "Omer Nesher" instead of "972544329000@c.us", "Sammie test group" instead of the group JID). Show the raw JID as a tooltip on hover. Merge @c.us and @lid entries for the same person into one bubble showing the name.
**Fix applied:** Same root fix as BUG-10 — resolveJids() handles bare numbers. Tag input pills now show resolved names via batch resolve endpoint.

## BUG-13: DM Policy shows "pairing (not available)" as a selectable option
**Type:** Bug
**Status:** FIXED — pending post-fix review
**Location:** Settings tab → Access Control → DM Policy dropdown
**Issue:** "pairing" is listed as a dropdown option with "(not available)" text. If it's not supported in the current SDK integration, it shouldn't be shown as a selectable option at all. The user currently has it selected, which means it's either doing nothing or behaving unpredictably.
**Expected:** Remove "pairing" from the dropdown entirely. If the user's config has "pairing" set, auto-migrate to "allowlist" (closest equivalent) on load and show a one-time notice explaining the change.
**Fix applied:** Already fixed — pairing option already removed from dropdown, migration logic already converts pairing→allowlist. Confirmed no changes needed.

## FEATURE-01: Implement pairing mode — passcode-gated temporary access
**Type:** Feature (next milestone candidate)
**Location:** Plugin-level access system (inbound.ts, directory.ts, admin panel)
**Description:** Passcode-based access gating for DMs:
1. Unknown contact DMs the bot → bot replies with scripted "What's the passcode?" (no LLM, zero tokens)
2. Contact replies with numeric passcode
3. If correct → contact added to a **temporary allowlist** with TTL (configurable, e.g., 30 min)
4. Auto-revoke after TTL expires OR after the agent completes its task (e.g., meeting scheduled)
5. Prevents token abuse from temporary contacts
**Architecture considerations:**
- Passcode store: per-session, configurable in admin panel
- Scripted challenge/response in inbound.ts (pre-LLM filter, zero cost)
- Temporary allowlist entries in SQLite with TTL column
- Task-scoped lease: agent signals "task complete" → access revoked
- Admin panel: set passcode, TTL, view active temporary grants, revoke manually
**Note:** This is a plugin-level primitive, not agent-specific. Any agent can benefit (meeting scheduler, order status, quote requests, etc.). Full phase scope for next milestone.
**Additional design (user input 2026-03-17):**
- Passcode scope: configurable per-session OR per-contact (same pattern as keyword filters)
- URL-based passcode injection: passcode can be embedded in a `wa.me` link as an obfuscated parameter. Contact clicks the link → opens WhatsApp DM → first message contains the passcode → auto-authorized without manual challenge/response.
- Use case: customer support bot. Order confirmation email includes a link like `wa.me/972...?text=VERIFY-abc123`. Customer clicks → DM opens with pre-filled passcode message → bot auto-verifies and grants temporary access. Zero friction for the customer.

## FEATURE-02: TTL-based access for contacts and groups
**Type:** Feature (next milestone candidate)
**Location:** Directory tab → contact card settings + group card settings, directory.ts SQLite schema
**Description:** Add a TTL (time-to-live) option to the contact and group settings cards in the Directory tab. Allows granting auto-expiring access to the bot for specific contacts or groups.
**Expected:**
1. Contact/group settings card gets a "Access Expires" field: "Never" (default) / custom datetime / duration (e.g., "24 hours", "7 days")
2. SQLite `dm_settings` / `allow_list` tables get an `expires_at` column
3. Inbound filter checks `expires_at` before granting access — expired entries are treated as blocked
4. Admin panel shows remaining time on active TTL grants (e.g., "Expires in 2h 15m")
5. Expired entries are visually marked in the Directory (grayed out or badge)
6. Ties into FEATURE-01 (pairing mode auto-grants can set TTL automatically)
**Note:** Complements FEATURE-01 — pairing mode creates TTL entries automatically, but TTL access can also be set manually by the admin for any contact/group without passcode gating.

## BUG-14: Queue tab Refresh button has no visual feedback
**Type:** Bug (UX)
**Status:** FIXED — pending post-fix review
**Location:** Queue tab → Refresh button
**Issue:** Same as CR-07 but calling out Queue tab specifically. Clicking Refresh gives no visual confirmation that the click registered or data was refreshed.
**Expected:** Same fix as CR-07 — spinner/loading state on click, "Last refreshed" timestamp after completion.
**Fix applied:** Wrapped #refresh-queue button in .refresh-wrap div for proper spinner animation and "Last refreshed" timestamp layout.

## BUG-15: Directory Contacts tab shows very limited contacts with no pagination
**Type:** Bug
**Status:** FIXED — pending post-fix review
**Location:** Directory tab → Contacts sub-tab
**Issue:** Only a handful of contacts are loaded. No "Load More" button or pagination controls visible, despite the user having many more contacts. The Groups tab has pagination (Phase 10), but Contacts does not.
**Expected:** Contacts should have the same pagination pattern as Groups — paginated table with "Load More" or page navigation. Ties into CR-08 (background sync) — once all contacts are synced to SQLite, pagination queries the local DB for fast results.
**Fix applied:** Contacts stats bar now shows "Showing X-Y of Z" range and "Page X/Y" indicator. Pagination was already implemented but stats bar didn't reflect it.

## CR-12: Directory should exclude bot's own sessions from contact listing
**Type:** CR (UX)
**Location:** Directory tab → Contacts sub-tab
**Issue:** The bot's own session JIDs (e.g., the logan/omer session numbers) appear in the contacts list. The admin doesn't need to see or manage the bot's own entries — it's noise.
**Expected:** Filter out JIDs belonging to any configured session from the contacts listing. Use `listEnabledWahaAccounts()` to get session JIDs and exclude them from directory results.

## BUG-16: Group participants show raw numbers instead of names
**Type:** Bug
**Status:** FIXED — pending post-fix review
**Location:** Directory tab → Groups → Participants list
**Issue:** Participants show raw LID numbers (e.g., "113348632944769", "271862907039996") instead of resolved contact names. Same name resolution issue as BUG-01, BUG-10, BUG-12.
**Expected:** Resolve participant JIDs/LIDs to contact names from the local SQLite directory.
**Fix applied:** Participants name resolution uses db.resolveLidToCus() instead of broken string replace. Added second resolution pass for all participant requests.

## CR-13: Group Filter Override Keywords should use tag-style input
**Type:** CR (UX)
**Location:** Directory tab → Groups → Group Filter Override → Keywords field
**Issue:** Keywords field is a plain text input with comma-separated values (shows placeholder "hello, help, bot"). Inconsistent with tag-style inputs elsewhere.
**Expected:** Use `createTagInput()` — same pill/bubble UX as other tag fields.

## BUG-17: Per-group trigger operator exists but is hard to find
**Type:** Bug (UX/discoverability)
**Status:** FIXED — pending post-fix review
**Location:** Directory tab → Groups → Group Filter Override
**Issue:** The trigger operator (AND/OR) dropdown IS present in the Group Filter Override section (visible in screenshot: "OR – match any keyword"), but the user couldn't find it initially. It's buried inside the override panel which only appears after checking "Override global filter" → "Keyword filter enabled". The per-group trigger operator was requested in Phase 9 (UX-03) and is implemented, but discoverability is poor.
**Expected:** Make the trigger operator more visible — consider showing it even when keyword filter is inheriting global (grayed out with "inheriting global: OR" text), so the user can see the current effective value without expanding the override.
**Fix applied:** Added opacity:0.6 to gfo-op-indicator div for visual distinction as inherited/read-only value.

## CR-14: Bot sessions should appear in group participants but without action buttons
**Type:** CR (UX)
**Location:** Directory tab → Groups → Participants list
**Issue:** The bot's own sessions (e.g., Sammie Bot / logan) should be listed as group participants when they're members — it's useful to confirm the bot is in the group. However, they should NOT have "Allow", "Allow DM", or role dropdown controls next to them since it doesn't make sense to configure the bot's permissions against itself.
**Expected:** Show bot session participants with a distinct style (e.g., "Sammie Bot" with a "bot" badge, grayed out or without action buttons). Use `listEnabledWahaAccounts()` to identify which participants are bot sessions and suppress their controls.

## CR-15: Contacts tab should support bulk editing (same as Groups tab)
**Type:** CR (feature)
**Location:** Directory tab → Contacts sub-tab
**Issue:** The Groups tab has bulk select mode with checkboxes and a bulk action toolbar (Allow Group, Revoke Group, Allow DM, Revoke DM — from Phase 10, DIR-04). The Contacts tab has no equivalent — each contact must be configured individually.
**Expected:** Add the same bulk select pattern to Contacts: checkbox per contact, "Select" button to toggle bulk mode, bulk action toolbar with relevant actions (Allow DM, Revoke DM, Set Mode, etc.).

## CR-16: Promoting participant to Bot Admin / Manager should auto-enable Allow and Allow DM
**Type:** CR (UX/logic)
**Location:** Directory tab → Groups → Participants → Role dropdown
**Issue:** When changing a participant's role to "Bot Admin" or "Manager", the user still has to manually click "Allow" and "Allow DM" separately. A bot admin or manager should inherently have access.
**Expected:** When role is changed to "Bot Admin" or "Manager", automatically enable both Allow (group) and Allow DM for that participant. Show a toast confirming the auto-grant. Demoting back to "Participant" should auto-revoke Allow DM (but keep group Allow — they're still in the group).

## FEATURE-03: Auto-reply canned message to unauthorized DMs
**Type:** Feature (next milestone candidate)
**Location:** inbound.ts (DM filter), admin panel Settings
**Description:** When someone DMs the bot but is not on the allow list, instead of silently dropping the message, send a scripted canned response (no LLM, zero tokens).
**Expected:**
1. Default canned message: "Hey! Thanks for reaching out. Unfortunately, I'm not permitted to chat with you right now. Please ask [bot admin name] to add you to my allow list."
2. Message is configurable in admin panel Settings (under Access Control or DM Policy section)
3. `[bot admin name]` is a template variable that resolves to the name(s) of users with Bot Admin role
4. Rate-limited: only send the canned reply once per contact per X hours (e.g., 24h) to avoid spamming repeat attempts
5. Entirely scripted in inbound.ts — fires before LLM, zero token cost
6. Optional toggle: "Send rejection message" on/off (some admins may prefer silent drop)

## BUG-18: Channels tab — Allow DM button has no toggle/undo behavior
**Type:** Bug (UX)
**Status:** FIXED — pending post-fix review
**Location:** Directory tab → Channels sub-tab → Allow DM button
**Issue:** Multiple problems:
1. All channels appear to have Allow DM enabled but there's no visual state indicating current on/off status
2. Clicking "Allow DM" shows a toast saying everyone in the channel was added to the allow list — but clicking again shows the same toast instead of revoking/undoing
3. No way to quickly undo an Allow DM action — there's no "Revoke DM" toggle or visual toggle state
**Expected:**
1. Allow DM button should be a toggle with clear visual state (green "Allowed" vs gray "Allow DM")
2. Clicking when allowed should revoke (remove from allow list) with a confirmation toast
3. Visual state should persist after page reload
**Fix applied:** Button colors changed to #10b981 (green) when allowed, #334155 (gray) when not. Text changes between "DM Allowed" and "Allow DM". Both buildContactCard and toggleChannelAllowDm updated.

## CR-17: Channels tab should support bulk editing
**Type:** CR (feature)
**Location:** Directory tab → Channels sub-tab
**Issue:** No bulk select mode in the Channels tab. Groups tab has it (Phase 10, DIR-04) but Channels does not.
**Expected:** Add the same bulk select pattern: checkboxes per channel, "Select" button, bulk action toolbar with relevant actions (Allow DM, Revoke DM, Follow, Unfollow, Mute, Unmute).

## IDEA-01: Platform-agnostic modules (channel moderator, event planner, etc.)
**Type:** Idea (next milestone discussion)
**Decision (2026-03-17):** Modules will be per-channel (WhatsApp-specific). Build all modules for WhatsApp first. When porting to Telegram/Discord later, document everything and plan separately — each platform has enough quirks that a shared abstraction isn't worth it now. Port by documentation + re-implementation, not by shared code.

## FEATURE-04: Modules system with admin panel tab
**Type:** Feature (next milestone, major)
**Location:** New "Modules" tab in admin panel + module framework in plugin
**Description:** A module system for adding higher-level capabilities (channel moderator, event planner, etc.) that can be assigned to specific groups/contacts/newsletters.
**Expected:**
1. New "Modules" tab in admin panel between Sessions and Log
2. Each module has:
   - Name and description
   - Enable/disable toggle
   - Configuration options (module-specific settings)
   - Assignment: which groups / contacts / newsletters the module applies to (using contact picker / group picker)
3. Module framework in the plugin:
   - Standard module interface (init, config schema, inbound hook, outbound hook)
   - Modules register themselves and declare what they need
   - Inbound pipeline checks which modules are active for the incoming chat and routes accordingly
4. First candidate modules: channel moderator, event planner
5. WhatsApp-specific — no cross-platform abstraction
