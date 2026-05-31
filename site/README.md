# aito Umbrella — Astro Test Site

This Astro site is the public hub and documentation surface for the aito project.

It presents the different iterations (Main track + Living Canvas research pivot) in one beautiful, static experience.

## Development

```bash
cd site
npm install
npm run dev
```

## Build & Deploy

The site is automatically built and deployed to GitHub Pages by the workflow at:

`.github/workflows/deploy-site.yml`

To build locally:

```bash
npm run build
```

Output goes to `dist/`.

## Configuration for GitHub Pages

Edit `astro.config.mjs` and set:

- `site`: your GitHub Pages URL (e.g. `https://yourname.github.io`)
- `base`: the repo name (e.g. `/aito`)

## Relationship to the Rest of the Project

- The actual editor lives at the project root (Vite + React + Three.js).
- Experimental iterations live under `../iterations/`.
- This site tells the story and will eventually embed or link to live demos of each iteration.

