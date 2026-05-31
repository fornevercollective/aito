"""Tiny stand-in inference server.

Emits the same message shape the frontend expects on
`src/ai/channel.ts` (`AiMessage`). Runs a synthetic job cycle so a
developer who doesn't have a real model wired up can still see the
WS path light up green in the AI status pill.

Run:
    pip install websockets
    python3 server/mock_ws.py

Then in another shell:
    VITE_AI_WS=ws://localhost:8765 npm run dev
"""

from __future__ import annotations

import asyncio
import json
import random
import sys

try:
    import websockets
except ImportError:
    print("pip install websockets", file=sys.stderr)
    raise


async def cycle(ws):
    await ws.send(json.dumps({"type": "hello", "runId": f"mock-{random.randint(1000, 9999)}"}))
    while True:
        focus = {"x": round(random.uniform(0.25, 0.75), 3),
                 "y": round(random.uniform(0.25, 0.75), 3)}
        await ws.send(json.dumps({"type": "status", "status": "queuing", "busy": True}))
        await ws.send(json.dumps({"type": "focus", **focus}))
        await ws.send(json.dumps({"type": "tiles", "ready": 0, "total": 16}))
        await ws.send(json.dumps({"type": "confidence", "confidence": 0.2}))
        await asyncio.sleep(0.4)

        for i in range(1, 17):
            await ws.send(json.dumps({"type": "status", "status": "inferring", "busy": True}))
            await ws.send(json.dumps({"type": "progress", "progress": i / 16}))
            await ws.send(json.dumps({"type": "tiles", "ready": i, "total": 16}))
            await ws.send(json.dumps({"type": "confidence", "confidence": min(1.0, 0.2 + (i / 16) * 0.8)}))
            await asyncio.sleep(0.45)

        await ws.send(json.dumps({"type": "status", "status": "stitching", "busy": True}))
        await asyncio.sleep(0.6)
        await ws.send(json.dumps({"type": "status", "status": "idle", "busy": False}))
        await ws.send(json.dumps({"type": "confidence", "confidence": 1.0}))
        await asyncio.sleep(3.0)


async def handler(ws):
    try:
        await cycle(ws)
    except Exception as e:
        print(f"[mock] client disconnected: {e}")


async def main():
    port = 8765
    print(f"[mock] ws://localhost:{port}")
    async with websockets.serve(handler, "localhost", port):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
