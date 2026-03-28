# Phase 63: Dashboard Auth + Onboarding - Research

**Researched:** 2026-03-28
**Domain:** better-auth, React SPA auth flow, WAHA QR session provisioning, API key lifecycle
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — all implementation at Claude's discretion.

### Claude's Discretion
- better-auth configuration (SQLite adapter, email+password provider)
- Workspace model design
- QR code flow (WAHA QR endpoint to SSE to admin panel)
- API key generation (crypto.randomBytes, ctl_ prefix)
- Admin panel React integration

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | User registration with email and password (better-auth) | better-auth emailAndPassword plugin + SQLite adapter — fully documented |
| AUTH-02 | Workspace creation (isolated tenant with own sessions, DBs, API keys) | User additionalFields + databaseHooks.user.create.after for workspace init |
| AUTH-03 | QR code scanning flow in dashboard (provision WAHA session, poll QR, detect connected) | WAHA GET /api/{session}/auth/qr with base64 format + 20s polling interval |
| AUTH-04 | API key generation UI (show plaintext once, copy button, stored hashed) | @better-auth/api-key plugin — show-once semantics built in; plaintext only on create |
| AUTH-05 | API key rotation (old key invalidated immediately) | delete + recreate pattern; old key fails verifyApiKey instantly after deletion |
| AUTH-06 | Integration setup wizard (choose MCP/REST/SKILL.md, copy config, send test message) | Pure React UI — no new backend required; reads existing API key + config |
</phase_requirements>

## Summary

This phase adds user registration, workspace setup, WhatsApp QR pairing, API key management, and an integration wizard to the Chatlytics dashboard. The stack is: **better-auth 1.5.6** for auth/session/API-key management, backed by the existing **better-sqlite3** database, wired into the raw Node.js HTTP server in `monitor.ts` via `toNodeHandler` from `better-auth/node`. The React admin SPA in `src/admin/` gets two new screens: a Login/Register flow (rendered before the authenticated app) and an Onboarding wizard (rendered after first login).

The phase has two independent sub-domains: (1) server-side auth plumbing (`src/auth.ts` + monitor.ts route wiring) and (2) React UI additions (auth gate, QR tab, API keys tab, wizard). These should be two sequential plans.

**Primary recommendation:** Use better-auth's built-in `emailAndPassword` + `apiKey` plugins backed by `better-sqlite3` via `toNodeHandler`. Do NOT hand-roll session management, password hashing, or API key storage.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-auth | 1.5.6 | Auth framework (sessions, email+password, API keys) | TypeScript-first, SQLite adapter built-in, apiKey plugin ships separately |
| @better-auth/api-key | 1.5.6 | API key CRUD with show-once + hash storage | Official plugin — handles hashing, prefix, rotation semantics |
| better-sqlite3 | 11.10.0 (already installed) | SQLite adapter for better-auth | Already project dependency; synchronous driver supported by better-auth |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-auth/node | (re-export in better-auth 1.5.6) | toNodeHandler — bridges Web Request/Response to Node.js IncomingMessage/ServerResponse | Required for monitor.ts raw Node.js HTTP integration |
| react | 19.2.4 (already installed) | Auth gate + onboarding UI | Already in project |
| sonner | 2.0.7 (already installed) | Toast notifications for auth errors | Already used everywhere |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-auth apiKey plugin | custom crypto.randomBytes + SHA-256 | Custom loses show-once UI guarantees, rotation semantics, permission fields |
| better-auth sessions | JWT-only stateless | Sessions give immediate revocation; JWT requires blocklist for logout |
| polling for QR status | WAHA webhooks / SSE | Webhook requires known public URL; polling from dashboard is simpler and sufficient |

**Installation:**
```bash
npm install better-auth @better-auth/api-key
```

**Version verification:** Confirmed via `npm view better-auth version` -> 1.5.6, `npm view @better-auth/api-key version` -> 1.5.6 (2026-03-28).

## Architecture Patterns

### Recommended Project Structure
```
src/
  auth.ts                  # better-auth instance (new)
  auth-db.ts               # better-sqlite3 instance for auth (new — separate DB file)
  monitor.ts               # existing — add /api/auth/* route delegation via toNodeHandler
  admin/src/
    App.tsx                # existing — wrap in AuthGate
    components/
      AuthGate.tsx         # new — shows Login/Register if no session
      LoginPage.tsx        # new
      RegisterPage.tsx     # new
      tabs/
        OnboardingTab.tsx  # new — QR flow + wizard (AUTH-03, AUTH-06)
        ApiKeysTab.tsx     # new — API key management (AUTH-04, AUTH-05)
```

### Pattern 1: better-auth with raw Node.js HTTP
**What:** Mount better-auth handler on `/api/auth/*` prefix by delegating from monitor.ts requestListener.
**When to use:** This project uses raw `node:http` — no Express/Fastify.

```typescript
// Source: https://better-auth.com/docs/adapters/sqlite
// src/auth.ts
import { betterAuth } from "better-auth";
import { emailAndPassword } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import Database from "better-sqlite3";
import { join } from "node:path";
import { getDataDir } from "./data-dir.js";

export const auth = betterAuth({
  database: new Database(join(getDataDir(), "auth.db")),
  emailAndPassword: { enabled: true },
  plugins: [
    apiKey({ defaultPrefix: "ctl_" }),
  ],
  trustedOrigins: [process.env.CHATLYTICS_ORIGIN ?? "http://localhost:8050"],
});
```

```typescript
// Source: https://better-auth.com/docs/integrations/express (toNodeHandler)
// monitor.ts — inside requestListener, BEFORE other routes and BEFORE body reading
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

if (req.url?.startsWith("/api/auth/")) {
  return void toNodeHandler(auth)(req, res);
}
```

**Critical note:** Mount better-auth BEFORE any body-reading code. Raw Node.js streams can only be read once — if `readRequestBodyWithLimit` runs first, better-auth gets empty body.

### Pattern 2: React AuthGate
**What:** Wrap the existing `App` render in an auth check. If no better-auth session exists, show Login/Register.

```typescript
// Source: https://better-auth.com/docs/installation
// src/admin/src/components/AuthGate.tsx
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient();

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <Skeleton className="h-screen w-full" />;
  if (!session) return <LoginPage />;
  return <>{children}</>;
}
```

### Pattern 3: QR Polling Flow
**What:** Dashboard calls proxy route `GET /api/admin/qr?session=xxx` which fetches WAHA's `GET /api/{session}/auth/qr` with `Accept: application/json` and returns base64 PNG. Dashboard polls every 20 seconds until status is WORKING.

```typescript
// WAHA QR endpoint
// GET /api/{session}/auth/qr with Accept: application/json
// Response: { mimetype: "image/png", data: "<base64>" }
// Poll status: GET /api/{session} -> { status: "SCAN_QR_CODE" | "WORKING" | "FAILED" }
// Poll interval: 20 seconds (WAHA rotates QR every 20s after first 60s window)

// React polling pattern
useEffect(() => {
  const poll = setInterval(async () => {
    const { qrBase64, status } = await api.getQr(session);
    if (status === "WORKING") { clearInterval(poll); onConnected(); }
    else setQrImage(qrBase64);
  }, 20_000);
  return () => clearInterval(poll);
}, [session]);
```

**QR status values (verified from WAHA docs):**
- `SCAN_QR_CODE` — awaiting scan, refresh QR image on each poll
- `WORKING` — authenticated, show success state
- `FAILED` — error state, offer restart button

### Pattern 4: API Key Show-Once UI
**What:** On `authClient.apiKey.create()` response, the `key` field is only present in the create response. Store it in React state briefly, show with copy button. On any subsequent list/get, `key` is absent — show only via `end` field (last 4 chars).

```typescript
// Source: https://better-auth.com/docs/plugins/api-key
const { data } = await authClient.apiKey.create({ name: "Production" });
// data.key = "ctl_xxxxxxxxxxxx" — show NOW, store in state, never fetched again

const { data: keys } = await authClient.apiKey.list();
// keys[0].key = undefined, keys[0].end = "xxxx" — show as "ctl_...xxxx"
```

### Pattern 5: API Key Rotation (AUTH-05)
**What:** Delete old key, create new key. Old key is immediately invalid.

```typescript
// Rotation = delete + create
await authClient.apiKey.delete({ keyId: oldKeyId });
const { data: newKey } = await authClient.apiKey.create({ name: oldKeyName });
// Show newKey.key once — only chance to display plaintext
```

Invalidation is immediate — `verifyApiKey` queries DB by hashed key; deleted row = instant 401 on next API call.

### Anti-Patterns to Avoid
- **Storing auth in openclaw.json:** better-auth uses its own `auth.db` SQLite file. Keep user credentials out of `openclaw.json`.
- **Polling QR from server via SSE:** Simple React polling is sufficient. SSE adds complexity for no gain here.
- **Mounting better-auth AFTER body parsing:** `toNodeHandler` reads raw request body. Mount it FIRST.
- **Changing better-auth basePath:** Default is `/api/auth`. All client SDK methods hard-code relative paths against this. Do NOT override it.
- **Re-opening auth.db per request:** Open `auth.db` once in `auth.ts` module scope — same pattern as `getDirectoryDb`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | bcrypt/argon2 DIY | better-auth emailAndPassword | Handles salt, iterations, timing-safe compare internally |
| Session tokens | crypto.randomBytes + Map | better-auth session plugin | Cookie signing, expiry, DB persistence, revocation |
| API key storage | crypto.randomBytes + SHA-256 table | @better-auth/api-key | Hash-on-write, show-once, prefix, soft-delete all built in |
| Auth state in React | useState + useEffect | authClient.useSession() | Handles refetch, pending, logout automatically |
| CSRF protection | custom header check | better-auth trustedOrigins | Built-in origin check via cookie strategy |

**Key insight:** The `@better-auth/api-key` plugin already implements AUTH-04's exact UX requirement — plaintext only on create, hashed storage, `end` field for last-4 display. Do not replicate.

## Common Pitfalls

### Pitfall 1: Body Already Consumed
**What goes wrong:** monitor.ts calls `readRequestBodyWithLimit()` before routing. If `/api/auth/*` hits this path first, better-auth gets empty body and POST sign-in fails silently.
**Why it happens:** Raw Node.js streams can only be read once.
**How to avoid:** Add the `startsWith("/api/auth/")` guard at the very TOP of the requestListener, before any body reading code.
**Warning signs:** `auth.signIn.email()` returns 400 or better-auth reports empty body.

### Pitfall 2: better-auth Schema Migration
**What goes wrong:** better-auth needs tables (`user`, `session`, `account`, `apiKey`, `verification`). If auth.db is fresh and no migration has run, all calls fail immediately.
**Why it happens:** Unlike DirectoryDb/AnalyticsDb which call `CREATE TABLE IF NOT EXISTS` on init, better-auth delegates schema to its CLI.
**How to avoid:** Call `npx @better-auth/cli migrate --config src/auth.ts` as a Wave 0 task, OR call the programmatic migration API if available in 1.5.6.
**Warning signs:** `no such table: user` in gateway logs.

### Pitfall 3: QR Code Expiry Window
**What goes wrong:** WAHA first QR expires after 60 seconds, subsequent ones after 20 seconds. A 30-second poll interval will serve stale QR codes.
**Why it happens:** WAHA rotates QR on each WhatsApp authentication refresh cycle.
**How to avoid:** Poll every 20 seconds from React useEffect with cleanup. Start polling only when status is `SCAN_QR_CODE`.
**Warning signs:** QR shown but scan fails, WhatsApp shows "QR code expired."

### Pitfall 4: React Auth State Flash
**What goes wrong:** After `signIn.email()` succeeds, `useSession()` briefly returns null/pending before refetch completes — renders LoginPage again momentarily.
**Why it happens:** `useSession()` re-fetches after sign-in completes.
**How to avoid:** Always render a loading skeleton during `isPending = true`, not a redirect. The flash is invisible under the skeleton.
**Warning signs:** Flash of login screen after successful login.

### Pitfall 5: Vite Dev Proxy Missing
**What goes wrong:** During `npm run dev:admin`, Vite dev server at port 5173 does not proxy `/api/auth/*` to the backend. All auth calls return 404.
**Why it happens:** vite.admin.config.ts has no proxy config.
**How to avoid:** Add to vite.admin.config.ts:
```typescript
server: { proxy: { '/api': 'http://localhost:8050' } }
```
**Warning signs:** 404 on `/api/auth/sign-in` in browser console during dev.

### Pitfall 6: better-auth CORS for SPA Dev
**What goes wrong:** React SPA at localhost:5173 calls `/api/auth/*` — hits CORS.
**Why it happens:** better-auth's `trustedOrigins` must list all allowed origins explicitly.
**How to avoid:** Either use Vite proxy (eliminates cross-origin), or set `trustedOrigins: ["http://localhost:5173", "http://localhost:8050"]` in auth config.
**Warning signs:** CORS errors in browser console on auth calls in dev mode.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom JWT + bcrypt | better-auth 1.5.x | 2024-2025 | Full auth framework: sessions, API keys, plugins all included |
| apiKey in better-auth/plugins bundle | @better-auth/api-key separate package | v1.5 | Must install separately, different import path |
| `better-auth/client/plugins` import | `@better-auth/api-key/client` | v1.5 | Breaking import change — use new path exclusively |

**Deprecated/outdated:**
- `better-auth/client/plugins` for apiKey: replaced by `@better-auth/api-key/client` in v1.5+
- `basePath: "/"` override: avoid — breaks all client SDK relative path resolution

## Open Questions

1. **better-auth auto-migrate on startup**
   - What we know: The `npx @better-auth/cli migrate` CLI creates tables, but it's unclear if `betterAuth()` itself auto-creates tables on first use in v1.5.6.
   - What's unclear: Does instantiating `betterAuth({ database: db })` automatically run schema creation, or is an explicit migration step required?
   - Recommendation: Plan 01 Wave 0 should include a verification step: start server, call `GET /api/auth/ok`, check if tables exist. If not, embed `CREATE TABLE IF NOT EXISTS` for the known 5 tables as a startup migration in `auth.ts`.

2. **Workspace model scope for Phase 63 vs Phase 64**
   - What we know: AUTH-02 requires workspace creation. Phase 64 handles full per-tenant process isolation.
   - What's unclear: Does Phase 63 workspace need a `workspaces` SQLite table, or is a simple `workspaceId` field on the user sufficient?
   - Recommendation: Keep it minimal — add `workspaceId` as a `user.additionalFields` entry in better-auth, created in `databaseHooks.user.create.after`. No separate workspace table needed for Phase 63 scope.

3. **Auth gating scope**
   - What we know: ADMIN-01 (Phase 65) formalizes standalone auth. Phase 63 introduces auth.
   - What's unclear: Should the auth gate cover ALL admin tabs in Phase 63, or only the new onboarding screens?
   - Recommendation: Gate the full admin panel in Phase 63. Partial gating is harder to reason about and Phase 65 only extends it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| better-auth | AUTH-01..05 | ✗ | — | None — must install |
| @better-auth/api-key | AUTH-04, AUTH-05 | ✗ | — | None — must install |
| better-sqlite3 | better-auth SQLite adapter | ✓ | 11.10.0 | — |
| vitest | test suite | ✓ | 4.0.18 | — |
| WAHA API | AUTH-03 | ✓ (hpg6) | deployed | — |

**Missing dependencies with no fallback:**
- `better-auth` and `@better-auth/api-key` — Plan 01 Wave 0 must run `npm install better-auth @better-auth/api-key` before any code tasks.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | package.json scripts.test |
| Quick run command | `npx vitest run src/auth.test.ts` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | User registers with email+password, session created | unit | `npx vitest run src/auth.test.ts` | No — Wave 0 |
| AUTH-02 | Workspace row / workspaceId created after registration | unit | `npx vitest run src/auth.test.ts` | No — Wave 0 |
| AUTH-03 | GET /api/admin/qr proxy returns base64 + status field | unit | `npx vitest run src/monitor.test.ts` | Extend existing |
| AUTH-04 | API key create returns plaintext key; list returns only end field | unit | `npx vitest run src/auth.test.ts` | No — Wave 0 |
| AUTH-05 | Delete key then verifyApiKey returns valid:false immediately | unit | `npx vitest run src/auth.test.ts` | No — Wave 0 |
| AUTH-06 | Integration wizard renders all 3 options (MCP/REST/SKILL.md) | manual | n/a — pure UI rendering | n/a |

### Sampling Rate
- **Per task commit:** `npx vitest run src/auth.test.ts`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/auth.test.ts` — covers AUTH-01, AUTH-02, AUTH-04, AUTH-05
- [ ] `npm install better-auth @better-auth/api-key` — must run before any auth code compiles
- [ ] Schema migration verification — confirm whether better-auth auto-creates tables or requires explicit CLI/migration step

## Sources

### Primary (HIGH confidence)
- https://better-auth.com/docs/adapters/sqlite — SQLite adapter with better-sqlite3 constructor pattern (verified 2026-03-28)
- https://better-auth.com/docs/plugins/api-key — apiKey plugin, show-once semantics, verifyApiKey signature (verified 2026-03-28)
- https://better-auth.com/docs/integrations/express — toNodeHandler import path (`better-auth/node`) confirmed (verified 2026-03-28)
- https://waha.devlike.pro/docs/how-to/sessions/ — WAHA QR endpoint format, status values, 20s rotation interval (verified 2026-03-28)

### Secondary (MEDIUM confidence)
- https://better-auth.com/blog/1-5 — v1.5 breaking change: @better-auth/api-key is separate package with new import paths
- https://dev.to/danimydev/authentication-with-nodehttp-and-better-auth-2l2g — vanilla Node.js HTTP integration pattern with toNodeHandler

### Tertiary (LOW confidence)
- WebSearch cross-reference for @better-auth/api-key/client import path change in v1.5 — single source, needs validation at install time

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions confirmed via npm registry, docs verified via official site
- Architecture: HIGH — toNodeHandler pattern confirmed in official docs + community article
- Pitfalls: HIGH — body-consumed pitfall is architectural fact; QR timing from official WAHA docs; React state flash is well-known pattern
- API key show-once: HIGH — official plugin docs explicitly state getApiKey() returns Omit<ApiKey, "key">

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (better-auth moves fast — re-verify import paths if beyond 30 days)
