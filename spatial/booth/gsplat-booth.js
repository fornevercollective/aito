/**
 * aito-mac gsplat booth — multi-source voxel sphere, Splatline depth/select,
 * hand → waveform/depth, webcam · screen · Continuity · live feeds.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FilesetResolver, ImageSegmenter } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm";
import { MEDIAPIPE, mountHandResources } from "./hand-tracking-resources.mjs";
import { TIERS, feedsForTier, TIER_PARAMS, MUSIC_CC_MAP, MAX_PEOPLE, SPATIAL_SOURCE_PARAMS } from "./booth-tiers.mjs";
import { HexcastSource } from "./booth-hexcast.mjs";
import { DualCameraHub } from "./booth-cameras.mjs";
import { LiveFeedHub } from "./booth-live-feeds.mjs";
import { TrackHub } from "./booth-tracks.mjs";
import { VoxelStack } from "./booth-voxel.mjs";
import { makeSplatMaterial } from "./booth-splat.mjs";
import { MusicBus, AudioEngine, DEFAULT_TRACK_LABEL } from "./booth-music.mjs";
import { MOTION_MODES, MOTION_PARAMS, applyMotion, motionShardOffset, CAM_BASE } from "./booth-motion.mjs";
import {
  DEPTH_MODES,
  DEPTH_PARAMS,
  resolveDepthMode,
  computeBaseDepth,
  computeZipDepthField,
  buildSpatialPointCloudFromDepth,
  spatialCloudToPly,
  spatialCloudToJson,
  passesDepthFilter,
  gradeDepthColor,
  focusSizeMul,
  depthVizRGB,
} from "./booth-depth.mjs";
import { SelectionHub } from "./booth-select.mjs";
import { HandController, HAND_CTRL_PARAMS } from "./booth-hand-ctrl.mjs";
import { LiveIK, IK_PARAMS, TRACK_PROFILES, profileFromParam, modelsForProfile } from "./booth-ik.mjs";
import { QbpmBridge } from "./booth-qbpm.mjs";
import { SceneStack, SCENE_STACK_PARAMS } from "./booth-scene-stack.mjs";
import { AutoCalibrator, classLabel } from "./booth-auto-cal.mjs";
import { DeviceLinkHub } from "./booth-devices.mjs";
import {
  STUDIO_YT,
  STUDIO_YT_ID,
  STUDIO_PARAMS,
  applyStudioPreset,
  applyPodcastTablePreset,
  applyCrowdSpirePreset,
  studioProject,
  StudioSpatial,
  studioWaveformDrive,
} from "./booth-studio.mjs";
import { LiveVideoPlanes, LIVE_PLANE_PARAMS } from "./booth-live-planes.mjs";
import {
  SpatialPatternAnalyzer,
  ANALYSIS_PARAMS,
  CROWD_SPIRE_YT_ID,
  CROWD_SPIRE_LABEL,
} from "./booth-spatial-analysis.mjs";
import { CrowdSegmenter, CROWD_SEG_PARAMS } from "./booth-crowd-seg.mjs";
import {
  EDGE_PARAMS,
  computeEdgeField,
  LAYER_GROUPS,
  applyLayerGroup,
  layerGroupIsOn,
} from "./booth-edge.mjs";
import {
  BLUEPRINT_LAYOUTS,
  BLUEPRINT_PARAMS,
  layoutAt,
  layoutIndexById,
  layoutLabel,
} from "./booth-blueprints.mjs";
import { createLazyCache, errMessage, fetchJson, singleFlight } from "./booth-lazy.mjs";
import {
  BOOT_PATHS,
  probeMachineSpecs,
  applyPerfPreset,
  formatSpecsHtml,
} from "./booth-boot-wizard.mjs";

const SAMPLE_W = 240;
const SAMPLE_H = 180;
const MAX_POINTS = SAMPLE_W * SAMPLE_H;
const MAX_JOINTS = 160;

const BASE_PARAMS = {
  stride: { min: 1, max: 6, step: 1, value: 3, label: "Sample stride", midiCc: null, group: "cloud" },
  depth: { min: 0.2, max: 5, step: 0.05, value: 1.8, label: "Depth lift", midiCc: 2, group: "cloud" },
  zSpread: { min: 0.3, max: 4, step: 0.05, value: 1.85, label: "Z spread", midiCc: null, group: "cloud" },
  size: { min: 0.002, max: 0.08, step: 0.001, value: 0.018, label: "Point size", midiCc: 3, group: "cloud" },
  opacity: { min: 0.1, max: 1, step: 0.05, value: 0.92, label: "Opacity", midiCc: null, group: "cloud" },
  dispersion: { min: 0, max: 0.35, step: 0.01, value: 0.06, label: "Dispersion", midiCc: 1, group: "cloud" },
  jitter: { min: 0, max: 0.2, step: 0.01, value: 0.02, label: "Jitter", midiCc: null, group: "cloud" },
  spin: { min: -4, max: 4, step: 0.05, value: 0.35, label: "Orbit spin", midiCc: 4, group: "scene" },
  hue: { min: 0, max: 1, step: 0.01, value: 0, label: "Hue shift", midiCc: 5, group: "cloud" },
  glow: { min: 0, max: 2, step: 0.05, value: 0.85, label: "Glow", midiCc: 7, group: "cloud" },
  fog: { min: 0, max: 0.2, step: 0.01, value: 0.04, label: "Fog density", midiCc: null, group: "scene" },
  tilt: { min: -0.6, max: 0.6, step: 0.02, value: 0, label: "Cloud tilt", midiCc: null, group: "scene" },
  mask: { min: 0.05, max: 0.95, step: 0.05, value: 0.45, label: "Mask threshold", midiCc: 74, group: "mask" },
  feather: { min: 0, max: 0.45, step: 0.02, value: 0.12, label: "Mask feather", midiCc: null, group: "mask" },
};

const PARAMS = (window.PARAMS = {
  ...BASE_PARAMS,
  ...TIER_PARAMS,
  ...MOTION_PARAMS,
  ...DEPTH_PARAMS,
  ...HAND_CTRL_PARAMS,
  ...IK_PARAMS,
  ...SPATIAL_SOURCE_PARAMS,
  ...SCENE_STACK_PARAMS,
  ...STUDIO_PARAMS,
  ...LIVE_PLANE_PARAMS,
  ...ANALYSIS_PARAMS,
  ...CROWD_SEG_PARAMS,
  ...EDGE_PARAMS,
  ...BLUEPRINT_PARAMS,
});

/** Lazy Kaaba module — never imported until layout "kaaba" is chosen + active. */
let kaabaBlueprint = null;
let KaabaBlueprintCls = null;
let KAABA_CAM_PRESETS = [];
let applyKaabaBlueprintPreset = null;
let kaabaModPromise = null;

function mergeLayoutParams(paramMap) {
  if (!paramMap) return;
  for (const [k, spec] of Object.entries(paramMap)) {
    if (!PARAMS[k]) PARAMS[k] = { ...spec };
    else {
      PARAMS[k].min = spec.min;
      PARAMS[k].max = spec.max;
      PARAMS[k].step = spec.step;
      PARAMS[k].label = spec.label;
      PARAMS[k].group = spec.group;
    }
  }
}

/**
 * Active catalog layout (selection only — no load).
 */
function activeBlueprintLayout() {
  return layoutAt(PARAMS.blueprintLayout?.value ?? 0);
}

function blueprintIsActive() {
  return (PARAMS.blueprintEnable?.value ?? 0) >= 0.5;
}

/**
 * Apply lightweight layouts (desk / studio) or schedule heavy lazy load (kaaba).
 * Never runs on boot unless user has already set blueprintEnable.
 */
async function applySelectedBlueprint(opts = {}) {
  const layout = activeBlueprintLayout();
  const want = opts.forceEnable || blueprintIsActive();
  if (!want || layout.id === "none") {
    // Hide all blueprints
    kaabaBlueprint?.setVisible(false);
    if (PARAMS.kaabaEnable) PARAMS.kaabaEnable.value = 0;
    if (opts.hideOthers !== false) {
      // desk/studio stay available as scene tools; don't force-off unless exclusive
      if (opts.exclusive) {
        if (PARAMS.stackEnable) PARAMS.stackEnable.value = 0;
        if (PARAMS.studioMode && layout.id === "none") {
          /* leave studio alone on none */
        }
      }
    }
    setStatus(`Blueprint · ${layout.label}`);
    return null;
  }

  if (layout.id === "desk") {
    kaabaBlueprint?.setVisible(false);
    if (PARAMS.kaabaEnable) PARAMS.kaabaEnable.value = 0;
    if (PARAMS.stackEnable) PARAMS.stackEnable.value = 1;
    sceneStack?.rebuild?.();
    sceneStack?.setVisible?.(true);
    setStatus("Blueprint · Desk stack");
    return "desk";
  }

  if (layout.id === "studio") {
    kaabaBlueprint?.setVisible(false);
    if (PARAMS.kaabaEnable) PARAMS.kaabaEnable.value = 0;
    if (PARAMS.studioMode) PARAMS.studioMode.value = 1;
    studioSpatial?.rebuild?.();
    setStatus("Blueprint · Studio LiDAR");
    return "studio";
  }

  if (layout.id === "kaaba") {
    return ensureKaabaBlueprint({ enable: true });
  }

  return null;
}

/**
 * Single-flight lazy load of booth-kaaba-blueprint.mjs + progressive mesh attach.
 * Not called from boot or crowd launch — only explicit layout select / enable.
 */
async function ensureKaabaBlueprint(opts = {}) {
  const enable = opts.enable ?? true;
  // Guard: only load if layout is kaaba (or forced)
  const layout = activeBlueprintLayout();
  if (!opts.force && layout.id !== "kaaba" && !enable) {
    return null;
  }
  if (!kaabaModPromise) {
    setStatus("Blueprint · loading Kaaba module…");
    kaabaModPromise = import("./booth-kaaba-blueprint.mjs")
      .then((mod) => {
        KaabaBlueprintCls = mod.KaabaBlueprint;
        KAABA_CAM_PRESETS = mod.KAABA_CAM_PRESETS || [];
        applyKaabaBlueprintPreset = mod.applyKaabaBlueprintPreset;
        mergeLayoutParams(mod.KAABA_PARAMS);
        return mod;
      })
      .catch((e) => {
        kaabaModPromise = null;
        throw e;
      });
  }
  await kaabaModPromise;
  if (!kaabaBlueprint && KaabaBlueprintCls) {
    kaabaBlueprint = new KaabaBlueprintCls(PARAMS);
    kaabaBlueprint.attach(cloudPivot); // progressive — core only first frame
    window.aitoKaabaBlueprint = kaabaBlueprint;
    try {
      if (typeof buildSliders === "function") buildSliders();
      if (typeof buildMotionPanel === "function") buildMotionPanel();
    } catch {
      /* */
    }
  }
  if (kaabaBlueprint) {
    if (enable) {
      if (PARAMS.kaabaEnable) PARAMS.kaabaEnable.value = 1;
      if (PARAMS.blueprintEnable) PARAMS.blueprintEnable.value = 1;
      if (PARAMS.blueprintLayout) {
        PARAMS.blueprintLayout.value = layoutIndexById("kaaba");
      }
      applyKaabaBlueprintPreset?.(PARAMS);
      kaabaBlueprint.setVisible(true);
      kaabaBlueprint.scheduleLazyBuild({ force: false });
    } else {
      kaabaBlueprint.setVisible(false);
      if (PARAMS.kaabaEnable) PARAMS.kaabaEnable.value = 0;
    }
  }
  return kaabaBlueprint;
}
window.ensureKaabaBlueprint = ensureKaabaBlueprint;
window.applySelectedBlueprint = applySelectedBlueprint;
window.releaseCameraDrive = () => releaseCameraDrive("api");

const $ = (sel) => document.querySelector(sel);

const state = {
  tier: 2,
  running: false,
  mirror: true,
  segmenter: null,
  segBusy: false,
  lastSegMs: 0,
  lastSegFrame: 0,
  points: 0,
  fps: 0,
  midiAccess: null,
  midiInput: null,
  maskPolarity: 1,
  maskCalibrated: false,
  maskLayer: "person",
  /** "solo" | "crowd" | null — layer group mode (hand/person vs hands/crowd) */
  layerGroupMode: null,
  activeFeed: "composite",
  layerCounts: {},
  lastTick: 0,
  spinYaw: 0,
  motionMode: "turntable",
  motionTime: 0,
  motionBurst: 0,
  motionDissolve: 0,
  motionDepthWave: 0,
  flyPhase: 0,
  prevBeat: 0,
  trackAttract: 0,
  handDepthAdd: 0,
  handWaveform: 0,
  bootReady: false,
  visionPhase: "idle", // idle | loading | ready | error
  visionError: null,
  lazyOps: {},
  /** True while QBPM center stage owns the browser budget (pause cloud) */
  shellPaused: false,
};

/** @type {Record<string, any>} */
let FEEDS = {};

function refreshFeeds() {
  FEEDS = feedsForTier(state.tier, Math.round(PARAMS.maxPeople?.value ?? 2));
}

refreshFeeds();
const musicBus = new MusicBus();
const audioEngine = new AudioEngine();
const handCtrl = new HandController();
const liveIk = new LiveIK();
const autoCal = new AutoCalibrator();
const deviceLinks = new DeviceLinkHub();
let trackHub = null;
let trackProfileId = "body";
let qbpmBridge = null;
let voxelStack = null;
let sceneStack = null;
let selectionHub = null;
let fileset = null;
let jointCentroid = null;
let faceGazeTip = null;

const video = $("#booth-video");
const videoSecondary = $("#booth-video-secondary") || (() => {
  const v = document.createElement("video");
  v.id = "booth-video-secondary";
  v.className = "booth-video";
  v.playsInline = true;
  v.muted = true;
  v.autoplay = true;
  document.body.appendChild(v);
  return v;
})();
const hexcastSource = new HexcastSource(video);
hexcastSource.exposeApi();
const dualCam = new DualCameraHub(video, videoSecondary);

/** Dedicated screen/window capture — coexists with dual cam in spatial mix */
const screenVideo = document.createElement("video");
screenVideo.id = "booth-video-screen";
screenVideo.className = "booth-video";
screenVideo.playsInline = true;
screenVideo.muted = true;
screenVideo.autoplay = true;
document.body.appendChild(screenVideo);
const screenSource = new HexcastSource(screenVideo);

/** Hidden element for live feed stage (drawable mp4/HLS) — separate from dual cam primary */
const liveVideoEl = document.createElement("video");
liveVideoEl.id = "booth-video-live";
liveVideoEl.className = "booth-video";
liveVideoEl.playsInline = true;
liveVideoEl.muted = true;
liveVideoEl.autoplay = true;
liveVideoEl.loop = true;
document.body.appendChild(liveVideoEl);

const liveFeeds = new LiveFeedHub({
  video: liveVideoEl,
  onStatus: (msg, err) => setStatus(msg, !!err),
  getFloatVisible: () => uiChrome.floatVisible && (PARAMS.liveFloat?.value ?? 1) >= 0.5,
  onFloatVisible: (visible) => {
    uiChrome.floatVisible = !!visible;
    livePlanes?.setFloatVisible(visible);
    // Keep slider row in sync if open
    if (PARAMS.liveFloat) {
      PARAMS.liveFloat.value = visible ? 1 : 0;
      if (typeof window.syncParamUi === "function") {
        window.syncParamUi("liveFloat", PARAMS.liveFloat);
      } else if (PARAMS.liveFloat.input) {
        if (PARAMS.liveFloat.input.type === "checkbox") {
          PARAMS.liveFloat.input.checked = visible;
        } else {
          PARAMS.liveFloat.input.value = String(PARAMS.liveFloat.value);
        }
        if (PARAMS.liveFloat.output && typeof window.formatParam === "function") {
          PARAMS.liveFloat.output.textContent = window.formatParam("liveFloat", PARAMS.liveFloat.value);
        }
      }
    }
    syncCenterStage(visible);
  },
  onStage: (on) => {
    if (on) {
      dualCam.stop();
      hexcastSource.stop();
      // Keep dedicated screen spatial if user had it; live becomes primary sample
      state.running = true;
      state.mirror = false;
      $("#booth-mirror")?.classList.remove("booth-btn--on");
      $("#booth-stop").disabled = false;
      const studioOn = (PARAMS.studioMode?.value ?? 0) >= 0.5;
      if (studioOn) {
        // People point cloud above floor video — not a full-frame composite blanket
        state.maskLayer = "person";
        if (FEEDS.person) FEEDS.person.process = true;
        if (FEEDS.person2) FEEDS.person2.process = true;
        if (FEEDS.background) FEEDS.background.process = false;
        if (FEEDS.composite) FEEDS.composite.process = false;
        if (PARAMS.liveFloor) PARAMS.liveFloor.value = 1;
        if (PARAMS.size && PARAMS.size.value < 0.022) PARAMS.size.value = 0.028;
        if (PARAMS.mask) PARAMS.mask.value = Math.min(PARAMS.mask.value, 0.35);
      } else {
        // Live content is often full-frame video (not a selfie) — show both layers
        state.maskLayer = "both";
        if (FEEDS.person) FEEDS.person.process = true;
        if (FEEDS.background) FEEDS.background.process = true;
        if (FEEDS.composite) FEEDS.composite.process = true;
      }
      const maskSel = $("#booth-mask-layer");
      if (maskSel) maskSel.value = state.maskLayer;
      syncMaskLayerFeeds();
      // Left column: keep live panel open and visible
      const livePanel = $("#booth-live-panel");
      if (livePanel) livePanel.open = true;
      uiChrome.hideLeft = false;
      applyColumnVisibility();
      // Lazy-warm vision; live full-frame works if seg fails
      ensureRunning({ requireSeg: true }).catch((e) =>
        setStatus(`Vision: ${errMessage(e)} · live continues`, true),
      );
      // Floor plane in 3D; hide DOM float in studio so floor + people read clearly
      uiChrome.floatVisible = !studioOn;
      if (PARAMS.liveFloat) PARAMS.liveFloat.value = studioOn ? 0 : 1;
      livePlanes?.setActive(true);
      livePlanes?.setFloatVisible?.(!studioOn);
      syncCenterStage(!studioOn);
      syncSourceButtons();
      buildFeedStrip();
      if (typeof window.syncUniforms === "function") window.syncUniforms();
    } else {
      syncCenterStage(false);
      livePlanes?.setActive(false);
      // Restore columns when unstaged
      uiChrome.hideLeft = false;
      uiChrome.hideRight = false;
      applyColumnVisibility();
      syncSourceButtons();
    }
  },
  onChange: () => {
    syncSourceButtons();
    refreshToolsPanel();
    if (liveFeeds.staging) {
      livePlanes?.setActive(true);
      syncFloatToggleBtn();
      syncFloatPlaybackUi();
    } else {
      livePlanes?.setActive(false);
      syncCenterStage(false);
    }
  },
});
const statusEl = $("#booth-status");
const hudEl = $("#booth-hud");
const midiLog = $("#booth-midi-log");

const sampleCanvas = document.createElement("canvas");
sampleCanvas.width = SAMPLE_W;
sampleCanvas.height = SAMPLE_H;
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

/** Secondary Continuity frame for spatial dual cloud */
const secondaryCanvas = document.createElement("canvas");
secondaryCanvas.width = SAMPLE_W;
secondaryCanvas.height = SAMPLE_H;
const secondaryCtx = secondaryCanvas.getContext("2d", { willReadFrequently: true });
let secondaryRgb = null;

const screenCanvas = document.createElement("canvas");
screenCanvas.width = SAMPLE_W;
screenCanvas.height = SAMPLE_H;
const screenCtx = screenCanvas.getContext("2d", { willReadFrequently: true });
let screenRgb = null;

function spatialDualOn() {
  return (PARAMS.spatialDual?.value ?? 1) >= 0.5;
}
function spatialScreenOn() {
  return (PARAMS.spatialScreen?.value ?? 1) >= 0.5;
}

const feedEls = {};
const feedCtx = {};
const SEG_INTERVAL_MS = 66;

// —— Three.js ——

const canvas = $("#booth-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a0a0c, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0a0c, PARAMS.fog.value);

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 120);
camera.position.set(0, 0.15, 4.2);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.2;
controls.maxDistance = 18;
controls.target.set(0, 0, 0.5);
// User orbit always allowed; scripted cams pause when user drags
controls.enableRotate = true;
controls.enablePan = true;
controls.enableZoom = true;
/** When true, scripted motion may move the camera. Cleared on user drag. */
state.camDrive = false;
state.camUserOverride = false;
state._camPointerDown = false;

canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 && ev.button !== 2) return;
  state._camPointerDown = true;
  // Any drag intent releases Kaaba / path cam lock
  if (isCamDriveMode(state.motionMode) || state.camDrive) {
    releaseCameraDrive("orbit drag");
  }
});
canvas.addEventListener("pointerup", () => {
  state._camPointerDown = false;
});
canvas.addEventListener("pointercancel", () => {
  state._camPointerDown = false;
});

const cloudPivot = new THREE.Group();
cloudPivot.position.set(0, 0, 0.5);
scene.add(cloudPivot);

const motionCtx = {
  _camOffset: new THREE.Vector3(),
  _yAxis: new THREE.Vector3(0, 1, 0),
};

const layerClouds = {};
const layerBuffers = {};
let jointCloud = null;

function makeMaterial(tintStrength, tier) {
  return tier >= 2 ? makeSplatMaterial(tintStrength, tier) : makePointMaterial(tintStrength);
}

function makePointMaterial(tintStrength = 0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: PARAMS.size.value },
      uDispersion: { value: PARAMS.dispersion.value },
      uTime: { value: 0 },
      uGlow: { value: PARAMS.glow.value },
      uHue: { value: PARAMS.hue.value },
      uOpacity: { value: PARAMS.opacity.value },
      uJitter: { value: PARAMS.jitter.value },
      uTilt: { value: PARAMS.tilt.value },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uTintMix: { value: tintStrength },
      uBeat: { value: 0 },
      uMusical: { value: 0 },
      uLayerPulse: { value: 0 },
      uSplatStretch: { value: 1 },
      uSplatSharp: { value: 14 },
      uSplatMix: { value: 0.85 },
      uSplatGlow: { value: 0.65 },
      uSplatBeatSize: { value: 0.4 },
      uSplatRot: { value: 0 },
      uSplatBloom: { value: 0.3 },
      uSplatRipple: { value: 0.25 },
      uShardLen: { value: 1.4 },
      uRadialStretch: { value: 0.9 },
      uDepthStretch: { value: 0.55 },
      uHarmonic: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uHigh: { value: 0 },
    },
    vertexShader: makeSplatMaterial(0, 1).vertexShader,
    fragmentShader: makeSplatMaterial(0, 1).fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
}

function destroyLayerClouds() {
  for (const cloud of Object.values(layerClouds)) {
    cloudPivot.remove(cloud.pts);
    cloud.geo.dispose();
    cloud.mat.dispose();
  }
  for (const k of Object.keys(layerClouds)) delete layerClouds[k];
  for (const k of Object.keys(layerBuffers)) delete layerBuffers[k];
}

function createLayerClouds() {
  destroyLayerClouds();
  // camera/spectrum remain viz-only; depth is a spatial monocular cloud from the depth pass
  const skip = new Set(["camera", "joints", "spectrum"]);
  // iphone (dual) + screen + depth get their own spatial layer clouds
  for (const feed of Object.values(FEEDS)) {
    if (skip.has(feed.id)) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1));
    geo.setDrawRange(0, 0);
    const tint = feed.tint ? feed.tint.map((c) => c / 255) : [1, 1, 1];
    const mat = makeMaterial(feed.tint ? 0.55 : 0, state.tier);
    if (mat.uniforms.uTint) mat.uniforms.uTint.value.set(tint[0], tint[1], tint[2]);
    const pts = new THREE.Points(geo, mat);
    pts.visible = feed.process;
    cloudPivot.add(pts);
    layerClouds[feed.id] = { geo, mat, pts };
    layerBuffers[feed.id] = {
      positions: geo.attributes.position.array,
      colors: geo.attributes.color.array,
      seeds: geo.attributes.aSeed.array,
      count: 0,
    };
  }

  const jGeo = new THREE.BufferGeometry();
  jGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_JOINTS * 3), 3));
  jGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_JOINTS * 3), 3));
  jGeo.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(MAX_JOINTS), 1));
  jGeo.setDrawRange(0, 0);
  const jMat = makeMaterial(0.8, state.tier);
  jMat.uniforms.uSize.value = PARAMS.jointSize?.value ?? 0.014;
  jointCloud = new THREE.Points(jGeo, jMat);
  jointCloud.visible = FEEDS.joints?.process ?? false;
  cloudPivot.add(jointCloud);
}

createLayerClouds();
voxelStack = new VoxelStack(FEEDS, PARAMS);
voxelStack.layout = (PARAMS.voxelLayout?.value ?? 1) >= 0.5 ? "sphere" : "stack";
voxelStack.attach(cloudPivot);
voxelStack.setVisible(state.tier >= 2);

sceneStack = new SceneStack(PARAMS);
sceneStack.attach(cloudPivot);
sceneStack.setVisible(true);

/** @type {KaabaBlueprint | null} */
// Kaaba blueprint: lazy via ensureKaabaBlueprint() — not built on boot

const studioSpatial = new StudioSpatial(PARAMS);
studioSpatial.attach(cloudPivot);
const spatialAnalyzer = new SpatialPatternAnalyzer(PARAMS);
window.aitoSpatialAnalysis = spatialAnalyzer;
const crowdSeg = new CrowdSegmenter(PARAMS);
window.aitoCrowdSeg = crowdSeg;

const livePlanes = new LiveVideoPlanes(liveVideoEl, PARAMS);
livePlanes.attach(cloudPivot);

selectionHub = new SelectionHub({
  canvas,
  camera,
  layerClouds,
  feeds: () => FEEDS,
  onSelect: (sel) => {
    state.activeFeed = sel?.id || state.activeFeed;
    document.querySelectorAll(".booth-feed").forEach((el) =>
      el.classList.toggle("booth-feed--active", el.dataset.feed === state.activeFeed),
    );
    document.querySelectorAll(".booth-feed").forEach((el) =>
      el.classList.toggle("booth-feed--selected", sel && el.dataset.feed === sel.id),
    );
  },
  onStatus: (msg) => setStatus(msg),
});
selectionHub.bind();

// —— UI ——

/** Cameras section: device list, link/add, quick sources */
function buildCameraPanel() {
  const body = $("#booth-camera-panel-body");
  if (!body) return;
  body.innerHTML = "";

  const camHelp = document.createElement("p");
  camHelp.className = "booth-motion-desc";
  camHelp.innerHTML =
    "Link Continuity / USB / virtual cams for the dual stack. " +
    "<em>Dual + Screen</em> places a person at a desk with the display they are viewing — orbit to see their scene.";
  body.appendChild(camHelp);

  buildDeviceLinkUI(body);

  // Primary + secondary camera picks (any USB / Continuity / virtual)
  const pickRow = document.createElement("div");
  pickRow.className = "booth-cam-picks";
  pickRow.innerHTML = `
    <label class="booth-cam-pick">
      <span>Primary</span>
      <select id="booth-cam-primary" class="booth-select booth-device-select" aria-label="Primary camera"></select>
    </label>
    <label class="booth-cam-pick">
      <span>Secondary</span>
      <select id="booth-cam-secondary" class="booth-select booth-device-select" aria-label="Secondary camera for dual"></select>
    </label>
  `;
  body.appendChild(pickRow);

  const applyRow = document.createElement("div");
  applyRow.className = "booth-spatial-actions";
  const applyPrimary = document.createElement("button");
  applyPrimary.type = "button";
  applyPrimary.className = "booth-btn";
  applyPrimary.textContent = "Open primary";
  applyPrimary.title = "Start selected primary into video feed";
  applyPrimary.addEventListener("click", () => {
    const id = $("#booth-cam-primary")?.value;
    if (!id) {
      setStatus("Pick a primary camera first", true);
      return;
    }
    bootVisionAnd(() => startDeviceById(id, { forcePrimary: true }));
  });
  const applySecondary = document.createElement("button");
  applySecondary.type = "button";
  applySecondary.className = "booth-btn";
  applySecondary.textContent = "Open secondary";
  applySecondary.title = "Load second camera into dual / Dual · iPhone layer feed";
  applySecondary.addEventListener("click", () => {
    const id = $("#booth-cam-secondary")?.value;
    if (!id) {
      setStatus("Pick a secondary camera (Continuity or USB)", true);
      return;
    }
    bootVisionAnd(() => startDeviceById(id, { asSecondary: true }));
  });
  const applyDual = document.createElement("button");
  applyDual.type = "button";
  applyDual.className = "booth-btn booth-btn--on";
  applyDual.textContent = "Open dual";
  applyDual.title = "Open primary + secondary together";
  applyDual.addEventListener("click", () => {
    bootVisionAnd(() =>
      startDualCameras({
        primaryId: $("#booth-cam-primary")?.value || null,
        secondaryId: $("#booth-cam-secondary")?.value || null,
      }),
    );
  });
  const refreshCams = document.createElement("button");
  refreshCams.type = "button";
  refreshCams.className = "booth-btn booth-btn--tiny";
  refreshCams.textContent = "Refresh list";
  refreshCams.addEventListener("click", () => {
    dualCam.devices = [];
    bootVisionAnd(async () => {
      await dualCam.listDevices({ requestPermission: true });
      await refreshDeviceSelect();
      setStatus(`Cameras · ${dualCam.devices.length} found`);
    });
  });
  applyRow.append(applyPrimary, applySecondary, applyDual, refreshCams);
  body.appendChild(applyRow);

  const quick = document.createElement("div");
  quick.className = "booth-spatial-actions";
  for (const [label, fn, title] of [
    ["Desktop", () => bootVisionAnd(startCamera), "FaceTime / built-in"],
    ["Dual stack", () => bootVisionAnd(startDualStackScene), "Person + Continuity + desk layout"],
    ["+ Screen view", () => startScreenShare({ spatial: true, keepDual: true }).catch((e) => setStatus(e.message, true)), "What they are looking at"],
    ["Auto-cal", () => runAutoCalibrate(true), "AI scene settings"],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "booth-btn" + (label === "Dual stack" ? " booth-btn--on" : "");
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", fn);
    quick.appendChild(b);
  }
  body.appendChild(quick);

  // Populate selects after mount
  refreshDeviceSelect().catch(() => {});

  const badge = document.createElement("div");
  badge.className = "booth-autocal-badge";
  badge.id = "booth-autocal-badge";
  badge.innerHTML = "<strong>Auto-cal</strong> · idle — run when Dual/Screen are live";
  body.appendChild(badge);
}

function buildDeviceLinkUI(parent) {
  const wrap = document.createElement("div");
  wrap.className = "booth-device-link";
  wrap.id = "booth-device-link";

  const hd = document.createElement("div");
  hd.className = "booth-device-link-hd";
  const title = document.createElement("span");
  title.textContent = "Linked devices";
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "booth-btn booth-btn--tiny";
  refreshBtn.textContent = "Refresh";
  refreshBtn.addEventListener("click", () => {
    dualCam.listDevices().then(() => {
      refreshDeviceSelect();
      renderLinkedDeviceList();
      setStatus(`Cameras · ${dualCam.devices.length} live · ${deviceLinks.list().length} linked`);
    }).catch((e) => setStatus(e.message, true));
  });
  hd.append(title, refreshBtn);
  wrap.appendChild(hd);

  const list = document.createElement("ul");
  list.className = "booth-device-list";
  list.id = "booth-device-list";
  wrap.appendChild(list);

  const form = document.createElement("div");
  form.className = "booth-device-link-form";
  const sel = document.createElement("select");
  sel.id = "booth-link-device-sel";
  sel.innerHTML = '<option value="">Add live camera…</option>';
  const nameIn = document.createElement("input");
  nameIn.id = "booth-link-label";
  nameIn.placeholder = "Custom label";
  nameIn.maxLength = 64;
  const roleSel = document.createElement("select");
  roleSel.id = "booth-link-role";
  for (const [v, t] of [
    ["any", "Role · any"],
    ["desktop", "Desktop / person"],
    ["dual", "Dual / Continuity"],
    ["desk", "Desk View"],
  ]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    roleSel.appendChild(o);
  }
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "booth-btn";
  addBtn.textContent = "Link";
  addBtn.title = "Pin this camera to the linked list";
  addBtn.addEventListener("click", () => {
    const deviceId = sel.value;
    if (!deviceId) {
      setStatus("Pick a live camera to link", true);
      return;
    }
    const live = dualCam.devices.find((d) => d.deviceId === deviceId);
    const entry = deviceLinks.link({
      deviceId,
      label: nameIn.value.trim() || live?.label || "Camera",
      kind: live?.kind || "other",
      role: roleSel.value || "any",
    });
    nameIn.value = "";
    renderLinkedDeviceList();
    refreshDeviceSelect();
    setStatus(`Linked · ${entry.label}`);
  });
  form.append(sel, nameIn, roleSel, addBtn);
  wrap.appendChild(form);
  parent.appendChild(wrap);
  renderLinkedDeviceList();
  populateLinkDeviceSelect();
}

function populateLinkDeviceSelect() {
  const sel = $("#booth-link-device-sel");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Add live camera…</option>';
  for (const d of dualCam.devices) {
    const o = document.createElement("option");
    o.value = d.deviceId;
    const tag =
      d.kind === "iphone" ? "📱 " : d.kind === "deskview" ? "🖥 " : d.kind === "desktop" ? "💻 " : "";
    o.textContent = `${tag}${d.label}`;
    sel.appendChild(o);
  }
  if (cur) sel.value = cur;
}

function renderLinkedDeviceList() {
  const list = $("#booth-device-list");
  if (!list) return;
  list.innerHTML = "";
  const merged = deviceLinks.mergeWithLive(dualCam.devices);
  if (!merged.length) {
    const empty = document.createElement("li");
    empty.className = "booth-device-item";
    empty.innerHTML = '<span class="booth-device-item-meta">No linked devices — pick a live cam and Link</span>';
    list.appendChild(empty);
    return;
  }
  for (const d of merged) {
    const li = document.createElement("li");
    li.className = `booth-device-item${d.online ? "" : " booth-device-item--offline"}`;
    const name = document.createElement("div");
    name.className = "booth-device-item-name";
    name.textContent = d.label;
    const actions = document.createElement("div");
    actions.className = "booth-device-item-actions";
    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "booth-btn";
    useBtn.textContent = "Use";
    useBtn.disabled = !d.online;
    useBtn.addEventListener("click", () => {
      if (d.online) bootVisionAnd(() => startDeviceById(d.deviceId));
    });
    const unBtn = document.createElement("button");
    unBtn.type = "button";
    unBtn.className = "booth-btn";
    unBtn.textContent = "Unlink";
    unBtn.addEventListener("click", () => {
      deviceLinks.unlink(d.id);
      renderLinkedDeviceList();
      setStatus(`Unlinked · ${d.label}`);
    });
    actions.append(useBtn, unBtn);
    const meta = document.createElement("div");
    meta.className = "booth-device-item-meta";
    meta.textContent = `${d.online ? "online" : "offline"} · ${d.role} · ${d.liveKind || d.kind}`;
    li.append(name, actions, meta);
    list.appendChild(li);
  }
}

/** Motion, spatial mix, depth, scene stack — collapsible subsections + toggles */
function buildMotionPanel() {
  const body = $("#booth-motion-panel-body");
  if (!body) return;
  body.innerHTML = "";

  const modesSub = document.createElement("details");
  modesSub.className = "booth-subsec";
  modesSub.open = true;
  const modesSum = document.createElement("summary");
  modesSum.className = "booth-subsec-sum";
  modesSum.innerHTML = `<span class="booth-subsec-title">Motion modes</span>`;
  modesSub.appendChild(modesSum);
  const modesBody = document.createElement("div");
  modesBody.className = "booth-subsec-body";

  const desc = document.createElement("p");
  desc.className = "booth-motion-desc";
  desc.id = "booth-motion-desc";
  modesBody.appendChild(desc);

  const modesWrap = document.createElement("div");
  modesWrap.className = "booth-motion-modes";
  modesWrap.id = "booth-motion-modes";
  let lastCat = "";
  for (const mode of MOTION_MODES) {
    if (mode.cat !== lastCat) {
      const cat = document.createElement("div");
      cat.className = "booth-motion-cat";
      cat.textContent = mode.cat;
      modesWrap.appendChild(cat);
      lastCat = mode.cat;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "booth-motion-btn";
    btn.dataset.mode = mode.id;
    btn.textContent = mode.label;
    btn.title = mode.desc;
    if (!mode.impl) btn.classList.add("booth-motion-btn--soon");
    if (state.motionMode === mode.id) btn.classList.add("booth-motion-btn--on");
    btn.addEventListener("click", () => setMotionMode(mode.id));
    modesWrap.appendChild(btn);
  }
  modesBody.appendChild(modesWrap);
  modesSub.appendChild(modesBody);
  body.appendChild(modesSub);

  const tuneSub = document.createElement("details");
  tuneSub.className = "booth-subsec";
  tuneSub.open = true;
  const tuneSum = document.createElement("summary");
  tuneSum.className = "booth-subsec-sum";
  tuneSum.innerHTML = `<span class="booth-subsec-title">Motion tune</span>`;
  tuneSub.appendChild(tuneSum);
  const paramsWrap = document.createElement("div");
  paramsWrap.className = "booth-subsec-body booth-motion-params";
  for (const [key, spec] of Object.entries(MOTION_PARAMS)) {
    // Prefer shared PARAMS row if buildSliders already ran; re-bind here for motion panel ownership
    const p = PARAMS[key] || spec;
    const row = document.createElement("div");
    row.className = "booth-slider";
    const id = `booth-motion-${key}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = p.label || spec.label;
    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = String(p.min);
    input.max = String(p.max);
    input.step = String(p.step);
    input.value = String(p.value);
    const out = document.createElement("output");
    out.textContent = formatParam(key, p.value);
    input.addEventListener("input", () => {
      p.value = Number(input.value);
      out.textContent = formatParam(key, p.value);
      if (key === "layerDriftSpd" && voxelStack) voxelStack.rebuildGrid();
    });
    row.append(label, input, out);
    paramsWrap.appendChild(row);
    p.input = input;
    p.output = out;
  }
  tuneSub.appendChild(paramsWrap);
  body.appendChild(tuneSub);

  // Spatial mix Dual + Screen — collapsible + switch toggles
  const spatialSub = document.createElement("details");
  spatialSub.className = "booth-subsec booth-spatial-mix";
  spatialSub.open = true;
  spatialSub.dataset.group = "spatial";
  const spatSum = document.createElement("summary");
  spatSum.className = "booth-subsec-sum";
  const spatTitle = document.createElement("span");
  spatTitle.className = "booth-subsec-title";
  spatTitle.textContent = "Spatial dual · screen";
  spatSum.appendChild(spatTitle);
  if (PARAMS.spatialDual) {
    const { wrap, input } = makeSwitch((PARAMS.spatialDual.value ?? 1) >= 0.5);
    input.dataset.paramMirror = "spatialDual";
    input.id = "booth-spatialDual";
    input.setAttribute("aria-label", "Spatial dual enable");
    input.addEventListener("click", (ev) => ev.stopPropagation());
    input.addEventListener("change", (ev) => {
      ev.stopPropagation();
      PARAMS.spatialDual.value = input.checked ? 1 : 0;
      onParamChanged("spatialDual", PARAMS.spatialDual, "spatial");
      setStatus(`Spatial dual · ${input.checked ? "on" : "off"}`);
    });
    spatSum.appendChild(wrap);
  }
  spatialSub.appendChild(spatSum);

  const spatialBody = document.createElement("div");
  spatialBody.className = "booth-subsec-body";
  const spatHelp = document.createElement("p");
  spatHelp.className = "booth-motion-desc";
  spatHelp.textContent =
    "Stack Dual Continuity + Screen so you can spin around a person at a desk and see the display they are viewing (content depth from video/photo).";
  spatialBody.appendChild(spatHelp);

  for (const [key, label, title] of [
    ["spatialDual", "Dual → sphere", "Map Dual Continuity into spatial stack"],
    ["spatialScreen", "Screen → view plane", "Map screen/window as what they are looking at"],
    ["stackEnable", "Desk scene stack", "Person · desk · screen · cam distance indicators"],
    ["stackGaze", "Gaze indicator", "Face → screen ray"],
    ["stackIndicators", "Object indicators", "Desk · cams · rings"],
  ]) {
    const row = document.createElement("label");
    row.className = "booth-toggle-row booth-spatial-check";
    row.title = title;
    const name = document.createElement("span");
    name.className = "booth-toggle-label";
    name.textContent = label;
    const { wrap, input: cb } = makeSwitch((PARAMS[key]?.value ?? 1) >= 0.5);
    cb.id = `booth-${key}`;
    cb.dataset.paramMirror = key;
    cb.setAttribute("aria-label", label);
    cb.addEventListener("change", () => {
      if (PARAMS[key]) {
        PARAMS[key].value = cb.checked ? 1 : 0;
        onParamChanged(key, PARAMS[key], PARAMS[key].group || "spatial");
      }
      setStatus(`Stack · ${key} ${cb.checked ? "on" : "off"}`);
    });
    row.append(name, wrap);
    spatialBody.appendChild(row);
  }

  const spatActions = document.createElement("div");
  spatActions.className = "booth-spatial-actions";
  const dualBtn = document.createElement("button");
  dualBtn.type = "button";
  dualBtn.className = "booth-btn booth-btn--on";
  dualBtn.textContent = "Dual desk stack";
  dualBtn.addEventListener("click", () => bootVisionAnd(startDualStackScene));
  const scrBtn = document.createElement("button");
  scrBtn.type = "button";
  scrBtn.className = "booth-btn";
  scrBtn.textContent = "Add screen view";
  scrBtn.addEventListener("click", () =>
    startScreenShare({ spatial: true, keepDual: true }).catch((e) => setStatus(e.message, true)),
  );
  spatActions.append(dualBtn, scrBtn);
  spatialBody.appendChild(spatActions);
  spatialSub.appendChild(spatialBody);
  body.appendChild(spatialSub);

  // Depth modes (also mirrored under Point cloud & depth)
  const depthSub = document.createElement("details");
  depthSub.className = "booth-subsec";
  depthSub.open = true;
  const depthSum = document.createElement("summary");
  depthSum.className = "booth-subsec-sum";
  depthSum.innerHTML = `<span class="booth-subsec-title">Depth variation</span>`;
  depthSub.appendChild(depthSum);
  const depthBody = document.createElement("div");
  depthBody.className = "booth-subsec-body";
  buildDepthModeButtons(depthBody);
  const depthCloudRow = document.createElement("div");
  depthCloudRow.className = "booth-toggle-row booth-spatial-check";
  const depthCloudLab = document.createElement("label");
  depthCloudLab.className = "booth-check";
  const depthCloudOn =
    (PARAMS.depthCloud?.value ?? 1) >= 0.5 || !!FEEDS.depth?.process;
  const { wrap: dcWrap, input: dcInput } = makeSwitch(depthCloudOn);
  dcInput.id = "booth-depth-cloud";
  dcInput.setAttribute("aria-label", "Depth spatial point cloud");
  dcInput.addEventListener("change", () => {
    const on = dcInput.checked;
    if (PARAMS.depthCloud) {
      PARAMS.depthCloud.value = on ? 1 : 0;
      syncParamUi("depthCloud", PARAMS.depthCloud);
    }
    if (FEEDS.depth) FEEDS.depth.process = on;
    if (layerClouds.depth) layerClouds.depth.pts.visible = on;
    syncFeedProcessUi();
    setStatus(on ? "Depth · spatial point cloud on" : "Depth cloud off");
  });
  const dcName = document.createElement("span");
  dcName.className = "booth-check-name";
  dcName.textContent = "Depth → spatial cloud";
  depthCloudLab.append(dcName, dcWrap);
  depthCloudRow.appendChild(depthCloudLab);
  depthBody.appendChild(depthCloudRow);
  const depthCloudHelp = document.createElement("p");
  depthCloudHelp.className = "booth-motion-desc";
  depthCloudHelp.textContent =
    "Unprojects the monocular depth pass (ZipDepth / JAX / radial) into a 3D point cloud. API: window.aitoBoothDepth.getPointCloud() · downloadPly().";
  depthBody.appendChild(depthCloudHelp);
  depthSub.appendChild(depthBody);
  body.appendChild(depthSub);

  // Blueprint layouts — select only; heavy modules load on enable
  const bpSub = document.createElement("details");
  bpSub.className = "booth-subsec";
  bpSub.open = true;
  bpSub.dataset.group = "blueprint";
  const bpSum = document.createElement("summary");
  bpSum.className = "booth-subsec-sum";
  bpSum.innerHTML = `<span class="booth-subsec-title">Blueprint layouts</span>`;
  const { wrap: bpWrap, input: bpEnable } = makeSwitch(blueprintIsActive());
  bpEnable.dataset.paramMirror = "blueprintEnable";
  bpEnable.setAttribute("aria-label", "Blueprint active");
  for (const type of ["click", "pointerdown", "mousedown"]) {
    bpWrap.addEventListener(type, (ev) => ev.stopPropagation());
  }
  bpEnable.addEventListener("change", (ev) => {
    ev.stopPropagation();
    PARAMS.blueprintEnable.value = bpEnable.checked ? 1 : 0;
    onParamChanged("blueprintEnable", PARAMS.blueprintEnable, "blueprint");
  });
  bpSum.appendChild(bpWrap);
  bpSub.appendChild(bpSum);
  const bpBody = document.createElement("div");
  bpBody.className = "booth-subsec-body";
  const bpHelp = document.createElement("p");
  bpHelp.className = "booth-motion-desc";
  bpHelp.textContent =
    "Select a layout, then turn Active on. Heavy layouts (Kaaba) lazy-load only when chosen — never on boot.";
  bpBody.appendChild(bpHelp);
  const layoutWrap = document.createElement("div");
  layoutWrap.className = "booth-depth-modes";
  layoutWrap.id = "booth-blueprint-layouts";
  const curLayout = Math.round(PARAMS.blueprintLayout?.value ?? 0);
  for (let i = 0; i < BLUEPRINT_LAYOUTS.length; i++) {
    const L = BLUEPRINT_LAYOUTS[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "booth-motion-btn";
    btn.dataset.blueprint = String(i);
    btn.textContent = L.label + (L.heavy ? " · lazy" : "");
    btn.title = L.desc;
    if (i === curLayout) btn.classList.add("booth-motion-btn--on");
    btn.addEventListener("click", () => selectBlueprintLayout(i));
    layoutWrap.appendChild(btn);
  }
  bpBody.appendChild(layoutWrap);
  bpSub.appendChild(bpBody);
  body.appendChild(bpSub);

  // Kaaba cams only after Kaaba layout is loaded (empty until then)
  const kaabaSub = document.createElement("details");
  kaabaSub.className = "booth-subsec";
  kaabaSub.open = false;
  kaabaSub.dataset.group = "kaaba";
  const kaabaSum = document.createElement("summary");
  kaabaSum.className = "booth-subsec-sum";
  kaabaSum.innerHTML = `<span class="booth-subsec-title">Kaaba · Haram cams</span>`;
  kaabaSub.appendChild(kaabaSum);
  const kaabaBody = document.createElement("div");
  kaabaBody.className = "booth-subsec-body";
  const kaabaHelp = document.createElement("p");
  kaabaHelp.className = "booth-motion-desc";
  kaabaHelp.textContent = KAABA_CAM_PRESETS.length
    ? "Cams load with Kaaba layout. Pick layout → Active, then orbit / fly / towers."
    : "Select Blueprint → Kaaba · Haram + Active to load cams (lazy).";
  kaabaBody.appendChild(kaabaHelp);
  const camWrap = document.createElement("div");
  camWrap.className = "booth-depth-modes";
  camWrap.id = "booth-kaaba-cams";
  for (let i = 0; i < KAABA_CAM_PRESETS.length; i++) {
    const p = KAABA_CAM_PRESETS[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "booth-motion-btn";
    btn.dataset.kaabaCam = String(i);
    btn.textContent = p.label;
    btn.title = p.desc || p.label;
    if (Math.round(PARAMS.kaabaCamPreset?.value ?? 0) === i) btn.classList.add("booth-motion-btn--on");
    btn.addEventListener("click", () => selectKaabaCam(i));
    camWrap.appendChild(btn);
  }
  kaabaBody.appendChild(camWrap);
  {
    const pathRow = document.createElement("div");
    pathRow.className = "booth-spatial-actions";
    const freeBtn = document.createElement("button");
    freeBtn.type = "button";
    freeBtn.className = "booth-btn booth-btn--on";
    freeBtn.textContent = "Free cam";
    freeBtn.title = "Release scripted camera — drag to orbit";
    freeBtn.addEventListener("click", () => releaseCameraDrive("free cam"));
    pathRow.appendChild(freeBtn);
    if (KAABA_CAM_PRESETS.length) {
      for (const [mode, label] of [
        ["tawafOrbit", "Tawaf orbit"],
        ["kaabaFly", "Flythrough"],
        ["kaabaAbove", "Above"],
        ["kaabaLevel", "Levels"],
        ["kaabaTower", "Towers"],
      ]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "booth-btn";
        b.textContent = label;
        b.addEventListener("click", () => {
          if (activeBlueprintLayout().id !== "kaaba") {
            selectBlueprintLayout(layoutIndexById("kaaba"), { activate: true });
          } else if (!blueprintIsActive()) {
            PARAMS.blueprintEnable.value = 1;
            void applySelectedBlueprint({ forceEnable: true });
          }
          setMotionMode(mode);
          setStatus(`Kaaba cam · ${label} · drag to free`);
        });
        pathRow.appendChild(b);
      }
    }
    kaabaBody.appendChild(pathRow);
  }
  kaabaSub.appendChild(kaabaBody);
  body.appendChild(kaabaSub);

  updateMotionDesc();
}

/** Select layout by index — does not load heavy modules until Active is on. */
function selectBlueprintLayout(index, opts = {}) {
  const i = Math.max(0, Math.min(BLUEPRINT_LAYOUTS.length - 1, Math.round(index)));
  if (PARAMS.blueprintLayout) {
    PARAMS.blueprintLayout.value = i;
    syncParamUi("blueprintLayout", PARAMS.blueprintLayout);
  }
  document.querySelectorAll("#booth-blueprint-layouts .booth-motion-btn").forEach((b) => {
    b.classList.toggle("booth-motion-btn--on", b.dataset.blueprint === String(i));
  });
  const L = layoutAt(i);
  if (opts.activate || blueprintIsActive()) {
    if (PARAMS.blueprintEnable) PARAMS.blueprintEnable.value = 1;
    void applySelectedBlueprint({ forceEnable: true }).then(() => {
      setStatus(`Blueprint · ${L.label}${L.heavy ? " · lazy loading…" : ""}`);
    });
  } else {
    setStatus(`Blueprint · ${L.label} selected · turn Active on to load`);
  }
}

function selectKaabaCam(index) {
  // Ensure Kaaba layout is selected + loaded first
  if (activeBlueprintLayout().id !== "kaaba") {
    selectBlueprintLayout(layoutIndexById("kaaba"), { activate: true });
  }
  const i = Math.max(0, Math.min(Math.max(0, KAABA_CAM_PRESETS.length - 1), Math.round(index)));
  if (PARAMS.kaabaCamPreset) {
    PARAMS.kaabaCamPreset.value = i;
    syncParamUi("kaabaCamPreset", PARAMS.kaabaCamPreset);
  }
  const p = KAABA_CAM_PRESETS[i];
  if (!p) {
    void ensureKaabaBlueprint({ enable: true }).then(() => selectKaabaCam(index));
    return;
  }
  kaabaBlueprint?.setActiveCam(p.id);
  if (p.kind === "fly") setMotionMode("kaabaFly");
  else if (p.kind === "above") setMotionMode("kaabaAbove");
  else if (p.kind === "orbit") setMotionMode("tawafOrbit");
  else if (p.kind === "level") setMotionMode("kaabaLevel");
  else if (p.kind === "tower") setMotionMode("kaabaTower");
  else if (p.kind === "special") setMotionMode("tawafOrbit");
  document.querySelectorAll("#booth-kaaba-cams .booth-motion-btn").forEach((b) => {
    b.classList.toggle("booth-motion-btn--on", b.dataset.kaabaCam === String(i));
  });
  const pose = kaabaBlueprint?.poseForPreset(p.id, state.motionTime || 0);
  if (pose && camera) {
    camera.position.copy(pose.position);
    controls.target.copy(pose.target);
    controls.update();
  }
  setStatus(`Kaaba · ${p.label}`);
}

/** Full dual spatial stack: dual cams + scene desk layout + optional screen */
async function startDualStackScene() {
  if (PARAMS.spatialDual) {
    PARAMS.spatialDual.value = 1;
    syncParamUi("spatialDual", PARAMS.spatialDual);
    onParamChanged("spatialDual", PARAMS.spatialDual, "spatial");
  }
  if (PARAMS.stackEnable) {
    PARAMS.stackEnable.value = 1;
    syncParamUi("stackEnable", PARAMS.stackEnable);
    onParamChanged("stackEnable", PARAMS.stackEnable, "stack");
  }
  dualCam.spatialLayer = true;
  const comb = $("#booth-combine");
  if (comb) comb.value = "spatial";
  await startDualCameras();
  sceneStack?.rebuild();
  setMotionMode("turntable");
  setStatus(statusSpatialTag("Dual desk stack · orbit person + view plane"));
  setTimeout(() => runAutoCalibrate(true), 900);
}

function updateMotionDesc() {
  const el = $("#booth-motion-desc");
  const m = MOTION_MODES.find((x) => x.id === state.motionMode);
  if (el && m) el.textContent = m.impl ? m.desc : `${m.desc} — placeholder`;
}

/** Modes that continuously write camera.position (fight OrbitControls). */
const CAM_DRIVE_MODES = new Set([
  "dolly",
  "crane",
  "flythrough",
  "lissajous",
  "coOrbit",
  "sphereOrbit",
  "handGuided",
  "faceLock",
  "audioDolly",
  "tawafOrbit",
  "kaabaFly",
  "kaabaAbove",
  "kaabaLevel",
  "kaabaTower",
]);

function isCamDriveMode(id = state.motionMode) {
  return CAM_DRIVE_MODES.has(id);
}

/**
 * Release scripted camera so OrbitControls can rotate freely.
 * Call on user drag / Free cam button.
 */
function releaseCameraDrive(reason = "user") {
  if (!state.camDrive && !isCamDriveMode()) return;
  state.camDrive = false;
  state.camUserOverride = true;
  // Switch to free orbit modes that only spin the cloud, not the camera
  if (isCamDriveMode(state.motionMode)) {
    state.motionMode = "parallax";
    document.querySelectorAll(".booth-motion-btn").forEach((b) => {
      b.classList.toggle("booth-motion-btn--on", b.dataset.mode === "parallax");
    });
    updateMotionDesc();
  }
  controls.enabled = true;
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  setStatus(`Camera free · ${reason}`);
}

function setMotionMode(id) {
  const m = MOTION_MODES.find((x) => x.id === id);
  if (!m) return;
  if (!m.impl) {
    setStatus(`${m.label} — coming soon`);
    return;
  }
  const prev = state.motionMode;
  state.motionMode = id;
  state.motionTime = 0;
  state.flyPhase = 0;
  state.motionBurst = 0;
  state.camUserOverride = false;
  // Scripted cams: enable drive; free modes: never drive camera
  state.camDrive = isCamDriveMode(id);
  // Only reset camera when entering a scripted drive mode (not free orbit)
  if (state.camDrive) {
    // Soft start from current pose for Kaaba; hard reset for simple paths
    if (!String(id).startsWith("kaaba") && id !== "tawafOrbit") {
      camera.position.set(CAM_BASE.x, CAM_BASE.y, CAM_BASE.z);
      controls.target.set(0, 0, 0.5);
    }
  }
  // Keep user orbit orientation when switching free modes
  cloudPivot.rotation.set(0, state.spinYaw || 0, 0);
  cloudPivot.scale.set(1, 1, 1);
  if (voxelStack) voxelStack.rebuildGrid();
  document.querySelectorAll(".booth-motion-btn").forEach((b) => {
    b.classList.toggle("booth-motion-btn--on", b.dataset.mode === id);
  });
  updateMotionDesc();
  setStatus(
    state.camDrive
      ? `Motion · ${m.label} · drag canvas to free cam`
      : `Motion · ${m.label}`,
  );
  // One-shot Kaaba pose if driving and blueprint ready
  if (state.camDrive && kaabaBlueprint && (id === "tawafOrbit" || id.startsWith("kaaba"))) {
    kaabaBlueprint.applyCamera?.(camera, controls, 0, 1, { busy: false });
  }
  void prev;
}

function buildTierBar() {
  const host =
    document.querySelector("#booth-tier-bar-host") ||
    document.querySelector("#booth-toolbar-sources") ||
    document.querySelector(".booth-chrome");
  if (!host) return;
  // Clear previous tier bar if re-building
  host.querySelector("#booth-tier-bar")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "booth-tier-bar";
  wrap.id = "booth-tier-bar";
  for (const t of Object.values(TIERS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `booth-btn${state.tier === t.id ? " booth-btn--on" : ""}`;
    btn.dataset.tier = String(t.id);
    btn.textContent = `T${t.id}`;
    btn.title = `${t.label} — ${t.desc}`;
    btn.addEventListener("click", () => setTier(t.id));
    wrap.appendChild(btn);
  }
  if (host.id === "booth-tier-bar-host") {
    host.appendChild(wrap);
  } else {
    host.insertBefore(wrap, host.querySelector("#booth-start") || host.firstChild);
  }
}

/** Resolve / Grokpool page menubar — switch contextual tool strips */
function bindResolveMenubar() {
  const tabs = document.querySelectorAll(".booth-menutab");
  const panels = document.querySelectorAll("[data-menu-panel]");
  if (!tabs.length) return;

  const activate = (id) => {
    tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.menu === id));
    panels.forEach((p) => {
      const on = p.dataset.menuPanel === id;
      p.classList.toggle("is-active", on);
      if (on) p.removeAttribute("hidden");
      else p.setAttribute("hidden", "");
    });
    // Measure chrome for side panels
    const chrome = document.getElementById("booth-chrome");
    if (chrome) {
      const h = chrome.offsetHeight;
      document.documentElement.style.setProperty("--booth-chrome-h", `${h}px`);
    }
    // QBPM owns center canvas when selected (sides stay as control handlers)
    qbpmBridge?.onMenuActivate?.(id);
    if (id === "qbpm") {
      setStatus("QBPM · center ecosystem · side columns = handlers");
      const foot = $("#booth-footer-msg");
      if (foot) foot.textContent = "QBPM center · left/right handlers · MediaPipe IK bus";
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activate(tab.dataset.menu || "sources"));
  });
  // Hash deep-link: #qbpm
  const hashMenu = (location.hash || "").replace(/^#/, "");
  if (hashMenu === "qbpm") activate("qbpm");
  else activate("sources");

  // Keep chrome height current when window resizes
  window.addEventListener("resize", () => {
    const chrome = document.getElementById("booth-chrome");
    if (chrome) {
      document.documentElement.style.setProperty("--booth-chrome-h", `${chrome.offsetHeight}px`);
    }
  });
}

async function setTier(tier) {
  state.tier = tier;
  refreshFeeds();
  document.querySelectorAll("#booth-tier-bar .booth-btn").forEach((b) => {
    b.classList.toggle("booth-btn--on", Number(b.dataset.tier) === tier);
  });
  $("#booth-feed-grid").innerHTML = "";
  for (const k of Object.keys(feedEls)) delete feedEls[k];
  for (const k of Object.keys(feedCtx)) delete feedCtx[k];
  createLayerClouds();
  if (voxelStack) {
    cloudPivot.remove(voxelStack.group);
    voxelStack = new VoxelStack(FEEDS, PARAMS);
    voxelStack.layout = (PARAMS.voxelLayout?.value ?? 1) >= 0.5 ? "sphere" : "stack";
    voxelStack.attach(cloudPivot);
    voxelStack.setVisible(tier >= 2);
  }
  if (selectionHub) selectionHub.layerClouds = layerClouds;
  buildFeedStrip();
  syncMaskLayerFeeds();
  if (tier >= 2 && state.running) await ensureTrackHub();
  if (tier >= 4 && !audioEngine.active) {
    loadDefaultTrack().catch((e) => setStatus(e?.message || String(e), true));
  }
  setStatus(TIERS[tier].label);
}

/** Capture sources shown as on/off toggles in the left desktop rail. */
const CAPTURE_SOURCES = [
  { id: "desktop", label: "Desktop", detail: "FaceTime / built-in cam" },
  { id: "dual", label: "Dual · iPhone", detail: "Desktop + Continuity" },
  { id: "desk", label: "Desk View", detail: "Mac Continuity desk" },
  { id: "screen", label: "Screen", detail: "Window / display share" },
  { id: "live", label: "Live rail", detail: "YouTube / HLS / mp4" },
];

function isFeedToggleLocked(id) {
  // depth cloud is toggleable spatial layer; camera/spectrum remain viz-only
  return id === "camera" || id === "spectrum";
}

function makeSwitch(checked, disabled = false) {
  const wrap = document.createElement("span");
  wrap.className = "booth-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;
  input.disabled = !!disabled;
  input.setAttribute("role", "switch");
  const track = document.createElement("span");
  track.className = "booth-switch-track";
  track.setAttribute("aria-hidden", "true");
  wrap.append(input, track);
  return { wrap, input };
}

function captureSourceOn(id) {
  switch (id) {
    case "desktop":
      return (
        dualCam.mode === "desktop" ||
        dualCam.mode === "dual" ||
        dualCam.mode === "device" ||
        (dualCam.active && dualCam.mode !== "iphone" && dualCam.mode !== "deskview")
      );
    case "dual":
      return dualCam.mode === "dual" || dualCam.mode === "iphone";
    case "desk":
      return dualCam.mode === "deskview";
    case "screen":
      return screenSource.mode === "screen" || hexcastSource.mode === "screen";
    case "live":
      return !!(liveFeeds.staging || liveFeeds.items.length > 0);
    default:
      return false;
  }
}

function captureSourceDetail(id) {
  switch (id) {
    case "desktop":
      if (dualCam.mode === "desktop" || dualCam.mode === "dual" || dualCam.mode === "device") {
        return dualCam.primaryLabel ? shortSrcLabel(dualCam.primaryLabel) : dualCam.label;
      }
      return "FaceTime / built-in cam";
    case "dual":
      if (dualCam.mode === "dual") return dualCam.secondaryLabel ? shortSrcLabel(dualCam.secondaryLabel) : "spatial dual";
      if (dualCam.mode === "iphone") return dualCam.label;
      return "Desktop + Continuity";
    case "desk":
      return dualCam.mode === "deskview" ? dualCam.label : "Mac Continuity desk";
    case "screen":
      if (screenSource.mode === "screen") return "sharing · in sphere";
      if (hexcastSource.mode === "screen") return "hexcast screen";
      return "Window / display share";
    case "live":
      if (liveFeeds.staging) return liveFeeds.label || "staged";
      if (liveFeeds.items.length) return `${liveFeeds.items.length} in rail`;
      return "YouTube / HLS / mp4";
    default:
      return "";
  }
}

function shortSrcLabel(label) {
  const s = String(label || "").trim();
  return s.length > 28 ? `${s.slice(0, 26)}…` : s || "live";
}

function setFeedProcess(id, on) {
  if (!FEEDS[id] || isFeedToggleLocked(id)) return;
  FEEDS[id].process = !!on;
  if (layerClouds[id]) layerClouds[id].pts.visible = !!on;
  if (id === "joints" && jointCloud) jointCloud.visible = !!on;
  const cb = document.querySelector(`.booth-feed-head input[data-feed="${id}"]`);
  if (cb) cb.checked = !!on;
  const card = document.querySelector(`.booth-feed[data-feed="${id}"]`);
  if (card) card.classList.toggle("is-off", !on);
}

function setAllLayers(on) {
  for (const feed of Object.values(FEEDS)) {
    if (isFeedToggleLocked(feed.id)) continue;
    setFeedProcess(feed.id, on);
  }
  try {
    syncFeedProcessUi();
  } catch {
    refreshCompositeVisibility();
  }
  setStatus(on ? "Layers · all on" : "Layers · all off");
}

async function setCaptureSource(id, wantOn) {
  const row = document.querySelector(`.booth-src-row[data-source="${id}"]`);
  if (row) row.classList.add("is-busy");
  try {
    if (wantOn) {
      switch (id) {
        case "desktop":
          if (dualCam.mode === "dual") {
            // Dual already includes desktop primary
            setStatus("Desktop · already on via Dual");
          } else {
            await bootVisionAnd(startCamera);
          }
          break;
        case "dual":
          await bootVisionAnd(startDualStackScene);
          break;
        case "desk":
          await bootVisionAnd(startDeskViewCamera);
          break;
        case "screen":
          await startScreenShare({ spatial: spatialScreenOn(), keepDual: true });
          break;
        case "live":
          await bootVisionAnd(focusLiveFeeds);
          break;
        default:
          break;
      }
    } else {
      switch (id) {
        case "desktop":
          if (dualCam.mode === "dual") {
            // Keep Continuity only as single cam if secondary exists
            try {
              await bootVisionAnd(startIPhoneCamera);
            } catch {
              stopCamera();
            }
          } else if (
            dualCam.mode === "desktop" ||
            dualCam.mode === "device" ||
            dualCam.mode === "iphone" ||
            dualCam.mode === "deskview"
          ) {
            // Turning desktop off while on single desktop-like primary → stop cam
            if (dualCam.mode === "desktop" || dualCam.mode === "device") stopCamera();
            else setStatus("Desktop off · Continuity / Desk still active");
          }
          break;
        case "dual":
          if (dualCam.mode === "dual") {
            // Drop Continuity secondary, keep desktop person
            await bootVisionAnd(startCamera);
          } else if (dualCam.mode === "iphone") {
            stopCamera();
          }
          if (FEEDS.iphone) setFeedProcess("iphone", false);
          break;
        case "desk":
          if (dualCam.mode === "deskview") stopCamera();
          break;
        case "screen":
          screenSource.stop();
          if (hexcastSource.mode === "screen") hexcastSource.stop();
          secondaryRgb = null;
          screenRgb = null;
          if (FEEDS.screen) setFeedProcess("screen", false);
          if (!dualCam.active && !liveFeeds.staging) {
            state.running = false;
            $("#booth-stop") && ($("#booth-stop").disabled = true);
          }
          setStatus("Screen · off");
          break;
        case "live":
          if (liveFeeds.staging) liveFeeds.unstage();
          livePlanes?.setActive(false);
          syncCenterStage(false);
          setStatus("Live rail · off stage");
          break;
        default:
          break;
      }
    }
  } catch (err) {
    setStatus(errMessage(err, `${id} toggle failed`), true);
  } finally {
    if (row) row.classList.remove("is-busy");
    syncSourceButtons();
    refreshToolsPanel();
  }
}

function buildSourceToggles() {
  const list = $("#booth-src-list");
  if (!list) return;
  list.innerHTML = "";
  for (const src of CAPTURE_SOURCES) {
    const row = document.createElement("label");
    row.className = "booth-src-row";
    row.dataset.source = src.id;
    const meta = document.createElement("div");
    meta.className = "booth-src-meta";
    const name = document.createElement("span");
    name.className = "booth-src-name";
    name.textContent = src.label;
    const detail = document.createElement("span");
    detail.className = "booth-src-detail";
    detail.dataset.srcDetail = src.id;
    detail.textContent = captureSourceDetail(src.id);
    meta.append(name, detail);
    const { wrap, input } = makeSwitch(captureSourceOn(src.id));
    input.dataset.source = src.id;
    input.setAttribute("aria-label", `${src.label} source`);
    input.addEventListener("change", () => {
      setCaptureSource(src.id, input.checked);
    });
    row.append(meta, wrap);
    // Keep row highlight in sync without double-firing change
    row.addEventListener("click", (ev) => {
      if (ev.target === input || wrap.contains(ev.target)) return;
      // label already toggles input; no extra action
    });
    list.appendChild(row);
  }
  syncSourceToggleUi();
}

function syncSourceToggleUi() {
  for (const src of CAPTURE_SOURCES) {
    const on = captureSourceOn(src.id);
    const input = document.querySelector(`.booth-src-row input[data-source="${src.id}"]`);
    const row = document.querySelector(`.booth-src-row[data-source="${src.id}"]`);
    const detail = document.querySelector(`[data-src-detail="${src.id}"]`);
    if (input && input.checked !== on) input.checked = on;
    if (row) row.classList.toggle("is-on", on);
    if (detail) detail.textContent = captureSourceDetail(src.id);
  }
}

/** Sync layer cloud visibility + feed strip UI from FEEDS.process flags. */
function syncFeedProcessUi() {
  for (const feed of Object.values(FEEDS)) {
    const id = feed.id;
    const cb = document.querySelector(`.booth-feed-head input[data-feed="${id}"]`);
    if (cb && !cb.disabled) cb.checked = !!feed.process;
    if (layerClouds[id]) layerClouds[id].pts.visible = !!feed.process;
    if (id === "joints" && jointCloud) jointCloud.visible = !!feed.process;
    document.querySelector(`.booth-feed[data-feed="${id}"]`)?.classList.toggle("is-off", !feed.process);
  }
  // Group master switches
  for (const gid of Object.keys(LAYER_GROUPS)) {
    const input = document.querySelector(`input[data-layer-group="${gid}"]`);
    if (input) input.checked = layerGroupIsOn(FEEDS, gid);
    document.querySelector(`.booth-layer-group[data-group="${gid}"]`)?.classList.toggle(
      "is-on",
      layerGroupIsOn(FEEDS, gid),
    );
  }
  refreshCompositeVisibility();
}

function setLayerGroup(groupId, on, { exclusive = false } = {}) {
  applyLayerGroup(FEEDS, groupId, on, { exclusive });
  // Solo vs crowd mutual preference when exclusive
  if (exclusive && on) {
    state.layerGroupMode = groupId;
  } else if (!on && state.layerGroupMode === groupId) {
    state.layerGroupMode = null;
  }
  syncFeedProcessUi();
  setStatus(
    `${LAYER_GROUPS[groupId]?.label || groupId} · ${on ? "on" : "off"}${exclusive && on ? " · exclusive" : ""}`,
  );
}

function buildFeedStrip() {
  const grid = $("#booth-feed-grid");
  if (!grid) return;
  grid.innerHTML = "";

  // Group toggles: Hand·person (solo) vs Hands·crowd (edge + multi)
  const groupsBar = document.createElement("div");
  groupsBar.className = "booth-layer-groups";
  groupsBar.setAttribute("role", "group");
  groupsBar.setAttribute("aria-label", "Layer tracking groups");
  for (const g of Object.values(LAYER_GROUPS)) {
    const row = document.createElement("label");
    row.className = "booth-layer-group";
    row.dataset.group = g.id;
    row.title = g.title;
    const { wrap, input } = makeSwitch(layerGroupIsOn(FEEDS, g.id));
    input.dataset.layerGroup = g.id;
    input.setAttribute("aria-label", g.label);
    input.addEventListener("change", () => {
      // Shift/alt = additive; default exclusive mode for clear solo vs crowd
      const exclusive = !window.event?.shiftKey && !window.event?.altKey;
      setLayerGroup(g.id, input.checked, { exclusive });
    });
    const name = document.createElement("span");
    name.className = "booth-layer-group-name";
    name.textContent = g.label;
    const hint = document.createElement("span");
    hint.className = "booth-layer-group-hint";
    hint.textContent = g.id === "solo" ? "single track" : "edge · multi";
    row.append(wrap, name, hint);
    if (layerGroupIsOn(FEEDS, g.id)) row.classList.add("is-on");
    groupsBar.appendChild(row);
  }
  const exclusiveHint = document.createElement("p");
  exclusiveHint.className = "booth-layer-groups-hint";
  exclusiveHint.textContent = "Hand·person vs Hands·crowd · Shift+toggle = additive";
  grid.appendChild(groupsBar);
  grid.appendChild(exclusiveHint);

  for (const feed of Object.values(FEEDS)) {
    const card = document.createElement("div");
    card.className = "booth-feed";
    card.dataset.feed = feed.id;
    // Tag which group(s) this feed belongs to
    const inGroups = Object.values(LAYER_GROUPS)
      .filter((g) => g.feeds.includes(feed.id))
      .map((g) => g.id);
    if (inGroups.length) card.dataset.groups = inGroups.join(" ");
    if (feed.id === "edge") card.classList.add("booth-feed--edge");
    if (feed.id === state.activeFeed) card.classList.add("booth-feed--active");
    if (!feed.process) card.classList.add("is-off");

    const head = document.createElement("div");
    head.className = "booth-feed-head";
    const label = document.createElement("label");
    label.className = "booth-feed-toggle";
    const locked = isFeedToggleLocked(feed.id);
    const { wrap, input: cb } = makeSwitch(feed.process, locked);
    cb.dataset.feed = feed.id;
    cb.setAttribute("aria-label", `${feed.label} layer`);
    cb.addEventListener("change", () => {
      FEEDS[feed.id].process = cb.checked;
      if (layerClouds[feed.id]) layerClouds[feed.id].pts.visible = cb.checked;
      if (feed.id === "joints" && jointCloud) jointCloud.visible = cb.checked;
      if (feed.id === "depth" && PARAMS.depthCloud) {
        PARAMS.depthCloud.value = cb.checked ? 1 : 0;
        syncParamUi("depthCloud", PARAMS.depthCloud);
        const dc = $("#booth-depth-cloud");
        if (dc) dc.checked = cb.checked;
      }
      card.classList.toggle("is-off", !cb.checked);
      // Keep group masters in sync
      for (const gid of Object.keys(LAYER_GROUPS)) {
        const gin = document.querySelector(`input[data-layer-group="${gid}"]`);
        if (gin) gin.checked = layerGroupIsOn(FEEDS, gid);
        document.querySelector(`.booth-layer-group[data-group="${gid}"]`)?.classList.toggle(
          "is-on",
          layerGroupIsOn(FEEDS, gid),
        );
      }
      refreshCompositeVisibility();
      setStatus(`${feed.label} · ${cb.checked ? "on" : "off"}`);
    });
    const name = document.createElement("span");
    name.className = "booth-feed-name";
    name.textContent = feed.label;
    label.append(wrap, name);
    const stat = document.createElement("span");
    stat.className = "booth-feed-stat";
    stat.id = `feed-stat-${feed.id}`;
    stat.textContent = "—";
    head.append(label, stat);

    const cvs = document.createElement("canvas");
    cvs.width = SAMPLE_W;
    cvs.height = SAMPLE_H;
    cvs.addEventListener("click", () => {
      state.activeFeed = feed.id;
      selectionHub?.selectFeed(feed.id);
      document.querySelectorAll(".booth-feed").forEach((el) =>
        el.classList.toggle("booth-feed--active", el.dataset.feed === feed.id),
      );
    });
    cvs.addEventListener("dblclick", () => {
      selectionHub?.selectFeed(feed.id);
      selectionHub?.soloSelected();
      syncFeedProcessUi();
    });
    card.append(head, cvs);
    grid.appendChild(card);
    feedEls[feed.id] = cvs;
    feedCtx[feed.id] = cvs.getContext("2d", { willReadFrequently: true });
  }
}

const GROUP_LABELS = {
  cloud: "Point cloud",
  mask: "Mask",
  voxel: "Voxel sphere",
  depth: "Depth variation",
  spatial: "Spatial dual · screen",
  stack: "Desk scene stack",
  studio: "Studio broadcast · LiDAR",
  livevid: "Live video planes",
  gsplat: "Gsplat",
  music: "Music path",
  track: "Live IK · MediaPipe",
  scene: "Scene",
  analysis: "Spatial analysis · TF",
  kaaba: "Kaaba · Haram blueprint",
  blueprint: "Blueprint layouts",
};

/** Master enable key on subsection summary (switch) — real PARAMS keys. */
const GROUP_ENABLE = {
  cloud: null,
  mask: null,
  depth: null,
  spatial: "spatialDual",
  stack: "stackEnable",
  studio: "studioMode",
  livevid: "liveFloor",
  voxel: null,
  gsplat: null,
  music: null,
  track: "ikEnable",
  scene: null,
  analysis: "analysisEnable",
  kaaba: "kaabaEnable",
  blueprint: "blueprintEnable",
};

/**
 * Soft off targets for groups without a dedicated enable param.
 * When the section switch is off, values are stashed and replaced; re-enable restores.
 */
const GROUP_SOFT_OFF = {
  cloud: { opacity: 0.06 },
  mask: { feather: 0 },
  depth: { depthVariation: 0, depthWaveform: 0 },
  voxel: { sphereBlend: 0, sphereParallax: 0 },
  gsplat: { splatMix: 0 },
  music: { musicalGain: 0 },
  scene: { spin: 0, fog: 0 },
};

/** Stashed param values while a soft-off section is disabled. */
const groupSoftStash = {};

/** Open by default when Point cloud & depth is expanded. */
const GROUP_OPEN = {
  cloud: true,
  mask: true,
  depth: true,
  spatial: true,
  stack: false,
  studio: false,
  livevid: false,
  voxel: true,
  gsplat: true,
  music: false,
  track: false,
  scene: false,
  analysis: true,
  kaaba: false,
  blueprint: true,
};

const SLIDER_GROUP_ORDER = [
  "cloud",
  "mask",
  "depth",
  "spatial",
  "stack",
  "studio",
  "livevid",
  "voxel",
  "gsplat",
  "music",
  "track",
  "scene",
  "analysis",
  "blueprint",
  "kaaba",
];

/** 0–1 step-1 params that mean on/off (not multi-mode enums). */
function isToggleParam(key, spec) {
  if (!spec) return false;
  if (
    key === "voxelLayout" ||
    key === "depthMode" ||
    key === "ikProfile" ||
    key === "kaabaCamPreset" ||
    key === "blueprintLayout"
  ) {
    return false;
  }
  return Number(spec.min) === 0 && Number(spec.max) === 1 && Number(spec.step) === 1;
}

function syncParamUi(key, spec) {
  if (!spec) return;
  if (spec.input) {
    if (spec.input.type === "checkbox") {
      spec.input.checked = (spec.value ?? 0) >= 0.5;
    } else {
      spec.input.value = String(spec.value);
    }
  }
  if (spec.output) spec.output.textContent = formatParam(key, spec.value);
  // Mirror motion-panel spatial checkboxes / section master switches
  const mirror = document.querySelectorAll(`input[data-param-mirror="${key}"]`);
  mirror.forEach((el) => {
    el.checked = (spec.value ?? 0) >= 0.5;
  });
}
window.syncParamUi = syncParamUi;

function onParamChanged(key, spec, g) {
  delete spec._handBase;
  if (spec.output) spec.output.textContent = formatParam(key, spec.value);
  // Keep primary control + any mirrors (motion panel / section masters) aligned
  if (spec.input) {
    if (spec.input.type === "checkbox") {
      const on = (spec.value ?? 0) >= 0.5;
      if (spec.input.checked !== on) spec.input.checked = on;
    } else if (document.activeElement !== spec.input) {
      spec.input.value = String(spec.value);
    }
  }
  document.querySelectorAll(`input[data-param-mirror="${key}"]`).forEach((el) => {
    if (el === spec.input) return;
    el.checked = (spec.value ?? 0) >= 0.5;
  });
  // Section master dimming
  document.querySelectorAll(`details.booth-subsec[data-group]`).forEach((d) => {
    const en = GROUP_ENABLE[d.dataset.group];
    if (en === key) d.classList.toggle("is-disabled", (spec.value ?? 0) < 0.5);
  });

  syncUniforms();
  if (g === "voxel" && voxelStack) {
    if (key === "voxelLayout") {
      voxelStack.setLayout(spec.value >= 0.5 ? "sphere" : "stack");
    } else {
      voxelStack.layout = (PARAMS.voxelLayout?.value ?? 1) >= 0.5 ? "sphere" : "stack";
      voxelStack.rebuildGrid();
    }
  }
  if (key === "spatialDual" || key === "spatialScreen") {
    dualCam.spatialLayer = spatialDualOn();
    if (key === "spatialDual" && FEEDS.iphone) {
      FEEDS.iphone.process = spatialDualOn() && dualCam.mode === "dual";
    }
    if (key === "spatialScreen" && FEEDS.screen) {
      FEEDS.screen.process = spatialScreenOn() && screenSource.mode === "screen";
    }
    document.querySelectorAll(".booth-feed-head input[type=checkbox]").forEach((c) => {
      const id = c.dataset.feed;
      if (id === "iphone" || id === "screen") {
        c.checked = !!FEEDS[id]?.process;
        if (layerClouds[id]) layerClouds[id].pts.visible = !!FEEDS[id]?.process;
      }
    });
    try {
      syncSourceButtons();
    } catch {
      /* boot order */
    }
  }
  if (key === "spatialDualBaseline") {
    dualCam.spatialBaseline = spec.value;
  }
  if (g === "stack" && sceneStack) sceneStack.rebuild();
  if (g === "studio" && studioSpatial) studioSpatial.rebuild();
  if (g === "blueprint" || key === "blueprintLayout" || key === "blueprintEnable") {
    if (key === "blueprintLayout") {
      // Selection only — load when Active is on
      document.querySelectorAll("#booth-blueprint-layouts .booth-motion-btn").forEach((b) => {
        b.classList.toggle("booth-motion-btn--on", b.dataset.blueprint === String(Math.round(spec.value)));
      });
      if (blueprintIsActive()) void applySelectedBlueprint({ forceEnable: true });
      else setStatus(`Blueprint · ${layoutLabel(spec.value)} selected (inactive)`);
    } else if (key === "blueprintEnable") {
      if (spec.value >= 0.5) void applySelectedBlueprint({ forceEnable: true });
      else {
        kaabaBlueprint?.setVisible(false);
        if (PARAMS.kaabaEnable) PARAMS.kaabaEnable.value = 0;
        setStatus("Blueprint · off");
      }
    }
  }
  if (g === "kaaba" || key?.startsWith?.("kaaba")) {
    if (key === "kaabaEnable") {
      if (spec.value >= 0.5) {
        // Prefer catalog path so layout index stays in sync
        if (PARAMS.blueprintLayout) PARAMS.blueprintLayout.value = layoutIndexById("kaaba");
        if (PARAMS.blueprintEnable) PARAMS.blueprintEnable.value = 1;
        void ensureKaabaBlueprint({ enable: true });
      } else if (kaabaBlueprint) {
        kaabaBlueprint.setVisible(false);
      }
    } else if (kaabaBlueprint) {
      if (key === "kaabaCamPreset") {
        const p = KAABA_CAM_PRESETS[Math.round(spec.value)] || KAABA_CAM_PRESETS[0];
        if (p) kaabaBlueprint.setActiveCam(p.id);
      } else if (key === "kaabaScale" || key === "kaabaY") {
        kaabaBlueprint.rebuild({ force: true, eager: false });
      } else {
        kaabaBlueprint.scheduleLazyBuild({ force: false });
        kaabaBlueprint.syncPartVisibility?.();
        kaabaBlueprint.pumpLazy({ budget: 1 });
      }
    }
    // Do NOT auto-import Kaaba when params appear but layout is not kaaba
  }
  if (key === "liveFloat") {
    livePlanes?.setFloatVisible(spec.value >= 0.5);
    liveFeeds?._syncPlaybackUi?.();
  }
  if (key === "liveFloor" && livePlanes?.active) {
    livePlanes.setVisible(true);
  }
  if (key === "ikEnable") {
    $("#booth-ik-toggle")?.classList.toggle("booth-btn--on", spec.value >= 0.5);
    const ikBtn = $("#booth-ik-toggle");
    if (ikBtn) ikBtn.textContent = spec.value >= 0.5 ? "IK on" : "IK off";
  }
  if (key === "maxPeople" && state.tier >= 2) {
    refreshFeeds();
    buildFeedStrip();
    createLayerClouds();
    if (selectionHub) selectionHub.layerClouds = layerClouds;
    ensureTrackHub(true).catch(() => {});
  }
}

function makeParamRow(key, spec, g) {
  const row = document.createElement("div");
  row.className = "booth-slider";
  const id = `booth-param-${key}`;
  const labelText = spec.midiCc != null ? `${spec.label} · CC${spec.midiCc}` : spec.label;

  if (isToggleParam(key, spec)) {
    row.classList.add("booth-slider--toggle");
    const lab = document.createElement("label");
    lab.className = "booth-toggle-row";
    lab.htmlFor = id;
    const name = document.createElement("span");
    name.className = "booth-toggle-label";
    name.textContent = labelText;
    const { wrap, input } = makeSwitch((spec.value ?? 0) >= 0.5);
    input.id = id;
    input.dataset.param = key;
    input.setAttribute("aria-label", spec.label);
    const out = document.createElement("output");
    out.textContent = formatParam(key, spec.value);
    input.addEventListener("change", () => {
      spec.value = input.checked ? 1 : 0;
      onParamChanged(key, spec, g);
    });
    lab.append(name, wrap);
    row.append(lab, out);
    spec.input = input;
    spec.output = out;
    return row;
  }

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "range";
  input.id = id;
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.value);
  input.dataset.param = key;
  const out = document.createElement("output");
  out.textContent = formatParam(key, spec.value);
  input.addEventListener("input", () => {
    spec.value = Number(input.value);
    onParamChanged(key, spec, g);
  });
  row.append(label, input, out);
  spec.input = input;
  spec.output = out;
  return row;
}

function setSoftGroupEnabled(g, on) {
  const soft = GROUP_SOFT_OFF[g];
  if (!soft) return;
  if (!on) {
    if (!groupSoftStash[g]) groupSoftStash[g] = {};
    for (const [key, offVal] of Object.entries(soft)) {
      const spec = PARAMS[key];
      if (!spec) continue;
      if (groupSoftStash[g][key] == null) groupSoftStash[g][key] = spec.value;
      spec.value = offVal;
      delete spec._handBase;
      syncParamUi(key, spec);
    }
  } else if (groupSoftStash[g]) {
    for (const [key, val] of Object.entries(groupSoftStash[g])) {
      const spec = PARAMS[key];
      if (!spec) continue;
      spec.value = val;
      delete spec._handBase;
      syncParamUi(key, spec);
    }
    delete groupSoftStash[g];
  }
  syncUniforms();
}

function makeSubsec(g, bodyFiller) {
  const details = document.createElement("details");
  details.className = "booth-subsec";
  details.dataset.group = g;
  if (GROUP_OPEN[g] !== false) details.open = true;

  const summary = document.createElement("summary");
  summary.className = "booth-subsec-sum";

  const title = document.createElement("span");
  title.className = "booth-subsec-title";
  title.textContent = GROUP_LABELS[g] || g;
  summary.appendChild(title);

  const enableKey = GROUP_ENABLE[g];
  const hasParamEnable = !!(enableKey && PARAMS[enableKey]);
  const hasSoftEnable = !!GROUP_SOFT_OFF[g];

  if (hasParamEnable || hasSoftEnable) {
    const initiallyOn = hasParamEnable ? (PARAMS[enableKey].value ?? 0) >= 0.5 : true;
    const { wrap, input } = makeSwitch(initiallyOn);
    input.dataset.groupEnable = g;
    if (hasParamEnable) input.dataset.paramMirror = enableKey;
    input.setAttribute("aria-label", `${GROUP_LABELS[g] || g} enable`);
    // Don't let switch clicks collapse/expand the subsection
    for (const type of ["click", "pointerdown", "mousedown"]) {
      wrap.addEventListener(type, (ev) => ev.stopPropagation());
      input.addEventListener(type, (ev) => ev.stopPropagation());
    }
    input.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const on = input.checked;
      if (hasParamEnable) {
        const spec = PARAMS[enableKey];
        spec.value = on ? 1 : 0;
        if (spec.input && spec.input !== input) {
          if (spec.input.type === "checkbox") spec.input.checked = on;
          else spec.input.value = String(spec.value);
        }
        onParamChanged(enableKey, spec, g);
      } else {
        setSoftGroupEnabled(g, on);
      }
      details.classList.toggle("is-disabled", !on);
      setStatus(`${GROUP_LABELS[g] || g} · ${on ? "on" : "off"}`);
    });
    summary.appendChild(wrap);
    details.classList.toggle("is-disabled", !initiallyOn);
  }

  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "booth-subsec-body";
  bodyFiller(body);
  details.appendChild(body);
  return details;
}

function buildMaskExtras(body) {
  const maskRow = document.createElement("div");
  maskRow.className = "booth-slider";
  const maskLabel = document.createElement("label");
  maskLabel.textContent = "Mask layer";
  const maskSelect = document.createElement("select");
  maskSelect.className = "booth-select";
  maskSelect.id = "booth-mask-layer";
  for (const [val, text] of [
    ["person", "Person"],
    ["background", "Background"],
    ["both", "Both"],
  ]) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = text;
    if (val === state.maskLayer) o.selected = true;
    maskSelect.appendChild(o);
  }
  maskSelect.addEventListener("change", () => {
    state.maskLayer = maskSelect.value;
    syncMaskLayerFeeds();
  });
  maskRow.append(maskLabel, maskSelect);
  body.appendChild(maskRow);

  const invertRow = document.createElement("div");
  invertRow.className = "booth-slider booth-slider--toggle";
  const invertLab = document.createElement("label");
  invertLab.className = "booth-toggle-row";
  const invertName = document.createElement("span");
  invertName.className = "booth-toggle-label";
  invertName.textContent = "Invert mask";
  const { wrap, input: invertCb } = makeSwitch(state.maskPolarity < 0);
  invertCb.id = "booth-mask-invert";
  invertCb.setAttribute("aria-label", "Invert mask");
  invertCb.addEventListener("change", () => {
    state.maskPolarity = invertCb.checked ? -1 : 1;
    state.maskCalibrated = true;
  });
  invertLab.append(invertName, wrap);
  invertRow.append(invertLab);
  body.appendChild(invertRow);
}

function buildDepthModeButtons(body) {
  const wrap = document.createElement("div");
  wrap.className = "booth-depth-modes";
  for (let i = 0; i < DEPTH_MODES.length; i++) {
    const mode = DEPTH_MODES[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "booth-motion-btn";
    btn.dataset.depthMode = String(i);
    btn.textContent = mode.label;
    btn.title = mode.desc;
    if (Math.round(PARAMS.depthMode?.value ?? 0) === i) btn.classList.add("booth-motion-btn--on");
    btn.addEventListener("click", () => {
      if (PARAMS.depthMode) {
        PARAMS.depthMode.value = i;
        syncParamUi("depthMode", PARAMS.depthMode);
      }
      document.querySelectorAll(".booth-depth-modes .booth-motion-btn").forEach((b) =>
        b.classList.toggle("booth-motion-btn--on", b.dataset.depthMode === String(i)),
      );
      setStatus(`Depth · ${mode.label}`);
    });
    wrap.appendChild(btn);
  }
  body.appendChild(wrap);
}

function buildSliders() {
  const panel = $("#booth-sliders");
  if (!panel) return;
  panel.innerHTML = "";

  const groups = {};
  for (const [key, spec] of Object.entries(PARAMS)) {
    // Motion tune lives in Motion & spatial panel
    if (spec.group === "motion") continue;
    const g = spec.group || "cloud";
    if (!groups[g]) groups[g] = [];
    groups[g].push([key, spec]);
  }

  for (const g of SLIDER_GROUP_ORDER) {
    const entries = groups[g];
    // mask section always shown (layer select even if no mask params somehow)
    if (!entries?.length && g !== "mask") continue;

    const sub = makeSubsec(g, (body) => {
      if (g === "mask") buildMaskExtras(body);
      if (g === "depth") buildDepthModeButtons(body);
      for (const [key, spec] of entries || []) {
        // Master enable already on summary — still show as row for clarity / MIDI label
        body.appendChild(makeParamRow(key, spec, g));
      }
    });
    panel.appendChild(sub);
  }
}

function buildToolsPanel() {
  const list = $("#booth-tool-list");
  list.innerHTML = "";
  const tools = [
    { id: "seg", name: "MediaPipe seg", detail: "Selfie segmenter" },
    { id: "crowdseg", name: "Crowd multi-scale", detail: "DBFace tiles · motion · BodyPix" },
    { id: "kaaba", name: "Kaaba blueprint", detail: "Lazy parts · tawaf orbit" },
    { id: "face", name: "Face landmarker", detail: "Tier 2+" },
    { id: "hand", name: "Hand → depth/wave", detail: "21×2 · control bus" },
    { id: "pose", name: "Pose landmarker", detail: "33 body joints" },
    { id: "select", name: "Selection", detail: "Alt/RMB pick · solo" },
    { id: "depthvar", name: "Depth variation", detail: "Splatline modes" },
    { id: "depthcloud", name: "Depth spatial cloud", detail: "unproject monocular pass" },
    { id: "scenestack", name: "Desk scene stack", detail: "Person · desk · screen view" },
    { id: "studio", name: "Studio LiDAR", detail: "Broadcast · columns · paths" },
    { id: "analysis", name: "Spatial analysis", detail: "Voxel wave · TF predict" },
    { id: "kaaba", name: "Kaaba blueprint", detail: "Mataf · gates · towers · cams" },
    { id: "liveplanes", name: "Live floor · float", detail: "Hi-res floor + ghost center" },
    { id: "lazy", name: "Lazy load", detail: "Vision · HLS · single-flight" },
    { id: "autocal", name: "AI auto-cal", detail: "Scene presets" },
    { id: "devlink", name: "Linked devices", detail: "Pin Continuity / USB" },
    { id: "jax", name: "JAX depth", detail: "127.0.0.1:8767" },
    { id: "zipdepth", name: "ZipDepth", detail: "multi-scale · :8766" },
    { id: "wasm", name: "WASM modulator", detail: "MIDI curves" },
    { id: "music", name: "Music bus", detail: "Beat · harmonic" },
    { id: "audio", name: "Audio FFT", detail: "Mic · track · bass/mid/high" },
    { id: "voxel", name: "Voxel sphere", detail: "Nested multi-source" },
    { id: "hexcast", name: "Hexcast receive", detail: "BroadcastChannel" },
    { id: "screen", name: "Screen spatial", detail: "Window · display → sphere" },
    { id: "dualcam", name: "Dual spatial", detail: dualCam.active ? dualCam.label : "Desktop + Continuity" },
    { id: "live", name: "Live multi-source", detail: liveFeeds.staging ? liveFeeds.label : "blank · qbpm rail" },
  ];
  for (const t of tools) {
    const li = document.createElement("li");
    li.className = "booth-tool";
    li.id = `tool-${t.id}`;
    li.innerHTML = `<span class="booth-tool-dot"></span><span class="booth-tool-name">${t.name}</span><span class="booth-tool-stat">…</span><span class="booth-tool-detail">${t.detail}</span>`;
    list.appendChild(li);
  }
  const midiHelp = $("#booth-midi-map");
  if (midiHelp) midiHelp.innerHTML = MUSIC_CC_MAP.map((l) => `<span>${l}</span>`).join("<br>");
}

async function refreshToolsPanel() {
  setTool("seg", !!state.segmenter, state.segmenter ? `${state.lastSegMs.toFixed(0)}ms` : "off");
  {
    const cs = crowdSeg?.snapshot?.() || {};
    setTool(
      "crowdseg",
      !!(PARAMS.crowdSegEnable?.value >= 0.5 && state.segmenter),
      cs.mode === "off"
        ? "off"
        : `f${cs.faces || 0} t${cs.tiles || 0} m${((cs.motionFrac || 0) * 100) | 0}% ${cs.ms != null ? cs.ms.toFixed(0) + "ms" : ""}`,
    );
  }
  {
    const prog = kaabaBlueprint?.loadProgress;
    setTool(
      "kaaba",
      !!(kaabaBlueprint?.enabled),
      !kaabaBlueprint
        ? "lazy"
        : prog
          ? `${prog.loaded}/${prog.total} · ${kaabaBlueprint.lod || "full"}`
          : "on",
    );
  }

  const handOn = !!(trackHub?.masks?.leftHand || trackHub?.masks?.rightHand) || handCtrl.signals?.active;
  setTool("hand", handOn, handCtrl.signals?.active
    ? `d${handCtrl.depthMod.toFixed(2)} w${handCtrl.waveMod.toFixed(2)}`
    : "2×");
  setTool("pose", !!trackHub?.masks?.pose, "33");
  setTool("select", !!selectionHub?.selected, selectionHub?.selected?.label || "idle");
  setTool("depthvar", true, resolveDepthMode(PARAMS).label);
  {
    const n = state.spatialDepthCloud?.count ?? state.layerCounts?.depth ?? 0;
    const on = (PARAMS.depthCloud?.value ?? 1) >= 0.5 && !!FEEDS.depth?.process;
    const backend = state.spatialDepthCloud?.meta?.backend || (on ? "…" : "off");
    setTool("depthcloud", on && n > 0, on ? `${n.toLocaleString()} pts · ${backend}` : "off");
  }
  setTool(
    "scenestack",
    !!sceneStack?.enabled,
    sceneStack?.enabled
      ? `scr ${(PARAMS.stackScreenDist?.value ?? 1.35).toFixed(2)} · camB ${(PARAMS.stackCamBDist?.value ?? 1.85).toFixed(2)}`
      : "off",
  );
  setTool(
    "studio",
    (PARAMS.studioMode?.value ?? 0) >= 0.5,
    (PARAMS.studioMode?.value ?? 0) >= 0.5
      ? `wave ×${(PARAMS.studioWaveGain?.value ?? 2).toFixed(1)} · d${(PARAMS.studioPeopleDepth?.value ?? 1.8).toFixed(1)}`
      : "off",
  );
  {
    const snap = state.analysis || spatialAnalyzer?.snapshot?.();
    setTool(
      "analysis",
      !!(spatialAnalyzer?.enabled && (PARAMS.studioMode?.value ?? 0) >= 0.5),
      snap?.status
        ? `${snap.pattern} · ${(snap.circularity * 100) | 0}%circ · pred ${snap.predictions?.length || 0}`
        : spatialAnalyzer?.enabled
          ? "armed"
          : "off",
    );
  }
  setTool(
    "kaaba",
    !!(kaabaBlueprint?.enabled),
    kaabaBlueprint?.enabled
      ? `${kaabaBlueprint.activePreset?.()?.label || "on"} · scale ${(PARAMS.kaabaScale?.value ?? 1).toFixed(2)}`
      : "off",
  );
  setTool(
    "liveplanes",
    !!(liveFeeds.staging && livePlanes?.active),
    liveFeeds.staging
      ? `floor ${(PARAMS.liveFloorOpacity?.value ?? 0.9).toFixed(2)} · float ${(PARAMS.liveFloatOpacity?.value ?? 0.38).toFixed(2)}`
      : "off",
  );
  setTool(
    "lazy",
    state.visionPhase === "ready" || lazy.isLoading("vision"),
    state.visionPhase === "loading"
      ? "loading…"
      : state.visionPhase === "error"
        ? `err · ${String(state.visionError || "").slice(0, 28)}`
        : state.visionPhase === "ready"
          ? "vision ready"
          : "idle",
  );
  setTool(
    "autocal",
    autoCal.enabled || !!autoCal.lastResult,
    autoCal.lastResult ? `${autoCal.lastResult.label || autoCal.lastResult.class}` : "idle",
  );
  setTool("devlink", deviceLinks.list().length > 0, `${deviceLinks.list().length} linked`);
  let jaxOn = false;
  try {
    jaxOn = (await fetch("http://127.0.0.1:8767/health", { cache: "no-store" })).ok;
  } catch { /* */ }
  setTool("jax", jaxOn, jaxOn ? "live" : "off");
  window.aitoMac?.setJaxEnabled?.(jaxOn);

  let zipOn = false;
  let zipBackend = "off";
  try {
    const zr = await fetch("http://127.0.0.1:8766/health", { cache: "no-store" });
    if (zr.ok) {
      zipOn = true;
      const zj = await zr.json().catch(() => ({}));
      zipBackend = zj.backend || "live";
    }
  } catch { /* */ }
  const zipMode = resolveDepthMode(PARAMS).id === "zipdepth";
  setTool(
    "zipdepth",
    zipOn || zipMode,
    zipOn ? zipBackend : zipMode ? "client" : "off",
  );
  // Enable sidecar fetch whenever health is up, or always try when ZipDepth mode is selected
  window.aitoMac?.setZipDepthEnabled?.(zipOn || zipMode);
  setTool("wasm", !!(window.aitoMac?.hasWasm?.()), "mod");
  setTool("music", musicBus.beat > 0.02 || state.midiInput, musicBus.beat.toFixed(2));
  const audioStat = audioEngine.active
    ? `${audioEngine.mode === "track" ? audioEngine.trackLabel : "mic"} ${musicBus.audioEnergy.toFixed(2)}`
    : "off";
  setTool("audio", audioEngine.active, audioStat);
  const layout = (PARAMS.voxelLayout?.value ?? 1) >= 0.5 ? "sphere" : "stack";
  setTool("voxel", state.tier >= 2, `${layout} · nest ${(PARAMS.sphereNest?.value ?? 0.22).toFixed(2)}`);
  setTool("hexcast", hexcastSource.mode === "hexcast", hexcastSource.label);
  const scrPts = state.layerCounts?.screen ?? 0;
  setTool(
    "screen",
    screenSource.mode === "screen",
    screenSource.mode === "screen"
      ? `${spatialScreenOn() ? "sphere" : "cap"} · ${scrPts}`
      : spatialScreenOn()
        ? "opt on"
        : "off",
  );
  const dualPts = state.layerCounts?.iphone ?? 0;
  setTool(
    "dualcam",
    dualCam.active,
    dualCam.mode === "dual"
      ? `${spatialDualOn() ? "sphere" : dualCam.combine} · ${dualPts}`
      : dualCam.active
        ? dualCam.label
        : "off",
  );
  setTool(
    "live",
    liveFeeds.items.length > 0 || liveFeeds.staging,
    liveFeeds.staging ? liveFeeds.label : liveFeeds.items.length ? `${liveFeeds.items.length} src` : "off",
  );
  setTool("face", !!(trackHub?.ready), trackHub ? `${trackHub.personCount}/${MAX_PEOPLE} · ${trackHub.lastMs.toFixed(0)}ms` : "T2+");
}

function setTool(id, on, stat) {
  const dot = document.querySelector(`#tool-${id} .booth-tool-dot`);
  const statEl = document.querySelector(`#tool-${id} .booth-tool-stat`);
  if (dot) dot.className = `booth-tool-dot${on ? " booth-tool-dot--on" : ""}`;
  if (statEl) statEl.textContent = stat;
}

function syncMaskLayerFeeds() {
  const layer = state.maskLayer || "person";
  if (FEEDS.person) FEEDS.person.process = layer === "person" || layer === "both";
  if (FEEDS.background) FEEDS.background.process = layer === "background" || layer === "both";
  document.querySelectorAll(".booth-feed-head input[type=checkbox]").forEach((cb) => {
    const id = cb.dataset.feed;
    if (id === "person" || id === "background") cb.checked = FEEDS[id]?.process;
    if (layerClouds[id]) layerClouds[id].pts.visible = FEEDS[id]?.process;
  });
  refreshCompositeVisibility();
}

function refreshCompositeVisibility() {
  if (!layerClouds.composite) return;
  const anyLayer = Object.entries(FEEDS).some(
    ([id, f]) => f.process && layerClouds[id] && id !== "composite",
  );
  layerClouds.composite.pts.visible = FEEDS.composite?.process && anyLayer;
}

window.formatParam = function formatParam(key, v) {
  if (key === "stride") return String(Math.round(v));
  if (key === "hue" || key === "harmonicHue") return `${Math.round(v * 360)}°`;
  if (key === "splatRot" || key === "sphereSpin") return `${v.toFixed(2)} rad`;
  if (key === "maxPeople") return String(Math.round(v));
  if (key === "depthMode") return DEPTH_MODES[Math.round(v)]?.label ?? String(v);
  if (key === "voxelLayout") return v >= 0.5 ? "sphere" : "stack";
  if (key === "ikProfile") return profileFromParam(v).label;
  if (key === "kaabaCamPreset") {
    return KAABA_CAM_PRESETS[Math.round(v)]?.label ?? String(v);
  }
  if (key === "blueprintLayout") {
    return layoutLabel(v);
  }
  if (PARAMS[key] && isToggleParam(key, PARAMS[key])) {
    return v >= 0.5 ? "on" : "off";
  }
  if (PARAMS[key] && Number(PARAMS[key].step) >= 1 && Math.abs(v - Math.round(v)) < 1e-6) {
    return String(Math.round(v));
  }
  return Number(v).toFixed(2);
};

window.syncUniforms = function syncUniforms() {
  scene.fog.density = PARAMS.fog.value;
  const beat = musicBus.drive(
    PARAMS.musicalGain?.value ?? 1,
    PARAMS.bassDrive?.value ?? 0,
    PARAMS.midDrive?.value ?? 0,
  );
  const mix = PARAMS.splatMix?.value ?? 0.85;
  const harmonic = (PARAMS.harmonicHue?.value ?? 0) * musicBus.harmonic;
  for (const cloud of Object.values(layerClouds)) {
    const u = cloud.mat.uniforms;
    if (!u) continue;
    u.uSize.value = PARAMS.size.value;
    u.uDispersion.value = PARAMS.dispersion.value * (1 + musicBus.mid * (PARAMS.midDrive?.value ?? 0) * 0.15);
    u.uGlow.value = PARAMS.glow.value;
    u.uHue.value = (PARAMS.hue.value + harmonic * 0.35) % 1;
    u.uOpacity.value = PARAMS.opacity.value * (0.65 + mix * 0.35);
    u.uJitter.value = PARAMS.jitter.value;
    u.uTilt.value = PARAMS.tilt.value;
    if (u.uBeat) u.uBeat.value = beat;
    if (u.uMusical) u.uMusical.value = PARAMS.musicalGain?.value ?? 1;
    if (u.uLayerPulse) u.uLayerPulse.value = PARAMS.layerPulse?.value ?? 0;
    if (u.uSplatStretch) u.uSplatStretch.value = PARAMS.splatStretch?.value ?? 1.35;
    if (u.uSplatSharp) u.uSplatSharp.value = PARAMS.splatSharp?.value ?? 14;
    if (u.uSplatMix) u.uSplatMix.value = mix;
    if (u.uSplatGlow) u.uSplatGlow.value = PARAMS.splatGlow?.value ?? 0.65;
    if (u.uSplatBeatSize) u.uSplatBeatSize.value = PARAMS.splatBeatSize?.value ?? 0.4;
    if (u.uSplatRot) u.uSplatRot.value = PARAMS.splatRot?.value ?? 0;
    if (u.uSplatBloom) u.uSplatBloom.value = PARAMS.splatBloom?.value ?? 0.3;
    if (u.uSplatRipple) u.uSplatRipple.value = PARAMS.splatRipple?.value ?? 0.25;
    if (u.uShardLen) u.uShardLen.value = PARAMS.shardLen?.value ?? 1.4;
    if (u.uRadialStretch) u.uRadialStretch.value = PARAMS.radialFan?.value ?? 0.9;
    if (u.uDepthStretch) {
      u.uDepthStretch.value = (PARAMS.depthStretch?.value ?? 0.55) * (1 + state.handDepthAdd * 0.4);
    }
    if (u.uSplatRipple && state.handWaveform > 0) {
      u.uSplatRipple.value = Math.min(1, (PARAMS.splatRipple?.value ?? 0.25) + state.handWaveform * 0.35);
    }
    // Selective focus size (Splatline bokeh-ish)
    if (u.uSize && resolveDepthMode(PARAMS).id === "focus") {
      u.uSize.value = PARAMS.size.value * focusSizeMul(0.5, PARAMS);
    }
    if (u.uHarmonic) u.uHarmonic.value = musicBus.harmonic;
    if (u.uBass) u.uBass.value = musicBus.bass * (PARAMS.bassDrive?.value ?? 0);
    if (u.uMid) u.uMid.value = musicBus.mid * (PARAMS.midDrive?.value ?? 0);
    if (u.uHigh) u.uHigh.value = musicBus.high * (PARAMS.highDrive?.value ?? 0);
  }
  if (jointCloud?.material?.uniforms) {
    const ju = jointCloud.material.uniforms;
    ju.uSize.value = PARAMS.jointSize?.value ?? 0.014;
    if (ju.uBeat) ju.uBeat.value = beat;
    if (ju.uHarmonic) ju.uHarmonic.value = musicBus.harmonic;
    if (ju.uBass) ju.uBass.value = musicBus.bass * (PARAMS.bassDrive?.value ?? 0);
  }
};

function setStatus(msg, isErr = false) {
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("booth-status--err", isErr);
  }
  // Keep Resolve header monitor in sync
  const mon = document.getElementById("booth-mon-tier");
  if (mon) mon.textContent = `T${state.tier}`;
}

// —— Lazy load: vision / models (single-flight + retry) ——

const lazy = createLazyCache({
  onProgress: (p) => {
    state.lazyOps = lazy.snapshot();
    if (p.key === "vision" || p.key === "fileset" || p.key === "segmenter") {
      if (p.phase === "loading") {
        state.visionPhase = "loading";
        state.visionError = null;
        if (p.attempt > 1) {
          setStatus(`Loading vision… retry ${p.attempt}`);
        } else {
          setStatus(`Loading ${p.label || p.key}…`);
        }
      } else if (p.phase === "ready" && p.key === "vision") {
        state.visionPhase = "ready";
        state.visionError = null;
      } else if (p.phase === "error") {
        state.visionPhase = "error";
        state.visionError = p.detail || errMessage(p.error);
      }
    }
  },
});

async function ensureFileset(force = false) {
  return lazy.load(
    "fileset",
    async () => {
      const fs = await FilesetResolver.forVisionTasks(
        MEDIAPIPE.cdnWasm,
      );
      fileset = fs;
      return fs;
    },
    { label: "MediaPipe WASM", retries: 2, retryDelayMs: 500, force, timeoutMs: 45000 },
  );
}

async function ensureSegmenter(force = false) {
  if (!force && state.segmenter) return state.segmenter;
  return lazy.load(
    "segmenter",
    async () => {
      const fs = await ensureFileset(force);
      // Prefer GPU; fall back to CPU if GPU init fails
      let seg;
      try {
        seg = await ImageSegmenter.createFromOptions(fs, {
          baseOptions: {
            modelAssetPath: MEDIAPIPE.models.selfie,
            delegate: "GPU",
          },
          runningMode: "IMAGE",
          outputCategoryMask: true,
          outputConfidenceMasks: true,
        });
      } catch (gpuErr) {
        setStatus(`GPU segmenter failed · CPU fallback…`);
        seg = await ImageSegmenter.createFromOptions(fs, {
          baseOptions: {
            modelAssetPath: MEDIAPIPE.models.selfie,
            delegate: "CPU",
          },
          runningMode: "IMAGE",
          outputCategoryMask: true,
          outputConfidenceMasks: true,
        });
      }
      state.segmenter = seg;
      // Warm DBFace-style face detector for small/distant people (crowd / spire)
      crowdSeg.initFaceDetector(fs).catch((e) => {
        console.warn("[crowd-seg] face detector", e);
      });
      return seg;
    },
    { label: "Selfie segmenter", retries: 1, retryDelayMs: 600, force, timeoutMs: 60000 },
  );
}

function currentTrackModels() {
  const prof = profileFromParam(PARAMS.ikProfile?.value ?? 1);
  trackProfileId = prof.id;
  liveIk.setProfile(prof.id);
  return modelsForProfile(prof.id);
}

async function ensureTrackHub(force = false) {
  if (state.tier < 2) return null;
  const n = Math.round(PARAMS.maxPeople?.value ?? 2);
  const models = currentTrackModels();
  const key = `trackHub:${n}:${models.face ? 1 : 0}${models.hands ? 1 : 0}${models.pose ? 1 : 0}`;
  if (
    !force &&
    trackHub?.ready &&
    trackHub.maxPeople === n &&
    trackHub._lazyKey === key
  ) {
    trackHub.setProfileFlags(models);
    return trackHub;
  }
  return lazy.load(
    key,
    async () => {
      const fs = await ensureFileset();
      const hub = new TrackHub(SAMPLE_W, SAMPLE_H, n, models);
      await hub.init(fs);
      hub._lazyKey = key;
      trackHub = hub;
      return hub;
    },
    {
      label: `Trackers · ${trackProfileId}`,
      retries: 1,
      retryDelayMs: 500,
      force,
      timeoutMs: 90000,
    },
  );
}

function setIkProfile(id) {
  const keys = Object.keys(TRACK_PROFILES);
  const idx = keys.indexOf(id);
  if (idx < 0) return;
  if (PARAMS.ikProfile) {
    PARAMS.ikProfile.value = idx;
    if (PARAMS.ikProfile.input) PARAMS.ikProfile.input.value = String(idx);
    if (PARAMS.ikProfile.output) PARAMS.ikProfile.output.textContent = TRACK_PROFILES[id].label;
  }
  liveIk.setProfile(id);
  trackProfileId = id;
  document.querySelectorAll("[data-ik-profile]").forEach((b) => {
    b.classList.toggle("booth-btn--on", b.dataset.ikProfile === id);
  });
  // Reload trackers if model set changed
  ensureTrackHub(true)
    .then(() => setStatus(`IK profile · ${TRACK_PROFILES[id].label}`))
    .catch((e) => setStatus(errMessage(e), true));
  syncIkStats();
}

function syncIkStats() {
  const el = $("#booth-ik-stats");
  if (!el) return;
  const c = liveIk.control;
  const prof = TRACK_PROFILES[trackProfileId] || TRACK_PROFILES.body;
  const gest = handCtrl.gestureLabel?.() || "—";
  if (!c?.active) {
    el.textContent =
      `IK · ${prof.label} · idle · track ${trackHub?.lastMs?.toFixed?.(0) ?? "—"}ms` +
      (handCtrl.signals?.active ? ` · ${gest}` : "");
    return;
  }
  el.textContent =
    `IK · ${prof.label} · d${c.depth.toFixed(2)} w${c.wave.toFixed(2)} ` +
    `pinch ${c.pinchL.toFixed(1)}/${c.pinchR.toFixed(1)} · ${gest} · ${liveIk.lastMs.toFixed(1)}ms`;
}

function initQbpmBridge() {
  qbpmBridge = new QbpmBridge({
    onStatus: (msg, err) => setStatus(msg, err),
    getIkBus: () => liveIk.toBus(),
    getLiveLabel: () => liveFeeds?.label || "",
    getStagedUrl: () => {
      const a = liveFeeds?.getActive?.();
      if (!a?.drawable) return null;
      return a.original || a.src || null;
    },
    onCenterChange: (on) => {
      // Keep WebGL ticking under stage; resize when cloud underlay toggled
      try {
        resize();
      } catch {
        /* */
      }
      if (on) {
        setStatus("QBPM folded into center · side columns handle controls");
      }
    },
  });
  // Right rail = handlers only; center stage = full ecosystem
  qbpmBridge.mount($("#booth-qbpm-body"), $("#booth-center-stage"));
  window.aitoQbpm = qbpmBridge;

  $("#booth-ik-toggle")?.addEventListener("click", () => {
    if (!PARAMS.ikEnable) return;
    PARAMS.ikEnable.value = PARAMS.ikEnable.value >= 0.5 ? 0 : 1;
    $("#booth-ik-toggle")?.classList.toggle("booth-btn--on", PARAMS.ikEnable.value >= 0.5);
    $("#booth-ik-toggle").textContent = PARAMS.ikEnable.value >= 0.5 ? "IK on" : "IK off";
    setStatus(`Live IK · ${PARAMS.ikEnable.value >= 0.5 ? "on" : "off"}`);
  });
  document.querySelectorAll("[data-ik-profile]").forEach((b) => {
    b.addEventListener("click", () => setIkProfile(b.dataset.ikProfile));
  });
}

async function initVision(force = false) {
  return lazy.load(
    "vision",
    async () => {
      await ensureSegmenter(force);
      if (state.tier >= 2) {
        try {
          await ensureTrackHub(force);
        } catch (trackErr) {
          // Tracking is optional for Tier 1 / live full-frame — don't fail whole vision
          setStatus(`Trackers delayed: ${errMessage(trackErr)} · seg ready`, true);
        }
      }
      state.visionPhase = "ready";
      state.visionError = null;
      return { segmenter: state.segmenter, trackHub };
    },
    { label: "Vision stack", retries: 1, retryDelayMs: 700, force, timeoutMs: 120000 },
  );
}

const ensureRunning = singleFlight(async function ensureRunningImpl(opts = {}) {
  const { requireSeg = true } = opts;
  try {
    if (requireSeg && !state.segmenter) {
      await initVision();
    } else if (!requireSeg && !state.segmenter && !lazy.isLoading("vision")) {
      // Fire-and-forget background warm for live stage
      initVision().catch((e) => {
        state.visionPhase = "error";
        state.visionError = errMessage(e);
      });
    }
    if (!state.running) {
      state.running = true;
      $("#booth-stop") && ($("#booth-stop").disabled = false);
    }
    return true;
  } catch (e) {
    state.visionPhase = "error";
    state.visionError = errMessage(e);
    state.running = true; // still allow live full-frame path without seg
    $("#booth-stop") && ($("#booth-stop").disabled = false);
    throw e;
  }
});

function markCamRunning() {
  state.running = true;
  $("#booth-stop").disabled = false;
  syncSourceButtons();
  refreshDeviceSelect();
}

function stopLiveStage() {
  if (liveFeeds.staging) liveFeeds.unstage();
}

async function startCamera() {
  stopLiveStage();
  // Keep spatial screen layer if mix wants both
  if (!spatialScreenOn() || screenSource.mode !== "screen") {
    /* screen can stay when spatial mix is on */
  }
  dualCam.stop();
  // Don't kill dedicated screen source — dual primary reuses booth-video
  hexcastSource.stop();
  await dualCam.listDevices();
  await dualCam.startDesktop();
  state.mirror = true;
  $("#booth-mirror")?.classList.add("booth-btn--on");
  markCamRunning();
  setStatus(statusSpatialTag(`${TIERS[state.tier].label} · ${dualCam.label}`));
}

/** Launch iPhone Continuity Camera (wakes Continuity link). */
async function startIPhoneCamera() {
  stopLiveStage();
  dualCam.stop();
  hexcastSource.stop();
  await dualCam.listDevices();
  await dualCam.startIPhone();
  state.mirror = false;
  $("#booth-mirror")?.classList.remove("booth-btn--on");
  markCamRunning();
  setStatus(statusSpatialTag(`${TIERS[state.tier].label} · ${dualCam.label}`));
}

async function startDeskViewCamera() {
  stopLiveStage();
  dualCam.stop();
  hexcastSource.stop();
  await dualCam.listDevices();
  await dualCam.startDeskView();
  state.mirror = false;
  $("#booth-mirror")?.classList.remove("booth-btn--on");
  markCamRunning();
  setStatus(statusSpatialTag(`${TIERS[state.tier].label} · ${dualCam.label}`));
}

/** Desktop + second camera (Continuity or any USB) as spatial dual views. */
async function startDualCameras(opts = {}) {
  stopLiveStage();
  // Preserve dedicated screen spatial layer
  hexcastSource.stop();
  await dualCam.listDevices({ requestPermission: true });
  const combine = spatialDualOn() ? "spatial" : ($("#booth-combine")?.value || "spatial");
  dualCam.combine = combine;
  dualCam.spatialLayer = spatialDualOn();
  dualCam.spatialBaseline = PARAMS.spatialDualBaseline?.value ?? 1.15;

  const primaryId = opts.primaryId || $("#booth-cam-primary")?.value || null;
  const secondaryId = opts.secondaryId || $("#booth-cam-secondary")?.value || null;

  try {
    await dualCam.startDual({
      preferDeskView: !!opts.preferDeskView,
      primaryId: primaryId || null,
      secondaryId: secondaryId || null,
    });
  } catch (err) {
    // Surface device list so user can pick secondary explicitly
    await refreshDeviceSelect();
    throw err;
  }

  state.mirror = true;
  $("#booth-mirror")?.classList.add("booth-btn--on");
  if (FEEDS.iphone) FEEDS.iphone.process = spatialDualOn() || dualCam.hasSecondary;
  document.querySelectorAll(".booth-feed-head input[type=checkbox]").forEach((c) => {
    if (c.dataset.feed === "iphone") c.checked = !!FEEDS.iphone?.process;
  });
  if (layerClouds.iphone) layerClouds.iphone.pts.visible = !!FEEDS.iphone?.process;
  markCamRunning();
  syncCameraSelects();
  setStatus(
    statusSpatialTag(
      `${TIERS[state.tier].label} · ${dualCam.label}` +
        (dualCam.hasSecondary ? " · dual→sphere" : ""),
    ),
  );
}

/**
 * Open a device as primary, or as secondary if primary is already live
 * and this is a different device (loads "other cameras" into dual feed).
 */
async function startDeviceById(deviceId, opts = {}) {
  if (!deviceId) return;
  stopLiveStage();
  hexcastSource.stop();
  if (!dualCam.devices.length) await dualCam.listDevices({ requestPermission: true });
  const dev = dualCam.devices.find((d) => d.deviceId === deviceId);

  const asSecondary =
    opts.asSecondary === true ||
    (opts.asSecondary !== false &&
      dualCam.primaryStream &&
      dualCam.primaryDeviceId &&
      dualCam.primaryDeviceId !== deviceId &&
      !opts.forcePrimary);

  if (asSecondary) {
    try {
      await dualCam.startSecondary(deviceId);
      dualCam.spatialLayer = spatialDualOn();
      dualCam.combine = dualCam.combine === "primary" ? "spatial" : dualCam.combine || "spatial";
      if (FEEDS.iphone) FEEDS.iphone.process = true;
      document.querySelectorAll(".booth-feed-head input[type=checkbox]").forEach((c) => {
        if (c.dataset.feed === "iphone") c.checked = true;
      });
      if (layerClouds.iphone) layerClouds.iphone.pts.visible = true;
      markCamRunning();
      syncCameraSelects();
      setStatus(
        statusSpatialTag(
          `${TIERS[state.tier].label} · secondary · ${dualCam.secondaryLabel || dev?.label || "cam"}`,
        ),
      );
      return;
    } catch (err) {
      setStatus(err?.message || String(err), true);
      // Fall through to primary open if secondary failed and user forced nothing
      if (opts.asSecondary === true) throw err;
    }
  }

  // Replace primary (optionally keep other secondary)
  await dualCam.startPrimary(deviceId);
  state.mirror = dualCam.mode === "desktop" || dev?.kind === "desktop";
  $("#booth-mirror")?.classList.toggle("booth-btn--on", state.mirror);
  markCamRunning();
  syncCameraSelects();
  setStatus(statusSpatialTag(`${TIERS[state.tier].label} · ${dualCam.label}`));
}

function syncCameraSelects() {
  const p = $("#booth-cam-primary");
  const s = $("#booth-cam-secondary");
  if (p && dualCam.primaryDeviceId) p.value = dualCam.primaryDeviceId;
  if (s) {
    if (dualCam.secondaryDeviceId) s.value = dualCam.secondaryDeviceId;
    else if (!s.querySelector(`option[value="${s.value}"]`)) s.value = "";
  }
}

/**
 * Screen / window share.
 * @param {{ spatial?: boolean, keepDual?: boolean }} [opts]
 *   spatial — map into sphere layer (default when Spatial · Screen is on)
 *   keepDual — do not stop dual cameras (default true when spatial mix)
 */
async function startScreenShare(opts = {}) {
  stopLiveStage();
  const keepDual = opts.keepDual ?? (spatialScreenOn() || dualCam.mode === "dual");
  const asSpatial = opts.spatial ?? spatialScreenOn();
  if (!keepDual) {
    dualCam.stop();
  }
  // Primary hexcast off so dual can own booth-video; screen uses dedicated element
  hexcastSource.stop();
  await ensureRunning();
  await screenSource.startScreen();
  if (asSpatial && PARAMS.spatialScreen) {
    PARAMS.spatialScreen.value = 1;
    const cb = $("#booth-spatialScreen");
    if (cb) cb.checked = true;
  }
  if (FEEDS.screen) FEEDS.screen.process = asSpatial || spatialScreenOn();
  document.querySelectorAll(".booth-feed-head input[type=checkbox]").forEach((c) => {
    if (c.dataset.feed === "screen") c.checked = !!FEEDS.screen?.process;
  });
  if (layerClouds.screen) layerClouds.screen.pts.visible = !!FEEDS.screen?.process;
  // Don't force un-mirror on dual primary when only adding screen
  if (!dualCam.active) {
    state.mirror = false;
    $("#booth-mirror")?.classList.remove("booth-btn--on");
  }
  markCamRunning();
  syncSourceButtons();
  setStatus(
    statusSpatialTag(
      keepDual && dualCam.mode === "dual"
        ? "Screen + Dual · spatial mix"
        : asSpatial
          ? "Screen → spatial sphere"
          : "Screen share · primary",
    ),
  );
}

async function startHexcastReceive() {
  stopLiveStage();
  // Hexcast receive uses primary video path; stop dual primary but keep screen spatial
  dualCam.stop();
  await ensureRunning();
  hexcastSource.startReceive();
  state.mirror = false;
  $("#booth-mirror")?.classList.remove("booth-btn--on");
  syncSourceButtons();
  setStatus(statusSpatialTag("Hexcast receive · hexcast.html → Broadcast"));
}

function statusSpatialTag(base) {
  const bits = [];
  if (dualCam.mode === "dual" && spatialDualOn()) bits.push("dual∴");
  if (screenSource.mode === "screen" && spatialScreenOn()) bits.push("screen∴");
  return bits.length ? `${base} · [${bits.join(" ")}]` : base;
}

/** Focus live-video rail (blank / qbpm style) and optionally stage drawable. */
async function focusLiveFeeds() {
  const panel = $("#booth-live-panel");
  if (panel) panel.open = true;
  $("#booth-live-host")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  const active = liveFeeds.getActive();
  if (active?.drawable) {
    await ensureRunning();
    await liveFeeds.stageActive();
  } else {
    setStatus(
      active
        ? `Live · ${active.label} (embed — paste mp4/m3u8 to Stage)`
        : "Live feeds · paste YouTube / Twitch / HLS / mp4 in left rail",
    );
  }
  syncSourceButtons();
}

function syncSourceButtons() {
  const camMode = dualCam.mode;
  const screenOn = screenSource.mode === "screen" || hexcastSource.mode === "screen";
  $("#booth-screen")?.classList.toggle("booth-btn--on", screenOn);
  $("#booth-hexcast")?.classList.toggle("booth-btn--on", hexcastSource.mode === "hexcast");
  $("#booth-start")?.classList.toggle("booth-btn--on", camMode === "desktop");
  $("#booth-iphone")?.classList.toggle("booth-btn--on", camMode === "iphone");
  $("#booth-deskview")?.classList.toggle("booth-btn--on", camMode === "deskview");
  $("#booth-dual")?.classList.toggle(
    "booth-btn--on",
    camMode === "dual" || (spatialDualOn() && dualCam.hasSecondary),
  );
  $("#booth-live")?.classList.toggle("booth-btn--on", liveFeeds.staging || liveFeeds.items.length > 0);
  // Title hints when both spatial sources live
  if (camMode === "dual" && screenOn) {
    $("#booth-dual")?.setAttribute("title", "Dual spatial · Screen also in sphere");
    $("#booth-screen")?.setAttribute("title", "Screen spatial · Dual also in sphere");
  }
  // Left desktop rail: capture source on/off switches
  syncSourceToggleUi();
}

function stopCamera() {
  liveFeeds.stop();
  dualCam.stop();
  hexcastSource.stop();
  screenSource.stop();
  secondaryRgb = null;
  screenRgb = null;
  state.running = false;
  $("#booth-stop").disabled = true;
  syncCenterStage(false);
  livePlanes?.setActive(false);
  syncSourceButtons();
  for (const cloud of Object.values(layerClouds)) cloud.geo.setDrawRange(0, 0);
  if (jointCloud) jointCloud.geometry.setDrawRange(0, 0);
  setStatus("Camera stopped");
}

function fillCameraSelect(sel, { selectedId = "", includeEmpty = true, emptyLabel = "Cameras…" } = {}) {
  if (!sel) return;
  const prev = selectedId || sel.value;
  sel.innerHTML = "";
  if (includeEmpty) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = emptyLabel;
    sel.appendChild(o);
  }
  const linked = deviceLinks.mergeWithLive(dualCam.devices);
  if (linked.length) {
    const og = document.createElement("optgroup");
    og.label = "Linked";
    for (const d of linked) {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = `${d.online ? "●" : "○"} ${d.label}`;
      opt.disabled = !d.online;
      if (d.deviceId === prev) opt.selected = true;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  const ogLive = document.createElement("optgroup");
  ogLive.label = "Live";
  for (const d of dualCam.devices) {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    const tag =
      d.kind === "iphone"
        ? "📱 "
        : d.kind === "deskview"
          ? "🖥 "
          : d.kind === "desktop"
            ? "💻 "
            : "📷 ";
    opt.textContent = `${tag}${d.label}`;
    if (d.deviceId === prev || d.deviceId === dualCam.primaryDeviceId) opt.selected = true;
    ogLive.appendChild(opt);
  }
  sel.appendChild(ogLive);
  if (prev) {
    try {
      sel.value = prev;
    } catch {
      /* invalid id */
    }
  }
}

async function refreshDeviceSelect() {
  try {
    // Prefer permission so labels populate (empty labels break dual heuristics)
    if (!dualCam.devices.length) {
      await dualCam.listDevices({ requestPermission: true });
    } else {
      await dualCam.listDevices({ requestPermission: false });
    }
  } catch {
    /* still fill with whatever we have */
  }

  fillCameraSelect($("#booth-device"), {
    selectedId: dualCam.primaryDeviceId || "",
    emptyLabel: "Primary cam…",
  });
  fillCameraSelect($("#booth-cam-primary"), {
    selectedId: dualCam.primaryDeviceId || "",
    emptyLabel: "Primary…",
  });
  fillCameraSelect($("#booth-cam-secondary"), {
    selectedId: dualCam.secondaryDeviceId || "",
    emptyLabel: "Secondary (dual)…",
  });
  // Clear invalid secondary = primary
  const sec = $("#booth-cam-secondary");
  if (sec && dualCam.primaryDeviceId && sec.value === dualCam.primaryDeviceId) {
    sec.value = dualCam.secondaryDeviceId || "";
  }
  populateLinkDeviceSelect();
  renderLinkedDeviceList();
  syncCameraSelects();
}

function estimatePersonFrac(personConf) {
  if (!personConf?.length) return 0.3;
  let n = 0;
  let hit = 0;
  const step = 4;
  for (let i = 0; i < personConf.length; i += step) {
    n++;
    if (personConf[i] > 0.45) hit++;
  }
  return n ? hit / n : 0.3;
}

function updateFaceGazeFromTrack() {
  faceGazeTip = null;
  if (!trackHub?.jointPoints?.length) return;
  const face = trackHub.jointPoints.filter((j) => String(j.layer).startsWith("face"));
  if (!face.length) return;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of face) {
    x += p.nx;
    y += p.ny;
    z += p.nz ?? 0;
  }
  const n = face.length;
  faceGazeTip = { x: x / n, y: y / n, z: z / n };
}

/**
 * @param {boolean} [force]
 * @param {{ forceClass?: string, studioPodcast?: boolean, studioCrowd?: boolean, hasScreen?: boolean }} [opts]
 */
function runAutoCalibrate(force = false, opts = {}) {
  // Prefer sample canvas RGB if available
  let rgb = null;
  try {
    rgb = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
  } catch {
    /* */
  }
  if (!rgb && screenRgb) {
    rgb = { data: screenRgb, width: SAMPLE_W, height: SAMPLE_H };
  }
  // Synthetic mid-gray frame so studio/podcast can cal before first decode
  if (!rgb) {
    const w = SAMPLE_W;
    const h = SAMPLE_H;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 92;
      data[i + 1] = 98;
      data[i + 2] = 108;
      data[i + 3] = 255;
    }
    rgb = { data, width: w, height: h };
  }
  autoCal.enabled = true;
  if (opts.studioCrowd || opts.forceClass === "crowd_spire") autoCal.mode = "crowd";
  const snap = state.analysis || spatialAnalyzer?.snapshot?.() || {};
  const result = autoCal.tick({
    rgb: rgb.data,
    w: rgb.width || SAMPLE_W,
    h: rgb.height || SAMPLE_H,
    params: PARAMS,
    ctx: {
      hasDual: dualCam.mode === "dual",
      hasScreen:
        opts.hasScreen ??
        (screenSource.mode === "screen" || liveFeeds.staging || !!(PARAMS.studioMode?.value >= 0.5)),
      personFrac:
        estimatePersonFrac(state._lastPersonConf) ||
        (opts.studioCrowd ? 0.55 : opts.studioPodcast ? 0.4 : 0.35),
      studioPodcast: !!opts.studioPodcast || opts.forceClass === "podcast_table",
      studioCrowd: !!opts.studioCrowd || opts.forceClass === "crowd_spire" || autoCal.mode === "crowd",
      forceClass: opts.forceClass || (autoCal.mode === "crowd" ? "crowd_spire" : null),
      flowEnergy: snap.flowEnergy ?? 0,
      circularity: snap.circularity ?? 0,
      clusterCount: studioSpatial?.clusterCenters?.length || snap.tracks?.length || 0,
    },
    now: performance.now(),
    force,
  });
  if (result) {
    if (typeof window.syncUniforms === "function") window.syncUniforms();
    sceneStack?.rebuild();
    voxelStack?.rebuildGrid();
    studioSpatial?.rebuild?.();
    const badge = $("#booth-autocal-badge");
    if (badge) {
      badge.innerHTML = `<strong>Auto-cal · ${result.label || classLabel(result.class)}</strong> · conf ${(result.confidence * 100).toFixed(0)}% · ${result.applied.length} params`;
    }
    $("#booth-autocal")?.classList.add("booth-btn--on");
    setStatus(`Auto-cal · ${result.label || result.class} (${(result.confidence * 100).toFixed(0)}%)`);
  }
  return result;
}

/**
 * Main left/right column section toggles.
 * Switch on each collapsed header: enable/disable without fighting ▸/▾.
 * Off → dim, collapse, soft-disable related processing.
 */
function bindMainSectionToggles() {
  const sections = document.querySelectorAll(
    "#booth-feeds > details.booth-section, #booth-panel > details.booth-section",
  );
  sections.forEach((details) => {
    if (details.dataset.sectionToggleBound === "1") return;
    details.dataset.sectionToggleBound = "1";

    const sum = details.querySelector(":scope > summary.booth-section-sum");
    if (!sum) return;

    if (!sum.querySelector(".booth-section-sum-label")) {
      const label = document.createElement("span");
      label.className = "booth-section-sum-label";
      while (sum.firstChild) {
        const n = sum.firstChild;
        if (n.nodeType === Node.ELEMENT_NODE && n.classList?.contains("booth-switch")) break;
        label.appendChild(n);
      }
      if (!label.textContent.trim()) {
        label.textContent = details.id?.replace(/^booth-/, "").replace(/-/g, " ") || "Section";
      }
      sum.insertBefore(label, sum.firstChild);
    }

    const enabled = details.dataset.sectionOn !== "0";
    const { wrap, input } = makeSwitch(enabled);
    input.classList.add("booth-section-enable");
    input.dataset.sectionId = details.id || "";
    const title =
      sum.querySelector(".booth-section-sum-label")?.textContent?.trim() || details.id || "Section";
    input.setAttribute("aria-label", `${title} enable`);

    for (const type of ["click", "pointerdown", "mousedown"]) {
      wrap.addEventListener(type, (ev) => ev.stopPropagation());
      input.addEventListener(type, (ev) => ev.stopPropagation());
    }
    input.addEventListener("change", (ev) => {
      ev.stopPropagation();
      setMainSectionEnabled(details, input.checked);
      setStatus(`${title} · ${input.checked ? "on" : "off"}`);
    });

    sum.appendChild(wrap);
    setMainSectionEnabled(details, enabled, { silent: true });
  });
}

function setMainSectionEnabled(details, on, opts = {}) {
  details.dataset.sectionOn = on ? "1" : "0";
  details.classList.toggle("is-disabled", !on);
  details.classList.toggle("booth-section--off", !on);

  if (!on) {
    if (details.open) details.dataset.wasOpen = "1";
    details.open = false;
  } else if (details.dataset.wasOpen === "1") {
    details.open = true;
    delete details.dataset.wasOpen;
  }

  const body = details.querySelector(":scope > .booth-section-body");
  if (body) {
    body.style.pointerEvents = on ? "" : "none";
    body.setAttribute("aria-hidden", on ? "false" : "true");
  }

  applyMainSectionSideEffects(details.id, on);

  const sw = details.querySelector("input.booth-section-enable");
  if (sw && sw.checked !== on) sw.checked = on;
  void opts;
}

/**
 * Bulk enable/disable all main section toggles in a column.
 * @param {"left"|"right"|"all"} scope
 * @param {boolean} on
 */
function setAllMainSections(scope, on) {
  const sels = [];
  if (scope === "left" || scope === "all") sels.push("#booth-feeds > details.booth-section");
  if (scope === "right" || scope === "all") sels.push("#booth-panel > details.booth-section");
  const nodes = document.querySelectorAll(sels.join(", "));
  nodes.forEach((d) => setMainSectionEnabled(d, on));
  const tag = scope === "left" ? "Left" : scope === "right" ? "Right" : "Sections";
  setStatus(`${tag} · sections ${on ? "all on" : "all off"}`);
  // Highlight bulk buttons
  if (scope === "left" || scope === "all") {
    $("#booth-feeds-sections-on")?.classList.toggle("booth-btn--on", on);
    $("#booth-feeds-sections-off")?.classList.toggle("booth-btn--on", !on);
  }
  if (scope === "right" || scope === "all") {
    $("#booth-panel-sections-on")?.classList.toggle("booth-btn--on", on);
    $("#booth-panel-sections-off")?.classList.toggle("booth-btn--on", !on);
  }
}

function applyMainSectionSideEffects(sectionId, on) {
  switch (sectionId) {
    case "booth-live-panel":
      if (!on && liveFeeds?.staging) {
        try {
          liveFeeds.unstage?.();
        } catch {
          /* */
        }
      }
      break;
    case "booth-feeds-section":
      if (!on) {
        for (const feed of Object.values(FEEDS || {})) {
          if (isFeedToggleLocked?.(feed.id)) continue;
          if (feed.process) {
            feed._sectionWasOn = true;
            setFeedProcess(feed.id, false);
          }
        }
        try {
          syncFeedProcessUi();
        } catch {
          /* */
        }
      } else {
        for (const feed of Object.values(FEEDS || {})) {
          if (feed._sectionWasOn) {
            setFeedProcess(feed.id, true);
            delete feed._sectionWasOn;
          }
        }
        try {
          syncFeedProcessUi();
        } catch {
          /* */
        }
      }
      break;
    case "booth-cloud-section":
      if (PARAMS.opacity) {
        if (!on) {
          if (PARAMS.opacity._sectionPrev == null) PARAMS.opacity._sectionPrev = PARAMS.opacity.value;
          PARAMS.opacity.value = Math.min(PARAMS.opacity.value, 0.12);
        } else if (PARAMS.opacity._sectionPrev != null) {
          PARAMS.opacity.value = PARAMS.opacity._sectionPrev;
          delete PARAMS.opacity._sectionPrev;
        }
        if (typeof window.syncParamUi === "function") window.syncParamUi("opacity", PARAMS.opacity);
        if (typeof window.syncUniforms === "function") window.syncUniforms();
      }
      break;
    case "booth-ik-section":
      if (PARAMS.ikEnable) {
        if (!on) {
          if (PARAMS.ikEnable._sectionPrev == null) PARAMS.ikEnable._sectionPrev = PARAMS.ikEnable.value;
          PARAMS.ikEnable.value = 0;
        } else if (PARAMS.ikEnable._sectionPrev != null) {
          PARAMS.ikEnable.value = PARAMS.ikEnable._sectionPrev;
          delete PARAMS.ikEnable._sectionPrev;
        }
        if (typeof window.syncParamUi === "function") window.syncParamUi("ikEnable", PARAMS.ikEnable);
        try {
          onParamChanged("ikEnable", PARAMS.ikEnable, "track");
        } catch {
          /* */
        }
      }
      break;
    case "booth-motion-section":
      if (!on) {
        try {
          releaseCameraDrive("section off");
        } catch {
          /* */
        }
      }
      break;
    default:
      break;
  }
}

function bindPanelChrome() {
  const panel = $("#booth-panel");
  // Keep wheel / trackpad scroll on the panel — don't let OrbitControls steal it
  if (panel) {
    const stopBubble = (ev) => {
      ev.stopPropagation();
    };
    panel.addEventListener("wheel", stopBubble, { passive: true });
    panel.addEventListener("touchmove", stopBubble, { passive: true });
    panel.addEventListener("pointerdown", stopBubble);
  }

  // On/off switches on every main left + right section header
  bindMainSectionToggles();

  $("#booth-collapse-all")?.addEventListener("click", () => {
    document.querySelectorAll("#booth-panel details.booth-section, #booth-panel details.booth-subsec").forEach((d) => {
      d.open = false;
    });
  });
  $("#booth-expand-all")?.addEventListener("click", () => {
    document.querySelectorAll("#booth-panel details.booth-section, #booth-panel details.booth-subsec").forEach((d) => {
      if (d.dataset.sectionOn === "0") return;
      d.open = true;
    });
  });
  $("#booth-stage-light")?.addEventListener("click", () => {
    const p = $("#booth-panel");
    if (!p) return;
    p.classList.toggle("booth-panel--light");
    $("#booth-stage-light")?.classList.toggle("booth-btn--on", p.classList.contains("booth-panel--light"));
    setStatus(p.classList.contains("booth-panel--light") ? "Light staging · on" : "Light staging · off");
  });

  // Left column: collapse / expand / section on-off / stage focus
  const leftSections = () =>
    document.querySelectorAll("#booth-feeds details.booth-section, #booth-feeds details.booth-subsec");
  $("#booth-feeds-collapse")?.addEventListener("click", () => {
    leftSections().forEach((d) => {
      d.open = false;
    });
    $("#booth-feeds-stage")?.classList.remove("booth-btn--on");
    setStatus("Left · collapsed");
  });
  $("#booth-feeds-expand")?.addEventListener("click", () => {
    leftSections().forEach((d) => {
      if (d.dataset.sectionOn === "0") return;
      d.open = true;
    });
    $("#booth-feeds-stage")?.classList.remove("booth-btn--on");
    setStatus("Left · expanded");
  });
  $("#booth-feeds-sections-on")?.addEventListener("click", () => setAllMainSections("left", true));
  $("#booth-feeds-sections-off")?.addEventListener("click", () => setAllMainSections("left", false));
  $("#booth-panel-sections-on")?.addEventListener("click", () => setAllMainSections("right", true));
  $("#booth-panel-sections-off")?.addEventListener("click", () => setAllMainSections("right", false));
  $("#booth-feeds-stage")?.addEventListener("click", () => {
    const feeds = $("#booth-feeds");
    const btn = $("#booth-feeds-stage");
    const lightOn = feeds?.classList.toggle("booth-feeds--stage");
    btn?.classList.toggle("booth-btn--on", !!lightOn);
    // Stage focus: open Live rail, collapse Sources + Layers for canvas room
    leftSections().forEach((d) => {
      if (d.dataset.sectionOn === "0") return;
      if (d.id === "booth-live-panel") d.open = true;
      else d.open = !lightOn;
    });
    if (lightOn) {
      $("#booth-live-host")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      setStatus("Left · stage focus · Live open");
    } else {
      leftSections().forEach((d) => {
        if (d.dataset.sectionOn === "0") return;
        d.open = true;
      });
      setStatus("Left · stage focus off");
    }
  });

  bindFloatPlayer();
  bindColumnToggles();
}

async function exportPairSnapshot() {
  if (!dualCam.active) {
    setStatus("Start Dual (or any cam) before Pair export", true);
    return;
  }
  const pair = await dualCam.snapshotPair(960, 720);
  const stamp = Date.now();
  const save = (dataUrl, name) => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name;
    a.click();
  };
  save(pair.desktop, `splatline-view-desktop-${stamp}.jpg`);
  if (pair.iphone) save(pair.iphone, `splatline-view-iphone-${stamp}.jpg`);
  setStatus(
    pair.iphone
      ? `Pair exported · use with Splatline DepthSplat multi-view`
      : `Desktop frame exported (no secondary stream)`,
  );
}

// —— Mask / layers ——

function rawPersonConfidence(raw) {
  return raw <= 1 ? raw : raw / 255;
}

function calibrateMaskPolarity(personConf, w, h) {
  if (state.maskCalibrated) return;
  let center = 0;
  let edge = 0;
  const cx = Math.floor(w * 0.5);
  const cy = Math.floor(h * 0.42);
  for (let dy = -12; dy <= 12; dy++) {
    for (let dx = -12; dx <= 12; dx++) {
      center += personConf[(cy + dy) * w + (cx + dx)];
    }
  }
  for (const [x, y] of [
    [4, 4],
    [w - 5, 4],
    [4, h - 5],
    [w - 5, h - 5],
  ]) {
    edge += personConf[y * w + x];
  }
  if (center / 625 < edge / 4) {
    state.maskPolarity = -1;
    const invertCb = $("#booth-mask-invert");
    if (invertCb) invertCb.checked = true;
  }
  state.maskCalibrated = true;
}

function layerConfidence(personConf, layer) {
  let c = personConf;
  if (layer === "background") c = 1 - personConf;
  else if (layer === "both") c = 1;
  if (state.maskPolarity < 0) c = 1 - c;
  return c;
}

function passesMask(conf) {
  const thr = PARAMS.mask.value;
  const feather = PARAMS.feather.value;
  if (conf >= thr) return { pass: true, weight: 1 };
  if (feather <= 0) return { pass: false, weight: 0 };
  const soft = (conf - (thr - feather)) / (feather + 0.001);
  if (soft <= 0) return { pass: false, weight: 0 };
  return { pass: true, weight: Math.min(1, soft) };
}

function computeDepth(x, y, w, h, lum, i, layerId = "person") {
  const mode = resolveDepthMode(PARAMS);
  // Prefer jax / zipdepth sidecars when modes request them
  const jaxAt = (idx) => window.aitoMac?.depthAt?.(idx) ?? null;
  const zipAt = (idx) => {
    const side = window.aitoMac?.zipDepthAt?.(idx);
    if (side != null) return side;
    return state._zipDepthField?.[idx] ?? null;
  };
  const shellR = voxelStack && state.tier >= 2 ? (voxelStack.shellRadius?.(layerId) ?? 0) * 0.15 : 0;
  const musicKick =
    musicBus.drive(1, PARAMS.bassDrive?.value ?? 0, PARAMS.midDrive?.value ?? 0) *
      (PARAMS.musicDepth?.value ?? 0.4) * 0.15 +
    musicBus.bass * (PARAMS.bassDrive?.value ?? 0) * 0.08;

  let modeId = mode.id;
  if (mode.id === "radial" && jaxAt(i) != null) modeId = mode.id; // keep radial; blend below
  if (mode.id === "jax") modeId = "jax";
  if (mode.id === "zipdepth") modeId = "zipdepth";

  let depth = computeBaseDepth({
    x, y, w, h, lum, i,
    jaxDepthAt: jaxAt,
    zipDepthAt: zipAt,
    modeId,
    shellRadius: shellR,
    handDepth: state.handDepthAdd,
    musicKick,
    time: state.motionTime ?? 0,
    variation: PARAMS.depthVariation?.value ?? 0.55,
    waveform: (PARAMS.depthWaveform?.value ?? 0.4) * (0.5 + state.handWaveform),
  });

  // Auto-use JAX when available even in radial if user has sidecar
  if (mode.id === "radial") {
    const j = jaxAt(i);
    if (j != null) depth = depth * 0.35 + j * 0.65;
  }
  // Soft blend ZipDepth sidecar into radial when field is live
  if (mode.id === "radial") {
    const z = zipAt(i);
    if (z != null && jaxAt(i) == null) depth = depth * 0.4 + z * 0.6;
  }
  return depth;
}

function extendShard(px, py, pz) {
  const reach = PARAMS.sceneReach?.value ?? 1.65;
  const fan = PARAMS.radialFan?.value ?? 0.9;
  const shard = PARAMS.shardDepth?.value ?? 1.25;
  const radial = Math.hypot(px, py);
  px *= reach;
  py *= reach;
  const zFan = 1 + radial * fan;
  pz = pz * reach * zFan + radial * shard * 0.5;
  return motionShardOffset(px, py, pz, state, PARAMS, jointCentroid);
}

function writePoint(buf, idx, px, py, pz, r, g, b, x, y, layerId, depth01 = 0.5) {
  if (!passesDepthFilter(depth01, PARAMS)) return false;
  const graded = gradeDepthColor(r, g, b, depth01, PARAMS);
  r = graded[0];
  g = graded[1];
  b = graded[2];

  // Content depth for screen / photo layer — push bright/dark into Z for perceived content
  const place = sceneStack?.enabled ? sceneStack.placementFor(layerId) : null;
  if (place?.contentDepth > 0) {
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    // Inverse-luma content relief (UI/text pops; dark chrome recedes)
    pz += (0.5 - lum) * place.contentDepth * 0.55;
  }

  // Desk scene stack placement — skip when studio LiDAR already projected
  const studioOnWrite = (PARAMS.studioMode?.value ?? 0) >= 0.5;

  // Studio people/screen already in room space — do NOT run radial shard warp
  // (it flattened person clouds into the floor plane).
  if (!studioOnWrite) {
    const ext = extendShard(px, py, pz);
    px = ext.x;
    py = ext.y;
    pz = ext.z;
  }

  if (place && !studioOnWrite) {
    const sc = place.scale ?? 1;
    px = px * sc + (place.x || 0);
    py = py * sc + (place.y || 0);
    pz = pz * sc + (place.z || 0);
  }

  if (!studioOnWrite) {
    if (voxelStack && state.tier >= 2 && !(sceneStack?.enabled && (layerId === "screen" || layerId === "iphone"))) {
      const o = voxelStack.offsetPosition(px, py, pz, layerId);
      px = o.x;
      py = o.y;
      pz = o.z;
    } else if (voxelStack && state.tier >= 2 && !sceneStack?.enabled) {
      const o = voxelStack.offsetPosition(px, py, pz, layerId);
      px = o.x;
      py = o.y;
      pz = o.z;
    }
  }

  // Selection: pull selected layer slightly forward
  if (selectionHub?.isSelected(layerId)) {
    pz += 0.12;
    const boost = 1.12;
    r = Math.min(255, r * boost);
    g = Math.min(255, g * boost);
    b = Math.min(255, b * boost);
  }
  const p = idx * 3;
  buf.positions[p] = px;
  buf.positions[p + 1] = py;
  buf.positions[p + 2] = pz;
  buf.colors[p] = r / 255;
  buf.colors[p + 1] = g / 255;
  buf.colors[p + 2] = b / 255;
  buf.seeds[idx] = (x * 0.013 + y * 0.029) % 1;
  return true;
}

function fillFromMask(layerId, mask, rgbData, w, h) {
  const buf = layerBuffers[layerId];
  if (!buf || !mask) return 0;
  const stride = Math.round(PARAMS.stride.value);
  const depthScale = PARAMS.depth.value * PARAMS.zSpread.value;
  const aspect = w / h;
  let idx = 0;
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = y * w + x;
      const { pass, weight } = passesMask(mask[i]);
      if (!pass) continue;
      const o = i * 4;
      const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
      const depth = computeDepth(x, y, w, h, lum, i, layerId);
      const nx = x / w;
      const ny = y / h;
      const px = (nx - 0.5) * aspect * 1.35;
      const py = -(ny - 0.5) * 1.35;
      const pz = depth * depthScale * weight;
      if (writePoint(buf, idx, px, py, pz, rgbData[o], rgbData[o + 1], rgbData[o + 2], x, y, layerId, depth)) {
        idx++;
      }
    }
  }
  buf.count = idx;
  return idx;
}

function fillPersonLayer(layerId, rgbData, w, h, personConf) {
  const buf = layerBuffers[layerId];
  if (!buf) return 0;
  const stride = Math.round(PARAMS.stride.value);
  const depthScale = PARAMS.depth.value * PARAMS.zSpread.value;
  const aspect = w / h;
  const mode = layerId === "background" ? "background" : "person";
  let idx = 0;
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = y * w + x;
      const { pass, weight } = passesMask(layerConfidence(personConf[i], mode));
      if (!pass) continue;
      const o = i * 4;
      const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
      const depth = computeDepth(x, y, w, h, lum, i, layerId);
      const px = (x / w - 0.5) * aspect * 1.35;
      const py = -((y / h) - 0.5) * 1.35;
      const pz = depth * depthScale * weight;
      if (writePoint(buf, idx, px, py, pz, rgbData[o], rgbData[o + 1], rgbData[o + 2], x, y, layerId, depth)) {
        idx++;
      }
    }
  }
  buf.count = idx;
  return idx;
}

/**
 * Edge separation point cloud — silhouettes for dense crowd.
 * Uses multi-scale Sobel on RGB + person conf (see booth-edge.mjs).
 */
function fillEdgeLayer(rgbData, personConf, w, h) {
  const buf = layerBuffers.edge;
  if (!buf || !rgbData) return 0;
  if (!FEEDS.edge?.process) {
    buf.count = 0;
    return 0;
  }
  const crowdMode =
    autoCal.mode === "crowd" ||
    state.layerGroupMode === "crowd" ||
    (PARAMS.crowdSegEnable?.value ?? 0) >= 0.5;
  const edgeField = computeEdgeField(personConf, rgbData, w, h, PARAMS, {
    crowdMode,
    motionFrac: crowdSeg?.lastStats?.motionFrac ?? 0,
  });
  state._lastEdgeField = edgeField;

  const thr = PARAMS.edgeThr?.value ?? 0.14;
  const thin = PARAMS.edgeThin?.value ?? 0.45;
  const depthLift = PARAMS.edgeDepth?.value ?? 0.65;
  // Crowd: denser edge samples (lower stride)
  const baseStride = Math.round(PARAMS.stride.value);
  const stride = crowdMode ? Math.max(1, baseStride - 1) : Math.max(1, baseStride);
  const depthScale = PARAMS.depth.value * PARAMS.zSpread.value;
  const aspect = w / h;
  const tint = FEEDS.edge?.tint || [167, 139, 250];
  let idx = 0;

  for (let y = 1; y < h - 1; y += stride) {
    for (let x = 1; x < w - 1; x += stride) {
      const i = y * w + x;
      let e = edgeField[i];
      if (e < thr * 0.85) continue;
      // Non-max thinness: keep ridge peaks (cleaner silhouettes)
      if (thin > 0.05) {
        const en = edgeField[i - w] ?? 0;
        const es = edgeField[i + w] ?? 0;
        const ew = edgeField[i - 1] ?? 0;
        const ee = edgeField[i + 1] ?? 0;
        const isPeak = e >= en && e >= es && e >= ew && e >= ee;
        if (!isPeak && Math.random() < thin) continue;
      }
      const o = i * 4;
      const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
      let depth = computeDepth(x, y, w, h, lum, i, "edge");
      depth += e * depthLift * 0.35;
      // Studio placement when live
      let px;
      let py;
      let pz;
      if ((PARAMS.studioMode?.value ?? 0) >= 0.5) {
        const p = studioProject(x / w, y / h, depth, PARAMS, "person");
        const wave = crowdMode ? spatialAnalyzer?.waveLiftAt(x / w, y / h) ?? 0 : 0;
        px = p.x;
        py = p.y + e * 0.08 + wave * 0.15;
        pz = p.z + e * depthLift * 0.25 + depth * depthScale * 0.05;
      } else {
        px = (x / w - 0.5) * aspect * 1.35;
        py = -((y / h) - 0.5) * 1.35;
        pz = depth * depthScale * (0.55 + e * 0.55);
      }
      // Tint edge violet, blend with source color by strength
      const r = Math.round(rgbData[o] * 0.35 + tint[0] * e * 0.75);
      const g = Math.round(rgbData[o + 1] * 0.35 + tint[1] * e * 0.75);
      const b = Math.round(rgbData[o + 2] * 0.35 + tint[2] * e * 0.75);
      if (writePoint(buf, idx, px, py, pz, r, g, b, x, y, "edge", depth)) {
        idx++;
      }
    }
  }
  buf.count = idx;
  return idx;
}

function rebuildJoints() {
  if (!jointCloud || !trackHub?.jointPoints?.length) {
    if (jointCloud) jointCloud.geometry.setDrawRange(0, 0);
    jointCentroid = null;
    return 0;
  }
  const geo = jointCloud.geometry;
  const pos = geo.attributes.position.array;
  const col = geo.attributes.color.array;
  const seeds = geo.attributes.aSeed.array;
  const aspect = SAMPLE_W / SAMPLE_H;
  const depthScale = PARAMS.depth.value * PARAMS.zSpread.value;
  let idx = 0;
  let cx = 0, cy = 0, cz = 0;
  for (const j of trackHub.jointPoints) {
    if (idx >= MAX_JOINTS) break;
    const px = (j.nx - 0.5) * aspect * 1.35;
    const py = -(j.ny - 0.5) * 1.35;
    let pz = (0.5 + j.nz * 2) * depthScale * j.r;
    const wrote = writePoint(
      { positions: pos, colors: col, seeds },
      idx,
      px,
      py,
      pz,
      j.color[0] * 255,
      j.color[1] * 255,
      j.color[2] * 255,
      j.nx * SAMPLE_W,
      j.ny * SAMPLE_H,
      "joints",
      0.5 + j.nz,
    );
    if (wrote) {
      const p = idx * 3;
      cx += pos[p];
      cy += pos[p + 1];
      cz += pos[p + 2];
      seeds[idx] = j.idx * 0.017;
      idx++;
    }
  }
  if (idx > 0) {
    jointCentroid = { x: cx / idx, y: cy / idx, z: cz / idx };
  } else {
    jointCentroid = null;
  }
  geo.setDrawRange(0, idx);
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
  geo.attributes.aSeed.needsUpdate = true;
  return idx;
}

function personLayerIds() {
  const ids = ["person"];
  const n = Math.round(PARAMS.maxPeople?.value ?? 2);
  if (n >= 2) ids.push("person2");
  if (n >= 3) ids.push("person3");
  if (n >= 4) ids.push("person4");
  return ids;
}

function fillFromPersonMask(layerId, poseMask, rgbData, w, h, personConf) {
  const n = w * h;
  const combined = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const seg = layerConfidence(personConf[i], "person");
    combined[i] = Math.min(1, poseMask[i] * seg);
  }
  return fillFromMask(layerId, combined, rgbData, w, h);
}

/** Full-frame cloud from RGB (live video / photo content — no person mask gate). */
function fillFullFrameLayer(layerId, rgbData, w, h, role = "screen") {
  const buf = layerBuffers[layerId];
  if (!buf || !rgbData) return 0;
  const stride = Math.round(PARAMS.stride.value);
  const depthScale = PARAMS.depth.value * PARAMS.zSpread.value;
  const aspect = w / h;
  const studioOn = (PARAMS.studioMode?.value ?? 0) >= 0.5;
  let idx = 0;
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = y * w + x;
      const o = i * 4;
      const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
      const depth = computeDepth(x, y, w, h, lum, i, layerId);
      let px;
      let py;
      let pz;
      if (studioOn) {
        const p = studioProject(x / w, y / h, depth, PARAMS, role);
        px = p.x;
        py = p.y;
        pz = p.z + depth * depthScale * 0.08;
      } else {
        px = (x / w - 0.5) * aspect * 1.35;
        py = -((y / h) - 0.5) * 1.35;
        pz = depth * depthScale;
      }
      if (writePoint(buf, idx, px, py, pz, rgbData[o], rgbData[o + 1], rgbData[o + 2], x, y, layerId, depth)) {
        idx++;
      }
    }
  }
  buf.count = idx;
  return idx;
}

/**
 * Dense person point cloud floating above the floor video (studio).
 * Uses selfie-seg confidence + optional pose person masks; every mask hit
 * is projected with studioProject(..., "person").
 */
function fillStudioPeopleClusters(rgbData, personConf, w, h) {
  const buf = layerBuffers.person;
  if (!buf || !rgbData) return 0;
  const stride = Math.max(1, Math.round(PARAMS.stride.value));
  const depthScale = PARAMS.depth.value * PARAMS.zSpread.value;
  const crowdMode =
    autoCal.mode === "crowd" || (PARAMS.crowdSegEnable?.value ?? 0) >= 0.5;
  const centers = studioSpatial.detectClusters(personConf, w, h, crowdMode ? 14 : 6);
  let idx = 0;
  let maskHits = 0;

  // 1) Dense mask fill — real people isolation above floor
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = y * w + x;
      let conf = layerConfidence(personConf[i], "person");
      // Multi-person pose masks boost confidence when track is live
      if (trackHub?.personMasks?.length) {
        let poseMax = 0;
        for (const m of trackHub.personMasks) {
          if (m?.[i] > poseMax) poseMax = m[i];
        }
        if (poseMax > 0.15) conf = Math.max(conf, poseMax);
      }
      const { pass, weight } = passesMask(conf);
      if (!pass) continue;
      maskHits++;
      const o = i * 4;
      const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
      const depth = computeDepth(x, y, w, h, lum, i, "person");
      const p = studioProject(x / w, y / h, depth, PARAMS, "person");
      // Spatial analysis: lift voxel waveforms of people (crowd / spire cams)
      const wave = spatialAnalyzer?.waveLiftAt(x / w, y / h) ?? 0;
      // Mild vertical pop so points read clearly above floor tex
      const py = p.y + (1 - conf) * 0.02 + wave * 0.35;
      const pz = p.z + depth * depthScale * 0.04 * weight + wave * 0.55;
      if (
        writePoint(
          buf,
          idx,
          p.x,
          py,
          pz,
          rgbData[o],
          rgbData[o + 1],
          rgbData[o + 2],
          x,
          y,
          "person",
          depth,
        )
      ) {
        idx++;
      }
    }
  }

  // 2) If seg is empty/weak, seed floating clouds at cluster centers (still above floor)
  if (idx < 40 && centers.length) {
    const rad = Math.round(Math.min(w, h) * 0.14);
    for (const c of centers) {
      const cx = (c.nx * w) | 0;
      const cy = (c.ny * h) | 0;
      for (let y = cy - rad; y < cy + rad; y += stride) {
        if (y < 0 || y >= h) continue;
        for (let x = cx - rad; x < cx + rad; x += stride) {
          if (x < 0 || x >= w) continue;
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy > rad * rad) continue;
          const i = y * w + x;
          const o = i * 4;
          const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
          // Skip pure black/empty
          if (lum < 0.04) continue;
          const depth = computeDepth(x, y, w, h, lum, i, "person");
          const p = studioProject(x / w, y / h, depth, PARAMS, "person");
          const p2 = studioProject(c.nx, c.ny, depth, PARAMS, "cluster");
          const px = p.x * 0.55 + p2.x * 0.45;
          const py = Math.max(p.y, p2.y);
          const pz = p.z * 0.55 + p2.z * 0.45;
          if (
            writePoint(buf, idx, px, py, pz, rgbData[o], rgbData[o + 1], rgbData[o + 2], x, y, "person", depth)
          ) {
            idx++;
          }
        }
      }
    }
  }

  buf.count = idx;
  state._studioPeopleMaskHits = maskHits;
  return idx;
}

/** Fill person2..N from pose person masks when available (studio multi-host table). */
function fillStudioExtraPeople(rgbData, personConf, w, h) {
  const personIds = personLayerIds().filter((id) => id !== "person");
  const counts = {};
  if (!trackHub?.personMasks?.length) return counts;
  const stride = Math.max(1, Math.round(PARAMS.stride.value));
  for (let pi = 0; pi < personIds.length; pi++) {
    const lid = personIds[pi];
    if (!FEEDS[lid]?.process) {
      counts[lid] = 0;
      continue;
    }
    const mask = trackHub.personMasks[pi + 1] || trackHub.personMasks[pi];
    const buf = layerBuffers[lid];
    if (!buf || !mask) {
      counts[lid] = 0;
      continue;
    }
    let idx = 0;
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const i = y * w + x;
        const conf = Math.min(1, mask[i] * Math.max(0.35, layerConfidence(personConf[i], "person")));
        const { pass, weight } = passesMask(conf);
        if (!pass) continue;
        const o = i * 4;
        const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
        const depth = computeDepth(x, y, w, h, lum, i, lid);
        const p = studioProject(x / w, y / h, depth, PARAMS, "person");
        // Slight lateral separation per host slot
        const slot = pi + 1;
        const px = p.x + (slot - 1.5) * 0.08;
        if (writePoint(buf, idx, px, p.y, p.z, rgbData[o], rgbData[o + 1], rgbData[o + 2], x, y, lid, depth)) {
          idx++;
        }
      }
    }
    buf.count = idx;
    counts[lid] = idx;
  }
  return counts;
}

function rebuildAllLayers(personConf, rgbData, w, h) {
  const counts = {};
  const personIds = personLayerIds();
  const liveFullFrame = !!(liveFeeds.staging || liveFeeds.active);
  const studioOn = (PARAMS.studioMode?.value ?? 0) >= 0.5;

  // Live staged video:
  //  - studio: people float ABOVE floor video plane; no full-frame composite blanket
  //  - non-studio: full-frame person cloud (legacy)
  if (liveFullFrame) {
    if (studioOn) {
      if (FEEDS.person) FEEDS.person.process = true;
      if (layerClouds.person) layerClouds.person.pts.visible = true;
      counts.person = fillStudioPeopleClusters(rgbData, personConf, w, h);
      Object.assign(counts, fillStudioExtraPeople(rgbData, personConf, w, h));
      // Soft rear wall only if user enabled background
      if (FEEDS.background?.process) {
        counts.background = fillFullFrameLayer("background", rgbData, w, h, "screen");
      } else if (layerBuffers.background) {
        layerBuffers.background.count = 0;
        counts.background = 0;
      }
      // Composite full-frame hides people over floor — keep off unless people sparse
      if (FEEDS.composite?.process && (counts.person || 0) < 60) {
        counts.composite = fillFullFrameLayer("composite", rgbData, w, h, "screen");
      } else {
        if (layerBuffers.composite) layerBuffers.composite.count = 0;
        counts.composite = 0;
      }
    } else {
      if (FEEDS.person?.process) counts.person = fillFullFrameLayer("person", rgbData, w, h);
      if (FEEDS.background?.process) {
        counts.background = fillPersonLayer("background", rgbData, w, h, personConf || new Float32Array(w * h));
      }
    }
  } else if (trackHub?.personMasks?.length && state.tier >= 2) {
    for (let i = 0; i < personIds.length; i++) {
      const lid = personIds[i];
      if (!FEEDS[lid]?.process) continue;
      const mask = trackHub.personMasks[i];
      if (mask?.some((v) => v > 0.1)) {
        counts[lid] = fillFromPersonMask(lid, mask, rgbData, w, h, personConf);
      } else if (i === 0) {
        counts[lid] = fillPersonLayer(lid, rgbData, w, h, personConf);
      } else {
        counts[lid] = 0;
      }
    }
  } else {
    counts.person = fillPersonLayer("person", rgbData, w, h, personConf);
  }
  if (!liveFullFrame) {
    counts.background = fillPersonLayer("background", rgbData, w, h, personConf);
  }

  // Edge separation cloud (crowd silhouettes) — works on personConf after crowd refine
  if (FEEDS.edge?.process) {
    counts.edge = fillEdgeLayer(rgbData, personConf || new Float32Array(w * h), w, h);
    if (layerClouds.edge) layerClouds.edge.pts.visible = true;
  } else if (layerBuffers.edge) {
    layerBuffers.edge.count = 0;
    counts.edge = 0;
    if (layerClouds.edge) layerClouds.edge.pts.visible = false;
  }

  const trackIds = ["face", "pose", "leftHand", "rightHand", "fingers"];
  if (trackHub?.masks && state.tier >= 2) {
    for (const lid of trackIds) {
      if (!FEEDS[lid]?.process) continue;
      counts[lid] = fillFromMask(lid, trackHub.masks[lid], rgbData, w, h);
    }
    counts.joints = rebuildJoints();
  }

  // Composite: non-studio live = full frame; studio handled above; else mask-gated
  if (liveFullFrame && !studioOn && FEEDS.composite?.process) {
    counts.composite = fillFullFrameLayer("composite", rgbData, w, h, "screen");
  } else if (!liveFullFrame) {
    const compBuf = layerBuffers.composite;
    let cIdx = 0;
    const stride = Math.round(PARAMS.stride.value);
    const depthScale = PARAMS.depth.value * PARAMS.zSpread.value;
    const aspect = w / h;

    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const i = y * w + x;
        let include = false;
        let weight = 0;

        for (const pid of personIds) {
          if (!include && FEEDS[pid]?.process) {
            let m = layerConfidence(personConf[i], "person");
            const pIdx = personIds.indexOf(pid);
            if (trackHub?.personMasks?.[pIdx]) m = Math.min(1, m * trackHub.personMasks[pIdx][i]);
            const pm = passesMask(m);
            if (pm.pass) {
              include = true;
              weight = pm.weight;
            }
          }
        }
        if (!include && FEEDS.person?.process && passesMask(layerConfidence(personConf[i], "person")).pass) {
          include = true;
          weight = passesMask(layerConfidence(personConf[i], "person")).weight;
        }
        if (!include && FEEDS.background?.process && passesMask(layerConfidence(personConf[i], "background")).pass) {
          include = true;
          weight = passesMask(layerConfidence(personConf[i], "background")).weight;
        }
        for (const lid of trackIds) {
          if (!include && FEEDS[lid]?.process && trackHub?.masks?.[lid]) {
            const m = passesMask(trackHub.masks[lid][i]);
            if (m.pass) {
              include = true;
              weight = m.weight;
            }
          }
        }
        if (!include) continue;

        const o = i * 4;
        const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
        const depth = computeDepth(x, y, w, h, lum, i, "composite");
        const px = (x / w - 0.5) * aspect * 1.35;
        const py = -((y / h) - 0.5) * 1.35;
        const pz = depth * depthScale * weight;
        if (writePoint(compBuf, cIdx, px, py, pz, rgbData[o], rgbData[o + 1], rgbData[o + 2], x, y, "composite", depth)) {
          cIdx++;
        }
      }
    }
    compBuf.count = cIdx;
    counts.composite = cIdx;
  }

  // Monocular depth pass → spatial point cloud (ZipDepth / JAX / radial field)
  const depthCloudOn =
    (PARAMS.depthCloud?.value ?? 1) >= 0.5 && (FEEDS.depth?.process !== false);
  if (depthCloudOn) {
    counts.depth = fillDepthSpatialLayer(rgbData, personConf, w, h);
    if (layerClouds.depth) layerClouds.depth.pts.visible = counts.depth > 0;
    if (FEEDS.depth) FEEDS.depth.process = true;
  } else if (layerBuffers.depth) {
    layerBuffers.depth.count = 0;
    counts.depth = 0;
    if (layerClouds.depth) layerClouds.depth.pts.visible = false;
    state.spatialDepthCloud = null;
  }

  // Dual Continuity → spatial sphere shell (when Spatial · Dual is on)
  const dualSpatial =
    spatialDualOn() &&
    FEEDS.iphone?.process &&
    secondaryRgb &&
    (dualCam.hasSecondary || dualCam.mode === "dual");
  if (dualSpatial) {
    dualCam.spatialBaseline = PARAMS.spatialDualBaseline?.value ?? 1.15;
    counts.iphone = fillSpatialSourceLayer("iphone", secondaryRgb, SAMPLE_W, SAMPLE_H, {
      xOff: dualCam.spatialBaseline,
      zBias: 0,
    });
  } else if (layerBuffers.iphone) {
    layerBuffers.iphone.count = 0;
    counts.iphone = 0;
  }

  // Screen / window → independent spatial shell (can stack with Dual)
  const scrSpatial =
    spatialScreenOn() && FEEDS.screen?.process && screenRgb && screenSource.mode === "screen";
  if (scrSpatial) {
    counts.screen = fillSpatialSourceLayer("screen", screenRgb, SAMPLE_W, SAMPLE_H, {
      xOff: PARAMS.spatialScreenBaseline?.value ?? -1.25,
      zBias: PARAMS.spatialScreenZ?.value ?? 0.35,
    });
  } else if (layerBuffers.screen) {
    layerBuffers.screen.count = 0;
    counts.screen = 0;
  }

  for (const [id, cloud] of Object.entries(layerClouds)) {
    const buf = layerBuffers[id];
    const n = buf?.count || 0;
    cloud.geo.setDrawRange(0, n);
    cloud.geo.attributes.position.needsUpdate = true;
    cloud.geo.attributes.color.needsUpdate = true;
    cloud.geo.attributes.aSeed.needsUpdate = true;
    // Studio: always show person / edge layers that have points (above floor video)
    if (studioOn && (id === "person" || /^person\d/.test(id) || id === "edge")) {
      cloud.pts.visible = n > 0 && (FEEDS[id]?.process !== false);
      if (FEEDS[id] && n > 0 && id !== "edge") FEEDS[id].process = true;
    } else if (id === "depth") {
      cloud.pts.visible =
        n > 0 &&
        (PARAMS.depthCloud?.value ?? 1) >= 0.5 &&
        (FEEDS.depth?.process !== false);
    } else {
      cloud.pts.visible = FEEDS[id]?.process ?? false;
    }
  }
  refreshCompositeVisibility();
  state.layerCounts = counts;
  state.points = Object.entries(counts).reduce((s, [k, v]) => {
    if (k === "joints") return s;
    return s + (Number(v) || 0);
  }, 0);
}

/**
 * Dense spatial point cloud from the monocular depth pass.
 * Writes into layerBuffers.depth and caches structured data on state.spatialDepthCloud.
 */
function fillDepthSpatialLayer(rgbData, personConf, w, h) {
  const buf = layerBuffers.depth;
  if (!buf || !rgbData) return 0;

  // Prefer full ZipDepth/JAX field; otherwise sample via computeDepth
  ensureDepthField(rgbData, w, h);

  const cloud = buildSpatialPointCloudFromDepth({
    depthField: state._zipDepthField || state._depthField,
    rgba: rgbData,
    w,
    h,
    params: PARAMS,
    personConf,
    stride: PARAMS.stride?.value ?? 3,
    maxPoints: MAX_POINTS,
    depthAt: (x, y, ww, hh, _lum, i) => {
      const field = state._zipDepthField || state._depthField;
      if (field?.[i] != null) return field[i];
      const o = i * 4;
      const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
      return computeDepth(x, y, ww, hh, lum, i, "depth");
    },
  });

  const n = Math.min(cloud.count, MAX_POINTS);
  for (let i = 0; i < n; i++) {
    const p = i * 3;
    buf.positions[p] = cloud.positions[p];
    buf.positions[p + 1] = cloud.positions[p + 1];
    buf.positions[p + 2] = cloud.positions[p + 2];
    buf.colors[p] = cloud.colors[p];
    buf.colors[p + 1] = cloud.colors[p + 1];
    buf.colors[p + 2] = cloud.colors[p + 2];
    buf.seeds[i] = (cloud.uvs[i * 2] * 12.9 + cloud.uvs[i * 2 + 1] * 78.2) % 1;
  }
  // Optional voxel shell placement for depth cloud
  if (voxelStack && state.tier >= 2) {
    for (let i = 0; i < n; i++) {
      const p = i * 3;
      const o = voxelStack.offsetPosition(
        buf.positions[p],
        buf.positions[p + 1],
        buf.positions[p + 2],
        "depth",
      );
      buf.positions[p] = o.x;
      buf.positions[p + 1] = o.y;
      buf.positions[p + 2] = o.z;
    }
  }

  buf.count = n;
  state.spatialDepthCloud = {
    positions: cloud.positions,
    colors: cloud.colors,
    depths: cloud.depths,
    uvs: cloud.uvs,
    count: n,
    w,
    h,
    stride: cloud.stride,
    meta: {
      ...cloud.meta,
      mode: resolveDepthMode(PARAMS).id,
      backend:
        window.aitoMac?.getZipDepthBackend?.() ||
        (state._zipDepthField ? "client-zip" : "computeDepth"),
      at: performance.now(),
    },
  };
  return n;
}

/** Ensure a dense depth field exists for spatial unproject (ZipDepth field or mode sample). */
function ensureDepthField(rgbData, w, h) {
  const modeId = resolveDepthMode(PARAMS).id;
  const nowMs = performance.now();
  const side = window.aitoMac?.getZipDepth?.();
  if (side && side.length === w * h) {
    state._zipDepthField = Float32Array.from(side);
    state._depthField = state._zipDepthField;
    state._zipDepthAt = nowMs;
    return state._depthField;
  }
  // Rebuild client multi-scale field periodically for zipdepth or any depth cloud
  const needZip = modeId === "zipdepth" || (PARAMS.depthCloud?.value ?? 1) >= 0.5;
  if (needZip && (!state._zipDepthField || !state._zipDepthAt || nowMs - state._zipDepthAt > 80)) {
    state._zipDepthField = computeZipDepthField(rgbData, w, h, PARAMS, { channels: 4 });
    state._zipDepthAt = nowMs;
  }
  if (state._zipDepthField && state._zipDepthField.length === w * h) {
    state._depthField = state._zipDepthField;
    return state._depthField;
  }
  // Fallback: fill field via per-pixel computeDepth (cached ~80ms)
  if (!state._depthField || state._depthField.length !== w * h || !state._depthFieldAt || nowMs - state._depthFieldAt > 80) {
    const field = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 4;
        const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
        field[i] = computeDepth(x, y, w, h, lum, i, "depth");
      }
    }
    state._depthField = field;
    state._depthFieldAt = nowMs;
  }
  return state._depthField;
}

/**
 * Build a spatial point-cloud layer from a full RGB frame (dual Continuity or screen).
 * Mapped onto voxel sphere via layerId slot; xOff/zBias separate sources in planar layout.
 */
function fillSpatialSourceLayer(layerId, rgbData, w, h, { xOff = 0, zBias = 0 } = {}) {
  const buf = layerBuffers[layerId];
  if (!buf || !rgbData) return 0;
  const stride = Math.round(PARAMS.stride.value);
  const depthScale = PARAMS.depth.value * PARAMS.zSpread.value;
  const aspect = w / h;
  // When desk scene stack is on, local offsets are applied in writePoint via placementFor
  const useStackPlace = sceneStack?.enabled && (layerId === "screen" || layerId === "iphone");
  const localXOff = useStackPlace ? 0 : xOff;
  const localZBias = useStackPlace ? 0 : zBias;
  let idx = 0;
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = y * w + x;
      const o = i * 4;
      const a = rgbData[o + 3];
      if (a < 8) continue;
      const lum = (rgbData[o] * 0.299 + rgbData[o + 1] * 0.587 + rgbData[o + 2] * 0.114) / 255;
      let depth = computeDepth(x, y, w, h, lum, i, layerId);
      // Screen/photo content depth variation (nested parallax of UI layers)
      if (layerId === "screen") {
        const cd = PARAMS.stackContentDepth?.value ?? 0.75;
        depth = depth * 0.45 + (1 - lum) * 0.55;
        depth += Math.sin((x / w) * 9 + (y / h) * 5) * cd * 0.04;
      }
      const px = (x / w - 0.5) * aspect * 1.35 + localXOff;
      const py = -((y / h) - 0.5) * 1.35;
      const pz = depth * depthScale + localZBias;
      if (writePoint(buf, idx, px, py, pz, rgbData[o], rgbData[o + 1], rgbData[o + 2], x, y, layerId, depth)) {
        idx++;
      }
    }
  }
  buf.count = idx;
  return idx;
}

/** @deprecated use fillSpatialSourceLayer */
function fillSpatialSecondaryLayer(rgbData, w, h) {
  return fillSpatialSourceLayer("iphone", rgbData, w, h, {
    xOff: dualCam.spatialBaseline ?? 1.15,
  });
}

function drawFeeds(rgbData, personConf, w, h) {
  if (feedCtx.camera) {
    feedCtx.camera.drawImage(sampleCanvas, 0, 0);
    const s = $(`#feed-stat-camera`);
    if (s) {
      const tag = dualCam.mode === "dual" ? "desktop" : dualCam.mode !== "none" ? dualCam.mode : "live";
      s.textContent = tag;
    }
  }
  if (feedCtx.iphone) {
    if (secondaryRgb && (dualCam.hasSecondary || dualCam.mode === "dual")) {
      feedCtx.iphone.drawImage(secondaryCanvas, 0, 0);
      const s = $(`#feed-stat-iphone`);
      if (s) {
        const n = state.layerCounts.iphone ?? 0;
        s.textContent = spatialDualOn() ? `${n.toLocaleString()} pts ∴` : `${n.toLocaleString()} pts`;
      }
    } else if (dualCam.mode === "iphone" || dualCam.mode === "deskview") {
      feedCtx.iphone.drawImage(sampleCanvas, 0, 0);
      const s = $(`#feed-stat-iphone`);
      if (s) s.textContent = dualCam.mode;
    } else {
      feedCtx.iphone.clearRect(0, 0, w, h);
      const s = $(`#feed-stat-iphone`);
      if (s) s.textContent = dualCam.mode === "dual" ? "…" : "off";
    }
  }

  if (feedCtx.screen) {
    if (screenRgb && screenSource.mode === "screen") {
      feedCtx.screen.drawImage(screenCanvas, 0, 0);
      const s = $(`#feed-stat-screen`);
      if (s) {
        const n = state.layerCounts.screen ?? 0;
        s.textContent = spatialScreenOn() ? `${n.toLocaleString()} pts ∴` : `${n.toLocaleString()} pts`;
      }
    } else {
      feedCtx.screen.clearRect(0, 0, w, h);
      const s = $(`#feed-stat-screen`);
      if (s) s.textContent = "off";
    }
  }

  for (const layerId of [...personLayerIds(), "background", "depth", "edge", "composite"]) {
    const ctx = feedCtx[layerId];
    if (!ctx) continue;
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const y = (i / w) | 0;
      const o = i * 4;
      const pConf = personConf[i];
      let r = rgbData[o];
      let g = rgbData[o + 1];
      let b = rgbData[o + 2];
      let show = 0;

      if (layerId === "person" || layerId.startsWith("person")) {
        const idx = layerId === "person" ? 0 : Number(layerId.replace("person", "")) - 1;
        let lc = layerConfidence(pConf, "person");
        if (trackHub?.personMasks?.[idx]) lc = Math.min(1, lc * trackHub.personMasks[idx][i]);
        show = passesMask(lc).pass ? lc : 0;
        const pal = FEEDS[layerId]?.tint || [249, 115, 22];
        r = Math.round(r * 0.35 + pal[0] * show * 0.65);
        g = Math.round(g * 0.35 + pal[1] * show * 0.65);
        b = Math.round(b * 0.35 + pal[2] * show * 0.65);
      } else if (layerId === "background") {
        const lc = layerConfidence(pConf, "background");
        show = passesMask(lc).pass ? lc : 0;
        r = Math.round(r * show * 0.5 + 56 * show * 0.5);
        g = Math.round(g * show * 0.5 + 189 * show * 0.5);
        b = Math.round(b * show * 0.5 + 248 * show * 0.5);
      } else if (layerId === "depth") {
        const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        const field = state._zipDepthField || state._depthField;
        const v = field?.[i] ?? computeDepth(x, y, w, h, lum, i, "depth");
        const viz = depthVizRGB(v / 1.2);
        r = viz[0];
        g = viz[1];
        b = viz[2];
        show = 1;
      } else if (layerId === "edge") {
        const ef = state._lastEdgeField;
        let e = ef?.[i];
        if (e == null) {
          // Fallback simple conf gradient if field not ready
          const xr = x < w - 1 ? personConf[i + 1] : pConf;
          const yd = y < h - 1 ? personConf[i + w] : pConf;
          e = Math.abs(xr - pConf) + Math.abs(yd - pConf) > 0.12 ? 1 : 0;
        }
        const thr = PARAMS.edgeThr?.value ?? 0.14;
        show = e >= thr * 0.75 ? Math.min(1, e) : 0;
        r = Math.round(167 * show + rgbData[o] * 0.2 * show);
        g = Math.round(139 * show + rgbData[o + 1] * 0.15 * show);
        b = Math.round(250 * show + rgbData[o + 2] * 0.25 * show);
      } else if (layerId === "composite") {
        show = state.layerCounts.composite > 0 ? 1 : 0;
      }
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = show > 0 ? 255 : 40;
    }
    ctx.putImageData(img, 0, 0);
    const stat = $(`#feed-stat-${layerId}`);
    if (stat) {
      const n = state.layerCounts[layerId];
      stat.textContent = n != null ? `${n.toLocaleString()} pts` : "—";
    }
  }

  if (trackHub && state.tier >= 2) {
    for (const lid of ["face", "pose", "leftHand", "rightHand", "fingers"]) {
      trackHub.drawFeed(lid, feedCtx[lid], rgbData, w, h);
      const stat = $(`#feed-stat-${lid}`);
      if (stat) stat.textContent = state.layerCounts[lid] != null ? `${state.layerCounts[lid]} pts` : "—";
    }
    trackHub.drawJointsFeed(feedCtx.joints, w, h);
    const js = $(`#feed-stat-joints`);
    if (js) js.textContent = `${state.layerCounts.joints ?? 0} jt`;
  }

  drawSpectrumFeed(w, h);
}

function drawSpectrumFeed(w, h) {
  const ctx = feedCtx.spectrum;
  if (!ctx) return;
  ctx.fillStyle = "#050508";
  ctx.fillRect(0, 0, w, h);
  if (!audioEngine.active) {
    const stat = $(`#feed-stat-spectrum`);
    if (stat) stat.textContent = "off";
    return;
  }
  const { bins, energy, wave, bass, mid, high } = audioEngine.sample();
  const drive = studioWaveformDrive(musicBus, PARAMS);
  const g = (PARAMS.studioWaveGain?.value ?? 2.2) * 0.55 + 0.7;

  // Frequency bars (decimated for visibility)
  if (bins) {
    const step = Math.max(1, (bins.length / 64) | 0);
    const nBars = Math.floor(bins.length / step);
    const barW = w / nBars;
    for (let i = 0; i < nBars; i++) {
      let peak = 0;
      for (let k = 0; k < step; k++) peak = Math.max(peak, bins[i * step + k] / 255);
      const v = Math.min(1, peak * g * (1 + drive.bass * 0.35));
      const bh = v * h * 0.88;
      const hue = 15 + (i / nBars) * 200 + drive.high * 40;
      ctx.fillStyle = `hsla(${hue}, 90%, ${45 + v * 25}%, ${0.4 + v * 0.55})`;
      ctx.fillRect(i * barW, h - bh, Math.max(1.5, barW - 0.6), bh);
    }
  }

  // Time-domain waveform overlay (highly visible)
  if (wave?.length) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(251, 191, 36, ${0.55 + drive.beat * 0.4})`;
    ctx.lineWidth = 1.5 + drive.bass * 2;
    const midY = h * 0.42;
    const amp = h * 0.28 * g * (0.7 + drive.energy);
    for (let i = 0; i < wave.length; i++) {
      const x = (i / (wave.length - 1)) * w;
      const y = midY + ((wave[i] - 128) / 128) * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Mirror glow
    ctx.beginPath();
    ctx.strokeStyle = `rgba(56, 189, 248, ${0.25 + drive.high * 0.35})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < wave.length; i += 2) {
      const x = (i / (wave.length - 1)) * w;
      const y = midY - ((wave[i] - 128) / 128) * amp * 0.65;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Band meters
  const drawMeter = (x, label, v, color) => {
    const mw = 10;
    const mh = h * 0.55 * Math.min(1, v);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, h - mh - 4, mw, mh);
    ctx.globalAlpha = 1;
  };
  drawMeter(4, "B", bass ?? drive.bass, "#f97316");
  drawMeter(16, "M", mid ?? drive.mid, "#38bdf8");
  drawMeter(28, "H", high ?? drive.high, "#a78bfa");

  const stat = $(`#feed-stat-spectrum`);
  if (stat) {
    stat.textContent = `${((energy ?? drive.energy) * 100).toFixed(0)}% · w${g.toFixed(1)}`;
  }
}

function extractPersonConfidence(maskBuf, confidenceMasks, w, h) {
  const n = w * h;
  const out = new Float32Array(n);
  let confFloat = null;
  if (confidenceMasks?.length) {
    const pick = confidenceMasks[confidenceMasks.length - 1];
    try {
      confFloat = pick.getAsFloat32Array();
    } catch { /* */ }
  }
  for (let i = 0; i < n; i++) {
    out[i] = confFloat?.length >= n ? Math.max(0, Math.min(1, confFloat[i])) : rawPersonConfidence(maskBuf[i]);
  }
  return out;
}

/** Sample dedicated screen video into screenRgb for spatial sphere layer. */
function sampleScreenSource() {
  if (screenSource.mode !== "screen" || !spatialScreenOn()) {
    // Still preview when screen is on but spatial off? Keep rgb if feed process
    if (screenSource.mode === "screen" && screenSource.drawTo(screenCtx, SAMPLE_W, SAMPLE_H, false)) {
      screenRgb = screenCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    } else {
      screenRgb = null;
    }
    return !!screenRgb;
  }
  if (screenSource.drawTo(screenCtx, SAMPLE_W, SAMPLE_H, false)) {
    screenRgb = screenCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    return true;
  }
  screenRgb = null;
  return false;
}

/** Sample dual secondary into secondaryRgb when Dual spatial is enabled. */
function sampleDualSecondary() {
  const want =
    dualCam.mode === "dual" &&
    (spatialDualOn() || dualCam.spatialLayer || dualCam.combine === "spatial" || dualCam.combine === "sbs" || dualCam.combine === "pip");
  if (!want || !dualCam.hasSecondary) {
    if (dualCam.mode !== "dual") secondaryRgb = null;
    return false;
  }
  if (dualCam.drawSecondary(secondaryCtx, SAMPLE_W, SAMPLE_H, false)) {
    secondaryRgb = secondaryCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    return true;
  }
  secondaryRgb = null;
  return false;
}

/** UI state for float player + side columns */
const uiChrome = {
  floatVisible: true, // user preference while staged
  hideLeft: false,
  hideRight: false,
  /** auto-hide columns when float is open (user can re-show) */
  autoHideColumnsOnFloat: true,
};

function parkLiveVideoEl() {
  liveVideoEl.className = "booth-video";
  liveVideoEl.removeAttribute("style");
  liveVideoEl.id = "booth-video-live";
  if (liveVideoEl.parentElement !== document.body) {
    document.body.appendChild(liveVideoEl);
  }
}

function mountLiveVideoInFloat() {
  const wrap = document.querySelector(".booth-float-video-wrap");
  if (!wrap) return;
  liveVideoEl.className = "booth-float-video";
  liveVideoEl.id = "booth-video-live";
  liveVideoEl.muted = true;
  liveVideoEl.playsInline = true;
  liveVideoEl.autoplay = true;
  liveVideoEl.loop = true;
  liveVideoEl.removeAttribute("hidden");
  liveVideoEl.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;background:#000;";
  if (liveVideoEl.parentElement !== wrap) {
    wrap.insertBefore(liveVideoEl, wrap.firstChild);
  }
  const slot = $("#booth-center-video");
  if (slot && slot !== liveVideoEl) slot.hidden = true;
  liveVideoEl.play?.().catch(() => {});
}

function applyColumnVisibility() {
  const root = $("#booth-root");
  if (!root) return;
  root.classList.toggle("booth--hide-left", !!uiChrome.hideLeft);
  root.classList.toggle("booth--hide-right", !!uiChrome.hideRight);
  $("#booth-toggle-left")?.classList.toggle("is-on", !uiChrome.hideLeft);
  $("#booth-toggle-right")?.classList.toggle("is-on", !uiChrome.hideRight);
}

function syncFloatToggleBtn() {
  const btn = $("#booth-toggle-float");
  if (!btn) return;
  const staged = !!liveFeeds.staging;
  btn.hidden = !staged;
  btn.classList.toggle("is-on", staged && uiChrome.floatVisible);
  btn.title = uiChrome.floatVisible
    ? "Hide floating staged player"
    : "Show floating staged player";
  btn.textContent = uiChrome.floatVisible ? "▣" : "□";
}

/**
 * Floating staged-feed player over canvas.
 * show=true mounts liveVideoEl into the float window; hide parks it for sampling only.
 */
function syncCenterStage(show) {
  const player = $("#booth-float-player");
  const title = $("#booth-float-title");
  if (!player) return;

  const want =
    !!show &&
    !!liveFeeds.staging &&
    uiChrome.floatVisible &&
    (PARAMS.liveFloat?.value ?? 1) >= 0.5;

  if (!liveFeeds.staging) {
    player.hidden = true;
    parkLiveVideoEl();
    uiChrome.floatVisible = true; // reset for next stage
    syncFloatToggleBtn();
    return;
  }

  if (!want) {
    player.hidden = true;
    parkLiveVideoEl();
    syncFloatToggleBtn();
    return;
  }

  const active = liveFeeds.getActive();
  player.hidden = false;
  if (title) title.textContent = active?.label || liveFeeds.label || "Staged feed";
  mountLiveVideoInFloat();
  syncFloatPlaybackUi();
  syncFloatToggleBtn();

  // Auto-collapse side columns so float doesn't bury canvas + rails
  if (uiChrome.autoHideColumnsOnFloat) {
    uiChrome.hideLeft = true;
    uiChrome.hideRight = true;
    applyColumnVisibility();
  }
}

function syncFloatPlaybackUi() {
  const v = liveVideoEl;
  const playing = !!(v && !v.paused && !v.ended && v.readyState > 2);
  const playBtn = $("#booth-float-play");
  const pauseBtn = $("#booth-float-pause");
  const timeEl = $("#booth-float-time");
  if (playBtn) {
    playBtn.disabled = !liveFeeds.staging || playing;
    playBtn.classList.toggle("booth-btn--on", playing);
  }
  if (pauseBtn) {
    pauseBtn.disabled = !liveFeeds.staging || !playing;
  }
  if (timeEl && v) {
    const t = Number.isFinite(v.currentTime) ? v.currentTime : 0;
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    const fmt = (sec) => {
      if (!Number.isFinite(sec) || sec < 0) return "0:00";
      const s = Math.floor(sec % 60);
      const m = Math.floor(sec / 60) % 60;
      const h = Math.floor(sec / 3600);
      const pad = (n) => String(n).padStart(2, "0");
      return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    };
    timeEl.textContent = playing
      ? d
        ? `▶ ${fmt(t)} / ${fmt(d)}`
        : `▶ live ${fmt(t)}`
      : "❚❚ paused";
  }
}

function bindFloatPlayer() {
  const player = $("#booth-float-player");
  if (!player || player.dataset.bound) return;
  player.dataset.bound = "1";

  $("#booth-float-hide")?.addEventListener("click", () => {
    uiChrome.floatVisible = false;
    // also sync 3D float plane off
    livePlanes?.setFloatVisible(false);
    liveFeeds.setFloatVisible?.(false);
    syncCenterStage(false);
    setStatus("Float player hidden · click ▣ in header to show");
  });

  $("#booth-float-play")?.addEventListener("click", () => {
    liveFeeds.playVideo();
    syncFloatPlaybackUi();
  });
  $("#booth-float-pause")?.addEventListener("click", () => {
    liveFeeds.pauseVideo();
    syncFloatPlaybackUi();
  });
  $("#booth-float-stop")?.addEventListener("click", () => {
    liveFeeds.stopVideo();
    syncFloatPlaybackUi();
  });

  // Drag by titlebar
  const drag = $("#booth-float-drag");
  if (drag) {
    let ox = 0;
    let oy = 0;
    let dragging = false;
    drag.addEventListener("pointerdown", (ev) => {
      if (ev.target?.closest?.(".booth-float-hide")) return;
      dragging = true;
      const rect = player.getBoundingClientRect();
      ox = ev.clientX - rect.left;
      oy = ev.clientY - rect.top;
      player.style.transform = "none";
      player.style.left = `${rect.left}px`;
      player.style.top = `${rect.top}px`;
      drag.setPointerCapture?.(ev.pointerId);
    });
    drag.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      player.style.left = `${Math.max(8, ev.clientX - ox)}px`;
      player.style.top = `${Math.max(8, ev.clientY - oy)}px`;
    });
    drag.addEventListener("pointerup", () => {
      dragging = false;
    });
  }

  liveVideoEl.addEventListener("play", () => syncFloatPlaybackUi());
  liveVideoEl.addEventListener("pause", () => syncFloatPlaybackUi());
  liveVideoEl.addEventListener("timeupdate", () => {
    if (!uiChrome._floatTimeMs || performance.now() - uiChrome._floatTimeMs > 350) {
      uiChrome._floatTimeMs = performance.now();
      syncFloatPlaybackUi();
    }
  });
}

function bindColumnToggles() {
  $("#booth-toggle-left")?.addEventListener("click", () => {
    uiChrome.hideLeft = !uiChrome.hideLeft;
    applyColumnVisibility();
    setStatus(uiChrome.hideLeft ? "Left column hidden" : "Left column shown");
  });
  $("#booth-toggle-right")?.addEventListener("click", () => {
    uiChrome.hideRight = !uiChrome.hideRight;
    applyColumnVisibility();
    setStatus(uiChrome.hideRight ? "Right column hidden" : "Right column shown");
  });
  $("#booth-toggle-float")?.addEventListener("click", () => {
    if (!liveFeeds.staging) return;
    uiChrome.floatVisible = !uiChrome.floatVisible;
    livePlanes?.setFloatVisible(uiChrome.floatVisible);
    liveFeeds.setFloatVisible?.(uiChrome.floatVisible);
    if (uiChrome.floatVisible) {
      // show float again; restore columns only if user re-opens without auto-hide preference
      syncCenterStage(true);
      setStatus("Float player shown");
    } else {
      syncCenterStage(false);
      setStatus("Float player hidden");
    }
  });
  applyColumnVisibility();
  syncFloatToggleBtn();
}

function drawActiveSource(mirror) {
  // Always sample optional spatial layers (dual secondary + screen) so they can mix
  sampleScreenSource();

  if (liveFeeds.staging || liveFeeds.active) {
    sampleDualSecondary();
    // Keep float player in sync when staged + user wants it visible
    if (liveFeeds.staging && uiChrome.floatVisible) {
      const player = $("#booth-float-player");
      if (player?.hidden) syncCenterStage(true);
    }
    return liveFeeds.drawTo(sampleCtx, SAMPLE_W, SAMPLE_H, mirror);
  }
  if (dualCam.active) {
    const ok = dualCam.drawPrimary(
      sampleCtx,
      SAMPLE_W,
      SAMPLE_H,
      mirror && dualCam.mode !== "iphone" && dualCam.mode !== "deskview",
    );
    sampleDualSecondary();
    return ok;
  }
  secondaryRgb = null;

  // Screen-only mode: drive primary sample from screen when no dual/webcam
  if (screenSource.mode === "screen" && !dualCam.active) {
    const ok = screenSource.drawTo(sampleCtx, SAMPLE_W, SAMPLE_H, false);
    return ok;
  }

  if (hexcastSource.active) {
    const mir = mirror && hexcastSource.mode === "camera";
    return hexcastSource.drawTo(sampleCtx, SAMPLE_W, SAMPLE_H, mir);
  }
  return false;
}

function buildFallbackCloudFromSample(liveOn) {
  try {
    if (!drawActiveSource(state.mirror)) return false;
    const rgb = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
    const studioOn = (PARAMS.studioMode?.value ?? 0) >= 0.5;
    // Studio fallback: empty person conf → cluster centers still seed floating hosts
    const personConf = new Float32Array(SAMPLE_W * SAMPLE_H).fill(liveOn && !studioOn ? 1 : 0);
    state._lastPersonConf = personConf;
    rebuildAllLayers(personConf, rgb.data, SAMPLE_W, SAMPLE_H);
    drawFeeds(rgb.data, personConf, SAMPLE_W, SAMPLE_H);
    return true;
  } catch (e) {
    // Avoid spamming status every frame
    if (!state._lastCloudErrMs || performance.now() - state._lastCloudErrMs > 2500) {
      state._lastCloudErrMs = performance.now();
      setStatus(`Cloud sample: ${errMessage(e)}`, true);
    }
    return false;
  }
}

function runSegmentation(now) {
  if (!state.running || state.segBusy) return;
  const liveOn = liveFeeds.staging || liveFeeds.active;
  const hasVideo =
    liveOn ||
    (dualCam.active && video.readyState >= 2) ||
    (screenSource.mode === "screen" && screenVideo.readyState >= 2) ||
    (hexcastSource.active && (hexcastSource.mode === "hexcast" || video.readyState >= 2));
  if (!hasVideo && hexcastSource.mode !== "hexcast" && !liveOn && screenSource.mode !== "screen") return;
  if (now - state.lastSegFrame < SEG_INTERVAL_MS) return;

  // Lazy-load vision (single-flight). Keep full-frame cloud alive while loading / on error.
  if (!state.segmenter) {
    if (!lazy.isLoading("vision") && state.visionPhase !== "error") {
      ensureRunning({ requireSeg: true }).catch((e) => {
        state.visionPhase = "error";
        state.visionError = errMessage(e);
        setStatus(`Vision load failed: ${state.visionError} · live cloud continues`, true);
      });
    } else if (state.visionPhase === "error" && !lazy.isLoading("vision")) {
      // Occasional retry after failure (every ~8s)
      if (!state._visionRetryAt || now > state._visionRetryAt) {
        state._visionRetryAt = now + 8000;
        lazy.reset("vision");
        lazy.reset("segmenter");
        ensureRunning({ requireSeg: true }).catch(() => {});
      }
    }
    if (liveOn || hasVideo) buildFallbackCloudFromSample(liveOn);
    state.lastSegFrame = now;
    return;
  }

  state.segBusy = true;
  state.lastSegFrame = now;
  const t0 = performance.now();

  const mirror = state.mirror;
  if (!drawActiveSource(mirror)) {
    state.segBusy = false;
    return;
  }

  let personConf;
  let rgb;
  try {
    const result = state.segmenter.segment(sampleCanvas);
    const studioOnSeg = (PARAMS.studioMode?.value ?? 0) >= 0.5;
    // Track on live studio so multi-host desk gets person masks
    if (state.tier >= 2 && trackHub?.ready && (!liveOn || studioOnSeg)) {
      try {
        trackHub.detect(sampleCanvas, Math.round(PARAMS.trackRadius?.value ?? 14));
      } catch (te) {
        if (!state._lastTrackErrMs || now - state._lastTrackErrMs > 4000) {
          state._lastTrackErrMs = now;
          setStatus(`Track: ${errMessage(te)}`, true);
        }
      }
    }

    state.lastSegMs = performance.now() - t0;

    if (!result?.categoryMask) {
      rgb = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
      // Studio: keep empty mask so cluster fallback can place people; non-studio full fill
      personConf = new Float32Array(SAMPLE_W * SAMPLE_H).fill(liveOn && !studioOnSeg ? 1 : 0);
      // Even without selfie mask, motion+face seeds can lift crowd layers
      if (liveOn || studioOnSeg || (PARAMS.crowdSegEnable?.value ?? 1) >= 0.5) {
        personConf = crowdSeg.refine(personConf, rgb, SAMPLE_W, SAMPLE_H, {
          segmenter: state.segmenter,
          sourceCanvas: sampleCanvas,
          trackHub,
          crowdMode: true,
        });
      }
    } else {
      const mask = result.categoryMask;
      try {
        const maskBuf = mask.getAsUint8Array();
        rgb = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
        personConf = extractPersonConfidence(maskBuf, result.confidenceMasks, SAMPLE_W, SAMPLE_H);
        // Do NOT force every pixel to "person" in studio — that kills isolation
        // and flattens hosts into the floor video. Non-studio live still lifts full frame.
        if (liveOn && !studioOnSeg) {
          for (let i = 0; i < personConf.length; i++) {
            personConf[i] = Math.max(personConf[i], 0.85);
          }
        }
        if (!studioOnSeg) {
          calibrateMaskPolarity(personConf, SAMPLE_W, SAMPLE_H);
        } else {
          // Prefer "person is high conf" without auto-invert flipping the desk
          state.maskPolarity = 1;
          state.maskCalibrated = true;
        }
        // Crowd / dense multi-scale refine (DBFace tiles · face seeds · motion · TF BodyPix)
        const crowdMode =
          autoCal.mode === "crowd" ||
          ((PARAMS.studioMode?.value ?? 0) >= 0.5 && (PARAMS.analysisEnable?.value ?? 0) >= 0.5) ||
          (PARAMS.crowdSegEnable?.value ?? 0) >= 0.5;
        if (crowdMode || (PARAMS.crowdSegEnable?.value ?? 1) >= 0.5) {
          personConf = crowdSeg.refine(personConf, rgb, SAMPLE_W, SAMPLE_H, {
            segmenter: state.segmenter,
            sourceCanvas: sampleCanvas,
            trackHub,
            crowdMode,
          });
          // Adaptive mask: dense small people need lower thr
          const frac = estimatePersonFrac(personConf);
          if (crowdMode && frac < 0.22 && PARAMS.mask) {
            const target = Math.max(PARAMS.mask.min, Math.min(0.32, 0.28));
            PARAMS.mask.value = PARAMS.mask.value * 0.92 + target * 0.08;
          }
        }
      } finally {
        try {
          mask.close?.();
        } catch {
          /* */
        }
        try {
          result.confidenceMasks?.forEach((m) => m.close?.());
        } catch {
          /* */
        }
      }
    }
  } catch (err) {
    // Segmenter runtime error — degrade to full-frame, don't kill the loop
    if (!state._lastSegErrMs || now - state._lastSegErrMs > 3000) {
      state._lastSegErrMs = now;
      setStatus(`Seg error: ${errMessage(err)} · fallback cloud`, true);
    }
    try {
      rgb = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
      personConf = new Float32Array(SAMPLE_W * SAMPLE_H).fill(1);
    } catch {
      state.segBusy = false;
      return;
    }
  } finally {
    state.segBusy = false;
  }

  if (!rgb || !personConf) return;

  {
    const modeId = resolveDepthMode(PARAMS).id;
    const wantJax = modeId === "jax" || modeId === "radial";
    const wantZip = modeId === "zipdepth" || modeId === "radial";
    let flat = null;
    const ensureFlat = () => {
      if (flat) return flat;
      flat = new Uint8Array(SAMPLE_W * SAMPLE_H * 3);
      for (let j = 0, p = 0; j < rgb.data.length; j += 4, p += 3) {
        flat[p] = rgb.data[j];
        flat[p + 1] = rgb.data[j + 1];
        flat[p + 2] = rgb.data[j + 2];
      }
      return flat;
    };
    if (wantJax && window.aitoMac?.fetchJaxDepth) {
      window.aitoMac.fetchJaxDepth(ensureFlat(), SAMPLE_W, SAMPLE_H);
    }
    if (wantZip && window.aitoMac?.fetchZipDepth) {
      window.aitoMac.fetchZipDepth(ensureFlat(), SAMPLE_W, SAMPLE_H);
    }
    // Keep dense depth field warm for ZipDepth mode and/or spatial depth cloud
    const depthCloudOn = (PARAMS.depthCloud?.value ?? 1) >= 0.5;
    if (modeId === "zipdepth" || depthCloudOn || wantZip) {
      ensureDepthField(rgb.data, SAMPLE_W, SAMPLE_H);
    }
  }

  state._lastPersonConf = personConf;
  rebuildAllLayers(personConf, rgb.data, SAMPLE_W, SAMPLE_H);
  drawFeeds(rgb.data, personConf, SAMPLE_W, SAMPLE_H);
  updateFaceGazeFromTrack();
  // Desk scene stack: screen texture from screen share or primary; gaze from face
  const stackRgb =
    screenRgb && spatialScreenOn()
      ? { data: screenRgb, width: SAMPLE_W, height: SAMPLE_H }
      : { data: rgb.data, width: SAMPLE_W, height: SAMPLE_H };
  sceneStack?.update(stackRgb, faceGazeTip);
  // Periodic soft auto-cal when enabled — crowd mode tracks people motion continuously
  if (autoCal.enabled) {
    const snap = state.analysis || spatialAnalyzer?.snapshot?.() || {};
    const crowdMode =
      autoCal.mode === "crowd" ||
      ((PARAMS.studioMode?.value ?? 0) >= 0.5 && (PARAMS.analysisEnable?.value ?? 0) >= 0.5);
    autoCal.tick({
      rgb: rgb.data,
      w: SAMPLE_W,
      h: SAMPLE_H,
      params: PARAMS,
      ctx: {
        hasDual: dualCam.mode === "dual",
        hasScreen: screenSource.mode === "screen" || liveFeeds.staging,
        personFrac: estimatePersonFrac(personConf),
        studioCrowd: crowdMode,
        forceClass: crowdMode ? "crowd_spire" : null,
        flowEnergy: snap.flowEnergy ?? 0,
        circularity: snap.circularity ?? 0,
        clusterCount: studioSpatial?.clusterCenters?.length || 0,
      },
      now,
      force: false,
    });
  }
  mask.close?.();
  result.confidenceMasks?.forEach((m) => m.close?.());
}

// —— MIDI / music ——

function applyMidiCc(cc, value01) {
  for (const [key, spec] of Object.entries(PARAMS)) {
    if (spec.midiCc === cc) {
      spec.value = spec.min + value01 * (spec.max - spec.min);
      if (isToggleParam(key, spec)) {
        spec.value = value01 >= 0.5 ? 1 : 0;
      }
      syncParamUi(key, spec);
      onParamChanged(key, spec, spec.group || "cloud");
      return key;
    }
  }
  return null;
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    setStatus("Web MIDI not supported", true);
    return;
  }
  state.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
  const inputs = [...state.midiAccess.inputs.values()];
  if (!inputs.length) {
    setStatus("No MIDI inputs", true);
    return;
  }
  if (state.midiInput) state.midiInput.onmidimessage = null;
  state.midiInput = inputs[0];
  state.midiInput.onmidimessage = (ev) => {
    const [status, a, b] = ev.data;
    const cmd = status & 0xf0;
    if (cmd === 0xb0) {
      const t = performance.now() * 0.001;
      musicBus.ping(b / 127, PARAMS.beatSens?.value ?? 1);
      const wasmVal = window.aitoMac?.applyWasmMidi?.(a, b / 127, t);
      if (wasmVal != null) {
        const specKey = { 1: "dispersion", 2: "depth", 4: "spin" }[a];
        if (specKey && PARAMS[specKey]) {
          PARAMS[specKey].value = wasmVal;
          if (PARAMS[specKey].input) {
            PARAMS[specKey].input.value = String(wasmVal);
            PARAMS[specKey].output.textContent = formatParam(specKey, wasmVal);
          }
        }
      }
      const key = applyMidiCc(a, b / 127);
      midiLog.textContent = key ? `CC${a} → ${key}` : `CC${a}=${b}`;
      syncUniforms();
    } else if (cmd === 0x90 && b > 0) {
      musicBus.noteOn(a, b / 127);
      syncUniforms();
      midiLog.textContent = `Note ${a} vel ${b}`;
    }
  };
  $("#booth-midi").classList.add("booth-btn--on");
  setStatus(`MIDI · ${state.midiInput.name}`);
}

function syncAudioButtons() {
  $("#booth-audio")?.classList.toggle("booth-btn--on", audioEngine.active && audioEngine.mode === "mic");
  $("#booth-track")?.classList.toggle("booth-btn--on", audioEngine.active && audioEngine.mode === "track");
}

async function connectAudio() {
  if (audioEngine.active && audioEngine.mode === "mic") {
    audioEngine.stop();
    syncAudioButtons();
    setStatus("Mic off");
    return;
  }
  await audioEngine.startMic();
  syncAudioButtons();
  setStatus("Audio · mic FFT live");
}

async function loadDefaultTrack() {
  if (audioEngine.active && audioEngine.mode === "track") {
    const playing = audioEngine.togglePause();
    syncAudioButtons();
    setStatus(playing ? `Track · ${DEFAULT_TRACK_LABEL}` : `Track paused · ${DEFAULT_TRACK_LABEL}`);
    return;
  }
  await audioEngine.loadDefaultTrack();
  syncAudioButtons();
  setStatus(`Track · ${DEFAULT_TRACK_LABEL}`);
}

async function loadTrackFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const label = file.name.replace(/\.[^.]+$/, "") || "Track";
  await audioEngine.loadTrack(url, label);
  syncAudioButtons();
  setStatus(`Track · ${label}`);
}

// —— Loop ——

let frames = 0;
let fpsT = performance.now();
let toolsT = 0;

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function applySceneMotion(now) {
  const prev = state.lastTick || now;
  const dt = Math.min(0.05, (now - prev) * 0.001);
  state.lastTick = now;

  // Live MediaPipe IK + hand control (on-device — not Splatline)
  if (state.tier >= 2 && trackHub?.ready) {
    // Keep profile flags in sync without reload
    const models = currentTrackModels();
    trackHub.setProfileFlags?.(models);
    liveIk.update(trackHub, PARAMS);
    const h = handCtrl.update(trackHub, PARAMS, musicBus, now);
    // Prefer IK control bus when active for depth/wave adds
    if (liveIk.control.active && (PARAMS.ikEnable?.value ?? 1) >= 0.5) {
      state.handDepthAdd = liveIk.control.depth * 0.22 + (h.depthAdd || 0) * 0.35;
      state.handWaveform = Math.max(h.waveform || 0, liveIk.control.wave * 0.85);
      if (liveIk.control.pinchR > 0.55 && musicBus) {
        musicBus.energy = Math.min(1, (musicBus.energy || 0) + liveIk.control.pinchR * 0.03);
      }
    } else {
      state.handDepthAdd = h.depthAdd;
      state.handWaveform = h.waveform;
    }
    if (now - (state._ikStatT || 0) > 250) {
      state._ikStatT = now;
      syncIkStats();
    }
  } else {
    state.handDepthAdd = 0;
    state.handWaveform = 0;
  }

  if (state.motionMode !== "trackAttract") state.trackAttract = 0;

  const ph = applyMotion({
    ...motionCtx,
    dt,
    now,
    mode: state.motionMode,
    cloudPivot,
    camera,
    controls,
    params: PARAMS,
    musicBus,
    state,
    voxelStack,
    layerClouds,
    handCtrl,
    trackHub,
    kaabaBlueprint,
  });
  // Kaaba only when layout selected + active (never boot-load)
  if (
    kaabaBlueprint &&
    blueprintIsActive() &&
    activeBlueprintLayout().id === "kaaba" &&
    (PARAMS.kaabaEnable?.value ?? 0) >= 0.5
  ) {
    const spinLoad = Math.abs(PARAMS.spin?.value ?? 0) + Math.abs(state.spinYaw || 0) * 0.15;
    const busy = !!state.segBusy || (state.fps > 0 && state.fps < 30);
    kaabaBlueprint.update(dt, state.motionTime ?? now * 0.001, {
      busy,
      spinLoad,
      fps: state.fps || 60,
    });
  }
  if (ph?.placeholder) setStatus(`${ph.placeholder} — coming soon`);
}

function tick(now) {
  requestAnimationFrame(tick);
  applySceneMotion(now);
  if (audioEngine.active) {
    const bands = audioEngine.sample();
    if (bands.playing) {
      const g =
        (PARAMS.audioGain?.value ?? 1) *
        ((PARAMS.studioMode?.value ?? 0) >= 0.5 ? (PARAMS.studioWaveGain?.value ?? 2.2) * 0.55 : 1);
      musicBus.ingestAudio(bands, g);
    }
  }
  // Studio LiDAR / columns / trails + spatial analysis (TF pattern predict)
  if ((PARAMS.studioMode?.value ?? 0) >= 0.5 && studioSpatial) {
    const drive = studioWaveformDrive(musicBus, PARAMS);
    const tips = [];
    if (trackHub?.jointPoints?.length) {
      for (const j of trackHub.jointPoints) {
        const p = studioProject(j.nx, j.ny, 0.5 + (j.nz || 0), PARAMS, "person");
        tips.push(p);
      }
    } else if (studioSpatial.clusterCenters?.length) {
      for (const c of studioSpatial.clusterCenters) {
        tips.push(studioProject(c.nx, c.ny, 0.5, PARAMS, "cluster"));
      }
    }
    const dt = Math.min(0.05, ((now - (state.lastTick || now)) * 0.001) || 0.016);
    studioSpatial.update(tips, drive, dt);

    if (spatialAnalyzer?.enabled) {
      const snap = spatialAnalyzer.push({
        clusters: studioSpatial.clusterCenters || [],
        personFrac: state.layerCounts?.person
          ? Math.min(1, (state.layerCounts.person || 0) / 800)
          : 0.2,
        audio: drive,
        t: now * 0.001,
      });
      const predWorld = (snap.predictions || []).map((pr) => {
        const p = studioProject(pr.nx, pr.ny, 0.55 + (pr.conf || 0.4) * 0.2, PARAMS, "cluster");
        const wave = spatialAnalyzer.waveLiftAt(pr.nx, pr.ny);
        return {
          x: p.x,
          y: p.y + wave * 0.25,
          z: p.z + wave * 0.4,
          conf: pr.conf,
        };
      });
      studioSpatial.setPredictions(predWorld);
      const analysisEl = $("#booth-analysis-stat");
      if (analysisEl) analysisEl.textContent = snap.status;
      state.analysis = snap;
    } else {
      studioSpatial.setPredictions([]);
    }
  }
  // Live floor (hi-res face-up) + center see-through float
  if (liveFeeds.staging || livePlanes?.active) {
    livePlanes?.setActive(true);
    livePlanes?.update(camera);
  } else {
    livePlanes?.setActive(false);
  }
  musicBus.tick(PARAMS.beatDecay?.value ?? 0.93, PARAMS.noteDecay?.value ?? 0.94);
  syncUniforms();
  for (const cloud of Object.values(layerClouds)) {
    if (cloud.mat.uniforms?.uTime) cloud.mat.uniforms.uTime.value = now * 0.001;
  }
  if (jointCloud?.material?.uniforms?.uTime) {
    jointCloud.material.uniforms.uTime.value = now * 0.001;
  }
  if (state.running) runSegmentation(now);
  controls.update();
  renderer.render(scene, camera);

  frames++;
  if (now - fpsT >= 500) {
    state.fps = Math.round((frames * 1000) / (now - fpsT));
    frames = 0;
    fpsT = now;
    const parts = Object.entries(state.layerCounts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}:${n}`)
      .join(" · ");
    const audioTag = audioEngine.active ? ` · ${audioEngine.trackLabel || "mic"} ${musicBus.audioEnergy.toFixed(2)}` : "";
    const motionTag = MOTION_MODES.find((m) => m.id === state.motionMode)?.label ?? state.motionMode;
    const depthTag = resolveDepthMode(PARAMS).label;
    const handTag = handCtrl.signals?.active ? ` · hands d${handCtrl.depthMod.toFixed(1)}/w${handCtrl.waveMod.toFixed(1)}` : "";
    const selTag = selectionHub?.selected ? ` · sel ${selectionHub.selected.label}` : "";
    const spatBits = [];
    if (dualCam.mode === "dual" && spatialDualOn()) spatBits.push("dual∴");
    if (screenSource.mode === "screen" && spatialScreenOn()) spatBits.push("screen∴");
    const camTag = liveFeeds.staging
      ? ` · live`
      : dualCam.active
        ? ` · ${dualCam.mode}`
        : screenSource.mode === "screen"
          ? ` · screen`
          : hexcastSource.active
            ? ` · ${hexcastSource.mode}`
            : "";
    if (sceneStack?.enabled) spatBits.push("desk");
    const spatTag = spatBits.length ? ` · [${spatBits.join(" ")}]` : "";
    const calTag = autoCal.lastResult ? ` · cal ${autoCal.lastResult.label || autoCal.lastResult.class}` : "";
    const an = state.analysis;
    const analysisTag =
      an && spatialAnalyzer?.enabled
        ? ` · ${an.pattern} circ${((an.circularity || 0) * 100) | 0}% pred${an.predictions?.length || 0}`
        : "";
    hudEl.textContent = `T${state.tier} · ${motionTag} · ${depthTag}${camTag}${spatTag}${handTag}${selTag}${calTag}${analysisTag} · ${state.points.toLocaleString()} pts · ${state.fps} fps · beat ${musicBus.beat.toFixed(2)}${audioTag}`;
    const monFps = document.getElementById("booth-mon-fps");
    const monPts = document.getElementById("booth-mon-pts");
    const monTier = document.getElementById("booth-mon-tier");
    if (monFps) monFps.textContent = `FPS ${state.fps}`;
    if (monPts) monPts.textContent = `PTS ${state.points.toLocaleString()}`;
    if (monTier) monTier.textContent = `T${state.tier}`;
  }
  if (now - toolsT > 2000) {
    toolsT = now;
    refreshToolsPanel();
  }
}

// —— Studio broadcast launch ——

/**
 * Resolve YouTube via local yt-dlp proxy and stage into booth + studio LiDAR mode.
 * @param {string} [videoId]
 * @param {{ podcast?: boolean, crowd?: boolean, label?: string }} [opts]
 *   crowd=true → elevated spire/plaza preset + TF spatial analysis (Makkah Live test)
 */
async function launchStudioBroadcast(videoId = STUDIO_YT_ID, opts = {}) {
  const crowd = !!opts.crowd;
  const podcast = !crowd && opts.podcast !== false; // default podcast table for desk tests
  if (crowd) {
    applyCrowdSpirePreset(PARAMS);
  } else if (podcast) applyPodcastTablePreset(PARAMS);
  else applyStudioPreset(PARAMS);
  if (PARAMS.studioMode) PARAMS.studioMode.value = 1;
  if (crowd && PARAMS.analysisEnable) PARAMS.analysisEnable.value = 1;
  if (crowd && PARAMS.analysisPredict) PARAMS.analysisPredict.value = 1;
  // Never auto-load Kaaba / blueprints on crowd boot — pick from Blueprint layouts UI
  if (crowd) {
    autoCal.enabled = true;
    autoCal.mode = "crowd";
    autoCal.intervalMs = 900;
    state.layerGroupMode = "crowd";
    applyLayerGroup(FEEDS, "crowd", true, { exclusive: true });
    if (FEEDS.edge) FEEDS.edge.process = true;
    if (FEEDS.composite) FEEDS.composite.process = false;
    // Keep free camera; blueprint is opt-in
    if (PARAMS.blueprintEnable) PARAMS.blueprintEnable.value = 0;
    if (PARAMS.kaabaEnable) PARAMS.kaabaEnable.value = 0;
    kaabaBlueprint?.setVisible(false);
    try {
      syncFeedProcessUi();
    } catch {
      /* feed strip may not be mounted yet */
    }
    setStatus("Crowd live · free cam · pick Blueprint layout when ready (no auto-load)");
  }
  // Layer mix: people cloud + floor video (no composite blanket)
  if (FEEDS.person) FEEDS.person.process = true;
  if (FEEDS.person2) FEEDS.person2.process = true;
  if (FEEDS.background) FEEDS.background.process = false;
  if (FEEDS.composite) FEEDS.composite.process = false;
  state.maskLayer = "person";
  // Sync UI rows after preset mass-write
  for (const [k, spec] of Object.entries(PARAMS)) {
    if (spec?.input || spec?.output) syncParamUi(k, spec);
  }
  studioSpatial.rebuild();
  sceneStack?.rebuild();
  // Blueprints never auto-load here — free cam for crowd; desk stack ok for podcast
  if (!crowd) {
    kaabaBlueprint?.setVisible(false);
    sceneStack?.setVisible?.(true);
  }
  if (typeof window.syncUniforms === "function") window.syncUniforms();
  // Pre-warm TF.js when crowd analysis is on (non-blocking)
  if (crowd && spatialAnalyzer?.predictOn) {
    spatialAnalyzer.ensureTf().catch(() => {});
  }

  // Immediate cal so spatial stack matches layout before first frames
  runAutoCalibrate(true, {
    forceClass: crowd ? "crowd_spire" : "podcast_table",
    studioPodcast: !crowd,
    studioCrowd: crowd,
    hasScreen: true,
  });

  // Open left live rail above layers + ensure tier with spectrum
  if (state.tier < 4) await setTier(4);
  if (FEEDS.spectrum) FEEDS.spectrum.process = true;
  uiChrome.hideLeft = false;
  applyColumnVisibility();
  const panel = $("#booth-live-panel");
  if (panel) panel.open = true;
  const feedsSec = $("#booth-feeds-section");
  if (feedsSec) feedsSec.open = true;
  // Ensure left column shows Live first (above Layers)
  panel?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  // Expand analysis section on right
  const cloudSec = $("#booth-cloud-section");
  if (cloudSec) cloudSec.open = true;

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const modeLabel = crowd ? "crowd spire · TF analysis" : podcast ? "podcast table" : "studio";
  setStatus(`Studio · ${modeLabel} · resolving YouTube ${videoId}…`);
  let staged = false;
  try {
    const info = await lazy.load(
      `yt:${videoId}`,
      () => fetchJson(`/api/yt/resolve?v=${encodeURIComponent(videoId)}&h=720`, { cache: "no-store", timeoutMs: 90000 }),
      { label: "YouTube resolve", retries: 1, retryDelayMs: 800, force: true },
    );

    const item = {
      id: `yt-${videoId}`,
      kind: "video",
      platform: "youtube",
      src: info.proxy || info.stream,
      label: (opts.label || info.title || (crowd ? CROWD_SPIRE_LABEL : "Studio live")).slice(0, 48),
      drawable: true,
      original: watchUrl,
      isLive: !!info.is_live,
      live: !!info.is_live,
    };
    if (info.stream?.includes("m3u8") || info.kind === "hls" || info.hls_proxy) {
      item.kind = "hls";
      item.src = info.hls_proxy || `/api/hls?url=${encodeURIComponent(info.stream)}`;
    }
    if (!item.src) throw new Error("Resolve returned no stream URL");

    liveFeeds.items = [item];
    liveFeeds.activeId = item.id;
    liveFeeds.render();

    // Warm vision without blocking stage if it fails
    ensureRunning({ requireSeg: false }).catch(() => {});
    try {
      await liveFeeds.stageActive();
      staged = true;
    } catch (stageErr) {
      throw new Error(`Stage failed: ${errMessage(stageErr)}`);
    }
    uiChrome.floatVisible = true;
    livePlanes?.setActive(true);
    syncCenterStage(true);

    try {
      await audioEngine.connectMediaElement(liveVideoEl, item.label);
      $("#booth-audio")?.classList.add("booth-btn--on");
    } catch (ae) {
      try {
        await audioEngine.startMic();
        setStatus(`Studio · ${item.label} · mic audio (media tap blocked)`);
      } catch {
        setStatus(`Studio · ${item.label} · video ok · audio: ${errMessage(ae)}`, true);
      }
    }

    // Free orbit for crowd — never lock to Kaaba scripted cam (user can pick Tawaf later)
    setMotionMode(crowd ? "parallax" : "turntable");
    state.camDrive = false;
    // Re-cal once video pixels are live
    setTimeout(() => {
      runAutoCalibrate(true, {
        forceClass: crowd ? "crowd_spire" : "podcast_table",
        studioPodcast: !crowd,
        studioCrowd: crowd,
        hasScreen: true,
      });
    }, 1600);
    const liveTag = info.is_live ? "LIVE" : "VOD";
    const analysisTag = crowd
      ? ` · analysis ${PARAMS.analysisPredict?.value >= 0.5 ? "TF on" : "heuristic"} · wave lift ×${(PARAMS.analysisWaveLift?.value ?? 1.2).toFixed(1)}`
      : "";
    setStatus(
      `Studio · ${modeLabel} · ${liveTag} · ${item.label} · LiDAR · wave ×${(PARAMS.studioWaveGain?.value ?? 2).toFixed(1)}${analysisTag}`,
    );
    const foot = $("#booth-footer-msg");
    if (foot) {
      foot.textContent = crowd
        ? `Crowd spire · ${item.label.slice(0, 28)} · voxel wave · TF predict`
        : `Podcast table · ${item.label.slice(0, 36)} · auto-cal`;
    }
    const analysisEl = $("#booth-analysis-stat");
    if (analysisEl) {
      analysisEl.textContent = crowd
        ? `analysis · armed · ${item.label.slice(0, 32)} · waiting clusters…`
        : analysisEl.textContent;
    }
  } catch (e) {
    const embedItem = {
      id: `yt-embed-${videoId}`,
      kind: "iframe",
      platform: "youtube",
      src: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0`,
      label: crowd ? CROWD_SPIRE_LABEL : "Studio embed",
      drawable: false,
      original: watchUrl,
    };
    liveFeeds.items = [embedItem];
    liveFeeds.activeId = embedItem.id;
    liveFeeds.render();
    setStatus(
      `Studio resolve failed (${errMessage(e)}). Embed loaded — use Screen to capture tab for spatial, or check yt-dlp /api/yt/resolve.`,
      true,
    );
    console.error("[booth] launchStudioBroadcast", e);
  }

  // Always keep YouTube reference link in paste history UX
  const ta = document.querySelector(".lvr-paste");
  if (ta) ta.value = watchUrl;

  return staged;
}

// —— Boot ——

// QBPM bridge first so menubar #qbpm can open center stage immediately
initQbpmBridge();
bindResolveMenubar();
buildTierBar();
buildCameraPanel();
buildMotionPanel();
buildSourceToggles();
buildFeedStrip();
buildSliders();
// Mirror track-group sliders into dedicated IK section when present
(() => {
  const host = $("#booth-ik-sliders");
  if (!host) return;
  host.innerHTML =
    `<p class="booth-motion-desc">Profiles: Hands (lightest) · Body · Full · Eco (skip). ` +
    `MediaPipe <strong>@${MEDIAPIPE.tasksVision}</strong> · gestures: open / fist / pinch / point / peace · two-hand span. ` +
    `IK writes depth/wave/spin live. Side columns handle controls while QBPM owns center.</p>`;
})();
// External hand / spatial resource catalog (measure_plan, SkalskiP, Splatline, …)
mountHandResources($("#booth-hand-resources"));
syncMaskLayerFeeds();
buildToolsPanel();
bindPanelChrome();
syncUniforms();
resize();
window.addEventListener("resize", resize);
// Expose live tools for QBPM / debug
window.aitoBoothIK = liveIk;
window.aitoBoothHand = handCtrl;
window.aitoHandResources = { MEDIAPIPE, mountHandResources };
// Note: late boot may re-assign aitoBoothHand — keep IK export stable

// Left column: source + layer bulk toggles
$("#booth-sources-all-on")?.addEventListener("click", () => {
  bootVisionAnd(async () => {
    await startDualStackScene();
    try {
      await startScreenShare({ spatial: true, keepDual: true });
    } catch {
      /* screen share requires user gesture / permission — dual alone is fine */
    }
    syncSourceButtons();
    setStatus("Sources · dual stack on (screen needs click if blocked)");
  });
});
$("#booth-sources-all-off")?.addEventListener("click", () => {
  stopCamera();
  syncSourceButtons();
  setStatus("Sources · all off");
});
$("#booth-layers-all-on")?.addEventListener("click", () => setAllLayers(true));
$("#booth-layers-all-off")?.addEventListener("click", () => setAllLayers(false));
$("#booth-layers-solo")?.addEventListener("click", () => {
  setLayerGroup("solo", true, { exclusive: true });
  $("#booth-layers-solo")?.classList.add("booth-btn--on");
  $("#booth-layers-crowd")?.classList.remove("booth-btn--on");
});
$("#booth-layers-crowd")?.addEventListener("click", () => {
  setLayerGroup("crowd", true, { exclusive: true });
  if (FEEDS.edge) FEEDS.edge.process = true;
  syncFeedProcessUi();
  $("#booth-layers-crowd")?.classList.add("booth-btn--on");
  $("#booth-layers-solo")?.classList.remove("booth-btn--on");
});

// Query: ?studio=1 or ?v=m9-Umj3aL1I&mode=crowd  or  ?crowd=1
const bootParams = new URLSearchParams(location.search);
const bootCrowd =
  bootParams.get("crowd") === "1" ||
  bootParams.get("crowd") === "true" ||
  bootParams.get("mode") === "crowd" ||
  bootParams.get("mode") === "spire" ||
  bootParams.get("mode") === "makkah" ||
  bootParams.get("analysis") === "1" ||
  location.hash.includes("crowd");
const bootStudio =
  bootParams.get("studio") === "1" ||
  bootParams.get("studio") === "true" ||
  bootParams.has("v") ||
  bootCrowd ||
  location.hash.includes("studio");
const bootVideoId =
  bootParams.get("v") || (bootCrowd ? CROWD_SPIRE_YT_ID : STUDIO_YT_ID);

async function bootVisionAnd(run) {
  const opName = run?.name || "operation";
  try {
    setStatus("Loading vision models…");
    try {
      await ensureRunning({ requireSeg: true });
    } catch (visionErr) {
      // Allow camera/live ops to proceed; full-frame path works without seg
      setStatus(`Vision: ${errMessage(visionErr)} · continuing`, true);
    }
    if (typeof run === "function") await run();
    refreshToolsPanel();
  } catch (err) {
    const msg = errMessage(err, `${opName} failed`);
    setStatus(msg, true);
    console.error(`[booth] ${opName}`, err);
  }
}

$("#booth-start").addEventListener("click", () => bootVisionAnd(startCamera));
$("#booth-iphone")?.addEventListener("click", () => bootVisionAnd(startIPhoneCamera));
$("#booth-dual")?.addEventListener("click", () => bootVisionAnd(startDualStackScene));
$("#booth-deskview")?.addEventListener("click", () => bootVisionAnd(startDeskViewCamera));
$("#booth-autocal")?.addEventListener("click", () => {
  const r = runAutoCalibrate(true);
  if (r) autoCal.enabled = true;
  else autoCal.enabled = !autoCal.enabled;
  $("#booth-autocal")?.classList.toggle("booth-btn--on", autoCal.enabled);
});
$("#booth-live")?.addEventListener("click", () => bootVisionAnd(focusLiveFeeds));
$("#booth-device")?.addEventListener("change", (ev) => {
  const id = ev.target.value;
  if (id) bootVisionAnd(() => startDeviceById(id));
});
$("#booth-pair-shot")?.addEventListener("click", () => exportPairSnapshot().catch((e) => setStatus(e.message, true)));
$("#booth-screen").addEventListener("click", () =>
  startScreenShare({ spatial: spatialScreenOn(), keepDual: true }).catch((e) => setStatus(e.message, true)),
);
$("#booth-hexcast").addEventListener("click", () => startHexcastReceive().catch((e) => setStatus(e.message, true)));
$("#booth-combine")?.addEventListener("change", (ev) => {
  const v = ev.target.value || "spatial";
  dualCam.combine = v;
  if (v === "spatial") {
    if (PARAMS.spatialDual) PARAMS.spatialDual.value = 1;
    dualCam.spatialLayer = true;
    const cb = $("#booth-spatialDual");
    if (cb) cb.checked = true;
    if (dualCam.mode === "dual" && FEEDS.iphone) {
      FEEDS.iphone.process = true;
      if (layerClouds.iphone) layerClouds.iphone.pts.visible = true;
    }
  }
  setStatus(statusSpatialTag(`Combine · ${v}`));
});

$("#booth-stop").addEventListener("click", stopCamera);
$("#booth-mirror").addEventListener("click", () => {
  state.mirror = !state.mirror;
  $("#booth-mirror").classList.toggle("booth-btn--on", state.mirror);
});
$("#booth-midi").addEventListener("click", () => connectMidi().catch((e) => setStatus(e.message, true)));
$("#booth-audio")?.addEventListener("click", () => connectAudio().catch((e) => setStatus(e.message, true)));
$("#booth-track")?.addEventListener("click", () => loadDefaultTrack().catch((e) => setStatus(e.message, true)));
$("#booth-track")?.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  $("#booth-track-file")?.click();
});
$("#booth-track-file")?.addEventListener("change", (ev) => {
  const file = ev.target.files?.[0];
  loadTrackFile(file).catch((e) => setStatus(e.message, true));
  ev.target.value = "";
});
$("#booth-shot").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = renderer.domElement.toDataURL("image/png");
  a.download = `gsplat-booth-T${state.tier}-${Date.now()}.png`;
  a.click();
});
$("#booth-close").addEventListener("click", () => {
  stopCamera();
  if (window.webkit?.messageHandlers?.aitoMac) {
    window.webkit.messageHandlers.aitoMac.postMessage({ type: "close" });
  } else {
    window.close();
  }
});

$("#booth-mirror").classList.add("booth-btn--on");
setStatus(`${TIERS[state.tier].label} — multi-source voxel sphere ready`);
refreshToolsPanel();
refreshDeviceSelect().catch(() => {});
// Live-update camera list when Continuity appears/disappears
navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  dualCam.listDevices({ requestPermission: false }).then(() => refreshDeviceSelect()).catch(() => {});
});

// Studio broadcast (Resolve menubar → Studio page)
$("#booth-studio")?.addEventListener("click", () => {
  bootVisionAnd(() =>
    launchStudioBroadcast(bootVideoId, { podcast: !bootCrowd, crowd: bootCrowd }),
  ).catch((e) => setStatus(e.message, true));
});
// Crowd / spire cam live spatial analysis (Makkah Live default)
$("#booth-crowd-spire")?.addEventListener("click", () => {
  bootVisionAnd(() =>
    launchStudioBroadcast(CROWD_SPIRE_YT_ID, {
      crowd: true,
      podcast: false,
      label: CROWD_SPIRE_LABEL,
    }),
  ).catch((e) => setStatus(e.message, true));
});
// Kaaba blueprint camera shortcuts (studio toolbar)
const bindKaabaToolbar = (id, camIndexOrMode) => {
  $(id)?.addEventListener("click", () => {
    if (PARAMS.kaabaEnable) {
      PARAMS.kaabaEnable.value = 1;
      onParamChanged("kaabaEnable", PARAMS.kaabaEnable, "kaaba");
    }
    if (typeof camIndexOrMode === "number") selectKaabaCam(camIndexOrMode);
    else {
      setMotionMode(camIndexOrMode);
      setStatus(`Kaaba · ${camIndexOrMode}`);
    }
  });
};
bindKaabaToolbar("#booth-kaaba-tawaf", 0);
bindKaabaToolbar("#booth-kaaba-fly", 1);
bindKaabaToolbar("#booth-kaaba-above", 2);
bindKaabaToolbar("#booth-kaaba-levels", "kaabaLevel");
bindKaabaToolbar("#booth-kaaba-towers", "kaabaTower");
bindKaabaToolbar("#booth-kaaba-green", 12);

if (bootStudio) {
  setStatus(
    bootCrowd
      ? "Studio boot · crowd spire · TF analysis · loading stream…"
      : "Studio boot · podcast table · loading broadcast…",
  );
  bootVisionAnd(() =>
    launchStudioBroadcast(bootVideoId, {
      podcast: !bootCrowd,
      crowd: bootCrowd,
      label: bootCrowd ? CROWD_SPIRE_LABEL : undefined,
    }),
  ).catch((e) => setStatus(e.message, true));
}
// Keyboard: Escape clears selection · S solos · L toggles sphere/stack
window.addEventListener("keydown", (ev) => {
  if (ev.target?.matches?.("input, textarea, select")) return;
  if (ev.key === "Escape") {
    selectionHub?.clear();
    setStatus("Select cleared");
  } else if (ev.key === "s" || ev.key === "S") {
    selectionHub?.soloSelected();
    document.querySelectorAll(".booth-feed-head input[type=checkbox]").forEach((c) => {
      const id = c.dataset.feed;
      if (id && FEEDS[id] && !c.disabled) {
        c.checked = FEEDS[id].process;
        if (layerClouds[id]) layerClouds[id].pts.visible = FEEDS[id].process;
      }
    });
    refreshCompositeVisibility();
  } else if (ev.key === "l" || ev.key === "L") {
    if (!PARAMS.voxelLayout) return;
    PARAMS.voxelLayout.value = PARAMS.voxelLayout.value >= 0.5 ? 0 : 1;
    voxelStack?.setLayout(PARAMS.voxelLayout.value >= 0.5 ? "sphere" : "stack");
    if (PARAMS.voxelLayout.input) PARAMS.voxelLayout.input.value = String(PARAMS.voxelLayout.value);
    if (PARAMS.voxelLayout.output) {
      PARAMS.voxelLayout.output.textContent = formatParam("voxelLayout", PARAMS.voxelLayout.value);
    }
    setStatus(`Layout · ${PARAMS.voxelLayout.value >= 0.5 ? "sphere" : "stack"}`);
  }
});
// Expose for native bridge / debugging / aito living-canvas bridge
window.aitoBoothCameras = dualCam;
window.aitoBoothLive = liveFeeds;
window.aitoBoothSelect = selectionHub;
window.aitoBoothHand = handCtrl;
window.aitoBoothDepth = {
  modes: DEPTH_MODES,
  resolve: () => resolveDepthMode(PARAMS),
  /** Dense monocular depth field (Float32Array w*h) from last pass. */
  getDepthField: () => state._zipDepthField || state._depthField || null,
  /** Structured spatial point cloud from depth unproject (positions/colors/depths/uvs). */
  getPointCloud: () => state.spatialDepthCloud || null,
  getCount: () => state.spatialDepthCloud?.count ?? state.layerCounts?.depth ?? 0,
  /** ASCII PLY string of current depth spatial cloud. */
  toPly: () => {
    const c = state.spatialDepthCloud;
    return c ? spatialCloudToPly(c) : null;
  },
  /** JSON snapshot (optionally subsampled). */
  toJson: (opts) => {
    const c = state.spatialDepthCloud;
    return c ? spatialCloudToJson(c, opts) : null;
  },
  /** Trigger browser download of depth cloud as .ply */
  downloadPly: (filename = "aito-depth-cloud.ply") => {
    const ply = window.aitoBoothDepth.toPly();
    if (!ply) return false;
    const blob = new Blob([ply], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  },
  /** Enable/disable depth spatial layer. */
  setEnabled: (on) => {
    if (PARAMS.depthCloud) PARAMS.depthCloud.value = on ? 1 : 0;
    if (FEEDS.depth) FEEDS.depth.process = !!on;
    if (layerClouds.depth) layerClouds.depth.pts.visible = !!on;
    syncFeedProcessUi();
  },
  isEnabled: () => (PARAMS.depthCloud?.value ?? 1) >= 0.5 && !!FEEDS.depth?.process,
};
liveFeeds.mount($("#booth-live-host"));
requestAnimationFrame(tick);

// —— Boot wizard ——
const bootState = {
  pathId: "webcam",
  perf: "balanced",
  specs: null,
  aiCal: true,
};

function dismissBootOverlay() {
  state.bootReady = true;
  const el = $("#booth-boot");
  if (!el) return;
  el.classList.add("booth-boot--done");
  setTimeout(() => el.remove(), 500);
}

function showBootWizard() {
  let el = $("#booth-boot");
  if (!el) {
    // re-create minimal shell if removed
    el = document.createElement("div");
    el.id = "booth-boot";
    el.className = "booth-boot";
    el.innerHTML = `<div class="booth-boot-wizard"><p class="boot-muted" style="padding:1rem">Reload page for full wizard.</p>
      <button type="button" class="booth-btn" id="boot-skip">Continue</button></div>`;
    $("#booth-root")?.appendChild(el);
    $("#boot-skip")?.addEventListener("click", dismissBootOverlay);
    return;
  }
  el.classList.remove("booth-boot--done");
  el.hidden = false;
  el.style.display = "";
  initBootWizardUi();
}

function initBootWizardUi() {
  const list = $("#boot-path-list");
  if (list && !list.dataset.built) {
    list.dataset.built = "1";
    list.innerHTML = BOOT_PATHS.map(
      (p) => `<button type="button" class="boot-path-btn${p.id === bootState.pathId ? " is-active" : ""}" data-path="${p.id}">
        <strong>${p.icon} ${p.label}</strong>
        <span>${p.desc}</span>
      </button>`,
    ).join("");
    list.querySelectorAll(".boot-path-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        bootState.pathId = btn.dataset.path;
        list.querySelectorAll(".boot-path-btn").forEach((b) =>
          b.classList.toggle("is-active", b.dataset.path === bootState.pathId),
        );
      });
    });
  }

  document.querySelectorAll(".boot-perf").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.perf === bootState.perf);
    btn.onclick = () => {
      bootState.perf = btn.dataset.perf || "balanced";
      document.querySelectorAll(".boot-perf").forEach((b) =>
        b.classList.toggle("is-active", b.dataset.perf === bootState.perf),
      );
      applyPerfPreset(PARAMS, bootState.perf);
      setStatus(`Perf · ${bootState.perf}`);
    };
  });

  $("#boot-probe")?.addEventListener("click", () => runBootProbe(), { once: false });
  $("#boot-refresh-devs")?.addEventListener("click", () => refreshBootDevices());
  $("#boot-skip")?.addEventListener("click", () => {
    applyPerfPreset(PARAMS, bootState.perf);
    dismissBootOverlay();
    setStatus("Setup skipped · blank canvas");
  });
  $("#boot-cancel")?.addEventListener("click", () => {
    applyPerfPreset(PARAMS, bootState.perf);
    dismissBootOverlay();
    setStatus("Blank canvas");
  });
  $("#boot-launch")?.addEventListener("click", () => launchBootPath());

  // Auto-probe once
  if (!bootState.specs) runBootProbe();
  refreshBootDevices();
}

async function runBootProbe() {
  const host = $("#boot-specs");
  if (host) host.innerHTML = `<p class="boot-muted">Probing…</p>`;
  try {
    bootState.specs = await probeMachineSpecs();
    if (host) host.innerHTML = formatSpecsHtml(bootState.specs);
    // Suggest perf from score
    if (bootState.specs.recommendation) {
      bootState.perf = bootState.specs.recommendation === "high"
        ? "high"
        : bootState.specs.recommendation === "lite"
          ? "lite"
          : "balanced";
      document.querySelectorAll(".boot-perf").forEach((b) =>
        b.classList.toggle("is-active", b.dataset.perf === bootState.perf),
      );
      applyPerfPreset(PARAMS, bootState.perf);
    }
    const foot = $("#booth-footer-msg");
    if (foot && bootState.specs) {
      foot.textContent = `${bootState.specs.cores}c · ${bootState.specs.memoryGb ?? "?"}GB · ${bootState.perf} · GPU ${String(bootState.specs.gpu).slice(0, 28)}`;
    }
    setStatus(`Probe · ${bootState.perf} · score ${bootState.specs.score}`);
  } catch (e) {
    if (host) host.innerHTML = `<p class="boot-muted">Probe failed: ${errMessage(e)}</p>`;
  }
}

async function refreshBootDevices() {
  const sel = $("#boot-device-select");
  if (!sel) return;
  try {
    await dualCam.listDevices({ requestPermission: false });
  } catch {
    try {
      await dualCam.listDevices({ requestPermission: true });
    } catch (e) {
      sel.innerHTML = `<option value="">${errMessage(e)}</option>`;
      return;
    }
  }
  const linked = deviceLinks.mergeWithLive(dualCam.devices);
  sel.innerHTML = '<option value="">— none / use path default —</option>';
  if (linked.length) {
    const og = document.createElement("optgroup");
    og.label = "Linked";
    for (const d of linked) {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = `${d.online ? "●" : "○"} ${d.label}`;
      o.disabled = !d.online;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  const og = document.createElement("optgroup");
  og.label = "Live";
  for (const d of dualCam.devices) {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label;
    og.appendChild(o);
  }
  sel.appendChild(og);
}

async function launchBootPath() {
  const path = BOOT_PATHS.find((p) => p.id === bootState.pathId) || BOOT_PATHS[0];
  const aiCal = $("#boot-ai-cal")?.checked !== false;
  const linkDev = $("#boot-link-device")?.checked;
  const deviceId = $("#boot-device-select")?.value || "";
  const liveUrl = ($("#boot-live-url")?.value || "").trim();
  bootState.aiCal = aiCal;

  applyPerfPreset(PARAMS, bootState.perf);
  if (path.tier && path.tier !== state.tier) {
    try {
      await setTier(path.tier);
    } catch {
      /* */
    }
  }

  if (linkDev && deviceId) {
    const dev = dualCam.devices.find((d) => d.deviceId === deviceId);
    if (dev) {
      deviceLinks.link({
        deviceId: dev.deviceId,
        label: dev.label,
        kind: dev.kind,
        role: path.id === "dual" ? "dual" : "desktop",
      });
    }
  }

  dismissBootOverlay();
  setStatus(`Launch · ${path.label}…`);

  try {
    if (deviceId && path.action !== "studio" && path.action !== "blank") {
      await bootVisionAnd(() => startDeviceById(deviceId));
    } else {
      switch (path.action) {
        case "desktop":
          await bootVisionAnd(startCamera);
          break;
        case "dual":
          await bootVisionAnd(startDualStackScene);
          break;
        case "studio":
          await bootVisionAnd(() => launchStudioBroadcast(bootVideoId));
          break;
        case "live":
          await bootVisionAnd(async () => {
            if (liveUrl) {
              const ta = document.querySelector(".lvr-paste");
              if (ta) ta.value = liveUrl;
              liveFeeds.addFromPaste?.();
            }
            await focusLiveFeeds();
          });
          break;
        case "screen":
          await startScreenShare({ spatial: true, keepDual: true });
          break;
        case "blank":
        default:
          setStatus("Blank canvas · ready");
          break;
      }
    }

    // Optional live URL on non-live paths → add to rail
    if (liveUrl && path.action !== "live") {
      const ta = document.querySelector(".lvr-paste");
      if (ta) {
        ta.value = liveUrl;
        liveFeeds.addFromPaste?.();
      }
    }

    if (aiCal && path.action !== "blank") {
      setTimeout(() => {
        const r = runAutoCalibrate(true);
        if (r) {
          autoCal.enabled = true;
          setStatus(`AI cal · ${r.label || r.class} · ${path.label}`);
          const foot = $("#booth-footer-msg");
          if (foot) foot.textContent = `AI cal · ${r.label || r.class} · ${path.label}`;
        }
      }, 1200);
    }
  } catch (e) {
    setStatus(`Launch failed: ${errMessage(e)}`, true);
  }
}

// Wire wizard + footer
initBootWizardUi();
$("#booth-footer-wizard")?.addEventListener("click", showBootWizard);
$("#booth-reopen-wizard")?.addEventListener("click", showBootWizard);
$("#booth-autocal-studio")?.addEventListener("click", () => {
  applyPodcastTablePreset(PARAMS);
  const r = runAutoCalibrate(true, {
    forceClass: "podcast_table",
    studioPodcast: true,
    hasScreen: true,
  });
  if (r) {
    autoCal.enabled = true;
    setStatus(`AI link cal · ${r.label || r.class} · podcast table`);
  }
});

// Query ?setup=0 skips wizard; ?studio=1 still forces studio after
const skipWizard = bootParams.get("setup") === "0" || bootParams.get("nowizard") === "1";
if (skipWizard) {
  dismissBootOverlay();
} else if (bootStudio) {
  // studio URL: still show brief wizard only if setup=1
  if (bootParams.get("setup") === "1") {
    /* keep wizard */
  } else {
    dismissBootOverlay();
  }
}