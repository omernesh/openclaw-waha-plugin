# Phase 55: Claude Code Integration - Research

**Researched:** 2026-03-26
**Domain:** HTTP proxy endpoint in monitor.ts + whatsapp-messenger skill routing
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Proxy Endpoint Design**
- URL: `POST /api/admin/proxy-send` — under admin namespace, matches success criteria
- Authentication: Same Bearer token as other admin routes via existing `requireAdminAuth()`
- Supported send types: text + media (sendText, sendImage, sendVideo, sendFile) — covers full skill usage
- JSON body format: Same as WAHA API (`{chatId, text, session, ...}`) so proxy can forward transparently

**Skill Routing Strategy**
- Proxy URL: config-driven — skill reads URL from environment variable or config, not hardcoded
- No direct WAHA API fallback — if proxy is down, sends fail visibly (don't bypass mimicry)
- Session/chatId passed in same JSON body structure as WAHA API for transparent forwarding

### Claude's Discretion
- Internal proxy implementation (how it calls enforceMimicry + recordMimicrySuccess)
- Config variable name for proxy URL
- Error response format from proxy when gate/cap blocks

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CC-01 | Claude Code whatsapp-messenger sends routed through mimicry gate+cap enforcement | `POST /api/admin/proxy-send` in monitor.ts calls `enforceMimicry()` before forwarding to WAHA; skill updates its send path to call proxy instead of WAHA directly |
| CC-02 | Typing simulation applied to outbound Claude Code sends (proportional to message length) | `enforceMimicry()` already implements typing simulation (step 6) when `messageLength > 0`; proxy extracts text length from body and passes it |
</phase_requirements>

---

## Summary

Phase 55 wires the whatsapp-messenger Claude Code skill into the same mimicry enforcement path used by the agent. The work has two halves: (1) add `POST /api/admin/proxy-send` to `monitor.ts` that authenticates, calls `enforceMimicry()`, forwards to WAHA via `callWahaApi()`, then calls `recordMimicrySuccess()` on success; (2) update the skill's `SKILL.md` to replace the direct WAHA API calls with a single proxy endpoint call.

Both pieces are small and self-contained. The enforcement infrastructure (`enforceMimicry`, `recordMimicrySuccess`, `callWahaApi`, `requireAdminAuth`) is fully implemented and tested from Phases 53/54. The proxy endpoint is ~50 lines. The skill update is a documentation edit.

**Primary recommendation:** One plan — implement the proxy route in monitor.ts + update both copies of SKILL.md on hpg6. No new modules or dependencies needed.

---

## Standard Stack

### Core (all already present in the codebase)

| Asset | Location | Purpose |
|-------|----------|---------|
| `requireAdminAuth()` | `src/monitor.ts:119` | Bearer token auth guard — reuse as-is |
| `enforceMimicry()` | `src/mimicry-enforcer.ts:70` | Gate + cap check + jitter + typing — call before WAHA forward |
| `recordMimicrySuccess()` | `src/mimicry-enforcer.ts:149` | Record cap usage — call after WAHA success |
| `callWahaApi()` | `src/http-client.ts:367` | WAHA API call with timeout, rate limit, retry |
| `readRequestBodyWithLimit()` | OpenClaw SDK import in monitor.ts | Safe body parsing — already used in webhook handler |
| `writeJsonResponse()` | `src/monitor.ts:100` | Standard JSON response helper |

No new npm packages needed.

---

## Architecture Patterns

### Proxy Route Structure

The new route follows the exact pattern of existing admin POST routes in `monitor.ts`:

```typescript
// Source: existing admin route pattern in monitor.ts
if (req.url === "/api/admin/proxy-send" && req.method === "POST") {
  // 1. Parse body (already auth-guarded above)
  const rawBody = await readRequestBodyWithLimit(req, DEFAULT_WEBHOOK_MAX_BODY_BYTES, DEFAULT_WEBHOOK_BODY_TIMEOUT_MS);
  const body = JSON.parse(rawBody) as Record<string, unknown>;

  // 2. Validate required fields
  const chatId = body.chatId as string | undefined;
  const session = body.session as string | undefined;
  if (!chatId || !session) {
    writeJsonResponse(res, 400, { error: "chatId and session are required" });
    return;
  }

  // 3. Determine send type — text is most common; image/video/file for media
  const sendType = (body.type as string | undefined) ?? "text";
  const messageLength = typeof body.text === "string" ? body.text.length : 0;

  // 4. Enforce mimicry (gate + cap + jitter + typing)
  try {
    await enforceMimicry({
      session,
      chatId,
      accountId: DEFAULT_ACCOUNT_ID,
      cfg: opts.config,
      messageLength,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    writeJsonResponse(res, 403, { error: reason, blocked: true });
    return;
  }

  // 5. Forward to WAHA
  const wahaConfig = (opts.config as any)?.channels?.waha ?? opts.config;
  const baseUrl = wahaConfig.apiUrl ?? "http://127.0.0.1:3004";
  const apiKey = wahaConfig.apiKey ?? "";
  const wahaPath = SEND_TYPE_TO_PATH[sendType] ?? "/api/sendText";

  let wahaResult: unknown;
  try {
    wahaResult = await callWahaApi({
      baseUrl,
      apiKey,
      path: wahaPath,
      method: "POST",
      body: body as Record<string, unknown>,
      session,
      context: { action: "proxy-send", chatId },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    writeJsonResponse(res, 502, { error: `WAHA API error: ${reason}` });
    return;
  }

  // 6. Record cap usage — only after WAHA success
  recordMimicrySuccess(session);

  writeJsonResponse(res, 200, { ok: true, waha: wahaResult });
  return;
}
```

**`SEND_TYPE_TO_PATH` map** (constant above the route handler):
```typescript
const SEND_TYPE_TO_PATH: Record<string, string> = {
  text:  "/api/sendText",
  image: "/api/sendImage",
  video: "/api/sendVideo",
  file:  "/api/sendFile",
};
```

### Where to Insert the Route

Insert AFTER the `requireAdminAuth` guard and admin rate limiter block (line ~530), BEFORE the existing `POST /api/admin/restart` handler (~line 543). This follows the existing route ordering convention.

### Import additions needed in monitor.ts

```typescript
import { enforceMimicry, recordMimicrySuccess } from "./mimicry-enforcer.js";
import { callWahaApi } from "./http-client.js";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
```

Note: `callWahaApi` may already be available via transitive imports. Check before adding. `DEFAULT_ACCOUNT_ID` is already imported in monitor.ts (used by other routes).

### accountId for enforceMimicry

The proxy call comes from a Claude Code session that has no OpenClaw accountId. Use `DEFAULT_ACCOUNT_ID` (already imported in monitor.ts). This is the same accountId used by the gateway's default session, so DirectoryDb per-target overrides will resolve correctly.

### Skill Update Pattern

The whatsapp-messenger skill currently sends via:
```bash
ssh omer@100.114.126.43 'python3 -c "
import json, urllib.request
data = json.dumps({"chatId": "CHAT_ID", "text": "MSG", "session": "3cf11776_omer"}).encode()
req = urllib.request.Request("http://127.0.0.1:3004/api/sendText", ...)
"'
```

After update, text sends route through the proxy:
```bash
ssh omer@100.114.126.43 'python3 -c "
import json, urllib.request
data = json.dumps({"chatId": "CHAT_ID", "text": "MSG", "session": "3cf11776_omer", "type": "text"}).encode()
req = urllib.request.Request(
    \"http://127.0.0.1:8050/api/admin/proxy-send\",
    data=data,
    headers={\"Content-Type\": \"application/json\", \"Authorization\": \"Bearer TOKEN\"}
)
print(urllib.request.urlopen(req).read().decode()[:200])
"'
```

The proxy URL is `http://127.0.0.1:8050` (the webhook/admin server port, default `DEFAULT_WEBHOOK_PORT = 8050` in monitor.ts). This is on hpg6, same server — no network hop.

### Config Variable for Proxy URL

Skill should read proxy URL from an environment variable. Recommended name: `WAHA_PROXY_URL`. Default: `http://127.0.0.1:8050`. The admin token should come from `WAHA_ADMIN_TOKEN` env var (same as monitor.ts reads it for auth). Both env vars are already set on hpg6 or can be added to the OpenClaw gateway environment.

Alternative: hardcode `http://127.0.0.1:8050` in the skill since it's always on the same hpg6 server. The CONTEXT says "config-driven" — env var is the lightest-weight approach.

### Skill File Locations

Two copies exist on hpg6 (both must be updated, per CLAUDE.md):
1. `~/.openclaw/workspace/skills/waha-openclaw-channel/skills/whatsapp-messenger/SKILL.md`
2. `~/.openclaw/extensions/waha/skills/whatsapp-messenger/SKILL.md`

The SKILL.md lives inside the skill subdirectory — no TypeScript compilation needed, just a documentation edit. No jiti cache clear required for skill doc changes.

### Anti-Patterns to Avoid

- **Don't call sendWahaText() from the proxy** — that would double-enforce mimicry (sendWahaText already calls enforceMimicry via Phase 54 wiring). Call WAHA API directly via callWahaApi().
- **Don't add a WAHA fallback in the skill** — CONTEXT is explicit: if proxy is down, fail visibly.
- **Don't parse messageLength from non-text sends** — for image/video/file, messageLength should be 0 (no typing simulation needed, or derive from caption if present).
- **Don't skip recordMimicrySuccess** — proxy sends count against the hourly cap just like agent sends.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Auth guard | Custom token check | `requireAdminAuth()` at line 119 — already covers all `/api/admin/*` |
| Body parsing | Manual `req.on('data')` | `readRequestBodyWithLimit()` from OpenClaw SDK |
| WAHA HTTP call | New `fetch()` call | `callWahaApi()` — has timeout, rate limit, retry, circuit breaker |
| Gate + cap enforcement | Inline checks | `enforceMimicry()` from mimicry-enforcer.ts |
| Cap recording | Inline db write | `recordMimicrySuccess()` from mimicry-enforcer.ts |
| JSON response | `res.end(JSON.stringify(...))` inline | `writeJsonResponse()` helper |

---

## Common Pitfalls

### Pitfall 1: Double-enforcing mimicry
**What goes wrong:** Proxy calls `sendWahaText()` instead of `callWahaApi()` directly. Phase 54 already wired `enforceMimicry()` into `sendWahaText()`, so enforcement runs twice — double jitter delay, double typing indicator.
**How to avoid:** Proxy calls `callWahaApi()` directly. `enforceMimicry()` is called explicitly in the proxy handler before the `callWahaApi()` call.

### Pitfall 2: Sending to wrong port
**What goes wrong:** Skill calls `http://127.0.0.1:3004/api/admin/proxy-send` (WAHA port) instead of `http://127.0.0.1:8050/api/admin/proxy-send` (monitor.ts port).
**How to avoid:** The proxy endpoint lives in `monitor.ts` which runs on port 8050. WAHA runs on 3004. These are different servers. Document port 8050 clearly in SKILL.md.

### Pitfall 3: Missing accountId for DirectoryDb lookup
**What goes wrong:** `enforceMimicry()` is called with an empty or wrong `accountId`, causing per-target overrides to fail silently or `getDirectoryDb()` to throw.
**How to avoid:** Use `DEFAULT_ACCOUNT_ID` (already imported in monitor.ts).

### Pitfall 4: Auth token not available in skill context
**What goes wrong:** `WAHA_ADMIN_TOKEN` env var not set on hpg6, skill sends unauthenticated requests, proxy returns 401.
**How to avoid:** Check if adminToken is configured in `~/.openclaw/openclaw.json`. If not set, auth is disabled (backward compat) and skill can omit Authorization header. Document both cases in SKILL.md.

### Pitfall 5: Forgetting to update both SKILL.md copies
**What goes wrong:** Only one of the two whatsapp-messenger SKILL.md copies is updated. The gateway loads from extensions/ at runtime — if that one is stale, sends still go direct to WAHA.
**How to avoid:** Update both:
- `~/.openclaw/extensions/waha/skills/whatsapp-messenger/SKILL.md`
- `~/.openclaw/workspace/skills/waha-openclaw-channel/skills/whatsapp-messenger/SKILL.md`
No gateway restart needed for skill doc changes.

### Pitfall 6: callWahaApi import in monitor.ts
**What goes wrong:** monitor.ts currently does not import `callWahaApi` from http-client.ts (it imports other things from send.ts). Adding the import is required.
**How to avoid:** Add `import { callWahaApi } from "./http-client.js";` to monitor.ts imports.

---

## Code Examples

### Checking current monitor.ts imports (what callWahaApi currently provides)

`callWahaApi` signature (from `src/http-client.ts:331`):
```typescript
export interface CallWahaApiParams {
  baseUrl: string;
  apiKey: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  context?: { action?: string; chatId?: string };
  skipRateLimit?: boolean;
  timeoutMs?: number;
  session?: string;   // for circuit breaker check
  accountId?: string; // for per-account rate limiting
}
```

### enforceMimicry signature (from `src/mimicry-enforcer.ts:23`)

```typescript
export interface EnforceMimicryParams {
  session: string;
  chatId: string;
  accountId: string;
  cfg: CoreConfig;
  bypassPolicy?: boolean;
  messageLength?: number;
  count?: number;
  isStatusSend?: boolean;
  _db?: MimicryDb;       // test injection only
  _now?: number;         // test injection only
  _sleep?: (ms: number) => Promise<void>; // test injection only
}
```

### Error format for gate/cap blocks

`enforceMimicry()` throws `Error` with message starting `"[mimicry] Send blocked: ..."`. The proxy should return:
```json
{ "error": "[mimicry] Send blocked: outside send window", "blocked": true }
```
HTTP status 403 (forbidden, not 5xx — this is a policy decision, not a server error).

### Skill proxy call pattern

```python
import json, urllib.request, os

PROXY_URL = os.environ.get("WAHA_PROXY_URL", "http://127.0.0.1:8050")
ADMIN_TOKEN = os.environ.get("WAHA_ADMIN_TOKEN", "")

data = json.dumps({
    "chatId": "972544329000@c.us",
    "text": "Hello from Claude Code",
    "session": "3cf11776_omer",
    "type": "text"
}).encode()

headers = {"Content-Type": "application/json"}
if ADMIN_TOKEN:
    headers["Authorization"] = f"Bearer {ADMIN_TOKEN}"

req = urllib.request.Request(f"{PROXY_URL}/api/admin/proxy-send", data=data, headers=headers)
print(urllib.request.urlopen(req).read().decode()[:200])
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| monitor.ts HTTP server (port 8050) | proxy-send endpoint | Available (always running with gateway) | — | — |
| WAHA API (port 3004) | proxy forwarding | Available | — | — |
| WAHA_ADMIN_TOKEN env var | proxy auth | Optional (no-auth if absent) | — | Skip Authorization header |

**Notes:**
- The monitor.ts webhook server is already running at port 8050 whenever the gateway is up. No new server process.
- If adminToken is not configured, `requireAdminAuth()` returns true without checking headers — the skill can call without Authorization.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing, confirmed from Phase 53/54 test suite) |
| Config file | `vitest.config.ts` at project root |
| Quick run command | `npx vitest run tests/mimicry-enforcer.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CC-01 | Proxy endpoint blocks cap-exceeded send | unit (mock enforceMimicry) | `npx vitest run tests/proxy-send.test.ts` | Wave 0 |
| CC-01 | Proxy endpoint allows valid send + returns WAHA response | unit (mock callWahaApi) | `npx vitest run tests/proxy-send.test.ts` | Wave 0 |
| CC-01 | Proxy endpoint returns 403 with `blocked: true` on gate block | unit | `npx vitest run tests/proxy-send.test.ts` | Wave 0 |
| CC-01 | Proxy requires auth when adminToken configured | unit | `npx vitest run tests/proxy-send.test.ts` | Wave 0 |
| CC-02 | enforceMimicry called with correct messageLength from proxy body | unit | `npx vitest run tests/proxy-send.test.ts` | Wave 0 |

### Wave 0 Gaps
- [ ] `tests/proxy-send.test.ts` — new test file covering all CC-01/CC-02 behaviors
- Note: existing test infrastructure (vitest, fixtures, jest-style mocking) is already in place from Phase 53/54 — no framework setup needed

---

## Sources

### Primary (HIGH confidence)
- `src/monitor.ts` — requireAdminAuth, route pattern, existing admin routes, port 8050
- `src/mimicry-enforcer.ts` — enforceMimicry, recordMimicrySuccess signatures, error format
- `src/http-client.ts` — callWahaApi interface
- `~/.openclaw/workspace/skills/waha-openclaw-channel/skills/whatsapp-messenger/SKILL.md` — exact send patterns currently used by the skill, SSH + python3 call pattern

### Secondary (MEDIUM confidence)
- `55-CONTEXT.md` — locked decisions from user discussion
- `54-RESEARCH.md` — phase 54 established patterns (accountId usage, enforceMimicry call conventions)

---

## Metadata

**Confidence breakdown:**
- Proxy implementation: HIGH — all primitives exist and are verified, route pattern is established
- Skill update: HIGH — exact send patterns read directly from SKILL.md on hpg6
- Test structure: HIGH — vitest is in place, test patterns established in Phase 53/54

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stable codebase)
