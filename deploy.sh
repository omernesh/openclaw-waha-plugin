#!/bin/bash
# Deploy waha-oc plugin to hpg6 production
# Usage: bash deploy.sh
#
# This script:
# 1. SCPs all source files to BOTH production locations
# 2. Patches package.json name to "waha" (npm uses "waha-openclaw-channel", gateway expects "waha")
# 3. Installs npm dependencies if needed
# 4. Restarts the gateway
# 5. Verifies the deployment

set -euo pipefail

HOST="omer@100.114.126.43"
EXT_DIR="~/.openclaw/extensions/waha"
WS_DIR="~/.openclaw/workspace/skills/waha-openclaw-channel"

echo "=== Deploying waha-oc plugin to hpg6 ==="

# Ensure remote directories exist
ssh "$HOST" "mkdir -p $EXT_DIR/src $EXT_DIR/rules/contacts $EXT_DIR/rules/groups $WS_DIR/src $WS_DIR/rules/contacts $WS_DIR/rules/groups"

# Deploy source files to both locations
echo "--- Copying source files ---"
for dir in "$EXT_DIR" "$WS_DIR"; do
  scp src/*.ts "$HOST:$dir/src/"
  scp index.ts openclaw.plugin.json package.json SKILL.md README.md CHANGELOG.md "$HOST:$dir/"
  scp rules/contacts/_default.yaml "$HOST:$dir/rules/contacts/"
  scp rules/groups/_default.yaml "$HOST:$dir/rules/groups/"
done

# Patch package.json name on production (npm name != plugin ID)
# npm package: "waha-openclaw-channel" | gateway plugin ID: "waha"
echo "--- Patching package.json name to 'waha' ---"
ssh "$HOST" "python3 -c \"
import json
for loc in ['$EXT_DIR/package.json', '$WS_DIR/package.json']:
    import os; loc = os.path.expanduser(loc)
    d = json.load(open(loc))
    d['name'] = 'waha'
    json.dump(d, open(loc, 'w'), indent=2)
    print(f'  Patched {loc}')
\""

# Install dependencies if needed
echo "--- Checking dependencies ---"
ssh "$HOST" "cd $EXT_DIR && npm ls yaml 2>/dev/null | grep -q yaml || npm install yaml"

# Restart gateway
echo "--- Restarting gateway ---"
ssh "$HOST" "systemctl --user restart openclaw-gateway"
sleep 5

# Verify
echo "--- Verifying ---"
HEALTH=$(ssh "$HOST" "curl -s http://127.0.0.1:8050/healthz")
MISMATCH=$(ssh "$HOST" "journalctl --user -u openclaw-gateway --since '10 seconds ago' --no-pager 2>&1 | grep -c 'mismatch' || true")

if [ "$HEALTH" = "ok" ] && [ "$MISMATCH" = "0" ]; then
  echo "=== Deploy successful! Webhook healthy, no plugin ID mismatch ==="
else
  echo "=== Deploy WARNING ==="
  [ "$HEALTH" != "ok" ] && echo "  Webhook health: $HEALTH (expected 'ok')"
  [ "$MISMATCH" != "0" ] && echo "  Plugin ID mismatch detected in logs!"
  ssh "$HOST" "journalctl --user -u openclaw-gateway --since '10 seconds ago' --no-pager 2>&1 | tail -10"
fi
