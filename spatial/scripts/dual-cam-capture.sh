#!/usr/bin/env bash
# Capture simultaneous desktop + iPhone Continuity frames for Splatline multi-view.
# Uses AVFoundation (ffmpeg). Continuity must be available (phone nearby, Continuity Camera on).
#
# Usage:
#   ./scripts/dual-cam-capture.sh [output_dir] [seconds]
#   ./scripts/dual-cam-capture.sh ~/Downloads/splatline-dual 5
#
# Output layout (DepthSplat / multi-view friendly):
#   out/desktop/frame_%06d.jpg
#   out/iphone/frame_%06d.jpg
#   out/manifest.json

set -euo pipefail

OUT="${1:-$HOME/Downloads/aito-dual-cam}"
SECS="${2:-4}"
FPS="${FPS:-15}"

mkdir -p "$OUT/desktop" "$OUT/iphone"

echo "Listing AVFoundation devices…"
LIST=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true)

desktop_idx=""
iphone_idx=""
deskview_idx=""

# Parse: [0] FaceTime HD Camera (Built-in)
while IFS= read -r line; do
  case "$line" in
    *"AVFoundation audio devices"*) break ;;
  esac
  idx=$(printf '%s\n' "$line" | sed -nE 's/.*\[([0-9]+)\].*/\1/p')
  [[ -z "$idx" ]] && continue
  name=$(printf '%s\n' "$line" | sed -E 's/.*\[[0-9]+\][[:space:]]*//')
  low=$(printf '%s\n' "$name" | tr '[:upper:]' '[:lower:]')
  echo "  [$idx] $name"
  if printf '%s' "$low" | grep -qE 'facetime|built-in|built in'; then
    desktop_idx=$idx
  elif printf '%s' "$low" | grep -qE 'desk view|deskview'; then
    deskview_idx=$idx
  elif printf '%s' "$low" | grep -qi 'iphone'; then
    iphone_idx=$idx
  elif printf '%s' "$low" | grep -q 'camera' && ! printf '%s' "$low" | grep -qE 'capture screen|facetime'; then
    if [[ -z "$iphone_idx" ]]; then
      iphone_idx=$idx
    fi
  fi
done <<EOF
$(printf '%s\n' "$LIST" | sed -n '/AVFoundation video devices/,/AVFoundation audio devices/p')
EOF

desktop_idx=${desktop_idx:-0}
if [[ -z "$iphone_idx" && -n "$deskview_idx" ]]; then
  iphone_idx=$deskview_idx
fi

if [[ -z "$iphone_idx" ]]; then
  echo "ERROR: No Continuity / iPhone camera found."
  echo "Enable Continuity Camera, unlock iPhone nearby, then retry."
  exit 1
fi

if [[ "$desktop_idx" == "$iphone_idx" ]]; then
  echo "ERROR: Desktop and iPhone resolved to the same index ($desktop_idx)."
  exit 1
fi

echo "Capturing ${SECS}s @ ${FPS}fps"
echo "  desktop → index $desktop_idx → $OUT/desktop"
echo "  iphone  → index $iphone_idx → $OUT/iphone"

ffmpeg -y -f avfoundation -framerate "$FPS" -i "${desktop_idx}:none" \
  -t "$SECS" -vf "fps=${FPS},scale=1280:-2" "$OUT/desktop/frame_%06d.jpg" \
  >/tmp/aito-dual-desktop.log 2>&1 &
PID_D=$!

ffmpeg -y -f avfoundation -framerate "$FPS" -i "${iphone_idx}:none" \
  -t "$SECS" -vf "fps=${FPS},scale=1280:-2" "$OUT/iphone/frame_%06d.jpg" \
  >/tmp/aito-dual-iphone.log 2>&1 &
PID_I=$!

wait $PID_D || { echo "Desktop capture failed — see /tmp/aito-dual-desktop.log"; exit 1; }
wait $PID_I || { echo "iPhone capture failed — see /tmp/aito-dual-iphone.log"; exit 1; }

ND=$(ls -1 "$OUT/desktop" 2>/dev/null | wc -l | tr -d ' ')
NI=$(ls -1 "$OUT/iphone" 2>/dev/null | wc -l | tr -d ' ')

cat >"$OUT/manifest.json" <<EOF
{
  "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "fps": $FPS,
  "seconds": $SECS,
  "desktop_index": $desktop_idx,
  "iphone_index": $iphone_idx,
  "desktop_frames": $ND,
  "iphone_frames": $NI,
  "splatline_hint": "Use both view folders as multi-view context for DepthSplat / VGGT (2+ views)."
}
EOF

echo "Done. desktop=$ND frames · iphone=$NI frames"
echo "Manifest: $OUT/manifest.json"
echo "Splatline: pair frames as multi-view context for --splat-backend depthsplat"
