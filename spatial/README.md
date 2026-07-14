# aito · Spatial Live

**Canonical home:** [github.com/fornevercollective/aito](https://github.com/fornevercollective/aito) → `spatial/`

gsplat booth + multi-source live feeds + ffmpeg (all codecs / image sequences / FPS) + MediaPipe hands + monocular depth cloud. Formerly developed under `~/dev/aito-mac`; now first-class in the aito monorepo.

## One place

| Piece | Path |
|-------|------|
| Booth UI (gsplat / live / spatial) | `spatial/booth/` |
| Local server + media APIs | `spatial/scripts/serve.mjs` |
| ffmpeg / ffplay / sequences | `spatial/scripts/booth-media.mjs` |
| Native Mac shell (Swift) | `spatial/mac/` |
| ZipDepth sidecar | `spatial/zipdepth-sidecar/` |
| JAX depth sidecar | `spatial/jax-sidecar/` |
| Photo editor (main product) | repo root `src/` |
| Living Canvas research | `versions/living-canvas/` |
| Shared hand → glass bridge | `src/lib/spatial-depth.ts` |

## Run

From **repo root**:

```bash
./Launch-Spatial.command
# or
npm run spatial
# or
AITO_OPEN_BROWSER=1 ./spatial/start.sh
```

Booth: **http://127.0.0.1:8768/booth/**

From this directory:

```bash
./Launch-Web.command
./start.sh
```

### Ports

| Port | Service |
|------|---------|
| **8768** | Spatial booth + `/api/media/*` + `/api/ffmpeg/*` |
| 8767 | JAX depth (optional) |
| 8766 | ZipDepth (optional) |
| 5173 | Photo editor (`./start.sh` at repo root) |

### Media (ffmpeg)

- Any container/codec ffmpeg can demux → browser fMP4 stream
- Image sequences: folder, `frame_%04d.png`, multi-select **Seq**
- FPS presets: 23.976 / 24 / 25 / 29.97 / 30 / 48 / 50 / 59.94 / 60 / 120 …
- External **FFplay** / repel window

```bash
curl -s http://127.0.0.1:8768/api/ffmpeg/status | jq .
curl -s http://127.0.0.1:8768/api/ffmpeg/codecs | jq '.decoders.video|length'
```

## Native Mac app

```bash
cd spatial
# optional: rebuild walker + wasm + xcodegen bundle
./scripts/setup.sh
./scripts/make-app-bundle.sh
```

Swift sources live under `spatial/mac/`. Set `AITO_MAC_ROOT` to this `spatial/` directory when launching the binary.

## Bridge to photo editor

When the booth is open, the editor can read:

- `window.aitoBoothHand` — gestures / depth / wave (via `src/lib/spatial-depth.ts`)
- `window.aitoBoothDepth` — ZipDepth point cloud export

## Legacy path

`~/dev/aito-mac` was the pre-monorepo checkout. Prefer this tree; keep the old folder only as a working copy if needed, then sync changes back here.
