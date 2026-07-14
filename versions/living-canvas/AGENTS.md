# AGENTS.md

Conventions for any agent (human or LLM) editing this repo.

## What aito is

A WebGL effect-layer system over a before/after slider, driven by AI
inference signals over a WebSocket. The visual stack is the product;
the inference backend is pluggable.

## Hot spots

- **`src/ai/mapper.ts`** — Single source of truth for how AI signals
  become per-effect uniforms. Adjust here before touching shaders if
  you only want to change behavior, not visuals.
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
