/**
 * Live MediaPipe IK toolkit — compute-friendly alternative to offline Splatline jobs.
 *
 * Philosophy:
 *  - Keep interactions on-device (WebGPU/CPU MediaPipe) at sample resolution
 *  - Build bone chains + simple 2-bone analytic IK for arms/legs
 *  - Expose control bus for depth / wave / spin / QBPM MIDI-ish params
 *  - Splatline (:8787) remains offline bake only — not in the live loop
 */

export const TRACK_PROFILES = {
  hands: {
    id: "hands",
    label: "Hands only",
    desc: "Lightest · hand landmarks + pinch IK",
    face: false,
    hands: true,
    pose: false,
    everyN: 1,
  },
  body: {
    id: "body",
    label: "Body + hands",
    desc: "Pose skeleton + hands · no face mesh",
    face: false,
    hands: true,
    pose: true,
    everyN: 1,
  },
  full: {
    id: "full",
    label: "Full track",
    desc: "Face + hands + pose (heavier)",
    face: true,
    hands: true,
    pose: true,
    everyN: 1,
  },
  eco: {
    id: "eco",
    label: "Eco · 2-frame skip",
    desc: "Body+hands every 2nd sample frame",
    face: false,
    hands: true,
    pose: true,
    everyN: 2,
  },
};

export const IK_PARAMS = {
  ikEnable: { min: 0, max: 1, step: 1, value: 1, label: "Live IK", group: "track" },
  ikProfile: { min: 0, max: 3, step: 1, value: 1, label: "Track profile", group: "track" },
  ikSmooth: { min: 0.05, max: 0.85, step: 0.02, value: 0.32, label: "IK smooth", group: "track" },
  ikReach: { min: 0.4, max: 2.2, step: 0.05, value: 1, label: "IK reach", group: "track" },
  ikDrawBones: { min: 0, max: 1, step: 1, value: 1, label: "Draw bone chains", group: "track" },
  ikInteract: { min: 0, max: 1, step: 1, value: 1, label: "IK → cloud mods", group: "track" },
};

const PROFILE_KEYS = ["hands", "body", "full", "eco"];

export function profileFromParam(v) {
  const i = Math.max(0, Math.min(PROFILE_KEYS.length - 1, Math.round(Number(v) || 0)));
  return TRACK_PROFILES[PROFILE_KEYS[i]] || TRACK_PROFILES.body;
}

/** MediaPipe pose landmark indices */
export const POSE = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
};

/** Hand landmark indices */
export const HAND = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
};

/**
 * Analytic 2-bone IK in 2D (normalized image space).
 * Returns elbow position that reaches target from root with fixed bone lengths.
 */
export function solveTwoBone2D(root, mid, target, reachScale = 1) {
  if (!root || !target) return mid || null;
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const l1 = mid
    ? Math.hypot(mid.x - root.x, mid.y - root.y) * reachScale
    : 0.12 * reachScale;
  const l2 = mid
    ? Math.hypot(target.x - mid.x, target.y - mid.y) * reachScale
    : 0.12 * reachScale;
  const maxD = l1 + l2 - 1e-4;
  const minD = Math.abs(l1 - l2) + 1e-4;
  const d = Math.max(minD, Math.min(maxD, dist));
  // Law of cosines — elbow bend
  let cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  cosA = Math.max(-1, Math.min(1, cosA));
  const a = Math.acos(cosA);
  const base = Math.atan2(dy, dx);
  // Prefer previous mid side for continuity
  let sign = 1;
  if (mid) {
    const cross = (mid.x - root.x) * dy - (mid.y - root.y) * dx;
    sign = cross >= 0 ? 1 : -1;
  }
  const elbowAngle = base + sign * a;
  return {
    x: root.x + Math.cos(elbowAngle) * l1,
    y: root.y + Math.sin(elbowAngle) * l1,
    z: mid?.z ?? (root.z + target.z) * 0.5,
  };
}

function lm(list, i) {
  const p = list?.[i];
  if (!p) return null;
  const vis = p.visibility ?? 1;
  if (vis < 0.25) return null;
  return { x: p.x, y: p.y, z: p.z ?? 0, v: vis };
}

function smoothPt(prev, next, a) {
  if (!next) return prev;
  if (!prev) return { ...next };
  return {
    x: prev.x + (next.x - prev.x) * a,
    y: prev.y + (next.y - prev.y) * a,
    z: prev.z + ((next.z ?? 0) - (prev.z ?? 0)) * a,
    v: next.v ?? 1,
  };
}

function chainLen(pts) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    if (!pts[i - 1] || !pts[i]) continue;
    n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return n;
}

/**
 * Live IK session — reads TrackHub landmarks, builds chains, control bus.
 */
export class LiveIK {
  constructor() {
    this.profileId = "body";
    this.frame = 0;
    this.lastMs = 0;
    this.chains = {};
    this.control = {
      depth: 0,
      wave: 0,
      spin: 0,
      size: 0,
      pinchL: 0,
      pinchR: 0,
      reachL: 0,
      reachR: 0,
      openL: 0,
      openR: 0,
      torsoLean: 0,
      active: false,
    };
    this._smooth = {};
    this.skeletonPts = []; // for joint cloud / debug draw
    this.boneLines = []; // [{a,b,color}]
  }

  get profile() {
    return TRACK_PROFILES[this.profileId] || TRACK_PROFILES.body;
  }

  setProfile(id) {
    if (TRACK_PROFILES[id]) this.profileId = id;
  }

  setProfileFromParam(v) {
    this.setProfile(profileFromParam(v).id);
  }

  /**
   * @param {import('./booth-tracks.mjs').TrackHub | null} trackHub
   * @param {object} params
   */
  update(trackHub, params = {}) {
    const t0 = performance.now();
    this.frame += 1;
    const enabled = (params.ikEnable?.value ?? 1) >= 0.5;
    if (!enabled || !trackHub?.ready) {
      this.control.active = false;
      this.skeletonPts = [];
      this.boneLines = [];
      this.lastMs = performance.now() - t0;
      return this.control;
    }

    this.setProfileFromParam(params.ikProfile?.value);
    const a = params.ikSmooth?.value ?? 0.32;
    const reach = params.ikReach?.value ?? 1;
    const interact = (params.ikInteract?.value ?? 1) >= 0.5;

    // Pull raw joints from TrackHub
    const joints = trackHub.jointPoints || [];
    const byLayer = {};
    for (const j of joints) {
      (byLayer[j.layer] ||= []).push(j);
    }

    const pose0 = (byLayer.pose0 || []).sort((p, q) => p.idx - q.idx);
    const poseMap = new Map(pose0.map((j) => [j.idx, { x: j.nx, y: j.ny, z: j.nz ?? 0, v: j.r ?? 1 }]));

    const handSide = (side) => {
      const arr = (byLayer[side] || []).sort((p, q) => p.idx - q.idx);
      const m = new Map(arr.map((j) => [j.idx, { x: j.nx, y: j.ny, z: j.nz ?? 0, v: j.r ?? 1 }]));
      return m;
    };
    const Lh = handSide("leftHand");
    const Rh = handSide("rightHand");

    const get = (map, i) => map.get(i) || null;

    // --- Arm chains with 2-bone IK toward wrist (stabilize mid joint) ---
    const arm = (prefix, shI, elI, wrI, handMap) => {
      const sh = get(poseMap, shI) || this._smooth[`${prefix}_sh`];
      let el = get(poseMap, elI);
      const wrTrack = get(poseMap, wrI);
      // Prefer hand wrist if present (higher res)
      const wrHand = handMap.get(HAND.WRIST);
      const wr = wrHand || wrTrack;
      if (!sh || !wr) return null;
      const elIk = solveTwoBone2D(sh, el, wr, reach);
      const sSh = smoothPt(this._smooth[`${prefix}_sh`], sh, a);
      const sEl = smoothPt(this._smooth[`${prefix}_el`], elIk || el, a);
      const sWr = smoothPt(this._smooth[`${prefix}_wr`], wr, a);
      this._smooth[`${prefix}_sh`] = sSh;
      this._smooth[`${prefix}_el`] = sEl;
      this._smooth[`${prefix}_wr`] = sWr;
      // Finger tips
      const tips = [HAND.THUMB_TIP, HAND.INDEX_TIP, HAND.MIDDLE_TIP, HAND.RING_TIP, HAND.PINKY_TIP]
        .map((i) => handMap.get(i))
        .filter(Boolean)
        .map((p, k) => smoothPt(this._smooth[`${prefix}_t${k}`], p, a));
      tips.forEach((p, k) => {
        this._smooth[`${prefix}_t${k}`] = p;
      });
      return { sh: sSh, el: sEl, wr: sWr, tips };
    };

    const leftArm = arm("L", POSE.L_SHOULDER, POSE.L_ELBOW, POSE.L_WRIST, Lh);
    const rightArm = arm("R", POSE.R_SHOULDER, POSE.R_ELBOW, POSE.R_WRIST, Rh);

    // Legs
    const leg = (prefix, hipI, kneeI, ankleI) => {
      const hip = get(poseMap, hipI);
      const knee = get(poseMap, kneeI);
      const ankle = get(poseMap, ankleI);
      if (!hip || !ankle) return null;
      const kIk = solveTwoBone2D(hip, knee, ankle, reach);
      const sH = smoothPt(this._smooth[`${prefix}_hip`], hip, a);
      const sK = smoothPt(this._smooth[`${prefix}_knee`], kIk || knee, a);
      const sA = smoothPt(this._smooth[`${prefix}_ankle`], ankle, a);
      this._smooth[`${prefix}_hip`] = sH;
      this._smooth[`${prefix}_knee`] = sK;
      this._smooth[`${prefix}_ankle`] = sA;
      return { hip: sH, knee: sK, ankle: sA };
    };
    const leftLeg = leg("Ll", POSE.L_HIP, POSE.L_KNEE, POSE.L_ANKLE);
    const rightLeg = leg("Rl", POSE.R_HIP, POSE.R_KNEE, POSE.R_ANKLE);

    // Hands-only pinch when no pose
    const pinchFrom = (handMap) => {
      const t = handMap.get(HAND.THUMB_TIP);
      const i = handMap.get(HAND.INDEX_TIP);
      if (!t || !i) return 0;
      const d = Math.hypot(t.x - i.x, t.y - i.y);
      return Math.max(0, Math.min(1, 1 - d / 0.16));
    };
    const openFrom = (handMap) => {
      const w = handMap.get(HAND.WRIST);
      if (!w) return 0;
      let s = 0;
      let n = 0;
      for (const i of [HAND.THUMB_TIP, HAND.INDEX_TIP, HAND.MIDDLE_TIP, HAND.RING_TIP, HAND.PINKY_TIP]) {
        const p = handMap.get(i);
        if (!p) continue;
        s += Math.hypot(p.x - w.x, p.y - w.y);
        n++;
      }
      return n ? Math.min(1, s / n / 0.14) : 0;
    };

    const pinchL = leftArm?.tips?.length ? pinchFrom(Lh) : pinchFrom(Lh);
    const pinchR = pinchFrom(Rh);
    const openL = openFrom(Lh);
    const openR = openFrom(Rh);

    // Control bus — faster / cheaper than Splatline offline
    let depth = 0;
    let wave = 0;
    let spin = 0;
    let size = 0;
    if (leftArm?.wr) {
      depth += (0.55 - leftArm.wr.y) * 1.1;
      depth += openL * 0.2 - pinchL * 0.35;
    }
    if (rightArm?.wr) {
      wave += Math.abs(rightArm.wr.x - 0.5) * 1.3 + openR * 0.4 + pinchR * 0.55;
      spin += (rightArm.wr.x - 0.5) * 1.1;
      size += (0.5 - rightArm.wr.y) * 0.55;
    }
    // Torso lean from shoulders/hips
    let lean = 0;
    const ls = get(poseMap, POSE.L_SHOULDER);
    const rs = get(poseMap, POSE.R_SHOULDER);
    if (ls && rs) lean = (rs.y - ls.y) * 4;
    spin += lean * 0.35;

    const reachL = leftArm ? chainLen([leftArm.sh, leftArm.el, leftArm.wr]) : 0;
    const reachR = rightArm ? chainLen([rightArm.sh, rightArm.el, rightArm.wr]) : 0;

    const rawCtrl = {
      depth: Math.max(-1, Math.min(1, depth)),
      wave: Math.max(0, Math.min(1.6, wave)),
      spin: Math.max(-1, Math.min(1, spin)),
      size: Math.max(-0.6, Math.min(0.8, size)),
      pinchL,
      pinchR,
      reachL,
      reachR,
      openL,
      openR,
      torsoLean: lean,
      active: !!(leftArm || rightArm || Lh.size || Rh.size || pose0.length),
    };

    // Smooth control
    const ca = a;
    for (const k of ["depth", "wave", "spin", "size", "pinchL", "pinchR", "reachL", "reachR", "openL", "openR", "torsoLean"]) {
      const prev = this.control[k] ?? 0;
      this.control[k] = prev + (rawCtrl[k] - prev) * ca;
    }
    this.control.active = rawCtrl.active;

    this.chains = { leftArm, rightArm, leftLeg, rightLeg };
    this._buildSkeletonViz(params);
    this.lastMs = performance.now() - t0;

    // Soft-write cloud params when interact on
    if (interact && this.control.active) {
      this._softWrite(params, "depth", this.control.depth * 0.5, 0.2, 5);
      this._softWrite(params, "depthWaveform", this.control.wave * 0.75, 0, 2);
      this._softWrite(params, "splatRipple", this.control.wave * 0.4, 0, 1);
      if (params.spin) this._softWrite(params, "spin", this.control.spin * 0.85, -4, 4);
      if (params.size) this._softWrite(params, "size", this.control.size * 0.01, 0.002, 0.08);
    }

    return this.control;
  }

  _softWrite(params, key, delta, min, max) {
    const spec = params[key];
    if (!spec) return;
    if (spec._ikBase == null) spec._ikBase = spec.value;
    const next = Math.max(min, Math.min(max, spec._ikBase + delta));
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

  _buildSkeletonViz(params) {
    const draw = (params.ikDrawBones?.value ?? 1) >= 0.5;
    this.skeletonPts = [];
    this.boneLines = [];
    if (!draw) return;

    const pushChain = (pts, color) => {
      const clean = pts.filter(Boolean);
      for (const p of clean) {
        this.skeletonPts.push({ nx: p.x, ny: p.y, nz: p.z ?? 0, color, r: p.v ?? 1 });
      }
      for (let i = 1; i < clean.length; i++) {
        this.boneLines.push({ a: clean[i - 1], b: clean[i], color });
      }
    };

    if (this.chains.leftArm) {
      const a = this.chains.leftArm;
      pushChain([a.sh, a.el, a.wr, ...(a.tips || [])], [0.95, 0.45, 0.7]);
    }
    if (this.chains.rightArm) {
      const a = this.chains.rightArm;
      pushChain([a.sh, a.el, a.wr, ...(a.tips || [])], [0.4, 0.65, 0.98]);
    }
    if (this.chains.leftLeg) {
      const a = this.chains.leftLeg;
      pushChain([a.hip, a.knee, a.ankle], [0.3, 0.9, 0.55]);
    }
    if (this.chains.rightLeg) {
      const a = this.chains.rightLeg;
      pushChain([a.hip, a.knee, a.ankle], [0.35, 0.75, 0.5]);
    }
  }

  /** Snapshot for QBPM / external tools */
  toBus() {
    return {
      type: "aito-ik",
      t: performance.now(),
      profile: this.profileId,
      ms: this.lastMs,
      control: { ...this.control },
      chains: {
        leftArm: this.chains.leftArm
          ? { wr: this.chains.leftArm.wr, pinch: this.control.pinchL, open: this.control.openL }
          : null,
        rightArm: this.chains.rightArm
          ? { wr: this.chains.rightArm.wr, pinch: this.control.pinchR, open: this.control.openR }
          : null,
      },
    };
  }
}

/**
 * Decide which MediaPipe models a profile needs (for lazy init).
 */
export function modelsForProfile(profileId) {
  const p = TRACK_PROFILES[profileId] || TRACK_PROFILES.body;
  return { face: p.face, hands: p.hands, pose: p.pose, everyN: p.everyN };
}
