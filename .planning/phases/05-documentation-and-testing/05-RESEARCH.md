# Phase 5: Documentation and Testing - Research

**Researched:** 2026-03-13
**Domain:** TypeScript documentation authoring (Markdown), Vitest unit/integration testing, README writing
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DOC-01 | SKILL.md refreshed with error scenarios, rate limit guidance, and multi-session examples | Current SKILL.md audited — gaps identified in error handling, rate limits, multi-session sections |
| DOC-02 | Unit tests for fuzzyScore, toArr, resolveChatId, autoResolveTarget, LRU cache, token bucket | All six targets located in source; fuzzyScore/resolveChatId/autoResolveTarget need new tests; LRU cache and token bucket already tested |
| DOC-03 | Integration tests for action handlers (send, poll, edit, search) against mock WAHA API | Pattern established by read-messages.test.ts and send-multi.test.ts — vi.mock chain for openclaw/plugin-sdk + send.ts works |
| DOC-04 | README updated with installation steps, configuration reference, deployment instructions (both hpg6 locations), and troubleshooting guide | README.md exists at v1.9.4 — needs update to v1.11.0 with Phase 1-4 features |
</phase_requirements>

---

## Summary

Phase 5 is a documentation-and-test closure phase. All implementation work (Phases 1-4) is complete. The goal is to refresh user-facing docs (SKILL.md, README.md) and add the test coverage the codebase needs.

**Test infrastructure is already set up.** Vitest 4.x is installed, `vitest.config.ts` is configured, and 15 test files with 137 passing tests exist. The mock patterns for `openclaw/plugin-sdk`, `./http-client.js`, and `./secret-input.js` are well-established in `role-guardrail.test.ts`, `session-router.test.ts`, and `read-messages.test.ts`. New tests for DOC-02 and DOC-03 follow the same patterns.

**Key gap for DOC-02:** `fuzzyScore`, `resolveChatId`, and `autoResolveTarget` are private/unexported functions inside `send.ts` and `channel.ts`. They must either be exported (adding `export` keyword) or tested via the public-facing `resolveWahaTarget` export that wraps them. The planner must decide which path to take — direct export is simpler for unit tests; indirect via resolveWahaTarget avoids API surface change.

**Primary recommendation:** Export `fuzzyScore`, `toArr`, `resolveChatId`, and `autoResolveTarget` with minimal-exposure pattern (single test-only export object is anti-pattern; individual exports are cleaner). Then write unit tests directly. `toArr` is already exported. Integration tests follow the `read-messages.test.ts` mock chain pattern.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 (installed) | Test runner, assertions, mocks | Already in package.json devDependencies; 15 test files use it |
| TypeScript | ^5.9.3 (installed) | Type-safe test authoring | Same toolchain as source |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vi.mock | (vitest built-in) | Module mocking for openclaw/plugin-sdk | Required for any test that imports channel.ts or send.ts |
| vi.hoisted | (vitest built-in) | Hoist mock factories before module import | Required when mock fn refs needed inside vi.mock factories |
| vi.fn / vi.spyOn | (vitest built-in) | Spy on fetch, console.warn, etc. | HTTP call verification in integration tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vitest | jest | vitest already installed and working — no reason to switch |
| vi.stubGlobal("fetch") | msw (Mock Service Worker) | msw adds dependency; vi.stubGlobal pattern established in http-client.test.ts — use that |

**Installation:**
No new installations needed. All tooling is already present.

---

## Architecture Patterns

### Existing Test File Structure
```
tests/
├── http-client.test.ts      # callWahaApi, warnOnError, 429 retry, shared backoff
├── token-bucket.test.ts     # TokenBucket class
├── lru-cache.test.ts        # lru-cache library usage (max:1000, ttl:30s)
├── dedup.test.ts            # isDuplicate webhook dedup
├── error-formatter.test.ts  # formatActionError
├── health.test.ts           # startHealthCheck, health state transitions
├── inbound-queue.test.ts    # InboundQueue, DM priority, serial drain
├── mentions.test.ts         # extractMentionedJids
├── link-preview.test.ts     # link preview detection in sendWahaText
├── chat-mute.test.ts        # muteChat / unmuteChat actions
├── send-multi.test.ts       # handleSendMulti, autoResolveTarget (via mock)
├── role-guardrail.test.ts   # assertCanSend, WahaAccountSchemaBase, resolveWahaAccount
├── session-router.test.ts   # resolveSessionForTarget, membership cache
├── trigger-word.test.ts     # detectTriggerWord, resolveTriggerTarget
└── read-messages.test.ts    # readMessages action handler
```

### Pattern 1: Action Handler Integration Test (via vi.mock chain)
**What:** Mock `openclaw/plugin-sdk`, `./secret-input.js`, `./http-client.js`, then import `channel.ts`'s `handleAction`. Exercise it with controlled params.
**When to use:** DOC-03 integration tests for send, poll, edit, search action handlers.
**Example:**
```typescript
// Source: tests/read-messages.test.ts (established pattern)
const { mockGetWahaChatMessages, mockResolveWahaTarget } = vi.hoisted(() => ({
  mockGetWahaChatMessages: vi.fn(),
  mockResolveWahaTarget: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk", async () => {
  const { z } = await import("zod");
  return {
    DEFAULT_ACCOUNT_ID: "default",
    normalizeAccountId: (id: string) => id.trim().toLowerCase(),
    listConfiguredAccountIds: ({ accounts }: { accounts?: Record<string, unknown> }) =>
      accounts ? Object.keys(accounts) : [],
    resolveAccountWithDefaultFallback: ({ accountId, resolvePrimary, resolveDefaultAccountId }) =>
      resolvePrimary(accountId ?? resolveDefaultAccountId()),
    DmPolicySchema: z.string().optional(),
    GroupPolicySchema: z.string().optional(),
    MarkdownConfigSchema: z.any().optional(),
    ToolPolicySchema: z.any().optional(),
    ReplyRuntimeConfigSchemaShape: {},
    BlockStreamingCoalesceSchema: z.any().optional(),
    requireOpenAllowFrom: () => {},
    detectMime: vi.fn(),
    sendMediaWithLeadingCaption: vi.fn(),
    isWhatsAppGroupJid: (jid: string) => jid.endsWith("@g.us"),
    createLoggerBackedRuntime: vi.fn(() => ({})),
    isRequestBodyLimitError: vi.fn(() => false),
    readRequestBodyWithLimit: vi.fn(),
    requestBodyErrorToText: vi.fn(),
  };
});

vi.mock("../src/send.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/send.js")>();
  return {
    ...actual,
    sendWahaText: mockSendWahaText,
    // override specific functions while preserving toArr, fuzzyScore etc.
  };
});
```

### Pattern 2: Pure Function Unit Test (no mocks)
**What:** Export the function, import directly, test with plain inputs.
**When to use:** DOC-02 tests for `fuzzyScore`, `resolveChatId`, `toArr`.
**Example:**
```typescript
// After exporting from send.ts/channel.ts:
import { fuzzyScore, toArr } from "../src/send.js";

describe("fuzzyScore", () => {
  it("returns 1.0 for exact match", () => {
    expect(fuzzyScore("test group", "test group")).toBe(1.0);
  });
  it("returns 0.9 when name starts with query", () => {
    expect(fuzzyScore("test", "test group")).toBe(0.9);
  });
  it("returns 0 for no match", () => {
    expect(fuzzyScore("xyz", "abc")).toBe(0);
  });
  it("returns 0.1 for empty query (list-all mode)", () => {
    expect(fuzzyScore("", "anything")).toBe(0.1);
  });
});
```

### Pattern 3: Mock WAHA API for Integration Tests
**What:** Stub `global.fetch` using `vi.stubGlobal` to return controlled WAHA API responses.
**When to use:** DOC-03 tests verifying that action handlers make correct HTTP calls.
**Example:**
```typescript
// Source: tests/http-client.test.ts (established pattern)
function mockFetchOk(data: any) {
  const fn = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    headers: { get: (k: string) => k === "content-type" ? "application/json" : null },
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
```

### Anti-Patterns to Avoid
- **Importing channel.ts without mocking openclaw/plugin-sdk first:** Will throw "Cannot find module 'openclaw/plugin-sdk'" — always mock before import.
- **Using vi.mock without vi.hoisted for referenced functions:** Mock factory runs before variable declarations; use `vi.hoisted` to create mock fn refs first.
- **Testing private functions via string extraction/eval:** Export them cleanly. Functions are private only by convention — `export` makes them testable without changing behavior.
- **Calling `_resetForTesting()` on http-client in integration tests:** Only needed for 429 state reset; DOC-03 tests mock at the send.ts level, not http-client.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Module mocking | Custom DI/container for testing | vi.mock (vitest) | Already works — 15 test files prove it |
| Fake HTTP server | Custom Express mock server | vi.stubGlobal("fetch") | Established pattern; no server startup needed |
| Test-only wrappers | Wrapper functions that call private fns | Export the function directly | Simpler, less code, same coverage |

---

## Common Pitfalls

### Pitfall 1: fuzzyScore/resolveChatId/autoResolveTarget Are Not Exported
**What goes wrong:** DOC-02 requires unit tests for these functions. They are currently private (`function` without `export`). Tests cannot import them.
**Why it happens:** They were written as module-private helpers.
**How to avoid:** Add `export` keyword to each function in `send.ts` (for `fuzzyScore`, `toArr` already exported) and `channel.ts` (for `resolveChatId`, `autoResolveTarget`). Only add exports, do not change signatures.
**Warning signs:** "SyntaxError: The requested module does not provide an export named 'fuzzyScore'"

### Pitfall 2: autoResolveTarget Calls resolveWahaTarget Which Calls WAHA API
**What goes wrong:** Unit testing `autoResolveTarget` requires mocking `resolveWahaTarget` (which in turn calls `getWahaGroups`, `getWahaContacts`, etc.). Without mocking, tests call real WAHA API and fail.
**Why it happens:** autoResolveTarget is not a pure function — it depends on external state.
**How to avoid:** In DOC-02 unit tests for `autoResolveTarget`, mock `resolveWahaTarget` at the module level using `vi.mock("../src/send.js", async (importOriginal) => {...})`. Alternatively, test `autoResolveTarget` behavior indirectly by testing it as part of DOC-03 integration tests (which mock at the HTTP level).
**Recommendation:** For DOC-02, test `autoResolveTarget`'s resolution logic by mocking `resolveWahaTarget`. For DOC-03, exercise the full stack.

### Pitfall 3: vi.mock Hoisting Order
**What goes wrong:** If you reference a `vi.fn()` variable inside a `vi.mock()` factory without `vi.hoisted`, you get "Cannot access before initialization" errors.
**Why it happens:** Vitest hoists `vi.mock()` calls to the top of the file, before variable declarations.
**How to avoid:** Use `vi.hoisted` as shown in `read-messages.test.ts` and `session-router.test.ts`. All mock function references used inside `vi.mock()` factories MUST be declared via `vi.hoisted`.

### Pitfall 4: SKILL.md Version Mismatch
**What goes wrong:** SKILL.md header says `version: 3.3.0` but plugin is now v1.11.0 with Phases 1-4 features. The LLM (Sammie) reads SKILL.md and may not know about rate limits, multi-session, error scenarios, or new actions (muteChat, unmuteChat, sendMulti, readMessages, etc.).
**Why it happens:** SKILL.md was last updated in v3.3.0 before Phase 1 work.
**How to avoid:** DOC-01 requires adding: error scenario section, rate limit awareness section, multi-session usage examples.

### Pitfall 5: README.md Content Is Stale
**What goes wrong:** README.md references v1.9.4 and doesn't mention Phases 1-4 features (reliability, resilience, multi-session, new actions). New users installing the plugin will miss critical configuration info.
**Why it happens:** README was last updated at v1.9.4.
**How to avoid:** DOC-04 update must cover: current version (1.11.0), new config fields (reliability, sessions, triggerWord), deployment to BOTH hpg6 locations, troubleshooting for new features.

### Pitfall 6: resolveChatId Tests Need toolContext Shape
**What goes wrong:** `resolveChatId(params, toolContext)` accepts an optional `toolContext` object with `currentChannelId`. Tests that omit `toolContext` won't cover the fallback path.
**Why it happens:** The function has three resolution paths: `params.chatId` -> `params.to` -> `toolContext.currentChannelId`.
**How to avoid:** Write three tests — one per resolution path.

---

## Code Examples

Verified patterns from existing test files:

### Minimal makeCfg helper (established in role-guardrail.test.ts)
```typescript
// Source: tests/role-guardrail.test.ts
function makeCfg(overrides: Record<string, unknown> = {}): CoreConfig {
  return {
    channels: {
      waha: {
        baseUrl: "http://localhost:3004",
        apiKey: "test-key",
        session: "test-session",
        enabled: true,
        ...overrides,
      },
    },
  } as unknown as CoreConfig;
}
```

### Integration test: action handler dispatched via handleAction
```typescript
// Source: tests/read-messages.test.ts (pattern)
import { handleAction } from "../src/channel.js";

it("send action calls sendWahaText with correct params", async () => {
  mockSendWahaText.mockResolvedValue({});
  const result = await handleAction("send", { text: "hello" }, makeCfg(), {
    currentChannelId: "972544329000@c.us",
  });
  expect(mockSendWahaText).toHaveBeenCalledWith(
    expect.objectContaining({ chatId: "972544329000@c.us", text: "hello" })
  );
});
```

### SKILL.md error scenario section (new section to add)
```markdown
## Error Handling & Recovery

| Error Pattern | What Happened | What To Do |
|---------------|---------------|------------|
| "Session '...' has sub-role 'listener' and cannot send" | Listener session blocked | Use bot session (check multi-session config) |
| "Could not resolve '...' to a WhatsApp JID" | Name not found in contacts/groups | Use `search` action first, then use exact JID |
| "Ambiguous target '...'. Possible matches:" | Multiple contacts match name | Use exact JID from search results |
| "WAHA API rate limited (429)" | Too many requests | Wait ~1s before retrying; plugin retries up to 3x automatically |
| "timed out after 30000ms" | WAHA server slow/unresponsive | Check WAHA health via admin panel; may have succeeded (mutation ops) |
| "Session health: unhealthy" | WAHA disconnected | Reconnect session in WAHA dashboard |
```

---

## What Already Exists (DOC-02 gap analysis)

| Required Target | Location | Exported? | Test Exists? |
|----------------|----------|-----------|-------------|
| `fuzzyScore` | `src/send.ts:1466` | NO | NO — needs export + new test |
| `toArr` | `src/send.ts:1492` | YES | NO — needs new test |
| `resolveChatId` | `src/channel.ts:322` | NO | NO — needs export + new test |
| `autoResolveTarget` | `src/channel.ts:346` | NO | Partially (send-multi.test.ts tests via mock) — needs direct unit test |
| LRU cache | `lru-cache` npm package | N/A | YES — `tests/lru-cache.test.ts` covers max, TTL, eviction |
| Token bucket | `src/http-client.ts:34` (TokenBucket class) | YES | YES — `tests/token-bucket.test.ts` covers acquire, queue, refill |

**Conclusion:** LRU cache and token bucket are already tested. The four remaining targets need new tests. `fuzzyScore` and `resolveChatId` need an `export` keyword added first.

---

## What Already Exists (DOC-03 gap analysis)

| Required Action | Test Exists? | Notes |
|-----------------|-------------|-------|
| `send` action handler | NO | `send-multi.test.ts` tests sendMulti, not the `send` action; need new test |
| `poll` action handler | NO | No test for `handleAction("poll", ...)` |
| `edit` action handler | NO | No test for `handleAction("edit", ...)` |
| `search` action handler | NO | No test for `handleAction("search", ...)` |

The mock infrastructure in `read-messages.test.ts` provides the exact pattern to follow for all four.

---

## SKILL.md Gap Analysis (DOC-01)

Current SKILL.md (v3.3.0) is missing:

1. **Error scenario guidance** — no section explaining what to do when sends fail, rate limits hit, or sessions disconnect
2. **Rate limit awareness** — no mention of the token bucket, 429 handling, or "wait before retry" guidance
3. **Multi-session examples** — no examples showing triggerWord usage, session roles, `readMessages` action, cross-session routing

Current SKILL.md has (already good):
- Quick reference table for common tasks
- Auto-resolution examples
- Search action documentation
- Full action reference tables
- Media sending instructions
- Parameter format reference

---

## README Gap Analysis (DOC-04)

Current README.md (v1.9.4, last updated 2026-03-10) is missing:
- Version badge (currently v1.9.4, should be 1.11.0)
- Phase 1-4 new configuration fields (`rateLimiter`, `sessions`, `triggerWord`, `triggerResponseMode`)
- Multi-session config example
- Deployment note: BOTH hpg6 locations required (mentioned but could be more prominent)
- Troubleshooting for new issues: session disconnect detection, inbound queue overflow, listener session blocked errors
- New actions added in Phases 3-4: `muteChat`, `unmuteChat`, `sendMulti`, `readMessages`, `sendLinkPreview`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual LRU via Map | `lru-cache` npm package | Phase 1 | Bounded memory, TTL eviction |
| Unbounded fetch | 30s AbortSignal.timeout() | Phase 1 | No hanging requests |
| Silent .catch() | warnOnError() | Phase 1 | Visible error logs |
| No 429 handling | Exponential backoff + jitter | Phase 1 | 3 retries, Retry-After header |
| Single session | Multi-session with roles | Phase 4 | Listener/bot separation |
| No trigger word | `triggerWord` config | Phase 4 | Group chat bot activation |

---

## Open Questions

1. **Export scope for fuzzyScore/resolveChatId/autoResolveTarget**
   - What we know: These are currently non-exported internal functions
   - What's unclear: Should they be exported to the public module API or only tested via integration paths?
   - Recommendation: Export them individually — they are pure/near-pure utilities and direct exports make tests readable without changing behavior. Add a `// Exported for testing` comment.

2. **Integration test depth for DOC-03**
   - What we know: The requirement says "exercise action handlers against mock WAHA API and verify correct HTTP calls and error handling"
   - What's unclear: How deep — test one happy path + one error path per handler, or exhaustive?
   - Recommendation: One happy path + one error path per handler (send, poll, edit, search) = 8 tests total. This satisfies "verify correct HTTP calls and error handling" without over-investing.

3. **SKILL.md version bump**
   - What we know: SKILL.md has `version: 3.3.0` in the YAML front-matter
   - What's unclear: Should this bump to 4.0.0 (major, breaking changes to multi-session) or 3.4.0?
   - Recommendation: Bump to `4.0.0` — multi-session support is a significant capability addition that agents should know is a major update.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npm test -- --reporter=dot` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DOC-01 | SKILL.md error/rate-limit/multi-session sections present | manual | N/A — manual review | N/A |
| DOC-02 | Unit tests for fuzzyScore, toArr, resolveChatId, autoResolveTarget | unit | `npm test -- tests/send-utils.test.ts tests/channel-utils.test.ts` | ❌ Wave 0 |
| DOC-02 | LRU cache already tested | unit | `npm test -- tests/lru-cache.test.ts` | ✅ |
| DOC-02 | Token bucket already tested | unit | `npm test -- tests/token-bucket.test.ts` | ✅ |
| DOC-03 | Integration tests for send, poll, edit, search | integration | `npm test -- tests/action-handlers.test.ts` | ❌ Wave 0 |
| DOC-04 | README installation/config/deploy/troubleshoot | manual | N/A — manual review | N/A |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/send-utils.test.ts` — covers fuzzyScore, toArr (DOC-02)
- [ ] `tests/channel-utils.test.ts` — covers resolveChatId, autoResolveTarget (DOC-02)
- [ ] `tests/action-handlers.test.ts` — covers send, poll, edit, search handlers (DOC-03)
- [ ] Export additions to `src/send.ts` (fuzzyScore) and `src/channel.ts` (resolveChatId, autoResolveTarget) — prerequisite for DOC-02 unit tests

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/send.ts`, `src/channel.ts`, `src/trigger-word.ts`, `src/http-client.ts`
- Existing test files: `tests/` directory (15 test files, 137 passing tests)
- `package.json`: confirmed vitest 4.x, no additional test deps needed
- `vitest.config.ts`: confirmed config (no globals, node environment)

### Secondary (MEDIUM confidence)
- Vitest documentation patterns inferred from existing test files (vi.mock, vi.hoisted, vi.stubGlobal)

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — vitest already installed and working; 137 tests pass; no new deps needed
- Architecture: HIGH — mock patterns established in 4+ existing test files; all patterns directly readable
- Pitfalls: HIGH — gaps identified by direct inspection of source exports and test coverage

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable codebase, no external API changes expected)
