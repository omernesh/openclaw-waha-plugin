# Phase 65: Admin Standalone + Distribution - Research

**Researched:** 2026-03-28
**Domain:** React SPA admin panel, workspace CRUD UI, SKILL.md authoring, static landing page + docs site
**Confidence:** HIGH

## Summary

Phase 65 finalises the public-facing identity of Chatlytics. It has five requirements spanning two different concerns: (1) admin panel changes (ADMIN-01, ADMIN-02) and (2) distribution materials (SKILL-01, SITE-01, SITE-02).

The admin panel already has standalone better-auth via `AuthGate` + `LoginPage` (Phase 63). The auth works independently of OpenClaw — `auth.ts` uses a local SQLite `auth.db`, and the Chatlytics HTTP server in `monitor.ts` mounts the `better-auth` handler at `/api/auth/*`. ADMIN-01 is mostly **already done** — the success criterion is "admin panel login works without an OpenClaw gateway running", which is satisfied by the current architecture. The gap is documentation clarity and ensuring the server can boot standalone (already true via `standalone.ts`). ADMIN-02 requires a new WorkspaceTab in the React admin that calls backend CRUD endpoints for workspace creation/switching/deletion.

For distribution (SKILL-01, SITE-01, SITE-02): SKILL.md v4 is a content rewrite of the existing file — replace OpenClaw-specific action syntax with Chatlytics API key + MCP endpoint references. SITE-01 and SITE-02 are new static HTML deliverables: a landing page and a docs page with interactive API examples. These are **not** served by the React admin SPA — they are separate static files (either inline HTML or a minimal separate Vite build) that would be deployed to chatlytics.ai.

**Primary recommendation:** ADMIN-01 needs only a verification pass + sidebar entry confirmation. ADMIN-02 needs a new WorkspacesTab React component + 3 backend API routes. SKILL-01 is a SKILL.md content rewrite. SITE-01 and SITE-02 are new static HTML files.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — all implementation choices are at Claude's discretion.

### Claude's Discretion
All implementation choices are at Claude's discretion. Key areas:
- Workspace CRUD UI components
- SKILL.md v4 format (Chatlytics API key + MCP references)
- Landing page design (single HTML or React)
- Docs site approach (markdown or React pages)

### Deferred Ideas (OUT OF SCOPE)
None stated.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | Admin panel with standalone auth (not embedded in OpenClaw gateway) | AuthGate + LoginPage already implemented in Phase 63. Standalone boot confirmed via standalone.ts. Gap is only sidebar visibility of auth status + confirming no OC dependency at login time. |
| ADMIN-02 | Workspace management in admin panel (create, switch, delete workspaces) | Requires new WorkspacesTab component + backend routes GET/POST/DELETE /api/admin/workspaces. better-auth user table has workspaceId field. WorkspaceProcessManager handles runtime. |
| SKILL-01 | SKILL.md v4 referencing Chatlytics API key + MCP config (framework-agnostic) | SKILL.md v6.0.0 currently references OpenClaw action syntax. v4 is a content rewrite with Chatlytics REST API + MCP tool names instead. |
| SITE-01 | Landing page at chatlytics.ai with product overview and getting started guide | New static HTML file (or minimal Vite build) outside the React admin SPA. Single-page marketing site. |
| SITE-02 | API documentation site with interactive examples and copy-paste MCP config snippets | New docs HTML with code blocks, copy buttons, and MCP config snippets. Can reuse IntegrationWizardTab patterns. |
</phase_requirements>

---

## Standard Stack

### Core (all already in package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.2.4 | Admin SPA UI | Already used — DO NOT change |
| shadcn/ui (Radix UI) | various ^1.x | Component primitives | Already used — DO NOT change |
| better-auth | ^1.5.6 | Session auth + API keys | Already wired in auth.ts |
| @better-auth/api-key | ^1.5.6 | API key plugin | Already wired |
| lucide-react | ^0.577.0 | Icons | Already used |
| sonner | ^2.0.7 | Toast notifications | Already used |
| Tailwind CSS v4 | ^4.2.1 | Styling | Already used |
| Vite | ^8.0.0 | Admin SPA build | Already used |

### No new packages required
All work fits within the existing dependency set. SITE-01 and SITE-02 are static HTML — no additional framework needed.

## Architecture Patterns

### Recommended Project Structure additions
```
src/admin/src/components/tabs/
├── WorkspacesTab.tsx       # ADMIN-02 — new workspace CRUD tab
src/
├── admin-workspaces.ts     # ADMIN-02 — backend routes GET/POST/DELETE
docs/site/
├── index.html              # SITE-01 — chatlytics.ai landing page
├── docs.html               # SITE-02 — API docs with interactive examples
SKILL.md                    # SKILL-01 — v4 content rewrite (framework-agnostic)
```

### Pattern 1: Workspace CRUD backend routes (ADMIN-02)

Three new routes in `monitor.ts` (or extracted to `admin-workspaces.ts`):

```typescript
// GET /api/admin/workspaces — list all workspaces from auth.db
// POST /api/admin/workspaces — create new workspace (insert user row + assign workspaceId)
// DELETE /api/admin/workspaces/:workspaceId — delete workspace + stop child process

// Route guard: same session-cookie auth as other /api/admin/* routes
// IMPORTANT: These routes operate on the auth.db, not per-workspace DBs
```

Pattern follows existing `/api/admin/sessions` — session-cookie auth guard, JSON body, JSON response.

### Pattern 2: WorkspacesTab React component (ADMIN-02)

```typescript
// src/admin/src/components/tabs/WorkspacesTab.tsx
// - Uses authClient.useSession() to show current workspace
// - Fetches GET /api/admin/workspaces for list
// - Card-per-workspace with: name, workspaceId (truncated), status badge, Delete button
// - "Create Workspace" dialog (name input) → POST /api/admin/workspaces
// - Switch workspace = POST /api/auth/sign-in/email to switch session (or navigate to /workspaces)
//   NOTE: better-auth sessions are per-user, not per-workspace. "Switch" means log in as
//   that workspace's owner user. Simplest: show workspaceId + copy button, no runtime switch.
// - Delete confirmation dialog before DELETE call
```

**Workspace switch semantics clarification:** Each workspace is owned by one user (user.workspaceId assigned at registration). There is no "switch workspace for same user" in better-auth's model. ADMIN-02's "switch between workspaces" most likely means: the admin UI shows all workspaces with their status/config, and an operator can open each workspace's admin panel by logging in as that workspace's user. The simplest compliant approach: WorkspacesTab lists all workspaces (from auth.db `user` table), shows status (from WorkspaceProcessManager), and provides copy-workspaceId + delete actions.

### Pattern 3: SKILL.md v4 rewrite (SKILL-01)

Current SKILL.md is v6.0.0 and references OpenClaw action names (`Action: send | Target: "group"`). v4 must be framework-agnostic: reference the Chatlytics REST API (`POST /api/v1/send`) and MCP tool names (`send_message`, `send_media`, etc.) with no OpenClaw-specific syntax.

Structure:
```markdown
---
name: chatlytics-whatsapp
description: Use when the agent needs to send/receive WhatsApp messages via Chatlytics
metadata:
  version: 4.0.0
---

## Authentication
API key in Authorization header: `Bearer ctl_xxx`
Server: CHATLYTICS_URL (default http://localhost:8050)

## MCP Config (Claude Desktop / cursor / continue)
{ "mcpServers": { "chatlytics": { "url": "http://localhost:8050/mcp" } } }

## REST Quick Start
POST /api/v1/send  { "chatId": "...", "text": "..." }
GET  /api/v1/messages?chatId=...&limit=20
...
```

### Pattern 4: Static landing page (SITE-01)

Single `docs/site/index.html` — self-contained HTML with inline CSS and no build step. Tailwind CDN or plain CSS. Structure:
- Hero: "Chatlytics — WhatsApp for AI Agents"
- Feature list: MCP, REST API, CLI, multi-tenant, mimicry enforcement
- Getting started: Docker run snippet + link to docs
- Link to docs page (SITE-02)

### Pattern 5: Docs site (SITE-02)

Single `docs/site/docs.html` — static HTML with:
- Interactive API examples: code blocks with Copy buttons (vanilla JS, no React)
- MCP config snippet (copy-paste for Claude Desktop, cursor, continue.dev)
- REST curl examples with real endpoint paths from openapi.yaml
- Section anchors for deep-linking

### Anti-Patterns to Avoid
- **Do not add a new SidebarProvider** for WorkspacesTab — it must be a sibling tab inside the existing `App.tsx` render switch.
- **Do not call initAuthDb() in workspace child processes** — already guarded by `!CHATLYTICS_WORKSPACE_ID` check in `monitor.ts`. Do not remove that guard.
- **Do not use a full framework (Next.js, Astro) for the landing page** — static HTML is sufficient and avoids adding build complexity for a marketing page.
- **Do not mutate SKILL.md version field to v7** — the requirement specifies "v4" to match the Chatlytics product versioning (not the internal development iteration counter).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth session check in WorkspacesTab | Custom token fetch | `authClient.useSession()` | Already used in AuthGate — consistent pattern |
| Workspace list from auth.db | Raw SQLite in route | Query `user` table via existing `auth.ts` db reference | auth.db is already open at module scope |
| Copy-to-clipboard in docs site | Custom clipboard API wrapper | `navigator.clipboard.writeText()` + fallback | Same pattern as IntegrationWizardTab's CopyButton |
| Toast feedback in WorkspacesTab | Custom notification | `sonner` toast | Already used across all tabs |

## Common Pitfalls

### Pitfall 1: Workspace "switch" misinterpretation
**What goes wrong:** Implementing workspace switching as changing the current user's active workspaceId in-session (like a multi-workspace org model).
**Why it happens:** ADMIN-02 says "switch between workspaces" — but better-auth's model is one user = one workspace.
**How to avoid:** Implement switch as "view workspace details" not "change active workspace". The logged-in operator sees all workspace records; switching is cosmetic/informational unless multi-user support (TEAM-01, deferred) is added.
**Warning signs:** If you find yourself modifying the session cookie or workspaceId during a "switch", stop — this is out of scope.

### Pitfall 2: WorkspacesTab route guard missing
**What goes wrong:** `/api/admin/workspaces` endpoints accept unauthenticated requests.
**Why it happens:** Forgetting to apply the same session-cookie auth guard used by all other `/api/admin/*` routes.
**How to avoid:** Copy the auth guard pattern from the existing `/api/admin/stats` or `/api/admin/config` route handler in `monitor.ts`.

### Pitfall 3: Deleting workspace without stopping child process
**What goes wrong:** DELETE /api/admin/workspaces/:id removes the DB record but the child process keeps running, leading to orphaned workers.
**Why it happens:** Backend route only touches auth.db, forgetting `WorkspaceProcessManager.stopWorkspace()`.
**How to avoid:** DELETE route must call `manager.stopWorkspace(workspaceId)` before removing the DB record.

### Pitfall 4: SKILL.md version confusion
**What goes wrong:** Bumping to v7.0.0 instead of v4.0.0 because the current file says v6.0.0.
**Why it happens:** Internal development iteration counter (6.0.0) vs product versioning (4.0.0 for Chatlytics era).
**How to avoid:** The requirement explicitly says "SKILL.md v4". Use metadata version: 4.0.0.

### Pitfall 5: Landing page served by wrong process
**What goes wrong:** SITE-01/SITE-02 HTML files are placed in `dist/admin/` and accidentally served as part of the admin SPA.
**Why it happens:** `dist/admin/` is the SPA output directory, served as static files by monitor.ts.
**How to avoid:** Keep landing page in `docs/site/` — it is a deployment artifact for chatlytics.ai, not served by the Chatlytics process.

### Pitfall 6: Admin standalone claim requires no-OC boot verification
**What goes wrong:** ADMIN-01 success criterion says "works without OpenClaw gateway running" — but the test might accidentally test with OC running.
**Why it happens:** Dev environment always has OC running.
**How to avoid:** Test by running `node src/standalone.ts` directly (without OpenClaw) and verifying the login page loads and auth works.

## Code Examples

### Session-cookie auth guard pattern (existing, copy this)
```typescript
// Source: monitor.ts — existing /api/admin/stats handler pattern
// All /api/admin/* routes check the better-auth session cookie:
const sessionResult = await auth.api.getSession({
  headers: new Headers({ cookie: req.headers.cookie ?? '' }),
})
if (!sessionResult?.user) {
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Unauthorized' }))
  return
}
```

### Query all workspaces from auth.db
```typescript
// auth.db is open at module scope in auth.ts — export the db reference,
// or query via a raw SQL call from the route handler:
// (authDb is already imported where auth.ts is used)
const workspaces = authDb
  .prepare('SELECT id, name, email, workspaceId, createdAt FROM user ORDER BY createdAt DESC')
  .all() as Array<{ id: string; name: string; email: string; workspaceId: string; createdAt: string }>
```

### WorkspacesTab fetch pattern
```typescript
// Source: follows GET /api/admin/sessions pattern in SessionsTab
const res = await fetch('/api/admin/workspaces', { credentials: 'include' })
if (!res.ok) throw new Error('Failed to load workspaces')
const data = await res.json() as WorkspaceEntry[]
```

### WorkspaceProcessManager stop call
```typescript
// Source: workspace-manager.ts — stopWorkspace method
await manager.stopWorkspace(workspaceId)
// Then remove from auth.db
authDb.prepare('DELETE FROM user WHERE workspaceId = ?').run(workspaceId)
```

### MCP config snippet for SKILL.md v4
```json
{
  "mcpServers": {
    "chatlytics": {
      "type": "http",
      "url": "http://localhost:8050/mcp",
      "headers": {
        "Authorization": "Bearer ctl_YOUR_API_KEY"
      }
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Admin panel auth via OpenClaw session | better-auth with local SQLite auth.db | Phase 63 | Auth is now fully standalone |
| Single workspace per deploy | WorkspaceProcessManager with per-workspace child processes | Phase 64 | Multi-tenant ready |
| SKILL.md with OpenClaw action syntax | SKILL.md v4 with Chatlytics API key + MCP endpoint | Phase 65 | Framework-agnostic distribution |

## Open Questions

1. **Workspace "switch" UX scope**
   - What we know: better-auth is one-user-one-workspace; no runtime switch mechanism exists
   - What's unclear: Does ADMIN-02 intend a multi-user model (one admin manages all workspaces) or just per-workspace operator views?
   - Recommendation: Implement as "list all workspaces with status + delete" — satisfies the success criterion ("create, switch between, and delete workspaces from the admin panel") by interpreting "switch" as navigating to a workspace's detail view. If multi-user context is needed later, TEAM-01 (deferred) covers it.

2. **chatlytics.ai hosting**
   - What we know: Domain is chatlytics.ai (confirmed in MEMORY.md). Landing page is SITE-01.
   - What's unclear: Who deploys the static files? Is there a CI/CD target?
   - Recommendation: Produce the HTML files as deliverables in `docs/site/`. Deployment to chatlytics.ai is out of scope for this phase — just create the files.

## Environment Availability

Step 2.6: SKIPPED — Phase 65 is code + content changes only. No new external dependencies. All tools (Node, Vite, shadcn components, better-auth) already verified present in prior phases.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vite.admin.config.ts (for admin tests) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-01 | Auth gate blocks unauthenticated access | unit (React) | `npm test -- AuthGate` | Already covered by Phase 63 tests |
| ADMIN-02 | WorkspacesTab renders list + create + delete | unit (React) | `npm test -- WorkspacesTab` | New — Wave 0 gap |
| ADMIN-02 | GET /api/admin/workspaces returns list | unit (monitor) | `npm test -- monitor` | New — Wave 0 gap |
| SKILL-01 | SKILL.md v4 has no OpenClaw-specific syntax | manual review | — | Manual only |
| SITE-01 | Landing page renders in browser | manual | — | Manual only |
| SITE-02 | Docs page has copy-paste snippets | manual | — | Manual only |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/admin/src/components/tabs/__tests__/WorkspacesTab.test.tsx` — covers ADMIN-02 React component
- [ ] Additional monitor.ts test cases for `/api/admin/workspaces` routes — covers ADMIN-02 backend

## Sources

### Primary (HIGH confidence)
- Direct code reading: `src/auth.ts` — better-auth config, initAuthDb pattern
- Direct code reading: `src/workspace-manager.ts` — WorkspaceProcessManager, stopWorkspace
- Direct code reading: `src/workspace-gateway.ts` — auth resolution, routing
- Direct code reading: `src/monitor.ts` — existing /api/admin/* route pattern, static file serving
- Direct code reading: `src/admin/src/components/AuthGate.tsx` — existing auth gate implementation
- Direct code reading: `src/admin/src/components/LoginPage.tsx` — existing login form
- Direct code reading: `src/admin/src/components/AppSidebar.tsx` — existing tab list, TabId type
- Direct code reading: `src/admin/src/App.tsx` — existing tab switch pattern
- Direct code reading: `SKILL.md` — current v6.0.0 content to inform v4 rewrite
- Direct code reading: `package.json` — confirmed versions of all dependencies

### Secondary (MEDIUM confidence)
- REQUIREMENTS.md — ADMIN-01, ADMIN-02, SKILL-01, SITE-01, SITE-02 definitions
- STATE.md accumulated decisions — Phase 63 and Phase 64 architectural decisions

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in use, no new dependencies
- Architecture: HIGH — existing patterns clearly established across 64 phases
- Pitfalls: HIGH — derived from direct codebase reading + accumulated STATE.md decisions
- ADMIN-01 status: HIGH — already implemented in Phase 63; this phase verifies + documents

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable stack, no fast-moving dependencies)
