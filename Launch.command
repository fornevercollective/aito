#!/bin/bash
# Double-click in Finder: opens Terminal, starts aito (frontend + inference server), and opens browser.
cd "$(dirname "$0")"
export AITO_OPEN_BROWSER=1
exec ./start.sh "$@"
