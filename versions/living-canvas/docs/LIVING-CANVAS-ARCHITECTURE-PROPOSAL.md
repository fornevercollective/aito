# aito Living Canvas Pivot — Forward Architecture Proposal

**Branch/Worktree**: `pivot/living-canvas` @ `/Users/qbit/dev/aito-living-canvas`  
**Date**: 2026-05-31 (exploration snapshot)  
**Context**: Approved background high-end track (`vwall-pivot` + `lut-mood` in stageforge.yaml). Parallel to core Halide masked-corrections / bake immediate track. Existing aito (Three.js EffectStage + before/after slider + SAM + artistic WebGL layers + AI mapper) **must remain 100% functional and unchanged**.

---

## Executive Vision: The Living Canvas

aito becomes a **premium, cinematic "living canvas" photo editor** — dramatically more data-rich, immersive, and presentation-polished than conventional tools (Lightroom, Capture One, etc.), while retaining its unique identity as an **AI-reactive visual forge**.

### Dual-Surface Model (Non-Negotiable)

1. **Forge Surface (Preserved Core — "Reveal / Treatment / AI Process Viz")**
   - `src/components/EffectStage.tsx` + `BeforeAfter.tsx` + `EffectLayer.tsx`
   - Six artistic GLSL layers (sampling/unfocused/burn/glass/magnifier/crack) + Halide-style `adjust` base pass (now with SAM mask scoping)
   - Slider-driven before/after clipping (`SLIDER_CLIP` in common.glsl.ts)
   - `src/ai/mapper.ts` as single source of truth for AI signals → uniforms
   - SAM segmentation (`src/segmentation/`) as mask source for scoped corrections
   - **Never broken**. This is the "powerful artistic + diagnostic" heart. All future high-end surfaces feed it or are fed by it.

2. **Living Canvas (New Immersive HUD-Style Primary Surface)**
   - High-fidelity PixiJS (or hybrid Pixi + Three offscreen) full-bleed / multi-pane canvas.
   - Feels *alive*: responds to image content, user-selected mood/LUT, AI telemetry, and edit history.
   - Rich contextual overlays, data-driven rails, variant timelines as visual "walls".
   - Cinematic presentation polish (VSCO/Behance-level) meets Tron/Gmunk/Minority Report/Resolve technical HUD density.
   - Orchestrates the Forge: selections, moods, and commits drive before/after sources, adjustments, active masks, and layer stacks.

The result: a pro tool that feels like **Gmunk's Grid interfaces conducting a Minority Report spatial session inside a DaVinci Resolve color bay**, with VSCO-curated emotional presentation and vwall-scale large-variant handling.

---

## Visual Language & Cinematic References (Synthesized)

### Primary References (pulled from vwall + sources)

**vwall (sibling — primary implementation reference)**:
- Deep void `#0b0b0b` / `#0a0a0b` backgrounds (aito convergence).
- Monospace tech labels + colored media-type chips/badges (`#3366aa` image, `#aa3366` video, etc.).
- **Metrics HUD panel** (collapsible right): live FPS, memory, load queue, per-type counts, buffer estimates, probe status, cache reuse stats.
- **Processing Pipeline HUD**: explicit stages "Search → Voxels → Thumbs → Probes → LOD" with active/processing states and live status text. First-class visualization of data flow.
- **Genre rails** (bottom): contextual semantic clusters with collapse; drives filtering without losing session state.
- **MediaLadder + LOD**: `variantUrls` + `cheapestPreviewTier` / `fullTier`; spatial zoom-driven texture upgrades (`LOD_DETAIL_ENTER_PX` etc.) with voxel placeholder refinement ("blocks → photo" living reveal).
- **ProbePool + Session**: clustered ffprobe/EXIF/metadata with heavy reuse across interactions; `MediaSession` class for incremental nodes/textures (Bridge-style cache, evict unused).
- **StreamLoad**: wave mounting + FCFS/lazy spatial prefetch for 20k-item scale without jank.
- **Detail drawers/lightboxes**: rich meta (probe rows, title/snippet, tech toggles); swipe nav.
- **PerfGuard adaptive tiers**: auto-throttle based on FPS/mem.
- Interaction: Pixi world pan/zoom + spatial LOD; click opens inspector; filters feel immediate.

**Gmunk / Tron: Legacy (FUI/HUD density + neon life)**:
- Neon cyan `#00f0ff` + electric accents against infinite black; layered emissive glows (inner + outer).
- Precise geometric forms, receding grids, holographic projections, flowing energy/data ribbons, wireframe draws.
- Reactive elements: interfaces that "live" and pulse with system state (AI busy, tile arrival, bake progress).
- Typography: condensed geometric + mono with subtle distortion/glow/scan.

**Minority Report (Spatial orchestration + transparent layered panels)**:
- Floating/semi-transparent data panels in 3D space; gesture-like direct manipulation (even if mouse/keyboard initially).
- Body-centered or canvas-centered large-scale interaction.
- Volumetric light, parallax depth, high-contrast cinematic lighting where holograms are the light source.

**DaVinci Resolve (Professional color/LUT/mood flows + modular HUD)**:
- Near-black modular panels, high information density, resizable/dockable.
- Node graph as schematic "HUD" (adapt for effect layer stack + correction history).
- **LUT / stills gallery browser**: grid of thumbnails with live preview; categorized (camera emulations, creative moods, film stocks).
- Scopes + analytical overlays as first-class (waveform/histogram equivalents for photo: live hist, false-color, mask viz).
- Timeline/filmstrip for versions + playhead (adapt: variant timeline rail with commit markers).
- Orange/amber accents for active/selection (aito orange `#ff5b2e` already aligns).
- Viewer HUD overlays (power windows → SAM masks; trackers; qualifiers).

**VSCO + Pinterest/Behance Presentation Polish ("Living" emotional content response)**:
- Film grain, light leaks, halation, tactile presets ("Recipes").
- Curated mood: interface elements (accents, subtle bg tints, rail themes) shift responsively to dominant hues / probed mood of current image set.
- Minimal chrome that lets photography breathe; generous but precise spacing.
- High-production mockup feel: device frames, before/after hero treatments, process documentation.
- Community/inspirational layer (future): moodboard "Canvas" integration for LUT collections or correction "recipes".

**Synthesized "Living Canvas" Aesthetic**:
- **Palette**: `#0a0a0b` base (aito/vwall), aito `--accent: #ff5b2e`, Tron cyan `#00f0ff` for data-life, Resolve amber `#ff9f1c` for selection/playhead, cool steel `#8a8a93` muted, subtle neon glows via `box-shadow` / Pixi filters.
- **Depth & Motion**: Layered glassmorphic panels (subtle backdrop blur where safe), grid overlays (Gmunk wire), smooth LOD refinement animations, content-driven hue shifts on rails/chrome.
- **Density with Breath**: vwall-style metrics/pipeline + Resolve node density, but VSCO-minimal when focused on the image. Collapsible everything.
- **"Alive" Behaviors**: Tiles/nodes pulse with AI confidence; mood selection globally modulates Forge via mapper/adjust or new LUT uniform layer; hover on history reveals probe-derived stats (exposure hist, dominant mood tag); bake commits "materialize" as new tiles with voxel→photo transition.
- **Typography**: System sans + `monospace` for all HUD telemetry (badges, pipeline steps, meta rows).

---

## Concrete Architecture

### State & Data Model Extensions (Additive, Shared)

Extend `src/state/store.ts` (or introduce `src/state/variants.ts`):
- `variants: Variant[]` — each has `id`, `sourceUrl` (or ladder), `thumbUrl`, `meta` (probe data, bake params, layerSnapshot, maskRefs), `kind` ("original" | "bake" | "lut-preview" | "history").
- `currentMood: string | null` (or `activeLutId`).
- `editSession: MediaSession`-like (reused nodes/textures/probes across the edit lifetime).
- `bakeHistory: BakeCommit[]`.

Shared libs (new, pure-TS first, no heavy deps):
- `src/lib/media-ladder.ts` — port/adapt vwall `media-ladder.js` (LadderTier, ensureItemLadder, cheapestPreview / fullTier, mipChain).
- `src/lib/probe-pool.ts` — adapted for browser image analysis (histograms via canvas, dominant color, simple mood heuristics) + optional external (ffprobe bridge).
- `src/lib/session.ts` — MediaSession class for variant reuse.

Forge remains the source of truth for **current** before/after + adjustments + activeSegment + layers. Living Canvas is the **orchestrator and historian**.

### Integration Points (Exact Touchpoints)

1. **SAM Masks / Segments → Canvas**
   - `SegmentMask.dataUrl` + `stickerUrl` become first-class "mask tiles" or overlay assets in a dedicated mask rail / inspector.
   - Selection in canvas → `selectSegment(id)` + `setAdjustmentScope({useActiveMask: true})` → instantly scopes Forge corrections.
   - Export: masks feed "hatch" viz or sticker libraries (per roadmap).

2. **Adjustments + Scope + Masked Corrections**
   - Living Canvas mood/LUT selectors and Resolve-style wheels/curves write directly to `store.adjustments` and `adjustmentScope`.
   - Forge's `ADJUST_FRAG` (with `uMask` + `uUseMask`/`uInvertMask`) renders the result immediately.
   - Bidirectional: manual tweaks in Forge ControlPanel reflected in canvas HUD readouts.

3. **Effect Layers & Artistic Stack**
   - Canvas hosts a "Layer Stack" view (node-graph or list) mirroring `ControlPanel` + `layers` state.
   - "Apply mood" can snapshot/apply preset layer configs or modulate mapper indirectly.
   - Glass effect hook for gsplat bakes (roadmap) visualized as special variant tiles.

4. **Bake / Commit Pipeline (Core Future Glue)**
   - Gesture in canvas ("commit tile to rail" or "bake" button) triggers extended `exportCurrent` logic or new `capture-bake` utility (high-fidelity offscreen at native res, composite corrections + layers).
   - Result: new `Variant` with full ladder (thumb immediate via canvas draw, full on demand), metadata (params, timestamp, score), and association to parent + mask set.
   - Appears instantly in "History Wall" / "Bake Rail" (vwall incremental session style — no refetch of prior).
   - Future: server ws command for real inpaint/LaMa bake feeding back as new source.

5. **AI Channel & Telemetry**
   - `ai` signals (progress, confidence, focus, tilesReady, busy, status) visualized in adapted pipeline HUD ("Inference → SAM → Grade → Effect → Tile").
   - Living canvas can "take over" focus points or mood biases that feed mapper (via store extension).
   - Mapper stays Forge-only; canvas is the rich visualizer + manual override surface.

6. **Hybrid Rendering**
   - Primary: Pixi living canvas owns layout, rails, inspectors, variant grid/wall.
   - Forge (`EffectStage`) remains mounted (or lazily in a focus pane / detachable "lightbox" that feels Minority Report holographic).
   - Option: offscreen Three.js render target fed into Pixi texture for "live Forge preview" tiles (expensive; gated).
   - Slider, masks, and layers always authoritative in Forge.

7. **Large / Multi-Variant Media Handling**
   - Every photo edit spawns a sessioned "variant lake".
   - Use ladder + probe + LOD sweep so 50–200 derivative versions (bakes, LUTs, masks, history) feel fluid.
   - PerfGuard-style tiering for editor (throttle previews when many variants open).

### Module & Package Sketch (Additive Only)

```
src/
  living-canvas/          # NEW (Pixi optional, behind flag or separate entry)
    LivingCanvas.tsx
    components/
      VariantWall.tsx     # Pixi-driven (adapts scroll-wall + app.js patterns)
      MoodRail.tsx        # Genre-rail → LUT/mood
      PipelineHUD.tsx     # vwall pipeline + aito ai signals
      MetricsPanel.tsx    # adapted metrics
      VariantInspector.tsx # drawer/meta with probe rows
    hooks/
      useMediaLadder.ts
      useVariantSession.ts
    adapters/
      forge-bridge.ts     # sync store ↔ canvas selections
  lib/
    media-ladder.ts       # (port)
    probe-pool.ts
    image-analysis.ts     # hist, dominant hue, simple mood tag
  state/
    variants.ts           # extensions (additive)
  styles/
    living-tokens.css     # (see scaffolding)
    hud.css
```

**Deps**: Add `pixi.js@^7` (or ^8) optionally; keep current Three/R3F intact. Feature flag `VITE_LIVING_CANVAS=1` or env to mount parallel surface.

**Non-Breaking Guarantee**:
- All existing routes, components, store consumers, shaders, SAM, WS channel, export unchanged.
- New code lives in additive modules; old paths compile and run identically.
- Experiments (below) are parallelizable prototypes.

---

## Recommended Starting Experiments (2–3 Parallel, Non-Breaking)

These can run **alongside** the main Halide immediate track (masked-corrections, brush, bake-commit, capture-bake, sam-matting) without touching Forge code or breaking current UX. Do them in the `pivot/living-canvas` worktree or behind flags in main.

1. **Pure-TS Media Ladder + Basic Variant Session Scaffold (Highest Priority Starter)**
   - Port/adapt `media-ladder.js` + minimal `session.js` logic into `src/lib/media-ladder.ts` + `src/lib/variant-session.ts` (no Pixi, no new deps).
   - Add a tiny "Variant Rail" stub (React list or simple grid) in the existing `ControlPanel` or a new "History" tab in SegmentPanel/BatchPanel.
   - On load or manual "snapshot", create a ladder entry for current before/after + adjustments snapshot.
   - Clicking a stub variant restores sources + adjustments (demo of future bake history).
   - **Value**: Proves reuse/LOD concepts; feeds bake-commit work; zero visual or runtime impact on current users.
   - **Effort**: 1–2 days for core + stub UI. Parallel to bake pipeline impl.

2. **HUD Primitives + Style Tokens + AITO Pipeline Visualizer (Polish + Language Anchor)**
   - Create `src/styles/living-tokens.css` (converged palette, spacing, glow mixins, rail primitives, chip/badge components) + `src/styles/hud.css`.
   - New lightweight `src/components/ui/LivingHUD.tsx` (or extend `AIStatus.tsx`): collapsible metrics strip + "Photo Pipeline" steps (Ingest → Segment (SAM) → Grade (Adjust) → Effects → Bake) driven by existing store + ai signals.
   - Wire status text to current AI `status` + segmentBusy + batch state. Use existing accent + new cyan/amber tokens.
   - Add subtle film-grain CSS overlay option (VSCO) toggleable in dev.
   - **Value**: Immediately improves perceived premium-ness of current app; establishes the exact visual language for the full pivot; reusable by future Pixi HUD. Completely additive.
   - **Effort**: 1 day. Can ship as progressive enhancement.

3. **Minimal Parallel Pixi "Mood & Variant Wall" Prototype (High-Fidelity Spike)**
   - In worktree (or gated `src/living-canvas/PrototypeWall.tsx` loaded only via query param or env), mount a tiny Pixi Application + world container.
   - Render a small grid of 6–12 "tiles": current segments (as sticker thumbs), 2–3 manual LUT/mood previews (generated via canvas 2d or simple shader), and 1–2 history snapshots.
   - Interaction: pan/zoom (basic), click tile → applies corresponding mood (writes adjustments + optional layer preset) or loads mask into activeSegment.
   - Use `PIXI.Assets` + basic ladder stub for "thumb vs detail".
   - Include a tiny "Processing" pipeline strip and metrics readout (DOM or Pixi text) showing reuse counts.
   - **Value**: Validates Pixi + Three coexistence (memory/perf), LOD feel, rail → Forge bridge, and living response. Produces the first cinematic screenshots for stakeholders. Does **not** replace any current UI.
   - **Effort**: 2–4 days (spike). Can be thrown away or evolved. Run in parallel with local-adjust-shaders and capture-bake.

**Additional Low-Cost Parallel Wins** (if bandwidth):
- Adapt vwall `perf-guard.js` concepts into a dev-only `src/lib/perf-guard.ts` for future large-variant handling.
- Small probe util that computes simple hist + dominant hue from loaded images and exposes via store (feeds mood rail auto-suggest).

All experiments designed so main `npm run dev` + Launchers continue to deliver the exact current experience.

---

## Style Tokens Scaffolding (Illustrative — Created in Worktree)

See companion file (created alongside this doc):
- `src/styles/living-tokens.css` — converged CSS custom properties + base HUD/rail primitives.
- Example usage in docs shows how current `styles.css` can progressively import tokens without breakage.

(Full tokens + a demo HUD component can be expanded in the next iteration of the spike.)

---

## Risks, Tradeoffs & Mitigation

- **Memory / Coexistence (Pixi + Three + SAM + large variants)**: Strict LOD + session eviction (vwall patterns) + tiered loading + offscreen Forge only when focused. Measure early in Exp #3.
- **Complexity Creep**: Strict "Forge is sacred" rule. Living Canvas owns orchestration + viz; never duplicates pixel pipeline.
- **Perf at Scale**: vwall already proves 10k–20k items viable with waves + spatial LOD + reuse. Photo variants are far fewer (dozens per session) → easier.
- **Adoption**: The Forge experience stays the hero for v0/v1 power users. Living Canvas is the "premium presentation + large-scale variant" layer that makes aito feel like a next-gen tool on Behance/portfolio shots.
- **Dep Size**: Pixi is lightweight (~few hundred KB gz). Gate behind dynamic import.

---

## Next Steps & Roadmap Tie-In (Opinionated)

**Immediate (in this worktree or main with flags)**: Execute the 3 experiments above. Prioritize #1 (ladder/session) because it directly unblocks `bake-commit` + `capture-bake`.

**Near-term (pivot stage)**:
- Flesh out full Living Canvas mount (Pixi primary surface + Forge as focus pane).
- LUT/mood system: gallery browser + application that writes to adjust + optional new global LUT shader pass (or pre-bake into adjust).
- Full variant wall + commit flow wired to real bake utility.
- Unified chrome (top bar + rails + HUD) that can host both surfaces.

**Longer**:
- Spatial/gesture extensions (Minority Report inspiration) once WebXR or advanced pointer events land.
- Server-backed variant lake + real generative fills feeding the ladder.
- Export "living" presentations (Behance-style case studies with embedded reactive canvases).

**How to Drive**: Use `./Launch-StageForge.command` — the `pivot` stage already contains `vwall-pivot` (this research) and `lut-mood`. Treat the experiments as first-class jobs.

---

## Appendix: File References (Exploration Sources)

**aito (current)**:
- `/src/components/EffectStage.tsx`, `EffectLayer.tsx`, `BeforeAfter.tsx`
- `/src/effects/shaders/adjust.ts` + `common.glsl.ts` (masked corrections)
- `/src/state/store.ts` (adjustments, segments, layers, ai)
- `/src/ai/mapper.ts`
- `/src/segmentation/*`
- `stageforge.yaml` (pivot stage), `HANDOFF.md`, `AGENTS.md`

**vwall (sibling — deep read)**:
- `app.js` (Pixi bootstrap, LOD upgrade/downgrade, stream-load waves, probe integration, detail drawers)
- `media-ladder.js` (full ladder + tier resolution)
- `probe-pool.js`, `session.js`, `metrics.js`, `stream-load.js`, `scroll-wall.js`
- `perf-guard.js`
- `styles.css` (rails, HUD panels, pipeline steps, chips)
- `index.html` (metricsPanel + pipeline HUD HTML structure)
- `catalog.js`, `metadata.js` (faceted probe indexing)

**Cinematic**:
- Gmunk Tron: Legacy FUI (gmunk.com + Art of Tron: Legacy; neon grids, holographic data flow).
- Minority Report (Underkoffler g-speak; spatial transparent panels, gesture orchestration).
- DaVinci Resolve Color page (node graphs, LUT galleries, scopes, modular dark HUD, version timelines).
- VSCO (film emulation, Recipes, Canvas moodboards, presentation polish) + Behance/Pinterest high-fidelity photography decks.

This proposal is opinionated, actionable, and grounded in the actual code of both siblings + the referenced aesthetic canon. The existing aito magic is the foundation; the living canvas makes it unforgettable.

---

*End of proposal. Ready for experiment implementation or stakeholder review.*
