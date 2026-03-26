# Pitfalls Research

**Domain:** Adding human mimicry features (time-of-day gates, hourly caps, Claude Code integration) to existing brittle WhatsApp plugin
**Researched:** 2026-03-26
**Confidence:** HIGH (codebase analysis, established patterns, specific integration points verified)

---

## Critical Pitfalls

### Pitfall 1: Hourly Cap Fights the Existing Token Bucket

**What goes wrong:**
The existing `TokenBucket` in `http-client.ts` is a per-second throughput limiter (20-burst, 15 tokens/sec). A new hourly cap is a per-hour count limiter. If you place the hourly check AFTER the token bucket `acquire()`, a burst of 30 messages can exhaust the hourly cap in 2 seconds while the token bucket happily allows it. If you place it BEFORE, you block the token bucket queue drain, causing silent hung requests (promises that never resolve because `release()` was never called).

**Why it happens:**
Two independent rate-limiting layers with different time windows. Developers assume they compose cleanly, but the token bucket drains an async queue — if you gate on hourly cap inside `acquire()`, you stall the drainer. If you gate outside, you can't block in-flight token bucket requests.

**How to avoid:**
Keep the hourly cap as a hard check at the `sendWahaText` / `callWahaApi` entry point, BEFORE the token bucket acquires. Throw an error rather than queuing. The token bucket is for burst shaping, not for deferring sends across hours. A rejected send should surface to the caller with a meaningful error ("hourly cap reached, try again at HH:MM") rather than silently hanging. Never await on the hourly cap — check and throw or pass.

**Warning signs:**
- Send requests that hang for >30 seconds when hourly cap is nearly full
- Token bucket queue depth climbing with no corresponding outbound traffic
- `acquire()` never logging "queue full" even though hourly cap is exceeded

**Phase to address:**
Phase: Time-of-Day Gates & Hourly Caps (core implementation phase)

---

### Pitfall 2: Message Loss on Restart When Queuing Gated Sends

**What goes wrong:**
If the time-of-day gate queues blocked messages in memory (e.g., "send this at 7am"), a gateway restart wipes the queue. The agent doesn't know the message was never sent. Duplicate send on retry is worse than loss — double-messages to real humans are visually jarring.

**Why it happens:**
The plugin has no persisted outbound queue. The inbound queue (`inbound-queue.ts`) is in-memory and explicitly documented as acceptable to lose on restart (webhook flood protection only). Applying the same in-memory approach to outbound queuing is wrong because the semantics differ — inbound drops are acceptable, outbound drops are silent message loss.

**How to avoid:**
Do NOT queue rejected messages across restarts. Choose one of two strategies:
1. **Reject, don't queue**: When a send is gated (wrong time window or hourly cap), throw synchronously. The gateway will retry, which is correct — it's designed for transient failures. This is the simpler and safer approach for v1.20.
2. **Persist queue in SQLite**: Only if deferred delivery is required. Use the existing `analytics.ts` SQLite infrastructure. Add a `send_queue` table. Re-drain on startup. This is complex and not needed for the initial feature.

The `MutationDedup` class in `http-client.ts` already prevents gateway retry double-sends within a 60s TTL — lean on this rather than building a queue.

**Warning signs:**
- `setTimeout` used to hold a send until the gate opens
- Any in-memory array that accumulates pending outbound sends
- No SQLite persistence for queued sends but restart recovery is implied

**Phase to address:**
Phase: Time-of-Day Gates & Hourly Caps (core implementation phase) — establish reject-don't-queue as the contract

---

### Pitfall 3: Timezone Hell in Time-of-Day Gate

**What goes wrong:**
The server (hpg6) runs UTC. `new Date().getHours()` returns UTC hours. A 7am-1am gate configured in Israel Standard Time (UTC+3) will fire 3 hours late — gate opens at 10:00 UTC instead of 07:00 UTC, closes at 04:00 UTC instead of 01:00 UTC. Cross-midnight windows (`7am-1am` spans two calendar days) require modular arithmetic that naive `startHour <= currentHour <= endHour` breaks entirely.

**Why it happens:**
Node.js `Date` has no timezone awareness without an explicit IANA timezone string and `Intl.DateTimeFormat`. Developers use `getHours()` assuming local time, but Node on a Linux server is almost always UTC.

**How to avoid:**
- Store `timezone` in config alongside `sendWindowStart`/`sendWindowEnd` (e.g., `timezone: "Asia/Jerusalem"`).
- Use `Intl.DateTimeFormat` with `timeZone` to extract the local hour: `new Intl.DateTimeFormat('en', { timeZone, hour: 'numeric', hour12: false }).format(now)`.
- Handle the cross-midnight case explicitly: if `startHour > endHour` (e.g., `7 > 1` is false, but `22 > 6` is true), the window wraps midnight. Check: `currentHour >= startHour || currentHour < endHour`.
- Default timezone to `"Asia/Jerusalem"` (the primary user's timezone) — not UTC, not server local.
- Test with hours 0, 1, 6, 7, 13, 22, 23 in the configured timezone.

**Warning signs:**
- `new Date().getHours()` anywhere in the gate logic without a timezone conversion
- Config that stores only `startHour` and `endHour` with no `timezone` field
- End-to-end tests running correctly on a developer machine (Windows local time) but failing on hpg6 (UTC)

**Phase to address:**
Phase: Time-of-Day Gates & Hourly Caps (core implementation phase)

---

### Pitfall 4: Config Schema Breaks Zod Validation on Existing Configs

**What goes wrong:**
`validateWahaConfig` in `config-schema.ts` uses `WahaConfigSchema` which ends with `.strict()`. Adding new fields to `WahaAccountSchemaBase` adds them to the strict schema. If the existing `openclaw.json` on hpg6 has fields from OTHER subsystems (it does — see the strip-unknown-keys comment in `validateWahaConfig`), the strip logic in `validateWahaConfig` already handles this. However, if new fields are added with default values but the schema runs in strict mode on the raw config object from disk, the strip happens BEFORE validation, so new fields with defaults will resolve correctly. The real risk is if new fields are optional but the Zod type infers them as `required` due to a missing `.optional()` — causing every config save from the admin panel to fail validation until the new keys are present.

**Why it happens:**
`WahaAccountSchemaBase` uses `.strict()` which rejects unknown keys. The `validateWahaConfig` function strips unknown keys before validating, but this only helps for keys unknown to the schema, not for new required keys missing from existing configs. A new field added as `z.number().min(0)` without `.optional().default(X)` will cause all existing configs to fail validation immediately after deploy.

**How to avoid:**
Every new config field MUST use `.optional().default(value)`. Never add a required field to `WahaAccountSchemaBase`. Test by running `validateWahaConfig` against the current production config JSON (copy from hpg6) before deploying. Add the new field names to the `knownKeys` set in `validateWahaConfig` so they aren't stripped.

**Warning signs:**
- New config field in schema without `.optional()`
- Admin panel config save returning 400 after deploy
- Gateway logs showing `validation_failed` immediately on startup

**Phase to address:**
Phase: Config Schema Extension (any phase that adds new config keys)

---

### Pitfall 5: Claude Code Skill Bypasses the Entire Plugin

**What goes wrong:**
The `whatsapp-messenger` Claude Code skill calls the WAHA API directly via `curl` or HTTP (it calls `sendText` endpoint directly on `http://127.0.0.1:3004`). It does NOT go through `sendWahaText` in the plugin, does NOT go through `callWahaApi`, does NOT hit the token bucket or any plugin-level rate limiter. This is explicitly documented in the milestone context. Adding hourly caps to the plugin does nothing to limit Claude Code sends. If Claude Code sends 200 messages via the skill in an hour and the plugin caps the agent at 30, Meta sees 230 messages from the session — cap is meaningless.

**Why it happens:**
The Claude Code skill was designed for direct API access for simplicity (no gateway). It predates the mimicry system. There is no intercept point at the WAHA API level.

**How to avoid:**
The only integration path is: (a) make the Claude Code skill call a new plugin HTTP endpoint (e.g., `POST /api/admin/send` that enforces all mimicry logic), or (b) add a WAHA-level proxy layer (complex, fragile). Option (a) is the correct approach. The admin panel server in `monitor.ts` already runs an HTTP server on port 8050 — add a `POST /api/admin/proxy-send` route that runs through time gate + hourly cap + token bucket + typing delay before calling WAHA. Update the `whatsapp-messenger` skill to hit this endpoint instead of WAHA directly. This is the entire "Claude Code mimicry integration" phase.

**Warning signs:**
- Hourly cap implemented in plugin but Claude Code sends not counted in the same bucket
- `whatsapp-messenger` skill still contains direct `curl http://127.0.0.1:3004/api/sendText` calls
- No new route added to `monitor.ts`

**Phase to address:**
Phase: Claude Code Mimicry Integration (dedicated phase, after time gate + cap are working)

---

### Pitfall 6: Progressive Limits State Not Persisting Across Restarts

**What goes wrong:**
Progressive limits track "account maturity" — a new account gets 10 msgs/hour, after 30 days gets 30, after 90 days gets 50. If this maturity state is stored in memory, every gateway restart resets it. The account appears "new" again. Worse, if the maturity calculation uses the plugin startup timestamp as "account age start", the account never matures because restarts keep resetting the clock.

**Why it happens:**
In-memory state is the default pattern in this codebase (the inbound queue, SSE clients, rate limiter state). It works for ephemeral state but not for maturity tracking.

**How to avoid:**
Store the "account first seen" timestamp in the existing SQLite database (either `DirectoryDb` or `AnalyticsDb`). A single `account_metadata` table with `(session_id TEXT PRIMARY KEY, first_seen_at INTEGER, message_count_total INTEGER)` is sufficient. Do not recalculate maturity from restart time — read it from SQLite on startup. The hourly message count should be stored as a rolling window in SQLite with a timestamp, not as an in-memory counter, so restarts don't lose count accuracy.

**Warning signs:**
- Maturity stage stored as a module-level variable initialized at startup
- `Date.now() - pluginStartTime` used anywhere in maturity calculation
- No SQLite migration adding maturity state tables

**Phase to address:**
Phase: Hourly Caps & Progressive Limits (core implementation phase)

---

### Pitfall 7: Hourly Count Reset at Wrong Boundary

**What goes wrong:**
"Hourly cap" is ambiguous: does it reset at the top of the clock hour (00:00, 01:00, 02:00) or is it a rolling 60-minute window? If it resets at the top of the hour, the agent can send 30 messages at 12:59 and 30 more at 13:00 — 60 in 2 minutes, which looks automated. If it's a rolling window, implementation is more complex but more accurate to human behavior.

**Why it happens:**
"Hourly cap" defaults to "reset at top of hour" in naive implementations because `Math.floor(Date.now() / 3_600_000)` gives a bucket key. Rolling windows require storing timestamps.

**How to avoid:**
Use a rolling 60-minute window. Store each outbound message's timestamp in a SQLite table. Count of rows where `sent_at > (now - 3_600_000)` is the current hourly usage. This is accurate and restart-safe. The query is fast on a small table (max ~50 rows if cap is enforced). Prune rows older than 2 hours periodically to keep the table bounded.

**Warning signs:**
- Hourly bucket counter reset with `setInterval` at 60-minute boundaries
- Counter stored as a single integer in memory
- No per-timestamp record of outbound sends

**Phase to address:**
Phase: Hourly Caps & Progressive Limits

---

### Pitfall 8: Testing Time-Based Logic Is Broken Without Dependency Injection

**What goes wrong:**
`sendWahaText` calls `Date.now()` directly. Time gate checks call `new Date().getHours()`. Tests that run in CI run at a fixed moment in real time — if the gate is configured for 7am-1am and tests run at 2am UTC on a CI server, all gated send tests fail. You can't mock `Date.now()` in vitest without either global mocking (which leaks between tests) or dependency injection.

**Why it happens:**
Inline `Date.now()` calls are the path of least resistance. The existing codebase already does this throughout (`http-client.ts`, `dedup.ts`, `policy-cache.ts`). v1.20 adds time-sensitive logic that changes behavior based on the current clock — making the problem much more acute.

**How to avoid:**
Extract a `now: () => number` parameter or a `clock: { now: () => number; getLocalHour: (tz: string) => number }` injectable. The gate enforcement function should accept `now` as a parameter with `Date.now()` as the default: `function isWithinSendWindow(config, now = Date.now()): boolean`. Tests pass a fixed timestamp. This is the pure-function extraction pattern already established in `mentions.ts` for testability. The hourly count query also needs a `now` parameter for the rolling window boundary calculation.

**Warning signs:**
- Tests using `vi.useFakeTimers()` globally (leaks state across test files in vitest)
- Gate logic test that always passes at the same real-world hour range
- No `now` parameter on the gate or cap enforcement functions

**Phase to address:**
Phase: Testing (dedicated test phase, but the injectable pattern must be built into the implementation phase)

---

### Pitfall 9: Per-Session vs. Per-Account Cap Confusion

**What goes wrong:**
The plugin has two WAHA sessions: `3cf11776_logan` (bot) and `3cf11776_omer` (human). Meta tracks ban risk per WhatsApp account (phone number), not per plugin session name. If the hourly cap is enforced per `accountId` (plugin concept) but Claude Code sends use `session` directly, the two caps are separate and the combined outbound volume can be double the safe limit.

**Why it happens:**
The plugin's multi-account architecture separates `accountId` (plugin config key) from `session` (WAHA session name). Rate limiting was designed around `accountId`. Claude Code sends specify the WAHA `session` directly and bypass `accountId` routing entirely.

**How to avoid:**
The hourly cap must be keyed by the underlying WhatsApp phone number (or WAHA session name), not by `accountId`. When the Claude Code mimicry endpoint in `monitor.ts` receives a send request specifying session `3cf11776_omer`, it should use the same hourly cap bucket as the plugin's `omer` account. Use the WAHA session name as the cap key, not `accountId`. The session name is stable and unique per phone number.

**Warning signs:**
- Hourly cap keyed by `accountId` without mapping to a WAHA session name
- Separate cap buckets for Logan sends vs. Omer sends when they share a phone-level risk
- Claude Code proxy route accepting a `session` parameter but looking up cap by `accountId`

**Phase to address:**
Phase: Claude Code Mimicry Integration

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| In-memory hourly counter | Simple, no SQLite migration | Resets on restart, counts missed after crash | Never — maturity tracking requires persistence |
| Top-of-hour bucket reset | Trivial implementation | Burst window exploit (2x cap at hour boundary) | Never — rolling window is only slightly more code |
| Hard-code timezone to "Asia/Jerusalem" without config | Zero config complexity | Breaks for any user in different timezone | Only acceptable as a default, not as the sole behavior |
| Gate sends at plugin level only, ignore Claude Code skill | Only one system to change | Cap is meaningless if Claude Code bypasses it | Never for v1.20 — both paths must be gated |
| Throw generic "rate limited" on cap exceeded | Simple error path | Agent retries immediately, hammers cap check | Never — include "retry after" timestamp in error |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Existing `TokenBucket` + new hourly cap | Check hourly cap inside `acquire()` — hangs drainer | Check hourly cap before calling `acquire()`, throw if exceeded |
| Claude Code skill + mimicry system | Assume plugin sends cover all outbound | Add `POST /api/admin/proxy-send` to `monitor.ts`; update skill to call it |
| Config schema + new fields | Add field without `.optional().default(X)` | Every new field must have `.optional().default(X)` or validation breaks on existing configs |
| SQLite hourly count + rolling window | Use `COUNT(*)` on entire table | Add `WHERE sent_at > ?` with `now - 3_600_000` to bound the count to 60-min window |
| Zod `knownKeys` set in `validateWahaConfig` | Forget to add new field names to `knownKeys` | New fields get stripped before validation if not added to `knownKeys` set |
| `MutationDedup` + gated sends | Gated-then-retried send hits dedup TTL | Dedup key includes timestamp-of-request — if retry comes after cap window opens, key will differ and send proceeds correctly; no action needed |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Rolling window query on unbounded table | Slow hourly cap check after weeks of sends | Prune rows older than 2 hours in the same transaction as the insert | After ~10k rows (~200 hours of capped operation) |
| Timezone conversion via `Intl.DateTimeFormat` on every send | CPU spike on high-volume sends | Cache the resolved local hour with a 1-minute TTL (not per-call) | Not a real concern at 30-50 msgs/hour, but worth noting |
| SQLite WAL + high-frequency writes for hourly count | Write contention with `DirectoryDb` | Use the same WAL-mode SQLite connection with `PRAGMA journal_mode=WAL` already set | Not a concern at this message volume |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Proxy-send endpoint in `monitor.ts` has no auth check | Any process on hpg6 can send WhatsApp messages through Omer's session | Apply the existing `requireAuth` middleware (adminToken check) to the new `/api/admin/proxy-send` route |
| Config stores send window as string "07:00-01:00" without validation | Malformed config causes gate to fail open (always allows send) | Validate hours as integers 0-23 in Zod schema; gate should fail CLOSED (block send) on parse error |
| Hourly cap bypass via direct WAHA API when plugin rejects | Attacker or misbehaving agent calls WAHA directly | Can't prevent at plugin level — WAHA API key is in config and visible to all processes on hpg6; not a concern for this threat model |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Gate rejects send with no info about when it will be allowed | Agent (and user) can't tell when to retry | Error message must include "send window opens at HH:MM {timezone}" |
| Hourly cap shows current count but not the reset time | User sees "28/30 used" with no ETA | Admin panel cap widget shows count + "resets in X minutes" (oldest send timestamp + 60min) |
| Progressive limit stage changes silently | Admin can't tell why the cap changed | Log a structured event when maturity stage advances (stored in analytics SQLite) |
| New config fields appear in admin panel with no labels | User doesn't know what "sendWindowStart" means | Use descriptive labels: "Earliest send time (24h)" with timezone selector |

---

## "Looks Done But Isn't" Checklist

- [ ] **Time gate:** Tested cross-midnight window (e.g., 22:00-06:00 config) — verify `22 <= currentHour || currentHour < 6` logic, not `22 <= currentHour <= 6`
- [ ] **Timezone:** Gate uses `Intl.DateTimeFormat` with configured `timezone`, not `new Date().getHours()` (UTC)
- [ ] **Claude Code bypass:** Verified that `whatsapp-messenger` skill has been updated to call proxy endpoint, not WAHA directly — check by sending a test message via the skill at 2am (outside window) and confirming it is blocked
- [ ] **Config migration:** Ran `validateWahaConfig` against the actual production `openclaw.json` before deploying — confirmed no validation errors
- [ ] **Cap persistence:** Restarted the gateway during an active send session — confirmed hourly count was read from SQLite, not reset to 0
- [ ] **Cap key:** Confirmed both Logan (bot) and Omer (Claude Code) sends share the same cap bucket keyed by WAHA session name
- [ ] **Token bucket interaction:** Confirmed hourly cap check happens BEFORE `acquire()` — not inside the token bucket queue drain
- [ ] **Error messages:** Confirmed cap-exceeded error includes retry-after timestamp, not a generic "rate limited" string
- [ ] **Admin panel:** Send window settings and cap status visible in React admin panel with correct shadcn/ui components (not raw HTML)
- [ ] **Progressive limits:** Confirmed maturity stage stored in SQLite, not computed from `Date.now() - pluginStartTime`

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Config validation breaks on deploy | LOW | Roll back `WahaAccountSchemaBase` change, re-add `.optional().default()` wrappers, redeploy both hpg6 locations |
| Message loss from in-memory queue on restart | MEDIUM | No recovery from lost messages; prevent by using reject-not-queue strategy; if already built as queue, migrate to SQLite store |
| Timezone bug sends at wrong hours | LOW | Add `timezone` config field with default, fix gate logic, redeploy |
| Claude Code bypass not caught until after deploy | MEDIUM | Update skill to point to proxy endpoint; retest by sending at 2am in IST |
| Hourly cap resets on restart (in-memory counter) | LOW | Migrate counter to SQLite rolling window table; one migration script |
| Token bucket hangs from cap check inside `acquire()` | HIGH | Restart gateway immediately; move cap check to before `acquire()` call |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Token bucket vs hourly cap race condition | Phase: Time-of-Day Gates & Hourly Caps | Unit test: send 30 msgs, verify 31st throws before `acquire()` is called |
| Message loss on restart | Phase: Time-of-Day Gates & Hourly Caps | Restart gateway mid-session, verify no queued sends are silently dropped |
| Timezone bug | Phase: Time-of-Day Gates & Hourly Caps | Test with `timezone: "Asia/Jerusalem"` on UTC server, verify IST hour is used |
| Config schema breaks existing configs | Phase: Config Schema Extension | Run `validateWahaConfig` against production `openclaw.json` before every deploy |
| Claude Code bypass | Phase: Claude Code Mimicry Integration | Send via skill at 2am IST, confirm blocked; send at noon, confirm allowed |
| Progressive limits not persisted | Phase: Hourly Caps & Progressive Limits | Restart gateway, confirm maturity stage unchanged and hourly count correct |
| Hourly reset at top-of-hour vs rolling window | Phase: Hourly Caps & Progressive Limits | Send 30 msgs at :59, verify 31st blocked even after clock rolls to next hour |
| Testability of time logic | Phase: Core Implementation | All gate/cap functions accept `now` parameter; CI tests pass with injected timestamps |
| Per-session vs per-account cap key | Phase: Claude Code Mimicry Integration | Confirm Logan sends and Omer sends share cap bucket in SQLite |

---

## Sources

- Codebase: `src/http-client.ts` — `TokenBucket` implementation, `MutationDedup`, drain loop structure
- Codebase: `src/rate-limiter.ts` — `RateLimiter` class (concurrent + delay limiter, separate from token bucket)
- Codebase: `src/config-schema.ts` — `WahaAccountSchemaBase` `.strict()` schema, `validateWahaConfig` strip-then-validate pattern, `knownKeys` set
- Codebase: `src/send.ts` — `sendWahaText` entry point showing policy/mute checks before WAHA API call
- Codebase: `src/inbound-queue.ts` — in-memory queue pattern (acceptable for inbound, not for outbound)
- Codebase: `.planning/PROJECT.md` — v1.20 requirements, multi-session context, two-location deploy constraints
- Memory: `project_v1_20_human_mimicry.md` — original feature intent, bypass concern explicitly noted
- Prior art: `docs/LESSONS_LEARNED.md` (existing lessons from prior milestones about SQLite persistence, jiti cache, deploy pitfalls)

---
*Pitfalls research for: v1.20 Human Mimicry Hardening — time-of-day gates, hourly caps, Claude Code integration*
*Researched: 2026-03-26*
