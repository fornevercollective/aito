# Build Extensions for Iterations & Online Expansion

This document explains how to add new iterations (forks/tracks) to the aito umbrella and have them automatically appear in the public test site.

## Core Principle

- All iterations live under `versions/<iteration-id>/`
- A single source of truth: `versions/iterations.json`
- The Astro hub (`site/`) is data-driven from that JSON.
- GitHub Actions builds the main app + Astro site and deploys everything to GitHub Pages under versioned subpaths.

## Adding a New Iteration

1. **Create the directory**
   ```bash
   mkdir -p versions/my-new-iteration
   ```

2. **Add entry to `versions/iterations.json`**
   ```json
   {
     "id": "my-new-iteration",
     "title": "My New Iteration",
     "status": "experimental",
     "description": "Description of what this track does...",
     "demoPath": "/versions/my-new-iteration/",
     "sourceBranch": "my-new-iteration",
     "type": "experimental"
   }
   ```

3. **Provide build output (optional but recommended)**
   - If the iteration has its own Vite/Astro app, add a build step in `.github/workflows/deploy-site.yml`:
     ```yaml
     - name: Build my-new-iteration
       run: |
         cd versions/my-new-iteration
         npm ci
         npm run build
         mkdir -p ../site/dist/versions/my-new-iteration
         cp -r dist/* ../site/dist/versions/my-new-iteration/
     ```
   - Or keep a static demo folder under `versions/my-new-iteration/demo/`.

4. **Artifacts / Documentation**
   - Put proposal docs, design tokens, screenshots, etc. directly in `versions/my-new-iteration/`.
   - The hub will automatically link to `/versions/my-new-iteration/` if you add an "artifacts" array or the page exists.

5. **Push to the matching branch**
   - The `sourceBranch` in the JSON should match a branch name for the "Source" link.

## Current Deploy Pipeline

- `.github/workflows/deploy-site.yml`:
  - Builds the main editor → `site/dist/versions/main/`
  - Builds the Astro hub (which reads `iterations.json`)
  - Deploys the combined static site to GitHub Pages

## Future Expansion Ideas

- Per-iteration `package.json` + workspace support at root.
- Automated "bake" previews using the bake-tree + vwall ladder logic during CI.
- Dynamic sub-sites per iteration using Astro's hybrid rendering or separate repos that feed artifacts.

This structure makes adding the next major iteration (e.g. a full Living Canvas Pixi implementation) a matter of configuration + one build step rather than forking the entire repo.
