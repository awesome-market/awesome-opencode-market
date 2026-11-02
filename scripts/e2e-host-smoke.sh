#!/bin/bash
# Host smoke: verify the market plugin loads in a real opencode server env.
# Usage: scripts/e2e-host-smoke.sh [plugin-dir]
set -e
PLUGIN=${1:-/Volumes/2t/code/opencode-market/plugins/market}
H=$(mktemp -d); trap 'kill %1 2>/dev/null; rm -rf "$H"' EXIT
mkdir -p "$H/.config/opencode"
cat > "$H/.config/opencode/opencode.json" <<J
{"plugins":["$PLUGIN"]}
J
export XDG_CONFIG_HOME="$H/.config" XDG_DATA_HOME="$H/data" XDG_CACHE_HOME="$H/cache"
opencode serve --port 0 > "$H/serve.out" 2>&1 &
for i in $(seq 1 20); do grep -q "server listening" "$H/serve.out" 2>/dev/null && break; sleep 0.5; done
PORT=$(sed -n 's/.*127.0.0.1:\([0-9]*\).*/\1/p' "$H/serve.out" | head -1)
PW=$(sed -n 's/server password //p' "$H/serve.out" | head -1)
[ -z "$PORT" ] && { echo "FAIL: serve never listened"; cat "$H/serve.out"; exit 1; }
curl -s -u "opencode:$PW" -o /dev/null "http://127.0.0.1:$PORT/api/plugin"
sleep 1
grep -q "loading plugin.*opencode-market\|loading plugin.*$PLUGIN" "$H/data/opencode/log/opencode.log" \
  && echo "PASS: market plugin loaded" || { echo "FAIL: no loading line"; tail -5 "$H/data/opencode/log/opencode.log"; exit 1; }
