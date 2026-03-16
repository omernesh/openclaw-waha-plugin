# Phase 9: Settings UX Improvements - Research

**Researched:** 2026-03-16
**Domain:** Admin panel HTML/JS UI improvements (tooltips, group filter UX, tab/search behavior, pairing mode)
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UX-01 | DM Policy "pairing" mode: either implement properly with tests or remove/disable with explanation | Pairing code traced in inbound.ts + channel.ts; SDK integration points identified; decision tree documented |
| UX-02 | Add tooltips to all Contact Settings panel fields (Mode, Mention Only, Custom Keywords, Can Initiate) explaining what each does | Tooltip pattern (.tip class + data-tip) well established across Settings section; pattern copy-paste ready |
| UX-03 | Group Filter Override has per-group trigger operator option + replace keywords plain text with tag-style input (reuse UI-03 createTagInput) | Tag Input component (createTagInput) from Phase 8 available; group filter override HTML/JS located at lines 2151-2267; integration points identified |
| UX-04 | Tab switching clears search bar, search bar has 'x' clear button, "Newsletters" tab renamed to "Channels" | switchDirTab() at line 1928 and loadDirectory() at line 1961 identified; search bar HTML at line 823 located |
</phase_requirements>

---

## Summary

Phase 9 is a pure admin-panel UI improvement phase — all work is confined to `src/monitor.ts`. No new backend endpoints, no new TypeScript source files needed. The four requirements span: one investigation (UX-01, pairing mode), one UI enhancement using the established `.tip` tooltip pattern (UX-02), one component integration using the Phase 8 `createTagInput` factory (UX-03), and one small behavioral fix plus rename (UX-04).

The pairing mode (UX-01) is the most architecturally significant. The SDK provides a full pairing pipeline via `core.channel.pairing.*` in channel.ts, and `createScopedPairingAccess` + `readStoreForDmPolicy` in inbound.ts. The code is wired and appears functional, but whether the approval flow actually works end-to-end (including the code-reply message reaching the sender) needs investigation. The outcome is binary: either document it works (with a test confirming the send path) or add a `disabled` attribute to the pairing option element with an explanatory tooltip.

UX-02 and UX-04 are low-risk cosmetic changes. The `.tip` CSS class and `data-tip` tooltip pattern is used extensively across the Settings section (lines 499-791) — simply copy the same pattern into the contact settings panel HTML in `buildContactCard()`. For UX-04, `switchDirTab()` just needs a one-liner to clear the search input, and the search bar needs an inline button styled as an 'x'.

UX-03 is medium complexity. The `createTagInput` factory from Phase 8 is available in the script block. The group filter override section (lines 2150-2167) currently renders a plain text input for keywords. This must be replaced with a `createTagInput` container div, and `loadGroupFilter`/`saveGroupFilter` must be updated to use `tagInput.getValue()`/`tagInput.setValue()`. A trigger operator select (AND/OR) also needs to be added with load/save wiring.

**Primary recommendation:** Execute in two plans — Plan 01: UX-01 investigation + UX-02 tooltips (low risk). Plan 02: UX-03 group filter tag input + UX-04 tab/search fixes. Alternatively, one single plan if the scope is manageable.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | ^4.0.18 | Unit tests for pure functions extracted from monitor.ts template | Already installed, all prior phase tests use it |
| TypeScript | ^5.9.3 | Type checking only, no build step | Project convention |

### No New Dependencies
All Phase 9 work uses:
- Existing `.tip` CSS class (defined at line 334-336 of monitor.ts)
- Existing `createTagInput` factory function (added Phase 8, UI-02/UI-03)
- Existing `switchDirTab()` function (line 1928)
- Existing `loadGroupFilter()`/`saveGroupFilter()` functions (lines 2199-2267)
- Existing DOM manipulation patterns from prior phases

**Installation:** None required.

---

## Architecture Patterns

### Recommended Project Structure
No new files required. All changes are in:
```
src/monitor.ts     — All admin panel HTML/JS (3435 lines, embedded template string)
tests/             — Unit tests for any pure functions extracted
```

If a trigger operator logic function is extracted for testability, follow the Phase 8 pattern:
```
tests/ui-group-filter.test.ts   — unit tests for pure serialization/parse helpers
```

### Pattern 1: Tooltip (.tip class)
**What:** CSS-only tooltip using `.tip::after { content: attr(data-tip) }`. Renders as a `?` badge with a hover popup.
**When to use:** Every label in the Settings section that needs explanation.

Existing usage from monitor.ts line 540:
```
<label>DM Policy <span class="tip" data-tip="How to handle...">?</span></label>
```

For Contact Settings panel (in `buildContactCard()`), the same pattern is injected as a JavaScript string:
```javascript
// Inside buildContactCard() string concatenation:
'<div class="settings-field"><label>Mode ' +
'<span class="tip" data-tip="Active: bot responds to this contact. Listen Only: messages are received but bot stays silent.">?</span>' +
'</label><select id="mode-' + id + '">...</select></div>'
```

### Pattern 2: Tag Input integration in group filter override
**What:** Replace the plain `<input type="text" id="gfo-patterns-...">` with a `<div id="gfo-patterns-cp-...">` container, then call `createTagInput('gfo-patterns-cp-' + sfx, opts)` after the HTML is assigned to the panel.

**Key constraint:** `createTagInput` must be called AFTER the container div exists in the DOM. The `buildGroupPanel()` function builds an HTML string then assigns it to `panel.innerHTML`. Call `createTagInput` after that assignment.

```javascript
// Pattern — container must exist before createTagInput is called
panel.innerHTML = html;  // element now exists in DOM
var gfTagInput = createTagInput('gfo-patterns-cp-' + sfx, {
  placeholder: 'hello, help, bot'
});
loadGroupFilter(groupJid, gfTagInput);  // pass to loader
```

**Storage problem:** `loadGroupFilter` and `saveGroupFilter` are called asynchronously and per-group. The `gfTagInput` instance needs to be stored per-group. Use an object keyed by sfx (sanitized JID):
```javascript
var gfoTagInputs = {};
// On panel creation:
if (!gfoTagInputs[sfx]) gfoTagInputs[sfx] = createTagInput('gfo-patterns-cp-' + sfx, opts);
```

### Pattern 3: Per-group trigger operator
**What:** A select element with values `AND` / `OR` controlling whether a message must match ALL keywords (AND) or ANY keyword (OR).
**Where to add:** Inside `gfo-settings-{sfx}` div, after the keyword filter enabled checkbox.
**Save/load:** Add `triggerOperator` field to the PUT/GET `/api/admin/directory/:jid/filter` API payload.

Current saveGroupFilter body (line 2251):
```
{ enabled, filterEnabled, mentionPatterns, godModeScope }
```
With Phase 9 addition:
```
{ enabled, filterEnabled, mentionPatterns, godModeScope, triggerOperator }
```

The TypeScript backend handler at line ~2750+ must also accept and persist `triggerOperator`.

### Pattern 4: switchDirTab search clear
**What:** Clear the search input value when switching directory tabs.
**Where:** `switchDirTab()` at line 1928.

Current function (line 1928):
```javascript
function switchDirTab(tab, btn) {
  currentDirTab = tab;
  document.querySelectorAll('.dir-tab').forEach(function(el) { el.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  dirOffset = 0;
  dirAutoImported = false;
  loadDirectory();
}
```

Modified version (add two lines before dirOffset = 0):
```javascript
  var searchEl = document.getElementById('dir-search');
  if (searchEl) searchEl.value = '';
```

### Pattern 5: Search bar 'x' clear button
**What:** An inline button positioned inside the search row that clears the input on click.
**Where:** HTML at line 823 (dir-search input).

Replace the single input element with a wrapper div containing the input and a clear button:
```
div[style="position:relative;flex:1;"]
  input#dir-search  (same attributes as before)
  button#dir-search-clear  (position:absolute, right:8px)
```

Add a `clearDirSearch()` JavaScript function:
```javascript
function clearDirSearch() {
  document.getElementById('dir-search').value = '';
  dirOffset = 0;
  loadDirectory();
}
```

### Anti-Patterns to Avoid
- **Calling createTagInput before the container exists in DOM:** Must call only after `panel.innerHTML = html`, not during string building.
- **Global single tag input instance for per-group panels:** Each group panel needs its own instance. Store in object keyed by sfx.
- **saveGroupFilter reading from plain input after replacement:** After replacing the plain input with a tag input container, update `saveGroupFilter` to read from the tag input instance (via registry), not `document.getElementById('gfo-patterns-' + sfx)`.
- **Modifying pairing SDK internals:** `createScopedPairingAccess` and `core.channel.pairing` are from `openclaw/plugin-sdk`. Only call documented methods.
- **Using `element.value +=` pattern for search clear:** Use `element.value = ''` directly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tooltip on hover | Custom JS tooltip library | `.tip` CSS class + `data-tip` attribute | Already in the CSS, zero JS, hover-only is sufficient for admin panel |
| Tag-style keyword input | New tag input component | `createTagInput(containerId, opts)` from Phase 8 | Already tested, consistent with other fields |
| Contact name search in picker | Custom search dropdown | `createContactPicker(containerId, opts)` from Phase 8 | Already built and tested |
| Pairing approval persistence | Custom store | `createScopedPairingAccess` from `openclaw/plugin-sdk` | SDK owns the pairing state; plugin must not manage its own |

**Key insight:** Phase 8 built all the reusable UI components needed for Phase 9. Use them directly.

---

## Common Pitfalls

### Pitfall 1: Tag Input late init in dynamic HTML
**What goes wrong:** `createTagInput('gfo-patterns-cp-' + sfx, opts)` returns null because the container div doesn't exist yet when called.
**Why it happens:** `buildGroupPanel()` builds an HTML string then assigns it to the panel. Any `createTagInput` call made during string construction runs before the element exists in the DOM.
**How to avoid:** Always call `createTagInput` AFTER assigning the HTML string to the panel element. The lazy-init pattern from Phase 8 (`if (!tagInputDm) tagInputDm = createTagInput(...)`) only works because `loadConfig()` runs after the Settings tab is activated and its DOM elements are present.
**Warning signs:** `createTagInput` returns null (the function guards against missing container with `if (!el) return null`).

### Pitfall 2: Group filter per-group instances vs. global
**What goes wrong:** Using a single global `var gfTagInput` causes different groups' panels to share the same tag input instance.
**Why it happens:** Each group panel is created dynamically via `buildGroupPanel(groupJid)`. If a single variable holds the tag input instance, opening a second group's panel overwrites the first.
**How to avoid:** Store instances in an object keyed by sfx (the sanitized JID): `var gfoTagInputs = {};`. Create if not exists: `if (!gfoTagInputs[sfx]) gfoTagInputs[sfx] = createTagInput(...)`.

### Pitfall 3: saveGroupFilter reading from plain input when tag input exists
**What goes wrong:** After replacing the plain text input with a tag input container, `saveGroupFilter` still tries to read from `document.getElementById('gfo-patterns-' + sfx)` which no longer exists as a plain input.
**Why it happens:** `saveGroupFilter` references the old element ID.
**How to avoid:** Update `saveGroupFilter` to look up the tag input instance from `gfoTagInputs[sfx]` and call `.getValue()` instead of reading from a DOM input element.

### Pitfall 4: Pairing mode — incomplete understanding of SDK contract
**What goes wrong:** Assuming pairing "works" because the code is present, when the SDK's `createScopedPairingAccess` might depend on config or runtime state not set up for this plugin.
**Why it happens:** `readStoreForDmPolicy` reads from the OpenClaw gateway's internal storage (not the plugin's SQLite). If the gateway hasn't set up a pairing store for the `waha` channel, the call returns empty and the pairing code never sends.
**How to avoid:** Test the pairing flow live: set `dmPolicy: "pairing"` in config, send a DM from an unknown sender, verify the bot sends a pairing code reply. If the reply never arrives, disable the option with a clear tooltip explaining it's not yet supported.

### Pitfall 5: Search bar 'x' clear button style conflicts
**What goes wrong:** The clear button appears outside the search input or breaks the flex layout of `.dir-header`.
**Why it happens:** The `.dir-header` is a flex container. Wrapping the input in a `position:relative` div changes flex layout.
**How to avoid:** Keep the wrapper div as `flex:1` (same as the original input's implicit flex behavior). The button is positioned absolute inside the relative wrapper, so it doesn't affect the flex layout.

### Pitfall 6: Tooltip text escaping in JavaScript string context
**What goes wrong:** Tooltip `data-tip` text containing single quotes breaks the JavaScript string in `buildContactCard()`.
**Why it happens:** `buildContactCard()` uses string concatenation with single-quoted JS strings. An apostrophe in the tooltip text (e.g., "bot's response") would break the string literal.
**How to avoid:** Use the existing `esc()` helper for any user-provided text. For static tooltip text (no user data), just avoid apostrophes or use HTML entity `&#39;` for safety. Double-quote attribute values (data-tip="...") are safe inside a JS single-quoted string.

---

## Code Examples

### Contact Settings panel current HTML (in buildContactCard, line 2043)
```javascript
// Current: no tooltips on these fields
'<div class="settings-field"><label>Mode</label>' +
'<select id="mode-' + id + '">...</select></div>'

'<div class="settings-field"><label>' +
'<input type="checkbox" id="mo-' + id + '"> Mention Only</label></div>'

'<div class="settings-field"><label>Custom Keywords (comma-separated)</label>' +
'<input type="text" id="kw-' + id + '" ...></div>'

'<div class="settings-field"><label>' +
'<input type="checkbox" id="ci-' + id + '"> Can Initiate</label></div>'
```

### Contact Settings panel with UX-02 tooltips
```javascript
// UX-02: add .tip spans matching existing Settings section pattern
'<div class="settings-field"><label>Mode ' +
'<span class="tip" data-tip="Active: bot responds to this contact. Listen Only: messages arrive but bot never replies.">?</span>' +
'</label><select id="mode-' + id + '">...</select></div>'

'<div class="settings-field"><label>' +
'<input type="checkbox" id="mo-' + id + '"> Mention Only ' +
'<span class="tip" data-tip="When checked, bot only responds if explicitly @mentioned in a message.">?</span></label></div>'

'<div class="settings-field"><label>Custom Keywords ' +
'<span class="tip" data-tip="Comma-separated regex patterns. Bot only responds if message matches one of these patterns. Overrides global keyword filter for this contact.">?</span></label>' +
'<input type="text" id="kw-' + id + '" ...></div>'

'<div class="settings-field"><label>' +
'<input type="checkbox" id="ci-' + id + '"> Can Initiate ' +
'<span class="tip" data-tip="When checked, bot is allowed to send the first message to this contact. Uncheck to prevent unsolicited outbound messages.">?</span></label></div>'
```

### switchDirTab with search clear (UX-04)
```javascript
function switchDirTab(tab, btn) {
  currentDirTab = tab;
  document.querySelectorAll('.dir-tab').forEach(function(el) { el.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  var searchEl = document.getElementById('dir-search');   // UX-04: clear on tab switch
  if (searchEl) searchEl.value = '';                      // UX-04: clear on tab switch
  dirOffset = 0;
  dirAutoImported = false;
  loadDirectory();
}
```

### Newsletters tab rename (UX-04)
```html
<!-- Current (line 820): -->
<button class="dir-tab" onclick="switchDirTab('newsletters',this)" id="dtab-newsletters">Newsletters</button>

<!-- UX-04 change: -->
<button class="dir-tab" onclick="switchDirTab('newsletters',this)" id="dtab-newsletters">Channels</button>
```
Note: The JS key `'newsletters'` and `&type=newsletter` must remain unchanged — only the display label changes.

### Group filter override section with tag input (UX-03 sketch)
```javascript
// After html string is built and assigned to panel:
panel.innerHTML = html;

// UX-03: Initialize tag input for keywords (replaces gfo-patterns-{sfx} plain input)
if (!gfoTagInputs[sfx]) {
  gfoTagInputs[sfx] = createTagInput('gfo-patterns-cp-' + sfx, {
    placeholder: 'hello, help, bot'
  });
}
loadGroupFilter(groupJid);
```

---

## Pairing Mode Investigation (UX-01 Detail)

### What the code does today
1. `inbound.ts` line 327: `createScopedPairingAccess({ core, channel: CHANNEL_ID, accountId })` creates a scoped accessor to the SDK's pairing store
2. `inbound.ts` line 636: If `access.decision === "pairing"`, calls `pairing.upsertPairingRequest({ id: senderId })`
3. On `created === true`, sends a text message back to the sender via `sendWahaText` with the pairing code
4. `channel.ts` line 667: The `pairing` config section has a handler that logs approval

### What "pairing" actually means in OpenClaw
The pairing system is an OpenClaw SDK feature: unknown contacts who DM the bot receive a numeric code; the bot owner must approve them via a command (`/pair <code>`). This is entirely SDK-managed — the plugin just calls into it.

### Decision guidance
- **If testing shows the code reply is sent successfully:** Keep the option. Add a tooltip to the DM Policy select clarifying what pairing means. No code changes needed for UX-01 beyond the improved tooltip.
- **If the code reply never arrives (SDK store not configured, send fails, etc.):** Disable the option:
  - Add `disabled` attribute to the pairing option element
  - Update the DM Policy tooltip to note pairing is unavailable in this version
  - Add a `<!-- UX-01: pairing disabled - not supported in current SDK integration -->` comment

Either way, the investigation itself is the required deliverable. The planner should schedule a live test as the first task before making the UI decision.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No tag inputs — plain textarea for comma-separated values | `createTagInput` factory function | Phase 8 | Group filter keywords should use it (UX-03) |
| Manual JID entry for god mode users | `createGodModeUsersField` with contact picker | Phase 8 | Not directly related to Phase 9 |
| No tooltips on Contact Settings | Settings section has tooltips everywhere, Contact Settings panel does not | Phase 9 (this phase) | UX-02 adds parity |
| "Newsletters" tab label | "Channels" (WAHA's term for WhatsApp Channels/Newsletters) | Phase 9 (this phase) | Simple label rename, keys unchanged |

**Deprecated/outdated after Phase 9:**
- Plain text input `id="gfo-patterns-{sfx}"`: Will be replaced by a createTagInput container div.

---

## Open Questions

1. **Does pairing mode actually work end-to-end?**
   - What we know: The code path exists and calls SDK APIs. The bot attempts to send a pairing reply on `created === true`.
   - What's unclear: Whether `createScopedPairingAccess` is properly initialized for the `waha` channel, and whether `buildPairingReply` produces a valid message that WAHA delivers.
   - Recommendation: First task of the phase — live test with `dmPolicy: "pairing"` in config, send DM from unknown sender, check logs and WhatsApp for the code reply.

2. **Does the triggerOperator field need explicit backend handling?**
   - What we know: `saveGroupFilter` POSTs to `/api/admin/directory/:jid/filter`. The TypeScript handler receives the body.
   - What's unclear: Whether the handler persists arbitrary extra fields automatically or requires explicit code.
   - Recommendation: Read the handler during plan execution and add explicit `triggerOperator` handling if needed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run tests/ui-group-filter.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UX-01 | Pairing mode: live test or disable option | manual-only | N/A | N/A |
| UX-02 | Contact settings tooltips render correctly | manual-only | N/A (visual) | N/A |
| UX-03 | Keyword serialization for group filter | unit | `npx vitest run tests/ui-group-filter.test.ts -x` | Wave 0 |
| UX-04 | Tab switch clears search (DOM behavior) | manual-only | N/A | N/A |

**Note:** UX-01, UX-02, UX-04 are UI/behavioral changes with no extractable pure logic. UX-03 warrants a unit test only if a new pure serialization helper is extracted beyond `normalizeTags`. If the group filter tag input reuses `normalizeTags` (already tested in `tests/ui-tag-input.test.ts`), no new test file is needed.

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` (TypeScript compile check)
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green + live browser test of admin panel before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/ui-group-filter.test.ts` — covers UX-03 keyword parsing helpers IF new pure functions are extracted beyond `normalizeTags`

If group filter reuses `normalizeTags` directly: "None — existing test infrastructure covers all phase requirements via `tests/ui-tag-input.test.ts`"

---

## Sources

### Primary (HIGH confidence)
- `src/monitor.ts` lines 334-336 — tooltip CSS `.tip` class definition
- `src/monitor.ts` lines 499-791 — existing tooltip usage pattern across Settings section
- `src/monitor.ts` lines 818-823 — directory tab bar and search input HTML
- `src/monitor.ts` lines 892-904 — `switchTab()` function
- `src/monitor.ts` lines 1928-1935 — `switchDirTab()` function
- `src/monitor.ts` lines 2013-2090 — `buildContactCard()` function with Contact Settings panel
- `src/monitor.ts` lines 2150-2267 — group filter override section HTML and load/save functions
- `src/inbound.ts` lines 327-332, 572-660 — pairing mode full implementation
- `src/channel.ts` lines 667-671, 752-755 — pairing config and policy resolution
- `tests/ui-tag-input.test.ts` — existing normalizeTags test (UX-03 foundation)
- `tests/ui-god-mode-field.test.ts` — Phase 8 test pattern to follow
- `.planning/phases/08-shared-ui-components/08-02-PLAN.md` — createTagInput, createContactPicker, createGodModeUsersField specs

### Secondary (MEDIUM confidence)
- `.planning/ROADMAP.md` Phase 9 entry — requirement definitions and success criteria
- `.planning/quick/260315-wo2-.../260315-wo2-PLAN.md` — original bug-to-requirement mapping with bug context

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, all existing patterns reused
- Architecture: HIGH — all insertion points located precisely in monitor.ts with exact line numbers
- Pitfalls: HIGH — most pitfalls already encountered and documented in Phase 8 decisions (lazy init, DOM timing, per-group instance management)
- Pairing mode: MEDIUM — code exists but end-to-end correctness requires live test before UI decision

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable admin panel, no external API changes expected)
