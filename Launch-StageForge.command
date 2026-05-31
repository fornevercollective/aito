#!/bin/bash
# Launch StageForge orchestrator for aito (TUI + health/restart loop + roadmap jobs).
# Double-click or run from Terminal.
set -euo pipefail
cd "$(dirname "$0")"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/go/bin:$PATH"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "$HOME/.nvm/nvm.sh"
fi

STAGEFORGE="${STAGEFORGE_BIN:-}"
if [[ -z "$STAGEFORGE" ]]; then
  for c in "$HOME/dev/stageforge/bin/stageforge" stageforge; do
    if command -v "$c" &>/dev/null || [[ -x "$c" ]]; then
      STAGEFORGE="$c"
      break
    fi
  done
fi

if [[ -z "$STAGEFORGE" ]]; then
  echo "stageforge not found — build it:"
  echo "  make -C ~/dev/stageforge build"
  echo "Then re-run Launch-StageForge.command"
  exit 1
fi

echo "StageForge → aito ($(pwd))"
echo "  TUI:     $STAGEFORGE up"
echo "  frontend http://127.0.0.1:\${PORT:-5173}/"
echo "  inference ws://127.0.0.1:\${INFERENCE_PORT:-8765}/"
echo ""
echo "This is the control center for iterating the photo editing roadmap."
echo ""

exec "$STAGEFORGE" up -c stageforge.yaml
