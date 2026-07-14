# aito — handoff

Workspace: `~/dev/aito` → **[fornevercollective/aito](https://github.com/fornevercollective/aito)**.  
AI image/video retouching app **+ spatial live booth** in one monorepo.

## Current state (v0.1)

- Everything in v0, plus:
- **Meta SAM segmentation** in-browser (`Xenova/sam-vit-base` via
  `@huggingface/transformers`) with mock flood-fill fallback.
- **Segment panel**: tap-to-mask, auto subject grid (Apple sticker style),
  sticker cutout preview, mask list.
- **Batch panel**: multi-file queue → auto-segment each → demo retouch pass.
- **Python `server/inference_ws.py`**: bidirectional WS; optional real SAM
  when `segment_anything` + checkpoint installed.

## Run (unified launchers)

| Launcher | What |
|----------|------|
| **`Launch.command`** | Photo editor + mock inference |
| **`Launch-Spatial.command`** | Spatial Live booth (`spatial/`) @ :8768 |
| **`Launch-StageForge.command`** | StageForge TUI + roadmap jobs |

From shell:

```bash
./start.sh
npm run spatial          # or ./Launch-Spatial.command
./Launch-StageForge.command
```

Spatial docs: [`spatial/README.md`](./spatial/README.md) · [`spatial/HANDOFF.md`](./spatial/HANDOFF.md)

Classic:

```bash
npm install
npm run dev
npm run mock:server
VITE_AI_WS=ws://localhost:8765 npm run dev
```

Optional GPU SAM on server:

```bash
pip install -r server/requirements-sam.txt
mkdir -p server/checkpoints
curl -L -o server/checkpoints/sam_vit_b.pth \
  https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
python3 server/inference_ws.py
```

## What's next (ordered)

The authoritative list of next steps now lives in `stageforge.yaml` under the `jobs` and `stages` sections. Use **Launch-StageForge.command** to get the TUI with these items as first-class, routable work:

- `masked-corrections` + `brush-refinement` + `sam-matting`
- `hatch-export`
- `bake-commit` + `capture-bake`
- `vwall-pivot` + `lut-mood` (background high-end track)

1. **Inpaint behind mask**: wire mask texture into inference server
   (LaMa / SD inpaint) and set `after` from real output.
2. **gsplat bake → glass**: feed normal/depth map into glass shader.
   Spatial bridge: `src/lib/spatial-depth.ts` + glass mapper reads
   booth hand depth/wave when `window.aitoBoothHand` is present.
   Hand resources: MediaPipe 0.10.35, gesture bus, catalog in
   `spatial/booth/hand-tracking-resources.mjs`.
3. **Video timeline**: frame cache + per-frame SAM keyframes.
4. **Multi-source spatial**: nested sphere/parallax in
   `spatial/booth/` (selection, depth modes, hand → waveform, ffmpeg feeds).

Launch the StageForge TUI to drive the plan iteratively:
```bash
./Launch-StageForge.command
```

## Files worth knowing first

- `src/effects/shaders/` — one shader per file, all small and
  commented. Easy to swap individually.
- `src/data/imagine-presets.json` + `scripts/sync-imagine-presets.mjs` — full support
  for the LUT / style catalog living at sibling `/Users/qbit/dev/imagine/style_presets/`.
- `src/ai/mapper.ts` — the AI-control vocabulary.
- `src/components/EffectLayer.tsx` — the shader dispatcher; lookups
  for enum uniforms (animation type, falloff type, etc.) live here.
- `src/state/store.ts` — full app state surface.

## Run

```bash
npm install
npm run dev
# optional:
VITE_AI_WS=ws://localhost:8765 npm run dev
python3 server/mock_ws.py
```
