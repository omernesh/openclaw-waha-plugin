---
phase: 60-rest-api-cli
plan: "03"
subsystem: cli
tags: [cli, commander, chalk, table, env-vars]
dependency_graph:
  requires: [60-01]
  provides: [npx-chatlytics-cli, bin-wrapper]
  affects: [package.json, src/cli.ts, bin/chatlytics.mjs]
tech_stack:
  added: [commander@14.0.3, chalk@5.6.2, cli-table3@0.6.5, "@stoplight/spectral-cli@6.15.0"]
  patterns: [commander-subcommands, tdd-red-green, exported-helpers-for-testing]
key_files:
  created:
    - src/cli.ts
    - bin/chatlytics.mjs
    - tests/cli.test.ts
  modified:
    - package.json
    - package-lock.json
key_decisions:
  - "Export makeApiCall and formatOutput from cli.ts for unit testing without spawning subprocesses"
  - "Guard program.parseAsync behind process.argv[1] check to prevent auto-execution during vitest"
  - "bin/chatlytics.mjs uses dynamic import() to load src/cli.ts — jiti handles TS at runtime"
  - "Pre-existing health.test.ts failures are flaky timing tests unrelated to this plan"
metrics:
  duration: "17m 49s"
  completed: "2026-03-28"
  tasks_completed: 2
  files_changed: 5
---

# Phase 60 Plan 03: CLI Tool Summary

One-liner: `npx chatlytics` CLI with send/search/status/messages/directory/mimicry subcommands, env var config, chalk+table output, and --json mode.

## What Was Built

- `src/cli.ts` — Commander-based CLI with 6 subcommands consuming the REST API from Plan 01
- `bin/chatlytics.mjs` — ESM bin wrapper that dynamic-imports cli.ts; works with jiti at runtime
- `tests/cli.test.ts` — 23 unit tests covering all CLI-01..04 requirements
- `package.json` — added `bin` field, `lint:api` script, and new dependencies

## Subcommands

| Command | Route | Description |
|---------|-------|-------------|
| `send <message> --to <target>` | POST /api/v1/send | Send WhatsApp message |
| `search <query>` | GET /api/v1/search?q= | Search contacts/groups |
| `status` | GET /api/v1/sessions | Session health table |
| `messages --chat --session` | GET /api/v1/messages | Recent chat messages |
| `directory` | GET /api/v1/directory | Browse directory |
| `mimicry` | GET /api/v1/mimicry | Cap + gate status |

## Auth & URL Config

- `--api-key <key>` or `CHATLYTICS_API_KEY` env var → `Authorization: Bearer` header
- `--url <url>` or `CHATLYTICS_URL` env var → base URL (default `http://localhost:8050`)
- `--json` flag → raw JSON output for scripting

## TDD Flow

RED: wrote 23 failing tests in `tests/cli.test.ts` (cli.ts didn't exist)
GREEN: implemented `src/cli.ts` — all 23 tests pass
No refactor phase needed.

## Verification Results

- `node bin/chatlytics.mjs --help` — exits 0, lists all 6 subcommands
- `npm test -- tests/cli.test.ts` — 23/23 passed
- Full suite: 704 tests passed, 2 pre-existing flaky failures in health.test.ts (timing-sensitive, unrelated to this plan)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written with one minor adaptation:

**1. [Rule 2 - Missing critical functionality] Export helpers for testable unit tests**
- **Found during:** Task 1
- **Issue:** Plan specified subcommands via action handlers with closure-captured opts. Direct module import tests need exported helpers to mock fetch without spawning subprocesses.
- **Fix:** Exported `makeApiCall` and `formatOutput` from cli.ts; added `process.argv[1]` guard so `program.parseAsync` only fires when run directly (not when imported by vitest)
- **Files modified:** src/cli.ts

**2. [Rule 1 - Deviation note] bin/chatlytics.mjs placed in bin/ not src/**
- Plan mentioned `bin/chatlytics.mjs` as the wrapper (matching the research). Created `bin/` directory as expected.

## Known Stubs

None — all subcommands make real HTTP calls to the REST API. No hardcoded data.

## Self-Check: PASSED

- [x] `src/cli.ts` exists and passes all acceptance criteria
- [x] `bin/chatlytics.mjs` exists
- [x] `tests/cli.test.ts` exists
- [x] Commit `617e40d` — feat(60-03): CLI entry point with all subcommands
- [x] Commit `32e39ab` — feat(60-03): npm bin wrapper and package.json wiring
