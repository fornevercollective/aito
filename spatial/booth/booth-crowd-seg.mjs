/**
 * Crowd / dense-scene person segmentation fine-tunes.
 *
 * Selfie segmenter alone fails on elevated multi-cam (spire / plaza): many
 * small people + heavy motion. This module fuses:
 *
 *  - Multi-scale tiled re-seg (DBFace-style small-target pyramid)
 *  - FaceDetector full-range seeds → body ellipses (DBFace / small faces)
 *  - Motion residual mask (DeepLabCut multi-animal temporal idea)
 *  - Optional TF.js BodyPix multi-person (@tensorflow-models/body-segmentation)
 *  - Hand/pose micro-boost (InterHand2.6M-inspired local density)
 *  - Temporal EMA + small-blob amplification
 *
 * Refs:
 *  https://github.com/daitomanabe/DBFace
 *  https://blog.tensorflow.org/2022/01/body-segmentation.html
 *  https://github.com/facebookresearch/InterHand2.6M
 *  https://github.com/DeepLabCut/DeepLabCut
 */

import { FaceDetector } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm";
import { MEDIAPIPE } from "./hand-tracking-resources.mjs";

export const CROWD_SEG_PARAMS = {
  crowdSegEnable: {
    min: 0,
    max: 1,
    step: 1,
    value: 1,
    label: "Crowd multi-scale seg",
    group: "mask",
  },
  crowdFaceSeed: {
    min: 0,
    max: 1,
    step: 1,
    value: 1,
    label: "DBFace-style face seeds",
    group: "mask",
  },
  crowdMotion: {
    min: 0,
    max: 1,
    step: 1,
    value: 1,
    label: "Motion residual mask",
    group: "mask",
  },
  crowdTiles: {
    min: 0,
    max: 1,
    step: 1,
    value: 1,
    label: "Multi-scale tiles",
    group: "mask",
  },
  crowdBodyPix: {
    min: 0,
    max: 1,
    step: 1,
    value: 0,
    label: "TF BodyPix multi-person",
    group: "mask",
  },
  crowdTemporal: {
    min: 0,
    max: 0.95,
    step: 0.05,
    value: 0.55,
    label: "Temporal mask smooth",
    group: "mask",
  },
  crowdFaceScale: {
    min: 1.5,
    max: 6,
    step: 0.1,
    value: 3.2,
    label: "Face→body scale",
    group: "mask",
  },
  crowdMinBlob: {
    min: 0.05,
    max: 0.6,
    step: 0.02,
    value: 0.18,
    label: "Small-blob boost thr",
    group: "mask",
  },
  crowdMotionGain: {
    min: 0,
    max: 2,
    step: 0.05,
    value: 0.85,
    label: "Motion mask gain",
    group: "mask",
  },
};

/** Full-range face detector — better for distant / small faces than short-range. */
const FACE_DET_FULL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
// Prefer full-range when available (falls back to short-range)
const FACE_DET_CANDIDATES = [
  "https://storage.googleapis.com/mediapipe-models/face_detector/face_detection_full_range/float16/1/face_detection_full_range.tflite",
  "https://storage.googleapis.com/mediapipe-models/face_detector/face_detection_full_range_sparse/float16/1/face_detection_full_range_sparse.tflite",
  FACE_DET_FULL,
];

const BODYPIX_CDN = "https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.2/+esm";
const TFJS_CDN = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/+esm";

/**
 * @typedef {{
 *   faces?: number,
 *   tiles?: number,
 *   motionFrac?: number,
 *   bodyPix?: boolean,
 *   mode?: string,
 *   ms?: number,
 * }} CrowdSegStats
 */

export class CrowdSegmenter {
  constructor(params) {
    this.params = params;
    /** @type {any} */
    this.faceDet = null;
    this.faceReady = false;
    this.faceError = null;
    this._faceLoading = null;
    /** @type {Float32Array | null} */
    this._prevGray = null;
    /** @type {Float32Array | null} */
    this._ema = null;
    /** @type {HTMLCanvasElement | null} */
    this._tileCanvas = null;
    /** @type {CanvasRenderingContext2D | null} */
    this._tileCtx = null;
    /** @type {any} */
    this.bodyPix = null;
    this.bodyPixReady = false;
    this.bodyPixError = null;
    this._bodyPixLoading = null;
    /** @type {CrowdSegStats} */
    this.lastStats = { mode: "idle" };
    this.frame = 0;
  }

  get enabled() {
    return (this.params.crowdSegEnable?.value ?? 1) >= 0.5;
  }

  /**
   * @param {import('@mediapipe/tasks-vision').FilesetResolver | any} fileset
   */
  async initFaceDetector(fileset) {
    if (this.faceReady && this.faceDet) return this.faceDet;
    if (this._faceLoading) return this._faceLoading;
    this._faceLoading = (async () => {
      let lastErr = null;
      for (const modelAssetPath of FACE_DET_CANDIDATES) {
        try {
          const det = await FaceDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath, delegate: "GPU" },
            runningMode: "IMAGE",
            minDetectionConfidence: 0.25,
            minSuppressionThreshold: 0.2,
          });
          this.faceDet = det;
          this.faceReady = true;
          this.faceError = null;
          return det;
        } catch (e) {
          lastErr = e;
          try {
            const det = await FaceDetector.createFromOptions(fileset, {
              baseOptions: { modelAssetPath, delegate: "CPU" },
              runningMode: "IMAGE",
              minDetectionConfidence: 0.25,
              minSuppressionThreshold: 0.2,
            });
            this.faceDet = det;
            this.faceReady = true;
            this.faceError = null;
            return det;
          } catch (e2) {
            lastErr = e2;
          }
        }
      }
      this.faceError = lastErr?.message || String(lastErr);
      this.faceReady = false;
      return null;
    })();
    try {
      return await this._faceLoading;
    } finally {
      this._faceLoading = null;
    }
  }

  async ensureBodyPix() {
    if (this.bodyPixReady && this.bodyPix) return this.bodyPix;
    if ((this.params.crowdBodyPix?.value ?? 0) < 0.5) return null;
    if (this.bodyPixError) return null;
    if (this._bodyPixLoading) return this._bodyPixLoading;
    this._bodyPixLoading = (async () => {
      try {
        await import(/* @vite-ignore */ TFJS_CDN);
        const bodySeg = await import(/* @vite-ignore */ BODYPIX_CDN);
        const api = bodySeg.default || bodySeg;
        const model = api.SupportedModels?.BodyPix || "BodyPix";
        this.bodyPix = await api.createSegmenter(model, {
          architecture: "MobileNetV1",
          outputStride: 16,
          multiplier: 0.75,
          quantBytes: 2,
        });
        this.bodyPixReady = true;
        return this.bodyPix;
      } catch (e) {
        this.bodyPixError = e?.message || String(e);
        this.bodyPixReady = false;
        return null;
      } finally {
        this._bodyPixLoading = null;
      }
    })();
    return this._bodyPixLoading;
  }

  /**
   * Refine base selfie-seg confidence for dense / small people.
   * @param {Float32Array} baseConf
   * @param {ImageData} rgb
   * @param {number} w
   * @param {number} h
   * @param {{
   *   segmenter?: any,
   *   sourceCanvas?: HTMLCanvasElement,
   *   trackHub?: any,
   *   crowdMode?: boolean,
   * }} [ctx]
   * @returns {Float32Array}
   */
  refine(baseConf, rgb, w, h, ctx = {}) {
    const t0 = performance.now();
    this.frame++;
    if (!this.enabled && !ctx.crowdMode) {
      this.lastStats = { mode: "off" };
      return baseConf;
    }

    const out = new Float32Array(baseConf);
    let faces = 0;
    let tiles = 0;
    let motionFrac = 0;

    // 1) Temporal EMA baseline
    const alpha = this.params.crowdTemporal?.value ?? 0.55;
    if (this._ema && this._ema.length === out.length && alpha > 0.01) {
      for (let i = 0; i < out.length; i++) {
        out[i] = this._ema[i] * alpha + out[i] * (1 - alpha);
      }
    }

    // 2) Motion residual (DeepLabCut-style multi-target temporal cue)
    if ((this.params.crowdMotion?.value ?? 1) >= 0.5 && rgb?.data) {
      motionFrac = this._applyMotion(out, rgb.data, w, h);
    }

    // 3) Face seeds → body ellipses (DBFace small-face idea via FaceDetector)
    if ((this.params.crowdFaceSeed?.value ?? 1) >= 0.5 && this.faceDet && ctx.sourceCanvas) {
      faces = this._applyFaceSeeds(out, ctx.sourceCanvas, w, h);
    }

    // 4) Multi-scale tile re-segmentation for tiny people
    if (
      (this.params.crowdTiles?.value ?? 1) >= 0.5 &&
      ctx.segmenter &&
      ctx.sourceCanvas &&
      (ctx.crowdMode || faces > 0 || motionFrac > 0.04)
    ) {
      // Throttle tiles: every 2nd frame when busy
      if (this.frame % 2 === 0 || ctx.crowdMode) {
        tiles = this._applyTiles(out, ctx.segmenter, ctx.sourceCanvas, w, h);
      }
    }

    // 5) Track hub pose/hand micro-boost (InterHand local density)
    if (ctx.trackHub) {
      this._boostFromTracks(out, ctx.trackHub, w, h);
    }

    // 6) Amplify small disconnected blobs (people at spire pixel scale)
    this._boostSmallBlobs(out, w, h);

    // 7) Optional BodyPix async-warm; apply cached if ready
    if ((this.params.crowdBodyPix?.value ?? 0) >= 0.5) {
      if (!this.bodyPixReady) void this.ensureBodyPix();
      // BodyPix is async-heavy; if we have a recent cache, max-blend it
      if (this._bodyPixCache?.length === out.length) {
        for (let i = 0; i < out.length; i++) {
          out[i] = Math.max(out[i], this._bodyPixCache[i] * 0.9);
        }
      }
      if (this.bodyPixReady && ctx.sourceCanvas && this.frame % 4 === 0) {
        void this._runBodyPix(ctx.sourceCanvas, w, h);
      }
    }

    // Store EMA
    if (!this._ema || this._ema.length !== out.length) this._ema = new Float32Array(out.length);
    this._ema.set(out);

    // Clamp
    for (let i = 0; i < out.length; i++) {
      if (out[i] < 0) out[i] = 0;
      else if (out[i] > 1) out[i] = 1;
    }

    this.lastStats = {
      faces,
      tiles,
      motionFrac,
      bodyPix: this.bodyPixReady,
      mode: ctx.crowdMode ? "crowd" : "refine",
      ms: performance.now() - t0,
    };
    return out;
  }

  /**
   * Schedule BodyPix segmentation into cache (non-blocking).
   * @param {HTMLCanvasElement} canvas
   * @param {number} w
   * @param {number} h
   */
  async _runBodyPix(canvas, w, h) {
    if (!this.bodyPix || this._bodyPixBusy) return;
    this._bodyPixBusy = true;
    try {
      const segs = await this.bodyPix.segmentPeople(canvas, {
        multiSegmentation: true,
        segmentBodyParts: false,
        flipHorizontal: false,
      });
      if (!segs?.length) return;
      const conf = new Float32Array(w * h);
      // Draw all person masks
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      const tctx = tmp.getContext("2d");
      if (!tctx) return;
      tctx.clearRect(0, 0, w, h);
      for (const person of segs) {
        const mask = person.mask || person;
        if (mask instanceof ImageData) {
          tctx.putImageData(mask, 0, 0);
        } else if (typeof mask.toCanvasImageSource === "function") {
          tctx.drawImage(mask.toCanvasImageSource(), 0, 0, w, h);
        } else if (mask instanceof HTMLCanvasElement || mask instanceof OffscreenCanvas) {
          tctx.drawImage(mask, 0, 0, w, h);
        }
      }
      const img = tctx.getImageData(0, 0, w, h);
      for (let i = 0, p = 0; i < conf.length; i++, p += 4) {
        conf[i] = Math.max(img.data[p], img.data[p + 1], img.data[p + 2]) / 255;
      }
      this._bodyPixCache = conf;
    } catch (e) {
      this.bodyPixError = e?.message || String(e);
    } finally {
      this._bodyPixBusy = false;
    }
  }

  _applyMotion(out, rgba, w, h) {
    const gain = this.params.crowdMotionGain?.value ?? 0.85;
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) / 255;
    }
    let moving = 0;
    if (this._prevGray && this._prevGray.length === gray.length) {
      for (let i = 0; i < gray.length; i++) {
        const d = Math.abs(gray[i] - this._prevGray[i]);
        if (d > 0.045) {
          // Soft motion confidence — helps small moving figures selfie-seg misses
          const m = Math.min(1, (d - 0.045) * 6) * gain;
          out[i] = Math.max(out[i], m * 0.72);
          moving++;
        }
      }
    }
    this._prevGray = gray;
    return moving / Math.max(1, gray.length);
  }

  _applyFaceSeeds(out, canvas, w, h) {
    if (!this.faceDet) return 0;
    let detections = [];
    try {
      const res = this.faceDet.detect(canvas);
      detections = res?.detections || [];
    } catch {
      return 0;
    }
    const scale = this.params.crowdFaceScale?.value ?? 3.2;
    let n = 0;
    for (const det of detections) {
      const box = det.boundingBox || det.locationData?.relativeBoundingBox;
      if (!box) continue;
      // Support both normalized and pixel boxes
      let x = box.originX ?? box.xMin ?? box.xmin ?? 0;
      let y = box.originY ?? box.yMin ?? box.ymin ?? 0;
      let bw = box.width ?? 0;
      let bh = box.height ?? 0;
      const score = det.categories?.[0]?.score ?? det.score ?? 0.5;
      if (score < 0.22) continue;
      // If pixel coords, normalize
      if (x > 1.5 || y > 1.5 || bw > 1.5) {
        x /= w;
        y /= h;
        bw /= w;
        bh /= h;
      }
      // Body proxy: expand face box downward (DBFace → person blob)
      const cx = x + bw * 0.5;
      const cy = y + bh * 0.55;
      const bodyW = Math.min(0.45, bw * scale * 0.85);
      const bodyH = Math.min(0.75, bh * scale * 1.35);
      // Shift center down so body sits under face
      const bcy = Math.min(0.95, cy + bodyH * 0.28);
      this._paintEllipse(out, w, h, cx, bcy, bodyW * 0.5, bodyH * 0.5, 0.35 + score * 0.55);
      // Head core stronger
      this._paintEllipse(out, w, h, cx, cy, bw * 0.7, bh * 0.85, 0.55 + score * 0.4);
      n++;
    }
    return n;
  }

  /**
   * Multi-scale tiles: upscale quadrants / center crop, re-run segmenter, merge.
   * Inspired by DBFace multi-scale for small targets.
   */
  _applyTiles(out, segmenter, sourceCanvas, w, h) {
    if (!this._tileCanvas) {
      this._tileCanvas = document.createElement("canvas");
      this._tileCanvas.width = 256;
      this._tileCanvas.height = 256;
      this._tileCtx = this._tileCanvas.getContext("2d", { willReadFrequently: true });
    }
    const tc = this._tileCanvas;
    const tctx = this._tileCtx;
    if (!tctx) return 0;

    // Tile regions in normalized coords: 2x2 grid + center + full (already have base)
    const tiles = [
      { x: 0, y: 0, s: 0.55 },
      { x: 0.45, y: 0, s: 0.55 },
      { x: 0, y: 0.45, s: 0.55 },
      { x: 0.45, y: 0.45, s: 0.55 },
      { x: 0.2, y: 0.15, s: 0.6 }, // plaza center
    ];
    // Rotate which tiles run to keep budget
    const start = this.frame % tiles.length;
    const run = [tiles[start], tiles[(start + 2) % tiles.length]];
    if (this.frame % 3 === 0) run.push(tiles[4]);

    let done = 0;
    for (const tile of run) {
      try {
        const sx = (tile.x * sourceCanvas.width) | 0;
        const sy = (tile.y * sourceCanvas.height) | 0;
        const sw = (tile.s * sourceCanvas.width) | 0;
        const sh = (tile.s * sourceCanvas.height) | 0;
        tctx.clearRect(0, 0, 256, 256);
        tctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, 256, 256);
        const result = segmenter.segment(tc);
        if (!result?.categoryMask) continue;
        let confMask = null;
        try {
          const cat = result.categoryMask.getAsUint8Array?.() || result.categoryMask;
          confMask = result.confidenceMasks?.[0]?.getAsFloat32Array?.() || null;
          // Map 256 tile → full frame
          for (let ty = 0; ty < h; ty++) {
            const ny = ty / h;
            if (ny < tile.y || ny > tile.y + tile.s) continue;
            const ly = (ny - tile.y) / tile.s;
            const syi = Math.min(255, (ly * 256) | 0);
            for (let tx = 0; tx < w; tx++) {
              const nx = tx / w;
              if (nx < tile.x || nx > tile.x + tile.s) continue;
              const lx = (nx - tile.x) / tile.s;
              const sxi = Math.min(255, (lx * 256) | 0);
              const si = syi * 256 + sxi;
              let c = 0;
              if (confMask) {
                c = confMask[si];
              } else if (cat) {
                // category 0 or 1 depending on model polarity — take non-zero as person-ish
                c = cat[si] > 0 ? 0.75 : 0;
              }
              if (c > 0.2) {
                const i = ty * w + tx;
                // Tiles are zoomed — boost small people slightly
                out[i] = Math.max(out[i], c * 0.95);
              }
            }
          }
          done++;
        } finally {
          try {
            result.categoryMask?.close?.();
          } catch {
            /* */
          }
          try {
            result.confidenceMasks?.forEach((m) => m.close?.());
          } catch {
            /* */
          }
        }
      } catch {
        /* tile failed — skip */
      }
    }
    return done;
  }

  _boostFromTracks(out, trackHub, w, h) {
    // Pose / hand joints as high-confidence seeds (InterHand-style local focus)
    const joints = trackHub.jointPoints || [];
    for (const j of joints) {
      const nx = j.nx ?? j.x;
      const ny = j.ny ?? j.y;
      if (nx == null || ny == null) continue;
      this._paintEllipse(out, w, h, nx, ny, 0.04, 0.06, 0.55);
    }
    // Person isolation masks from multi-person pose
    if (trackHub.personMasks?.length) {
      for (const m of trackHub.personMasks) {
        if (!m?.length || m.length !== out.length) continue;
        for (let i = 0; i < out.length; i++) {
          if (m[i] > 0.2) out[i] = Math.max(out[i], m[i] * 0.85);
        }
      }
    }
    // Hand masks densify upper body when people are small
    for (const key of ["leftHand", "rightHand", "face", "pose"]) {
      const m = trackHub.masks?.[key];
      if (!m?.length || m.length !== out.length) continue;
      for (let i = 0; i < out.length; i++) {
        if (m[i] > 0.25) out[i] = Math.max(out[i], m[i] * 0.7);
      }
    }
  }

  /**
   * Amplify sparse mid-confidence blobs so tiny individuals survive mask thr.
   */
  _boostSmallBlobs(out, w, h) {
    const thr = this.params.crowdMinBlob?.value ?? 0.18;
    // Downsample scan 4x for speed
    const step = 4;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = y * w + x;
        const c = out[i];
        if (c < thr || c > 0.55) continue;
        // Local density of similar mid-conf
        let n = 0;
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx * step;
            const yy = y + dy * step;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const v = out[yy * w + xx];
            if (v > thr * 0.7) {
              n++;
              sum += v;
            }
          }
        }
        // Small isolated clusters of mid-conf → boost (spire-scale people)
        if (n >= 3 && n <= 18) {
          const boost = Math.min(0.85, (sum / n) * 1.45);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx * step;
              const yy = y + dy * step;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              const ii = yy * w + xx;
              out[ii] = Math.max(out[ii], boost);
            }
          }
        }
      }
    }
  }

  _paintEllipse(out, w, h, cx, cy, rx, ry, amp) {
    const x0 = Math.max(0, ((cx - rx) * w) | 0);
    const x1 = Math.min(w - 1, ((cx + rx) * w) | 0);
    const y0 = Math.max(0, ((cy - ry) * h) | 0);
    const y1 = Math.min(h - 1, ((cy + ry) * h) | 0);
    const rx2 = rx * rx + 1e-6;
    const ry2 = ry * ry + 1e-6;
    for (let y = y0; y <= y1; y++) {
      const ny = y / h;
      const dy = (ny - cy) * (ny - cy) / ry2;
      for (let x = x0; x <= x1; x++) {
        const nx = x / w;
        const dx = (nx - cx) * (nx - cx) / rx2;
        const e = dx + dy;
        if (e > 1) continue;
        const fall = 1 - e;
        const v = amp * fall * fall;
        const i = y * w + x;
        if (v > out[i]) out[i] = v;
      }
    }
  }

  snapshot() {
    return { ...this.lastStats, faceReady: this.faceReady, faceError: this.faceError, bodyPix: this.bodyPixReady };
  }
}

export function extractPersonConfidenceFromMask(maskBuf, confidenceMasks, w, h) {
  const n = w * h;
  const conf = new Float32Array(n);
  const conf0 = confidenceMasks?.[0];
  let confArr = null;
  try {
    confArr = conf0?.getAsFloat32Array?.() || conf0?.getAsUint8Array?.() || null;
  } catch {
    confArr = null;
  }
  if (confArr && confArr.length >= n) {
    const scale = confArr instanceof Float32Array ? 1 : 1 / 255;
    for (let i = 0; i < n; i++) conf[i] = confArr[i] * scale;
    return conf;
  }
  // Category mask only
  for (let i = 0; i < n; i++) {
    conf[i] = maskBuf[i] > 0 ? 0.85 : 0;
  }
  return conf;
}
