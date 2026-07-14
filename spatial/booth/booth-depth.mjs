/**
 * Splatline-inspired depth / point-cloud variation.
 * Modes: radial, luma, jax, zipdepth, fog-grade, selective-focus, distance-filter, nested-parallax.
 *
 * ZipDepth mode is inspired by fabiotosi92/ZipDepth (ECCV 2026):
 * multi-scale SPPF-like pools, strip H/V context, local structure → monocular depth.
 * Optional Python sidecar (port 8766) can supply real ZipDepth ONNX/PyTorch maps.
 */

export const DEPTH_MODES = [
  { id: "radial", label: "Radial", desc: "Center-weighted lift (default booth)" },
  { id: "luma", label: "Luma", desc: "Brightness → depth (Splatline PLY style)" },
  { id: "jax", label: "JAX", desc: "Sidecar depth map when available" },
  {
    id: "zipdepth",
    label: "ZipDepth",
    desc: "Multi-scale monocular · optional ZipDepth sidecar :8766",
  },
  { id: "fog", label: "Fog grade", desc: "Near warm / far cool + soft far fade" },
  { id: "focus", label: "Selective focus", desc: "Bokeh size away from focus plane" },
  { id: "filter", label: "Distance filter", desc: "Keep points in min–max depth band" },
  { id: "nested", label: "Nested parallax", desc: "Shell-radius depth variation" },
];

export const DEPTH_PARAMS = {
  depthMode: { min: 0, max: DEPTH_MODES.length - 1, step: 1, value: 0, label: "Depth mode", group: "depth" },
  depthFocus: { min: 0, max: 1, step: 0.02, value: 0.45, label: "Focus plane", midiCc: null, group: "depth" },
  depthFocusRange: { min: 0.05, max: 0.8, step: 0.02, value: 0.22, label: "Focus range", group: "depth" },
  depthMin: { min: 0, max: 1, step: 0.02, value: 0.05, label: "Depth min filter", group: "depth" },
  depthMax: { min: 0, max: 1.5, step: 0.02, value: 1.2, label: "Depth max filter", group: "depth" },
  depthFogStart: { min: 0, max: 1, step: 0.02, value: 0.35, label: "Fog start", group: "depth" },
  depthFogEnd: { min: 0.2, max: 2, step: 0.02, value: 1.1, label: "Fog end", group: "depth" },
  depthNearTint: { min: 0, max: 1, step: 0.02, value: 0.35, label: "Near warm tint", group: "depth" },
  depthFarTint: { min: 0, max: 1, step: 0.02, value: 0.45, label: "Far cool tint", group: "depth" },
  depthVariation: { min: 0, max: 1.5, step: 0.02, value: 0.55, label: "Point variation", group: "depth" },
  depthWaveform: { min: 0, max: 2, step: 0.02, value: 0.4, label: "Depth waveform", group: "depth" },
  /** ZipDepth-style multi-scale strength (client field + sidecar blend). */
  zipScale: { min: 0.2, max: 2, step: 0.02, value: 1, label: "ZipDepth scale", group: "depth" },
  /** High-frequency structure weight (local contrast / edges ≈ near). */
  zipDetail: { min: 0, max: 1.5, step: 0.02, value: 0.55, label: "ZipDepth detail", group: "depth" },
  /** Strip pooling H/V global context (ZipDepth strip attention analogue). */
  zipStrip: { min: 0, max: 1.2, step: 0.02, value: 0.4, label: "ZipDepth strip", group: "depth" },
  /** Build a dense spatial point cloud from the depth field (Depth feed layer). */
  depthCloud: { min: 0, max: 1, step: 1, value: 1, label: "Depth → spatial cloud", group: "depth" },
  /** 0 = flat image plane + Z; 1 = perspective unproject (rays diverge with depth). */
  depthPerspective: { min: 0, max: 1, step: 0.02, value: 0.65, label: "Depth unproject", group: "depth" },
  /** 0 = camera RGB; 1 = turbo depth colormap on points. */
  depthCloudColor: { min: 0, max: 1, step: 0.02, value: 0.35, label: "Depth cloud colormap", group: "depth" },
  /** 0 = full frame; 1 = person-mask weighted only. */
  depthCloudMask: { min: 0, max: 1, step: 0.02, value: 0, label: "Depth cloud mask", group: "depth" },
  /** Near/far scale for monocular unproject (meters-ish booth units). */
  depthNear: { min: 0.15, max: 2, step: 0.02, value: 0.45, label: "Depth near Z", group: "depth" },
  depthFarZ: { min: 0.5, max: 8, step: 0.05, value: 3.2, label: "Depth far Z", group: "depth" },
};

/** Mode index or id → mode object */
export function resolveDepthMode(params) {
  const idx = Math.round(params.depthMode?.value ?? 0);
  return DEPTH_MODES[Math.max(0, Math.min(DEPTH_MODES.length - 1, idx))] || DEPTH_MODES[0];
}

/**
 * Base geometric depth (0..~1.5) before scale.
 * @param {object} opts
 */
export function computeBaseDepth(opts) {
  const {
    x,
    y,
    w,
    h,
    lum,
    i,
    jaxDepthAt,
    zipDepthAt,
    modeId,
    shellRadius = 0,
    handDepth = 0,
    musicKick = 0,
    time = 0,
    variation = 0.55,
  } = opts;
  const nx = x / w;
  const ny = y / h;
  const radial = Math.hypot(nx - 0.5, ny - 0.42);
  let depth = (1 - radial * 1.1) * 0.55 + lum * 0.3 + (1 - ny) * 0.2;

  switch (modeId) {
    case "luma":
      depth = (1 - lum) * 0.75 + (1 - ny) * 0.2 + 0.1;
      break;
    case "jax": {
      const j = jaxDepthAt?.(i);
      depth = j != null ? j : depth;
      break;
    }
    case "zipdepth": {
      const z = zipDepthAt?.(i);
      if (z != null) {
        depth = z;
      } else {
        // Per-pixel fallback when field not ready (coarse ZipDepth-ish cue)
        const stripY = 0.5 + (ny - 0.5) * 0.35;
        const stripX = 0.5 + Math.abs(nx - 0.5) * 0.2;
        depth =
          (1 - radial * 0.95) * 0.4 +
          (1 - lum) * 0.28 +
          (1 - ny) * 0.18 +
          stripY * 0.08 +
          stripX * 0.06;
      }
      break;
    }
    case "fog":
    case "focus":
    case "filter":
      // keep radial+luma base; post-process colors/size later
      break;
    case "nested":
      depth = (1 - radial * 0.9) * 0.4 + lum * 0.25 + shellRadius * 0.55 + (1 - ny) * 0.12;
      break;
    default:
      break;
  }

  // Spatial point-cloud variation (Splatline-style organic jitter in Z)
  const seed = ((x * 12.9898 + y * 78.233) % 1 + 1) % 1;
  depth += (seed - 0.5) * variation * 0.12;
  depth += Math.sin(time * 2.4 + seed * 40) * (opts.waveform ?? 0) * 0.06;
  depth += handDepth;
  depth += musicKick;
  return depth;
}

/**
 * ZipDepth-inspired monocular depth field for the full sample frame.
 * Mirrors the paper's stages in a lightweight CPU form:
 *  - multi-scale pools (SPPF analogue)
 *  - horizontal / vertical strip context
 *  - local structure / high-frequency detail as near cues
 *  - cross-scale fusion + normalize
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba RGBA or RGB interleaved
 * @param {number} w
 * @param {number} h
 * @param {object} [params] DEPTH_PARAMS-like
 * @param {{ channels?: 3|4 }} [opts]
 * @returns {Float32Array} length w*h, values roughly 0..1.2
 */
export function computeZipDepthField(rgba, w, h, params = {}, opts = {}) {
  const ch = opts.channels ?? (rgba.length >= w * h * 4 ? 4 : 3);
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += ch) {
    lum[i] = (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) / 255;
  }

  // 3×3 box blur (stage-1 smooth)
  const blur1 = boxBlur(lum, w, h, 1);
  // 5×5-ish via two more passes (stage-2 / SPPF-lite)
  const blur2 = boxBlur(blur1, w, h, 2);
  const blur4 = boxBlur(blur2, w, h, 2);

  // Local contrast / residual (high-freq ≈ near structure)
  const detail = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    detail[i] = Math.abs(lum[i] - blur2[i]);
  }

  // Gradient magnitude (structure prior)
  const grad = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xr = lum[y * w + Math.min(w - 1, x + 1)];
      const xl = lum[y * w + Math.max(0, x - 1)];
      const yd = lum[Math.min(h - 1, y + 1) * w + x];
      const yu = lum[Math.max(0, y - 1) * w + x];
      grad[i] = Math.hypot(xr - xl, yd - yu) * 0.5;
    }
  }

  // Strip pooling: row means + col means (H/V strip attention analogue)
  const rowMean = new Float32Array(h);
  const colMean = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += lum[y * w + x];
    rowMean[y] = s / w;
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) s += lum[y * w + x];
    colMean[x] = s / h;
  }

  const scale = params.zipScale?.value ?? 1;
  const detailW = params.zipDetail?.value ?? 0.55;
  const stripW = params.zipStrip?.value ?? 0.4;

  const out = new Float32Array(n);
  let minV = Infinity;
  let maxV = -Infinity;
  for (let y = 0; y < h; y++) {
    const ny = y / Math.max(1, h - 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const nx = x / Math.max(1, w - 1);
      const radial = Math.hypot(nx - 0.5, ny - 0.42);

      // Multi-scale pyramid residual (SPPF / FPN-ish)
      const multi =
        Math.abs(blur1[i] - blur2[i]) * 0.45 + Math.abs(blur2[i] - blur4[i]) * 0.55;

      // Strip context: deviation from H/V means → figure/ground
      const strip =
        Math.abs(lum[i] - rowMean[y]) * 0.55 + Math.abs(lum[i] - colMean[x]) * 0.45;

      // Inverse luma + upper-frame bias (sky/far often brighter top)
      const base =
        (1 - radial * 0.95) * 0.32 +
        (1 - lum[i]) * 0.22 +
        (1 - ny) * 0.14 +
        blur4[i] * 0.08;

      let d =
        base +
        detail[i] * detailW * 0.85 +
        multi * 0.55 +
        grad[i] * detailW * 0.4 +
        strip * stripW * 0.5;

      d *= scale;
      out[i] = d;
      if (d < minV) minV = d;
      if (d > maxV) maxV = d;
    }
  }

  // Normalize to ~0.05..1.1 like other booth depths
  const range = Math.max(1e-5, maxV - minV);
  for (let i = 0; i < n; i++) {
    out[i] = 0.05 + ((out[i] - minV) / range) * 1.05;
  }
  return out;
}

/** Separable box blur (radius in pixels). */
function boxBlur(src, w, h, radius) {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const r = radius | 0;
  const k = r * 2 + 1;

  // horizontal
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) {
      sum += src[y * w + clamp(x, 0, w - 1)];
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / k;
      const drop = src[y * w + clamp(x - r, 0, w - 1)];
      const add = src[y * w + clamp(x + r + 1, 0, w - 1)];
      sum += add - drop;
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) {
      sum += tmp[clamp(y, 0, h - 1) * w + x];
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / k;
      const drop = tmp[clamp(y - r, 0, h - 1) * w + x];
      const add = tmp[clamp(y + r + 1, 0, h - 1) * w + x];
      sum += add - drop;
    }
  }
  return out;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Whether this depth sample survives distance filter. */
export function passesDepthFilter(depth01, params) {
  const lo = params.depthMin?.value ?? 0.05;
  const hi = params.depthMax?.value ?? 1.2;
  if (resolveDepthMode(params).id !== "filter") return true;
  return depth01 >= lo && depth01 <= hi;
}

/**
 * Color grade by depth (fog / warm-cool). Mutates r,g,b 0..255 → returns [r,g,b].
 */
export function gradeDepthColor(r, g, b, depth01, params) {
  const mode = resolveDepthMode(params).id;
  if (mode !== "fog" && mode !== "nested") return [r, g, b];

  const fogStart = params.depthFogStart?.value ?? 0.35;
  const fogEnd = params.depthFogEnd?.value ?? 1.1;
  const t = Math.max(0, Math.min(1, (depth01 - fogStart) / Math.max(0.001, fogEnd - fogStart)));
  const nearW = params.depthNearTint?.value ?? 0.35;
  const farC = params.depthFarTint?.value ?? 0.45;

  // Near warm (boost R), far cool (boost B)
  let nr = r * (1 + nearW * (1 - t) * 0.35);
  let ng = g * (1 + nearW * (1 - t) * 0.08);
  let nb = b * (1 + farC * t * 0.45);
  // Fog blend toward slate
  const fogR = 140,
    fogG = 155,
    fogB = 175;
  nr = nr * (1 - t * 0.55) + fogR * t * 0.55;
  ng = ng * (1 - t * 0.55) + fogG * t * 0.55;
  nb = nb * (1 - t * 0.55) + fogB * t * 0.55;
  return [
    Math.max(0, Math.min(255, nr)),
    Math.max(0, Math.min(255, ng)),
    Math.max(0, Math.min(255, nb)),
  ];
}

/** Selective-focus size multiplier for point/splat. */
export function focusSizeMul(depth01, params) {
  if (resolveDepthMode(params).id !== "focus") return 1;
  const plane = params.depthFocus?.value ?? 0.45;
  const range = params.depthFocusRange?.value ?? 0.22;
  const blur = Math.min(1, Math.abs(depth01 - plane) / Math.max(0.001, range));
  return 1 + blur * 1.8;
}

/** Turbo-ish depth viz for feed strip (Splatline depth_colored). */
export function depthVizRGB(v) {
  const t = Math.max(0, Math.min(1, v));
  // approximate turbo
  const r = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(t - 0.75) * 3)));
  const g = Math.round(255 * Math.min(1, Math.max(0, 1.2 - Math.abs(t - 0.5) * 2.2)));
  const b = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(t - 0.25) * 3)));
  return [r, g, b];
}

/**
 * Unproject a monocular depth field into spatial XYZ + color point cloud data.
 * Matches booth image convention (Y up, camera looking +Z into scene).
 *
 * @param {object} opts
 * @param {Float32Array|number[]} opts.depthField  length w*h, ~0..1.2 depth01
 * @param {Uint8ClampedArray|Uint8Array} opts.rgba  RGBA or RGB
 * @param {number} opts.w
 * @param {number} opts.h
 * @param {object} [opts.params] DEPTH_PARAMS / booth params
 * @param {Float32Array} [opts.personConf] optional mask weights 0..1
 * @param {number} [opts.stride]
 * @param {number} [opts.maxPoints]
 * @param {(x:number,y:number,w:number,h:number,lum:number,i:number)=>number} [opts.depthAt]
 * @returns {{
 *   positions: Float32Array,
 *   colors: Float32Array,
 *   depths: Float32Array,
 *   uvs: Float32Array,
 *   count: number,
 *   w: number,
 *   h: number,
 *   stride: number,
 *   meta: object
 * }}
 */
export function buildSpatialPointCloudFromDepth(opts) {
  const {
    depthField,
    rgba,
    w,
    h,
    params = {},
    personConf = null,
    stride: strideIn,
    maxPoints = w * h,
    depthAt = null,
  } = opts;
  const stride = Math.max(1, Math.round(strideIn ?? params.stride?.value ?? 3));
  const ch = rgba.length >= w * h * 4 ? 4 : 3;
  const aspect = w / Math.max(1, h);
  const lift = (params.depth?.value ?? 1.8) * (params.zSpread?.value ?? 1);
  const nearZ = params.depthNear?.value ?? 0.45;
  const farZ = params.depthFarZ?.value ?? 3.2;
  const persp = params.depthPerspective?.value ?? 0.65;
  const colorMix = params.depthCloudColor?.value ?? 0.35;
  const maskAmt = params.depthCloudMask?.value ?? 0;
  const planeScale = 1.35;

  // Cap capacity
  const est = Math.ceil(w / stride) * Math.ceil(h / stride);
  const cap = Math.min(maxPoints, est);
  const positions = new Float32Array(cap * 3);
  const colors = new Float32Array(cap * 3);
  const depths = new Float32Array(cap);
  const uvs = new Float32Array(cap * 2);
  let count = 0;

  for (let y = 0; y < h && count < cap; y += stride) {
    for (let x = 0; x < w && count < cap; x += stride) {
      const i = y * w + x;
      let d01 = depthAt ? depthAt(x, y, w, h, 0, i) : depthField?.[i];
      if (d01 == null || !Number.isFinite(d01)) continue;

      // Optional person-mask gate
      if (maskAmt > 0.01 && personConf) {
        const conf = personConf[i] ?? 0;
        if (conf < maskAmt * 0.35) continue;
        // Soft: push low-conf slightly farther / drop weight
        d01 = d01 * (0.55 + conf * 0.45);
      }

      if (!passesDepthFilter(d01, params)) continue;

      const o = i * ch;
      const r0 = rgba[o];
      const g0 = rgba[o + 1];
      const b0 = rgba[o + 2];
      if (ch === 4 && rgba[o + 3] < 8) continue;

      const nx = x / w;
      const ny = y / h;
      // Metric-ish Z from normalized depth (higher depth01 → farther)
      const zLin = nearZ + Math.max(0, Math.min(1.2, d01)) / 1.2 * (farZ - nearZ);
      const zFlat = d01 * lift * 0.55;
      const z = zFlat * (1 - persp) + zLin * persp;

      // Flat plane coords
      const flatX = (nx - 0.5) * aspect * planeScale;
      const flatY = -(ny - 0.5) * planeScale;
      // Perspective: scale XY by z (pinhole unproject, f≈1)
      const perspX = (nx - 0.5) * aspect * z * 0.95;
      const perspY = -(ny - 0.5) * z * 0.95;
      const px = flatX * (1 - persp) + perspX * persp;
      const py = flatY * (1 - persp) + perspY * persp;
      const pz = z;

      const [tr, tg, tb] = depthVizRGB(Math.max(0, Math.min(1, d01 / 1.2)));
      const r = r0 * (1 - colorMix) + tr * colorMix;
      const g = g0 * (1 - colorMix) + tg * colorMix;
      const b = b0 * (1 - colorMix) + tb * colorMix;

      const p = count * 3;
      positions[p] = px;
      positions[p + 1] = py;
      positions[p + 2] = pz;
      colors[p] = r / 255;
      colors[p + 1] = g / 255;
      colors[p + 2] = b / 255;
      depths[count] = d01;
      uvs[count * 2] = nx;
      uvs[count * 2 + 1] = ny;
      count++;
    }
  }

  return {
    positions: positions.subarray(0, count * 3),
    colors: colors.subarray(0, count * 3),
    depths: depths.subarray(0, count),
    uvs: uvs.subarray(0, count * 2),
    count,
    w,
    h,
    stride,
    meta: {
      nearZ,
      farZ,
      perspective: persp,
      colorMix,
      maskAmt,
      mode: resolveDepthMode(params).id,
    },
  };
}

/** Serialize spatial depth cloud to ASCII PLY (downloadable). */
export function spatialCloudToPly(cloud) {
  const n = cloud.count | 0;
  const pos = cloud.positions;
  const col = cloud.colors;
  const lines = [
    "ply",
    "format ascii 1.0",
    `element vertex ${n}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
  ];
  for (let i = 0; i < n; i++) {
    const p = i * 3;
    const r = Math.max(0, Math.min(255, Math.round((col[p] ?? 1) * 255)));
    const g = Math.max(0, Math.min(255, Math.round((col[p + 1] ?? 1) * 255)));
    const b = Math.max(0, Math.min(255, Math.round((col[p + 2] ?? 1) * 255)));
    lines.push(
      `${(pos[p] ?? 0).toFixed(5)} ${(pos[p + 1] ?? 0).toFixed(5)} ${(pos[p + 2] ?? 0).toFixed(5)} ${r} ${g} ${b}`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Compact JSON-friendly snapshot (may subsample for size). */
export function spatialCloudToJson(cloud, { maxPoints = 8000 } = {}) {
  const n = cloud.count | 0;
  const step = Math.max(1, Math.ceil(n / maxPoints));
  const points = [];
  for (let i = 0; i < n; i += step) {
    const p = i * 3;
    points.push({
      x: cloud.positions[p],
      y: cloud.positions[p + 1],
      z: cloud.positions[p + 2],
      r: cloud.colors[p],
      g: cloud.colors[p + 1],
      b: cloud.colors[p + 2],
      d: cloud.depths[i],
      u: cloud.uvs?.[i * 2],
      v: cloud.uvs?.[i * 2 + 1],
    });
  }
  return {
    count: n,
    exported: points.length,
    w: cloud.w,
    h: cloud.h,
    stride: cloud.stride,
    meta: cloud.meta,
    points,
  };
}
