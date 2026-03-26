# Phase 8: Shared UI Components - Research

**Researched:** 2026-03-16
**Domain:** Vanilla HTML/CSS/JS UI components embedded in monitor.ts string template
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | All JID/LID/phone number displays show resolved human-readable contact names | Name Resolver component: calls `GET /api/admin/directory/:jid`, shows shimmer while loading, falls back to raw JID on 404 |
| UI-02 | Tag-style input works with comma/space/enter to create bubbles with 'x' to delete | Tag Input component: flex-wrap container styled as `.field input`, keyboard event handler, `getValue()`/`setValue()` API |
| UI-03 | Contact picker supports UTF-8 (Hebrew + English) fuzzy search with multi-select | Contact Picker component: debounced `GET /api/admin/directory?search=&limit=20`, system-ui font handles both scripts, multi-select with checkmark state |
| UI-04 | God Mode Users shows names with remove buttons, adding/removing handles paired JIDs (@c.us + @lid) | God Mode Users Field: wraps Contact Picker in paired-JID mode, serializes to `[{identifier:...}]` format that `saveSettings` already expects |
</phase_requirements>

---

## Summary

Phase 8 builds 4 reusable UI components that replace raw textarea fields and bare JID displays throughout the admin panel. All components are hand-written vanilla HTML/CSS/JS — there is no React, no build step, no external dependencies. Every component lives as a JS factory function and associated CSS inside the single `buildAdminHtml()` string template in `src/monitor.ts` (currently 2,923 lines).

The design system is a dark theme already fully defined in the existing `<style>` block. Color tokens, typography scale, spacing scale, and component classes (`.card`, `.avatar`, `.tag`, `.pattern`, `.field`, `.tip`, `.toggle`) all exist and must be matched exactly. The UI-SPEC.md documents the full approved design contract; the planner must treat that document as canonical.

The most complex component is the Contact Picker (UI-03/UI-04) because it owns dropdown positioning, focus trapping, debounced fetching, and paired-JID resolution. The simplest is the Name Resolver (UI-01), which is a fire-and-forget `fetch()` call that updates a span after the card renders.

**Primary recommendation:** Implement all four components in a single plan wave as factory functions (`createNameResolver`, `createTagInput`, `createContactPicker`, `createGodModeUsersField`) injected into the existing `<script>` block, with CSS additions prefixed `.cp-` / `.ti-` to avoid collisions.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS (no framework) | N/A | All component logic | No build step; admin panel is an embedded HTML string in TypeScript |
| Existing monitor.ts CSS | In-file | Design system tokens | Already in production; Phase 8 must use same values |
| `GET /api/admin/directory` | Existing API | Contact search/list | Already returns `{contacts, total, dms, groups, newsletters}` |
| `GET /api/admin/directory/:jid` | Existing API | Single-contact resolution | Returns contact object `{jid, displayName, isGroup, dmSettings, ...}` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.0.18 (project) | Unit tests for JS utility functions | Phase requires test coverage per config.json `nyquist_validation: true` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vanilla JS factory functions | Web Components (Custom Elements) | Web Components require shadow DOM / custom element registry — overkill, breaks inline style inheritance from existing `.field` rules |
| Vanilla JS factory functions | React/Preact injected via CDN | CDN dependency, separate render tree, no TypeScript build anyway — not worth it |
| `GET /api/admin/directory?search=` | Client-side fuzzy search | Would need to load all contacts upfront; server already does SQL LIKE search with correct @lid filtering |

**Installation:** No new npm packages required.

---

## Architecture Patterns

### Recommended Project Structure

```
src/monitor.ts (existing — all changes here)
├── <style> block (~line 270)    — add .ti-*, .cp-*, .nr-* CSS classes
└── <script> block (~line 854)
    ├── createNameResolver()     — UI-01
    ├── createTagInput()         — UI-02
    ├── createContactPicker()    — UI-03/UI-04
    └── createGodModeUsersField() — UI-04 wrapper
```

No new files. All code is added within the `buildAdminHtml()` return string.

### Pattern 1: JS Factory Function Component

**What:** A function that takes a container element ID (or element) plus options, creates the DOM subtree imperatively, and returns a controller object with `getValue()` and `setValue()` methods.

**When to use:** For all 4 components. Avoids global state conflicts when multiple instances exist (e.g., two God Mode Users fields — DM and group filter).

**Example (Tag Input):**
```javascript
// Pattern used throughout existing monitor.ts script block
function createTagInput(containerId, opts) {
  var container = document.getElementById(containerId);
  if (!container) return null;
  var tags = [];
  // build DOM imperatively (createElement, appendChild)
  // ...
  return {
    getValue: function() { return tags.slice(); },
    setValue: function(arr) { tags = arr.slice(); renderTags(); }
  };
}
```

### Pattern 2: Shimmer Skeleton (for Name Resolver loading state)

**What:** CSS `@keyframes shimmer` animation using `background: linear-gradient(90deg, ...)` on a placeholder element. Replaced by real content on fetch resolve.

**When to use:** Name Resolver loading state (UI-01 spec requirement).

**Example:**
```css
/* Add to existing <style> block */
@keyframes nr-shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}
.nr-skeleton {
  background: linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%);
  background-size: 400px 100%;
  animation: nr-shimmer 1.2s ease-in-out infinite;
  border-radius: 4px;
}
```

### Pattern 3: Dropdown with Outside-Click Dismiss

**What:** Contact Picker dropdown is `position: absolute` inside a `position: relative` wrapper. Dismissed on `document.mousedown` if target is outside the picker root. Dismissed on Escape key.

**When to use:** Contact Picker dropdown (UI-03).

**Example:**
```javascript
// Standard pattern — used in existing tooltip code in monitor.ts
var dismissHandler = function(e) {
  if (!pickerRoot.contains(e.target)) closeDropdown();
};
document.addEventListener('mousedown', dismissHandler);
// Remove on component destroy (if needed)
```

### Pattern 4: Debounced Search

**What:** `clearTimeout` + `setTimeout` pattern for debouncing search input. 300ms delay matches existing `debouncedDirSearch` and `debouncedLogSearch` in monitor.ts.

**When to use:** Contact Picker search input.

**Example:**
```javascript
// Source: existing debouncedDirSearch() pattern in monitor.ts
var searchTimeout = null;
inputEl.addEventListener('input', function() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(function() { doSearch(inputEl.value); }, 300);
});
```

### Pattern 5: Paired JID Handling

**What:** When a contact is selected for God Mode Users, both `@c.us` and `@lid` JIDs must be included in the saved config (because NOWEB sends `@lid` format). The Contact Picker must resolve the paired JID at selection time.

**How:** When a contact is picked, call `GET /api/admin/directory?search={name}&limit=5` or look up the known `@lid` from the directory contact object if available. The directory contact object may include a paired JID field. On save, serialize selected items as `[{identifier: "jid@c.us"}, {identifier: "lid@lid"}]`.

**Critical:** The existing `saveSettings()` `splitLines(getVal('s-godModeSuperUsers')).map(function(id) { return { identifier: id }; })` must be replaced by calling `getValue()` on the component, which returns already-paired identifiers.

### Pattern 6: CSS Class Prefix Isolation

**What:** All new CSS classes use component-specific prefixes to avoid collision with the ~50 existing classes.

**Prefixes:**
- Name Resolver: `.nr-`
- Tag Input: `.ti-`
- Contact Picker: `.cp-`

**When to use:** Every new CSS rule in Phase 8.

### Anti-Patterns to Avoid

- **innerHTML for interactive elements:** Existing code uses `innerHTML` extensively for static lists. But Phase 8 components need event listeners — use `createElement` + `addEventListener` directly, not inline `onclick` on dynamically created elements. (Exception: non-interactive display updates can still use innerHTML for performance.)
- **Direct fetch inside CSS animation loop:** Name Resolver fires one `fetch()` per resolved JID. Do not poll or re-fetch on animation tick.
- **Global component registry:** Do not store component instances in global variables. Store them as closures or `data-*` attributes on the container element.
- **Reading textarea value after replacing with component:** When `loadConfig()` calls `setVal('s-godModeSuperUsers', ...)`, that element will be replaced by the component. Call `component.setValue(arr)` directly from `loadConfig()` instead.
- **Adding styles via `element.style` for hover effects:** Use CSS classes with pseudo-selectors in the `<style>` block. Inline `style` attributes cannot use `:hover`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UTF-8 fuzzy search | Custom JS Unicode-aware fuzzy matcher | `GET /api/admin/directory?search=` (server-side SQL LIKE) | `LIKE %query%` is already normalized correctly in `directory.ts`; building client-side would require loading all contacts |
| JID resolution cache | In-component fetch cache map | Per-component Map inside closure (acceptable) | Tiny scope — no need for external LRU; component lifetime is same as page load |
| Dropdown z-index management | Complex z-index hierarchy | `z-index: 300` (matches existing `.tip::after` at 200) | Existing z-index stack: header=100, tooltip=200, picker=300, restart overlay=99999 |
| Contact data normalization | Duplicate @lid filtering logic | Already handled in `directory.ts` SQL queries (AP-02 fix from Phase 7) | The `GET /api/admin/directory?search=` endpoint already excludes @lid ghost entries |

---

## Common Pitfalls

### Pitfall 1: loadConfig() Still Reads Old textarea IDs

**What goes wrong:** After replacing the `<textarea id="s-godModeSuperUsers">` with a component container `<div id="s-godModeSuperUsers-picker">`, `loadConfig()` still calls `setVal('s-godModeSuperUsers', ...)` which does nothing (element not found).

**Why it happens:** The HTML and JS are both inside the same string template. The HTML element ID changes but the JS `loadConfig` function isn't updated to match.

**How to avoid:** In the same edit that removes the textarea, update `loadConfig()` to call `godModePickerDm.setValue(dmGodUsers)` and update `saveSettings()` to call `godModePickerDm.getValue()`.

**Warning signs:** God Mode Users field is empty on page load even though config has values.

### Pitfall 2: Component Init Before DOM is Ready

**What goes wrong:** Factory functions called at the top of `<script>` block before the DOM elements they target exist.

**Why it happens:** The HTML structure is static (no dynamic injection) but the `<script>` block runs synchronously.

**How to avoid:** Call `createTagInput(...)`, `createContactPicker(...)` etc. inside `loadConfig()` the first time it's called, OR after a `DOMContentLoaded` guard, OR at the bottom of the `<script>` block (existing monitor.ts pattern — IIFE at bottom).

**Warning signs:** `document.getElementById(containerId)` returns null inside factory function.

### Pitfall 3: Multiple Instances Share State

**What goes wrong:** DM God Mode Users and Group God Mode Users both use Contact Picker. If state is stored in shared module-level variables, selecting a contact in one picker affects the other.

**Why it happens:** Forgetting to close over state in the factory function.

**How to avoid:** All state (`tags`, `selected`, `results`) must be declared inside the factory function using `var`. Each call to `createContactPicker()` creates a new closure.

**Warning signs:** Removing a user from one God Mode Users field removes them from the other.

### Pitfall 4: Dropdown Position Overflow

**What goes wrong:** Contact Picker dropdown renders outside the viewport when the picker is near the bottom of the page.

**Why it happens:** `position: absolute; top: 100%` always opens downward.

**How to avoid:** Check `pickerRoot.getBoundingClientRect().bottom + 240` vs `window.innerHeight`. If it would overflow, open upward with `bottom: 100%; top: auto`.

**Warning signs:** Dropdown is invisible or clipped at bottom of page.

### Pitfall 5: Escape Key Propagates to Tab Switching

**What goes wrong:** Pressing Escape to close the picker dropdown also triggers some other handler higher up the DOM.

**Why it happens:** No `stopPropagation()` on the keydown handler.

**How to avoid:** In the keydown handler for Escape, call `e.stopPropagation()` after closing the dropdown.

### Pitfall 6: Paired JID Resolution Returns No @lid

**What goes wrong:** Some contacts in the directory have no @lid counterpart (e.g., newsletter subscriptions, contacts added before LID migration).

**Why it happens:** Not all WAHA contacts have a known @lid.

**How to avoid:** Paired JID resolution is best-effort. If no @lid is found, include only the @c.us identifier. Do not error — silently include only what is available.

---

## Code Examples

Verified patterns from existing monitor.ts:

### Existing `esc()` HTML escaping (must be used in all component HTML output)
```javascript
// Source: monitor.ts line 880
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
```

### Existing `avatarColor()` and `initials()` (reuse in Contact Picker result rows)
```javascript
// Source: monitor.ts lines 893-903
function avatarColor(jid) {
  var colors = ['#e11d48','#d97706','#16a34a','#0284c7','#7c3aed','#be185d','#0891b2','#15803d'];
  var hash = 0;
  for (var i = 0; i < jid.length; i++) hash = (hash * 31 + jid.charCodeAt(i)) & 0x7fffffff;
  return colors[hash % colors.length];
}
function initials(name, jid) {
  var s = name || jid;
  var parts = s.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.substring(0, 2).toUpperCase();
}
```

### Existing `showToast()` (use for error feedback in contact picker)
```javascript
// Source: monitor.ts lines 905-911
function showToast(msg, isError) { /* ... */ }
```

### Existing directory API response shape (for UI-03 search results)
```javascript
// GET /api/admin/directory?search=&limit=20&type=contact
// Response: { contacts: [{jid, displayName, isGroup, messageCount, lastMessageAt, dmSettings, allowedDm}], total, dms, groups, newsletters }
// GET /api/admin/directory/:jid
// Response: {jid, displayName, isGroup, messageCount, lastMessageAt, dmSettings} or 404
```

### Existing `.pattern` class (matches Tag Input bubble spec exactly)
```css
/* Source: monitor.ts line 292 */
.pattern { background: #0ea5e9; color: #fff; font-size: 0.8rem; padding: 3px 10px; border-radius: 9999px; font-family: monospace; }
```

### Existing `.tag` class (matches Contact Picker name chip spec)
```css
/* Source: monitor.ts line 304 */
.tag { background: #1e3a5f; color: #7dd3fc; font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; font-family: monospace; }
```

### Existing `.avatar` class (reuse for contact rows in picker dropdown)
```css
/* Source: monitor.ts line 354 */
.avatar { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1rem; flex-shrink: 0; }
```

### loadConfig() God Mode Users current pattern (to be replaced)
```javascript
// Source: monitor.ts lines 1209-1210, 1217-1218
var dmGodUsers = (dm.godModeSuperUsers || []).map(function(u) { return typeof u === 'string' ? u : (u.identifier || ''); }).filter(Boolean);
setVal('s-godModeSuperUsers', dmGodUsers.join(NL));
// After Phase 8: replace with godModePickerDm.setValue(dmGodUsers)
```

### saveSettings() God Mode Users serialization (to be replaced)
```javascript
// Source: monitor.ts lines 1277, 1285
godModeSuperUsers: splitLines(getVal('s-godModeSuperUsers')).map(function(id) { return { identifier: id }; }),
// After Phase 8: replace with godModePickerDm.getValue().map(function(id) { return { identifier: id }; })
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| Raw textarea for JID lists | Tag Input bubble component | Visual clarity, less error-prone input (no trailing newlines) |
| Bare JID display in dashboard access-control kv rows | Name Resolver with shimmer | Human-readable — especially important for Hebrew names |
| Manual JID entry for God Mode Users | Contact Picker with fuzzy search | Prevents typos; handles @c.us + @lid pairing automatically |

---

## Integration Points

### Where Name Resolver (UI-01) Will Be Used

1. Dashboard tab — `access-kv` div: `allowFrom`, `groupAllowFrom`, `allowedGroups` tag lists currently show raw JIDs
2. Any future phase that displays JIDs can call `createNameResolver(containerEl, jid)` instead of displaying raw strings

### Where Tag Input (UI-02) Will Replace Textareas

- `s-allowFrom` textarea (Access Control section)
- `s-groupAllowFrom` textarea (Access Control section)
- `s-allowedGroups` textarea (Access Control section)
- `s-mentionPatterns` textarea (DM Keyword Filter) — note: these are regex patterns not JIDs, still tag-style
- `s-groupMentionPatterns` textarea (Group Keyword Filter)

**Scope clarification:** The UI-SPEC and requirements focus on JID-list inputs. The planner should scope Phase 8 to the JID-list textareas that directly relate to UI-02/UI-03/UI-04 requirements. Mention pattern textareas are regex-pattern inputs and may be better served by Phase 9 (Settings UX) rather than Phase 8.

### Where God Mode Users Field (UI-04) Replaces Textareas

- `s-godModeSuperUsers` textarea (DM Keyword Filter section) — primary target
- `s-groupGodModeSuperUsers` textarea (Group Keyword Filter section) — secondary target

Both share the same component type (`createGodModeUsersField`) initialized with different element IDs.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run tests/ui-components.test.ts --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

UI components are vanilla JS inside a template string — they cannot be directly unit-tested with vitest (no DOM). The appropriate test strategy is:

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Name Resolver fetches and displays name | manual smoke (browser) | N/A — DOM-only | N/A |
| UI-02 | Tag Input getValue()/setValue() logic | unit (extract logic) | `npx vitest run tests/tag-input-utils.test.ts -x` | ❌ Wave 0 |
| UI-02 | Tag Input comma/space/enter creates tag | manual smoke (browser) | N/A — DOM event | N/A |
| UI-03 | Contact Picker selected-items array management | unit (extract logic) | `npx vitest run tests/contact-picker-utils.test.ts -x` | ❌ Wave 0 |
| UI-03 | Contact Picker fuzzy search debounce | manual smoke (browser) | N/A — DOM + fetch | N/A |
| UI-04 | God Mode paired JID serialization | unit | `npx vitest run tests/god-mode-field.test.ts -x` | ❌ Wave 0 |

**Note on UI testing:** Since components are embedded in a template string and rely on `document.*`, the practical testing strategy is:
1. Extract pure logic functions (JID pairing, tag normalization) into testable helper functions at the top of the `<script>` block.
2. Write vitest unit tests for those pure logic functions.
3. Manual smoke tests verify the DOM behavior.

### Sampling Rate

- **Per task commit:** `npm test` (full suite, existing tests must not regress)
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + manual smoke test of all 4 components

### Wave 0 Gaps

- [ ] `tests/tag-input-utils.test.ts` — covers UI-02 pure logic (tag normalization, getValue/setValue contract)
- [ ] `tests/contact-picker-utils.test.ts` — covers UI-03 selection array management, paired JID serialization
- [ ] `tests/god-mode-field.test.ts` — covers UI-04 paired JID format, identifier extraction from `godModeSuperUsers` config format

---

## Open Questions

1. **Which textareas get Tag Input vs Contact Picker?**
   - What we know: UI-SPEC specifies Contact Picker for God Mode Users (UI-04); Tag Input for JID lists generally (UI-02)
   - What's unclear: Should `allowFrom`, `groupAllowFrom`, `allowedGroups` get Tag Input (plain bubbles) or Contact Picker (search+select)?
   - Recommendation: Use Tag Input (no search) for `allowFrom`/`groupAllowFrom`/`allowedGroups` and Contact Picker only for God Mode Users. This is lower scope and matches the UI-SPEC which positions Contact Picker specifically for God Mode.

2. **Paired JID source: where does the @lid come from?**
   - What we know: The directory stores contacts by JID. Some contacts may have a linked @lid if it was resolved during a previous WAHA API call.
   - What's unclear: Does `GET /api/admin/directory?search=` return both JIDs in the contact record, or only the primary JID?
   - Recommendation: Check `directory.ts` `getContacts()` — if it joins with a `lids` table or stores @lid in the contact row, use that. Otherwise, the Contact Picker can include only the @c.us JID and document that @lid must be added manually. For Phase 8, best-effort pairing is acceptable.

3. **Initialization timing: loadConfig() vs DOMContentLoaded?**
   - What we know: `loadConfig()` is called when the Settings tab is activated (`switchTab('settings', ...)`). The DOM elements exist at that point.
   - What's unclear: If `loadConfig()` is called before the factory functions are defined (script execution order), it will fail.
   - Recommendation: Define factory functions before `loadConfig()` in the `<script>` block (add them near the helpers section around line 880). Initialize component instances at the bottom of the script block (not inside `loadConfig()`) so they exist on page load.

---

## Sources

### Primary (HIGH confidence)

- `src/monitor.ts` (project file, 2,923 lines) — complete current admin panel implementation; all existing CSS classes, JS patterns, API endpoints, and form field IDs verified by direct read
- `.planning/phases/08-shared-ui-components/08-UI-SPEC.md` (project file) — approved design contract; all tokens, component specs, and copywriting contract verified as source of truth
- `.planning/REQUIREMENTS.md` (project file) — UI-01 through UI-04 requirement text
- `.planning/ROADMAP.md` (project file) — Phase 8 goal and success criteria

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` — Phase 7 completion confirmed, Phase 8 is next; no pending blockers
- Existing tests in `tests/` — test pattern (vitest, factory functions, pure logic extraction) confirmed from 27 existing test files

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no external dependencies; all decisions derived from reading the actual file
- Architecture: HIGH — factory function pattern is already used throughout existing monitor.ts (sessions rendering, contact card building)
- Pitfalls: HIGH — derived from reading the exact code paths that will be modified (`loadConfig`, `saveSettings`, textarea IDs)
- Validation: MEDIUM — UI component logic is partially testable (pure functions); DOM behavior requires manual smoke test

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable codebase; monitor.ts changes would invalidate)
