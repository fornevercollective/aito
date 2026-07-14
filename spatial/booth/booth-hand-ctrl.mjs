/**
 * Hand tracking → waveform + depth controls.
 * Maps MediaPipe hands to booth params (depth lift, z-spread, ripple, beat pulse).
 *
 * Gesture vocabulary inspired by measure_plan (webcam MediaPipe + Three.js),
 * Leap Motion soft targets (ziyangwen), and live IK bus for aito spatial stack.
 * Resource catalog: ./hand-tracking-resources.mjs
 */

export const HAND_CTRL_PARAMS = {
  handControl: { min: 0, max: 1, step: 1, value: 1, label: "Hand control", group: "track" },
  handDepthGain: { min: 0, max: 2, step: 0.05, value: 0.85, label: "Hand → depth", group: "track" },
  handWaveGain: { min: 0, max: 2, step: 0.05, value: 1, label: "Hand → wave", group: "track" },
  handSmooth: { min: 0.05, max: 0.9, step: 0.02, value: 0.28, label: "Hand smooth", group: "track" },
  handGesture: { min: 0, max: 1, step: 1, value: 1, label: "Gesture mods", group: "track" },
};

/** MediaPipe: wrist=0, thumb tip=4, index tip=8, middle=12, ring=16, pinky=20 */
export const HAND_LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
};

/**
 * Classify a single hand pack into a coarse gesture label.
 * @param {{ palm: {x:number,y:number,z:number}, pinch: number, spread: number, tips?: object }} h
 */
export function classifyGesture(h) {
  if (!h) return "none";
  if (h.pinch > 0.72) return "pinch";
  if (h.spread < 0.22) return "fist";
  if (h.pointScore > 0.65 && h.spread < 0.55) return "point";
  if (h.peaceScore > 0.6) return "peace";
  if (h.spread > 0.72) return "open";
  return "neutral";
}

/**
 * Extract continuous control signals from TrackHub joint/finger points.
 */
export function extractHandSignals(trackHub) {
  const empty = {
    left: null,
    right: null,
    depthMod: 0,
    waveMod: 0,
    sizeMod: 0,
    spinMod: 0,
    pinchL: 0,
    pinchR: 0,
    gestureL: "none",
    gestureR: "none",
    twoHandSpan: 0,
    active: false,
  };
  if (!trackHub?.jointPoints?.length) return empty;

  const hands = { Left: [], Right: [] };
  for (const j of trackHub.jointPoints) {
    if (j.layer === "leftHand") hands.Left.push(j);
    if (j.layer === "rightHand") hands.Right.push(j);
  }

  const pack = (arr) => {
    if (!arr.length) return null;
    let sx = 0,
      sy = 0,
      sz = 0;
    for (const p of arr) {
      sx += p.nx;
      sy += p.ny;
      sz += p.nz ?? 0;
    }
    const n = arr.length;
    const palm = { x: sx / n, y: sy / n, z: sz / n };
    const tip = (idx) => arr.find((p) => p.idx === idx);
    const thumb = tip(HAND_LM.THUMB_TIP);
    const index = tip(HAND_LM.INDEX_TIP);
    const middle = tip(HAND_LM.MIDDLE_TIP);
    const ring = tip(HAND_LM.RING_TIP);
    const pinky = tip(HAND_LM.PINKY_TIP);
    const wrist = tip(HAND_LM.WRIST) || { nx: palm.x, ny: palm.y, nz: palm.z };

    let pinch = 0;
    if (thumb && index) {
      const d = Math.hypot(thumb.nx - index.nx, thumb.ny - index.ny);
      pinch = Math.max(0, Math.min(1, 1 - d / 0.18));
    }

    // Openness: average radial spread from palm in image space
    let spread = 0;
    for (const p of arr) {
      spread += Math.hypot(p.nx - palm.x, p.ny - palm.y);
    }
    spread = Math.min(1, spread / n / 0.12);

    // Point: index extended, other tips closer to palm
    const tipDist = (t) =>
      t ? Math.hypot(t.nx - wrist.nx, t.ny - wrist.ny) : 0;
    const iD = tipDist(index);
    const mD = tipDist(middle);
    const rD = tipDist(ring);
    const pD = tipDist(pinky);
    const pointScore =
      iD > 0.12 ? Math.max(0, Math.min(1, (iD - Math.max(mD, rD, pD) * 0.85) / 0.08 + 0.35)) : 0;

    // Peace: index + middle extended, ring/pinky curled
    const peaceScore =
      iD > 0.1 && mD > 0.1
        ? Math.max(0, Math.min(1, ((iD + mD) / 2 - (rD + pD) / 2) / 0.1))
        : 0;

    return {
      palm,
      pinch,
      spread,
      pointScore,
      peaceScore,
      count: n,
      tips: { thumb, index, middle, ring, pinky },
    };
  };

  const left = pack(hands.Left);
  const right = pack(hands.Right);
  if (!left && !right) return empty;

  const gestureL = classifyGesture(left);
  const gestureR = classifyGesture(right);

  // Left hand vertical → depth; palm z → depth stretch-ish
  let depthMod = 0;
  if (left) {
    depthMod += (0.5 - left.palm.y) * 0.9; // raise hand = more depth
    depthMod += left.spread * 0.25;
    depthMod -= left.pinch * 0.35;
    if (gestureL === "open") depthMod += 0.12;
    if (gestureL === "fist") depthMod -= 0.18;
    if (gestureL === "point") depthMod += (0.5 - left.palm.y) * 0.25;
  }
  // Right hand horizontal sweep → waveform; pinch → beat
  let waveMod = 0;
  let sizeMod = 0;
  let spinMod = 0;
  if (right) {
    waveMod += (right.palm.x - 0.5) * 1.2;
    waveMod += right.spread * 0.45;
    waveMod += right.pinch * 0.6;
    sizeMod += (0.5 - right.palm.y) * 0.5;
    spinMod += (right.palm.x - 0.5) * 0.8;
    if (gestureR === "peace") waveMod += 0.35;
    if (gestureR === "open") sizeMod += 0.15;
    if (gestureR === "fist") spinMod *= 0.35;
    if (gestureR === "point") spinMod += (right.palm.x - 0.5) * 0.45;
  }
  if (left) sizeMod += left.pinch * 0.2;

  // Two-hand span (Leap-like scale) when both palms present
  let twoHandSpan = 0;
  if (left && right) {
    twoHandSpan = Math.hypot(left.palm.x - right.palm.x, left.palm.y - right.palm.y);
    sizeMod += (twoHandSpan - 0.35) * 0.55;
    depthMod += (twoHandSpan - 0.3) * 0.2;
  }

  return {
    left,
    right,
    depthMod: Math.max(-1, Math.min(1, depthMod)),
    waveMod: Math.max(0, Math.min(1.5, Math.abs(waveMod))),
    sizeMod: Math.max(-0.5, Math.min(0.8, sizeMod)),
    spinMod: Math.max(-1, Math.min(1, spinMod)),
    pinchL: left?.pinch ?? 0,
    pinchR: right?.pinch ?? 0,
    gestureL,
    gestureR,
    twoHandSpan,
    active: true,
  };
}

/**
 * Smooth + apply hand signals onto PARAMS / musicBus / state.
 * Returns additive depth for computeDepth and waveform amp.
 */
export class HandController {
  constructor() {
    this.depthMod = 0;
    this.waveMod = 0;
    this.sizeMod = 0;
    this.spinMod = 0;
    this.signals = null;
    this._lastPing = 0;
    this._lastGesture = { L: "none", R: "none" };
  }

  /**
   * @param {import('./booth-tracks.mjs').TrackHub | null} trackHub
   * @param {object} params PARAMS
   * @param {object} musicBus
   * @param {number} now ms
   */
  update(trackHub, params, musicBus, now = performance.now()) {
    const on = (params.handControl?.value ?? 1) >= 0.5;
    if (!on || !trackHub) {
      this.signals = null;
      return { depthAdd: 0, waveform: 0, active: false };
    }

    const raw = extractHandSignals(trackHub);
    this.signals = raw;
    if (!raw.active) {
      this.depthMod *= 0.9;
      this.waveMod *= 0.9;
      return { depthAdd: this.depthMod, waveform: this.waveMod, active: false };
    }

    const a = params.handSmooth?.value ?? 0.28;
    const dg = params.handDepthGain?.value ?? 0.85;
    const wg = params.handWaveGain?.value ?? 1;
    const gestOn = (params.handGesture?.value ?? 1) >= 0.5;

    let depthTarget = raw.depthMod * dg;
    let waveTarget = raw.waveMod * wg;
    if (!gestOn) {
      // strip gesture boosts roughly — use base palm only scale
      depthTarget *= 0.85;
      waveTarget *= 0.85;
    }

    this.depthMod += (depthTarget - this.depthMod) * a;
    this.waveMod += (waveTarget - this.waveMod) * a;
    this.sizeMod += (raw.sizeMod - this.sizeMod) * a;
    this.spinMod += (raw.spinMod - this.spinMod) * a;

    // Waveform → music bus pulse on strong pinch / wave
    if (raw.pinchR > 0.55 && now - this._lastPing > 120) {
      musicBus?.ping?.(0.35 + raw.pinchR * 0.5, params.beatSens?.value ?? 1);
      this._lastPing = now;
    }
    // Peace / open: softer energy swell (Mirelo-style visual→audio affinity)
    if (gestOn && (raw.gestureR === "peace" || raw.gestureR === "open") && musicBus) {
      musicBus.energy = Math.min(1, (musicBus.energy || 0) + 0.03);
    }
    if (musicBus && this.waveMod > 0.08) {
      musicBus.energy = Math.min(1, musicBus.energy + this.waveMod * 0.04);
      musicBus.high = Math.min(1, (musicBus.high || 0) * 0.9 + this.waveMod * 0.08);
    }

    // Soft live writes into related params (non-destructive — store base on first touch)
    this._softWrite(params, "depth", this.depthMod * 0.55, 0.2, 5);
    this._softWrite(params, "depthWaveform", this.waveMod * 0.8, 0, 2);
    this._softWrite(params, "splatRipple", this.waveMod * 0.45, 0, 1);
    if (params.size) {
      this._softWrite(params, "size", this.sizeMod * 0.012, 0.002, 0.08);
    }
    if (params.spin) {
      this._softWrite(params, "spin", this.spinMod * 0.9, -4, 4);
    }

    this._lastGesture = { L: raw.gestureL, R: raw.gestureR };

    return {
      depthAdd: this.depthMod * 0.22,
      waveform: this.waveMod,
      active: true,
      left: raw.left,
      right: raw.right,
      gestureL: raw.gestureL,
      gestureR: raw.gestureR,
      twoHandSpan: raw.twoHandSpan,
    };
  }

  _softWrite(params, key, delta, min, max) {
    const spec = params[key];
    if (!spec) return;
    if (spec._handBase == null) spec._handBase = spec.value;
    const next = Math.max(min, Math.min(max, spec._handBase + delta));
    spec.value = next;
    if (typeof window.syncParamUi === "function") {
      window.syncParamUi(key, spec);
    } else if (spec.input) {
      if (spec.input.type === "checkbox") spec.input.checked = next >= 0.5;
      else spec.input.value = String(next);
      if (spec.output && typeof window.formatParam === "function") {
        spec.output.textContent = window.formatParam(key, next);
      }
    }
  }

  /** Camera / pivot guidance for handGuided motion mode */
  guideTarget(baseTarget) {
    const s = this.signals;
    if (!s?.active) return null;
    const hand = s.right?.palm || s.left?.palm;
    if (!hand) return null;
    return {
      x: (hand.x - 0.5) * 1.4,
      y: (0.5 - hand.y) * 1.0,
      z: baseTarget?.z ?? 0.5,
    };
  }

  /** Short HUD label for footer / IK stats */
  gestureLabel() {
    const s = this.signals;
    if (!s?.active) return "—";
    const L = s.gestureL !== "none" ? s.gestureL : null;
    const R = s.gestureR !== "none" ? s.gestureR : null;
    if (L && R) return `L:${L} R:${R}`;
    if (L) return `L:${L}`;
    if (R) return `R:${R}`;
    return "neutral";
  }
}
