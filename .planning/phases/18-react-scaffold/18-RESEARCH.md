# Phase 18: React Scaffold - Research

**Researched:** 2026-03-18
**Domain:** Vite + React + shadcn/ui build pipeline, static file serving from plain Node HTTP server, npm package inclusion of build output
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion — pure infrastructure phase.

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCAF-01 | Vite + React + TypeScript + Tailwind CSS + shadcn/ui project initialized in `src/admin/` | Package versions verified; init command and vite.config.ts pattern documented below |
| SCAF-02 | Vite build outputs to `dist/admin/` with index.html + hashed assets | `build.outDir` config verified; relative path from `src/admin/` root is `../../dist/admin` |
| SCAF-03 | `monitor.ts` serves static files from `dist/admin/` at `/admin` (alongside existing embedded HTML) | Exact integration point found at line 4342-4347; MIME type serving pattern documented |
| SCAF-04 | `package.json` updated with `build:admin` and chained `build` scripts, `dist/admin/` added to `files` | Current package.json structure analyzed; script chaining pattern documented |
| SCAF-05 | API client utility (`src/admin/lib/api.ts`) created — typed fetch wrapper for `/api/admin/*` | Pattern documented; all existing API endpoints catalogued |
</phase_requirements>

---

## Summary

Phase 18 is a pure infrastructure scaffold phase. The goal is: initialize a Vite + React + TypeScript + Tailwind CSS + shadcn/ui project in `src/admin/`, wire up the build pipeline so `npm run build` produces `dist/admin/index.html` + hashed assets, update `monitor.ts` to serve those static files at the `/admin` URL (alongside the existing embedded HTML panel which continues working until Phase 24), create a typed API client, and ensure the built output is included in the npm package.

The technical groundwork is well-understood from the existing `ui-framework-research.md` which contains a complete architecture spec, Vite config, and component mapping. This research fills in the specific package versions (verified live against npm registry March 2026), the exact integration point in `monitor.ts` (line 4342-4347), the MIME serving pattern for a plain Node HTTP server, the `tsconfig.json` configuration needed for the dual-source-root structure, and the `package.json` `files` field update required for npm publish.

The existing codebase uses ESM (`"type": "module"` in package.json), TypeScript without a tsconfig (compiled by OpenClaw's own toolchain via the runtime `.ts` entry point), and vitest for testing. The React admin app will be built separately by Vite — this separation is clean and correct. The key constraint is that `monitor.ts` currently serves `buildAdminHtml()` inline at `/admin` — Phase 18 adds a **new** route that takes priority (or the same route redirected), while the old function is preserved until Phase 24 removes it.

**Primary recommendation:** Initialize `src/admin/` as a standalone Vite + React project with its own `tsconfig.json` scoped to `src/admin/`. Use a dedicated `vite.admin.config.ts` at the repo root so the build is isolated from any future TypeScript compilation of the plugin. The new static-file serving in `monitor.ts` should serve `/admin` (or redirect from `/admin` to a `/panel/` path to avoid confusion), serve `/assets/*` for hashed bundles, and fall through to the existing `buildAdminHtml()` for any non-matched path as a safe fallback.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vite` | 8.0.0 | Build tool and dev server | Official shadcn/ui Vite integration; fastest HMR |
| `@vitejs/plugin-react` | 6.0.1 | React JSX transform + Fast Refresh | Official Vite React plugin |
| `react` | 19.2.4 | UI framework | Industry standard |
| `react-dom` | 19.2.4 | DOM renderer | Pairs with react |
| `tailwindcss` | 4.2.1 | Utility CSS | Required by shadcn/ui |
| `typescript` | 5.9.3 | Type checking | Already in devDependencies |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-table` | 8.21.3 | Headless data table primitives | Directory tab paginated table (Phase 20+) |
| `sonner` | 2.0.7 | Toast notifications | User feedback for API operations |
| `lucide-react` | 0.577.0 | Icons | Tree-shakeable SVG icons |
| `class-variance-authority` | 0.7.1 | Component variant helpers | Used by all shadcn/ui components |
| `clsx` | 2.1.1 | Conditional class names | Used in `lib/utils.ts` |
| `tailwind-merge` | 3.5.0 | Merge Tailwind classes without conflicts | Used in `lib/utils.ts` |
| `@types/react` | 19.2.14 | TypeScript types | devDependency |
| `@types/react-dom` | 19.2.3 | TypeScript types | devDependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@vitejs/plugin-react` | `@vitejs/plugin-react-swc` | SWC is faster but same result; react plugin is more battle-tested |
| Tailwind v4 | Tailwind v3 | v4 is current; shadcn/ui supports both; v4 no longer needs PostCSS config |
| `vite.admin.config.ts` (separate) | `vite.config.ts` (single) | Separate keeps admin build isolated from any future TS-only build config |

**Installation (run from repo root):**
```bash
# Dev dependencies for admin build pipeline
npm install -D vite @vitejs/plugin-react tailwindcss @types/react @types/react-dom

# Runtime dependencies bundled into the React app (NOT server-side)
npm install react react-dom @tanstack/react-table sonner lucide-react class-variance-authority clsx tailwind-merge
```

Note: shadcn/ui components are copy-pasted into the repo (not npm-installed). The CLI is used only during setup:
```bash
# One-time scaffold (run from src/admin/ or use -t vite with --cwd flag)
npx shadcn@latest init
```

**Version verification (performed 2026-03-18):** All versions above were checked via `npm view [package] version` against the live registry. Vite 8.0.0 is the current major (released ~2025), React 19.2.4 is current stable.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
  admin/                        # Standalone Vite app (owns its own tsconfig)
    index.html                  # Vite entry point (must be in root of app)
    tsconfig.json               # Scoped to src/admin/ only
    src/                        # React source (nested under admin/)
      main.tsx                  # ReactDOM.createRoot entry
      App.tsx                   # Root component, tab routing
      components/
        ui/                     # shadcn/ui copy-pasted components
      hooks/                    # Custom React hooks
      lib/
        utils.ts                # cn() helper (clsx + tailwind-merge)
        api.ts                  # Typed fetch wrapper for /api/admin/*
      types.ts                  # Shared TypeScript types

vite.admin.config.ts            # Vite config at repo root (separate from any future vite.config.ts)
dist/
  admin/                        # Vite build output (included in npm package)
    index.html
    assets/
      index-[hash].js
      index-[hash].css
```

**Important:** Vite requires `index.html` to be at the `root` directory. If `root: 'src/admin'` then `index.html` goes directly in `src/admin/index.html` (not `src/admin/src/index.html`). The React source files sit one level deeper in `src/admin/src/`.

### Pattern 1: Vite Config with Isolated Root
**What:** Vite configured with `root: 'src/admin'` so the app's own index.html is the entry point, and output goes to `../../dist/admin` relative to that root.
**When to use:** When the Vite app lives inside a larger project that has its own build toolchain.
**Example:**
```typescript
// vite.admin.config.ts (at repo root)
// Source: ui-framework-research.md (verified pattern)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/admin',
  build: {
    outDir: '../../dist/admin',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/admin/src'),
    },
  },
})
```

### Pattern 2: Static File Serving in Plain Node HTTP Server
**What:** Serve Vite's output (index.html + hashed JS/CSS assets) from `monitor.ts` without Express or any middleware library. Uses Node's `fs.readFileSync` or `fs.promises.readFile` with correct MIME types.
**When to use:** Any static file request for the admin panel.
**Example:**
```typescript
// In monitor.ts — in the request handler, BEFORE existing API routes
// Source: Node.js docs (standard pattern)
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ADMIN_DIST = join(__dirname, '../dist/admin');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.woff2': 'font/woff2',
};

// Admin panel — serve React app (Phase 18)
// NOTE: Keep old buildAdminHtml() path until Phase 24 removes it.
if (req.url === '/admin' || req.url === '/admin/') {
  const indexPath = join(ADMIN_DIST, 'index.html');
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  // Fallback to old HTML if dist/admin not built yet
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(buildAdminHtml(opts.config, account));
  return;
}

// Serve hashed assets (JS, CSS, fonts, images)
if (req.url?.startsWith('/assets/')) {
  const filePath = join(ADMIN_DIST, req.url.split('?')[0]);
  if (existsSync(filePath)) {
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(content);
    return;
  }
}
```

**Critical detail:** Vite hashed asset filenames (e.g., `index-Cx3A9Bk1.js`) are served under `/assets/`. The `Cache-Control: immutable` header is correct for hashed assets. The `existsSync` guard is the coexistence safety net — if `dist/admin/` doesn't exist (e.g., fresh clone before first build), the old panel still works.

### Pattern 3: `__dirname` in ESM Context
**What:** `monitor.ts` uses `"type": "module"` in package.json, so `__dirname` is not available. Use `import.meta.url` or `path.dirname(fileURLToPath(import.meta.url))`.
**When to use:** Any path resolution in monitor.ts.
**Example:**
```typescript
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ADMIN_DIST = join(__dirname, '../dist/admin');
```

**However:** Check how monitor.ts currently resolves `__dirname` for `getConfigPath()` — it uses `homedir()` which doesn't need it. The `join(__dirname, ...)` pattern will need the `fileURLToPath` shim if OpenClaw's runtime doesn't inject `__dirname`. Verify existing usage in monitor.ts before assuming.

### Pattern 4: API Client Utility
**What:** A typed fetch wrapper that all React components use to call `/api/admin/*`. Centralizes base URL, error handling, and response types.
**Example:**
```typescript
// src/admin/src/lib/api.ts
const BASE = '/api/admin';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getStats: () => request<StatsResponse>('/stats'),
  getConfig: () => request<ConfigResponse>('/config'),
  updateConfig: (body: unknown) => request<void>('/config', { method: 'POST', body: JSON.stringify(body) }),
  restart: () => request<void>('/restart', { method: 'POST' }),
  getSessions: () => request<SessionsResponse>('/sessions'),
  getDirectory: (params?: DirectoryParams) => request<DirectoryResponse>(`/directory?${new URLSearchParams(params as Record<string, string>)}`),
  // ... etc
};
```

### Pattern 5: shadcn/ui `lib/utils.ts`
**What:** Required by all shadcn/ui components. Must exist before adding any component.
```typescript
// src/admin/src/lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Anti-Patterns to Avoid
- **Putting index.html inside src/**: Vite requires `index.html` at the `root` directory, not in a subdirectory. If `root: 'src/admin'`, then `index.html` must be at `src/admin/index.html`.
- **Using `__dirname` directly in ESM**: Always use `fileURLToPath(import.meta.url)` shim or check if OpenClaw's runtime provides `__dirname` as a global.
- **Adding `dist/` to `.gitignore` without exception**: `dist/admin/` must be committed to git and published to npm. If a top-level `.gitignore` entry excludes `dist/`, add `!dist/admin/` exception.
- **Not adding `dist/admin/` to `files` in package.json**: npm publish uses the `files` allowlist. If `dist/` isn't listed, consumers get the TypeScript source but no pre-built admin assets.
- **Synchronous `readFileSync` for every asset request**: For the index.html (one HTML file, ~1KB) this is fine. For assets with `Cache-Control: immutable`, consider caching the buffer in memory at server start to avoid repeated disk reads.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSS class merging | Custom merge logic | `clsx` + `tailwind-merge` | Tailwind generates many overlapping utilities; naive concatenation produces incorrect results |
| Component variants (primary/secondary/ghost) | Conditional strings | `class-variance-authority` | CVA handles variant × compound-variant combinatorics safely |
| UI primitives (dialog focus trap, menu keyboard nav) | Custom focus management | Radix UI (via shadcn/ui components) | Focus trap, portal rendering, ARIA attributes are notoriously tricky |
| Toast system | Custom state + CSS | `sonner` | Queue, dismiss, promise toasts, positioning — complex state machine |
| Data table sorting/pagination | Manual array manipulation | `@tanstack/react-table` | Handles sort, filter, pagination, virtualization generically |
| Path resolution in ESM | Hardcoded paths | `fileURLToPath(import.meta.url)` | `__dirname` doesn't exist in ESM; the shim is 2 lines |

**Key insight:** For this scaffold phase specifically — do not hand-roll the `cn()` utility, do not write custom Tailwind class logic, and do not manually build the shadcn/ui components from scratch. Use `npx shadcn@latest add` to copy components into the repo.

---

## Common Pitfalls

### Pitfall 1: `dist/admin/` Not Included in npm Package
**What goes wrong:** `npm publish` omits `dist/admin/` because `package.json` `files` only lists `src/` and `index.ts`. Consumers install the package and get no admin assets. The admin panel 404s.
**Why it happens:** `files` field is an allowlist. Only listed paths are included.
**How to avoid:** Add `"dist/admin/"` to the `files` array in `package.json`. Verify with `npm pack --dry-run` before publishing.
**Warning signs:** After `npm pack`, check the tarball contents — `dist/admin/index.html` must appear.

### Pitfall 2: Vite `root` vs `base` Confusion
**What goes wrong:** Setting `base: '/admin/'` in Vite config causes all asset URLs to be prefixed with `/admin/` (e.g., `/admin/assets/index-hash.js`). But monitor.ts serves assets at `/assets/`. The app loads but CSS/JS 404.
**Why it happens:** Vite's `base` option is the public URL base path — it affects how `<script>` and `<link>` tags are emitted in `index.html`.
**How to avoid:** Keep `base: '/'` (default) unless you plan to serve the app at a subpath with consistent URL prefixes. With `base: '/'`, assets are referenced as `/assets/...` which matches the `req.url.startsWith('/assets/')` handler.
**Warning signs:** Open browser dev tools Network tab after loading `/admin` — any 404 for `.js` or `.css` files indicates a base path mismatch.

### Pitfall 3: `__dirname` Missing in ESM
**What goes wrong:** `monitor.ts` uses `join(__dirname, '../dist/admin')` to locate the admin build output. At runtime, `__dirname` is `undefined` in ESM context → `TypeError: Cannot read properties of undefined`.
**Why it happens:** `"type": "module"` in package.json makes all `.js` files ESM. `__dirname` is a CommonJS-only global.
**How to avoid:** Use `fileURLToPath(import.meta.url)` to reconstruct `__dirname`. Check if OpenClaw's runtime already provides `__dirname` as a compatibility shim (some runtimes do). If the existing `monitor.ts` already has code using `__dirname` without the shim and it works, the runtime provides it.
**Warning signs:** Check `monitor.ts` for any existing `__dirname` usage before assuming. If there is none, the shim is required.

### Pitfall 4: Vite's `outDir` Is Relative to `root`
**What goes wrong:** With `root: 'src/admin'` and `build.outDir: 'dist/admin'`, Vite writes to `src/admin/dist/admin/` instead of `dist/admin/` at the repo root.
**Why it happens:** `outDir` is resolved relative to `root` unless it's an absolute path or uses `../` navigation.
**How to avoid:** Use `outDir: '../../dist/admin'` (relative, two levels up from `src/admin`) or use `path.resolve(__dirname, 'dist/admin')` with an absolute path. The research spec uses `'../../dist/admin'` which is correct.
**Warning signs:** After first build, check where `index.html` appeared — if it's inside `src/admin/`, the outDir is wrong.

### Pitfall 5: TypeScript Config Conflicts
**What goes wrong:** `src/admin/tsconfig.json` uses `"jsx": "react-jsx"` but the plugin's source files have no tsconfig at all (OpenClaw compiles TypeScript directly). Vite picks up the wrong tsconfig or the type checker complains about conflicting settings.
**Why it happens:** Vite uses the nearest `tsconfig.json` relative to the source file being compiled.
**How to avoid:** Place `tsconfig.json` inside `src/admin/` (scoped to the React app only) and never add a root-level `tsconfig.json` unless the plugin compilation also needs one. The Vite config's `root: 'src/admin'` ensures Vite uses `src/admin/tsconfig.json`.
**Warning signs:** TypeScript errors in `.ts` plugin files that were not present before adding `tsconfig.json`.

### Pitfall 6: `/assets/` Route Conflict
**What goes wrong:** WAHA sends webhooks to the server. If a future API route or webhook path starts with `/assets/`, it will be intercepted by the static file handler.
**Why it happens:** The static file handler uses `req.url.startsWith('/assets/')`.
**How to avoid:** This is not a real risk — WAHA webhook URLs are `/webhook/waha` and admin APIs are `/api/admin/*`. The `/assets/` namespace is safe. Document this assumption with a comment in the code.

---

## Code Examples

Verified patterns from official sources and this codebase:

### Vite Admin Config
```typescript
// vite.admin.config.ts (repo root)
// Source: ui-framework-research.md + Vite docs
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/admin',
  build: {
    outDir: '../../dist/admin',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/admin/src'),
    },
  },
  // base: '/' is the default — assets served at /assets/
})
```

### package.json Scripts Update
```json
{
  "scripts": {
    "test": "vitest run --reporter=verbose",
    "build:admin": "vite build --config vite.admin.config.ts",
    "dev:admin": "vite --config vite.admin.config.ts",
    "build": "npm run build:admin"
  },
  "files": [
    "index.ts",
    "src/",
    "!src/**/*.bak*",
    "dist/admin/",
    "docs/",
    "!docs/extra phase/",
    "SKILL.md",
    "config-example.json",
    "README.md",
    "CHANGELOG.md",
    "openclaw.plugin.json",
    "rules/"
  ]
}
```

Note: There is no `tsc` compile step in the current build because the OpenClaw runtime consumes TypeScript directly via `index.ts`. The `build` script only needs `build:admin` for now.

### src/admin/tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

### src/admin/index.html (Vite entry)
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WAHA Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### src/admin/src/main.tsx (React entry)
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

### src/admin/src/index.css (Tailwind directives)
```css
@import "tailwindcss";
```
Note: Tailwind v4 uses `@import "tailwindcss"` instead of the v3 `@tailwind base/components/utilities` directives. No `postcss.config.js` needed in v4 — Tailwind v4 ships its own Vite plugin.

**However:** shadcn/ui's current init may generate v3-style config. Verify what `npx shadcn@latest init` generates for Vite in March 2026 — if it generates v3 PostCSS config, use that. Do not mix v3 directives with v4 `@import` syntax.

### Static File Serving in monitor.ts
```typescript
// Add near top of monitor.ts file (with other imports)
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Near top of createWahaWebhookServer() or as module-level const
// (check if __dirname is available from OpenClaw runtime first)
const __filename = fileURLToPath(import.meta.url);
const __dirname_esm = dirname(__filename);
const ADMIN_DIST = join(__dirname_esm, '../dist/admin');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// Inside the request handler — BEFORE the existing /admin route
if (req.url === '/admin' || req.url === '/admin/') {
  const indexPath = join(ADMIN_DIST, 'index.html');
  if (existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(indexPath));
    return;
  }
  // Fallback: old embedded HTML (preserved until Phase 24)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(buildAdminHtml(opts.config, account));
  return;
}

if (req.url?.startsWith('/assets/')) {
  const safePath = req.url.split('?')[0].replace(/\.\./g, '');
  const filePath = join(ADMIN_DIST, safePath);
  if (existsSync(filePath)) {
    const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
    const buf = readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(buf);
    return;
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PostCSS required for Tailwind | Tailwind v4 ships its own Vite plugin, no PostCSS config needed | Tailwind v4 (2025) | Simpler setup — one fewer config file |
| `@tailwind base/components/utilities` directives | `@import "tailwindcss"` single directive | Tailwind v4 | Different syntax — don't mix |
| `npx create-vite` then manual shadcn setup | `pnpm dlx shadcn@latest init -t vite` bootstraps everything | Early 2025 | One command sets up Tailwind + paths alias + components.json |
| React 18 `ReactDOM.render()` | React 19 `createRoot()` | React 19 | `createRoot` is the API since React 18; React 19 deprecates legacy render entirely |
| Webpack/CRA | Vite 8 | 2024-2025 | Vite is the de-facto standard for new React projects |

**Deprecated/outdated:**
- `create-react-app`: Dead — do not use. Use `npm create vite@latest` instead.
- `tailwind.config.js` + `postcss.config.js`: Still works with Tailwind v3. Tailwind v4 makes them optional. Verify which version shadcn/ui's init generates.
- `"jsx": "react"` in tsconfig: Use `"jsx": "react-jsx"` (the automatic JSX transform; no need to `import React` in every file).

---

## Open Questions

1. **Does monitor.ts use `__dirname` today or does OpenClaw inject it?**
   - What we know: `monitor.ts` uses `homedir()` from `node:os` for config paths. No existing `__dirname` usage found in scanned lines.
   - What's unclear: Whether OpenClaw's TypeScript runtime (which loads `index.ts` directly) provides `__dirname` as a CJS compatibility global in an ESM context.
   - Recommendation: Add `fileURLToPath(import.meta.url)` shim. It costs 2 lines and is always correct. If OpenClaw does inject `__dirname`, using the shim under a different variable name (`__dirname_esm`) is safe.

2. **shadcn/ui init output: Tailwind v3 or v4 format?**
   - What we know: As of March 2026, shadcn/ui has been updating to support Tailwind v4. The `npx shadcn@latest init` for Vite may generate v3-style PostCSS config or v4-style direct import.
   - What's unclear: Exact output of the init command in current March 2026 version.
   - Recommendation: Run the init, observe what it generates, and document it in the plan summary. Do not pre-assume the format.

3. **Should `/admin` serve the React app or should a new `/panel` route be introduced?**
   - What we know: The existing embedded panel is at `/admin`. The coexistence requirement says both must work until Phase 24.
   - What's unclear: Whether serving the React app at `/admin` (with `existsSync` fallback) is sufficient coexistence, or whether the user expects the old panel to remain accessible separately.
   - Recommendation: Use `existsSync` fallback at `/admin` — serves React app when `dist/admin/` exists, falls back to old HTML when it doesn't. This is seamless and requires no URL changes. Document as "React app takes over `/admin` after first build; old HTML only visible in development before build step."

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` (exists at repo root) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCAF-01 | `src/admin/` directory with valid `index.html`, `tsconfig.json`, `src/main.tsx`, `src/App.tsx` | smoke/manual | `ls src/admin/index.html src/admin/src/main.tsx` | Wave 0 |
| SCAF-02 | `npm run build:admin` exits 0 and produces `dist/admin/index.html` | smoke/manual | `npm run build:admin && ls dist/admin/index.html` | Wave 0 |
| SCAF-03 | GET `/admin` returns 200 with `text/html` when `dist/admin/` exists | manual | Start server, `curl -i http://localhost:8050/admin` | Wave 0 |
| SCAF-04 | `package.json` has `build:admin` script and `dist/admin/` in `files` | manual | `node -e "const p=require('./package.json'); console.log(p.scripts['build:admin'], p.files)"` | Wave 0 |
| SCAF-05 | `src/admin/src/lib/api.ts` exports `api` object with typed methods | smoke | `npm run build:admin` (TypeScript errors would fail build) | Wave 0 |

Note: SCAF requirements are infrastructure/build-system tasks. The primary validation is manual: run `npm run build:admin`, start the server, visit `/admin` in browser, confirm React app loads with blank white page (no errors in console). Automated tests are not practical for "Vite builds successfully" — the build itself is the test.

### Sampling Rate
- **Per task commit:** `npm run build:admin` (verifies no TypeScript or Vite errors)
- **Per wave merge:** `npm run build:admin && npm test`
- **Phase gate:** Manual browser verification at `/admin` before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/admin/index.html` — Vite entry point (SCAF-01)
- [ ] `src/admin/tsconfig.json` — TypeScript config scoped to admin (SCAF-01)
- [ ] `src/admin/src/main.tsx` — React entry point (SCAF-01)
- [ ] `src/admin/src/App.tsx` — Root component placeholder (SCAF-01)
- [ ] `src/admin/src/index.css` — Tailwind CSS entry (SCAF-01)
- [ ] `src/admin/src/lib/utils.ts` — `cn()` helper (SCAF-01, required by shadcn/ui)
- [ ] `src/admin/src/lib/api.ts` — API client (SCAF-05)
- [ ] `vite.admin.config.ts` — Vite config at repo root (SCAF-02)
- [ ] `dist/admin/` directory — created by first build (SCAF-02, SCAF-03)

---

## Sources

### Primary (HIGH confidence)
- `.planning/research/ui-framework-research.md` — Full architecture spec, Vite config pattern, component mapping, migration strategy. Authored 2026-03-18.
- `npm view [package] version` (live registry, 2026-03-18) — All package versions verified.
- `src/monitor.ts` line 4342-4347 — Exact integration point for `/admin` route; `buildAdminHtml()` call pattern.
- `package.json` — Current `files` field, `devDependencies`, `scripts` structure.

### Secondary (MEDIUM confidence)
- [shadcn/ui Vite Installation](https://ui.shadcn.com/docs/installation/vite) — init command for Vite projects
- [Vite Configuration Reference](https://vitejs.dev/config/) — `root`, `build.outDir`, `base` options
- [Tailwind v4 for Vite](https://tailwindcss.com/docs/installation/using-vite) — `@import "tailwindcss"` syntax, no PostCSS needed

### Tertiary (LOW confidence)
- Tailwind v4 vs v3 init output from shadcn/ui — not directly verified; needs runtime check during implementation.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified live against npm registry 2026-03-18
- Architecture: HIGH — patterns from existing research doc + direct monitor.ts code inspection
- Pitfalls: HIGH — derived from direct code analysis (ESM `__dirname`, `outDir` relative paths, `files` field)
- Integration point: HIGH — exact line numbers inspected in monitor.ts

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable ecosystem; Tailwind v4/shadcn/ui init output may shift sooner)
