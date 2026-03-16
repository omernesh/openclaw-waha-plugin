# Phase 11: Dashboard, Sessions & Log - Research

**Researched:** 2026-03-16
**Domain:** Admin Panel UI (embedded HTML/JS in monitor.ts)
**Confidence:** HIGH

## Summary

Phase 11 adds three targeted improvements to the admin panel: showing all configured sessions on the Dashboard tab (DASH-01), enabling inline role/subRole editing from the Sessions tab (SESS-01), and reformatting log output from a raw pre block into a structured, timestamp-visible display (LOG-01).

All three changes are contained entirely within `src/monitor.ts`. The backend already exposes the sessions data via `GET /api/admin/sessions` (Phase 4). The config write path via `POST /api/admin/config` is working and well-tested (Phases 7-9). The log data arrives as raw journalctl lines via `GET /api/admin/logs`. There are no new npm packages, no schema changes, and no new DB tables needed.

The main design constraints are the established embedded-JS conventions: ES5-compatible syntax (var, function, no arrow functions), DOM creation methods (not setting raw HTML) for user-supplied data, and the security hook that blocks setting HTML content with user-controlled text. The pattern for writing role changes back to config is a new `PUT /api/admin/sessions/:sessionId/role` endpoint that reads `openclaw.json`, mutates the target account's role/subRole, and writes it back — mirroring the `PUT /api/admin/directory/:jid/filter` pattern from Phase 9.

**Primary recommendation:** Three independent tasks; each can be implemented and verified separately. No inter-task dependencies.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | Show all connected sessions on Dashboard with ports and status | Sessions data already in `GET /api/admin/sessions`; Dashboard Session Info card needs to call that endpoint and render all sessions |
| SESS-01 | Session roles editable via dropdown in Sessions tab | New `PUT /api/admin/sessions/:sessionId/role` endpoint; client JS saves role/subRole to config via pattern from Phase 7 config write |
| LOG-01 | Log entries have clearly formatted timestamps and visual separation | Parse journalctl line format in client JS; render per-entry div blocks with timestamp, level badge, and message instead of raw pre text |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins (http, fs, child_process) | (runtime) | HTTP server, config file I/O, journalctl exec | Already used throughout monitor.ts |
| TypeScript (server-side) | ^5.x (project) | Type-safe server route handlers | All server code is TypeScript |
| ES5-compatible plain JS (client-side) | n/a | Embedded HTML/JS in template literal | Established project convention — no bundler in admin panel |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.0.18 | Unit tests for extracted pure functions | Test any pure logic extracted from embedded JS (e.g., log line parser) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline `PUT /api/admin/sessions/:id/role` | Re-use `POST /api/admin/config` | Config POST is a full-config overwrite requiring the full payload; targeted endpoint is safer and avoids accidental field loss |
| DOM per-entry rendering for logs | Reuse existing pre block with color spans | Pre block is fine for coloring but cannot render structured layout with separated timestamp/level/message columns |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure
No new files needed. All changes are in:
```
src/
└── monitor.ts   # Admin panel server + embedded HTML/JS (all three changes here)
tests/
└── (optional) log-parser.test.ts   # If log line parsing is extracted as a pure function
```

### Pattern 1: Dashboard Multi-Session Card (DASH-01)
**What:** Replace the single-session `session-kv` div on the Dashboard with a list of all sessions from `GET /api/admin/sessions`, showing sessionId, name, role, subRole, health dot, and WAHA status.
**When to use:** Any time the Dashboard needs live data from the sessions endpoint.

**Details:**
- The existing Dashboard `loadStats()` already calls `loadHealth()` at the end. Add a call to a new `loadDashboardSessions()` helper that fetches `/api/admin/sessions` and renders into a new `#dashboard-sessions` div.
- The Sessions tab already renders the enriched session list correctly via `loadSessions()`. The Dashboard version can be a simpler read-only card (compact name/status/health dot per session row).
- The sessions endpoint returns `{ sessionId, name, role, subRole, healthy, healthStatus, consecutiveFailures, lastCheck, wahaStatus }`. It does NOT currently return `webhookPort`. Since all sessions share one webhook port (one server per plugin instance), `webhookPort` can be read from `d.webhookPort` in the stats response and shown once in the card header.
- Use DOM creation (not raw HTML setting) for session name/id text — follows Phase 10 security pattern.

**Example skeleton client JS:**
```javascript
// Source: project pattern from loadSessions() Phase 4 Plan 04
async function loadDashboardSessions() {
  var container = document.getElementById('dashboard-sessions');
  if (!container) return;
  try {
    var r = await fetch('/api/admin/sessions');
    if (!r.ok) return;
    var sessions = await r.json();
    // render sessions as compact rows using DOM methods for user text
    while (container.firstChild) container.removeChild(container.firstChild);
    sessions.forEach(function(s) {
      var row = document.createElement('div');
      row.className = 'session-row';
      var nameEl = document.createElement('span');
      nameEl.textContent = s.name || s.sessionId;
      row.appendChild(nameEl);
      // ... add health dot, status badge via DOM creation
      container.appendChild(row);
    });
  } catch(e) { /* non-fatal, dashboard still shows other cards */ }
}
```

### Pattern 2: Session Role Editing Dropdown (SESS-01)
**What:** Add select dropdowns for role and subRole to each session card in the Sessions tab. On change, call a new `PUT /api/admin/sessions/:sessionId/role` endpoint.
**When to use:** When user wants to change a session's role/subRole without editing the raw config file.

**Server-side endpoint:**
```typescript
// PUT /api/admin/sessions/:sessionId/role
// Body: { role?: string, subRole?: string }
// Reads openclaw.json, finds account where session === sessionId,
// updates role/subRole fields, writes back. Returns { ok: true }.
// Pattern mirrors PUT /api/admin/directory/:jid/filter from Phase 9.
```

Key implementation notes:
- `getConfigPath()` helper already exists in monitor.ts (used by `POST /api/admin/config`).
- Config structure: `channels.waha.accounts[accountId]` for named accounts, or `channels.waha` for the default account. The `listEnabledWahaAccounts()` function maps accountId to the config key. The sessions endpoint uses `acc.session` as the sessionId. The PUT handler must reverse-lookup accountId from sessionId using `listEnabledWahaAccounts(opts.config)`.
- Adding `accountId` to the sessions endpoint response simplifies the PUT handler lookup — avoids a config scan on every PUT.
- Validated role values: any non-empty string (string-based, not enum per Phase 4 decision). Common values: `"bot"`, `"human"`.
- Validated subRole values: `"full-access"`, `"listener"`.
- The sessions tab note "Roles are configured via the Config tab — this view is read-only" must be replaced when the dropdown is added.

**Client-side:**
```javascript
// Source: Phase 9 pattern (triggerOperator select onChange with fetch save)
async function saveSessionRole(sessionId, role, subRole) {
  try {
    var r = await fetch('/api/admin/sessions/' + encodeURIComponent(sessionId) + '/role',
      { method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ role: role, subRole: subRole }) });
    if (r.ok) showToast('Role saved. Restart gateway to apply changes.');
    else showToast('Failed to save role', true);
  } catch(e) {
    showToast('Error saving role: ' + e.message, true);
  }
}
```

The `loadSessions()` renderer builds session cards. For the dropdowns, since role/subRole option text is hardcoded (not user-supplied), select option markup can use standard DOM patterns. For the session name/id in the card header, use textContent (per Phase 10 security pattern).

### Pattern 3: Structured Log Display (LOG-01)
**What:** Replace the `pre#log-output` monolithic text block with a `div#log-output` containing one structured div per log line — each showing a formatted timestamp, a color-coded level badge, and the message body.
**When to use:** Any time structured log display is needed.

**Journalctl line format:**
```
Mar 16 12:34:56 hostname openclaw-gateway[PID]: [waha] message text here
```
The timestamp portion is `Mar 16 12:34:56` (first three space-separated tokens). The message body starts after `]: `.

**Parsing strategy (client-side, pure function, extractable for testing):**
```javascript
function parseLogLine(line) {
  // Journalctl format: "Mar 16 12:34:56 hostname proc[pid]: message"
  var m = line.match(/^(\w{3}\s+\d+\s+[\d:]+)\s+\S+\s+\S+:\s(.*)$/);
  if (m) return { ts: m[1], msg: m[2] };
  // Fallback for non-journalctl lines (file source)
  return { ts: '', msg: line };
}
```

**Level detection** reuses existing coloring logic:
- `/error/i` in line -> level `"error"`
- `/warn/i` in line -> level `"warn"`
- `/\[waha\]/i` in line -> level `"info"`
- else -> level `"debug"`

**Rendering using DOM creation:**
```javascript
// For each log line, create a div.log-entry with child spans using textContent.
// textContent is required for ts and msg — they contain system/user data.
var entry = document.createElement('div');
entry.className = 'log-entry';
var tsEl = document.createElement('span');
tsEl.className = 'log-ts';
tsEl.textContent = parsed.ts;
var levelEl = document.createElement('span');
levelEl.className = 'log-level ' + level;
levelEl.textContent = level;
var msgEl = document.createElement('span');
msgEl.className = 'log-msg';
msgEl.textContent = parsed.msg;
entry.appendChild(tsEl);
entry.appendChild(levelEl);
entry.appendChild(msgEl);
fragment.appendChild(entry);
```

Use a DocumentFragment to batch-append all entries in one operation for performance.

**CSS additions needed:**
```css
.log-entry { display:flex; gap:8px; padding:3px 0; border-bottom:1px solid #1e293b; font-family:monospace; font-size:0.78rem; }
.log-entry:last-child { border-bottom:none; }
.log-ts { color:#64748b; flex-shrink:0; width:130px; }
.log-level { flex-shrink:0; width:50px; font-weight:600; }
.log-level.error { color:#ef4444; }
.log-level.warn { color:#f59e0b; }
.log-level.info { color:#22d3ee; }
.log-level.debug { color:#94a3b8; }
.log-msg { color:#e2e8f0; white-space:pre-wrap; word-break:break-all; flex:1; }
```

The outer container `#log-output` changes from `pre` to `div` with `overflow-y:auto; max-height:70vh;`.

### Anti-Patterns to Avoid
- **Setting HTML with user-supplied text:** Session names, JIDs, log message bodies are user/system-supplied. Always use `textContent` or `createElement` for those. (Phase 7, Phase 10 established this rule.)
- **Mutating the entire config file for a role change:** Do not re-use `POST /api/admin/config` for role edits — it merges the full config payload and could clobber other fields. Use a targeted PUT endpoint.
- **Parsing log timestamps server-side:** The server already returns raw journalctl lines. Parsing client-side is correct — keeps server lean, avoids changing the established log API contract.
- **Leaving the sessions read-only note in place:** The Sessions tab currently says "Roles are configured via the Config tab — this view is read-only." This must be removed when dropdowns are added.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config file read/write for role saves | Custom file I/O | Existing `getConfigPath()` + `readFileSync`/`writeFileSync` pattern | Already used in `POST /api/admin/config` and group filter PUT |
| HTML escaping for static values | Custom escaper | Existing `esc()` helper in client JS (line ~934) | Already handles all needed characters |
| Toast notifications | Custom notification | Existing `showToast(msg, isError)` helper | Already defined, used throughout all tabs |
| Level filtering for new log format | New filter logic | Existing `currentLogLevel` + server-side filtering | Server already filters by level; client renders what it receives |
| Account lookup by sessionId | Custom config scan | `listEnabledWahaAccounts(opts.config)` | Returns `{ accountId, session }` pairs — find by session field |

## Common Pitfalls

### Pitfall 1: textContent required for user-supplied data (security hook)
**What goes wrong:** Code sets HTML content to render session names, log message bodies, or JIDs — security hook blocks it.
**Why it happens:** Quick implementation shortcut, easy to miss which fields are user-supplied.
**How to avoid:** Use `el.textContent = value` for any field that originates from WAHA API, config, or journalctl output. Only use `esc()` helper in template string concatenation for entirely static markup (badge color values computed from role string, numeric counts).
**Warning signs:** Security lint hook errors during TypeScript compilation.

### Pitfall 2: Sessions tab "read-only" note left in place after SESS-01
**What goes wrong:** After adding dropdowns, the note still says "Roles are configured via the Config tab — this view is read-only" — contradicting the UI.
**Why it happens:** Forgetting to remove the old paragraph.
**How to avoid:** The task must explicitly remove/replace that `<p>` element at line ~872.

### Pitfall 3: Finding config account by sessionId in PUT handler
**What goes wrong:** `PUT /api/admin/sessions/:sessionId/role` handler cannot find the right config key because accounts are stored by accountId, not by sessionId.
**Why it happens:** The sessions endpoint maps accountId to sessionId for display, but config stores them by accountId.
**How to avoid:** Use `listEnabledWahaAccounts(opts.config)` in the PUT handler. Find the entry where `acc.session === sessionId`, then use `acc.accountId` to locate the config key. For the default account (no named accounts), write to `channels.waha.role` / `channels.waha.subRole` directly.

### Pitfall 4: Log display breaks when log source is "file" (non-journalctl format)
**What goes wrong:** Log parser assumes journalctl format but `/tmp/openclaw/openclaw-YYYY-MM-DD.log` has a different format — parsing returns empty timestamps for all lines.
**Why it happens:** Two log sources (journalctl + file) have different line formats.
**How to avoid:** The parse function must fall back gracefully — show the full raw line in `log-msg`, leave `log-ts` empty. The `d.source` field in the API response tells the client which source is active.

### Pitfall 5: Route ordering — sessions role PUT before generic routes
**What goes wrong:** `PUT /api/admin/sessions/:sessionId/role` URL pattern could collide with other routes if placed incorrectly.
**Why it happens:** The request router in monitor.ts uses sequential `if` checks. Routes must be ordered correctly (more specific first).
**How to avoid:** Place the new sessions role endpoint alongside the existing `GET /api/admin/sessions` block (around line 3149). Per Phase 10 decision: exact URL match before generic patterns.

### Pitfall 6: Dashboard session card overlaps with existing single-session "Session Info" card
**What goes wrong:** DASH-01 adds multi-session display but the existing `#session-card` on the Dashboard shows a single session — two cards show duplicate/confusing data.
**Why it happens:** The existing card shows `d.session` (primary account's session ID) from the stats endpoint. Adding all sessions from the sessions endpoint creates overlap.
**How to avoid:** For DASH-01, replace or augment the existing `#session-card` to show all sessions. Cleanest approach: rename it "Sessions" and populate it from `/api/admin/sessions`. Keep `webhookPort` display (from stats `d.webhookPort`) as a card subtitle.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sessions tab read-only (Phase 4) | Sessions tab has inline role dropdowns | Phase 11 | Avoids navigating to Config tab for role changes |
| Dashboard shows single-session card from stats | Dashboard shows all sessions from sessions endpoint | Phase 11 | Surfaces multi-session status at a glance |
| Log as raw pre text block with color spans | Log as structured per-entry divs with timestamp + level + message | Phase 11 | Readable timestamps and visual line separation |

**Deprecated/outdated:**
- Sessions tab "read-only" note: replaced by editable dropdowns
- Pre block raw log display: replaced by structured div list

## Open Questions

1. **What does "ports" mean in DASH-01?**
   - What we know: The requirement says "display both omer and logan sessions with their respective ports and status." There is one webhook port per plugin instance (shared by all sessions). Sessions do not have individual ports.
   - What's unclear: Whether "ports" refers to the single webhook port, or the WAHA API port (3004), or is a copywriting imprecision.
   - Recommendation: Show the single `webhookPort` (from stats `d.webhookPort`) once in the card header, not per-session. Per-session rows show sessionId, name, role, WAHA status, health.

2. **Should SESS-01 dropdowns trigger a gateway restart prompt?**
   - What we know: Role changes affect runtime behavior but take effect only after gateway restart. The `POST /api/admin/config` flow has a `restartRequired` flag.
   - What's unclear: Whether to include an automatic restart prompt after role save.
   - Recommendation: Show a toast "Role saved. Restart gateway to apply changes." — no automatic restart. User can use Settings "Save & Restart" if needed.

3. **Should `accountId` be added to the sessions endpoint response?**
   - What we know: The `PUT /api/admin/sessions/:sessionId/role` handler needs to find the config key by sessionId. The sessions endpoint currently does not return `accountId`.
   - Recommendation: Add `accountId` to the sessions endpoint response (non-breaking additive change). Client passes it back in PUT payload to simplify server-side lookup.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | Dashboard renders all sessions | manual-only | n/a — UI rendering only | n/a |
| SESS-01 | PUT handler writes correct role/subRole to config (named + default account) | unit | `npx vitest run tests/session-role-edit.test.ts -x` | Wave 0 |
| LOG-01 | parseLogLine() extracts timestamp + message from journalctl and file formats | unit | `npx vitest run tests/log-parser.test.ts -x` | Wave 0 |

**Notes on manual-only items:**
- DASH-01 is UI rendering only — no server-side logic changes, no pure functions to extract. Verified by visual inspection.

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/session-role-edit.test.ts` — covers SESS-01 (config write for named account, default account, invalid role rejection)
- [ ] `tests/log-parser.test.ts` — covers LOG-01 (journalctl format, file fallback format, empty line, malformed line)

*(DASH-01 has no Wave 0 test gap — UI-only with no extractable pure logic.)*

## Sources

### Primary (HIGH confidence)
- `src/monitor.ts` (read directly, 2026-03-16) — full admin panel implementation, all existing routes and UI patterns
- `src/config-schema.ts` (read directly, 2026-03-16) — role/subRole field definitions in WahaAccountSchemaBase
- `src/accounts.ts` (read directly, 2026-03-16) — listEnabledWahaAccounts, ResolvedWahaAccount shape
- `.planning/quick/260315-wo2-.../260315-wo2-PLAN.md` (read directly) — exact bug descriptions for DASH-01, SESS-01, LOG-01
- `.planning/STATE.md` (read directly) — Phase 4 decisions on read-only sessions tab, sessions endpoint enrichment

### Secondary (MEDIUM confidence)
- Phase 7-10 PLAN.md and SUMMARY.md files — established DOM creation security pattern, AbortController timeout pattern, config write pattern

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, all patterns from existing codebase
- Architecture: HIGH — routes, config write, DOM creation all follow established Phase 7-10 patterns
- Pitfalls: HIGH — all identified from reading actual code and prior phase decisions

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable codebase, no fast-moving dependencies)
