# Phase 56: Adaptive Activity Patterns -- Research

**Researched:** 2026-03-27
**Domain:** SQLite activity profiling, background task scheduling, per-chat gate config adaptation
**Confidence:** HIGH

## Summary

Phase 56 adds a background learning layer to the mimicry gate system. It scans WAHA chat message history to build per-chat hour-of-day histograms, stores derived peak windows in a new chat_activity_profiles SQLite table, and feeds those windows into the existing resolveGateConfig() cascade as TargetGateOverride values. No new enforcement logic is needed -- the gate already supports per-target hour overrides.

All patterns needed for this phase already exist in the codebase. The background scanner follows the exact startDirectorySync() setTimeout-chain pattern. The gate override path is already wired in enforceMimicry() via getDmSettings() -> targetGateOverride. The WAHA messages API (getWahaChatMessages) already supports pagination. The only new pieces are: a new SQLite table in DirectoryDb, a new background scanner module (src/activity-scanner.ts), and a lookup hook in enforceMimicry() that reads activity profiles before resolving gate config.

**Primary recommendation:** Add chat_activity_profiles table to DirectoryDb._createSchema() (migration-safe), implement src/activity-scanner.ts following sync.ts patterns, and enhance enforceMimicry() to check activity profiles as a second override source for targetGateOverride.
---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Activity Analysis Strategy**
- Peak hours detection: Hour histogram -- count messages per hour-of-day over 7 days, top 60% of hours by volume become the send window
- Scan depth: Last 500 messages per chat (paginated batches of 100), stop if older than 7 days
- Which chats: All chats with >= 20 messages in last 7 days -- only profile active conversations
- Storage: `chat_activity_profiles` SQLite table with derived `peak_start_hour` and `peak_end_hour` columns -- simple override for existing gate config

**Scheduling and Integration**
- Rescan frequency: Weekly (every 7 days) via setTimeout chain pattern from sync.ts
- When to run: During off-peak hours only (outside the configured send window) -- matches success criterion #2
- Per-chat override mechanism: Feed `peak_start_hour`/`peak_end_hour` as `TargetGateOverride` into existing `resolveGateConfig()` cascade
- Fallback: Use global/session gate config unchanged when no profile exists -- matches success criterion #4

### Claude's Discretion
- SQLite table schema details (columns, indexes)
- Histogram analysis algorithm internals
- Background task error handling and retry logic
- How to determine "off-peak" from config for scan scheduling

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADAPT-01 | System scans group/contact message history (last 7 days) to build per-chat activity profiles | `getWahaChatMessages()` + hour histogram algorithm in `activity-scanner.ts` |
| ADAPT-02 | Activity profiles stored in SQLite table for reuse, rescanned weekly | `chat_activity_profiles` table in `DirectoryDb`, weekly setTimeout chain |
| ADAPT-03 | Scanning runs incrementally -- small portion per tick, during off-peak hours only | Off-peak guard using `checkTimeOfDay()`, batch-per-tick pattern, AbortSignal |
| ADAPT-04 | Time gates adapt per-group/contact based on activity profile | Feed `peak_start_hour`/`peak_end_hour` as `TargetGateOverride` into `resolveGateConfig()` in `enforceMimicry()` |
| ADAPT-05 | Fallback to global/session default gate when no activity profile exists | `resolveGateConfig()` with `null` targetOverride already falls back to global/session -- pass `null` when no profile |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | already installed | SQLite reads/writes for activity profiles | Already used by DirectoryDb and MimicryDb; synchronous API fits background worker pattern |

No new npm dependencies. Everything builds on existing project infrastructure.

---

## Architecture Patterns

### Recommended Project Structure

New file:
```
src/
+-- activity-scanner.ts    # Background scanner: setTimeout chain, histogram, DB writes
```

Modified files:
```
src/
+-- directory.ts           # Add chat_activity_profiles table + ActivityProfile CRUD
+-- mimicry-enforcer.ts    # Lookup activity profile -> inject as targetGateOverride
+-- channel.ts             # Start activity scanner alongside directory sync
```

### Pattern 1: SQLite Table -- chat_activity_profiles

**What:** Stores per-chat computed peak window (start/end hours). One row per JID. Overwritten on rescan. No FK to contacts (soft reference -- scanner may see chats before directory sync imports them).

**Recommended schema:**
```sql
CREATE TABLE IF NOT EXISTS chat_activity_profiles (
  jid TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  peak_start_hour INTEGER NOT NULL,
  peak_end_hour INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  scanned_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cap_account_scanned
  ON chat_activity_profiles (account_id, scanned_at);
```

**Migration-safe addition** (follow existing UX-03 pattern in directory.ts):
```typescript
try {
  this.db.exec(`CREATE TABLE IF NOT EXISTS chat_activity_profiles (...); CREATE INDEX IF NOT EXISTS idx_cap_account_scanned ON chat_activity_profiles (account_id, scanned_at);`);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes('already exists')) throw err;
}
```

### Pattern 2: Background Scanner -- setTimeout Chain

Follows `startDirectorySync()` in `sync.ts` exactly.

**Key invariants:**
- setTimeout chain, NOT setInterval -- prevents pile-up on slow WAHA
- `.unref()` on all timers -- does not block shutdown
- AbortSignal check at tick() entry and between batches
- State object updated in-place (status, lastScanAt, lastError)
- First tick delayed ~30s after startup

**Off-peak guard (Claude's discretion -- recommended):**
```typescript
function isOffPeak(cfg: CoreConfig, session: string, now: number): boolean {
  const wahaConfig = (cfg as any)?.channels?.waha ?? cfg;
  if (!wahaConfig?.sendGate?.enabled) return true; // gate disabled = scan anytime
  const gateConfig = resolveGateConfig(session, wahaConfig, null);
  if (!gateConfig.enabled) return true;
  // Off-peak = gate would block sends right now (outside send window)
  const result = checkTimeOfDay(gateConfig, now);
  return !result.allowed;
}
```

**Incremental batch processing (ADAPT-03):**
Each tick processes 10 chats with 500ms delays between scans.
A module-level `scanCursors` Map tracks the offset per accountId across ticks.
When batch.length === 0, cursor resets to 0 (full pass complete).

**Tick skeleton:**
```typescript
async function tick(opts: ScannerOptions, state: ScannerState): Promise<void> {
  if (opts.abortSignal.aborted) return;
  const now = Date.now();

  if (!isOffPeak(opts.config, opts.session, now)) {
    log.debug("activity-scanner: on-peak, skipping", { accountId: opts.accountId });
    scheduleNext(opts, state, 30 * 60_000); // retry in 30 min
    return;
  }

  state.status = "running";
  try {
    await runScanBatch(opts, state, now);
    state.lastScanAt = Date.now();
    state.lastError = null;
  } catch (err: unknown) {
    state.lastError = err instanceof Error ? err.message : String(err);
    log.warn("activity-scanner: batch failed", { accountId: opts.accountId, error: state.lastError });
  }
  state.status = "idle";

  scheduleNext(opts, state, 7 * 24 * 3600_000); // weekly rescan
}
```

### Pattern 3: Histogram Analysis

**Algorithm (Claude's discretion area -- recommended):**

Given message timestamps (milliseconds), compute peak hours using cumulative top-60% volume.

Steps:
1. Build hour histogram[0..23] using Intl.DateTimeFormat.formatToParts (same as extractHour() in mimicry-gate.ts)
2. Sort hours by count descending
3. Include hours until their cumulative message count >= 60% of total
4. Find min/max of included hours -> startHour / endHour + 1

Sparse guard: return null if timestamps.length < 20.

Note on bimodal activity: if activity peaks at 9am and 9pm, window spans 9am-10pm. Intentionally permissive. Document in code comments.

### Pattern 4: enforceMimicry Integration Point

**Location:** src/mimicry-enforcer.ts, Step 2 (after existing getDmSettings call)

```typescript
// ADAPT-04: If no manual gate override, check activity profile
// ADAPT-05: If no profile, targetGateOverride stays null -> resolveGateConfig
//           falls back to global/session config unchanged (no error).
if (!targetGateOverride) {
  const profile = dirDb.getActivityProfile(chatId);
  if (profile) {
    targetGateOverride = {
      startHour: profile.peakStartHour,
      endHour: profile.peakEndHour,
    };
  }
}
```

Manual `sendGateOverride` from admin panel takes precedence. Profile only fills the gap when no explicit override exists.

### Pattern 5: DirectoryDb CRUD Methods

New type:
```typescript
export type ActivityProfile = {
  jid: string;
  accountId: string;
  peakStartHour: number;
  peakEndHour: number;
  messageCount: number;
  scannedAt: number;
};
```

New prepared statements (follow MimicryDb._prepareStatements() pattern):
```typescript
// Upsert -- called by scanner
"INSERT INTO chat_activity_profiles (jid, account_id, peak_start_hour, peak_end_hour, message_count, scanned_at) " +
"VALUES (?, ?, ?, ?, ?, ?) " +
"ON CONFLICT(jid) DO UPDATE SET peak_start_hour=excluded.peak_start_hour, " +
"peak_end_hour=excluded.peak_end_hour, message_count=excluded.message_count, scanned_at=excluded.scanned_at"

// Get -- called by enforceMimicry
"SELECT * FROM chat_activity_profiles WHERE jid = ?"

// List chats needing rescan -- used by scanner batch loop
"SELECT c.jid FROM contacts c " +
"LEFT JOIN chat_activity_profiles p ON c.jid = p.jid AND p.account_id = ? " +
"WHERE (p.scanned_at IS NULL OR p.scanned_at < ?) " +
"AND c.last_message_at > ? " +
"ORDER BY c.last_message_at DESC LIMIT 200"
// Params: (accountId, now - staleMs, now - 7days)
```

### Pattern 6: Scanner Startup in channel.ts

After `startDirectorySync()` at channel.ts ~line 1129:
```typescript
// Phase 56 (ADAPT-01, ADAPT-02, ADAPT-03): Background activity profile scanner.
// Uses same abortSignal -- stops when account logs out.
// setTimeout chain -- does not block shutdown (.unref() on all timers).
// DO NOT REMOVE -- activity profiles are how per-chat gate adaptation works.
if (ctx.abortSignal) {
  startActivityScanner({
    accountId: account.accountId,
    config: ctx.cfg as CoreConfig,
    session: account.accountId, // verify: may be sessionName field on account object
    abortSignal: ctx.abortSignal,
  });
}
```

### Anti-Patterns to Avoid

- **setInterval:** Use setTimeout chain. Prevents pile-up.
- **Scanning all chats in one tick:** Batch of 10 with 500ms delays.
- **Overwriting manual gate overrides:** Check `dmSettings.sendGateOverride` first; apply profile only when null.
- **Scanning during peak hours:** `isOffPeak()` check at each tick entry.
- **Fetching all 500 messages at once:** Paginate limit=100, offset += 100.
- **FK constraint on chat_activity_profiles.jid:** No FK to contacts. Soft reference only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timezone-aware hour extraction | Custom date math | Intl.DateTimeFormat.formatToParts() from extractHour() in mimicry-gate.ts | Already implemented and tested |
| Per-chat gate config cascade | Custom merge logic | resolveGateConfig(session, cfg, targetOverride) | Handles 3-level merge + cross-midnight windows |
| SQLite setup | Raw Database() calls | Follow DirectoryDb/MimicryDb constructor pattern | WAL + busy_timeout + checkpoint is established safe pattern |
| Background loop | setInterval | setTimeout chain with .unref() from sync.ts | Prevents timer pile-up on slow WAHA |
| WAHA message pagination | Custom cursor logic | getWahaChatMessages({ limit: 100, offset: N }) | Already implemented in send.ts |

**Key insight:** This phase is almost entirely integration work. All hard problems (gate logic, SQLite, background tasks, timezone handling) are already solved in the codebase.
---

## Common Pitfalls

### Pitfall 1: Scanning During Peak Hours
**What goes wrong:** Scanner consumes WAHA API rate budget needed for real sends.
**Why it happens:** Off-peak guard missing or gate disabled.
**How to avoid:** Use checkTimeOfDay() with session gate config. If gateResult.allowed is true, skip tick and reschedule for 30 minutes.
**Warning signs:** High WAHA API call volume in gateway logs during business hours.

### Pitfall 2: WAHA Timestamp Format (Unix Seconds vs Milliseconds)
**What goes wrong:** Timestamps treated as milliseconds when WAHA returns Unix seconds. All histogram hours land at hour 0.
**Why it happens:** WAHA message objects return timestamp as Unix epoch seconds (integer), not milliseconds.
**How to avoid:** Always multiply by 1000. Normalize field: const tsMs = (typeof msg.timestamp === "number" ? msg.timestamp : Number(msg.t ?? 0)) * 1000.
**Warning signs:** Histogram shows all messages at hour 0 or very narrow incorrect windows.

### Pitfall 3: Messages Returned Newest-First
**What goes wrong:** Pagination stops too early or misses old messages.
**How to avoid:** Paginate with offset += 100. Stop when: (a) empty response, (b) oldest message in batch older than 7 days, (c) offset >= 500.

### Pitfall 4: Activity Profile Overriding Manual Admin Setting
**What goes wrong:** Learned profile silently replaces manual sendGateOverride set via admin panel.
**How to avoid:** Check dmSettings.sendGateOverride first. Only apply profile when targetGateOverride is null.
**Warning signs:** Admin panel shows a gate override, but actual send behavior differs.

### Pitfall 5: Sparse Data Producing Degenerate Windows
**What goes wrong:** Chat with 2-3 messages produces a 1-hour window blocking all reasonable send times.
**How to avoid:** Only write profile when >= 20 messages found. Guard in computePeakWindow: return null when timestamps.length < 20.
**Warning signs:** Profiles written with message_count < 20.

### Pitfall 6: jiti Cache Stale After Deploy
**What goes wrong:** New activity-scanner.ts never loads after deploy.
**How to avoid:** Always rm -rf /tmp/jiti/ + restart gateway after deploying new .ts files.

### Pitfall 7: First Run Processes All Chats
**What goes wrong:** No profiles on first run -- all contacts qualify. Extremely long first tick.
**How to avoid:** The batch cursor pattern (BATCH_SIZE=10, offset tracked across ticks) handles this naturally. First full pass takes many ticks -- acceptable.
---

## Code Examples

### Pagination Loop for Message History Scan
Source: send.ts getWahaChatMessages signature + CONTEXT.md scan depth decision
```typescript
const MAX_MESSAGES = 500;
const PAGE_SIZE = 100;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchRecentTimestamps(
  chatId: string, cfg: CoreConfig, accountId: string, now: number
): Promise<number[]> {
  const cutoff = now - SEVEN_DAYS_MS;
  const timestamps: number[] = [];
  let offset = 0;

  while (offset < MAX_MESSAGES) {
    const messages = await getWahaChatMessages({
      cfg, chatId, limit: PAGE_SIZE, offset, downloadMedia: false, accountId,
    }) as Array<Record<string, unknown>>;

    if (!Array.isArray(messages) || messages.length === 0) break;

    let hitCutoff = false;
    for (const msg of messages) {
      // WAHA returns Unix seconds -- multiply by 1000 for ms
      const rawTs = typeof msg.timestamp === "number" ? msg.timestamp : Number(msg.t ?? 0);
      const tsMs = rawTs * 1000;
      if (tsMs < cutoff) { hitCutoff = true; break; }
      if (tsMs > 0) timestamps.push(tsMs);
    }

    if (hitCutoff || messages.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return timestamps;
}
```

### computePeakWindow
Source: mimicry-gate.ts extractHour() Intl pattern
```typescript
function computePeakWindow(
  timestamps: number[], timezone: string
): { startHour: number; endHour: number } | null {
  if (timestamps.length < 20) return null; // sparse guard (ADAPT-01)

  const histogram = new Array<number>(24).fill(0);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false });
  for (const ts of timestamps) {
    const parts = fmt.formatToParts(new Date(ts));
    const hourPart = parts.find((p) => p.type === "hour");
    if (!hourPart) continue;
    let h = parseInt(hourPart.value, 10);
    if (h === 24) h = 0; // normalize midnight (Intl quirk -- DO NOT REMOVE)
    histogram[h]++;
  }

  const total = histogram.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  // Include hours sorted by count desc until cumulative >= 60% of total
  const target = total * 0.6;
  const sorted = histogram.map((count, hour) => ({ hour, count })).sort((a, b) => b.count - a.count);

  let covered = 0;
  const peakHours: number[] = [];
  for (const { hour, count } of sorted) {
    if (covered >= target) break;
    peakHours.push(hour);
    covered += count;
  }

  if (peakHours.length === 0) return null;
  peakHours.sort((a, b) => a - b);
  const startHour = peakHours[0];
  const endHour = (peakHours[peakHours.length - 1] + 1) % 24;
  // NOTE: bimodal activity (e.g. 9am + 9pm) produces a wide window (9am-10pm).
  // This is intentionally permissive -- a wider window is safer than missing both peaks.
  return { startHour, endHour };
}
```
---

## Integration Points (Complete Map)

| File | Change | Why |
|------|--------|-----|
| src/directory.ts | Add chat_activity_profiles table + ActivityProfile type + CRUD prepared statements | Stores per-chat learned peak windows; reuses existing DB connection |
| src/activity-scanner.ts | New file -- background scanner module | ADAPT-01, ADAPT-02, ADAPT-03 |
| src/mimicry-enforcer.ts | Add activity profile lookup in Step 2 after getDmSettings | ADAPT-04, ADAPT-05 |
| src/channel.ts | Call startActivityScanner() after startDirectorySync() at line ~1129 | Wire scanner to account lifecycle |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | package.json (vitest config) |
| Quick run command | `npx vitest run src/activity-scanner.test.ts --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADAPT-01 | computePeakWindow returns correct start/end from timestamp array | unit | `npx vitest run src/activity-scanner.test.ts -t "computePeakWindow"` | Wave 0 |
| ADAPT-01 | Pagination stops at 7-day cutoff | unit | `npx vitest run src/activity-scanner.test.ts -t "pagination"` | Wave 0 |
| ADAPT-01 | Returns null when < 20 messages | unit | `npx vitest run src/activity-scanner.test.ts -t "sparse guard"` | Wave 0 |
| ADAPT-02 | upsertActivityProfile + getActivityProfile round-trip | unit | `npx vitest run src/directory.test.ts -t "activity profile"` | Wave 0 |
| ADAPT-02 | Weekly rescan overwrites stale row | unit | `npx vitest run src/activity-scanner.test.ts -t "rescan overwrites"` | Wave 0 |
| ADAPT-03 | Tick skips when isOffPeak returns false | unit | `npx vitest run src/activity-scanner.test.ts -t "off-peak guard"` | Wave 0 |
| ADAPT-04 | enforceMimicry applies profile hours when no manual override | unit | `npx vitest run src/send-pipeline.test.ts -t "activity profile gate"` | Wave 0 |
| ADAPT-05 | enforceMimicry falls back to global config when no profile | unit | `npx vitest run src/send-pipeline.test.ts -t "no profile fallback"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/activity-scanner.test.ts --reporter=verbose`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before /gsd:verify-work

### Wave 0 Gaps
- [ ] `src/activity-scanner.test.ts` -- covers ADAPT-01 (histogram, pagination stop, sparse guard), ADAPT-02 (rescan overwrite), ADAPT-03 (off-peak skip)
- [ ] New test cases in `src/send-pipeline.test.ts` -- covers ADAPT-04 (profile applied to gate), ADAPT-05 (null profile fallback)
- [ ] New test cases in `src/directory.test.ts` -- covers ADAPT-02 (upsertActivityProfile / getActivityProfile CRUD)

---

## Environment Availability

Step 2.6: SKIPPED -- no external dependencies. Phase uses only better-sqlite3 (already installed) and WAHA API (already configured and running).

---

## Open Questions

1. **WAHA message timestamp field name**
   - What we know: getWahaChatMessages returns raw WAHA API objects. WAHA conventionally uses timestamp as Unix seconds.
   - What is unclear: Whether field is timestamp or t; whether it varies by WAHA engine (NOWEB vs others).
   - Recommendation: Normalize both -- rawTs = typeof msg.timestamp === "number" ? msg.timestamp : Number(msg.t ?? 0). Add a debug log on first scan run to verify.

2. **Session name vs. accountId in channel.ts**
   - What we know: resolveGateConfig needs WAHA session name (e.g. "3cf11776_logan"). startDirectorySync uses account.accountId.
   - What is unclear: Whether account.accountId equals the WAHA session name, or if there is a separate session name field.
   - Recommendation: Inspect account object at channel.ts line 1119. The accountId passed to startDirectorySync is used as-is in WAHA API calls in sync.ts, suggesting it IS the session name. Verify during implementation.

3. **Contiguous window limitation with bimodal activity**
   - What we know: Locked decision stores single peak_start_hour/peak_end_hour.
   - What is unclear: How wide the window gets for chats with morning + evening activity spikes.
   - Recommendation: Accept the wider window -- permissive is safer. Document the bimodal limitation in code comments.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: src/mimicry-gate.ts -- resolveGateConfig, checkTimeOfDay, TargetGateOverride interface, extractHour timezone pattern
- Direct code inspection: src/mimicry-enforcer.ts -- Step 2 override resolution, exact integration location for activity profile lookup
- Direct code inspection: src/sync.ts -- complete setTimeout chain pattern, AbortSignal handling, state object, batch delays, unrefTimer helper
- Direct code inspection: src/directory.ts -- SQLite table creation, WAL setup, migration-safe ALTER pattern, prepared statement conventions
- Direct code inspection: src/send.ts line 852 -- getWahaChatMessages exact signature (limit, offset, downloadMedia, accountId params)
- Direct code inspection: src/channel.ts lines 1119-1130 -- startDirectorySync call site, abortSignal pattern
- .planning/phases/56-adaptive-activity-patterns/56-CONTEXT.md -- locked decisions for scan depth, threshold, storage format, scheduling

### Secondary (MEDIUM confidence)
- WAHA Unix seconds timestamp convention: inferred from WAHA API patterns used across other integrations in the codebase

### Tertiary (LOW confidence, needs runtime validation)
- WAHA message object field name (timestamp vs t): not directly verified by code inspection; inferred from WAHA API conventions

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries verified
- Architecture patterns: HIGH -- all patterns copied from verified working code
- Integration points: HIGH -- all call sites verified by direct source file inspection
- Histogram algorithm: MEDIUM -- correct in concept; bimodal edge case produces wide but acceptable window
- WAHA timestamp field name: LOW -- inferred, verify during Wave 0 implementation

**Research date:** 2026-03-27
**Valid until:** 2026-04-27