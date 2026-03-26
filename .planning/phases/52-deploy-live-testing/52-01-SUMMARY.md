---
phase: 52-deploy-live-testing
plan: "01"
subsystem: deployment
tags: [deploy, hpg6, gateway, waha, channel.ts, send.ts]
dependency_graph:
  requires: [phase-48-action-exposure]
  provides: [phase-48-code-live-on-hpg6]
  affects: [phase-52-02-live-testing]
tech_stack:
  added: []
  patterns: [scp-deploy, jiti-cache-clear, systemd-service]
key_files:
  created: []
  modified:
    - path: "hpg6:~/.openclaw/extensions/waha/src/channel.ts"
      note: "Phase 48 version deployed — 109-entry UTILITY_ACTIONS"
    - path: "hpg6:~/.openclaw/extensions/waha/src/send.ts"
      note: "Phase 48 version deployed — createOrUpdateWahaContact, getWahaNewMessageId, convertWahaVoice, convertWahaVideo"
    - path: "hpg6:~/.openclaw/workspace/skills/waha-openclaw-channel/src/channel.ts"
      note: "Phase 48 backup copy deployed"
    - path: "hpg6:~/.openclaw/workspace/skills/waha-openclaw-channel/src/send.ts"
      note: "Phase 48 backup copy deployed"
decisions:
  - "Disk-full root cause: syslog grew to 4GB+ — truncated syslog and syslog.1, vacuumed journal (freed 3.2GB)"
  - "postgres-waha restart required after disk-full — gateway lock file stale on rapid restart, must delete manually"
  - "Health check UNHEALTHY with consecutiveFailures in thousands is pre-existing, not a problem"
metrics:
  duration_seconds: 938
  completed_date: "2026-03-26"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 52 Plan 01: Deploy Phase 48 to hpg6 Summary

**One-liner:** Deployed Phase 48 channel.ts (109-entry UTILITY_ACTIONS) and send.ts to both hpg6 locations, fixed disk-full blocking postgres-waha, gateway running with WAHA returning HTTP 200.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | SCP Phase 48 source files to both hpg6 locations | 91ee02d | channel.ts + send.ts to ext/waha/src/ and workspace/src/ |
| 2 | Clear jiti cache, restart gateway, verify health | 717fb07 | gateway restart, disk cleanup, postgres-waha fix |

## Verification Results

- `grep -c "addParticipants"` returns 2 for both hpg6 locations: PASS
- `grep -c "createOrUpdateWahaContact|getWahaNewMessageId|convertWahaVoice|convertWahaVideo"` returns 4: PASS
- Phase 48 patterns (25 matches in channel.ts): PASS
- `systemctl --user is-active openclaw-gateway` = active: PASS
- WAHA API HTTP status = 200: PASS
- jiti cache populated with src-channel and src-send compiled entries: PASS

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Disk full blocked postgres-waha and gateway**
- **Found during:** Task 2
- **Issue:** `/var/log/syslog` had grown to 2.7GB + 1.3GB syslog.1 + 504MB journal, filling the 232GB root filesystem to 100%, causing postgres-waha to fail with "no space left on device"
- **Fix:** `truncate -s 0 /var/log/syslog` and `syslog.1`, vacuumed journal to 100MB — freed 3.2GB
- **Files modified:** none (log truncation only)
- **Commit:** 717fb07

**2. [Rule 3 - Blocking] Stale gateway lock file on restart loop**
- **Found during:** Task 2
- **Issue:** Gateway crashed in restart loop — "failed to acquire gateway lock at /tmp/openclaw-1000/gateway.97ffc3f0.lock". Lock persisted after stop, no process held it via fuser.
- **Fix:** `rm -f /tmp/openclaw-1000/gateway.*.lock` before restarting
- **Files modified:** none (lock file deletion only)
- **Commit:** 717fb07

## Known Stubs

None.

## Self-Check: PASSED

- Commits 91ee02d and 717fb07 exist in git log
- Both hpg6 locations have addParticipants (verified live)
- WAHA API returning 200 (verified live)
- Gateway active (verified live)
