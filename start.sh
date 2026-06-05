#!/bin/bash
# aito — unified dev launcher (frontend + inference server)
#
# Usage:
#   ./start.sh                 # mock inference (no real SAM backend)
#   VITE_AI_WS=ws://localhost:8765 ./start.sh     # use real/local inference server
#   AITO_REAL_SAM=1 ./start.sh # start the SAM-enabled inference_ws.py (requires checkpoint)
#
# Double-click Launch.command for the Finder-friendly version (auto-opens browser).

set -euo pipefail
cd "$(dirname "$0")"

# --- PATH hygiene (matches blank / stageforge / imagine conventions) ---
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/go/bin:$PATH"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "$HOME/.nvm/nvm.sh"
fi

# --- Config ---
FRONTEND_PORT="${PORT:-5173}"
INFERENCE_PORT="${INFERENCE_PORT:-8765}"
LISTEN_HOST="${AITO_HOST:-127.0.0.1}"

MOCK_MODE=1
if [[ "${AITO_REAL_SAM:-}" == "1" || "${VITE_AI_WS:-}" == ws://localhost:${INFERENCE_PORT}* ]]; then
  MOCK_MODE=0
fi

echo "aito — photo editing workspace"
echo "  frontend   http://${LISTEN_HOST}:${FRONTEND_PORT}/"
echo "  inference  ws://${LISTEN_HOST}:${INFERENCE_PORT}/   (mock=${MOCK_MODE})"
echo ""

# --- Cleanup trap (kill children on exit / Ctrl-C) ---
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down aito services..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  echo "Done."
}
trap cleanup EXIT INT TERM

# --- Start inference server (background) ---
if [[ $MOCK_MODE -eq 1 ]]; then
  echo "→ Starting mock inference server (port ${INFERENCE_PORT})..."
  python3 server/mock_ws.py &
  INFERENCE_PID=$!
  PIDS+=("$INFERENCE_PID")
  export VITE_AI_WS="ws://${LISTEN_HOST}:${INFERENCE_PORT}"
else
  echo "→ Starting real inference server (port ${INFERENCE_PORT})..."
  # If user wants the full SAM version they should have the checkpoint
  python3 server/inference_ws.py &
  INFERENCE_PID=$!
  PIDS+=("$INFERENCE_PID")
  export VITE_AI_WS="ws://${LISTEN_HOST}:${INFERENCE_PORT}"
fi

# Give the WS server a moment to bind
sleep 0.6

# --- Start Vite frontend ---
echo "→ Starting Vite dev server (port ${FRONTEND_PORT})..."
npm run dev &
FRONTEND_PID=$!
PIDS+=("$FRONTEND_PID")

# --- Optional browser open (only when explicitly requested, like blank) ---
if [[ "${AITO_OPEN_BROWSER:-}" == "1" && "${AITO_NO_OPEN:-}" != "1" && "${STAGEFORGE:-}" != "1" ]]; then
  (sleep 1.2 && open "http://${LISTEN_HOST}:${FRONTEND_PORT}/") &
fi

echo ""
echo "Ready. Press Ctrl-C to stop both services."
echo ""

# Wait on the frontend (primary visible process). If it dies, cleanup runs.
wait "$FRONTEND_PID" || true
