/**
 * Scene auto-calibration — lightweight "AI" heuristics from live frames
 * (brightness, contrast, edge density, dual presence, screen content)
 * → best booth params for the current spatial scene.
 */

/** Presets refined by scene class */
const PRESETS = {
  dark_indoor: {
    depth: 2.1,
    zSpread: 2.0,
    size: 0.02,
    glow: 1.05,
    mask: 0.4,
    stride: 3,
    sphereNest: 0.28,
    sphereBlend: 0.5,
    stackScreenDist: 1.2,
    stackContentDepth: 0.9,
    dispersion: 0.05,
  },
  bright_desk: {
    depth: 1.55,
    zSpread: 1.65,
    size: 0.016,
    glow: 0.7,
    mask: 0.5,
    stride: 2,
    sphereNest: 0.2,
    sphereBlend: 0.55,
    stackScreenDist: 1.4,
    stackContentDepth: 0.65,
    dispersion: 0.04,
  },
  dual_wide: {
    depth: 1.85,
    zSpread: 1.9,
    size: 0.017,
    glow: 0.9,
    mask: 0.45,
    stride: 3,
    sphereNest: 0.26,
    sphereBlend: 0.62,
    stackCamBDist: 2.1,
    stackCamBAz: 1.0,
    spatialDualBaseline: 1.35,
    stackScreenDist: 1.5,
    stackContentDepth: 0.7,
  },
  screen_heavy: {
    depth: 1.7,
    zSpread: 1.75,
    size: 0.015,
    glow: 0.8,
    mask: 0.48,
    stride: 2,
    sphereNest: 0.24,
    sphereBlend: 0.48,
    stackScreenDist: 1.55,
    stackContentDepth: 1.05,
    stackScreenW: 1.65,
    spatialScreenBaseline: -1.1,
  },
  outdoor_ish: {
    depth: 1.4,
    zSpread: 1.5,
    size: 0.014,
    glow: 0.55,
    mask: 0.55,
    stride: 3,
    sphereNest: 0.18,
    sphereBlend: 0.45,
    fog: 0.02,
  },
  /** Multi-host news/podcast table — seated mid-frame, set as backdrop */
  podcast_table: {
    depth: 1.75,
    zSpread: 1.55,
    size: 0.015,
    glow: 0.95,
    mask: 0.42,
    stride: 2,
    sphereNest: 0.22,
    sphereBlend: 0.58,
    stackScreenDist: 2.85,
    stackContentDepth: 0.85,
    stackPeopleDepth: 1.35,
    spatialScreen: 1,
    stackEnable: 1,
    dispersion: 0.05,
    studioPeopleDepth: 1.35,
    studioScreenDist: 2.85,
    studioCluster: 1.05,
    studioPerspective: 0.48,
    studioColCount: 7,
    studioColHeight: 1.15,
    studioWaveGain: 2.0,
    depthWaveform: 0.95,
    musicalGain: 1.35,
  },
  /** Elevated plaza / spire multi-cam crowd (Makkah Live–style circular flow) */
  crowd_spire: {
    depth: 2.25,
    zSpread: 2.35,
    size: 0.022,
    glow: 1.35,
    mask: 0.28,
    stride: 2,
    sphereNest: 0.38,
    sphereBlend: 0.48,
    sphereParallax: 0.95,
    stackScreenDist: 2.55,
    stackContentDepth: 1.05,
    stackPeopleDepth: 1.65,
    spatialScreen: 1,
    stackEnable: 1,
    dispersion: 0.08,
    studioPeopleDepth: 1.65,
    studioScreenDist: 2.55,
    studioCluster: 1.35,
    studioPerspective: 0.72,
    studioColCount: 14,
    studioColHeight: 0.85,
    studioWaveGain: 2.6,
    studioLidarRate: 1.8,
    depthWaveform: 1.45,
    depthVariation: 0.95,
    musicalGain: 1.55,
    analysisEnable: 1,
    analysisPredict: 1,
    analysisWaveLift: 1.45,
  },
};

/**
 * Analyze RGBA buffer → scene features.
 * @param {Uint8ClampedArray|Uint8Array} data
 * @param {number} w
 * @param {number} h
 */
export function analyzeScene(data, w, h, ctx = {}) {
  if (!data?.length || !w || !h) {
    return { class: "bright_desk", confidence: 0.2, features: {} };
  }
  const step = Math.max(1, Math.floor(Math.min(w, h) / 48));
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  let edge = 0;
  let warm = 0;
  let cool = 0;
  for (let y = 0; y < h - step; y += step) {
    for (let x = 0; x < w - step; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      sum += lum;
      sum2 += lum * lum;
      n++;
      if (r > b + 0.08) warm++;
      if (b > r + 0.08) cool++;
      // simple gradient
      const i2 = (y * w + x + step) * 4;
      const lum2 =
        (data[i2] * 0.299 + data[i2 + 1] * 0.587 + data[i2 + 2] * 0.114) / 255;
      edge += Math.abs(lum2 - lum);
    }
  }
  const mean = n ? sum / n : 0.5;
  const variance = n ? Math.max(0, sum2 / n - mean * mean) : 0.05;
  const contrast = Math.sqrt(variance);
  const edgeDensity = n ? edge / n : 0;
  const warmRatio = n ? warm / n : 0;
  const coolRatio = n ? cool / n : 0;

  const hasDual = !!ctx.hasDual;
  const hasScreen = !!ctx.hasScreen;
  const personFrac = ctx.personFrac ?? 0.35;

  const forceClass = ctx.forceClass || null;
  const studioPodcast = !!ctx.studioPodcast || forceClass === "podcast_table";
  const studioCrowd = !!ctx.studioCrowd || forceClass === "crowd_spire";
  const flowEnergy = ctx.flowEnergy ?? 0;
  const circularity = ctx.circularity ?? 0;
  const clusterCount = ctx.clusterCount ?? 0;

  let cls = "bright_desk";
  let conf = 0.55;
  if (forceClass && PRESETS[forceClass]) {
    cls = forceClass;
    conf = 0.9;
  } else if (studioCrowd) {
    cls = "crowd_spire";
    conf = 0.9;
  } else if (
    personFrac > 0.35 &&
    (clusterCount >= 3 || circularity > 0.4 || (hasScreen && edgeDensity > 0.06 && personFrac > 0.5))
  ) {
    // Dense multi-person plaza / elevated cam without explicit flag
    cls = "crowd_spire";
    conf = 0.8 + Math.min(0.12, personFrac * 0.15);
  } else if (studioPodcast) {
    // Seated multi-host table: mid exposure, moderate edges, people in frame
    cls = "podcast_table";
    conf = 0.88;
  } else if (mean < 0.28) {
    cls = "dark_indoor";
    conf = 0.7;
  } else if (mean > 0.72 && contrast < 0.12) {
    cls = "outdoor_ish";
    conf = 0.6;
  } else if (hasScreen && personFrac >= 0.22 && personFrac <= 0.72 && edgeDensity > 0.04) {
    // Screen + people mid-frame → podcast/news desk rather than pure screen
    cls = "podcast_table";
    conf = 0.78;
  } else if (hasScreen && (!hasDual || personFrac < 0.25)) {
    cls = "screen_heavy";
    conf = 0.72;
  } else if (hasDual) {
    cls = "dual_wide";
    conf = 0.75;
  } else if (edgeDensity > 0.08 && personFrac > 0.2) {
    cls = "bright_desk";
    conf = 0.65;
  }

  // Blend confidence with content signals
  if (hasScreen && hasDual) conf = Math.min(0.92, conf + 0.12);
  if (cls === "podcast_table" && personFrac > 0.3) conf = Math.min(0.94, conf + 0.06);
  if (cls === "crowd_spire") {
    conf = Math.min(0.96, conf + circularity * 0.08 + Math.min(0.08, flowEnergy * 0.1));
  }

  return {
    class: cls,
    confidence: conf,
    features: {
      mean,
      contrast,
      edgeDensity,
      warmRatio,
      coolRatio,
      personFrac,
      hasDual,
      hasScreen,
      flowEnergy,
      circularity,
      clusterCount,
    },
  };
}

/**
 * Apply calibrated preset into PARAMS with optional blend (0..1).
 * @returns {{ class: string, confidence: number, applied: string[] }}
 */
export function applyAutoCal(analysis, params, blend = 0.85) {
  const preset = PRESETS[analysis.class] || PRESETS.bright_desk;
  const applied = [];
  const f = analysis.features || {};

  // Start from preset
  const target = { ...preset };

  // Fine-tune from features
  if (f.mean != null) {
    // darker → more depth lift & glow
    target.depth = (target.depth ?? 1.8) + (0.45 - f.mean) * 0.6;
    target.glow = (target.glow ?? 0.85) + (0.4 - f.mean) * 0.4;
  }
  if (f.contrast != null && f.contrast < 0.08) {
    target.splatSharp = 8;
    target.size = (target.size ?? 0.018) * 1.1;
  }
  if (f.edgeDensity != null && f.edgeDensity > 0.1) {
    target.stride = Math.max(2, Math.round((target.stride ?? 3) - 1));
  }
  if (f.hasDual) {
    target.spatialDual = 1;
    target.stackEnable = 1;
  }
  if (f.hasScreen) {
    target.spatialScreen = 1;
    target.stackEnable = 1;
    target.stackContentDepth = (target.stackContentDepth ?? 0.75) + f.contrast * 0.4;
  }
  if (f.personFrac != null && f.personFrac > 0.45) {
    target.mask = Math.min(0.7, (target.mask ?? 0.45) + 0.05);
  }

  // Crowd / plaza motion → follow people with depth, wave, mask, cluster
  if (analysis.class === "crowd_spire") {
    const pf = f.personFrac ?? 0.4;
    const flow = f.flowEnergy ?? 0;
    const circ = f.circularity ?? 0;
    // denser crowd → lower mask thr (keep more people), tighter stride
    target.mask = Math.max(0.18, Math.min(0.42, 0.38 - pf * 0.18));
    target.feather = Math.max(0.12, Math.min(0.28, 0.14 + pf * 0.12));
    target.stride = pf > 0.55 ? 2 : pf > 0.35 ? 2 : 3;
    // motion energy lifts depth waveform + people depth
    target.depth = 1.9 + pf * 0.55 + flow * 0.35;
    target.zSpread = 1.9 + pf * 0.5 + circ * 0.4;
    target.depthWaveform = 0.9 + flow * 0.7 + circ * 0.45;
    target.depthVariation = 0.65 + flow * 0.35 + circ * 0.25;
    target.studioPeopleDepth = 1.35 + pf * 0.45 + flow * 0.2;
    target.studioCluster = 1.1 + Math.min(0.4, (f.clusterCount || 3) * 0.05);
    target.analysisWaveLift = 1.1 + flow * 0.55 + circ * 0.4;
    target.studioWaveGain = 2.1 + flow * 0.6;
    target.size = 0.018 + Math.min(0.014, pf * 0.02);
    target.glow = 1.05 + flow * 0.25;
    target.sphereParallax = 0.7 + circ * 0.4;
    target.studioTrails = 1;
    target.studioColumns = 1;
    target.studioMode = 1;
    target.analysisEnable = 1;
  }

  // Write into params
  for (const [key, val] of Object.entries(target)) {
    const spec = params[key];
    if (!spec || typeof val !== "number") continue;
    const next = spec.value * (1 - blend) + val * blend;
    const clamped = Math.max(spec.min, Math.min(spec.max, next));
    spec.value = clamped;
    delete spec._handBase;
    if (typeof window.syncParamUi === "function") {
      window.syncParamUi(key, spec);
    } else if (spec.input) {
      if (spec.input.type === "checkbox") spec.input.checked = clamped >= 0.5;
      else spec.input.value = String(clamped);
      if (spec.output && typeof window.formatParam === "function") {
        spec.output.textContent = window.formatParam(key, clamped);
      }
    }
    applied.push(key);
  }

  return {
    class: analysis.class,
    confidence: analysis.confidence,
    applied,
    label: classLabel(analysis.class),
  };
}

export function classLabel(cls) {
  return (
    {
      dark_indoor: "Dark indoor",
      bright_desk: "Bright desk",
      dual_wide: "Dual wide",
      screen_heavy: "Screen-forward",
      outdoor_ish: "Bright / flat",
      podcast_table: "Podcast table",
      crowd_spire: "Crowd spire · plaza",
    }[cls] || cls
  );
}

/**
 * Controller: throttle auto-cal while streaming.
 */
export class AutoCalibrator {
  constructor() {
    this.lastMs = 0;
    this.lastResult = null;
    this.intervalMs = 2800;
    /** Faster loop when tracking crowd motion */
    this.crowdIntervalMs = 900;
    this.enabled = false;
    this.mode = "default"; // default | crowd
  }

  /**
   * @param {object} opts
   * @param {Uint8ClampedArray} opts.rgb
   * @param {number} opts.w
   * @param {number} opts.h
   * @param {object} opts.params
   * @param {object} opts.ctx scene context flags
   * @param {number} opts.now
   * @param {boolean} [opts.force]
   */
  tick({ rgb, w, h, params, ctx, now, force = false }) {
    if (!this.enabled && !force) return null;
    const crowd =
      !!ctx?.studioCrowd ||
      ctx?.forceClass === "crowd_spire" ||
      this.mode === "crowd" ||
      (params?.analysisEnable?.value ?? 0) >= 0.5 && (params?.studioMode?.value ?? 0) >= 0.5;
    if (crowd) this.mode = "crowd";
    const interval = crowd ? this.crowdIntervalMs : this.intervalMs;
    if (!force && now - this.lastMs < interval) {
      // Soft continuous track for crowd between full calibrations
      if (crowd && this.lastResult) {
        this._softTrackCrowd(params, ctx);
      }
      return this.lastResult;
    }
    this.lastMs = now;
    const analysis = analyzeScene(rgb, w, h, {
      ...ctx,
      studioCrowd: crowd || !!ctx?.studioCrowd,
    });
    // Gentle blend when tracking live motion so cloud breathes with the crowd
    const blend = force ? 0.92 : crowd ? 0.38 : 0.55;
    const result = applyAutoCal(analysis, params, blend);
    this.lastResult = { ...result, features: analysis.features, at: now, mode: this.mode };
    return this.lastResult;
  }

  /**
   * Lightweight per-tick adjust from live cluster / flow signals (no full scene re-analysis).
   */
  _softTrackCrowd(params, ctx) {
    if (!params) return;
    const flow = ctx?.flowEnergy ?? 0;
    const circ = ctx?.circularity ?? 0;
    const pf = ctx?.personFrac ?? 0.4;
    const soft = (key, target, rate = 0.12) => {
      const spec = params[key];
      if (!spec || typeof target !== "number") return;
      const next = spec.value * (1 - rate) + target * rate;
      spec.value = Math.max(spec.min, Math.min(spec.max, next));
    };
    soft("depthWaveform", 0.85 + flow * 0.85 + circ * 0.4, 0.1);
    soft("analysisWaveLift", 1.05 + flow * 0.6 + circ * 0.35, 0.1);
    soft("depth", 1.85 + pf * 0.5 + flow * 0.3, 0.08);
    soft("studioPeopleDepth", 1.3 + pf * 0.4 + flow * 0.25, 0.08);
    soft("mask", Math.max(0.16, 0.32 - pf * 0.18), 0.08);
    soft("feather", Math.min(0.28, 0.14 + pf * 0.12), 0.06);
    soft("crowdMotionGain", 0.75 + flow * 0.5, 0.08);
    soft("studioWaveGain", 2.0 + flow * 0.7, 0.08);
    soft("stride", pf > 0.4 ? 2 : 3, 0.15);
  }
}
