/**
 * Studio broadcast mode — LiDAR-style spatial recreation from a reference
 * screen (YouTube / live feed) with people at depth, voxel columns, skew,
 * movement trails, and strong audio→waveform reaction.
 */

import * as THREE from "three";
import { DEPTH_MODES } from "./booth-depth.mjs";

const DEPTH_NESTED = Math.max(
  0,
  DEPTH_MODES.findIndex((m) => m.id === "nested"),
);

/** Live test default: Bloomberg Businessweek Daily desk (podcast table) */
export const STUDIO_YT = "https://www.youtube.com/watch?v=KllEQhJ76Mk";
export const STUDIO_YT_ID = "KllEQhJ76Mk";

export const STUDIO_PARAMS = {
  studioMode: { min: 0, max: 1, step: 1, value: 1, label: "Studio broadcast", group: "studio" },
  studioSkewX: { min: -0.8, max: 0.8, step: 0.02, value: 0.12, label: "Skew X", group: "studio" },
  studioSkewY: { min: -0.8, max: 0.8, step: 0.02, value: -0.06, label: "Skew Y", group: "studio" },
  studioPerspective: { min: 0, max: 1.5, step: 0.02, value: 0.55, label: "Perspective", group: "studio" },
  studioPeopleDepth: { min: 0.4, max: 4, step: 0.05, value: 1.85, label: "People depth", group: "studio" },
  studioPeopleScale: { min: 0.3, max: 2.2, step: 0.05, value: 1.05, label: "People scale", group: "studio" },
  studioScreenDist: { min: 0.5, max: 4, step: 0.05, value: 2.4, label: "Ref screen Z", group: "studio" },
  studioColumns: { min: 0, max: 1, step: 1, value: 1, label: "Voxel columns", group: "studio" },
  studioColCount: { min: 3, max: 24, step: 1, value: 9, label: "Column count", group: "studio" },
  studioColHeight: { min: 0.4, max: 3, step: 0.05, value: 1.55, label: "Column height", group: "studio" },
  studioLidar: { min: 0, max: 1, step: 1, value: 1, label: "LiDAR scan", group: "studio" },
  studioLidarRate: { min: 0.2, max: 4, step: 0.05, value: 1.2, label: "LiDAR rate", group: "studio" },
  studioTrails: { min: 0, max: 1, step: 1, value: 1, label: "Motion paths", group: "studio" },
  studioTrailLen: { min: 4, max: 48, step: 1, value: 18, label: "Path length", group: "studio" },
  studioWaveGain: { min: 0.5, max: 4, step: 0.05, value: 2.2, label: "Waveform gain", group: "studio" },
  studioWaveBass: { min: 0, max: 3, step: 0.05, value: 1.6, label: "Wave bass", group: "studio" },
  studioWaveMid: { min: 0, max: 3, step: 0.05, value: 1.35, label: "Wave mid", group: "studio" },
  studioWaveHigh: { min: 0, max: 3, step: 0.05, value: 1.8, label: "Wave high", group: "studio" },
  studioCluster: { min: 0.2, max: 2, step: 0.05, value: 0.75, label: "Cluster tight", group: "studio" },
  studioIk: { min: 0, max: 1, step: 1, value: 1, label: "IK columns", group: "studio" },
};

function setParam(params, k, v) {
  if (!params[k]) return;
  params[k].value = Math.max(params[k].min, Math.min(params[k].max, v));
  delete params[k]._handBase;
  if (typeof window.syncParamUi === "function") {
    window.syncParamUi(k, params[k]);
  } else if (params[k].input) {
    if (params[k].input.type === "checkbox") {
      params[k].input.checked = params[k].value >= 0.5;
    } else {
      params[k].input.value = String(params[k].value);
    }
    if (params[k].output && typeof window.formatParam === "function") {
      params[k].output.textContent = window.formatParam(k, params[k].value);
    }
  }
}

/** Apply studio broadcast defaults into PARAMS for desk-away-from-screen look. */
export function applyStudioPreset(params) {
  const set = (k, v) => setParam(params, k, v);
  set("studioMode", 1);
  set("spatialScreen", 1);
  set("spatialDual", 0);
  set("stackEnable", 1);
  set("stackScreenDist", 2.4);
  set("stackContentDepth", 1.15);
  set("stackPeopleDepth", 1.85);
  set("depth", 2.05);
  set("zSpread", 2.15);
  set("depthMode", DEPTH_NESTED); // nested
  set("depthVariation", 0.75);
  set("depthWaveform", 1.15);
  set("musicalGain", 1.65);
  set("bassDrive", 1.55);
  set("midDrive", 1.15);
  set("highDrive", 1.35);
  set("audioGain", 1.85);
  set("splatRipple", 0.65);
  set("musicDepth", 0.85);
  set("layerPulse", 0.55);
  set("sphereNest", 0.32);
  set("sphereBlend", 0.42);
  set("voxelSep", 0.72);
  set("stride", 2);
  set("glow", 1.15);
  set("size", 0.016);
  set("mask", 0.35);
  set("studioWaveGain", 2.4);
  set("studioWaveBass", 1.7);
  set("studioPeopleDepth", 1.9);
  set("studioScreenDist", 2.45);
  set("studioSkewX", 0.14);
  set("studioSkewY", -0.08);
  set("studioColumns", 1);
  set("studioLidar", 1);
  set("studioTrails", 1);
  set("studioIk", 1);
}

/**
 * Podcast / news-desk table: hosts seated mid-frame, ref screen as far wall,
 * tighter cluster, lower people plane, stronger table-depth separation.
 * Tuned for Bloomberg Businessweek Daily–style multi-host table.
 */
export function applyPodcastTablePreset(params) {
  applyStudioPreset(params);
  const set = (k, v) => setParam(params, k, v);
  set("studioMode", 1);
  set("spatialScreen", 1);
  set("stackEnable", 1);
  // Table sits in room; screen/set is backdrop
  set("studioScreenDist", 2.85);
  set("stackScreenDist", 2.85);
  set("studioPeopleDepth", 1.35);
  set("stackPeopleDepth", 1.35);
  set("studioPeopleScale", 0.95);
  set("studioCluster", 1.05);
  set("studioPerspective", 0.48);
  set("studioSkewX", 0.06);
  set("studioSkewY", -0.04);
  set("stackContentDepth", 0.85);
  set("depth", 1.75);
  set("zSpread", 1.55);
  set("depthMode", DEPTH_NESTED);
  set("depthVariation", 0.55);
  set("depthWaveform", 0.95);
  set("sphereNest", 0.22);
  set("sphereBlend", 0.58);
  set("voxelSep", 0.55);
  set("stride", 2);
  set("size", 0.015);
  set("glow", 0.95);
  set("mask", 0.42);
  set("feather", 0.14);
  set("studioColCount", 7);
  set("studioColHeight", 1.15);
  set("studioColumns", 1);
  set("studioLidar", 1);
  set("studioTrails", 1);
  set("studioWaveGain", 2.0);
  set("studioWaveBass", 1.35);
  set("studioWaveMid", 1.55);
  set("studioWaveHigh", 1.45);
  set("musicalGain", 1.35);
  set("audioGain", 1.55);
  set("maxPeople", 4);
  // People cloud readability above floor video
  set("size", 0.028);
  set("glow", 1.2);
  set("mask", 0.32);
  set("feather", 0.18);
  set("stride", 2);
  set("liveFloor", 1);
  set("liveFloorOpacity", 0.88);
  set("liveFloat", 0);
  set("liveFloorY", -0.62);
}

/**
 * Elevated multi-cam crowd (spire / plaza / Kaaba-style live):
 * dense person isolation, strong voxel waveform lift, circular flow readable
 * from high camera angles. Pair with spatial analysis + TF predict.
 */
export function applyCrowdSpirePreset(params) {
  applyStudioPreset(params);
  const set = (k, v) => setParam(params, k, v);
  set("studioMode", 1);
  set("spatialScreen", 1);
  set("spatialDual", 0);
  set("stackEnable", 1);
  // High camera → flatter people plane, deeper plaza
  set("studioScreenDist", 2.55);
  set("stackScreenDist", 2.55);
  set("studioPeopleDepth", 1.65);
  set("stackPeopleDepth", 1.65);
  set("studioPeopleScale", 0.72);
  set("studioCluster", 1.35);
  set("studioPerspective", 0.72);
  set("studioSkewX", 0.02);
  set("studioSkewY", -0.12);
  set("stackContentDepth", 1.05);
  set("depth", 2.25);
  set("zSpread", 2.35);
  set("depthMode", DEPTH_NESTED); // nested parallax
  set("depthVariation", 0.95);
  set("depthWaveform", 1.45);
  set("sphereNest", 0.38);
  set("sphereBlend", 0.48);
  set("sphereParallax", 0.95);
  set("voxelSep", 0.42);
  set("voxelLayout", 1); // sphere
  set("stride", 2);
  set("size", 0.022);
  set("glow", 1.35);
  set("mask", 0.24);
  set("feather", 0.22);
  // Crowd multi-scale seg (DBFace tiles · face seeds · motion)
  set("crowdSegEnable", 1);
  set("crowdFaceSeed", 1);
  set("crowdMotion", 1);
  set("crowdTiles", 1);
  set("crowdTemporal", 0.5);
  set("crowdFaceScale", 3.6);
  set("crowdMinBlob", 0.14);
  set("crowdMotionGain", 1.05);
  // Edge separation is primary crowd silhouette layer
  set("edgeThr", 0.11);
  set("edgeRgbMix", 0.48);
  set("edgeCrowdBoost", 1.35);
  set("edgeDepth", 0.85);
  set("edgeThin", 0.4);
  set("edgeMultiScale", 1);
  if (params.edge || true) {
    /* FEEDS.edge toggled in launch */
  }
  set("studioColCount", 14);
  set("studioColHeight", 0.85);
  set("studioColumns", 1);
  set("studioLidar", 1);
  set("studioLidarRate", 1.8);
  set("studioTrails", 1);
  set("studioTrailLen", 28);
  set("studioWaveGain", 2.6);
  set("studioWaveBass", 1.5);
  set("studioWaveMid", 1.7);
  set("studioWaveHigh", 1.9);
  set("musicalGain", 1.55);
  set("audioGain", 1.75);
  set("musicDepth", 1.05);
  set("splatRipple", 0.75);
  set("maxPeople", 4);
  set("liveFloor", 1);
  set("liveFloorOpacity", 0.78);
  set("liveFloat", 1);
  set("liveFloatOpacity", 0.32);
  set("liveFloorY", -0.68);
  // Analysis defaults (if module params merged)
  set("analysisEnable", 1);
  set("analysisPredict", 1);
  set("analysisWaveLift", 1.45);
  set("analysisHorizon", 12);
  set("analysisTrain", 1);
  // Kaaba / Haram blueprint (desk-stack equivalent)
  set("kaabaEnable", 1);
  set("kaabaRings", 1);
  set("kaabaLevels", 1);
  set("kaabaGates", 1);
  set("kaabaTowers", 1);
  set("kaabaLanterns", 1);
  set("kaabaCams", 1);
  set("kaabaFlow", 1);
  set("kaabaScale", 1);
  set("stackEnable", 0);
}

/**
 * Perspective + skew for screen-plane samples → world (reference screen).
 * People clusters float *above* the live floor video (liveFloorY), toward camera.
 */
export function studioProject(nx, ny, depth01, params, role = "screen") {
  const skewX = params.studioSkewX?.value ?? 0.12;
  const skewY = params.studioSkewY?.value ?? -0.06;
  const persp = params.studioPerspective?.value ?? 0.55;
  const screenZ = params.studioScreenDist?.value ?? params.stackScreenDist?.value ?? 2.4;
  const peopleD = params.studioPeopleDepth?.value ?? 1.85;
  const peopleS = params.studioPeopleScale?.value ?? 1.05;
  const cluster = params.studioCluster?.value ?? 0.75;
  const floorY = params.liveFloorY?.value ?? -0.62;

  // Normalized image → plane
  let x = (nx - 0.5) * 2.2;
  let y = -(ny - 0.5) * 1.35;
  // Skew (trapezoid / camera roll relative to set)
  x += y * skewX;
  y += x * skewY * 0.5;
  // Mild perspective fan
  const fan = 1 + Math.abs(x) * persp * 0.15;
  x *= fan;
  y *= fan * (1 + persp * 0.05);

  let z = screenZ - depth01 * 0.35;
  let scale = 1;

  if (role === "person" || role === "cluster") {
    // Float above floor video: feet near floor+lift, heads map from image Y
    const lateral = (nx - 0.5) * cluster * 1.85;
    const lift = 0.22; // clear separation from floor plane
    const heightSpan = 1.25 * peopleS;
    // ny=1 is bottom of image → near floor; ny=0 top → higher
    const bodyY = floorY + lift + (1 - ny) * heightSpan;
    x = lateral + x * 0.12;
    y = bodyY;
    // Closer to camera than screen wall so they read as room occupants
    z = Math.max(0.15, screenZ - peopleD - depth01 * 0.45) + (0.5 - Math.abs(nx - 0.5)) * 0.15;
    scale = peopleS;
  } else if (role === "column") {
    z = screenZ - peopleD * 0.55 - depth01 * 0.3;
    y = floorY + 0.08 + Math.max(0, -y) * 0.3;
  } else if (role === "screen") {
    // Keep backdrop slightly above floor rear edge so it doesn't z-fight floor tex
    y = Math.max(y * 0.35, floorY + 0.05);
  }

  return { x: x * scale, y: role === "person" || role === "cluster" ? y : y * scale, z, scale };
}

/**
 * Three.js LiDAR / voxel-column / trail overlay for studio recreation.
 */
export class StudioSpatial {
  constructor(params) {
    this.params = params;
    this.group = new THREE.Group();
    this.group.name = "studio-spatial";
    this.columns = new THREE.Group();
    this.trails = new THREE.Group();
    this.lidar = null;
    this.scanRing = null;
    this.pathHistory = []; // {x,y,z,t}[]
    this.clusterCenters = [];
    this._built = false;
    this.time = 0;
    this.predictGroup = new THREE.Group();
    this.predictGroup.name = "analysis-predict";
    this._predictPts = null;
  }

  get enabled() {
    return (this.params.studioMode?.value ?? 0) >= 0.5;
  }

  attach(parent) {
    parent.add(this.group);
    this.group.add(this.columns);
    this.group.add(this.trails);
    this.group.add(this.predictGroup);
    this.rebuild();
  }

  rebuild() {
    while (this.columns.children.length) {
      const c = this.columns.children[0];
      this.columns.remove(c);
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    while (this.trails.children.length) {
      const c = this.trails.children[0];
      this.trails.remove(c);
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    if (this.scanRing) {
      this.group.remove(this.scanRing);
      this.scanRing.geometry?.dispose?.();
      this.scanRing.material?.dispose?.();
      this.scanRing = null;
    }
    if (this.lidar) {
      this.group.remove(this.lidar);
      this.lidar.geometry?.dispose?.();
      this.lidar.material?.dispose?.();
      this.lidar = null;
    }
    if (!this.enabled) {
      this._built = false;
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    // Voxel columns (IK-ish vertical stacks in the room)
    if ((this.params.studioColumns?.value ?? 1) >= 0.5) {
      const n = Math.round(this.params.studioColCount?.value ?? 9);
      const h = this.params.studioColHeight?.value ?? 1.55;
      const screenZ = this.params.studioScreenDist?.value ?? 2.4;
      const peopleD = this.params.studioPeopleDepth?.value ?? 1.85;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const x = (t - 0.5) * 3.2;
        const z = screenZ - peopleD * (0.55 + (i % 3) * 0.12);
        const col = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, h, 0.12),
          new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? 0x38bdf8 : 0xf97316,
            transparent: true,
            opacity: 0.22,
            depthWrite: false,
            wireframe: true,
          }),
        );
        col.position.set(x, h * 0.5 - 0.55, z);
        col.userData.baseY = col.position.y;
        col.userData.phase = i * 0.7;
        col.userData.idx = i;
        this.columns.add(col);

        // IK joint markers along column
        if ((this.params.studioIk?.value ?? 1) >= 0.5) {
          for (let j = 0; j < 4; j++) {
            const joint = new THREE.Mesh(
              new THREE.SphereGeometry(0.035, 8, 8),
              new THREE.MeshBasicMaterial({
                color: 0xfbbf24,
                transparent: true,
                opacity: 0.75,
              }),
            );
            joint.position.set(x, -0.45 + (j / 3) * h, z);
            joint.userData.col = i;
            joint.userData.joint = j;
            this.columns.add(joint);
          }
        }
      }
    }

    // LiDAR scan ring + radial lines
    if ((this.params.studioLidar?.value ?? 1) >= 0.5) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 0.95, 64),
        new THREE.MeshBasicMaterial({
          color: 0x22d3ee,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.52;
      this.scanRing = ring;
      this.group.add(ring);

      const pts = [];
      const colors = [];
      const N = 720;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const r = 0.4 + (i % 7) * 0.18;
        pts.push(Math.cos(a) * r, -0.5 + (i % 5) * 0.02, Math.sin(a) * r * 0.7);
        colors.push(0.15, 0.85, 0.95);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      this.lidar = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          size: 0.025,
          vertexColors: true,
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
        }),
      );
      this.group.add(this.lidar);
    }

    this._built = true;
  }

  /**
   * Update clusters from motion/person samples + audio drive.
   * @param {{x:number,y:number,z:number}[]} tips world-ish tips
   * @param {{bass:number,mid:number,high:number,beat:number}} audio
   * @param {number} dt
   */
  update(tips, audio, dt = 0.016) {
    if (!this.enabled) {
      this.group.visible = false;
      return;
    }
    if (!this._built) this.rebuild();
    this.group.visible = true;
    this.time += dt;
    const rate = this.params.studioLidarRate?.value ?? 1.2;
    const wave = this.params.studioWaveGain?.value ?? 2.2;
    const bass = (audio?.bass ?? 0) * (this.params.studioWaveBass?.value ?? 1.6) * wave;
    const mid = (audio?.mid ?? 0) * (this.params.studioWaveMid?.value ?? 1.35) * wave;
    const high = (audio?.high ?? 0) * (this.params.studioWaveHigh?.value ?? 1.8) * wave;
    const beat = (audio?.beat ?? 0) * wave;

    // Columns pulse with bass / IK sway
    for (const child of this.columns.children) {
      if (child.userData.phase == null && child.userData.joint == null) continue;
      if (child.userData.phase != null) {
        const ph = child.userData.phase;
        const pulse = 1 + bass * 0.18 + Math.sin(this.time * 3 + ph) * 0.04;
        child.scale.set(pulse, 1 + mid * 0.12, pulse);
        child.position.y = (child.userData.baseY ?? child.position.y) + bass * 0.08;
        child.rotation.y = Math.sin(this.time * 1.2 + ph) * 0.08 + high * 0.05;
        if (child.material?.opacity != null) {
          child.material.opacity = 0.18 + beat * 0.25 + high * 0.1;
        }
      }
      if (child.userData.joint != null) {
        const j = child.userData.joint;
        child.position.x += Math.sin(this.time * 2.5 + j + (child.userData.col || 0)) * bass * 0.01;
        child.scale.setScalar(1 + high * 0.35 + (j === 3 ? beat * 0.4 : 0));
      }
    }

    // LiDAR spin
    if (this.scanRing) {
      this.scanRing.rotation.z = this.time * rate;
      this.scanRing.scale.setScalar(1 + bass * 0.15 + beat * 0.1);
      if (this.scanRing.material) this.scanRing.material.opacity = 0.35 + mid * 0.4;
    }
    if (this.lidar) {
      this.lidar.rotation.y = this.time * rate * 0.35;
      const pos = this.lidar.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        const a = Math.atan2(arr[i + 2], arr[i]) + dt * rate;
        const r = Math.hypot(arr[i], arr[i + 2]) + Math.sin(this.time * 4 + i) * high * 0.01;
        arr[i] = Math.cos(a) * r;
        arr[i + 2] = Math.sin(a) * r;
        arr[i + 1] = -0.5 + ((i / 3) % 5) * 0.02 + bass * 0.05;
      }
      pos.needsUpdate = true;
      if (this.lidar.material) this.lidar.material.opacity = 0.45 + high * 0.4 + beat * 0.2;
    }

    // Movement paths
    if ((this.params.studioTrails?.value ?? 1) >= 0.5 && tips?.length) {
      const now = this.time;
      for (const t of tips) {
        this.pathHistory.push({ x: t.x, y: t.y, z: t.z, t: now });
      }
      const maxLen = Math.round(this.params.studioTrailLen?.value ?? 18) * Math.max(1, tips.length);
      if (this.pathHistory.length > maxLen * 4) {
        this.pathHistory.splice(0, this.pathHistory.length - maxLen * 3);
      }
      this._rebuildTrails();
    }
  }

  /**
   * Ghost markers for TF / heuristic predicted cluster positions (world space).
   * @param {{x:number,y:number,z:number,conf?:number}[]} pts
   */
  setPredictions(pts) {
    while (this.predictGroup.children.length) {
      const c = this.predictGroup.children[0];
      this.predictGroup.remove(c);
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    this._predictPts = pts || [];
    if (!this._predictPts.length || !this.enabled) {
      this.predictGroup.visible = false;
      return;
    }
    this.predictGroup.visible = true;
    const positions = [];
    const colors = [];
    for (const p of this._predictPts) {
      positions.push(p.x, p.y, p.z);
      const c = p.conf ?? 0.5;
      // cyan → magenta by confidence
      colors.push(0.2 + c * 0.6, 0.75 - c * 0.2, 0.95);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const cloud = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.055,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.predictGroup.add(cloud);

    // faint polyline through sequential predictions of same track
    if (this._predictPts.length >= 2) {
      const linePts = this._predictPts.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(linePts),
        new THREE.LineBasicMaterial({
          color: 0x22d3ee,
          transparent: true,
          opacity: 0.4,
        }),
      );
      this.predictGroup.add(line);
    }
  }

  _rebuildTrails() {
    while (this.trails.children.length) {
      const c = this.trails.children[0];
      this.trails.remove(c);
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    if (this.pathHistory.length < 2) return;
    const pts = this.pathHistory.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: 0xa78bfa,
        transparent: true,
        opacity: 0.55,
      }),
    );
    this.trails.add(line);
  }

  /**
   * Detect simple cluster centers from image mask mass (for person placement).
   * @param {Float32Array} conf person confidence w*h
   * @param {number} w
   * @param {number} h
   */
  detectClusters(conf, w, h, maxClusters = 5) {
    if (!conf?.length) {
      this.clusterCenters = [];
      return [];
    }
    // Crowd / dense: denser sample grid + lower conf thr + tighter NMS
    const dense = maxClusters >= 10;
    const step = dense ? 3 : 6;
    const thr = dense ? 0.28 : 0.45;
    const minDist = dense ? 0.055 : 0.12;
    const cells = [];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const v = conf[y * w + x];
        if (v > thr) cells.push({ x: x / w, y: y / h, v });
      }
    }
    if (!cells.length) {
      // Studio default: 3 standing positions across frame if no seg
      this.clusterCenters = [
        { nx: 0.25, ny: 0.55 },
        { nx: 0.5, ny: 0.52 },
        { nx: 0.75, ny: 0.55 },
      ];
      return this.clusterCenters;
    }
    // Greedy cluster
    const centers = [];
    const used = new Set();
    cells.sort((a, b) => b.v - a.v);
    const grid = dense ? 36 : 20;
    for (const c of cells) {
      if (centers.length >= maxClusters) break;
      const key = `${(c.x * grid) | 0},${(c.y * grid) | 0}`;
      if (used.has(key)) continue;
      let near = false;
      for (const ct of centers) {
        if (Math.hypot(ct.nx - c.x, ct.ny - c.y) < minDist) {
          near = true;
          break;
        }
      }
      if (near) continue;
      centers.push({ nx: c.x, ny: c.y, v: c.v });
      used.add(key);
    }
    this.clusterCenters = centers;
    return centers;
  }
}

/** Boost music bus sample for visible studio waveform. */
export function studioWaveformDrive(musicBus, params) {
  const g = params.studioWaveGain?.value ?? 2.2;
  const bass = Math.min(1, (musicBus.bass || 0) * (params.studioWaveBass?.value ?? 1.6) * g * 0.55);
  const mid = Math.min(1, (musicBus.mid || 0) * (params.studioWaveMid?.value ?? 1.35) * g * 0.5);
  const high = Math.min(1, (musicBus.high || 0) * (params.studioWaveHigh?.value ?? 1.8) * g * 0.55);
  const beat = Math.min(1, musicBus.drive(
    (params.musicalGain?.value ?? 1) * g * 0.45,
    params.bassDrive?.value ?? 1,
    params.midDrive?.value ?? 1,
  ));
  return { bass, mid, high, beat, energy: Math.min(1, (bass + mid + high) / 2.2) };
}
