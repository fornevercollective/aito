"""Inference + SAM WebSocket server for aito.

Bidirectional: receives segment / batch_retouch commands from the
frontend, returns masks + retouch progress.

Optional Meta SAM (segment_anything) when installed:
    pip install -r server/requirements-sam.txt
    # download checkpoint to server/checkpoints/sam_vit_b.pth

Without SAM, uses a lightweight flood-fill mock so the wire protocol
still works end-to-end.

Run:
    python3 server/inference_ws.py
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import random
import sys
import urllib.request
from dataclasses import dataclass
from typing import Any

try:
    import websockets
except ImportError:
    print("pip install websockets", file=sys.stderr)
    raise

try:
    from PIL import Image
except ImportError:
    print("pip install pillow", file=sys.stderr)
    raise

HAS_SAM = False
sam_predictor = None

try:
    import numpy as np
    import torch
    from segment_anything import SamPredictor, sam_model_registry

    CKPT = "server/checkpoints/sam_vit_b.pth"
    if __import__("os").path.isfile(CKPT):
        sam = sam_model_registry["vit_b"](checkpoint=CKPT)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        sam.to(device=device)
        sam_predictor = SamPredictor(sam)
        HAS_SAM = True
        print(f"[sam] loaded vit_b on {device}")
    else:
        print(f"[sam] no checkpoint at {CKPT} — using mock segmenter")
except Exception as e:
    print(f"[sam] unavailable ({e}) — using mock segmenter")


def load_image(url: str) -> Image.Image:
    if url.startswith("data:"):
        _, b64 = url.split(",", 1)
        return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    with urllib.request.urlopen(url, timeout=30) as resp:
        return Image.open(io.BytesIO(resp.read())).convert("RGB")


def mask_to_data_url(mask: "np.ndarray", w: int, h: int) -> str:
    import numpy as np

    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    m = np.array(Image.fromarray(mask.astype(np.uint8) * 255).resize((w, h), Image.NEAREST))
    on = m > 127
    rgba[on, 0:3] = 255
    rgba[on, 3] = 210
    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def bbox_centroid(mask: "np.ndarray", w: int, h: int) -> tuple[dict, dict]:
    import numpy as np

    ys, xs = np.where(mask)
    if len(xs) == 0:
        return {"x": 0, "y": 0, "w": 0, "h": 0}, {"x": 0.5, "y": 0.5}
    min_x, max_x = int(xs.min()), int(xs.max())
    min_y, max_y = int(ys.min()), int(ys.max())
    bbox = {
        "x": min_x / w,
        "y": min_y / h,
        "w": (max_x - min_x + 1) / w,
        "h": (max_y - min_y + 1) / h,
    }
    centroid = {"x": float(xs.mean() / w), "y": float(ys.mean() / h)}
    return bbox, centroid


def mock_segment(img: Image.Image, nx: float, ny: float) -> dict[str, Any]:
    import numpy as np

    arr = np.array(img)
    h, w = arr.shape[:2]
    sx, sy = int(nx * w), int(ny * h)
    sx = max(0, min(w - 1, sx))
    sy = max(0, min(h - 1, sy))
    target = arr[sy, sx].astype(int)
    mask = np.zeros((h, w), dtype=bool)
    stack = [(sx, sy)]
    tol = 42
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h or mask[y, x]:
            continue
        px = arr[y, x].astype(int)
        if abs(px - target).sum() > tol * 3:
            continue
        mask[y, x] = True
        stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    bbox, centroid = bbox_centroid(mask, w, h)
    return {
        "dataUrl": mask_to_data_url(mask, w, h),
        "bbox": bbox,
        "centroid": centroid,
        "score": 0.55,
        "label": "mock",
    }


def sam_point(img: Image.Image, nx: float, ny: float) -> dict[str, Any]:
    import numpy as np

    w, h = img.size
    if not HAS_SAM or sam_predictor is None:
        return mock_segment(img, nx, ny)
    arr = np.array(img)
    sam_predictor.set_image(arr)
    px, py = nx * w, ny * h
    masks, scores, _ = sam_predictor.predict(
        point_coords=np.array([[px, py]]),
        point_labels=np.array([1]),
        multimask_output=True,
    )
    best = int(scores.argmax())
    mask = masks[best]
    bbox, centroid = bbox_centroid(mask, w, h)
    return {
        "dataUrl": mask_to_data_url(mask, w, h),
        "bbox": bbox,
        "centroid": centroid,
        "score": float(scores[best]),
        "label": "sam",
    }


def sam_auto(img: Image.Image, max_masks: int = 6) -> list[dict[str, Any]]:
    w, h = img.size
    out: list[dict[str, Any]] = []
    grid = 4
    for gy in range(1, grid):
        for gx in range(1, grid):
            m = sam_point(img, gx / grid, gy / grid)
            if m["score"] < 0.5:
                continue
            if m["bbox"]["w"] * m["bbox"]["h"] < 0.02:
                continue
            dup = any(
                abs(m["centroid"]["x"] - o["centroid"]["x"]) < 0.08
                and abs(m["centroid"]["y"] - o["centroid"]["y"]) < 0.08
                for o in out
            )
            if dup:
                continue
            m["label"] = f"subject {len(out) + 1}"
            out.append(m)
            if len(out) >= max_masks:
                return out
    return out


async def handle_segment(ws, msg: dict) -> None:
    url = msg["imageUrl"]
    img = await asyncio.to_thread(load_image, url)
    if msg.get("mode") == "auto":
        masks = await asyncio.to_thread(sam_auto, img)
        await ws.send(json.dumps({"type": "segments", "masks": masks}))
        return
    nx = float(msg.get("x", 0.5))
    ny = float(msg.get("y", 0.5))
    m = await asyncio.to_thread(sam_point, img, nx, ny)
    await ws.send(json.dumps({"type": "mask", **m}))


async def handle_batch(ws, msg: dict) -> None:
    item_id = msg["itemId"]
    url = msg["imageUrl"]
    await ws.send(
        json.dumps(
            {"type": "batch_progress", "itemId": item_id, "progress": 0.1, "status": "segmenting"}
        )
    )
    img = await asyncio.to_thread(load_image, url)
    masks = await asyncio.to_thread(sam_auto, img)
    await ws.send(
        json.dumps(
            {"type": "batch_progress", "itemId": item_id, "progress": 0.5, "status": "retouching"}
        )
    )
    await asyncio.sleep(0.5)
    # Demo retouch: echo source as after (plug inpaint model here)
    await ws.send(
        json.dumps(
            {
                "type": "batch_progress",
                "itemId": item_id,
                "progress": 1.0,
                "status": "done",
                "after": url,
            }
        )
    )
    if masks:
        await ws.send(json.dumps({"type": "segments", "masks": masks}))


async def telemetry_loop(ws) -> None:
    """Background inference telemetry (same as mock_ws)."""
    await ws.send(json.dumps({"type": "hello", "runId": f"srv-{random.randint(1000, 9999)}"}))
    while True:
        await ws.send(json.dumps({"type": "status", "status": "idle", "busy": False}))
        await asyncio.sleep(5)


async def handler(ws) -> None:
    telem = asyncio.create_task(telemetry_loop(ws))
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            t = msg.get("type")
            if t == "segment":
                await handle_segment(ws, msg)
            elif t == "batch_retouch":
                await handle_batch(ws, msg)
    except websockets.ConnectionClosed:
        pass
    finally:
        telem.cancel()


async def main() -> None:
    port = 8765
    print(f"[inference] ws://localhost:{port} sam={HAS_SAM}")
    async with websockets.serve(handler, "localhost", port):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
