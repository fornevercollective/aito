#!/usr/bin/env bash
# repel / aito-walk discoverable launch script — localhost booth (camera-safe).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export AITO_OPEN_BROWSER=1
export AITO_MAC_ROOT="$ROOT"
exec ./start.sh