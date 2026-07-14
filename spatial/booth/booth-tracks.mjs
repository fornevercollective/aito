/**
 * MediaPipe face / hand / pose tracking + raster isolation masks.
 */
import {
  FaceLandmarker,
  HandLandmarker,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm";
import { MEDIAPIPE } from "./hand-tracking-resources.mjs";

/** Pinned model asset URLs — see hand-tracking-resources.mjs for full catalog */
const MODELS = {
  face: MEDIAPIPE.models.face,
  hand: MEDIAPIPE.models.hand,
  pose: MEDIAPIPE.models.pose,
};

/** @typedef {{x:number,y:number,z?:number,visibility?:number}} Lm */

export class TrackHub {
  /**
   * @param {number} width
   * @param {number} height
   * @param {number} maxPeople
   * @param {{ face?: boolean, hands?: boolean, pose?: boolean, everyN?: number }} [profile]
   */
  constructor(width, height, maxPeople = 4, profile = null) {
    this.w = width;
    this.h = height;
    this.maxPeople = Math.max(1, Math.min(4, maxPeople));
    this.profile = {
      face: profile?.face !== false,
      hands: profile?.hands !== false,
      pose: profile?.pose !== false,
      everyN: Math.max(1, profile?.everyN || 1),
    };
    this.ready = false;
    this.lastMs = 0;
    this.frame = 0;
    this.masks = {};
    this.personMasks = [];
    this.personCount = 0;
    this.jointPoints = [];
    this.fingerPoints = [];
    this._maskCanvas = document.createElement("canvas");
    this._maskCanvas.width = width;
    this._maskCanvas.height = height;
    this._maskCtx = this._maskCanvas.getContext("2d");
  }

  async init(fileset) {
    const gpu = { delegate: "GPU" };
    // Load only what the live profile needs — compute-friendly vs full Splatline stack
    if (this.profile.face) {
      this.faceLm = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.face, ...gpu },
        runningMode: "IMAGE",
        numFaces: this.maxPeople,
      });
    }
    if (this.profile.hands) {
      this.handLm = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.hand, ...gpu },
        runningMode: "IMAGE",
        numHands: 2,
      });
    }
    if (this.profile.pose) {
      this.poseLm = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.pose, ...gpu },
        runningMode: "IMAGE",
        numPoses: this.maxPeople,
      });
    }
    this.ready = true;
  }

  /** Update profile flags without reloading models (skip unused detectors). */
  setProfileFlags(flags = {}) {
    if (flags.face != null) this.profile.face = !!flags.face;
    if (flags.hands != null) this.profile.hands = !!flags.hands;
    if (flags.pose != null) this.profile.pose = !!flags.pose;
    if (flags.everyN != null) this.profile.everyN = Math.max(1, flags.everyN | 0);
  }

  /**
   * @param {HTMLCanvasElement} canvas mirrored sample frame
   * @param {number} radius px brush for masks
   */
  detect(canvas, radius = 14) {
    if (!this.ready) return null;
    this.frame += 1;
    // Eco skip: reuse last result
    if (this.profile.everyN > 1 && this.frame % this.profile.everyN !== 0 && this.jointPoints?.length) {
      return this.masks;
    }
    const t0 = performance.now();
    const emptyFace = { faceLandmarks: [] };
    const emptyHands = { landmarks: [], handedness: [] };
    const emptyPose = { landmarks: [] };

    const face =
      this.profile.face && this.faceLm ? this.faceLm.detect(canvas) : emptyFace;
    const hands =
      this.profile.hands && this.handLm ? this.handLm.detect(canvas) : emptyHands;
    const pose =
      this.profile.pose && this.poseLm ? this.poseLm.detect(canvas) : emptyPose;

    this.personMasks = this._rasterPersons(pose, radius + 4);
    this.personCount = this.personMasks.filter((m) => m.some((v) => v > 0.2)).length;

    this.masks = {
      face: this._rasterAllFaces(face, radius),
      leftHand: this._rasterHand(hands, "Left", radius + 2),
      rightHand: this._rasterHand(hands, "Right", radius + 2),
      pose: this._rasterAllPoses(pose, radius),
      fingers: this._rasterFingers(hands, radius * 0.55),
      persons: this.personMasks,
      person2: this.personMasks[1] || null,
      person3: this.personMasks[2] || null,
      person4: this.personMasks[3] || null,
    };

    this.jointPoints = this._collectJoints(face, hands, pose);
    this.fingerPoints = this._collectFingers(hands);
    this.lastMs = performance.now() - t0;
    return this.masks;
  }

  confidenceAt(layerId, i) {
    const m = this.masks[layerId];
    return m ? m[i] : 0;
  }

  _collectJoints(face, hands, pose) {
    const pts = [];
    const push = (layer, lm, idx, color) => {
      if (!lm?.[idx]) return;
      const p = lm[idx];
      pts.push({
        layer,
        idx,
        nx: p.x,
        ny: p.y,
        nz: p.z ?? 0,
        color,
        r: p.visibility ?? 1,
      });
    };

    const faceCols = [[1, 0.75, 0.2], [1, 0.6, 0.15], [0.95, 0.5, 0.1], [0.9, 0.4, 0.08]];
    if (face.faceLandmarks) {
      const key = [1, 33, 133, 263, 61, 291, 199, 10, 152];
      for (let fi = 0; fi < face.faceLandmarks.length; fi++) {
        const faceLm = face.faceLandmarks[fi];
        const col = faceCols[fi % faceCols.length];
        for (const i of key) push(`face${fi}`, faceLm, i, col);
      }
    }

    const poseCols = [[0.3, 0.9, 0.5], [0.2, 0.85, 0.45], [0.35, 0.75, 0.55], [0.25, 0.7, 0.4]];
    if (pose.landmarks) {
      for (let pi = 0; pi < pose.landmarks.length; pi++) {
        const poseLm = pose.landmarks[pi];
        const col = poseCols[pi % poseCols.length];
        for (let i = 0; i < poseLm.length; i++) {
          const v = poseLm[i].visibility ?? 1;
          if (v < 0.35) continue;
          push(`pose${pi}`, poseLm, i, col);
        }
      }
    }

    const handSets = [
      { lm: hands.landmarks, handed: hands.handedness, side: "leftHand", col: [0.95, 0.45, 0.7] },
      { lm: hands.landmarks, handed: hands.handedness, side: "rightHand", col: [0.4, 0.65, 0.98] },
    ];
    for (const hs of handSets) {
      if (!hs.lm) continue;
      for (let h = 0; h < hs.lm.length; h++) {
        const label = hs.handed?.[h]?.[0]?.categoryName || "";
        const wantLeft = hs.side === "leftHand";
        if (wantLeft && label !== "Left") continue;
        if (!wantLeft && label !== "Right") continue;
        for (let i = 0; i < hs.lm[h].length; i++) {
          push(hs.side, hs.lm[h], i, hs.col);
        }
      }
    }
    return pts;
  }

  _collectFingers(hands) {
    const groups = [
      { name: "thumb", idx: [1, 2, 3, 4] },
      { name: "index", idx: [5, 6, 7, 8] },
      { name: "middle", idx: [9, 10, 11, 12] },
      { name: "ring", idx: [13, 14, 15, 16] },
      { name: "pinky", idx: [17, 18, 19, 20] },
    ];
    const out = [];
    if (!hands.landmarks) return out;
    for (let h = 0; h < hands.landmarks.length; h++) {
      const lm = hands.landmarks[h];
      const side = hands.handedness?.[h]?.[0]?.categoryName || "Hand";
      for (const g of groups) {
        for (const i of g.idx) {
          if (!lm[i]) continue;
          out.push({
            hand: side,
            finger: g.name,
            nx: lm[i].x,
            ny: lm[i].y,
            nz: lm[i].z ?? 0,
          });
        }
      }
    }
    return out;
  }

  _rasterAllFaces(face, radius) {
    const mask = new Float32Array(this.w * this.h);
    if (!face.faceLandmarks?.length) return mask;
    for (const lm of face.faceLandmarks) {
      const one = this._rasterFaceLandmarks(lm, radius);
      for (let i = 0; i < mask.length; i++) mask[i] = Math.max(mask[i], one[i]);
    }
    return mask;
  }

  _rasterFaceLandmarks(lm, radius) {
    const mask = new Float32Array(this.w * this.h);
    if (!lm) return mask;
    const ctx = this._maskCtx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    const oval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
    for (let i = 0; i < oval.length; i++) {
      const p = lm[oval[i]];
      const x = p.x * this.w;
      const y = p.y * this.h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(p.x * this.w, p.y * this.h, radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    return this._readMask(mask);
  }

  _rasterHand(hands, side, radius) {
    const mask = new Float32Array(this.w * this.h);
    if (!hands.landmarks?.length) return mask;
    const ctx = this._maskCtx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = radius;
    ctx.lineCap = "round";

    for (let h = 0; h < hands.landmarks.length; h++) {
      const label = hands.handedness?.[h]?.[0]?.categoryName;
      if (label !== side) continue;
      const lm = hands.landmarks[h];
      const edges = [
        [0, 1, 2, 3, 4],
        [0, 5, 6, 7, 8],
        [0, 9, 10, 11, 12],
        [0, 13, 14, 15, 16],
        [0, 17, 18, 19, 20],
        [5, 9, 13, 17],
      ];
      for (const chain of edges) {
        ctx.beginPath();
        for (let i = 0; i < chain.length; i++) {
          const p = lm[chain[i]];
          const x = p.x * this.w;
          const y = p.y * this.h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(p.x * this.w, p.y * this.h, radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return this._readMask(mask);
  }

  _rasterPersons(pose, radius) {
    const masks = [];
    const n = this.maxPeople;
    for (let p = 0; p < n; p++) {
      const lm = pose.landmarks?.[p];
      masks.push(lm ? this._rasterPoseLandmarks(lm, radius) : new Float32Array(this.w * this.h));
    }
    return masks;
  }

  _rasterAllPoses(pose, radius) {
    const mask = new Float32Array(this.w * this.h);
    if (!pose.landmarks?.length) return mask;
    for (const lm of pose.landmarks) {
      const one = this._rasterPoseLandmarks(lm, radius);
      for (let i = 0; i < mask.length; i++) mask[i] = Math.max(mask[i], one[i]);
    }
    return mask;
  }

  _rasterPoseLandmarks(lm, radius) {
    const mask = new Float32Array(this.w * this.h);
    if (!lm) return mask;
    const ctx = this._maskCtx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = radius;
    ctx.lineCap = "round";
    const bones = [
      [11, 12], [11, 23], [12, 24], [23, 24],
      [11, 13], [13, 15], [12, 14], [14, 16],
      [23, 25], [25, 27], [24, 26], [26, 28],
      [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
    ];
    for (const [a, b] of bones) {
      const pa = lm[a];
      const pb = lm[b];
      if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * this.w, pa.y * this.h);
      ctx.lineTo(pb.x * this.w, pb.y * this.h);
      ctx.stroke();
    }
    for (const p of lm) {
      if ((p.visibility ?? 1) < 0.3) continue;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(p.x * this.w, p.y * this.h, radius * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    return this._readMask(mask);
  }

  _rasterFingers(hands, radius) {
    const mask = new Float32Array(this.w * this.h);
    if (!hands.landmarks?.length) return mask;
    const ctx = this._maskCtx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = "#fff";
    const tips = [4, 8, 12, 16, 20];
    for (const lm of hands.landmarks) {
      for (const i of tips) {
        const p = lm[i];
        ctx.beginPath();
        ctx.arc(p.x * this.w, p.y * this.h, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return this._readMask(mask);
  }

  _readMask(out) {
    const img = this._maskCtx.getImageData(0, 0, this.w, this.h);
    for (let i = 0; i < out.length; i++) {
      out[i] = img.data[i * 4] / 255;
    }
    return out;
  }

  personMask(idx) {
    return this.personMasks?.[idx] || null;
  }

  drawFeed(layerId, ctx, rgbData, w, h) {
    let mask = this.masks[layerId];
    if (layerId === "person" && this.personMasks?.[0]) mask = this.personMasks[0];
    if (!mask || !ctx) return;
    const img = ctx.createImageData(w, h);
    const palettes = {
      face: [251, 191, 36],
      leftHand: [244, 114, 182],
      rightHand: [96, 165, 250],
      pose: [74, 222, 128],
      fingers: [253, 164, 175],
      joints: [216, 180, 254],
    };
    const pal = palettes[layerId] || [200, 200, 200];
    for (let i = 0; i < w * h; i++) {
      const m = mask[i];
      const o = i * 4;
      const r = rgbData[o];
      const g = rgbData[o + 1];
      const b = rgbData[o + 2];
      img.data[o] = Math.round(r * (1 - m) + pal[0] * m);
      img.data[o + 1] = Math.round(g * (1 - m) + pal[1] * m);
      img.data[o + 2] = Math.round(b * (1 - m) + pal[2] * m);
      img.data[o + 3] = m > 0.05 ? 255 : 30;
    }
    ctx.putImageData(img, 0, 0);
  }

  drawJointsFeed(ctx, w, h) {
    if (!ctx) return;
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, w, h);
    for (const j of this.jointPoints) {
      const x = j.nx * w;
      const y = j.ny * h;
      ctx.fillStyle = `rgba(${Math.round(j.color[0] * 255)},${Math.round(j.color[1] * 255)},${Math.round(j.color[2] * 255)},${0.35 + j.r * 0.65})`;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}