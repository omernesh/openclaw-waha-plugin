---
phase: 62-mcp-server
plan: "01"
subsystem: mcp-server
tags: [mcp, sdk, tools, resources, mimicry]
dependency_graph:
  requires: [proxy-send-handler, accounts, health, mimicry-gate, directory, config-io, http-client, send]
  provides: [createMcpServer, buildRecoveryHint]
  affects: []
tech_stack:
  added: ["@modelcontextprotocol/sdk@^1.28.0"]
  patterns: [McpServer, ResourceTemplate, isError-content-blocks, recovery-hints]
key_files:
  created:
    - src/mcp-server.ts
  modified:
    - package.json
    - package-lock.json
decisions:
  - "McpServer instance created fresh per createMcpServer(cfg) call — transport connected externally by Plan 02"
  - "buildRecoveryHint uses regex pattern matching on error strings to produce gate-closed vs cap-exceeded hints"
  - "update_settings restricted to paths under channels.waha — prevents unintended config corruption"
  - "sanitizeCfg redacts all keys matching api.?key|secret|password|token before exposing via chatlytics://config resource"
  - "getFirstAccountDb uses first enabled account — single-account assumption consistent with existing proxy-send-handler pattern"
metrics:
  duration: "12 minutes"
  completed: "2026-03-28"
  tasks: 1
  files: 3
---

# Phase 62 Plan 01: MCP Server Factory Summary

MCP server factory (`createMcpServer`) with 10 tools and 5 resources using `@modelcontextprotocol/sdk@1.28.0`, all delegating to existing business logic with isError-true recovery hints for mimicry blocks.

## What Was Built

### src/mcp-server.ts

`createMcpServer(cfg: CoreConfig): McpServer` — factory function that registers:

**10 Tools (MCP-01):**
| Tool | Delegates To |
|------|-------------|
| `send_message` | `handleProxySend` (type: text) |
| `send_media` | `handleProxySend` (type: image/video/file/voice) |
| `read_messages` | `getWahaChatMessages` |
| `search` | `DirectoryDb.getContacts({ search })` |
| `get_directory` | `DirectoryDb.getContacts({ type, limit, offset })` |
| `manage_group` | `callWahaApi` with per-action WAHA endpoints |
| `get_status` | `getHealthState` + `getCapStatus` |
| `update_settings` | `modifyConfig` (paths under channels.waha only) |
| `send_poll` | `handleProxySend` with poll payload |
| `send_reaction` | `callWahaApi` PUT /api/sendReaction |

**5 Resources (MCP-04):**
| URI | Data Source |
|-----|-------------|
| `chatlytics://sessions` | `listEnabledWahaAccounts` + `getHealthState` |
| `chatlytics://contacts/{jid}` | `DirectoryDb.getContact` (ResourceTemplate) |
| `chatlytics://groups/{jid}` | `DirectoryDb.getContact` (ResourceTemplate) |
| `chatlytics://config` | `readConfig` (sanitized, API keys redacted) |
| `chatlytics://mimicry` | `getCapStatus` (read-only, never checkAndConsumeCap) |

**Error handling (MCP-05):**
- Every tool callback wrapped in try/catch
- `result.body.blocked === true` → `isError: true` + `buildRecoveryHint()` message
- `result.status >= 400` → `isError: true` + error string
- Caught exceptions → `isError: true` + exception message, never throw

### package.json

Added `@modelcontextprotocol/sdk@^1.28.0` to dependencies.

## Acceptance Criteria Verified

- `grep -c "registerTool" src/mcp-server.ts` → **10** ✓
- `grep -c "registerResource" src/mcp-server.ts` → **5** ✓
- `grep "isError.*true" src/mcp-server.ts` → **19 matches** ✓
- `grep "buildRecoveryHint" src/mcp-server.ts` → **4 matches** (1 definition + 3 usages) ✓
- `grep "@modelcontextprotocol/sdk" package.json` → **match** ✓
- `npm test` → **1432 tests passing**, 5 pre-existing worktree failures unrelated to this plan ✓

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all 10 tools delegate to real business logic. Resources read from live data sources.

## Self-Check: PASSED

- `src/mcp-server.ts` exists: FOUND
- commit `ddf9245` exists: FOUND
- `@modelcontextprotocol/sdk` in package.json: FOUND
