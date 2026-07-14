#!/bin/bash
# Double-click in Finder — rebuilds aito-mac.app and opens the native booth (no Terminal needed after first run).
set -euo pipefail
cd "$(dirname "$0")"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Clear quarantine so Gatekeeper does not silently block the unsigned .app
xattr -cr aito-mac.app bin/AitoMac.app 2>/dev/null || true
# Clean restart — stop stale booth servers (port 8768 conflicts cause instant exit 1)
./scripts/stop-booth.sh
sleep 0.3

./scripts/make-app-bundle.sh

# Warm booth server before native shell opens (camera needs localhost)
export AITO_MAC_ROOT="$(pwd)"
export AITO_NO_OPEN=1
export AITO_NATIVE=0
AITO_MAC_ROOT="$(pwd)" python3 scripts/serve.py 8768 &>/tmp/aito-mac-serve.log &
SERVER_PID=$!
BOOTH_PORT=8768
for _ in $(seq 1 40); do
  if [[ -f /tmp/aito-mac.port ]]; then
    BOOTH_PORT="$(cat /tmp/aito-mac.port)"
  fi
  if curl -sf -o /dev/null "http://127.0.0.1:${BOOTH_PORT}/booth/"; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    if curl -sf -o /dev/null "http://127.0.0.1:${BOOTH_PORT}/booth/"; then
      break
    fi
    echo "serve.py died — see /tmp/aito-mac-serve.log" >&2
    tail -20 /tmp/aito-mac-serve.log >&2 || true
    exit 1
  fi
  sleep 0.1
done
export AITO_BOOTH_PORT="$BOOTH_PORT"
echo "$BOOTH_PORT" > /tmp/aito-mac.port

LOG="$HOME/Library/Logs/aito-mac-launch.log"
{
  echo "=== $(date) ==="
  echo "root=$(pwd)"
  open -a "$(pwd)/aito-mac.app"
  sleep 1
  pgrep -l AitoMac || echo "WARN: AitoMac process not found after open"
  PORT="$(cat /tmp/aito-mac.port 2>/dev/null || echo 8768)"
  curl -sf -o /dev/null -w "booth_http=%{http_code} port=${PORT}\n" "http://127.0.0.1:${PORT}/booth/" || echo "WARN: booth server not reachable"
} >>"$LOG" 2>&1

echo "aito-mac launched — booth window should appear."
echo "Log: $LOG"
echo "If the window is blank: run Launch.command again, or check Camera in System Settings."