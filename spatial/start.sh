#!/usr/bin/env bash
# aito spatial live — gsplat booth + ffmpeg media + optional depth sidecars
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then . "$HOME/.nvm/nvm.sh"; fi
ROOT="$(pwd)"
export AITO_MAC_ROOT="$ROOT"
export AITO_SPATIAL_ROOT="$ROOT"
PORT="${AITO_PORT:-8768}"
HOST="${AITO_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}/booth/"
if [[ "${AITO_SETUP:-}" == "1" ]] && [[ -f scripts/setup.sh ]]; then bash scripts/setup.sh || true; fi
if [[ -f jax-sidecar/booth_jax.py ]] && ! curl -sf "http://127.0.0.1:8767/health" >/dev/null 2>&1; then
  python3 jax-sidecar/booth_jax.py --port 8767 &>/dev/null &
fi
if [[ -f zipdepth-sidecar/booth_zipdepth.py ]] && ! curl -sf "http://127.0.0.1:8766/health" >/dev/null 2>&1; then
  python3 zipdepth-sidecar/booth_zipdepth.py --port 8766 &>/dev/null &
fi
booth_up() { curl -sf -o /dev/null "$URL" 2>/dev/null || curl -sf -o /dev/null "http://${HOST}:${PORT}/api/health" 2>/dev/null; }
if booth_up; then
  echo "aito spatial: reusing server at $URL"
  [[ "${AITO_OPEN_BROWSER:-}" == "1" && "${AITO_NO_OPEN:-}" != "1" ]] && open "$URL" 2>/dev/null || true
  exit 0
fi
echo "aito spatial live"
echo "  root  $ROOT"
echo "  url   $URL"
[[ "${AITO_OPEN_BROWSER:-}" == "1" && "${AITO_NO_OPEN:-}" != "1" ]] && ( sleep 0.7 && open "$URL" ) &
if command -v node >/dev/null 2>&1; then exec node scripts/serve.mjs "$PORT"; fi
if command -v python3 >/dev/null 2>&1; then exec python3 scripts/serve.py "$PORT"; fi
echo "need node or python3" >&2; exit 1
