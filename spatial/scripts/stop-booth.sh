#!/usr/bin/env bash
# Stop aito-mac booth server + native app (safe for set -e callers).
set -euo pipefail

killall AitoMac 2>/dev/null || true
pkill -f "[s]cripts/serve.py" 2>/dev/null || true
pkill -f "[s]erve.mjs" 2>/dev/null || true
pkill -f "serve.py 876" 2>/dev/null || true

for port in $(seq 8768 8778); do
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
  fi
done

rm -f /tmp/aito-mac.lock /tmp/aito-mac.port
echo "aito-mac booth stopped"