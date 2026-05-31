# aito launch support

This directory contains sources for the macOS-native launch experience.

## Launch aito.app

Source: `Launch aito.applescript`

Rebuild the bundle from the project root:

```bash
osacompile -o "Launch aito.app" "support/Launch aito.applescript"
```

Then you can double-click `Launch aito.app` in Finder exactly like `Launch Blank.app` in the sibling project.

The .app simply opens Terminal and runs `./start.sh`.

## Philosophy

These launchers (`.command` files + optional .app) + `stageforge.yaml` give the project the same "control surface + roadmap driver" UX used in `blank` and other active workspaces. The StageForge TUI becomes the place where the team (human or agent) iterates through the approved photo editing plan in a structured way.
