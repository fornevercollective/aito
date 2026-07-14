#!/usr/bin/env python3
"""Optional JAX depth-lift sidecar — HTTP on 127.0.0.1:8767.

Falls back to luminance depth when JAX is not installed.
"""
from __future__ import annotations

import argparse
import json
import struct
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8767


def luminance_depth(rgb: bytes, w: int, h: int) -> list[float]:
    out: list[float] = []
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 3
            r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
            lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255.0
            nx, ny = x / max(1, w - 1), y / max(1, h - 1)
            radial = ((nx - 0.5) ** 2 + (ny - 0.42) ** 2) ** 0.5
            out.append((1.0 - radial * 1.1) * 0.55 + lum * 0.3 + (1.0 - ny) * 0.2)
    return out


def jax_depth(rgb: bytes, w: int, h: int) -> list[float]:
    try:
        import jax.numpy as jnp
        import numpy as np

        arr = np.frombuffer(rgb, dtype=np.uint8).reshape(h, w, 3).astype(np.float32) / 255.0
        lum = arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114
        yy, xx = jnp.mgrid[0:h, 0:w]
        nx = xx / max(1, w - 1)
        ny = yy / max(1, h - 1)
        radial = jnp.sqrt((nx - 0.5) ** 2 + (ny - 0.42) ** 2)
        depth = (1.0 - radial * 1.1) * 0.55 + lum * 0.3 + (1.0 - ny) * 0.2
        # light smooth (cheap stand-in for a depth model)
        depth = jnp.pad(depth, ((1, 1), (1, 1)), mode="edge")
        depth = (
            depth[:-2, :-2]
            + depth[1:-1, :-2]
            + depth[2:, :-2]
            + depth[:-2, 1:-1]
            + depth[1:-1, 1:-1]
            + depth[2:, 1:-1]
            + depth[:-2, 2:]
            + depth[1:-1, 2:]
            + depth[2:, 2:]
        ) / 9.0
        return depth.reshape(-1).tolist()
    except ImportError:
        return luminance_depth(rgb, w, h)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_error(404)
            return
        body = json.dumps({"ok": True, "jax": _jax_available()}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
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
        rgb = raw[8:]
        if len(rgb) < w * h * 3:
            self.send_error(400, "rgb payload too small")
            return
        depth = jax_depth(rgb, w, h)
        body = json.dumps({"w": w, "h": h, "depth": depth, "backend": "jax" if _jax_available() else "lum"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _jax_available() -> bool:
    try:
        import jax  # noqa: F401

        return True
    except ImportError:
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"aito-booth-jax listening on http://127.0.0.1:{args.port}/health", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()