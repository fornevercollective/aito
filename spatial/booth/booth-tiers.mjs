/** Tier definitions — isolation layers, voxel slots, render mode. */

export const TIERS = {
  1: {
    id: 1,
    label: "Tier 1 · seg cloud",
    desc: "Selfie seg → depth point cloud + MIDI",
    render: "points",
    tracking: false,
    audio: false,
  },
  2: {
    id: 2,
    label: "Tier 2 · track + voxel",
    desc: "Face/hand/pose isolation · voxel stack · gsplat pulse",
    render: "gsplat",
    tracking: true,
    audio: false,
  },
  3: {
    id: 3,
    label: "Tier 3 · musical gsplat",
    desc: "Finger/joint layers · live musicality bus · all feeds",
    render: "gsplat",
    tracking: true,
    audio: false,
  },
  4: {
    id: 4,
    label: "Tier 4 · audio gsplat",
    desc: "Mic FFT · bass/mid/high drive · full splat music path",
    render: "gsplat",
    tracking: true,
    audio: true,
  },
};

export const MAX_PEOPLE = 4;

export const PERSON_FEEDS = {
  person: { id: "person", label: "Person A", process: true, tint: [249, 115, 22], voxelSlot: 0, tierMin: 1, personIdx: 0 },
  person2: { id: "person2", label: "Person B", process: true, tint: [251, 146, 60], voxelSlot: 8, tierMin: 2, personIdx: 1 },
  person3: { id: "person3", label: "Person C", process: false, tint: [234, 88, 12], voxelSlot: 9, tierMin: 2, personIdx: 2 },
  person4: { id: "person4", label: "Person D", process: false, tint: [194, 65, 12], voxelSlot: 10, tierMin: 2, personIdx: 3 },
};

export const BASE_FEEDS = {
  camera: { id: "camera", label: "Desktop", process: false, tint: null, voxelSlot: null, tierMin: 1 },
  /** Continuity Camera / secondary stream (spatial dual-cam) */
  iphone: { id: "iphone", label: "Dual · iPhone", process: true, tint: [52, 211, 153], voxelSlot: 11, tierMin: 1 },
  /** Screen / window share as independent spatial sphere layer */
  screen: { id: "screen", label: "Screen", process: true, tint: [148, 163, 184], voxelSlot: 13, tierMin: 1 },
  background: { id: "background", label: "Background", process: false, tint: [56, 189, 248], voxelSlot: 5, tierMin: 1 },
  /** Spatial point cloud from monocular depth pass (ZipDepth / JAX / radial). */
  depth: { id: "depth", label: "Depth cloud", process: true, tint: [56, 189, 248], voxelSlot: 14, tierMin: 1 },
  edge: { id: "edge", label: "Edge", process: true, tint: [167, 139, 250], voxelSlot: 12, tierMin: 1 },
  composite: { id: "composite", label: "Composite", process: true, tint: null, voxelSlot: null, tierMin: 1 },
};

/** Spatial multi-source mix — dual Continuity + screen/window into voxel sphere */
export const SPATIAL_SOURCE_PARAMS = {
  spatialDual: { min: 0, max: 1, step: 1, value: 1, label: "Spatial · Dual", group: "spatial" },
  spatialScreen: { min: 0, max: 1, step: 1, value: 1, label: "Spatial · Screen", group: "spatial" },
  spatialDualBaseline: { min: 0, max: 3, step: 0.05, value: 1.15, label: "Dual baseline X", group: "spatial" },
  spatialScreenBaseline: { min: -3, max: 3, step: 0.05, value: -1.25, label: "Screen baseline X", group: "spatial" },
  spatialScreenZ: { min: -1, max: 2, step: 0.05, value: 0.35, label: "Screen Z bias", group: "spatial" },
};

export const TRACK_FEEDS = {
  face: { id: "face", label: "Face", process: true, tint: [251, 191, 36], voxelSlot: 1, tierMin: 2 },
  pose: { id: "pose", label: "Body pose", process: false, tint: [74, 222, 128], voxelSlot: 2, tierMin: 2 },
  leftHand: { id: "leftHand", label: "Left hand", process: false, tint: [244, 114, 182], voxelSlot: 3, tierMin: 2 },
  rightHand: { id: "rightHand", label: "Right hand", process: false, tint: [96, 165, 250], voxelSlot: 4, tierMin: 2 },
  joints: { id: "joints", label: "Joints", process: true, tint: [216, 180, 254], voxelSlot: 6, tierMin: 2 },
  fingers: { id: "fingers", label: "Fingers", process: false, tint: [253, 164, 175], voxelSlot: 7, tierMin: 3 },
};

export const AUDIO_FEEDS = {
  spectrum: { id: "spectrum", label: "Spectrum", process: false, tint: [34, 211, 238], voxelSlot: null, tierMin: 4 },
};

export function feedsForTier(tier, maxPeople = MAX_PEOPLE) {
  const out = { ...BASE_FEEDS };
  for (const f of Object.values(PERSON_FEEDS)) {
    if (tier >= f.tierMin && f.personIdx < maxPeople) out[f.id] = { ...f };
  }
  for (const f of Object.values(TRACK_FEEDS)) {
    if (tier >= f.tierMin) out[f.id] = { ...f };
  }
  for (const f of Object.values(AUDIO_FEEDS)) {
    if (tier >= f.tierMin) out[f.id] = { ...f };
  }
  if (tier >= 3) {
    out.fingers.process = true;
    out.leftHand.process = true;
    out.rightHand.process = true;
    out.pose.process = true;
  }
  if (tier >= 4) {
    out.joints.process = true;
    out.face.process = true;
  }
  return out;
}

export const TIER_PARAMS = {
  voxelSep: { min: 0, max: 2.2, step: 0.05, value: 0.55, label: "Voxel Z sep", midiCc: 16, group: "voxel" },
  voxelSpread: { min: 0, max: 1.2, step: 0.02, value: 0.28, label: "Voxel X spread", midiCc: 17, group: "voxel" },
  sphereRadius: { min: 0.4, max: 3, step: 0.05, value: 1.15, label: "Sphere radius", midiCc: null, group: "voxel" },
  sphereNest: { min: 0.05, max: 0.8, step: 0.02, value: 0.22, label: "Sphere nest", midiCc: null, group: "voxel" },
  sphereBlend: { min: 0, max: 1, step: 0.02, value: 0.55, label: "Sphere blend", midiCc: null, group: "voxel" },
  sphereParallax: { min: 0, max: 2, step: 0.05, value: 0.65, label: "Nested parallax", midiCc: null, group: "voxel" },
  sphereSpin: { min: 0, max: 6.28, step: 0.05, value: 0, label: "Shell spin", midiCc: null, group: "voxel" },
  voxelLayout: { min: 0, max: 1, step: 1, value: 1, label: "Layout sphere/stack", midiCc: null, group: "voxel" },
  splatStretch: { min: 0.5, max: 6, step: 0.05, value: 2.2, label: "Splat stretch", midiCc: 18, group: "gsplat" },
  splatSharp: { min: 2, max: 40, step: 1, value: 10, label: "Splat sharpness", midiCc: 19, group: "gsplat" },
  splatMix: { min: 0, max: 1, step: 0.05, value: 0.72, label: "Splat mix", midiCc: 22, group: "gsplat" },
  shardLen: { min: 0, max: 4, step: 0.05, value: 1.4, label: "Shard length", midiCc: 35, group: "gsplat" },
  radialFan: { min: 0, max: 3, step: 0.05, value: 0.9, label: "Radial fan", midiCc: 36, group: "gsplat" },
  shardDepth: { min: 0, max: 4, step: 0.05, value: 1.25, label: "Shard depth", midiCc: 37, group: "gsplat" },
  sceneReach: { min: 0.6, max: 4, step: 0.05, value: 1.65, label: "Scene reach", midiCc: 38, group: "gsplat" },
  depthStretch: { min: 0, max: 2, step: 0.05, value: 0.55, label: "Depth stretch", midiCc: 39, group: "gsplat" },
  spinOrbit: { min: 0, max: 1, step: 0.05, value: 0, label: "Camera co-orbit", midiCc: null, group: "scene" },
  splatGlow: { min: 0, max: 2.5, step: 0.05, value: 0.65, label: "Splat beat glow", midiCc: 25, group: "gsplat" },
  splatBeatSize: { min: 0, max: 1.5, step: 0.05, value: 0.4, label: "Beat size pump", midiCc: 26, group: "gsplat" },
  splatRot: { min: 0, max: 6.28, step: 0.05, value: 0, label: "Splat rotation", midiCc: 27, group: "gsplat" },
  splatBloom: { min: 0, max: 1, step: 0.05, value: 0.3, label: "Splat bloom", midiCc: 28, group: "gsplat" },
  splatRipple: { min: 0, max: 1, step: 0.05, value: 0.25, label: "Splat ripple", midiCc: 32, group: "gsplat" },
  musicalGain: { min: 0, max: 2.5, step: 0.05, value: 1.1, label: "Musical gain", midiCc: 11, group: "music" },
  beatDecay: { min: 0.8, max: 0.99, step: 0.01, value: 0.93, label: "Beat decay", midiCc: null, group: "music" },
  noteDecay: { min: 0.85, max: 0.99, step: 0.01, value: 0.94, label: "Note decay", midiCc: null, group: "music" },
  layerPulse: { min: 0, max: 1, step: 0.05, value: 0.35, label: "Layer pulse", midiCc: 21, group: "music" },
  beatSens: { min: 0.2, max: 2, step: 0.05, value: 1, label: "Beat sensitivity", midiCc: 12, group: "music" },
  harmonicHue: { min: 0, max: 1, step: 0.01, value: 0, label: "Harmonic hue", midiCc: 23, group: "music" },
  musicDepth: { min: 0, max: 1.5, step: 0.05, value: 0.4, label: "Music depth kick", midiCc: 24, group: "music" },
  musicSpin: { min: 0, max: 1.5, step: 0.05, value: 0.25, label: "Music spin kick", midiCc: 29, group: "music" },
  audioGain: { min: 0, max: 3, step: 0.05, value: 1, label: "Audio gain", midiCc: 30, group: "music" },
  bassDrive: { min: 0, max: 2, step: 0.05, value: 0.85, label: "Bass drive", midiCc: 31, group: "music" },
  midDrive: { min: 0, max: 2, step: 0.05, value: 0.5, label: "Mid drive", midiCc: 33, group: "music" },
  highDrive: { min: 0, max: 2, step: 0.05, value: 0.35, label: "High drive", midiCc: 34, group: "music" },
  jointSize: { min: 0.004, max: 0.04, step: 0.001, value: 0.014, label: "Joint size", midiCc: 20, group: "track" },
  trackRadius: { min: 4, max: 28, step: 1, value: 14, label: "Track mask radius", midiCc: null, group: "track" },
  maxPeople: { min: 1, max: MAX_PEOPLE, step: 1, value: 2, label: "Max people", midiCc: null, group: "track" },
};

/** MIDI CC map shown in UI */
export const MUSIC_CC_MAP = [
  "CC1 dispersion · CC2 depth · CC3 size · CC4 spin · CC5 hue · CC7 glow · CC74 mask",
  "CC11 musical gain · CC12 beat sens · CC16 voxel Z · CC17 voxel X",
  "CC18 splat stretch · CC19 splat sharp · CC20 joint size · CC21 layer pulse",
  "CC22 splat mix · CC23 harmonic hue · CC24 music depth · CC25 splat glow",
  "CC26 beat size · CC27 splat rot · CC28 splat bloom · CC29 music spin",
  "CC30 audio gain · CC31 bass · CC32 splat ripple · CC33 mid · CC34 high",
  "CC35 shard len · CC36 radial fan · CC37 shard depth · CC38 scene reach · CC39 depth stretch",
  "Alt/dbl-click or right-click cloud = select · hands → depth/wave (T2+)",
];