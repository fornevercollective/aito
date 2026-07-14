# AGENTS.md

Conventions for any agent (human or LLM) editing this repo.

## What aito is

**One monorepo** ([fornevercollective/aito](https://github.com/fornevercollective/aito)):

1. **Editor** (`src/`) — WebGL effect-layer system over a before/after slider, AI over WebSocket.
2. **Spatial Live** (`spatial/`) — gsplat booth, multi-source live, ffmpeg media, hands/depth (was aito-mac).
3. **Living Canvas** (`versions/living-canvas/`) — research pivot.
4. **Site** (`site/`) — public hub / marketing Astro.

The editor is the shipping product; spatial live is first-class local.

## Spatial live

- Launch: `./Launch-Spatial.command` or `npm run spatial` → http://127.0.0.1:8768/booth/
- Edit booth under `spatial/booth/` only (do not revive a parallel `~/dev/aito-mac` tree as source of truth).
- Media APIs: `spatial/scripts/serve.mjs` + `booth-media.mjs`
- Bridge to editor: `src/lib/spatial-depth.ts` + `window.aitoBoothHand` / `window.aitoBoothDepth`

## Hot spots

- **`src/ai/mapper.ts`** — Single source of truth for how AI signals
  become per-effect uniforms. Adjust here before touching shaders if
  you only want to change behavior, not visuals.
- **LUT / style presets** — sourced from sibling `/Users/qbit/dev/imagine/style_presets/`.
  The manifest is vendored at `src/data/imagine-presets.json` (run `npm run sync:imagine-presets` to refresh).
  Canonical preset ids (slugs) live in `lutPresets.ts` + `grok.ts` tool schema. Update the imagine catalog, then sync.
- **`src/effects/shaders/*.ts`** — GLSL strings. Keep each shader
  small and standalone; share helpers via `common.glsl.ts`.
- **`src/effects/types.ts`** — All effect prop shapes are defined
  here. Adding a new uniform: type it here, default it in
  `presets.ts`, add a uniform slot in `EffectLayer.tsx`'s `SHADERS`
  table, and read it inside the relevant case in `useFrame`.

## Adding a new effect

1. Add the kind to `EffectKind` and a Props interface in
   `effects/types.ts`.
2. Add a default in `effects/presets.ts`.
3. Write a shader in `effects/shaders/<kind>.ts`. Use
   `SLIDER_CLIP` and call `sliderClip(vUv)` at the top of `main()`.
4. Register vert/frag/uniforms in `components/EffectLayer.tsx`
   `SHADERS` table and write the uniform-update branch in `useFrame`.
5. Add a fields list to `components/ui/ControlPanel.tsx`.
6. Add a mapper in `ai/mapper.ts`.

## Style

- TypeScript strict on. Prefer narrow types over `any`. Use
  `EffectPropsByKind[K]` to keep effect-specific code typed inside
  the dispatcher.
- No comments that just narrate code. Comments are for non-obvious
  intent (e.g. why a uniform is mapped a certain way).
- Keep shaders side-effect-free. Discard, output color, return.

## Testing

Manual for now. The mock AI channel cycles every ~12s; toggle layers
on/off in the panel to verify each effect responds to AI signals.

## LUTs / Film Looks (imagine support)

The 50+ film emulation, cinematic, and aesthetic presets are maintained in the sibling
workspace at `/Users/qbit/dev/imagine/style_presets/`. aito consumes them via:

- `src/data/imagine-presets.json` (committed snapshot)
- `npm run sync:imagine-presets` after changes upstream
- `src/lib/lutPresets.ts` + dynamic select in ControlPanel + enum in grok.ts tools

When adding or renaming a look, edit in imagine first, then sync + (optionally) tune the
defaultAdjustmentsFor() simulation seeds in lutPresets.ts.
