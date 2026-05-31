/**
 * Meta SAM (Segment Anything) via transformers.js in the browser.
 */

import {
  AutoProcessor,
  RawImage,
  SamModel,
  type Tensor,
} from "@huggingface/transformers";
import type { SegmentMask } from "./types";
import { makeSticker, nextMaskId } from "./maskUtils";

const MODEL_ID = "Xenova/sam-vit-base";

type SamProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> & {
  post_process_masks: (
    pred_masks: Tensor,
    original_sizes: unknown,
    reshaped_input_sizes: unknown,
  ) => Promise<Tensor[]>;
};

let model: SamModel | null = null;
let processor: SamProcessor | null = null;
let embedCache: {
  url: string;
  image_embeddings: Tensor;
  image_positional_embeddings: Tensor;
} | null = null;

export type SamLoadState = "idle" | "loading" | "ready" | "error";

let loadState: SamLoadState = "idle";
let loadError: string | null = null;
const listeners = new Set<(s: SamLoadState) => void>();

export function getSamState() {
  return { state: loadState, error: loadError };
}

export function onSamState(cb: (s: SamLoadState) => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function setState(s: SamLoadState, err?: string) {
  loadState = s;
  loadError = err ?? null;
  listeners.forEach((cb) => cb(s));
}

export async function ensureSam(): Promise<boolean> {
  if (loadState === "ready" && model && processor) return true;
  if (loadState === "loading") {
    await new Promise<void>((resolve) => {
      const unsub = onSamState((s) => {
        if (s !== "loading") {
          unsub();
          resolve();
        }
      });
    });
    return getSamState().state === "ready";
  }
  setState("loading");
  try {
    const loaded = (await SamModel.from_pretrained(MODEL_ID, {
      dtype: "fp32",
      device: "webgpu",
    }).catch(() =>
      SamModel.from_pretrained(MODEL_ID, { dtype: "fp32" }),
    )) as SamModel;
    model = loaded;
    processor = (await AutoProcessor.from_pretrained(
      MODEL_ID,
    )) as SamProcessor;
    setState("ready");
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setState("error", msg);
    console.warn("[sam] load failed", e);
    return false;
  }
}

async function getEmbeddings(imageUrl: string) {
  if (!model || !processor) throw new Error("SAM not loaded");
  if (embedCache?.url === imageUrl) return embedCache;

  const raw = await RawImage.read(imageUrl);
  const inputs = await processor(raw);
  const { image_embeddings, image_positional_embeddings } =
    await model.get_image_embeddings(inputs);
  embedCache = {
    url: imageUrl,
    image_embeddings,
    image_positional_embeddings,
  };
  return embedCache;
}

function tensorMaskToDataUrl(
  maskTensor: Tensor,
  maskIndex: number,
  width: number,
  height: number,
): {
  dataUrl: string;
  bbox: SegmentMask["bbox"];
  centroid: SegmentMask["centroid"];
} {
  const [, , h, w] = maskTensor.dims;
  const data = maskTensor.data as Uint8Array | boolean[];
  const plane = maskIndex * h * w;
  const rgba = new Uint8ClampedArray(w * h * 4);
  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0,
    sx = 0,
    sy = 0,
    n = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = plane + y * w + x;
      const on = Boolean(data[i]);
      const pi = (y * w + x) * 4;
      if (on) {
        rgba[pi] = 255;
        rgba[pi + 1] = 255;
        rgba[pi + 2] = 255;
        rgba[pi + 3] = 210;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        sx += x;
        sy += y;
        n++;
      }
    }
  }

  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  small.getContext("2d")!.putImageData(new ImageData(rgba, w, h), 0, 0);
  ctx.drawImage(small, 0, 0, width, height);

  return {
    dataUrl: c.toDataURL("image/png"),
    bbox: {
      x: minX / w,
      y: minY / h,
      w: (maxX - minX + 1) / w,
      h: (maxY - minY + 1) / h,
    },
    centroid: {
      x: n ? sx / n / w : 0.5,
      y: n ? sy / n / h : 0.5,
    },
  };
}

export async function segmentAtPoint(
  imageUrl: string,
  nx: number,
  ny: number,
): Promise<SegmentMask | null> {
  const ok = await ensureSam();
  if (!ok || !model || !processor) return null;

  const raw = await RawImage.read(imageUrl);
  const w = raw.width;
  const h = raw.height;
  const px = Math.round(nx * w);
  const py = Math.round(ny * h);

  const inputs = await processor(raw, {
    input_points: [[[px, py]]],
    input_labels: [[[1]]],
  });

  const embed = await getEmbeddings(imageUrl);
  const outputs = await model({
    ...inputs,
    image_embeddings: embed.image_embeddings,
    image_positional_embeddings: embed.image_positional_embeddings,
  });

  const masks = await processor.post_process_masks(
    outputs.pred_masks,
    inputs.original_sizes,
    inputs.reshaped_input_sizes,
  );
  const scores = outputs.iou_scores.data as Float32Array;
  let best = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i]! > scores[best]!) best = i;
  }

  const { dataUrl, bbox, centroid } = tensorMaskToDataUrl(
    masks[0]!,
    best,
    w,
    h,
  );
  const stickerUrl = await makeSticker(imageUrl, dataUrl);

  return {
    id: nextMaskId(),
    label: "sam",
    dataUrl,
    bbox,
    centroid,
    score: scores[best] ?? 0.9,
    selected: true,
    stickerUrl,
  };
}

export async function autoSegmentSubjects(
  imageUrl: string,
  maxMasks = 6,
): Promise<SegmentMask[]> {
  const ok = await ensureSam();
  if (!ok || !model || !processor) return [];

  const raw = await RawImage.read(imageUrl);
  const w = raw.width;
  const h = raw.height;
  const embed = await getEmbeddings(imageUrl);

  const grid = 4;
  const results: SegmentMask[] = [];

  for (let gy = 1; gy < grid; gy++) {
    for (let gx = 1; gx < grid; gx++) {
      const px = Math.round((gx / grid) * w);
      const py = Math.round((gy / grid) * h);
      const inputs = await processor(raw, {
        input_points: [[[px, py]]],
        input_labels: [[[1]]],
      });
      const outputs = await model({
        ...inputs,
        image_embeddings: embed.image_embeddings,
        image_positional_embeddings: embed.image_positional_embeddings,
      });
      const masks = await processor.post_process_masks(
        outputs.pred_masks,
        inputs.original_sizes,
        inputs.reshaped_input_sizes,
      );
      const scores = outputs.iou_scores.data as Float32Array;
      let best = 0;
      for (let i = 1; i < scores.length; i++) {
        if (scores[i]! > scores[best]!) best = i;
      }
      if ((scores[best] ?? 0) < 0.75) continue;

      const { dataUrl, bbox, centroid } = tensorMaskToDataUrl(
        masks[0]!,
        best,
        w,
        h,
      );
      if (bbox.w * bbox.h < 0.02) continue;

      const dup = results.some(
        (r) =>
          Math.abs(r.centroid.x - centroid.x) < 0.08 &&
          Math.abs(r.centroid.y - centroid.y) < 0.08,
      );
      if (dup) continue;

      const stickerUrl = await makeSticker(imageUrl, dataUrl);
      results.push({
        id: nextMaskId(),
        label: `subject ${results.length + 1}`,
        dataUrl,
        bbox,
        centroid,
        score: scores[best] ?? 0.8,
        selected: true,
        stickerUrl,
      });
      if (results.length >= maxMasks) return results;
    }
  }
  return results;
}

export function clearSamCache() {
  embedCache = null;
}
