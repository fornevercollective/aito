/**
 * Edge separation for crowd point clouds.
 * Sobel on luma + person-conf gradient + multi-scale (crowd fine-tune).
 * Edge is the strongest silhouette cue when dense people are tiny.
 */

export const EDGE_PARAMS = {
  edgeThr: {
    min: 0.04,
    max: 0.55,
    step: 0.01,
    value: 0.14,
    label: "Edge threshold",
    group: "mask",
  },
  edgeRgbMix: {
    min: 0,
    max: 1,
    step: 0.02,
    value: 0.55,
    label: "Edge RGB vs mask",
    group: "mask",
  },
  edgeCrowdBoost: {
    min: 0,
    max: 2,
    step: 0.05,
    value: 1.15,
    label: "Crowd edge boost",
    group: "mask",
  },
  edgeDepth: {
    min: 0,
    max: 1.5,
    step: 0.05,
    value: 0.65,
    label: "Edge depth lift",
    group: "mask",
  },
  edgeThin: {
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.45,
    label: "Edge thinness",
    group: "mask",
  },
  edgeMultiScale: {
    min: 0,
    max: 1,
    step: 1,
    value: 1,
    label: "Edge multi-scale",
    group: "mask",
  },
};

/**
 * Compute edge strength field [0..1] for every pixel.
 * @param {Float32Array} personConf
 * @param {Uint8ClampedArray|Uint8Array} rgbData RGBA
 * @param {number} w
 * @param {number} h
 * @param {object} params EDGE + crowd params
 * @param {{ crowdMode?: boolean, motionFrac?: number }} [ctx]
 * @returns {Float32Array}
 */
export function computeEdgeField(personConf, rgbData, w, h, params, ctx = {}) {
  const n = w * h;
  const out = new Float32Array(n);
  if (!personConf?.length || !rgbData) return out;

  const thr = params.edgeThr?.value ?? 0.14;
  const rgbMix = params.edgeRgbMix?.value ?? 0.55;
  const crowdBoost = params.edgeCrowdBoost?.value ?? 1.15;
  const multi = (params.edgeMultiScale?.value ?? 1) >= 0.5;
  const crowd = !!ctx.crowdMode;
  const boost = crowd ? crowdBoost : 1;

  // Gray + conf at full res
  const gray = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    gray[i] = (rgbData[p] * 0.299 + rgbData[p + 1] * 0.587 + rgbData[p + 2] * 0.114) / 255;
  }

  // Sobel at step 1
  sobelInto(out, gray, personConf, w, h, rgbMix, 1);

  // Multi-scale: add coarser gradients (catches large body silhouettes in crowd)
  if (multi) {
    const coarse = new Float32Array(n);
    sobelInto(coarse, gray, personConf, w, h, rgbMix, 2);
    for (let i = 0; i < n; i++) out[i] = Math.max(out[i], coarse[i] * 0.85);
    if (crowd) {
      const coarse2 = new Float32Array(n);
      sobelInto(coarse2, gray, personConf, w, h, rgbMix * 0.7 + 0.3, 3);
      for (let i = 0; i < n; i++) out[i] = Math.max(out[i], coarse2[i] * 0.7);
    }
  }

  // Boost edges that sit on person-conf boundaries (true separation)
  for (let i = 0; i < n; i++) {
    const c = personConf[i] ?? 0;
    // Mid-conf boundaries = silhouettes between people / bg
    const boundary = c > 0.08 && c < 0.85 ? 1.15 : c >= 0.85 ? 0.95 : 0.55;
    out[i] = Math.min(1, out[i] * boost * boundary);
  }

  // Soft threshold for display / sampling
  const soft = thr * 0.55;
  for (let i = 0; i < n; i++) {
    if (out[i] < soft) out[i] = 0;
    else if (out[i] < thr) out[i] = (out[i] - soft) / (thr - soft + 1e-5) * 0.5;
  }

  return out;
}

function sobelInto(out, gray, conf, w, h, rgbMix, step) {
  const confMix = 1 - rgbMix;
  for (let y = step; y < h - step; y++) {
    for (let x = step; x < w - step; x++) {
      const i = y * w + x;
      // RGB sobel
      const g00 = gray[(y - step) * w + (x - step)];
      const g01 = gray[(y - step) * w + x];
      const g02 = gray[(y - step) * w + (x + step)];
      const g10 = gray[y * w + (x - step)];
      const g12 = gray[y * w + (x + step)];
      const g20 = gray[(y + step) * w + (x - step)];
      const g21 = gray[(y + step) * w + x];
      const g22 = gray[(y + step) * w + (x + step)];
      const gx = -g00 - 2 * g10 - g20 + g02 + 2 * g12 + g22;
      const gy = -g00 - 2 * g01 - g02 + g20 + 2 * g21 + g22;
      const rgbE = Math.hypot(gx, gy);

      // Conf sobel (mask silhouette)
      const c00 = conf[(y - step) * w + (x - step)] ?? 0;
      const c01 = conf[(y - step) * w + x] ?? 0;
      const c02 = conf[(y - step) * w + (x + step)] ?? 0;
      const c10 = conf[y * w + (x - step)] ?? 0;
      const c12 = conf[y * w + (x + step)] ?? 0;
      const c20 = conf[(y + step) * w + (x - step)] ?? 0;
      const c21 = conf[(y + step) * w + x] ?? 0;
      const c22 = conf[(y + step) * w + (x + step)] ?? 0;
      const cx = -c00 - 2 * c10 - c20 + c02 + 2 * c12 + c22;
      const cy = -c00 - 2 * c01 - c02 + c20 + 2 * c21 + c22;
      const confE = Math.hypot(cx, cy);

      const e = rgbE * rgbMix + confE * confMix;
      // Normalize roughly: sobel max ~4 for unit inputs
      out[i] = Math.max(out[i], Math.min(1, e * 0.55));
    }
  }
}

/**
 * Layer group definitions for left rail.
 * Solo = single-user hand/person tracking
 * Crowd = multi-person + edge separation
 */
export const LAYER_GROUPS = {
  solo: {
    id: "solo",
    label: "Hand · person",
    title: "Single-user track: person A, face, hands, pose, joints, fingers",
    feeds: ["person", "face", "leftHand", "rightHand", "fingers", "joints", "pose"],
  },
  crowd: {
    id: "crowd",
    label: "Hands · crowd",
    title: "Crowd separation: people A–D, edge cloud, pose, background",
    feeds: ["person", "person2", "person3", "person4", "edge", "pose", "background"],
  },
};

/** Apply group on/off to FEEDS process flags. Returns list of changed feed ids. */
export function applyLayerGroup(feeds, groupId, on, { exclusive = false } = {}) {
  const g = LAYER_GROUPS[groupId];
  if (!g || !feeds) return [];
  const changed = [];
  if (exclusive && on) {
    // Turn off the other group's exclusive-ish feeds first
    for (const [oid, og] of Object.entries(LAYER_GROUPS)) {
      if (oid === groupId) continue;
      for (const id of og.feeds) {
        // Keep shared feeds (person, pose) if also in active group
        if (g.feeds.includes(id)) continue;
        if (feeds[id] && feeds[id].process) {
          feeds[id].process = false;
          changed.push(id);
        }
      }
    }
  }
  for (const id of g.feeds) {
    if (!feeds[id]) continue;
    if (feeds[id].process !== !!on) {
      feeds[id].process = !!on;
      changed.push(id);
    }
  }
  return changed;
}

export function layerGroupIsOn(feeds, groupId) {
  const g = LAYER_GROUPS[groupId];
  if (!g || !feeds) return false;
  // On if majority of existing feeds in group are process=true
  let n = 0;
  let on = 0;
  for (const id of g.feeds) {
    if (!feeds[id]) continue;
    n++;
    if (feeds[id].process) on++;
  }
  return n > 0 && on >= Math.ceil(n * 0.5);
}
