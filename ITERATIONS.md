# aito Iterations

This repository is structured as an **umbrella** containing multiple parallel iterations / forks of the aito photo editing concept.

## Structure

```
/ (umbrella root)
├── versions/
│   ├── main/                  ← stable, actively developed Halide editor (most code lives here or at root)
│   └── living-canvas/         ← high-end pivot / research track
│       ├── docs/
│       │   └── LIVING-CANVAS-ARCHITECTURE-PROPOSAL.md
│       └── src/styles/living-tokens.css
├── site/                      ← Astro static test site (the public hub)
├── .github/workflows/
│   └── deploy-site.yml        ← builds Astro + deploys to GitHub Pages
└── ...
```

## Live Test Site

The Astro site at the root (`site/`) is deployed automatically via GitHub Actions to GitHub Pages.

It serves as the single source of truth for:
- Explaining the different tracks
- Linking to live demos
- Hosting documentation for experimental iterations

## Git Strategy Recommendations

Recommended options (choose one):

1. **Branches** (simplest for most people)
   - `main` = current stable Halide track
   - `living-canvas` = the high-end pivot branch

2. **Directories** (current structure)
   - `versions/main/` (or keep main code at root for DX)
   - `versions/living-canvas/` contains the proposal + design tokens + future experimental code

3. **Hybrid**
   - Keep active development at root or `versions/main/`
   - Use long-lived branches + the `versions/` directory for clear archival of different iterations

The `versions/` folder approach makes the different tracks very explicit when people browse the repo or the deployed Astro test site.

## Contributing

When working on a specific iteration, mention it in your PR / commit:
- `feat(main): ...`
- `research(living-canvas): ...`

The StageForge TUI (via `Launch-StageForge.command`) and the jobs in `stageforge.yaml` remain the primary way to drive roadmap items across iterations.
