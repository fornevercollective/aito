/**
 * Unified segmentation API: tries SAM in-browser, falls back to mock
 * flood-fill, and can delegate to the Python inference server when live.
 */

import { sendWsCommand } from "@/ai/channel";
import type {
  BatchItem,
  SegmentBackend,
  SegmentMask,
} from "./types";
import {
  autoSegmentSubjects,
  clearSamCache,
  ensureSam,
  getSamState,
  onSamState,
  segmentAtPoint,
} from "./sam";
import { mockSegmentAt } from "./maskUtils";

export { ensureSam, getSamState, onSamState, clearSamCache };

export async function segmentTap(
  imageUrl: string,
  x: number,
  y: number,
  backend: SegmentBackend,
): Promise<SegmentMask | null> {
  if (backend === "server") {
    sendWsCommand({
      type: "segment",
      imageUrl,
      x,
      y,
      mode: "point",
    });
    return null; // mask arrives async via WS
  }
  if (backend === "sam") {
    const m = await segmentAtPoint(imageUrl, x, y);
    if (m) return m;
  }
  return mockSegmentAt(imageUrl, x, y);
}

export async function segmentAuto(
  imageUrl: string,
  backend: SegmentBackend,
): Promise<SegmentMask[]> {
  if (backend === "server") {
    sendWsCommand({ type: "segment", imageUrl, mode: "auto" });
    return [];
  }
  if (backend === "sam") {
    const masks = await autoSegmentSubjects(imageUrl);
    if (masks.length) return masks;
  }
  // Mock: 3 taps in a rough grid
  const pts = [
    [0.35, 0.4],
    [0.55, 0.55],
    [0.7, 0.35],
  ] as const;
  const out: SegmentMask[] = [];
  for (const [x, y] of pts) {
    out.push(await mockSegmentAt(imageUrl, x, y));
  }
  return out;
}

/** Process a batch queue item: auto-mask then request retouch. */
export async function processBatchItem(
  item: BatchItem,
  backend: SegmentBackend,
  onProgress: (p: number, status: BatchItem["status"]) => void,
): Promise<{ segments: SegmentMask[]; after?: string }> {
  onProgress(0.1, "segmenting");
  const segments = await segmentAuto(item.before, backend);
  onProgress(0.5, "retouching");

  if (backend === "server") {
    sendWsCommand({
      type: "batch_retouch",
      itemId: item.id,
      imageUrl: item.before,
      maskIds: segments.map((s) => s.id),
    });
    onProgress(0.9, "retouching");
    return { segments };
  }

  // Demo: use sticker as pseudo "after" for batch preview
  const after = segments[0]?.stickerUrl ?? item.before;
  onProgress(1, "done");
  return { segments, after };
}
