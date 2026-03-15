# Changelog

All notable changes to the OpenClaw WAHA Plugin are documented here.

## [1.12.0] - 2026-03-15

### Added
- **Cross-session message dedup**: Bot sessions claim messages first (200ms priority), human sessions drop duplicates. Prevents double-processing and token waste in multi-session setups.
- **Trigger operator for DMs**: Trigger word detection now works for both DMs and group messages (previously groups only). DM filter respects trigger bypass.
- **God mode scope**: New `godModeScope` config field ("all", "dm", "off") controls where superuser filter bypass applies. Prevents bot from accidentally responding in groups on behalf of human users.
- **Bot proxy prefix**: When bot sends through a human session (cross-session routing), messages are prefixed with 🤖 to distinguish bot responses from human messages.
- **Configurable trigger operator**: Admin panel now has Trigger Operator section with text input for trigger word and response mode dropdown.
- **Multi-session filtering guide**: Admin panel Config tab includes collapsible documentation explaining message flow, scenarios, and guardrail layers.

### Changed
- Human sessions defer 200ms before processing to give bot sessions priority for claiming messages
- God mode scope defaults to "all" (backward compatible) but recommended "dm" for group safety

### Fixed
- Race condition in cross-session dedup: `claimMessage` now uses claim-if-unclaimed semantics (prevents double-processing)
- Empty messageId guard prevents all ID-less messages from being treated as duplicates
- Added `groupFilter` to Zod strict schema (prevents potential startup crash)
- Bot proxy prefix now applied to media captions (was only on text replies)
- Invalid regex patterns in keyword filter are skipped individually instead of disabling all filtering
- Unrecognized `godModeScope` values now log a warning instead of silently disabling bypass

## [1.11.1] - 2026-03-14

### Fixed
- Plugin name mismatch on deploy: `openclaw.plugin.json` now included in npm package
- Excluded `.bak` files and internal design docs from npm package
- Added `rules/` seed YAML files to npm package

## [1.11.0] - 2026-03-14

### Added
- **Phase 6**: File-based YAML rules/policy system with hierarchical contact/group policies
- **Phase 6**: Manager authorization for policy edits (owner-only appoint/revoke)
- **Phase 6**: Compact resolved-policy injection into model context per event
- **Phase 6**: Identity normalization for stable JID/LID mapping
- **Phase 6**: Outbound policy enforcement (fail-open design)
- **Phase 5**: Human mimicry presence system with realistic typing indicators, read receipts, and random pauses
- **Phase 4**: Multi-session roles (`bot`/`human` with `full-access`/`listener` sub-roles)
- **Phase 4**: Trigger word activation for group chats
- **Phase 4**: Cross-session routing (bot session with human session fallback)
- **Phase 4**: `readMessages` action for reading recent messages from any chat (1-50)
- **Phase 4**: Sessions tab in admin panel
- **Phase 3**: `muteChat`/`unmuteChat` actions
- **Phase 3**: `sendMulti` action for sending text to multiple chats
- **Phase 3**: Auto link preview for URLs in text messages
- **Phase 3**: Mention extraction from inbound messages
- **Phase 2**: Session health monitoring with automatic health pings
- **Phase 2**: Inbound message queue with separate DM and group queues
- **Phase 1**: Request timeouts on all WAHA API calls (configurable `timeoutMs`)
- **Phase 1**: Token-bucket rate limiting (`rateLimitCapacity`/`rateLimitRefillRate`)
- **Phase 1**: Automatic retry with exponential backoff (up to 3 retries)
- **Phase 1**: Webhook deduplication by messageId

## [1.9.4] - 2026-03-10

### Added
- Contact card (vCard) sending
- `joinGroup` action
- `followChannel`/`unfollowChannel` actions
- `sendImage`, `sendVideo`, `sendFile` as explicit actions

## [1.9.3] - 2026-03-10

### Fixed
- Media sent as proper WhatsApp media types (not document attachments)
- MIME detection for URLs with query parameters

## [1.9.0] - 2026-03-10

### Changed
- **BREAKING**: `listActions()` returns only gateway-standard action names

### Added
- Auto name-to-JID resolution via `autoResolveTarget`
- Session role guardrails

## [1.8.x] - 2026-03-08 to 2026-03-09

### Fixed
- Directory fixes
- Duplicate webhook prevention
- Config save path fix

### Added
- Admin panel

## [1.4.0] - 2026-03-08

### Fixed
- Typing indicator flicker fix

### Added
- Admin panel media preprocessing toggles
- Directory refresh
