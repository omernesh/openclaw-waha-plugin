# Coding Conventions

**Analysis Date:** 2026-03-11

## Naming Patterns

**Files:**
- Use `kebab-case.ts` for all source files: `dm-filter.ts`, `config-schema.ts`, `secret-input.ts`
- Single-word names preferred when unambiguous: `send.ts`, `monitor.ts`, `channel.ts`
- Entry point: `index.ts` at project root

**Functions:**
- Use `camelCase` for all functions
- Exported functions use descriptive verb-noun pattern prefixed with domain:
  - WAHA API callers: `sendWahaText`, `getWahaGroups`, `deleteWahaMessage`
  - Account resolution: `resolveWahaAccount`, `listWahaAccountIds`
  - Normalization: `normalizeWahaMessagingTarget`, `normalizeWahaAllowEntry`
- Private/internal helpers: plain `camelCase` without prefix: `resolveMime`, `buildFilePayload`, `calcReadDelay`
- Assertion guards: `assertAllowedSession` (throws on invalid state)

**Variables:**
- Use `camelCase` for local variables and parameters
- Constants: `UPPER_SNAKE_CASE` for module-level constants: `STANDARD_ACTIONS`, `DEFAULT_WEBHOOK_PORT`, `EXTENSION_MIME_MAP`
- Private class fields: `_prefixed` with underscore: `_config`, `_stats`, `_regexCache`
- Cached module singletons: `_prefixed`: `_cachedConfig`, `_dmFilterInstance`

**Types:**
- Use `PascalCase` for all types and interfaces
- Suffix with purpose: `WahaWebhookConfig`, `CoreConfig`, `ContactRecord`, `DmFilterResult`
- Use `type` keyword (not `interface`) for object shapes throughout
- Discriminated unions for result types: `DmFilterResult` uses `{ pass: true; reason: ... } | { pass: false; reason: ... }`

## Code Style

**Formatting:**
- No Prettier or ESLint config files detected
- 2-space indentation used consistently throughout
- Semicolons required at end of statements
- Double quotes for strings (not single quotes)
- Trailing commas in multi-line parameter lists

**Linting:**
- No linter configuration present in the project
- One eslint-disable comment observed in `src/directory.ts` line 50: `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
- Code relies on TypeScript compiler for type checking (`typescript` in devDependencies)

**TypeScript:**
- ESM modules (`"type": "module"` in `package.json`)
- Import paths use `.js` extension for local imports: `import { foo } from "./bar.js"`
- `as const` assertions on literal objects: `meta` object in `src/channel.ts`, `WEBHOOK_ERRORS` in `src/monitor.ts`
- `satisfies` operator used for type validation: `} satisfies ResolvedWahaAccount` in `src/accounts.ts` line 133
- Heavy use of type assertions (`as`) for untyped SDK responses and JSON payloads

## Import Organization

**Order:**
1. Node.js built-in modules: `import { createServer } from "node:http"`
2. SDK/framework imports: `import { ... } from "openclaw/plugin-sdk"`
3. External packages: `import { z } from "zod"`
4. Local module imports: `import { resolveWahaAccount } from "./accounts.js"`

**Path Aliases:**
- None used. All local imports are relative paths with `.js` extension
- SDK imports use bare specifier: `"openclaw/plugin-sdk"`

**Import Style:**
- Named imports exclusively (no default imports except in `index.ts` default export)
- Type-only imports used: `import type { CoreConfig } from "./types.js"`
- Large import blocks in `src/channel.ts` (lines 27-69) list every function from `src/send.ts` individually

## Error Handling

**Patterns:**
- **Throw with descriptive messages:** Functions throw `new Error("WAHA sendText requires chatId")` with context about what was expected
- **Fail-open for non-critical operations:** Presence/typing calls use `.catch(() => {})` to silently swallow errors (lines throughout `src/send.ts`, `src/presence.ts`)
- **Fail-open for filters:** `DmFilter.check()` wraps `_check()` in try/catch and returns `{ pass: true, reason: "error" }` on any exception (`src/dm-filter.ts` line 62-66)
- **Error text from HTTP responses:** `callWahaApi` reads error body: `await response.text().catch(() => "")` and includes status code (`src/send.ts` line 62-63)
- **Guard functions:** `assertAllowedSession()` throws immediately if session is blocked (`src/send.ts` lines 22-32)
- **No try/catch in API callers:** Individual `sendWaha*` functions let errors propagate to `handleAction()` in `src/channel.ts`
- **Console warnings for non-fatal failures:** `console.warn(\`[waha] ...\`)` pattern for media preprocessing failures (`src/media.ts`), media send failures (`src/send.ts` line 394)

**Error message format:**
- Always include the operation name: `"WAHA sendText requires chatId"`, `"WAHA react requires messageId"`
- Include resolution guidance: `'Use a JID (e.g. 120363...@g.us) or phone number.'`

## Logging

**Framework:** `console.log` and `console.warn` (no logging library)

**Patterns:**
- Prefix all log messages with `[waha]`: `console.warn(\`[waha] audio transcription failed: ${err}\`)`
- Use `console.warn` for non-fatal errors and dropped messages
- Use `console.log` for informational events: `console.log(\`[waha] user ${id} approved for pairing\`)`
- Use SDK logger when available: `ctx.log?.info(...)` in `src/channel.ts` gateway starter
- DmFilter has optional `log` callback parameter instead of direct console usage

## Comments

**When to Comment:**
- **DO NOT CHANGE / DO NOT REMOVE markers:** Critical code sections have prominent block comments explaining WHAT the code does, WHY it must not change, WHEN it was verified, and bug history. These are the most important comments in the codebase.
- **Box-style headers:** Major guardrails use ASCII box art comments (see `src/send.ts` lines 8-21, `src/channel.ts` lines 284-293)
- **Inline verification notes:** `// Verified 2026-03-10` or `// Verified working 2026-03-10` after working code
- **Bug history blocks:** Document what went wrong, when, and the fix approach (see `src/media.ts` lines 455-466)

**JSDoc/TSDoc:**
- Minimal JSDoc usage. Some functions have `/** ... */` doc comments (`buildFilePayload`, `sendWahaPresence`, `detectMimeViaHead`)
- Most functions have no JSDoc -- rely on descriptive function names and inline comments instead

**Comment Style Rules (prescriptive):**
- After fixing a bug or getting a feature working, add a DO NOT CHANGE comment block explaining:
  1. WHAT the code does
  2. WHY it must not change
  3. WHEN it was verified working
  4. Any bug history
- Use `// ──` or `// ╔══` box-style separators for critical guardrails
- Use `// ---` separators for logical sections within a file

## Function Design

**Size:**
- Most exported functions are 10-30 lines
- `handleAction()` in `src/channel.ts` is the largest single function (~140 lines) -- uses if/else chain for action dispatch
- `handleWahaInbound()` in `src/inbound.ts` is ~470 lines (the full inbound pipeline)

**Parameters:**
- Use a single object parameter for functions with 3+ arguments: `sendWahaText(params: { cfg, to, text, replyToId?, accountId? })`
- Destructure in function body, not in signature
- Optional parameters use `?` suffix in the type
- Config (`cfg: CoreConfig`) is always the first property in parameter objects

**Return Values:**
- API callers return the raw WAHA API response (JSON parsed)
- `handleAction` returns `{ content: [{ type: "text", text: JSON.stringify(result) }], details: {} }`
- Void functions used for fire-and-forget operations (presence, typing)
- Discriminated unions for filter results: `{ pass: true; reason: ... } | { pass: false; reason: ... }`

## Module Design

**Exports:**
- Named exports only (except `index.ts` default export)
- Each module exports its public API functions and types
- Internal helpers are not exported (kept module-private)

**Barrel Files:**
- No barrel files. Each module is imported directly by path.
- `index.ts` is only the plugin entry point, not a re-export barrel.

**Module Boundaries:**
- `src/send.ts`: All outbound WAHA API HTTP calls (1588 lines)
- `src/channel.ts`: Plugin adapter and action routing (763 lines)
- `src/inbound.ts`: Webhook message handling pipeline (595 lines)
- `src/monitor.ts`: HTTP server, admin panel, webhook receiver (2280 lines)
- `src/directory.ts`: SQLite data access layer (470 lines)
- Smaller utility modules: `normalize.ts`, `accounts.ts`, `runtime.ts`, `types.ts`

**Singleton Pattern:**
- Module-level singletons with getter/setter: `getWahaRuntime()` / `setWahaRuntime()` in `src/runtime.ts`
- Module-level `Map` singletons for filters: `_dmFilterInstance`, `_groupFilterInstance` in `src/inbound.ts`
- Cached config: `_cachedConfig` in `src/channel.ts` with `getCachedConfig()` accessor

## Conditional Spread Pattern

Use conditional spread for optional properties throughout:
```typescript
...(params.replyToId ? { reply_to: params.replyToId } : {})
...(params.caption ? { caption: params.caption } : {})
```

This pattern appears in every `sendWaha*` function in `src/send.ts`. Always use this pattern when building WAHA API request bodies with optional fields.

## String Coercion Pattern

In `handleAction()` (`src/channel.ts`), all parameters from the gateway are coerced with `String()`:
```typescript
chatId: String(p.chatId),
messageId: String(p.messageId),
text: String(p.text),
```

Use `String()` wrapper on all `params` values received from the gateway, as they come as `unknown`.

## Account Resolution Pattern

Every function that calls the WAHA API follows this pattern:
```typescript
const account = resolveWahaAccount({ cfg: params.cfg, accountId: params.accountId });
assertAllowedSession(account.session);
// ... use account.baseUrl, account.apiKey, account.session
```

Always call `resolveWahaAccount` then `assertAllowedSession` before making API calls. See `src/send.ts` for the canonical pattern.

---

*Convention analysis: 2026-03-11*
