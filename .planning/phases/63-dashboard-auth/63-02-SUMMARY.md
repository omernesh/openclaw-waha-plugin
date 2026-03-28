---
phase: 63-dashboard-auth
plan: "02"
subsystem: auth-ui
tags: [better-auth, react, auth-gate, qr-pairing, api-keys, admin-panel]
dependency_graph:
  requires: [63-01]
  provides: [AuthGate, LoginPage, OnboardingTab, ApiKeysTab, qr-proxy-route]
  affects: [src/monitor.ts, src/admin/src/App.tsx, src/admin/src/components/AppSidebar.tsx]
tech_stack:
  added: [better-auth@1.5.6 (react client), "@better-auth/api-key@1.5.6 (client plugin)"]
  patterns: [authClient.useSession, signIn.email, signUp.email, apiKey.create/list/delete, setInterval-QR-polling]
key_files:
  created:
    - src/admin/src/lib/auth-client.ts
    - src/admin/src/components/AuthGate.tsx
    - src/admin/src/components/LoginPage.tsx
    - src/admin/src/components/tabs/OnboardingTab.tsx
    - src/admin/src/components/tabs/ApiKeysTab.tsx
  modified:
    - src/monitor.ts
    - src/admin/src/App.tsx
    - src/admin/src/components/AppSidebar.tsx
    - src/admin/package.json
decisions:
  - "AuthGate wraps App outside SSEProvider — no SSE connection until authenticated"
  - "better-auth/react import for createAuthClient (not better-auth/client)"
  - "@better-auth/api-key/client for apiKeyClient (verified from package.json exports)"
  - "QR proxy uses callWahaApi with query:{format:image} (no extraHeaders — not in CallWahaApiParams)"
  - "OnboardingTab polling uses setInterval (not useEffect dependency) to avoid re-mounting on every tick"
  - "ApiKey masking uses start field from better-auth (prefix chars) not the full key"
metrics:
  duration: 14m
  completed_date: "2026-03-28"
  tasks_completed: 2
  files_changed: 9
requirements: [AUTH-03, AUTH-04, AUTH-05]
---

# Phase 63 Plan 02: React Auth Gate, QR Pairing Tab, API Keys Tab Summary

**One-liner:** better-auth React client wired into AuthGate/LoginPage; QR proxy route in monitor.ts; OnboardingTab (20s QR polling); ApiKeysTab (create show-once, list masked, rotate, delete).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | QR proxy route + auth client + AuthGate + LoginPage | b45054c | src/monitor.ts, src/admin/src/lib/auth-client.ts, src/admin/src/components/AuthGate.tsx, src/admin/src/components/LoginPage.tsx, src/admin/src/App.tsx, src/admin/package.json |
| 2 | OnboardingTab + ApiKeysTab + sidebar wiring | 372d3e9 | src/admin/src/components/tabs/OnboardingTab.tsx, src/admin/src/components/tabs/ApiKeysTab.tsx, src/admin/src/components/AppSidebar.tsx, src/admin/src/App.tsx |

## What Was Built

### src/admin/src/lib/auth-client.ts
- `createAuthClient` from `better-auth/react` with `apiKeyClient()` plugin
- Auto-discovers `/api/auth/*` relative to current origin (Vite proxy handles dev server)

### src/admin/src/components/AuthGate.tsx
- `authClient.useSession()` check — skeleton while pending, `<LoginPage>` if no session, children if authenticated
- Wraps entire App outside SSEProvider — no EventSource until authenticated

### src/admin/src/components/LoginPage.tsx
- shadcn Card with login/register mode toggle
- `authClient.signIn.email()` / `authClient.signUp.email()`
- sonner toast for errors, loading spinner on submit button

### src/monitor.ts QR Routes
- `GET /api/admin/qr?session=xxx` — proxies WAHA `/api/{session}/auth/qr` + `/api/{session}` status
- `POST /api/admin/qr/start?session=xxx` — creates new WAHA session with NOWEB store enabled
- Uses `callWahaApi` with correct params signature (no `extraHeaders` field)

### src/admin/src/components/tabs/OnboardingTab.tsx
- Three states: scanning (QR shown), connected (checkmark), error (retry button)
- `setInterval` every 20s polls `/api/admin/qr` — auto-clears when status === "WORKING"
- "Start New Session" form with `POST /api/admin/qr/start`
- Icons: QrCode, Check, RefreshCw, AlertCircle from lucide-react

### src/admin/src/components/tabs/ApiKeysTab.tsx
- `authClient.apiKey.list()` on mount — displays masked keys (`ctl_...????` using `start` field)
- Create: name field → `authClient.apiKey.create()` → show-once dialog with plaintext + copy button
- Rotate: `delete()` old key + `create()` new key with same name → show-once dialog
- Delete: confirm dialog → `authClient.apiKey.delete()`
- shadcn Table, Dialog, Button, Badge components

### AppSidebar.tsx + App.tsx
- `TabId` extended with `'onboarding'` and `'api-keys'`
- "Onboarding" (QrCode icon) and "API Keys" (Key icon) added after Dashboard
- Both tabs lazy-loaded in App.tsx renderActiveTab() switch

## Checkpoint: Human Verification Required (Task 3)

Task 3 is a `checkpoint:human-verify` gate. The following must be verified in browser:

1. Open admin panel (http://localhost:8050 or deployed URL)
2. Verify login/register form appears (NOT the admin panel directly)
3. Register a new account — verify redirect into admin panel with all existing tabs
4. Navigate to "Onboarding" tab — verify QR code displays (or session status)
5. Navigate to "API Keys" tab — create a key, verify full plaintext shown with copy button
6. Refresh page — verify key now shows as masked (ctl_...????)
7. Click "Rotate" — verify new plaintext shown, old key format changes
8. Sign out and back in — verify session persistence

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] callWahaApi signature correction**
- **Found during:** Task 1 — QR proxy route
- **Issue:** Plan showed `callWahaApi(opts.config, "GET", path, null, { Accept: "application/json" })` but actual signature is `callWahaApi(params: CallWahaApiParams)` — params object, not positional args. Also `extraHeaders` is not in `CallWahaApiParams`.
- **Fix:** Used `{ baseUrl, apiKey, session, method, path, query: { format: "image" }, skipRateLimit, timeoutMs, context }` params object. QR endpoint returns JSON by default when `format` query matches WAHA API expectations.
- **Files modified:** src/monitor.ts
- **Commit:** b45054c

## Known Stubs

None — all functionality is wired to real better-auth endpoints and WAHA API. The `start` field masking in ApiKeysTab shows `ctl_...????` because better-auth returns the key prefix in the `start` field, and the last-4 suffix is only available on the full key (which is shown in the create dialog). This is the intended security pattern, not a stub.

## Self-Check: PASSED
