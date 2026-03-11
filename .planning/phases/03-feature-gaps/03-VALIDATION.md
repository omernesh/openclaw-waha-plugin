---
phase: 03
slug: feature-gaps
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts (exists from Phase 1) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose` + manual WhatsApp verification of affected features
- **Before `/gsd:verify-work`:** Full suite must be green + all manual verifications passed
- **Max feedback latency:** 5 seconds (automated), same-day (manual)

---

## Per-Task Verification Map

| Task ID | Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|---------|-------------|----------|-----------|-------------------|-------------|--------|
| 03-01-01 | FEAT-01 | URL regex detects http/https URLs | unit | `npx vitest run tests/link-preview.test.ts -t "detects URLs" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-01-02 | FEAT-01 | linkPreview: true added to WAHA body when URL present | unit | `npx vitest run tests/link-preview.test.ts -t "adds linkPreview" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-01-03 | FEAT-01 | linkPreview omitted when no URL in text | unit | `npx vitest run tests/link-preview.test.ts -t "no URL" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-01-04 | FEAT-01 | autoLinkPreview config false disables detection | unit | `npx vitest run tests/link-preview.test.ts -t "config disables" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-02-01 | FEAT-02 | sendWahaLinkPreview exists and is registered | manual-verify | Code inspection — verify send.ts:591 and utility action registration | N/A | ⬜ pending |
| 03-03-01 | FEAT-03 | muteWahaChat calls correct WAHA endpoint | unit | `npx vitest run tests/chat-mute.test.ts -t "mute calls API" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-03-02 | FEAT-03 | muteChat registered in UTILITY_ACTIONS and ACTION_HANDLERS | unit | `npx vitest run tests/chat-mute.test.ts -t "muteChat registered" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-04-01 | FEAT-04 | unmuteWahaChat calls correct WAHA endpoint | unit | `npx vitest run tests/chat-mute.test.ts -t "unmute calls API" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-04-02 | FEAT-04 | unmuteChat registered in UTILITY_ACTIONS and ACTION_HANDLERS | unit | `npx vitest run tests/chat-mute.test.ts -t "unmuteChat registered" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-05-01 | FEAT-05 | extractMentionedJids returns JIDs from _data field | unit | `npx vitest run tests/mentions.test.ts -t "extracts mentions" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-05-02 | FEAT-05 | Normalizes @s.whatsapp.net to @c.us | unit | `npx vitest run tests/mentions.test.ts -t "normalizes JIDs" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-05-03 | FEAT-05 | Returns empty array when _data missing or malformed | unit | `npx vitest run tests/mentions.test.ts -t "empty on missing" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-05-04 | FEAT-05 | mentionedJids included in ctxPayload | unit | `npx vitest run tests/mentions.test.ts -t "ctxPayload" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-06-01 | FEAT-06 | sendMulti sends to all recipients sequentially | unit | `npx vitest run tests/send-multi.test.ts -t "sends to all" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-06-02 | FEAT-06 | sendMulti caps at 10 recipients | unit | `npx vitest run tests/send-multi.test.ts -t "caps at 10" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-06-03 | FEAT-06 | sendMulti continues on per-recipient failure | unit | `npx vitest run tests/send-multi.test.ts -t "no fail-fast" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-06-04 | FEAT-06 | sendMulti returns per-recipient results | unit | `npx vitest run tests/send-multi.test.ts -t "per-recipient results" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-06-05 | FEAT-06 | sendMulti resolves names via autoResolveTarget | unit | `npx vitest run tests/send-multi.test.ts -t "resolves names" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 03-07-01 | FEAT-07 | formatActionError exists and handles known patterns | manual-verify | Code inspection — verify error-formatter.ts handles 9+ error patterns | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/link-preview.test.ts` — stubs for FEAT-01 (URL detection, linkPreview flag, config toggle)
- [ ] `tests/chat-mute.test.ts` — stubs for FEAT-03, FEAT-04 (mute/unmute API calls, action registration)
- [ ] `tests/mentions.test.ts` — stubs for FEAT-05 (extraction, normalization, empty handling, ctxPayload)
- [ ] `tests/send-multi.test.ts` — stubs for FEAT-06 (sequential send, cap, no fail-fast, results, name resolution)

*Existing test infrastructure (vitest, vitest.config.ts) carries over from Phase 1.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| URL message shows rich preview card in WhatsApp | FEAT-01 | Requires WhatsApp UI to confirm preview rendering | Send a message with a URL via Sammie, verify preview card appears in chat |
| sendWahaLinkPreview sends custom preview cards | FEAT-02 | Already implemented — code verification only | Inspect send.ts:591, confirm function exists and is registered as utility action |
| muteChat silences notifications in WhatsApp | FEAT-03 | Requires WAHA API + WhatsApp app to confirm mute state | Call muteChat via Sammie on test group, verify notifications stop |
| unmuteChat restores notifications in WhatsApp | FEAT-04 | Requires WAHA API + WhatsApp app to confirm unmute state | Call unmuteChat via Sammie on test group, verify notifications resume |
| @mention in group shows mentionedJids in gateway logs | FEAT-05 | Requires live WAHA webhook with real @mention message | Send @mention in test group, check `journalctl` logs for mentionedJids field |
| _data field path verified for NOWEB engine | FEAT-05 | Undocumented field — must inspect live payload | Log raw `_data` from a mention message, confirm extraction path matches implementation |
| sendMulti delivers to multiple real WhatsApp chats | FEAT-06 | Requires multiple real chat recipients | Ask Sammie to sendMulti to test group + DM, verify both receive the message |
| formatActionError provides helpful suggestions | FEAT-07 | Already implemented — code verification only | Inspect error-formatter.ts, confirm 9+ error patterns with suggestions |
| Chat mute WAHA endpoint method (POST vs PUT) | FEAT-03/04 | API behavior must be tested at runtime | `curl -X POST http://127.0.0.1:3004/api/3cf11776_logan/chats/{chatId}/mute -H "X-Api-Key: ..."` — if 405, try PUT |

---

## Requirements Traceability

| Requirement | Description | Automated Tests | Manual Tests | Coverage |
|-------------|-------------|-----------------|--------------|----------|
| FEAT-01 | Auto link preview on URL sends | 03-01-01 through 03-01-04 | WhatsApp preview card check | Full |
| FEAT-02 | Custom link preview (verify only) | — | 03-02-01 code inspection | Full |
| FEAT-03 | Mute chat | 03-03-01, 03-03-02 | WAHA API + WhatsApp mute check | Full |
| FEAT-04 | Unmute chat | 03-04-01, 03-04-02 | WAHA API + WhatsApp unmute check | Full |
| FEAT-05 | @mentions extraction from inbound | 03-05-01 through 03-05-04 | Live webhook + gateway log check | Full |
| FEAT-06 | Multi-recipient send | 03-06-01 through 03-06-05 | Multi-chat delivery check | Full |
| FEAT-07 | Context-rich error messages (verify only) | — | 03-07-01 code inspection | Full |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
