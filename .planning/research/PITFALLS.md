# Domain Pitfalls

**Domain:** v1.11 feature additions to existing brittle WhatsApp plugin (background sync, pairing mode, TTL access, auto-reply, modules system)
**Researched:** 2026-03-17
**Confidence:** HIGH (based on codebase analysis, bugs.md findings, lessons-learned history, and established patterns in similar feature domains)

---

## Critical Pitfalls

### Pitfall 1: Background Sync Race Condition With Inbound Webhook Writes

**What goes wrong:**
Background sync pulls the full contacts/groups list from WAHA and writes it to SQLite in a loop. Meanwhile, the inbound webhook handler also writes to the same `contacts` and `group_participants` tables when new messages arrive (upsert-on-message pattern). These two writers collide. Even with SQLite WAL mode, if the background sync runs a multi-row transaction and the webhook handler tries to upsert mid-transaction, the webhook write either deadlocks or silently fails with `SQLITE_BUSY`. The busy_timeout is already set but a long-running bulk sync transaction will exhaust it.

**Why it happens:**
The background sync naturally batches writes for efficiency (single transaction for 1000 contacts). The existing inbound webhook handler was written assuming it's the only writer. The sync loop has no awareness of concurrent webhook writes and vice versa.

**How to avoid:**
- Run background sync writes in small page-sized batches (50-100 rows) with a `yield` between batches — never one mega-transaction across all contacts
- Add a dedicated write serializer: both the sync loop and webhook handler acquire a single-writer async mutex before writing to `DirectoryDb`
- Use `INSERT OR REPLACE` (upsert) not DELETE+INSERT — shorter write window, safer for concurrent access
- Do NOT use a separate SQLite connection for the sync loop; reuse the singleton `getDirectoryDb()` instance

**Warning signs:**
- `SQLITE_BUSY` errors in logs during the first sync run
- Contacts visible in WAHA but not appearing in the directory tab after sync completes
- Intermittent "no such row" errors from webhook handler immediately after sync finishes

**Phase to address:** Background sync phase (any phase implementing CR-08)

---

### Pitfall 2: Background Sync Exhausting the Rate Limiter and Starving User-Facing Calls

**What goes wrong:**
Background sync makes repeated WAHA API calls to paginate through contacts/groups/newsletters. The token-bucket rate limiter from Phase 1 (R2) is shared across ALL outbound WAHA calls. If the sync loop runs at full speed, it drains the bucket and causes user-facing sends (triggered by the agent) to queue behind sync pages. A busy sync run can cause a visible "hang" of 3-10 seconds before the agent's message is sent.

**Why it happens:**
The rate limiter was built to protect against flood, not to distinguish sync calls from user-facing calls. Background sync is the highest-volume API consumer in the system — it can easily generate 100+ calls in a single run.

**How to avoid:**
- Run sync calls through a SEPARATE low-priority token bucket, or exempt them from the shared limiter but cap the sync loop to 2 calls/second max
- Add a `syncPaused` flag: when a user-facing send is queued, pause the sync loop until the send completes
- Alternatively: use `setTimeout`-based pacing in the sync loop (e.g., 500ms delay between pages) — no shared limiter needed, just explicit throttling
- Track sync calls separately in metrics so you can observe their rate impact

**Warning signs:**
- Agent send latency rises above 3 seconds when background sync is running
- Rate-limiter queue depth visible in Queue tab spikes during sync
- Gateway logs show "token bucket empty" during sync windows

**Phase to address:** Background sync phase — must build throttling in from day one, not as a follow-up

---

### Pitfall 3: Passcode System Vulnerable to Brute-Force and Replay

**What goes wrong:**
Pairing mode uses a numeric passcode. Without rate limiting on passcode attempts, any WhatsApp user who DMs the bot can brute-force a 4-6 digit passcode in seconds. Even with a correct passcode, if the same passcode is reused across sessions (per-session static config), a person who previously learned the passcode can re-authenticate at any time, bypassing the TTL expiry intention.

**Why it happens:**
Passcode systems are naturally stateless unless you explicitly track failed attempts. The "per-session or per-contact" passcode scoping (from FEATURE-01) makes it tempting to keep a single static passcode in config — but static passcodes are replayable forever.

**How to avoid:**
- Rate-limit passcode attempts: max 3 attempts per contact per 30 minutes, then a 24-hour lockout — store attempt count + lockout_until in SQLite
- Generate time-scoped passcodes (TOTP-style rotation: passcode changes every 24h) OR support single-use passcodes that are invalidated after first successful use
- For the `wa.me` link injection use case (FEATURE-01): passcodes in links should be one-time tokens (UUID or random 8-char alphanumeric), not a shared static code
- Never log the passcode in plaintext in gateway logs — log only "passcode attempt from [JID]: MATCH/NO_MATCH"
- Store passcode hash (bcrypt or SHA-256 with salt), not plaintext, in config

**Warning signs:**
- Multiple failed passcode attempts from the same JID in a short window (check logs)
- Admin reports a contact gained access unexpectedly (replay of old passcode)

**Phase to address:** Pairing mode phase (FEATURE-01) — security must be in the initial design

---

### Pitfall 4: TTL Expiry Checked at Read Time But Not Cleaned Up — Zombie Grants

**What goes wrong:**
TTL access grants have an `expires_at` column in SQLite. The inbound filter checks `expires_at > now()` before allowing a message. This appears to work — but expired entries are never deleted from the DB. Over time (especially with pairing mode creating lots of temporary grants), the table accumulates thousands of expired rows. SQLite query performance degrades on unindexed `expires_at` scans. Worse: the admin panel's "active TTL grants" view shows the right count, but the underlying query joins against the expired rows and runs slowly.

**Why it happens:**
Lazy expiry (check at read, never delete) is the easiest implementation. Developers ship it and forget the cleanup step because it "works" in testing with small data.

**How to avoid:**
- Add a periodic cleanup job (every 15 minutes) that `DELETE FROM dm_settings WHERE expires_at IS NOT NULL AND expires_at < ?` with `Date.now()` — run it in the existing health-ping setTimeout chain to avoid a new timer
- Add an index on `expires_at` in the migration: `CREATE INDEX IF NOT EXISTS idx_expires_at ON dm_settings(expires_at) WHERE expires_at IS NOT NULL`
- Cap the maximum TTL duration in the admin panel (e.g., max 7 days) to bound accumulation even without cleanup
- Log cleanup runs at DEBUG level with count of rows deleted

**Warning signs:**
- Directory tab slows down after a week of pairing mode use
- SQLite file size grows unexpectedly (check with `ls -lh ~/.openclaw/`)
- Admin panel "active TTL grants" count is correct but query takes >100ms

**Phase to address:** TTL access phase (FEATURE-02) — index and cleanup must be part of the schema migration

---

### Pitfall 5: Auto-Reply Spam Loop — Bot Replies to Its Own Rejection Message

**What goes wrong:**
Auto-reply sends a canned "you're not allowed" message to unauthorized DMs (FEATURE-03). The bot sends this message using its own session. WAHA delivers a webhook for the bot's outbound message. If `fromMe` filtering is not airtight, the inbound handler processes the bot's own message, determines the bot's JID is also "unauthorized" (it's not in the allow list for itself), and sends another canned reply. Repeat.

**Why it happens:**
The `fromMe` flag in WAHA webhooks is session-relative. The existing code filters `fromMe: true` in the main message path, but the auto-reply logic is new code that runs in a pre-filter phase BEFORE the existing `fromMe` check. If the ordering is wrong, the bot replies to itself.

**How to avoid:**
- Auto-reply logic MUST be inserted AFTER the `fromMe` check, not before it — even though it feels like a "pre-LLM" filter, it's still post-`fromMe`-filter
- Maintain a `recentlyReplied` Set (by contact JID + time window) — if we already sent a canned reply to this JID in the last 24h, skip the send entirely (already planned in FEATURE-03 rate limit requirement)
- Add the bot's own session JIDs to the auto-reply exclusion list — never send a canned reply to a message from any of our own sessions
- Test specifically: send a DM from the bot session to itself and verify no reply loop occurs

**Warning signs:**
- Gateway logs show the same outbound "canned reply" message sent more than once in rapid succession to the same JID
- WAHA logs show the bot session sending hundreds of messages to itself

**Phase to address:** Auto-reply phase (FEATURE-03)

---

### Pitfall 6: Auto-Reply Rate Limit State Lost on Gateway Restart — Spam Window

**What goes wrong:**
The 24-hour "only reply once per contact" rate limit for auto-reply (FEATURE-03) is stored in memory (a `Map` with timestamps). When the gateway restarts (which happens on every code deploy), the map is cleared. An unauthorized contact who triggered the auto-reply 2 minutes before the restart will receive another canned reply immediately after the restart when they DM again.

**Why it happens:**
In-memory state is the easiest implementation. Developers don't anticipate the restart-on-deploy pattern (every phase deploys, every deploy restarts the gateway).

**How to avoid:**
- Store auto-reply timestamps in SQLite (`contacts` table, add `last_auto_reply_at` column) — persists across restarts
- Alternative: use a TTL-aware in-memory store that re-hydrates from SQLite on startup
- The cleanup overhead is minimal — a single extra column on `contacts`, written only when auto-reply fires

**Warning signs:**
- User reports receiving two "not allowed" messages shortly apart — check if a deploy happened between them
- Test: send unauthorized DM, restart gateway within 1 minute, send another DM — verify no second reply

**Phase to address:** Auto-reply phase (FEATURE-03) — persistence must be in the initial design

---

### Pitfall 7: Module System Inbound Hook Ordering Breaks Existing Pipeline

**What goes wrong:**
The module framework (FEATURE-04) adds inbound hooks — each module gets a chance to intercept/transform messages. This hook pipeline runs inside `handleWahaInbound`. The existing inbound pipeline has carefully ordered checks: `fromMe` filter → dedup claim → shutup check → trigger word → DM policy → group policy → LLM dispatch. Inserting module hooks at the wrong position (e.g., before dedup claim or after LLM dispatch) causes modules to fire on messages they shouldn't see, or fire after the message has already been processed.

**Why it happens:**
The existing pipeline has no extension points by design — it was built as a monolithic waterfall. Adding module hooks as an afterthought without understanding the ordering invariants breaks the pipeline.

**How to avoid:**
- Define explicit hook slots with documented semantics: `PRE_FILTER` (before fromMe/dedup), `POST_FILTER` (after policy, before LLM), `POST_DISPATCH` (after LLM response sent)
- Modules should NOT be allowed to hook `PRE_FILTER` — that's reserved for system-level guards (fromMe, dedup, shutup)
- Module hooks should receive a `context` object that includes the policy resolution result — modules should augment, not re-implement policy
- Run module hooks in deterministic order (registration order, documented) — non-deterministic ordering creates hard-to-reproduce bugs
- Any exception from a module hook MUST be caught and logged without stopping the pipeline — one bad module should not take down all message processing

**Warning signs:**
- Messages being silently dropped after a module is registered
- Duplicate LLM dispatches (module hook fires AND the main pipeline fires)
- `fromMe` messages reaching module hooks (means hooks are before the fromMe filter)

**Phase to address:** Modules phase (FEATURE-04)

---

### Pitfall 8: Module Isolation Failure — Modules Sharing Mutable State

**What goes wrong:**
Two modules registered for the same group both maintain in-memory state (e.g., a "moderator" module tracks recent messages, an "event planner" module tracks RSVPs). If they share a mutable object passed through the hook context, one module's mutations affect the other. More subtly: if modules are implemented as closures over the same config object, a config update in one module leaks into another.

**Why it happens:**
The plugin is a single Node.js module — everything shares the same process heap. Module isolation requires explicit design (copies, freezes, separate namespaces). Without it, modules naturally share everything.

**How to avoid:**
- Each module receives a COPY of the relevant config slice, not a reference: `Object.freeze(structuredClone(moduleConfig))`
- Module state must be stored in a module-scoped namespace (e.g., `Map<string, ModuleState>` keyed by module ID) — never on a shared singleton
- Module hooks receive an immutable context snapshot — if a module needs to signal state changes, it returns a result object rather than mutating the context
- Use TypeScript `readonly` types on all hook context objects to make mutation a compile error

**Warning signs:**
- Module A behavior changes after installing Module B with no direct interaction between them
- Config update for one module affects another module's behavior
- Test: register two modules that each log their received config — verify the logs show independent values

**Phase to address:** Modules phase (FEATURE-04)

---

### Pitfall 9: Background Sync Full-Resync on Every Startup Causing Startup Lag

**What goes wrong:**
Background sync is implemented to always start from page 1 on gateway startup (full resync). With 500+ contacts, this takes 2-5 minutes during which directory search returns incomplete results. Worse: if the gateway restarts frequently (every code deploy), the sync never finishes before the next restart. The directory is perpetually 20% populated.

**Why it happens:**
"Start from scratch on restart" is the simplest correctness guarantee. Incremental sync requires tracking a cursor (last sync timestamp or a sequence number from WAHA). Developers defer cursor tracking as a "future optimization."

**How to avoid:**
- Store the last successful sync timestamp in SQLite (`sync_state` table or a `_meta` key-value table)
- On startup: if last sync was < 24h ago, run an incremental sync (only new/changed contacts) — if > 24h, run full resync
- Better: use WAHA's contact update webhooks to do real-time incremental updates, with a daily full resync for safety
- Add a "Sync in progress: X/Y contacts" indicator in the Directory tab so the admin can see sync state
- The initial full sync should run at LOW priority (2 calls/second max) so it doesn't impact startup

**Warning signs:**
- Directory tab shows "10 contacts" immediately after startup but grows to 500 contacts over 5 minutes (resync is working but slow)
- Gateway restart frequency matches sync completion time — net result is perpetually incomplete sync

**Phase to address:** Background sync phase (CR-08)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| In-memory TTL tracking (no SQLite) | No schema migration needed | Lost on every restart, spam window after deploy | Never — restarts are too frequent |
| Single mega-transaction for bulk sync writes | Simpler code | SQLITE_BUSY collisions with webhook writes | Never — batch instead |
| Static passcode in config | Easy to configure | Replayable forever, no invalidation | Never — security feature |
| Module hooks as direct pipeline mutations | Fewer abstractions | Ordering bugs, tight coupling | Never in production pipeline |
| Sync loop using shared rate limiter | No extra code | Starves user-facing calls during sync | Only if sync rate is capped at 1 call/2s independently |
| Full resync on every startup | Always correct data | Never finishes if restarts are frequent | Only for initial implementation (v1) with a ticket to add cursor |
| Auto-reply rate limit in memory | Fast, no DB write | Allows spam after restart | Never — add `last_auto_reply_at` column from day one |
| Passcode in plaintext config | Easy to set up | Leaked in logs, git history | Never — hash it |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| WAHA contacts API | Assuming it returns an array | Returns a dict keyed by JID — use `Object.values()` |
| WAHA contacts API | Calling without `store.enabled` | Returns 400 if `config.noweb.store.enabled` is not `True` |
| WAHA pagination | Assuming one call returns all results | Use `limit` + `offset` parameters, paginate until result < limit |
| SQLite WAL mode | Starting multiple long transactions concurrently | Use small batches + async mutex for concurrent writers |
| template literal in monitor.ts | Single backslashes in embedded JS | Double-escape ALL backslashes: `\\w` not `\w`, `\\'` not `\'` |
| Admin panel dynamic content | Using innerHTML for any user-controlled data | Always use textContent — innerHTML is XSS; already hardened in v1.10, do NOT regress |
| OpenClaw config write | Writing to wrong path | Always write to `~/.openclaw/openclaw.json`, never the workspace path |
| OpenClaw config write | Sending bare config fields | POST `/api/admin/config` expects `{"waha": {...}}` wrapper |
| TTL column in SQLite | Storing as ISO string | Store as Unix timestamp (integer milliseconds) — easier range queries |
| WAHA `@lid` JIDs | Treating as opaque identifiers in allowlists | `groupAllowFrom` needs BOTH `@c.us` AND `@lid` for the same person |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full contact list re-render on every name resolution callback | Dashboard Access Control card flickers every few seconds (BUG-02) | Debounce renders, only re-render changed entries | Immediately with 2+ sessions |
| Sync loop using shared rate limiter without priority | Agent send latency > 3s during sync | Separate sync token bucket or explicit throttle | When contact list > 200 entries |
| Expired TTL rows never deleted | SQLite file grows, directory queries slow | Periodic cleanup job + index on `expires_at` | After 1-2 weeks of pairing mode use |
| Directory search querying WAHA API in realtime | Search takes 2-5s, rate-limited | Search local SQLite (CR-08 fix) | At any scale > 50 contacts |
| Module hook array scanned for every inbound message | Linear scan per module per message | Use a Set-based dispatch table keyed by hook slot | When modules > 5 |
| Auto-reply sending to same contact multiple times per restart | Contacts get spam on every deploy | Persist `last_auto_reply_at` in SQLite | On every deploy (multiple times per day) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Static numeric passcode in config | Brute-forced in seconds, replayable forever | Rate-limit attempts (3/30min), rotate daily, or use one-time tokens for `wa.me` links |
| Passcode in plaintext in config/logs | Leaked in git history, log aggregators | Hash it (SHA-256+salt minimum), never log the value |
| No attempt rate limiting on passcode | Brute-force in < 1 minute | Max 3 attempts per JID per 30 minutes, 24h lockout |
| Module hook receiving mutable config reference | One module corrupts another's config | Pass `Object.freeze(structuredClone(config))` to each module |
| Auto-reply canned message with admin names | Leaks admin identity to unauthorized contacts | Only include admin name if the config explicitly opts in; default to generic message |
| TTL grant admin UI without CSRF protection | Unauthorized grant revocations | Admin panel already runs on local network only (127.0.0.1) — acceptable for this deployment |
| innerHTML for module-supplied content | XSS if a module renders user data in HTML | All module-supplied content must go through textContent (same rule as base admin panel) |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Sync progress shown as raw numbers only | Admin doesn't know if sync is stuck | Show "Syncing: 47/500 contacts (last updated 2m ago)" with a stuck detection threshold |
| Pairing mode passcode reset with no warning | Admin changes passcode, existing active grants still work | Rotating the passcode should NOT invalidate already-granted TTL sessions (TTL grants are independent) |
| TTL expiry shown as absolute timestamp | Admin can't tell how much time is left | Show relative time ("Expires in 2h 15m") with a tooltip showing the absolute time |
| Module enable/disable requiring gateway restart | Admin enables a module, nothing happens until restart | Show "Restart required" banner prominently after any module change |
| Bulk sync "Refresh Now" button with no feedback | Admin clicks, nothing visible happens for 10s | Show spinner + "Syncing..." immediately, "Done" with count when complete |
| Dashboard re-renders clearing per-session section scroll position | User scrolls down to a session, name resolution fires, view jumps back | Preserve scroll position across incremental renders |

---

## "Looks Done But Isn't" Checklist

- [ ] **Background sync:** Verify it runs incrementally after the first full sync — check that restarting the gateway does NOT trigger a full resync if last sync was < 24h ago
- [ ] **TTL expiry:** Verify expired entries are actually DELETED from SQLite after the cleanup job runs — not just excluded from queries
- [ ] **TTL expiry:** Verify the admin panel "active grants" count goes to zero after all grants expire, not just becomes invisible
- [ ] **Passcode brute-force protection:** Verify that after 3 wrong attempts, the 4th attempt is silently dropped even if it's the correct passcode
- [ ] **Passcode replay:** Verify that a passcode used in a previous TTL window cannot grant access again (if using one-time tokens)
- [ ] **Auto-reply loop:** Verify the bot does NOT reply to its own canned rejection message — send an auto-reply, then have the bot "see" it via webhook
- [ ] **Auto-reply rate limit persistence:** Verify restarting the gateway does NOT allow a second canned reply to fire for a contact who already received one within 24h
- [ ] **Module hook ordering:** Verify `fromMe: true` messages NEVER reach module hooks — add a test that sends a bot-outbound message and asserts no module hook fired
- [ ] **Module isolation:** Verify updating Module A's config does NOT change Module B's behavior — test by logging received config in both
- [ ] **Sync + webhook concurrency:** Verify that a message received during a bulk sync write does NOT result in a `SQLITE_BUSY` error or a silently dropped contact upsert
- [ ] **Name resolution for @lid JIDs:** Verify that BUG-01 (Access Control card showing raw `@lid` JIDs) is fixed — every `@lid` entry in allowFrom/groupAllowFrom must display a resolved name or be paired with its `@c.us` equivalent
- [ ] **Template literal double-escaping:** Verify any new regex or string in monitor.ts embedded JS uses double-escaped backslashes — run the admin panel in a browser and check browser console for JS syntax errors

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Background sync race → corrupted directory | MEDIUM | Run `POST /api/admin/directory/refresh` to rebuild from WAHA API; add write serialization before next deploy |
| Auto-reply spam loop | HIGH | Immediately deploy a hotfix with `fromMe` guard before the auto-reply logic; check if WAHA session is temporarily banned |
| Passcode brute-forced | MEDIUM | Rotate passcode in admin panel; all existing TTL grants from that passcode remain valid (TTL is independent); add rate limiting in hotfix |
| TTL cleanup never ran → slow directory | LOW | Run `DELETE FROM dm_settings WHERE expires_at IS NOT NULL AND expires_at < ?` manually via SSH; add cleanup job before next deploy |
| Module hook crash taking down message pipeline | HIGH | Wrap ALL module hook invocations in try/catch; re-deploy with the broken module disabled; do NOT let module exceptions propagate |
| Sync draining rate limiter → agent hangs | MEDIUM | Reduce sync rate constant (calls/second) via config hot-patch; long term: separate rate bucket for sync vs user-facing |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Background sync race condition with webhook writes | Background sync phase (CR-08) | Stress test: 200 contacts syncing while 10 messages arrive; zero SQLITE_BUSY in logs |
| Sync draining rate limiter | Background sync phase (CR-08) | Measure send latency during sync; must be < 1s p95 |
| Startup full-resync causing perpetually incomplete directory | Background sync phase (CR-08) | Restart gateway twice in 2 minutes; second restart does NOT trigger full resync |
| Passcode brute-force and replay | Pairing mode phase (FEATURE-01) | 4th wrong attempt is blocked; passcode cannot be reused after TTL expiry |
| TTL zombie grants accumulating | TTL access phase (FEATURE-02) | After 15-minute cleanup window, expired rows are GONE from SQLite (not just hidden) |
| Auto-reply spam loop | Auto-reply phase (FEATURE-03) | Bot sends canned reply; WAHA webhook for it arrives; no second reply fires |
| Auto-reply rate limit lost on restart | Auto-reply phase (FEATURE-03) | Restart gateway mid-24h window; no second canned reply fires |
| Module hook ordering breaks pipeline | Modules phase (FEATURE-04) | `fromMe: true` messages never reach module hooks; duplicate dispatches impossible |
| Module isolation failure | Modules phase (FEATURE-04) | Module A config change does not affect Module B behavior |
| Dashboard re-render flicker (BUG-02) | Dashboard polish phase | Dashboard stable for 60s with no visible flicker after initial load |
| @lid JIDs not resolved in UI (BUG-01) | Name resolution phase | Every `@lid` in allowFrom/groupAllowFrom shows a name or is paired with @c.us entry |
| template literal double-escape | Any monitor.ts change | Open admin panel in browser; zero JS console errors |

---

## Sources

- Codebase analysis: `src/inbound.ts`, `src/directory.ts`, `src/monitor.ts`, `src/send.ts` (direct inspection)
- Project bugs file: `.planning/phases/11-dashboard-sessions-log/bugs.md` — 18 bugs and CRs from human verification
- Project context: `CLAUDE.md` (brittle code patterns, DO NOT CHANGE markers, deployment constraints)
- Project decisions: `.planning/PROJECT.md` (architectural decisions, key constraints)
- Lessons learned: `docs/LESSONS_LEARNED.md` (past regressions, hard-won fixes)
- Previous pitfalls research: `.planning/research/PITFALLS.md` (v1.10 milestone patterns)
- WAHA quirks: CLAUDE.md § "Key WAHA API Quirks" (dict-not-array, @lid dual JID, media URL expiry)
- SQLite concurrency: WAL mode documentation — readers don't block writers, but only one writer at a time
- Passcode security: OWASP Authentication Cheat Sheet — rate limiting, hashing, one-time token patterns

---
*Pitfalls research for: v1.11 additions to WAHA OpenClaw plugin*
*Researched: 2026-03-17*
