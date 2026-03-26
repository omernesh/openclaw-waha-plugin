---
phase: 18-react-scaffold
plan: "01"
subsystem: admin-ui
tags: [vite, react, tailwind, shadcn-ui, scaffold, build-pipeline]
dependency_graph:
  requires: []
  provides: [react-admin-scaffold, vite-build-pipeline, typed-api-client, tailwind-theme]
  affects: [package.json, src/admin/, dist/admin/]
tech_stack:
  added:
    - vite@8.0.0
    - "@vitejs/plugin-react@6.0.1"
    - "@tailwindcss/vite@4.2.1"
    - tailwindcss@4.2.1
    - react@19.2.4
    - react-dom@19.2.4
    - lucide-react@0.577.0
    - class-variance-authority@0.7.1
    - clsx@2.1.1
    - tailwind-merge@3.5.0
    - "@types/react@19.2.14"
    - "@types/react-dom@19.2.3"
  patterns:
    - Vite isolated root (root=src/admin, outDir=../../dist/admin)
    - Tailwind v4 @import syntax with @theme inline CSS variables
    - shadcn/ui Zinc theme variables in oklch format (light + dark)
    - Typed fetch wrapper with ApiError class
key_files:
  created:
    - vite.admin.config.ts
    - src/admin/index.html
    - src/admin/tsconfig.json
    - src/admin/src/main.tsx
    - src/admin/src/App.tsx
    - src/admin/src/index.css
    - src/admin/src/vite-env.d.ts
    - src/admin/src/lib/utils.ts
    - src/admin/src/lib/api.ts
    - src/admin/src/types.ts
  modified:
    - package.json (scripts + files field)
    - .gitignore (added dist/)
decisions:
  - Used --legacy-peer-deps for npm install (vitest peer requires vite ^6-7, plugin-react@6 requires vite ^8 — resolved with flag)
  - All routes in api.ts are live (none commented out) — route audit found every API method has a corresponding handler in monitor.ts
  - dist/ added to .gitignore (build artifact); npm publish uses files allowlist to include dist/admin/
metrics:
  duration_minutes: 6
  tasks_completed: 3
  tasks_total: 3
  files_created: 10
  files_modified: 2
  completed_date: "2026-03-18"
---

# Phase 18 Plan 01: React Scaffold Summary

**One-liner:** Vite 8 + React 19 + Tailwind v4 + shadcn/ui Zinc theme scaffold in src/admin/ with typed API client covering all 30+ /api/admin/* endpoints.

## What Was Built

Initialized the complete React admin app scaffold that all downstream phases (19-24) build on:

- **Build pipeline**: `vite.admin.config.ts` with `root: 'src/admin'`, `outDir: '../../dist/admin'` — `npm run build:admin` produces `dist/admin/index.html` + hashed JS/CSS bundles
- **React app skeleton**: `src/admin/src/main.tsx` (createRoot), `App.tsx` placeholder, `index.css` with Tailwind v4 + full shadcn/ui Zinc dark/light theme in oklch format
- **Typed API client**: `src/admin/src/lib/api.ts` — exports `api` object with typed methods for all existing `/api/admin/*` routes, `ApiError` class surfaces HTTP status codes
- **TypeScript types**: `src/admin/src/types.ts` — response types for all endpoints (StatsResponse, ConfigResponse, SessionsResponse, DirectoryResponse, etc.)
- **Package updates**: `build:admin`, `dev:admin`, `build` scripts added to package.json; `dist/admin/` added to `files` allowlist; `dist/` added to `.gitignore`

## Verification

- `npm run build` exits 0 — full build pipeline works
- `dist/admin/index.html` exists — Vite HTML entry produced
- `dist/admin/assets/` contains hashed `.js` and `.css` — bundles present
- `npm pack --dry-run` shows `dist/admin/` files in the tarball
- `src/admin/src/index.css` contains both `@theme inline` (light) and `.dark` (dark) theme variables

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 44a04fd | Scaffold files: vite config, index.html, tsconfig, main.tsx, App.tsx, index.css, utils.ts, deps |
| Task 2 | f90765b | API client (api.ts) and response types (types.ts) |
| Task 3 | bb3a8c4 | package.json files field + .gitignore |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] npm install peer dependency conflict**
- **Found during:** Task 1 (step 1 of npm install)
- **Issue:** `@vitejs/plugin-react@6.0.1` requires `vite@^8.0.0`, but `vitest@4.0.18` peer-requires `vite@^6.0.0 || ^7.0.0` — conflict between the two
- **Fix:** Used `--legacy-peer-deps` flag for both npm install commands, as documented in the plan's FALLBACK note
- **Files modified:** package.json, package-lock.json (dependency resolution)
- **Commit:** 44a04fd

**2. [Rule 2 - Missing functionality] allow-dm route uses POST not PUT**
- **Found during:** Task 2 (route audit)
- **Issue:** The plan template showed `toggleAllowDm` as a PUT; monitor.ts audit revealed it is `POST /api/admin/directory/:jid/allow-dm`
- **Fix:** api.ts uses `method: 'POST'` for `toggleAllowDm` (matches actual server implementation)
- **Commit:** f90765b

**3. [Rule 2 - Missing routes] Additional routes found during audit not in plan template**
- **Found during:** Task 2 (route audit)
- **Issue:** Plan template listed ~15 api methods; audit found 30+ routes in monitor.ts including: `/directory/:jid/filter` (GET+PUT), `/directory/:jid/ttl` (PUT), participant allow-dm + role endpoints
- **Fix:** Added all missing routes to api.ts with proper types — `getGroupFilter`, `updateGroupFilter`, `setDirectoryTtl`, `toggleParticipantAllowDm`, `updateParticipantRole`
- **Commit:** f90765b

## Self-Check: PASSED

Files exist:
- vite.admin.config.ts: FOUND
- src/admin/index.html: FOUND
- src/admin/tsconfig.json: FOUND
- src/admin/src/main.tsx: FOUND
- src/admin/src/App.tsx: FOUND
- src/admin/src/index.css: FOUND
- src/admin/src/lib/utils.ts: FOUND
- src/admin/src/lib/api.ts: FOUND
- src/admin/src/types.ts: FOUND
- dist/admin/index.html: FOUND (post-build)

Commits exist:
- 44a04fd: FOUND
- f90765b: FOUND
- bb3a8c4: FOUND
