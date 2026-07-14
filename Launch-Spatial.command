#!/bin/bash
# aito — Spatial Live booth (gsplat · cameras · ffmpeg · depth)
# Double-click in Finder. Canonical repo: https://github.com/fornevercollective/aito
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export AITO_OPEN_BROWSER=1
export AITO_NO_OPEN="${AITO_NO_OPEN:-0}"
exec bash spatial/start.sh
