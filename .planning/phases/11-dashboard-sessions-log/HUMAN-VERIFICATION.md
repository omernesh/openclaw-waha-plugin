# Phase 11: Dashboard, Sessions & Log — Human Verification Plan

**Deployed:** 2026-03-16
**Admin Panel:** http://100.114.126.43:3008 (bot) or http://100.114.126.43:3009 (human)

---

## 1. Dashboard Tab — Multi-Session Display (DASH-01)

### 1a. All sessions visible
- [ ] Open admin panel, click **Dashboard** tab
- [ ] Session card shows **both** sessions (omer + logan) — not just one
- [ ] Each session row shows: name, role badge, subRole badge, health dot, WAHA status

### 1b. Health indicators
- [ ] Health dot is **green** for connected sessions
- [ ] WAHA status text shows actual state (e.g., "WORKING", "CONNECTED")
- [ ] Role badges display correctly (e.g., "human" for omer, "bot" for logan)

### 1c. Error resilience
- [ ] If WAHA API is temporarily unreachable, dashboard shows a red error message instead of blank/stale content

---

## 2. Sessions Tab — Role Editing (SESS-01)

### 2a. Dropdowns render
- [ ] Click **Sessions** tab (or Status tab depending on UI)
- [ ] Each session has a **role dropdown** (options: bot, human)
- [ ] Each session has a **subRole dropdown** (options: full-access, listener)
- [ ] "This view is read-only" text is **gone** — replaced with "Changes take effect after gateway restart"

### 2b. Save round-trip
- [ ] Change a role dropdown value (e.g., swap omer from "human" to "bot")
- [ ] Verify a success toast appears
- [ ] **Reload the page** — verify the dropdown still shows the new value (persisted to openclaw.json)
- [ ] **Revert** the change back to the correct value after testing

### 2c. Validation
- [ ] Verify subRole only allows "full-access" or "listener" (no free-text)
- [ ] Role only allows "bot" or "human"

### 2d. Config file integrity
- [ ] SSH to hpg6: `cat ~/.openclaw/openclaw.json | python3 -m json.tool` — verify valid JSON, no corruption

---

## 3. Log Tab — Structured Display (LOG-01)

### 3a. Formatted entries
- [ ] Click **Log** tab (or whichever tab shows gateway logs)
- [ ] Log entries are **individual rows/divs** — not a single monolithic `<pre>` block
- [ ] Each entry has a **timestamp column** on the left (e.g., "Mar 16 21:34:54")
- [ ] Each entry has a **message body** on the right

### 3b. Level badges
- [ ] Entries with errors show a **red** level badge
- [ ] Entries with warnings show a **yellow/amber** level badge
- [ ] Info-level entries show a **cyan/blue** badge
- [ ] Debug entries show a **gray** badge

### 3c. Visual separation
- [ ] Clear visual separation between log entries (border, spacing, or alternating background)
- [ ] Timestamps are visually distinct from message text (different color/font)

### 3d. Functional parity
- [ ] **Auto-scroll** still works (new entries appear at bottom, view scrolls down)
- [ ] **Search/filter** still works if previously available
- [ ] Non-journalctl formatted lines degrade gracefully (no timestamp, full line as message)

---

## 4. Regression Checks

### 4a. Existing functionality
- [ ] Config tab still loads and saves settings
- [ ] Directory tab still shows contacts/groups
- [ ] Filter Stats tab still shows message counts
- [ ] Gateway restart button still works

### 4b. WhatsApp message flow
- [ ] Send a test message to Sammie — verify he responds normally
- [ ] Check gateway logs show no errors related to phase 11 changes

---

## Sign-Off

| Area | Status | Notes |
|------|--------|-------|
| DASH-01: Multi-session | | |
| SESS-01: Role editing | | |
| LOG-01: Structured logs | | |
| Regressions | | |

**Verified by:** _______________
**Date:** _______________
