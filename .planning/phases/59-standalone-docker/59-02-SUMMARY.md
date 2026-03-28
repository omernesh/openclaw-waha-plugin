---
phase: 59-standalone-docker
plan: "02"
subsystem: docker
tags: [docker, dockerfile, docker-compose, sqlite, persistence, healthcheck]
dependency_graph:
  requires: [59-01]
  provides: [docker-packaging]
  affects: [dist/admin, src/standalone.ts, data-dir.ts]
tech_stack:
  added: [Docker multi-stage build, docker-compose]
  patterns: [multi-stage Dockerfile, named volume, liveness probe]
key_files:
  created:
    - Dockerfile
    - docker-compose.yml
    - .dockerignore
  modified: []
decisions:
  - "node:22-slim over alpine: better-sqlite3 native bindings require glibc"
  - "HEALTHCHECK probes /healthz (liveness, always public) not /health (JSON, may gain auth later)"
  - "curl installed in runtime stage for HEALTHCHECK CMD availability"
  - "npm ci --omit=dev + npm install tsx: lean image with only the tsx runner added back"
  - "chatlytics-data named volume (not bind mount): Docker manages lifecycle, survives container recreation"
  - "Config bind-mounted read-only (./config.json:/config/config.json:ro): immutable runtime config"
metrics:
  duration: "~2 minutes"
  completed: "2026-03-28"
  tasks_completed: 1
  tasks_total: 2
  files_created: 3
  files_modified: 0
---

# Phase 59 Plan 02: Docker Packaging Summary

**One-liner:** Multi-stage Dockerfile (Vite admin build + node:22-slim runtime with tsx) and docker-compose.yml with chatlytics-data named volume for SQLite persistence.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create Dockerfile, docker-compose.yml, .dockerignore | ddb3e96 | Dockerfile, docker-compose.yml, .dockerignore |

## Task 2: PENDING USER VERIFICATION

**Status:** Awaiting human verification — checkpoint not yet approved.

### What Was Built

Three Docker files packaging Chatlytics as a distributable container:

**Dockerfile** (multi-stage):
- Stage 1 (builder): `node:22-slim`, `npm ci`, `npm run build:admin` → produces `dist/admin/`
- Stage 2 (runtime): `node:22-slim`, `curl` (for HEALTHCHECK), prod deps + `tsx`, `CHATLYTICS_DATA_DIR=/data`, `USER node`, `EXPOSE 8050`
- `HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=30s CMD curl -f http://localhost:8050/healthz || exit 1`
- `CMD ["npx", "tsx", "src/standalone.ts"]`

**docker-compose.yml**:
- `chatlytics-data` named volume → `/data` (SQLite persistence)
- `./config.json:/config/config.json:ro` bind mount
- `CHATLYTICS_PORT` env var for host port override (default 8050)
- `restart: unless-stopped`

**.dockerignore**:
- Excludes: `node_modules/`, `dist/`, `.git/`, `.planning/`, `.claude/`, `*.bak.*`, `*.png`, `*.yaml`
- Exception: `!docker-compose.yml` preserved

### Verification Steps for User

1. **Ensure `config.json` exists** in the project root — copy from `config-example.json` and fill in your WAHA credentials:
   ```bash
   cp config-example.json config.json
   # Edit config.json: set baseUrl, apiKey, session
   ```

2. **Build and start:**
   ```bash
   docker compose up -d
   ```
   Expected: image builds, container starts, becomes healthy within 60s.

3. **Check container health:**
   ```bash
   docker compose ps
   ```
   Expected: Status shows `healthy`.

4. **Verify health endpoint (JSON):**
   ```bash
   curl http://localhost:8050/health
   ```
   Expected: `{"status":"ok","webhook_registered":true}` (or false if WAHA not reachable)

5. **Verify liveness endpoint (plaintext):**
   ```bash
   curl http://localhost:8050/healthz
   ```
   Expected: `ok`

6. **Open admin panel in browser:**
   Navigate to `http://localhost:8050` — admin panel should load with all tabs (Directory, Config, Filter Stats, Status).

7. **Test data persistence across restarts:**
   ```bash
   docker compose down
   docker compose up -d
   # Check Directory tab — data should still be present
   ```

8. **Clean up after verification:**
   ```bash
   docker compose down -v   # removes named volume (wipes data)
   ```

### Resume Signal

After verifying, continue execution by typing `approved` (or describe any issues found).

## Deviations from Plan

**1. [Rule 1 - Bug] HEALTHCHECK uses /healthz instead of /health**
- **Found during:** Task 1
- **Issue:** Plan draft specified `curl -f http://localhost:8050/health` but STATE.md decision notes that `/health` "may require auth in future; /healthz is always public". Also, monitor.ts has `const HEALTH_PATH = "/healthz"` as the explicit liveness constant (returns plain "ok", no JSON parsing needed by curl).
- **Fix:** HEALTHCHECK probes `/healthz` (the liveness constant from monitor.ts line 96).
- **Files modified:** Dockerfile
- **Commit:** ddb3e96

## Known Stubs

None — all three files are complete and production-ready. No placeholder data or hardcoded empty values.

## Self-Check: PENDING

(Will be completed after user verification of Task 2.)
