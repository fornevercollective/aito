# aito spatial live — handoff

**Repo:** [fornevercollective/aito](https://github.com/fornevercollective/aito)  
**Path:** `spatial/` (was `~/dev/aito-mac`)

## What lives here

Mac / localhost **spatial live** booth: gsplat point cloud + MediaPipe live IK + multi-source feeds + ffmpeg media pipeline + depth sidecars.

## Run

```bash
# monorepo root
./Launch-Spatial.command
npm run spatial

# or
cd spatial && AITO_OPEN_BROWSER=1 ./start.sh
```

→ http://127.0.0.1:8768/booth/

## Layout

```
spatial/
  booth/                 # gsplat-booth.js + live modules
  scripts/serve.mjs      # static + X resolve + media/ffmpeg APIs
  scripts/booth-media.mjs
  jax-sidecar/
  zipdepth-sidecar/
  mac/                   # Swift AitoMac sources
  walker/                # aito-walk source (build optional)
  wasm/                  # booth_modulator
  start.sh
  Launch-Web.command
```

## Shared with editor

- `src/lib/spatial-depth.ts` — hand → glass uniforms when booth is open
- `window.aitoBoothHand` / `window.aitoBoothDepth`

## Current capabilities

- Live cameras (Desktop / Continuity / Dual)
- Live feeds: X, YT, Twitch, HLS, mp4, **MKV/all codecs**, **image sequences**, **FPS override**
- Hand tracking (MediaPipe) + spatial resources catalog
- ZipDepth → spatial point cloud layer
- FFplay / repel external play

## Next

1. Keep booth edits only under `spatial/` (not a parallel aito-mac tree)
2. Optional: hub page card linking Spatial Live
3. Optional: CI smoke for `/api/ffmpeg/status`
4. Re-bundle Mac app after booth edits: `spatial/scripts/make-app-bundle.sh`
