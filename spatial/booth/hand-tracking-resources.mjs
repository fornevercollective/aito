/**
 * Hand tracking + spatial stack resources (Jul 2026 refresh).
 * Catalog for booth Live IK · MediaPipe and offline bake paths.
 * Sources: user-curated X / GitHub links for aito iteration.
 */

export const MEDIAPIPE = {
  tasksVision: "0.10.35",
  cdnEsm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm",
  cdnWasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
  models: {
    face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    pose: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    selfie: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
    /** Full-range face detect — small / distant faces (DBFace-class use) */
    faceDetectFull:
      "https://storage.googleapis.com/mediapipe-models/face_detector/face_detection_full_range/float16/1/face_detection_full_range.tflite",
    faceDetectShort:
      "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
  },
  landmarks: {
    wrist: 0,
    thumbTip: 4,
    indexMcp: 5,
    indexTip: 8,
    middleTip: 12,
    ringTip: 16,
    pinkyTip: 20,
  },
};

/** @typedef {{ id: string, title: string, tags: string[], x?: string, github?: string, demo?: string, paper?: string, note: string, forAito: string }} HandResource */

/** @type {HandResource[]} */
export const HAND_TRACKING_RESOURCES = [
  {
    id: "dbface",
    title: "DBFace · real-time small-face detector",
    tags: ["face", "crowd", "small-target", "detection"],
    github: "https://github.com/daitomanabe/DBFace",
    note: "Single-stage face detector strong on WiderFace hard (small faces). Multi-scale inference inspiration for booth crowd tiles.",
    forAito:
      "Crowd multi-scale tiles + FaceDetector seeds → body ellipses when selfie-seg misses spire-scale people.",
  },
  {
    id: "tf-body-seg",
    title: "TF Body Segmentation (Selfie + BlazePose)",
    tags: ["segmentation", "body", "tensorflow", "mediapipe"],
    github: "https://blog.tensorflow.org/2022/01/body-segmentation.html",
    note: "MediaPipe Selfie Segmentation + BlazePose GHUM; BodyPix multi-person path via @tensorflow-models/body-segmentation.",
    forAito:
      "Base selfie segmenter + optional BodyPix multi-person fuse for dense layers.",
  },
  {
    id: "interhand",
    title: "InterHand2.6M · interacting hands",
    tags: ["hand", "3d", "dataset"],
    github: "https://github.com/facebookresearch/InterHand2.6M",
    note: "Large interacting-hands dataset / 3D reconstruction research. Not live in-browser; guides hand density boosts.",
    forAito:
      "Hand/pose micro-boost on person conf when TrackHub finds hands near small bodies.",
  },
  {
    id: "deeplabcut",
    title: "DeepLabCut · multi-animal pose",
    tags: ["pose", "tracking", "multi-animal", "temporal"],
    github: "https://github.com/DeepLabCut/DeepLabCut",
    note: "Markerless pose for multi-animal; temporal + multi-target tracking patterns.",
    forAito:
      "Motion residual mask + temporal EMA on person conf for many moving targets.",
  },
  {
    id: "skalskip92",
    title: "SkalskiP · supervision / trackers / CV",
    tags: ["tracking", "mediapipe", "vision", "open-source"],
    x: "https://x.com/skalskip92",
    github: "https://github.com/SkalskiP?tab=repositories",
    note: "Roboflow open-source lead. supervision (MediaPipe face/pose visualizers), trackers (SORT/DeepSORT), CV paper lists, YOLO live demos.",
    forAito:
      "Offline multi-object track identity; annotate isolation layers; supervision-style landmark overlays for booth debug HUD.",
  },
  {
    id: "roboflow-supervision",
    title: "roboflow/supervision",
    tags: ["tracking", "mediapipe", "python"],
    github: "https://github.com/roboflow/supervision",
    note: "Reusable CV toolkit; MediaPipe keypoint visualizers for face/body.",
    forAito: "Python sidecar visualization / batch mask QC alongside jax-sidecar / zipdepth-sidecar.",
  },
  {
    id: "roboflow-trackers",
    title: "roboflow/trackers",
    tags: ["tracking", "multi-person"],
    github: "https://github.com/roboflow/trackers",
    note: "Modular multi-object trackers (Apache-2.0) combinable with any detector.",
    forAito: "Stable person IDs across dual-cam frames when maxPeople > 1.",
  },
  {
    id: "measure-plan",
    title: "measure_plan · webcam MediaPipe + Three.js",
    tags: ["hand", "mediapipe", "threejs", "gesture", "webcam"],
    x: "https://x.com/measure_plan",
    demo: "https://www.funwithcomputervision.com/",
    note: "CV/games/music experiments: hand-controlled globe, SSGI, voxel toys — laptop webcam + MediaPipe gesture controls; 35+ open demos.",
    forAito:
      "Gesture vocabulary (open/fist/pinch/point) → depth/wave/spin; webcam-first UX; Three.js interaction patterns for booth camera orbit.",
  },
  {
    id: "leap-ziyangwen",
    title: "Wenzy · Leap Motion gesture (Unity)",
    tags: ["hand", "leap", "gesture", "unity"],
    x: "https://x.com/ziyangwen/status/2072267289299444137",
    note: "Leap Motion gesture experiment — low-light robust hardware tracking. Community notes: commercial Leap still preferred vs pure MediaPipe for some installs.",
    forAito:
      "Optional hardware path later; soft-target mapping from high-quality finger tips → same HandController bus as MediaPipe.",
  },
  {
    id: "splatline-v2",
    title: "Splatline v2 · video → 3D Gaussians",
    tags: ["splat", "depth", "offline", "human"],
    x: "https://x.com/jaskirat/status/2075088628133634208",
    github: "https://github.com/jaskirat1616/Splatline",
    note: "v2 backends: VGGT, DepthSplat, LongSplat + SHARP/TripoSplat; MotionBERT / HMR human tiers; SuperSplat Electron player.",
    forAito:
      "Offline bake only (:8787). Live loop stays MediaPipe IK. Import splat/PLY into booth after Splatline job.",
  },
  {
    id: "image-to-mesh",
    title: "Image_to_Mesh_web · single-image depth mesh",
    tags: ["depth", "mesh", "webgpu", "browser"],
    x: "https://x.com/odatomo/status/2075213983062388885",
    github: "https://github.com/tomosud/Image_to_Mesh_web/",
    demo: "https://tomosud.github.io/Image_to_Mesh_web/",
    note: "MoGe-2 in-browser mesh; poly reduction + edge smooth; MIT; model size ~1/10 prior.",
    forAito:
      "Still-frame depth mesh reference for studio/table scenes; export EXR/GLB into gsplat stack; lighter than full Splatline.",
  },
  {
    id: "cells2pixels",
    title: "Cells2Pixels · Neural CA × local neural fields",
    tags: ["texture", "nca", "siggraph", "web"],
    x: "https://x.com/Esychology/status/2075259224255349234",
    demo: "https://cells2pixels.github.io/",
    paper: "https://arxiv.org/abs/2506.22899",
    github: "https://github.com/TheDevilWillBeBee/Cells2Pixels",
    note: "SIGGRAPH 2026: NCA cells as local neural fields (~8× res) on-device demos.",
    forAito:
      "Living surface textures on isolation layers / glass; hand waveMod drives NCA step rate later.",
  },
  {
    id: "dbr-xr",
    title: "DEATHBYROMY XR · 4D Gaussian Splatting MV",
    tags: ["splat", "4dgs", "xr", "music"],
    x: "https://x.com/tokufxug/status/2075396232718254372",
    demo: "https://prism-ai.io/dbr-xr",
    note: "75× 8K capture → 4DGS music video; XR + web simultaneous output (Prism AI).",
    forAito:
      "Target quality bar for multi-view / music-driven splat stages; waveform bus already hand-linked.",
  },
  {
    id: "threejs-wc26",
    title: "Three.js · WC26 match terrain viz",
    tags: ["threejs", "viz", "webgl"],
    x: "https://x.com/threejs/status/2074815904584773690",
    demo: "https://wc26.bogachev.fr/",
    note: "Interactive pressure/terrain visualization of a football match (bogachev_al).",
    forAito:
      "Heightfield / pressure-field metaphor for dual-person occupancy masks and interaction heat.",
  },
  {
    id: "mirelo",
    title: "MireloAI · sound from visuals",
    tags: ["audio", "music", "sfx"],
    x: "https://x.com/MireloAI",
    demo: "https://mirelo.ai/",
    note: "Context-aware SFX + music generated from video frames.",
    forAito:
      "Optional audio gen path from booth capture; complements hand → musicBus energy/ping already in HandController.",
  },
];

export const RESOURCE_TAGS = [
  "hand",
  "mediapipe",
  "tracking",
  "depth",
  "splat",
  "mesh",
  "audio",
  "threejs",
  "gesture",
];

/**
 * Mount a compact resources list into a host element.
 * @param {HTMLElement | null} host
 * @param {{ filter?: string[] }} [opts]
 */
export function mountHandResources(host, opts = {}) {
  if (!host) return;
  const filter = opts.filter?.length ? new Set(opts.filter) : null;
  const items = filter
    ? HAND_TRACKING_RESOURCES.filter((r) => r.tags.some((t) => filter.has(t)))
    : HAND_TRACKING_RESOURCES;

  host.innerHTML = "";
  host.classList.add("booth-resources");

  const intro = document.createElement("p");
  intro.className = "booth-motion-desc";
  intro.innerHTML =
    `MediaPipe <strong>@${MEDIAPIPE.tasksVision}</strong> · live IK on-device. ` +
    `Splatline / 4DGS / mesh tools stay <em>offline bake</em> or reference.`;
  host.appendChild(intro);

  const list = document.createElement("ul");
  list.className = "booth-resource-list";
  for (const r of items) {
    const li = document.createElement("li");
    li.className = "booth-resource-item";
    li.dataset.resourceId = r.id;

    const title = document.createElement("div");
    title.className = "booth-resource-title";
    title.textContent = r.title;

    const tags = document.createElement("div");
    tags.className = "booth-resource-tags";
    tags.textContent = r.tags.join(" · ");

    const note = document.createElement("p");
    note.className = "booth-resource-note";
    note.textContent = r.forAito;

    const links = document.createElement("div");
    links.className = "booth-resource-links";
    const add = (label, href) => {
      if (!href) return;
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "booth-resource-link";
      a.textContent = label;
      links.appendChild(a);
    };
    add("X", r.x);
    add("GitHub", r.github);
    add("Demo", r.demo);
    add("Paper", r.paper);

    li.append(title, tags, note, links);
    list.appendChild(li);
  }
  host.appendChild(list);
}

/** Lookup by id */
export function getResource(id) {
  return HAND_TRACKING_RESOURCES.find((r) => r.id === id) || null;
}
