#!/bin/bash
# Launch standalone aito-mac.app with a visible booth window.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export AITO_MAC_ROOT="$(pwd)"

xattr -cr aito-mac.app bin/AitoMac.app 2>/dev/null || true

# Kill stuck menu-only instances + stale lock
pkill -x AitoMac 2>/dev/null || true
rm -f /tmp/aito-mac.lock
sleep 0.3

APP="$(pwd)/aito-mac.app"
if [[ ! -d "$APP" ]]; then
  echo "Building app…"
  ./scripts/make-app-bundle.sh
fi

# Sync latest booth UI into the bundle
if [[ -d "$APP/Contents/Resources/aito-mac" ]]; then
  rsync -a booth/ "$APP/Contents/Resources/aito-mac/booth/" 2>/dev/null || true
  rsync -a scripts/serve.py scripts/serve.mjs "$APP/Contents/Resources/aito-mac/scripts/" 2>/dev/null || true
fi

# Local booth server for the WebView
./scripts/stop-booth.sh 2>/dev/null || true
sleep 0.2
python3 scripts/serve.py 8768 --force &>/tmp/aito-mac-serve.log &
for _ in $(seq 1 50); do
  if curl -sf -o /dev/null "http://127.0.0.1:8768/booth/" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

echo "Opening $APP …"
# -n = new instance, -a = application
open -n -a "$APP"
sleep 1.2

if pgrep -x AitoMac >/dev/null; then
  echo "✓ AitoMac is running (pid $(pgrep -x AitoMac | tr '\n' ' '))"
else
  echo "✗ AitoMac did not stay open — trying binary directly"
  "$APP/Contents/MacOS/AitoMac" &
  sleep 1
fi

echo "  booth  http://127.0.0.1:8768/booth/"
echo "  log    /tmp/aito-mac-app.log"
echo "  If you only see the menu bar: press ⌘0 (Show Booth Window)"
tail -5 /tmp/aito-mac-app.log 2>/dev/null || true
