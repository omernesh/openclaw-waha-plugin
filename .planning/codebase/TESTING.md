# Testing Patterns

**Analysis Date:** 2026-03-11

## Test Framework

**Runner:**
- No test framework installed
- No test files exist in the codebase (no `*.test.ts`, `*.spec.ts`, or `__tests__/` directories)
- No test configuration files (no `jest.config.*`, `vitest.config.*`, etc.)
- No test scripts in `package.json`

**Dependencies:**
- `devDependencies` contains only `typescript` (^5.9.3)
- No testing libraries: no jest, vitest, mocha, tap, or assertion libraries

## Current Testing Approach

**Manual testing only.** All testing is performed via live WhatsApp messages:

1. Make code changes locally
2. SCP files to remote server (hpg6) to both deployment locations
3. Restart gateway: `systemctl --user restart openclaw-gateway`
4. Send test messages via WhatsApp (WAHA API or directly through the app)
5. Check gateway logs: `journalctl --user -u openclaw-gateway --since "5 minutes ago" --no-pager`
6. Verify response in WhatsApp test group or DM

**Test Commands (current):**
```bash
# No automated test commands available
# Manual test via WAHA API:
curl -X POST http://127.0.0.1:3004/api/sendText \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: <key>" \
  -d '{"chatId":"<groupId>","text":"test message","session":"3cf11776_omer"}'

# Check logs after testing:
ssh omer@100.114.126.43 'journalctl --user -u openclaw-gateway --since "5 minutes ago" --no-pager'
```

## Test Coverage

**Requirements:** None enforced. No coverage tooling configured.

**Coverage Status:** 0% automated test coverage across all 6,994 lines of TypeScript.

## Testable Units (candidates for future testing)

The following modules have pure or near-pure functions that could be unit tested without mocking external services:

**`src/normalize.ts` (26 lines):**
- `normalizeWahaMessagingTarget()` - string normalization, no dependencies
- `normalizeWahaAllowEntry()` - string normalization
- `resolveWahaAllowlistMatch()` - allowlist matching logic

**`src/dm-filter.ts` (145 lines):**
- `DmFilter.check()` - keyword filtering with regex cache
- `normalizePhoneIdentifier()` (private, but could be extracted) - phone number normalization

**`src/signature.ts` (29 lines):**
- `verifyWahaWebhookHmac()` - HMAC verification, only depends on `node:crypto`

**`src/media.ts` (503 lines):**
- `preprocessVCard()` - vCard string parsing, no external calls
- `preprocessDocument()` - document metadata extraction, no external calls
- `detectImageMime()` (private) - buffer-based MIME detection
- `parseVCardString()` (private) - vCard field extraction

**`src/send.ts` (1588 lines):**
- `buildFilePayload()` - file/URL payload construction
- `resolveMime()` (private) - MIME type resolution from file extension
- `assertAllowedSession()` - session validation guard

**`src/accounts.ts` (149 lines):**
- `listWahaAccountIds()` - account ID listing from config
- `resolveDefaultWahaAccountId()` - default account selection
- Account config merging logic

**`src/monitor.ts` (2280 lines):**
- `parseWebhookPayload()` (private) - JSON parsing with validation
- `payloadToInboundMessage()` (private) - payload transformation
- `normalizeTimestamp()` (private) - timestamp normalization

## Integration Test Candidates

These would require mocking the WAHA HTTP API or the OpenClaw plugin SDK:

**`src/send.ts`:**
- All `sendWaha*` functions call `callWahaApi()` -- mock `fetch()` to test request construction
- Media type routing in `sendWahaMedia()` based on MIME detection

**`src/channel.ts`:**
- `handleAction()` action dispatch -- mock send functions to verify routing
- `autoResolveTarget()` name-to-JID resolution flow

**`src/inbound.ts`:**
- `handleWahaInbound()` full pipeline -- mock SDK deliverer and send functions

**`src/directory.ts`:**
- `DirectoryDb` class -- use in-memory SQLite (better-sqlite3 supports `:memory:`)

## Recommended Test Setup

If adding tests to this project, use:

**Framework:** Vitest (ESM-native, compatible with `"type": "module"`)
```bash
npm install -D vitest
```

**Config:** `vitest.config.ts`
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
  },
});
```

**package.json scripts:**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Test file location:** Co-located with source files
```
src/
  normalize.ts
  normalize.test.ts
  dm-filter.ts
  dm-filter.test.ts
  signature.ts
  signature.test.ts
```

**Mocking approach for WAHA API calls:**
```typescript
// Mock fetch globally for send.ts tests
import { vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Setup mock response
mockFetch.mockResolvedValueOnce({
  ok: true,
  headers: { get: () => "application/json" },
  json: async () => ({ key: { id: "msg123" } }),
});
```

**SQLite testing:**
```typescript
// Use in-memory database for directory.ts tests
const db = new DirectoryDb(":memory:");
```

## Verification Markers

The codebase uses inline verification markers instead of automated tests:
- `// Verified 2026-03-10` and `// Verified working 2026-03-10` throughout
- `// VERIFIED WORKING -- DO NOT MODIFY WITHOUT READING THIS` blocks
- `// Last verified: 2026-03-10 -- all 7/8 actions PASS`

These serve as manual test documentation but provide no regression protection.

---

*Testing analysis: 2026-03-11*
