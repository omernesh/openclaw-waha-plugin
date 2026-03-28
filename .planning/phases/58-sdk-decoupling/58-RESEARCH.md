# Phase 58: SDK Decoupling - Research

**Researched:** 2026-03-28
**Domain:** TypeScript module decoupling — replace SDK imports with local type/utility abstractions
**Confidence:** HIGH (codebase is fully audited; no external library research required)

## Summary

Phase 58 removes `openclaw/plugin-sdk` imports from every file except `src/channel.ts` and `index.ts`. The codebase has 8 source files with direct SDK imports (excluding .bak files). Most imports are either pure types, simple constants, or thin utility wrappers — all straightforward to replace locally. The highest-risk work is in `inbound.ts`, which imports 8 SDK symbols across 6 modules, several carrying real business logic (reply payload delivery, group policy resolution, DM security gate).

The strictly-additive architectural decision means new files (`platform-types.ts`, `account-utils.ts`, `request-utils.ts`) absorb all replaced symbols. Files being decoupled (`inbound.ts`, `monitor.ts`, `send.ts`, `accounts.ts`, `secret-input.ts`, `inbound-queue.ts`, `proxy-send-handler.ts`, `waha-client.ts`, `types.ts`, `runtime.ts`) have their SDK imports replaced with imports from the new locals. `channel.ts` and `index.ts` are the only files that may retain SDK imports after the phase.

CORE-02 also requires `getConfigPath()` in `config-io.ts` to respect `CHATLYTICS_CONFIG_PATH` env var (currently hardcoded to `OPENCLAW_CONFIG_PATH`).

**Primary recommendation:** One plan per file group, run full 594-test suite after each plan, commit only when green.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — auto-generated infrastructure phase.

### Claude's Discretion
All implementation choices are at Claude's discretion. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)
None — infrastructure phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-01 | Standalone process boots without any OpenClaw SDK dependency at runtime | Audit confirms SDK is only loaded at runtime in 8 src files + index.ts; removing imports from those files satisfies this |
| CORE-02 | Config reads from standalone JSON file (CHATLYTICS_CONFIG_PATH env var or ~/.chatlytics/config.json) | config-io.ts `getConfigPath()` currently uses OPENCLAW_CONFIG_PATH; must add CHATLYTICS_CONFIG_PATH as first-priority env var |
| CORE-03 | WAHA webhook self-registration on startup (POST /api/{session}/webhooks) | monitor.ts already starts the HTTP server; add startup hook to POST webhook registration to WAHA API |
| CORE-05 | Health endpoint reports webhook_registered and session connection status | monitor.ts already has /healthz endpoint; extend getHealthState() to include webhook_registered flag |
</phase_requirements>

## Standard Stack

No new external libraries needed. All replacements use stdlib (node:crypto, node:http) and existing project utilities.

### Supporting (already in project)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.0.18 | Test runner | Full suite: `npm test` |
| zod | project dep | Schema validation | Already used in config-schema.ts |

**Installation:** None required.

## Architecture Patterns

### New Files to Create

```
src/
├── platform-types.ts    # Local replicas of SDK types: RuntimeEnv, OutboundReplyPayload, etc.
├── account-utils.ts     # Local replicas: DEFAULT_ACCOUNT_ID, normalizeAccountId, listConfiguredAccountIds, resolveAccountWithDefaultFallback
└── request-utils.ts     # Local replicas: readRequestBodyWithLimit, isRequestBodyLimitError, requestBodyErrorToText
```

### Files to Modify (SDK imports removed)

| File | SDK Modules Imported | Replacement Strategy |
|------|---------------------|---------------------|
| `src/types.ts` | `openclaw/plugin-sdk/core` → `OpenClawConfig` | Replace `OpenClawConfig` with local `StandaloneConfig` type that owns the shape directly |
| `src/runtime.ts` | `openclaw/plugin-sdk/core` → `PluginRuntime` | Move `PluginRuntime` type to `platform-types.ts`; runtime.ts becomes a standalone optional adapter |
| `src/accounts.ts` | `openclaw/plugin-sdk/account-resolution` → 4 symbols | Move all 4 to `account-utils.ts` |
| `src/secret-input.ts` | `openclaw/plugin-sdk/secret-input` → 3 symbols | Re-implement locally (all 3 are thin wrappers around env/file reads) |
| `src/inbound-queue.ts` | `openclaw/plugin-sdk/runtime` → `RuntimeEnv` type | Import from `platform-types.ts` |
| `src/proxy-send-handler.ts` | `openclaw/plugin-sdk/account-id` → `DEFAULT_ACCOUNT_ID` | Import from `account-utils.ts` |
| `src/send.ts` | 3 SDK modules → `detectMime`, `sendMediaWithLeadingCaption`, `DEFAULT_ACCOUNT_ID` | `detectMime` to `request-utils.ts`; `sendMediaWithLeadingCaption` to `platform-types.ts`; `DEFAULT_ACCOUNT_ID` to `account-utils.ts` |
| `src/waha-client.ts` | `openclaw/plugin-sdk/account-id` → `DEFAULT_ACCOUNT_ID` | Import from `account-utils.ts` |
| `src/monitor.ts` | 5 SDK modules → 7 symbols | See detail below |
| `src/inbound.ts` | 8 SDK modules → 15 symbols | See detail below — highest risk |
| `src/config-io.ts` | No SDK import (already clean) | Add `CHATLYTICS_CONFIG_PATH` env var support (CORE-02) |

### monitor.ts SDK Symbol Inventory

| Symbol | SDK Module | Local Replacement |
|--------|-----------|------------------|
| `createLoggerBackedRuntime` | `openclaw/plugin-sdk/runtime` | Inline in monitor.ts: a thin object with `log?: (msg:string)=>void` |
| `RuntimeEnv` (type) | `openclaw/plugin-sdk/runtime` | Import from `platform-types.ts` |
| `isRequestBodyLimitError` | `openclaw/plugin-sdk/webhook-ingress` | Move to `request-utils.ts` |
| `readRequestBodyWithLimit` | `openclaw/plugin-sdk/webhook-ingress` | Move to `request-utils.ts` |
| `requestBodyErrorToText` | `openclaw/plugin-sdk/webhook-ingress` | Move to `request-utils.ts` |
| `isWhatsAppGroupJid` | `openclaw/plugin-sdk/whatsapp-shared` | `(jid: string) => jid.endsWith("@g.us")` — inline or in `platform-types.ts` |
| `DEFAULT_ACCOUNT_ID` | `openclaw/plugin-sdk/account-id` | Import from `account-utils.ts` |

### inbound.ts SDK Symbol Inventory (highest risk)

| Symbol | SDK Module | Local Replacement | Risk |
|--------|-----------|------------------|------|
| `GROUP_POLICY_BLOCKED_LABEL` | `openclaw/plugin-sdk/config-runtime` | Local string constant `"blocked"` — inspect actual value first | LOW |
| `resolveAllowlistProviderRuntimeGroupPolicy` | `openclaw/plugin-sdk/config-runtime` | Re-implement from logic already present in inbound.ts local shim | HIGH |
| `resolveDefaultGroupPolicy` | `openclaw/plugin-sdk/config-runtime` | Re-implement locally (reads cfg.channels.waha.groupPolicy) | MEDIUM |
| `warnMissingProviderGroupPolicyFallbackOnce` | `openclaw/plugin-sdk/config-runtime` | One-shot warning emitter — simple local implementation | LOW |
| `createNormalizedOutboundDeliverer` | `openclaw/plugin-sdk/reply-payload` | Used in deliverWahaReply — must behaviorally match | HIGH |
| `formatTextWithAttachmentLinks` | `openclaw/plugin-sdk/reply-payload` | Format utility — re-implement or inline | MEDIUM |
| `resolveOutboundMediaUrls` | `openclaw/plugin-sdk/reply-payload` | Extracts media URLs from OutboundReplyPayload — re-implement | MEDIUM |
| `OutboundReplyPayload` (type) | `openclaw/plugin-sdk/reply-payload` | Move type definition to `platform-types.ts` | LOW |
| `createReplyPrefixOptions` | `openclaw/plugin-sdk/channel-runtime` | Options builder for reply prefix — local implementation | LOW |
| `logInboundDrop` | `openclaw/plugin-sdk/channel-inbound` | Logging utility — inline with existing logger | LOW |
| `readStoreAllowFromForDmPolicy` | `openclaw/plugin-sdk/security-runtime` | Reads pairing allow-list — delegates to runtime.channel.pairing | HIGH |
| `resolveDmGroupAccessWithCommandGate` | `openclaw/plugin-sdk/security-runtime` | Core DM security gate — business logic-heavy | HIGH |
| `isWhatsAppGroupJid` | `openclaw/plugin-sdk/whatsapp-shared` | `(jid: string) => jid.endsWith("@g.us")` | LOW |
| `normalizeAccountId` | `openclaw/plugin-sdk/account-id` | Import from `account-utils.ts` | LOW |
| `OpenClawConfig` (type) | `openclaw/plugin-sdk/core` | Import `CoreConfig` from `./types.js` directly (already a superset) | LOW |
| `RuntimeEnv` (type) | `openclaw/plugin-sdk/runtime` | Import from `platform-types.ts` | LOW |

### CORE-02: Config Path Update

`config-io.ts` line 31 currently reads:
```typescript
return process.env.OPENCLAW_CONFIG_PATH ?? join(homedir(), ".openclaw", "openclaw.json");
```

Replace with:
```typescript
return process.env.CHATLYTICS_CONFIG_PATH
  ?? process.env.OPENCLAW_CONFIG_PATH  // backward compat
  ?? join(homedir(), ".chatlytics", "config.json");
```

The default path changes from `~/.openclaw/openclaw.json` to `~/.chatlytics/config.json`. Existing deployments on hpg6 set `OPENCLAW_CONFIG_PATH` explicitly in the openclaw gateway environment — backward compat env var ensures no regression.

### CORE-03: Webhook Self-Registration

Add to monitor.ts `monitorWahaProvider()` startup sequence:

```typescript
// POST /api/{session}/webhooks with { url: webhookPublicUrl, events: ["message", "message.any", ...] }
// Called once per enabled account at startup. Non-fatal if WAHA API unreachable.
```

Implementation: `callWahaApi()` from `http-client.ts` handles the POST. Store registration success in health state (CORE-05).

### CORE-05: Health Endpoint Extension

`getHealthState()` in `health.ts` already returns a `HealthState` object. Extend with:
```typescript
webhook_registered: boolean;   // true once self-registration POST succeeded
session_connected: boolean;    // already tracked as part of HealthState
```

`/healthz` in monitor.ts already serializes this — just add the fields.

### Anti-Patterns to Avoid

- **Replacing HIGH-risk SDK functions by guessing their behavior.** Each of `resolveAllowlistProviderRuntimeGroupPolicy`, `readStoreAllowFromForDmPolicy`, `resolveDmGroupAccessWithCommandGate`, and `createNormalizedOutboundDeliverer` must be reverse-engineered from their callsites in inbound.ts before implementing the local shim. The inbound.ts code already contains a `createScopedPairingAccess` local shim as a model.
- **Moving all SDK replacements into one plan.** inbound.ts alone has 15 symbols spanning 5 semantic areas. Separate plans per file group prevent a single broken shim from blocking the entire phase.
- **Forgetting `src/secret-input.ts`.** It re-exports SDK symbols directly (`export { hasConfiguredSecretInput, normalizeResolvedSecretInputString, normalizeSecretInputString }`). These re-exports must be replaced with local implementations or the consumers (accounts.ts) still transitively import from SDK.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Body size limit for HTTP | Custom stream reader | Local `request-utils.ts` re-implementing `readRequestBodyWithLimit` | Already audited in monitor.ts line 292 and 552 — behavior is a bounded stream read with timeout |
| MIME detection | Custom magic-bytes detector | Extract `detectMime` logic from SDK or use `file-type` npm package | `detectMime` in send.ts is used only in `sendWahaMediaBatch` MIME rerouting path |

## Common Pitfalls

### Pitfall 1: Behavioral mismatch in HIGH-risk inbound.ts shims
**What goes wrong:** Local shim for `resolveDmGroupAccessWithCommandGate` returns slightly different allow/block values than the SDK, causing DMs to be dropped or accepted incorrectly.
**Why it happens:** The SDK function has implicit contract knowledge not visible from the call site.
**How to avoid:** Read all call sites in inbound.ts carefully. The function's output must match the exact boolean/string conditions checked at lines 222–450 of inbound.ts. Add an explicit test in inbound.test.ts that exercises the DM gate path.
**Warning signs:** Test failures in inbound.test.ts after the shim is installed.

### Pitfall 2: `CoreConfig` extends `OpenClawConfig` — removing the extension breaks the type
**What goes wrong:** `types.ts` line 123: `export type CoreConfig = OpenClawConfig & { channels?: { waha?: WahaChannelConfig } }`. If `OpenClawConfig` is replaced with a local type that's structurally different, callers that pass a raw `CoreConfig` to SDK-typed functions in channel.ts will break.
**Why it happens:** TypeScript structural typing — the local type must be a compatible superset.
**How to avoid:** Make the local `StandaloneConfig` type have the same shape as `OpenClawConfig` at minimum. Channel.ts can continue to intersect with it.
**Warning signs:** TypeScript compile errors in channel.ts after types.ts is modified.

### Pitfall 3: `secret-input.ts` re-exports create transitive SDK dependency
**What goes wrong:** Even after removing SDK imports from accounts.ts and monitor.ts, if secret-input.ts still re-exports from `openclaw/plugin-sdk/secret-input`, the grep test in success criterion 1 will pass but the process still loads the SDK at runtime.
**Why it happens:** The re-export pulls in the module at load time.
**How to avoid:** Replace the three re-exported functions with local implementations. `normalizeResolvedSecretInputString` resolves `{source,provider,id}` objects to strings from env/file/exec. `hasConfiguredSecretInput` checks if the value is a non-string object. These are small functions with no complex state.
**Warning signs:** `grep -r "openclaw/plugin-sdk" src/` clean, but process still crashes without SDK installed.

### Pitfall 4: CORE-02 default path change breaks hpg6 deployment
**What goes wrong:** Default path changes from `~/.openclaw/openclaw.json` to `~/.chatlytics/config.json`. The hpg6 gateway doesn't set `OPENCLAW_CONFIG_PATH`, so after deployment the plugin reads from the new default path and finds no config.
**Why it happens:** The openclaw gateway on hpg6 passes its own runtime — but the config path is resolved in the plugin, not the gateway.
**How to avoid:** Keep `OPENCLAW_CONFIG_PATH` as a backward-compat fallback (second priority). The gateway on hpg6 must set either `OPENCLAW_CONFIG_PATH` or `CHATLYTICS_CONFIG_PATH`. Verify by checking the gateway's openclaw.json and environment.
**Warning signs:** 401 errors or "config not found" after deploy to hpg6.

### Pitfall 5: inbound.ts imports `OpenClawConfig` and uses it as parameter type for `handleWahaInbound`
**What goes wrong:** `handleWahaInbound` takes `config: CoreConfig`. `CoreConfig` extends `OpenClawConfig`. If the local `StandaloneConfig` doesn't include all fields that channel.ts passes in, the type system may silently accept incompatible objects.
**Why it happens:** After removing the extension, the intersection type in types.ts must be updated to extend the local type instead.
**How to avoid:** After replacing `OpenClawConfig` with `StandaloneConfig` in types.ts, run `npx tsc --noEmit` immediately to catch any type breakage before running tests.

## Code Examples

### Pattern: Local shim for readRequestBodyWithLimit
```typescript
// src/request-utils.ts
// Source: reverse-engineered from monitor.ts lines 291-295, 552
export class RequestBodyLimitError extends Error {
  constructor(public readonly type: "size" | "timeout") {
    super(type === "size" ? "Request body too large" : "Request body read timeout");
  }
}

export function isRequestBodyLimitError(err: unknown): err is RequestBodyLimitError {
  return err instanceof RequestBodyLimitError;
}

export function requestBodyErrorToText(err: unknown): string {
  if (isRequestBodyLimitError(err)) return err.message;
  return "";
}

export function readRequestBodyWithLimit(
  req: import("node:http").IncomingMessage,
  maxBytesOrOptions: number | { maxBytes: number; timeoutMs?: number },
  timeoutMsArg?: number,
): Promise<string> {
  const { maxBytes, timeoutMs } =
    typeof maxBytesOrOptions === "number"
      ? { maxBytes: maxBytesOrOptions, timeoutMs: timeoutMsArg }
      : maxBytesOrOptions;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const timer = timeoutMs
      ? setTimeout(() => reject(new RequestBodyLimitError("timeout")), timeoutMs)
      : null;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        if (timer) clearTimeout(timer);
        reject(new RequestBodyLimitError("size"));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (timer) clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
```

### Pattern: account-utils.ts
```typescript
// src/account-utils.ts
export const DEFAULT_ACCOUNT_ID = "default";

export function normalizeAccountId(id: string): string {
  return id.trim().toLowerCase();
}

// listConfiguredAccountIds and resolveAccountWithDefaultFallback:
// exact behavior must be verified by reading accounts.ts usage context
// before finalizing implementation.
```

### Pattern: platform-types.ts
```typescript
// src/platform-types.ts
// Minimal RuntimeEnv type — only the fields actually used in the codebase.
// Grep: `runtime.log` (inbound.ts, monitor.ts), `runtime.channel` (inbound.ts via createScopedPairingAccess)
export type RuntimeEnv = {
  log?: (msg: string) => void;
  channel?: {
    pairing?: {
      readAllowFromStore(params: { channel: string; accountId: string }): Promise<unknown>;
      upsertPairingRequest(params: { channel: string; accountId: string; id: string }): Promise<unknown>;
    };
  };
};

export const isWhatsAppGroupJid = (jid: string): boolean => jid.endsWith("@g.us");

export type OutboundReplyPayload = {
  text?: string;
  mediaUrls?: string[];
  replyToId?: string;
  // extend as needed by inbound.ts callsites
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single `openclaw/plugin-sdk` barrel import | Sub-path imports (`/core`, `/runtime`, etc.) | v1.13+ | Already partially decoupled — each file imports only what it needs |
| `OPENCLAW_CONFIG_PATH` | `CHATLYTICS_CONFIG_PATH` (+ backward compat) | This phase | Standalone process uses neutral env var name |

## Open Questions

1. **Exact behavior of `resolveAllowlistProviderRuntimeGroupPolicy` and `resolveDmGroupAccessWithCommandGate`**
   - What we know: Both are called in inbound.ts with account config fields; `resolveDmGroupAccessWithCommandGate` returns an access decision
   - What's unclear: The exact return type and fallback behavior when pairing store is empty
   - Recommendation: Before implementing shims, add a `console.log` test run against hpg6 to capture real return values, OR read the SDK source at `/usr/lib/node_modules/openclaw/dist/` on hpg6

2. **`detectMime` in send.ts**
   - What we know: Called in `sendWahaMediaBatch` for MIME detection to reroute to sendImage/sendFile/sendVideo
   - What's unclear: Does it rely on magic bytes (async file read) or extension-only?
   - Recommendation: Read SDK source on hpg6 OR replace with `file-type` npm package (well-maintained, ESM-first)

3. **`sendMediaWithLeadingCaption` in send.ts**
   - What we know: Called in `sendWahaMediaBatch`, formats multi-part media with a leading text message
   - What's unclear: Whether it's a pure formatting function or has side effects
   - Recommendation: Read its usage in send.ts — if it's formatting-only, inline it; if it has send semantics, replicate carefully

## Environment Availability

Step 2.6: SKIPPED — phase is code-only refactoring, no new external dependencies.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npm test -- --reporter=dot` |
| Full suite command | `npm test` (594 tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-01 | All non-channel/index files import zero SDK symbols | unit (grep) | `grep -r "openclaw/plugin-sdk" src/ \| grep -v "src/channel.ts\|index.ts"` | N/A — shell check |
| CORE-02 | CHATLYTICS_CONFIG_PATH env var overrides default path | unit | `npm test -- --reporter=dot src/config-io.test.ts` | ✅ exists |
| CORE-03 | Webhook self-registration POST fires on startup | integration/manual | Manual: check WAHA API webhooks list after gateway restart | ❌ Wave 0 |
| CORE-05 | /healthz includes webhook_registered field | unit | `npm test -- --reporter=dot src/monitor.test.ts` | ✅ exists |

### Sampling Rate
- **Per task commit:** `npm test -- --reporter=dot` (quick, all 594)
- **Per wave merge:** `npm test` (full verbose)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/platform-types.test.ts` — covers RuntimeEnv type exports and `isWhatsAppGroupJid`
- [ ] `src/account-utils.test.ts` — covers DEFAULT_ACCOUNT_ID, normalizeAccountId
- [ ] `src/request-utils.test.ts` — covers readRequestBodyWithLimit size/timeout limits
- [ ] CORE-03 manual test: after startup, verify WAHA API returns the registered webhook URL

## Sources

### Primary (HIGH confidence)
- Direct codebase audit — all 8 affected source files read and SDK symbol inventory compiled
- `src/config-io.ts` line 31 — current OPENCLAW_CONFIG_PATH usage confirmed
- `src/monitor.ts` lines 10-28, 291-296, 2303-2338 — SDK usage confirmed
- `src/inbound.ts` lines 1-19, 63-91 — SDK usage and existing shim pattern confirmed
- `.planning/STATE.md` — architectural decisions (strictly additive, new files do new work)
- `.planning/REQUIREMENTS.md` — CORE-01 through CORE-05 definitions

### Secondary (MEDIUM confidence)
- CLAUDE.md codebase conventions (DO NOT CHANGE markers, backup pattern, deploy checklist)

## Metadata

**Confidence breakdown:**
- SDK symbol inventory: HIGH — all files audited, grep confirmed complete
- Replacement strategy for LOW-risk symbols: HIGH — types and simple constants
- Replacement strategy for HIGH-risk inbound.ts business logic: MEDIUM — behavior must be verified against SDK source on hpg6 before implementing
- CORE-02 path change: HIGH — change is mechanical, backward compat via env var fallback
- CORE-03 webhook self-registration: MEDIUM — WAHA API endpoint is known, timing/retry behavior needs care

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable codebase, no external dependencies)
