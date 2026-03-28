---
phase: 62-mcp-server
plan: "02"
subsystem: mcp-transports
tags: [mcp, http, stdio, transport, monitor]
dependency_graph:
  requires: ["62-01"]
  provides: ["/mcp HTTP route", "chatlytics-mcp CLI bin", "StreamableHTTP transport", "stdio transport"]
  affects: ["src/monitor.ts", "src/mcp-stdio.ts", "package.json"]
tech_stack:
  added: ["StreamableHTTPServerTransport", "StdioServerTransport", "esbuild bundling"]
  patterns: ["stateless MCP HTTP", "stdio stdout-silent pattern", "cross-platform esbuild via node -e"]
key_files:
  created:
    - src/mcp-stdio.ts
  modified:
    - src/monitor.ts
    - package.json
decisions:
  - "Stateless StreamableHTTPServerTransport (sessionIdGenerator: undefined) — no in-memory session map needed for HTTP MCP"
  - "LOG_LEVEL=silent set before all imports in mcp-stdio.ts to prevent stdout contamination"
  - "build:mcp uses node -e wrapper around esbuild to handle Windows cross-platform banner arg quoting"
  - "dist/mcp-stdio.mjs gitignored (built artifact), added to package.json files array for npm publish"
  - "Bearer auth for /mcp reuses requirePublicApiAuth from api-v1-auth.ts — same token as /api/v1/"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-28"
  tasks_completed: 2
  files_modified: 3
---

# Phase 62 Plan 02: MCP Transport Wiring Summary

**One-liner:** StreamableHTTP /mcp route in monitor.ts with Bearer auth + stdio entry point bundled via esbuild for npx chatlytics-mcp.

## What Was Built

### Task 1 — /mcp route in monitor.ts

Added `StreamableHTTPServerTransport` import from `@modelcontextprotocol/sdk/server/streamableHttp.js` and `createMcpServer` import from `./mcp-server.js` to monitor.ts.

Inserted `/mcp` route block between the CORS preflight handler and the existing `/api/v1/` block. Route:
- Calls `setCorsHeaders()` for CORS support
- Guards with `requirePublicApiAuth()` — returns 401 without valid Bearer token
- Creates a fresh `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` (stateless)
- Creates a fresh `McpServer` via `createMcpServer(opts.config)`
- Connects server to transport then delegates to `transport.handleRequest(req, res)`
- Error-safe: catches transport errors, sends JSON 500 if headers not yet sent

### Task 2 — src/mcp-stdio.ts + package.json bin entry

Created `src/mcp-stdio.ts`:
- Sets `process.env.LOG_LEVEL = "silent"` as the very first line (before any imports) to prevent logger contamination on stdout
- Uses `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- Reads config from `CHATLYTICS_CONFIG_PATH` env var or `~/.chatlytics/config.json` fallback
- Calls `createMcpServer(cfg)` then connects to `StdioServerTransport`
- Fatal errors written to stderr (not stdout) via `process.stderr.write`

Updated `package.json`:
- Added `"bin": { "chatlytics-mcp": "./dist/mcp-stdio.mjs" }` entry
- Added `"build:mcp"` script using `node -e` wrapper around esbuild (cross-platform workaround for Windows banner quoting)
- Added `"dist/mcp-stdio.mjs"` to `files` array for npm publish inclusion
- Bundle builds to 408.2kb in stateless ESM format with `#!/usr/bin/env node` shebang

## Verification Results

```
grep 'startsWith.*"/mcp"' src/monitor.ts       → line 613: match
grep "StreamableHTTPServerTransport" src/monitor.ts → lines 50, 617: match
grep "createMcpServer" src/monitor.ts           → lines 51, 618: match
grep "chatlytics-mcp" package.json             → line 8: bin entry match
grep "StdioServerTransport" src/mcp-stdio.ts    → lines 9, 19: match
grep "LOG_LEVEL.*silent" src/mcp-stdio.ts       → line 7: match
npm test: 1432 passed (5 pre-existing worktree failures unrelated to this plan)
npm run build:mcp: dist/mcp-stdio.mjs 408.2kb, head -1 shows #!/usr/bin/env node
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Windows shell banner quoting for esbuild**
- **Found during:** Task 2 (npm run build:mcp)
- **Issue:** `--banner:js='#!/usr/bin/env node'` caused esbuild to see multiple input files on Windows (shell glob expansion of `=` sign)
- **Fix:** Replaced shell script with `node -e "..."` wrapper that passes args as array to execFileSync — works cross-platform
- **Files modified:** package.json (build:mcp script)
- **Commit:** 4e76411

**2. [Rule 1 - Observation] dist/ is gitignored**
- **Found during:** Task 2 commit
- **Issue:** `dist/` is in .gitignore — dist/mcp-stdio.mjs cannot be committed
- **Fix:** Committed only src/mcp-stdio.ts and package.json; dist/mcp-stdio.mjs is included in `package.json files` array for npm publish (correct behavior)
- **Note:** This is correct — built artifacts are not committed to git

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | 9adfd98 | feat(62-02): wire /mcp route with StreamableHTTPServerTransport in monitor.ts |
| 2 | 4e76411 | feat(62-02): add stdio MCP entry point and chatlytics-mcp bin entry |

## Known Stubs

None — both transports are fully wired. The /mcp route creates a live McpServer with all 10 tools from Plan 01. The stdio entry point reads real config and connects a real StdioServerTransport.
