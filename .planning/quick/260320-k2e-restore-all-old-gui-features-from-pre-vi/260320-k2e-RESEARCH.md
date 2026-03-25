# Old vs New Admin Panel Feature Comparison

## Critical Missing Features

### 1. BULK SELECT MODE (Directory Tab)
- Select button to toggle bulk mode
- Checkboxes on all items
- Fixed bottom toolbar showing selected count + bulk actions
- Bulk Allow/Revoke DM for contacts
- Bulk Allow/Revoke Group for group participants
- Bulk Set Role for participants

### 2. PER-GROUP FILTER OVERRIDE UI (Directory Tab)
- Modal/panel to edit keyword patterns per group
- Save override per group
- Indicator showing "inheriting global" when not overridden
- API: GET/PUT /api/admin/directory/:jid/filter

### 3. PER-CONTACT SETTINGS (Directory Tab - ContactSettingsSheet)
Missing fields that existed in old GUI:
- Can Initiate dropdown (default/allow/block) - 3-state override
- Mode dropdown (active/listen_only)
- Mention Only checkbox
- Custom Keywords override (per-contact keyword patterns)

## Tabs Status
- Dashboard: COMPLETE
- Settings: COMPLETE
- Directory: MISSING bulk ops, group filter override, contact settings fields
- Sessions: COMPLETE
- Log: COMPLETE
- Queue: COMPLETE
- Modules: NEW (not in old GUI)
- Analytics: NEW (not in old GUI)
