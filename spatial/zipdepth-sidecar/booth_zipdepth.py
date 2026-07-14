#!/usr/bin/env python3
"""Optional ZipDepth monocular-depth sidecar — HTTP on 127.0.0.1:8766.

Inspired by fabiotosi92/ZipDepth (ECCV 2026, ~6.1M zero-shot monocular depth).

Backends (first available wins):
  1. Real ZipDepth via torch + checkpoint (ZIPDEPTH_CKPT / ZIPDEPTH_ROOT)
  2. ONNX Runtime if ZIPDEPTH_ONNX points to an exported .onnx
  3. Lightweight multi-scale fallback (strip pool + SPPF-ish) — no deps

Binary POST /depth  (same layout as jax-sidecar):
  uint32le width, uint32le height, then RGB888 payload
JSON response: { w, h, depth: float[], backend: str }
GET /health → { ok, backend, zipdepth: bool }
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8766

_backend_name = "zip-lite"
_model = None  # torch model or onnx session
_predictor = None


def _env_path(key: str) -> Path | None:
    v = os.environ.get(key, "").strip()
    return Path(v).expanduser() if v else None


def _try_load_torch_zipdepth() -> bool:
    """Load real ZipDepth if package + checkpoint available."""
    global _model, _predictor, _backend_name
    ckpt = _env_path("ZIPDEPTH_CKPT")
    root = _env_path("ZIPDEPTH_ROOT")
    if root and (root / "zipdepth").is_dir():
        sys.path.insert(0, str(root))
    # also allow sibling clone
    for cand in (
        root,
        Path.home() / "dev" / "ZipDepth",
        Path(__file__).resolve().parents[2] / "ZipDepth",
    ):
        if cand and (Path(cand) / "zipdepth").is_dir():
            p = str(Path(cand))
            if p not in sys.path:
                sys.path.insert(0, p)
            if ckpt is None:
                for name in ("zipdepth_base_npu.pth", "zipdepth_base.pth"):
                    c = Path(cand) / "checkpoints" / name
                    if c.is_file():
                        ckpt = c
                        break

    if ckpt is None or not Path(ckpt).is_file():
        return False
    try:
        import numpy as np  # noqa: F401
        import torch
        from zipdepth.inference.predictor import DepthInference
    except ImportError:
        return False

    device = "cuda" if torch.cuda.is_available() else "cpu"
    # MPS on Apple Silicon
    if device == "cpu" and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"
    npu = "npu" in Path(ckpt).name.lower()
    try:
        _predictor = DepthInference(
            checkpoint_path=str(ckpt),
            variant="base",
            device=device if device != "mps" else "cpu",  # predictor often cuda/cpu only
            use_half=False,
            use_compile=False,
            input_size=int(os.environ.get("ZIPDEPTH_INPUT_SIZE", "256")),
            warmup_iters=1,
            upsample_unfold=not npu,
        )
        _backend_name = f"zipdepth-torch-{device}"
        return True
    except Exception as e:
        print(f"zipdepth-sidecar: torch load failed: {e}", flush=True)
        _predictor = None
        return False


def _try_load_onnx() -> bool:
    global _model, _backend_name
    onnx_path = _env_path("ZIPDEPTH_ONNX")
    if onnx_path is None:
        for cand in (
            Path.home() / "dev" / "ZipDepth" / "checkpoints" / "zipdepth_base_npu.onnx",
            Path(__file__).resolve().parent / "models" / "zipdepth.onnx",
        ):
            if cand.is_file():
                onnx_path = cand
                break
    if onnx_path is None or not Path(onnx_path).is_file():
        return False
    try:
        import numpy as np  # noqa: F401
        import onnxruntime as ort
    except ImportError:
        return False
    try:
        providers = ["CPUExecutionProvider"]
        avail = ort.get_available_providers()
        if "CoreMLExecutionProvider" in avail:
            providers.insert(0, "CoreMLExecutionProvider")
        if "CUDAExecutionProvider" in avail:
            providers.insert(0, "CUDAExecutionProvider")
        _model = ort.InferenceSession(str(onnx_path), providers=providers)
        _backend_name = "zipdepth-onnx"
        return True
    except Exception as e:
        print(f"zipdepth-sidecar: onnx load failed: {e}", flush=True)
        _model = None
        return False


def init_backend() -> str:
    if _try_load_torch_zipdepth():
        return _backend_name
    if _try_load_onnx():
        return _backend_name
    _backend_name = "zip-lite"
    return _backend_name


def zip_lite_depth(rgb: bytes, w: int, h: int) -> list[float]:
    """Multi-scale monocular depth without ML deps (ZipDepth architecture cues)."""
    try:
        import numpy as np
    except ImportError:
        return _pure_lite(rgb, w, h)

    arr = np.frombuffer(rgb, dtype=np.uint8).reshape(h, w, 3).astype(np.float32) / 255.0
    lum = arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114

    def box(a: "np.ndarray", r: int) -> "np.ndarray":
        if r <= 0:
            return a
        k = 2 * r + 1
        pad = np.pad(a, ((r, r), (r, r)), mode="edge")
        # separable sum via cumsum
        cs = np.cumsum(np.cumsum(pad, axis=0), axis=1)
        # integral image trick
        out = np.zeros_like(a)
        for y in range(h):
            y0, y1 = y, y + k
            for x in range(w):
                x0, x1 = x, x + k
                s = cs[y1, x1]
                if y0 > 0:
                    s -= cs[y0 - 1, x1]
                if x0 > 0:
                    s -= cs[y1, x0 - 1]
                if y0 > 0 and x0 > 0:
                    s += cs[y0 - 1, x0 - 1]
                out[y, x] = s / (k * k)
        return out

    # Faster path: use scipy if present, else simple convolution-ish
    try:
        from numpy.lib.stride_tricks import sliding_window_view

        def box_fast(a: "np.ndarray", r: int) -> "np.ndarray":
            if r <= 0:
                return a
            k = 2 * r + 1
            pad = np.pad(a, ((r, r), (r, r)), mode="edge")
            # row
            win = sliding_window_view(pad, k, axis=1).mean(axis=-1)
            # col — win is (h+2r, w)
            win2 = sliding_window_view(win, k, axis=0).mean(axis=-1)
            return win2.astype(np.float32)

        box = box_fast  # type: ignore
    except Exception:
        pass

    b1 = box(lum, 1)
    b2 = box(b1, 2)
    b4 = box(b2, 2)
    detail = np.abs(lum - b2)
    gy, gx = np.gradient(lum)
    grad = np.hypot(gx, gy) * 0.5
    row_m = lum.mean(axis=1, keepdims=True)
    col_m = lum.mean(axis=0, keepdims=True)
    strip = np.abs(lum - row_m) * 0.55 + np.abs(lum - col_m) * 0.45
    multi = np.abs(b1 - b2) * 0.45 + np.abs(b2 - b4) * 0.55

    yy, xx = np.mgrid[0:h, 0:w]
    nx = xx / max(1, w - 1)
    ny = yy / max(1, h - 1)
    radial = np.sqrt((nx - 0.5) ** 2 + (ny - 0.42) ** 2)
    base = (1.0 - radial * 0.95) * 0.32 + (1.0 - lum) * 0.22 + (1.0 - ny) * 0.14 + b4 * 0.08
    d = base + detail * 0.55 * 0.85 + multi * 0.55 + grad * 0.55 * 0.4 + strip * 0.4 * 0.5

    dmin, dmax = float(d.min()), float(d.max())
    d = 0.05 + (d - dmin) / max(1e-5, dmax - dmin) * 1.05
    return d.reshape(-1).astype(np.float32).tolist()


def _pure_lite(rgb: bytes, w: int, h: int) -> list[float]:
    out: list[float] = []
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 3
            r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
            lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255.0
            nx, ny = x / max(1, w - 1), y / max(1, h - 1)
            radial = ((nx - 0.5) ** 2 + (ny - 0.42) ** 2) ** 0.5
            out.append((1.0 - radial * 0.95) * 0.45 + (1.0 - lum) * 0.35 + (1.0 - ny) * 0.2)
    return out


def torch_depth(rgb: bytes, w: int, h: int) -> list[float]:
    import cv2
    import numpy as np

    arr = np.frombuffer(rgb, dtype=np.uint8).reshape(h, w, 3)
    bgr = arr[:, :, ::-1].copy()
    depth = _predictor.infer_image(bgr)
    d = depth.astype(np.float32)
    dmin, dmax = float(d.min()), float(d.max())
    d = 0.05 + (d - dmin) / max(1e-5, dmax - dmin) * 1.05
    if d.shape != (h, w):
        d = cv2.resize(d, (w, h), interpolation=cv2.INTER_LINEAR)
    return d.reshape(-1).tolist()


def onnx_depth(rgb: bytes, w: int, h: int) -> list[float]:
    import numpy as np

    arr = np.frombuffer(rgb, dtype=np.uint8).reshape(h, w, 3).astype(np.float32) / 255.0
    # NCHW — common ZipDepth export size; resize to session input
    inp = _model.get_inputs()[0]
    shape = inp.shape  # e.g. [1,3,H,W]
    th = int(shape[2]) if isinstance(shape[2], int) else 384
    tw = int(shape[3]) if isinstance(shape[3], int) else 384
    try:
        import cv2

        resized = cv2.resize(arr, (tw, th), interpolation=cv2.INTER_LINEAR)
    except ImportError:
        # nearest-neighbor fallback
        ys = (np.linspace(0, h - 1, th)).astype(np.int32)
        xs = (np.linspace(0, w - 1, tw)).astype(np.int32)
        resized = arr[ys][:, xs]
    tensor = resized.transpose(2, 0, 1)[None, ...]  # 1,3,H,W
    name = inp.name
    out = _model.run(None, {name: tensor})[0]
    d = np.asarray(out, dtype=np.float32).squeeze()
    try:
        import cv2

        d = cv2.resize(d, (w, h), interpolation=cv2.INTER_LINEAR)
    except ImportError:
        # crude upsample via repeat
        d = np.kron(d, np.ones((max(1, h // d.shape[0]), max(1, w // d.shape[1])), np.float32))
        d = d[:h, :w]
    dmin, dmax = float(d.min()), float(d.max())
    d = 0.05 + (d - dmin) / max(1e-5, dmax - dmin) * 1.05
    return d.reshape(-1).tolist()


def compute_depth(rgb: bytes, w: int, h: int) -> tuple[list[float], str]:
    if _predictor is not None:
        try:
            return torch_depth(rgb, w, h), _backend_name
        except Exception as e:
            print(f"zipdepth-sidecar: torch infer failed: {e}", flush=True)
    if _model is not None:
        try:
            return onnx_depth(rgb, w, h), _backend_name
        except Exception as e:
            print(f"zipdepth-sidecar: onnx infer failed: {e}", flush=True)
    return zip_lite_depth(rgb, w, h), "zip-lite"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path not in ("/health", "/"):
            self.send_error(404)
            return
        body = json.dumps(
            {
                "ok": True,
                "backend": _backend_name,
                "zipdepth": _backend_name.startswith("zipdepth"),
                "port": PORT,
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/depth":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        if len(raw) < 8:
            self.send_error(400, "need width+height header bytes")
            return
        w, h = struct.unpack("<II", raw[:8])
        if w <= 0 or h <= 0 or w * h > 4_000_000:
            self.send_error(400, "invalid dimensions")
            return
        rgb = raw[8:]
        if len(rgb) < w * h * 3:
            self.send_error(400, "rgb payload too small")
            return
        depth, backend = compute_depth(rgb[: w * h * 3], w, h)
        body = json.dumps({"w": w, "h": h, "depth": depth, "backend": backend}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    global PORT
    parser = argparse.ArgumentParser(description="aito-mac ZipDepth depth sidecar")
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    PORT = args.port
    backend = init_backend()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(
        f"aito-booth-zipdepth listening on http://127.0.0.1:{args.port}/health  backend={backend}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
