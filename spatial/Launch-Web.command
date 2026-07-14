#!/bin/bash
# Spatial live booth in the browser (localhost secure context for camera)
cd "$(dirname "$0")"
export AITO_OPEN_BROWSER=1
exec bash ./start.sh
