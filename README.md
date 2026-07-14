# aito

**AI photo editing + spatial live — one repo.**

[github.com/fornevercollective/aito](https://github.com/fornevercollective/aito)

**Desktop pro. Mobile PWA. Local spatial booth.**

- Real-time Grok commands (adjustments, LUTs, masking)
- Live camera tethering via local companion (Canon, Sony, Phase One, etc.)
- Film-accurate LUTs + custom .cube support (50+ presets from sibling `~/dev/imagine/style_presets`)
- SAM-powered masked corrections + pressure-sensitive brush
- Hatch export (subject / background / full)
- **Spatial Live** — gsplat booth, multi-source feeds, ffmpeg (all codecs / sequences / FPS), hands + depth cloud
- Works as a beautiful mobile PWA on iPhone and Android

**[Open the editor](https://fornevercollective.github.io/aito/)** — installs as PWA  
**[Hub, iterations & mobile notes](https://fornevercollective.github.io/aito/hub/)**  
**[Brand](https://fornevercollective.github.io/aito/brand/) · [Pricing](https://fornevercollective.github.io/aito/pricing/) · [License](https://fornevercollective.github.io/aito/license/)**

One repo. **Three tracks** that share bridges:

| Track | Path | Launch |
|-------|------|--------|
| **Editor** (product) | `src/` | `./Launch.command` · `npm run dev` |
| **Spatial Live** | [`spatial/`](./spatial/) | `./Launch-Spatial.command` · `npm run spatial` |
| **Living Canvas** (research) | [`apps/living-canvas/`](./apps/living-canvas/) · `versions/living-canvas/` | `npm run living-canvas` |

Local umbrella `~/dev/aito_all/{aito,aito-mac,aito-living-canvas}` maps into this repo — see [AITO_ALL.md](./AITO_ALL.md).

The editor is the shipping product; **spatial live + living canvas are first-class** (not separate GitHub projects).

### In action

<table>
<tr>
<td align="center" width="50%">
<img src="site/public/screenshots/editor-main.jpg" width="100%" alt="aito editor with AI prompt bar and LIVE VIEW tether indicator">
<br><sub>Main editor — prompt bar + live tethered capture</sub>
</td>
<td align="center" width="50%">
<img src="site/public/screenshots/lut-film.jpg" width="100%" alt="LUT film emulation controls with Kodak Portra and cinema looks">
<br><sub>Film emulation LUTs — VSCO, Kodak, Fuji, cinema presets</sub>
</td>
</tr>
<tr>
<td align="center" width="50%">
<img src="site/public/screenshots/tether-live.jpg" width="100%" alt="Live tethered mode with pulsing LIVE VIEW badge and tether controls">
<br><sub>Live tethering — clickable LIVE VIEW + direct camera controls</sub>
</td>
<td align="center" width="50%">
<img src="site/public/screenshots/brush-mask.jpg" width="100%" alt="Brush refinement on an active AI subject mask">
<br><sub>AI masking + precise brush refinement</sub>
</td>
</tr>
</table>

- **Main track** — Production photo editor (masked corrections, brush, hatch export, WebGL artistic layers).
- **Living Canvas pivot** — High-end research track exploring vwall patterns + cinematic HUD interfaces (Gmunk/Tron/Resolve/VSCO).

See [versions/](./versions) for the research tracks (including the vwall Living Canvas pivot) and the live site for the current product experience.

---

AI-driven image/video retouching app. v0 ships the visual core: a
before/after slider with six AI-controllable WebGL effect layers
(sampling, unfocused, burn, glass, magnifier, crack), wired to a
WebSocket inference channel with a built-in mock so it runs
standalone.

## Mobile PWA

aito is a full Progressive Web App with offline support.

**Install on iOS / Android:**
1. Open https://fornevercollective.github.io/aito/ in Safari or Chrome
2. Tap **Share** → **Add to Home Screen**

Once installed you get:
- Native app-like experience (no browser chrome)
- Offline access to the editor shell
- Fast subsequent launches
- The same powerful features as desktop (AI, tether, brush, LUTs)

On desktop you can also install via the **Install** button that appears in the top bar when your browser supports it.

The Service Worker aggressively caches the UI so the app remains usable even with poor connectivity.

The interface adapts automatically:
- Desktop → powerful 3-column layout with permanent inspector
- Mobile/Tablet → image-first with elegant bottom bar + slide-up sheets

## Run (recommended)

Double-click one of the launchers in the project root (Finder-friendly):

- **`Launch.command`** — Photo editor (Vite + inference mock) → browser.
- **`Launch-Spatial.command`** — **Spatial Live booth** (gsplat · cameras · ffmpeg · depth) → http://127.0.0.1:8768/booth/
- **`Launch-StageForge.command`** — StageForge TUI (roadmap jobs/stages).

From Terminal:

```bash
./start.sh                 # editor workspace (frontend + mock inference)
./Launch-Spatial.command   # spatial live booth
npm run spatial            # same booth, no Finder wrapper
npm run spatial:open       # booth + open browser
./Launch-StageForge.command
```

Or the classic way:

```bash
npm install
npm run dev                # editor → http://localhost:5173
npm run spatial            # booth  → http://127.0.0.1:8768/booth/
```

### Spatial Live (all-in-one local)

See **[spatial/README.md](./spatial/README.md)** for the full layout. Quick map:

```
spatial/booth/             # UI + gsplat + live feeds + hands
spatial/scripts/           # serve.mjs + booth-media (ffmpeg / sequences / FPS)
spatial/mac/               # native AitoMac Swift sources
spatial/zipdepth-sidecar/
src/lib/spatial-depth.ts   # editor ↔ booth hand/depth bridge
```

### Server modes

- **Default (mock)**: `./start.sh` runs the synthetic inference cycle so you can develop the UI without a real backend.
- **Real inference** (with or without SAM):

  ```bash
  VITE_AI_WS=ws://localhost:8765 ./start.sh
  # or
  AITO_REAL_SAM=1 ./start.sh     # starts server/inference_ws.py (needs checkpoint for real SAM)
  ```

A minimal Python WS mock lives in `server/mock_ws.py` (also exposed as `npm run mock:server`).

For the full SAM + server experience see `HANDOFF.md`.

## Architecture

```
src/
  ai/
    channel.ts      WebSocket client + automatic mock fallback
    mapper.ts       AI signal → per-effect uniform overrides
  effects/
    types.ts        Typed props for every effect kind
    presets.ts      Neutral default uniforms
    shaders/        Six GLSL effects + a common snippet library
  components/
    BeforeAfter.tsx Pointer-driven slider, AI-takeover aware
    EffectStage.tsx R3F canvas, base before/after + layer stack
    EffectLayer.tsx Per-layer shader dispatch
    ui/             ControlPanel, AIStatus
  state/
    store.ts        Zustand: slider, layers, AI telemetry
  App.tsx           Page chrome + AI takeover policy
  main.tsx
  styles.css
```

### Effect → AI signal mapping

| Effect | What the AI drives | Where |
|---|---|---|
| sampling | inference progress → `pixel` shrinks | `mapper.ts:sampling` |
| unfocused | `1 - confidence` → blur at focus point | `mapper.ts:unfocused` |
| burn | job lifecycle → `burn` 0→1 while busy | `mapper.ts:burn` |
| glass | confidence → depth/roughness for gsplat bake preview | `mapper.ts:glass` |
| magnifier | end-of-job "look here" call-out at focus point | `mapper.ts:magnifier` |
| crack | tile arrival → segment count up, strength down | `mapper.ts:crack` |

To change the visual language of the app, edit `mapper.ts`. To change
what an effect *can* do, edit the shader and the props in `types.ts`.

### Slider takeover

The user drags the slider; while dragging, AI takeover is paused
(`sliderDragging` in the store). While the AI is busy and the user is
not dragging, the slider eases to follow `1 - progress * 0.5` so the
"after" side reveals progressively.

## License of references

The six effects are original reimplementations of the visual *idea*
of Jay Ji's Framer "Reveals" components (Sampling / Unfocused / Burn /
Glass / Magnifier / Crack). No code is copied from the marketplace
components; only the property-control vocabulary is mirrored so the
experience is recognizable.

### Style catalog
Film + aesthetic LUT language is maintained in the sibling repo at
`/Users/qbit/dev/imagine/style_presets/` (styles.json + per-preset prompt.txt).
aito vendors a snapshot at `src/data/imagine-presets.json` (see `npm run sync:imagine-presets`
and `src/lib/lutPresets.ts`). Grok apply_lut tool and the LUT dropdown use the same
canonical slugs (e.g. `kodak-portra-400`, `teal-orange-blockbuster`).
