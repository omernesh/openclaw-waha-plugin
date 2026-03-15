# WAHA OpenClaw Plugin — Roadmap

## Phase 1: Reliability Hardening (Priority: HIGH)
Focus: Make the existing features bulletproof.

- [ ] **R1: Error Logging** — Add structured error logging to all WAHA API calls in send.ts. No more silent `.catch(() => {})`.
- [ ] **R5: Request Timeouts** — Add AbortController-based timeouts (30s) to all fetch() calls in send.ts.
- [ ] **R5: Webhook Deduplication** — Deduplicate by messageId (sliding window of last 100 IDs).
- [ ] **R4: Cache Bounds** — Add max size (1000 entries) and LRU eviction to resolveTarget cache.
- [ ] **R2: Outbound Rate Limiter** — Proactive token-bucket rate limiter on all outbound WAHA API calls (e.g. 20 req/s). Queue excess calls and drain at allowed rate.
- [ ] **R2: 429 Backoff (Safety Net)** — Exponential backoff on 429 responses from WAHA API, in case proactive limiter is set too high.
- [ ] **R4: Memory Audit** — Profile caches, event listeners, and webhook handler for leaks.

## Phase 2: Resilience & Monitoring (Priority: HIGH)
Focus: Detect and recover from failures.

- [ ] **R3: Session Health Check** — Ping WAHA `/api/{session}/me` every 60s, log warnings on failure.
- [ ] **F5: Message Queue** — Async preprocessing queue with bounded size (100 messages), drop oldest on overflow.
- [ ] **F5: Flood Protection** — Rate limit inbound processing (max 10 messages/second per chat).
- [ ] **R1: Error Surfacing** — Ensure all action handler errors return LLM-friendly messages.

## Phase 3: Missing Features (Priority: MEDIUM)
Focus: Fill functional gaps.

- [ ] **F1: Mute/Unmute Chat** — Add actions + handlers + docs.
- [ ] **F3: Mentions Detection** — Extract @mentions from inbound messages, provide context.
- [ ] **F2: Group Events** — Handle join/leave/promote/demote system messages.
- [ ] **F4: Multi-Recipient Send** — Batch send with per-recipient results.
- [ ] **F6: URL Preview Send** — Use WAHA's link-preview endpoint for sending URLs with rich previews. Test with Sammie.
- [ ] **F7: Better Error Messages** — Context-rich errors with suggested fixes.

## Phase 4: Documentation & Testing (Priority: MEDIUM)
Focus: Complete docs, add test coverage.

- [ ] **SKILL.md Refresh** — Add error scenarios, rate limit guidance, sequential action examples.
- [ ] **Unit Tests** — Test fuzzyScore, toArr, resolveChatId, autoResolveTarget.
- [ ] **Integration Tests** — Test action handlers with mock WAHA API.
- [ ] **README Update** — Installation, configuration, deployment guide.

## Phase 5: Multi-Session Support (Priority: MEDIUM)
Focus: Support multiple WAHA sessions with role-based access and cross-session messaging.

- [ ] **M1: Session Registry** — Register multiple WAHA sessions in plugin config, each with a name and session ID.
- [ ] **M2: Session Roles** — Assign roles to each session: `bot` or `human`. Extensible for future role types.
- [ ] **M3: Session Sub-Roles** — Sub-roles per session: `full-access` (send + receive) or `listener` (receive only, no outgoing). Extensible.
- [ ] **M4: Admin Panel — Session Management** — UI tab to manage sessions, assign roles/sub-roles, view connection status.
- [ ] **M5: Trigger Word Activation** — Configurable trigger word (e.g. `!sammie`) in any chat. When a human-session user sends `!sammie <prompt>`, the message is routed to the bot as a prompt.
- [ ] **M6: Bot Response Routing** — Bot responds via DM to the requesting user by default. If user requests group delivery and bot is a member, bot sends from its own session. If bot is NOT a member, send via the user's session (respecting role/sub-role permissions).
- [ ] **M7: Session Fallback Logic** — When bot session can't reach a chat (not a member, blocked), fall back to user's session if permitted by config.
- [ ] **M8: Cross-Session Context** — Bot can read recent messages from chats it monitors (via listener sessions) to fulfill prompts like "summarize last 20 messages".

## Phase 6: Platform Abstraction (Priority: LOW — Future)
Focus: Extract core client for multi-platform use.

- [ ] **WahaClient Class** — Stateful client with config, retry, caching built in.
- [ ] **Adapter Interface** — Define platform adapter contract.
- [ ] **Claude Code Adapter** — Port whatsapp-messenger skill to use WahaClient.
- [ ] **Monorepo Setup** — Separate packages for core client and platform adapters.

## Phase 7: Admin Panel Critical Fixes (Priority: HIGH)
Focus: Fix broken functionality that prevents normal admin panel use.

- [ ] **AP-01: Save & Restart Graceful Recovery** — After "Save and Restart", show a "Restarting..." overlay, poll the server until it responds (up to 60s), then auto-reload. No more 502 crash screen. *(Bug 7)*
- [ ] **AP-02: Directory Pagination Fix** — Fix "Load More" button: default initial load to 50 items, fix offset/pagination so clicking "Load More" fetches the next page instead of duplicating entries. *(Bug 8)*
- [ ] **AP-03: Group Filter Override 502 Fix** — Fix the API call that fails with HTTP 502 when toggling "Override global filter" checkbox on a group. *(Bug 12)*

UAT: Save & Restart shows overlay and recovers. Load More loads new items. Group filter override saves without error.

## Phase 8: Shared UI Components (Priority: MEDIUM)
Focus: Build reusable UI components used across multiple admin panel sections.

- [ ] **UI-01: JID-to-Name Resolution in Dashboard** — Replace raw JIDs/LIDs/phone numbers with resolved contact names in the Dashboard Access Control section. Add tooltips to section titles. *(Bug 1)*
- [ ] **UI-02: Contact Picker with Search** — Build a reusable contact/group picker component with UTF-8 fuzzy search, multi-select, and paired JID handling (@c.us + @lid as one contact). Use in Allow From, Group Allow From, and God Mode Users fields. *(Bug 4)*
- [ ] **UI-03: Tag-Style Input Component** — Build a reusable tag/bubble input: type word, press comma/space to create a bubble with 'x' to delete, press enter to add. Use for Mention Patterns, Custom Keywords, and Group Keywords inputs. *(Bug 5)*
- [ ] **UI-04: God Mode Users Display** — Show contact names instead of raw numbers/LIDs. Each contact on its own line with remove button. Add/remove paired JIDs together. *(Bug 6)*

UAT: All JID displays show human names. Tag inputs work with comma/space/enter. Contact picker supports Hebrew + English fuzzy search. God Mode shows names with remove buttons.

## Phase 9: Settings UX Improvements (Priority: MEDIUM)
Focus: Improve Settings tab usability and clarity.

- [ ] **UX-01: DM Policy Pairing Investigation** — Investigate how "pairing" approval mode works. Either implement it properly with tests or remove/disable the option with a clear explanation. *(Bug 3)*
- [ ] **UX-02: Contact Settings Tooltips** — Add tooltips to all Contact Settings panel fields (Mode, Mention Only, Custom Keywords, Can Initiate) explaining what each does. Clarify "Active" vs "Listen Only" meanings. *(Bug 9)*
- [ ] **UX-03: Group Filter Override UX** — Add per-group trigger operator option. Replace keywords plain text with tag-style input (reuse UI-03 component). *(Bug 13)*
- [ ] **UX-04: Directory Tab Switching & Search** — Clear search bar when switching tabs. Add 'x' clear button in search bar. Rename "Newsletters" tab to "Channels". *(Bug 14)*

UAT: Pairing mode is either working or removed. All settings fields have tooltips. Group filter has trigger operator. Tab switching clears search. Newsletters renamed to Channels.

## Phase 10: Directory & Group Enhancements (Priority: MEDIUM)
Focus: Improve directory browsing, group participant management, and bulk operations.

- [ ] **DIR-01: Groups Pagination** — Replace long group list with paginated table. Upper and lower nav bars with page numbers and "Display [X] groups" selector. *(Bug 10)*
- [ ] **DIR-02: Group Participants Fix** — Fix groups showing "0 participants" / failing to load. Show contact names instead of raw LIDs. Reflect global allowlist state in participant buttons. *(Bug 11)*
- [ ] **DIR-03: Group Participant Roles** — Add role dropdown per participant: "Bot Admin" (can assign managers, configure bot via DM), "Manager" (manage bot in this group), "Participant" (no special rights). *(Bug 16)*
- [ ] **DIR-04: Bulk Edit** — Select multiple contacts/groups/participants and apply changes in bulk (allow DM, change role, etc.). *(Bug 17)*

UAT: Groups paginated with nav controls. All participants load with names. Roles assignable per participant. Bulk selection and edit works.

## Phase 11: Dashboard, Sessions & Log (Priority: LOW)
Focus: Complete dashboard information and improve log readability.

- [ ] **DASH-01: Multi-Session Dashboard** — Show all connected sessions (not just logan). Display both omer and logan sessions with their respective ports and status. *(Bug 2)*
- [ ] **SESS-01: Session Role Editing** — Add dropdown to change session type/role directly from the Sessions tab instead of requiring Config tab edits. *(Bug 15)*
- [ ] **LOG-01: Structured Log Display** — Improve log tab with clearly formatted timestamps, visual separation between entries, and structured layout for readability. *(Bug 18)*

UAT: Dashboard shows all sessions. Session roles editable via dropdown. Log entries have visible timestamps and clear separation.

## Version History
- v1.10.4 (2026-03-11): search action, DO NOT CHANGE comments
- v1.10.0-1.10.2 (2026-03-10): resolveTarget, auto name resolution, 30s cache
- v1.9.5 (2026-03-10): vCard interception fix
- v1.9.3 (2026-03-10): Outbound media fix (images/videos as proper media)
- v1.9.2 (2026-03-10): Image analysis fix (media path + native pipeline)
- v1.9.0 (2026-03-10): Action names fix (standard names only)
- v1.8.7 (2026-03-09): Admin panel, directory, config fixes
- v1.8.2 (2026-03-09): Poll creation fix (3-source chatId fallback)
- v1.8.0 (2026-03-09): targetResolver for JID recognition
- v1.7.3 (2026-03-09): Action naming conventions
- v1.7.1 (2026-03-08): actions property rename (messageActions → actions)
