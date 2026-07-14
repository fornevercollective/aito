# ZipDepth sidecar (aito-mac)

Lightweight HTTP depth service for the gsplat booth, inspired by
[ZipDepth](https://github.com/fabiotosi92/ZipDepth) (ECCV 2026).

- **Port:** `127.0.0.1:8766`
- **GET** `/health` → `{ ok, backend, zipdepth }`
- **POST** `/depth` — same binary layout as `jax-sidecar` (u32le w/h + RGB888)

## Backends

| Priority | Backend | How |
|----------|---------|-----|
| 1 | Real ZipDepth (PyTorch) | `ZIPDEPTH_ROOT` + `ZIPDEPTH_CKPT` or clone next to aito-mac |
| 2 | ONNX Runtime | `ZIPDEPTH_ONNX=/path/to/zipdepth.onnx` |
| 3 | **zip-lite** (default) | Multi-scale strip/SPPF-style CPU depth, no ML deps |

```bash
# default zip-lite (always works)
python3 zipdepth-sidecar/booth_zipdepth.py --port 8766

# real ZipDepth after cloning the official repo
export ZIPDEPTH_ROOT=~/dev/ZipDepth
export ZIPDEPTH_CKPT=~/dev/ZipDepth/checkpoints/zipdepth_base_npu.pth
pip install -e "$ZIPDEPTH_ROOT"  # + torch, etc.
python3 zipdepth-sidecar/booth_zipdepth.py
```

`./start.sh` launches this sidecar automatically when the script is present.

## Booth UI

Depth mode **ZipDepth** uses:

1. Sidecar map when `/health` is up (preferred)
2. Client-side multi-scale field (`computeZipDepthField`) otherwise

Params: **ZipDepth scale / detail / strip** under Point cloud & depth.
