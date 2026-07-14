/** Camera & cloud motion modes — turntable, dissolve, dolly, Kaaba cams. */

/** Indices into KAABA_CAM_PRESETS (booth-kaaba-blueprint.mjs) */
const KAABA_CAM_INDEX = {
  tawaf: 0,
  flythrough: 1,
  above: 2,
  level0: 3,
  level1: 4,
  level2: 5,
  level3: 6,
  tower_ne: 7,
  tower_se: 8,
  tower_sw: 9,
  tower_nw: 10,
  clock: 11,
  green_line: 12,
};

export const MOTION_MODES = [
  { id: "turntable", label: "Turntable", cat: "Cloud", impl: true, desc: "Y-axis orbit spin" },
  { id: "tumble", label: "Tumble", cat: "Cloud", impl: true, desc: "Multi-axis chaotic roll" },
  { id: "precession", label: "Precession", cat: "Cloud", impl: true, desc: "Spin + wobbling tilt axis" },
  { id: "pendulum", label: "Pendulum", cat: "Cloud", impl: true, desc: "Rock on X" },
  { id: "pulse", label: "Pulse", cat: "Cloud", impl: true, desc: "Beat breathe scale" },
  { id: "dissolve", label: "Dissolve", cat: "Cloud", impl: true, desc: "Radial outward drift" },
  { id: "depthWave", label: "Depth wave", cat: "Cloud", impl: true, desc: "Z shockwave rings" },
  { id: "layerDrift", label: "Layer drift", cat: "Cloud", impl: true, desc: "Voxel slices scroll Z" },
  { id: "helix", label: "Helix", cat: "Cloud", impl: true, desc: "Corkscrew forward" },
  { id: "beatBurst", label: "Beat burst", cat: "Cloud", impl: true, desc: "Kick radial explode" },
  { id: "parallax", label: "Parallax", cat: "Cloud", impl: true, desc: "Static cloud · drag view" },
  { id: "counterSpin", label: "Counter-spin", cat: "Cloud", impl: true, desc: "Layers spin opposite" },
  { id: "dolly", label: "Dolly", cat: "Camera", impl: true, desc: "Push in / pull out" },
  { id: "crane", label: "Crane", cat: "Camera", impl: true, desc: "Vertical bob" },
  { id: "flythrough", label: "Fly-through", cat: "Camera", impl: true, desc: "Dive through tunnel" },
  { id: "lissajous", label: "Lissajous", cat: "Camera", impl: true, desc: "Figure-8 orbit path" },
  { id: "coOrbit", label: "Co-orbit", cat: "Camera", impl: true, desc: "Camera follows spin" },
  { id: "trackAttract", label: "Track attract", cat: "Track", impl: true, desc: "Shards pull toward joints" },
  { id: "handGuided", label: "Hand guided", cat: "Track", impl: true, desc: "Hands drive depth · wave · camera" },
  { id: "faceLock", label: "Face lock", cat: "Track", impl: true, desc: "Pivot tracks face centroid" },
  { id: "sphereOrbit", label: "Sphere orbit", cat: "Cloud", impl: true, desc: "Orbit nested voxel sphere" },
  { id: "velocityTrails", label: "Vel trails", cat: "Splat", impl: false, desc: "Motion smear (soon)" },
  { id: "audioDolly", label: "Audio dolly", cat: "Music", impl: true, desc: "Bass pushes camera Z" },
  // Kaaba / Masjid al-Haram blueprint cams (spire live)
  { id: "tawafOrbit", label: "Tawaf orbit", cat: "Kaaba", impl: true, desc: "CCW Mataf pilgrim orbit" },
  { id: "kaabaFly", label: "Gate flythrough", cat: "Kaaba", impl: true, desc: "Abdulaziz gate → Mataf" },
  { id: "kaabaAbove", label: "Above approach", cat: "Kaaba", impl: true, desc: "High crane onto courtyard" },
  { id: "kaabaLevel", label: "Level rings", cat: "Kaaba", impl: true, desc: "Multi-tier elevated bridges" },
  { id: "kaabaTower", label: "Tower cams", cat: "Kaaba", impl: true, desc: "Minarets · clock tower views" },
];

export const MOTION_PARAMS = {
  motionSpeed: { min: 0, max: 3, step: 0.05, value: 1, label: "Motion speed", group: "motion" },
  dollyRange: { min: 0, max: 3, step: 0.05, value: 0.85, label: "Dolly range", group: "motion" },
  craneLift: { min: 0, max: 1.5, step: 0.05, value: 0.35, label: "Crane lift", group: "motion" },
  flySpeed: { min: 0, max: 5, step: 0.05, value: 1.4, label: "Fly speed", group: "motion" },
  lissajousR: { min: 0, max: 3, step: 0.05, value: 1.15, label: "Lissajous R", group: "motion" },
  pendulumAmp: { min: 0, max: 0.9, step: 0.02, value: 0.28, label: "Pendulum amp", group: "motion" },
  helixPitch: { min: 0, max: 1.8, step: 0.05, value: 0.5, label: "Helix pitch", group: "motion" },
  dissolveRate: { min: 0, max: 2, step: 0.05, value: 0.4, label: "Dissolve rate", group: "motion" },
  depthWaveAmp: { min: 0, max: 1.5, step: 0.05, value: 0.45, label: "Depth wave", group: "motion" },
  layerDriftSpd: { min: 0, max: 2.5, step: 0.05, value: 0.55, label: "Layer drift", group: "motion" },
  burstPower: { min: 0, max: 2.5, step: 0.05, value: 0.9, label: "Burst power", group: "motion" },
};

const CAM_BASE = { x: 0, y: 0.15, z: 4.2 };
const PIVOT_BASE = { x: 0, y: 0, z: 0.5 };

/** @param {object} ctx */
export function applyMotion(ctx) {
  const {
    dt, now, mode, cloudPivot, camera, controls, params, musicBus, state,
    voxelStack, layerClouds, handCtrl, trackHub, kaabaBlueprint,
  } = ctx;
  const speed = params.motionSpeed?.value ?? 1;
  const beat = musicBus.drive(
    params.musicalGain?.value ?? 1,
    params.bassDrive?.value ?? 0,
    params.midDrive?.value ?? 0,
  );
  const spinRate = (params.spin?.value ?? 0) + beat * (params.musicSpin?.value ?? 0);
  const t = now * 0.001;
  state.motionTime = (state.motionTime ?? 0) + dt * speed;

  const m = MOTION_MODES.find((x) => x.id === mode);
  if (m && !m.impl) return { placeholder: m.label };

  cloudPivot.scale.set(1, 1, 1);
  cloudPivot.position.set(PIVOT_BASE.x, PIVOT_BASE.y, PIVOT_BASE.z);

  // Nested sphere parallax from camera offset (spatial need)
  if (voxelStack?.setParallax) {
    const camOffX = (camera.position.x - controls.target.x) * 0.08;
    const camOffY = (camera.position.y - controls.target.y) * 0.08;
    const handGuide = handCtrl?.guideTarget?.(controls.target);
    const hx = handGuide ? handGuide.x * 0.35 : 0;
    const hy = handGuide ? handGuide.y * 0.35 : 0;
    voxelStack.setParallax(camOffX + hx, camOffY + hy, beat * 0.12);
    if (mode === "layerDrift" || mode === "sphereOrbit") {
      voxelStack.tickMotion?.(state.motionTime, params.layerDriftSpd?.value ?? 0.55);
    }
  }

  if (mode === "beatBurst" && beat > (state.prevBeat ?? 0) + 0.18) {
    state.motionBurst = Math.min(1.5, (state.motionBurst ?? 0) + 0.55 * (params.burstPower?.value ?? 0.9));
  }
  state.prevBeat = beat;
  state.motionBurst = (state.motionBurst ?? 0) * 0.88;
  state.motionDissolve = mode === "dissolve" ? state.motionTime * (params.dissolveRate?.value ?? 0.4) : 0;
  state.motionDepthWave = mode === "depthWave" ? params.depthWaveAmp?.value ?? 0.45 : 0;

  switch (mode) {
    case "parallax":
      cloudPivot.rotation.set(0, 0, 0);
      break;

    case "tumble":
      state.spinYaw = (state.spinYaw ?? 0) + spinRate * dt;
      cloudPivot.rotation.set(
        Math.sin(t * 1.1 * speed) * 0.45,
        state.spinYaw,
        Math.cos(t * 0.85 * speed) * 0.3,
      );
      break;

    case "precession":
      state.spinYaw = (state.spinYaw ?? 0) + spinRate * dt;
      cloudPivot.rotation.set(Math.sin(state.spinYaw * 0.55) * 0.38, state.spinYaw, 0);
      break;

    case "pendulum":
      cloudPivot.rotation.x = Math.sin(t * 1.25 * speed) * (params.pendulumAmp?.value ?? 0.28);
      cloudPivot.rotation.y = (state.spinYaw ?? 0) + spinRate * dt * 0.25;
      state.spinYaw = cloudPivot.rotation.y;
      break;

    case "pulse": {
      const s = 1 + beat * 0.18 + Math.sin(t * 2.2 * speed) * 0.04;
      cloudPivot.scale.setScalar(s);
      cloudPivot.rotation.y = (state.spinYaw ?? 0) + spinRate * dt * 0.15;
      state.spinYaw = cloudPivot.rotation.y;
      break;
    }

    case "dissolve":
    case "depthWave":
    case "beatBurst":
      cloudPivot.rotation.y = (state.spinYaw ?? 0) + spinRate * dt * 0.2;
      state.spinYaw = cloudPivot.rotation.y;
      break;

    case "helix":
      state.spinYaw = (state.spinYaw ?? 0) + spinRate * dt;
      cloudPivot.rotation.y = state.spinYaw;
      cloudPivot.position.z = PIVOT_BASE.z + Math.sin(state.spinYaw * 1.2) * (params.helixPitch?.value ?? 0.5);
      break;

    case "layerDrift":
      cloudPivot.rotation.y = (state.spinYaw ?? 0) + spinRate * dt * 0.1;
      state.spinYaw = cloudPivot.rotation.y;
      if (voxelStack?.group) {
        const drift = dt * (params.layerDriftSpd?.value ?? 0.55) * speed;
        for (const child of voxelStack.group.children) {
          if (child.userData?.voxelSlot != null) {
            child.position.z = child.userData.baseZ + state.motionTime * drift * (child.userData.voxelSlot + 1) * 0.15;
          }
        }
      }
      break;

    case "counterSpin":
      state.spinYaw = (state.spinYaw ?? 0) + spinRate * dt;
      cloudPivot.rotation.y = state.spinYaw;
      if (layerClouds) {
        let i = 0;
        for (const cloud of Object.values(layerClouds)) {
          const dir = i % 2 === 0 ? 1 : -1;
          cloud.pts.rotation.y = state.spinYaw * dir * 0.65 + Math.sin(t + i) * 0.12;
          i++;
        }
      }
      break;

    case "dolly": {
      if (state.camUserOverride || state.camDrive === false) break;
      const r = params.dollyRange?.value ?? 0.85;
      camera.position.set(CAM_BASE.x, CAM_BASE.y, CAM_BASE.z + Math.sin(t * 0.85 * speed) * r);
      break;
    }

    case "crane": {
      if (state.camUserOverride || state.camDrive === false) break;
      const lift = params.craneLift?.value ?? 0.35;
      camera.position.set(CAM_BASE.x, CAM_BASE.y + Math.sin(t * 1.1 * speed) * lift, CAM_BASE.z);
      break;
    }

    case "flythrough": {
      if (state.camUserOverride || state.camDrive === false) break;
      state.flyPhase = (state.flyPhase ?? 0) + dt * (params.flySpeed?.value ?? 1.4) * speed;
      const cycle = 10;
      const fz = state.flyPhase % cycle;
      camera.position.set(CAM_BASE.x, CAM_BASE.y, CAM_BASE.z - fz + 2);
      if (fz < 0.02) state.flyPhase = 0;
      break;
    }

    case "tawafOrbit":
    case "kaabaFly":
    case "kaabaAbove":
    case "kaabaLevel":
    case "kaabaTower": {
      // Only drive cam if blueprint loaded AND user has not seized orbit
      if (!kaabaBlueprint) break;
      if (state.camUserOverride || state.camDrive === false) {
        // Free look: still allow gentle cloud spin, never write camera
        state.spinYaw = (state.spinYaw ?? 0) + spinRate * dt * 0.15;
        cloudPivot.rotation.y = state.spinYaw;
        break;
      }
      if (mode === "tawafOrbit" && params.kaabaCamPreset) params.kaabaCamPreset.value = 0;
      if (mode === "kaabaFly" && params.kaabaCamPreset) {
        params.kaabaCamPreset.value = Math.max(0, KAABA_CAM_INDEX.flythrough);
      }
      if (mode === "kaabaAbove" && params.kaabaCamPreset) {
        params.kaabaCamPreset.value = KAABA_CAM_INDEX.above;
      }
      if (mode === "kaabaLevel" && params.kaabaCamPreset) {
        const lvl = Math.floor((state.motionTime * 0.15) % 4);
        params.kaabaCamPreset.value = KAABA_CAM_INDEX[`level${lvl}`] ?? KAABA_CAM_INDEX.level0;
      }
      if (mode === "kaabaTower" && params.kaabaCamPreset) {
        const towers = ["tower_ne", "tower_se", "tower_sw", "tower_nw", "clock"];
        const ti = Math.floor((state.motionTime * 0.12) % towers.length);
        params.kaabaCamPreset.value = KAABA_CAM_INDEX[towers[ti]] ?? KAABA_CAM_INDEX.tower_ne;
      }
      const busy = (state.fps > 0 && state.fps < 32) || !!state.segBusy;
      const blend = mode === "kaabaFly" ? 0.12 : mode === "kaabaTower" ? 0.08 : 0.1;
      kaabaBlueprint.applyCamera?.(camera, controls, state.motionTime, blend, {
        busy,
        userOverride: !!state.camUserOverride,
        camDrive: state.camDrive !== false,
      });
      break;
    }

    case "lissajous": {
      if (state.camUserOverride || state.camDrive === false) break;
      const R = params.lissajousR?.value ?? 1.15;
      camera.position.set(
        Math.sin(t * 0.72 * speed) * R,
        CAM_BASE.y + Math.sin(t * 1.4 * speed) * 0.12,
        CAM_BASE.z + Math.cos(t * 0.48 * speed) * R * 0.55,
      );
      break;
    }

    case "coOrbit": {
      state.spinYaw = (state.spinYaw ?? 0) + spinRate * dt;
      cloudPivot.rotation.y = state.spinYaw;
      if (state.camUserOverride || state.camDrive === false) break;
      const co = params.spinOrbit?.value ?? 0.85;
      const offset = ctx._camOffset;
      offset.subVectors(camera.position, controls.target);
      offset.applyAxisAngle(ctx._yAxis, spinRate * dt * co);
      camera.position.copy(controls.target).add(offset);
      break;
    }

    case "sphereOrbit": {
      state.spinYaw = (state.spinYaw ?? 0) + spinRate * dt * 0.85;
      cloudPivot.rotation.y = state.spinYaw;
      cloudPivot.rotation.x = Math.sin(state.spinYaw * 0.4) * 0.18;
      if (state.camUserOverride || state.camDrive === false) break;
      const R = (params.sphereRadius?.value ?? 1.15) * 2.2 + 2.4;
      camera.position.set(
        Math.sin(state.spinYaw * 0.35) * R * 0.45,
        CAM_BASE.y + Math.sin(t * 0.6 * speed) * 0.2,
        CAM_BASE.z + Math.cos(state.spinYaw * 0.35) * R * 0.15,
      );
      break;
    }

    case "handGuided": {
      state.spinYaw = (state.spinYaw ?? 0) + spinRate * dt * 0.2 + (handCtrl?.spinMod ?? 0) * dt;
      cloudPivot.rotation.y = state.spinYaw;
      state.motionDepthWave = (handCtrl?.waveMod ?? 0) * 0.55;
      if (state.camUserOverride || state.camDrive === false) break;
      const guide = handCtrl?.guideTarget?.(controls.target);
      if (guide) {
        controls.target.x += (guide.x - controls.target.x) * 0.08;
        controls.target.y += (guide.y - controls.target.y) * 0.08;
        camera.position.x += (guide.x * 0.4 - camera.position.x + CAM_BASE.x) * 0.04;
        camera.position.y += (guide.y * 0.3 + CAM_BASE.y - camera.position.y) * 0.04;
      }
      break;
    }

    case "faceLock": {
      cloudPivot.rotation.y = (state.spinYaw ?? 0) + spinRate * dt * 0.15;
      state.spinYaw = cloudPivot.rotation.y;
      if (state.camUserOverride || state.camDrive === false) break;
      const facePts = trackHub?.jointPoints?.filter((j) => String(j.layer).startsWith("face")) || [];
      if (facePts.length) {
        let fx = 0, fy = 0;
        for (const p of facePts) {
          fx += p.nx;
          fy += p.ny;
        }
        fx /= facePts.length;
        fy /= facePts.length;
        const tx = (fx - 0.5) * 1.2;
        const ty = (0.5 - fy) * 0.9;
        controls.target.x += (tx - controls.target.x) * 0.1;
        controls.target.y += (ty - controls.target.y) * 0.1;
        cloudPivot.position.x = tx * 0.25;
        cloudPivot.position.y = ty * 0.2;
      }
      break;
    }

    case "trackAttract": {
      // Soft spin; shard pull handled in motionShardOffset via state.trackAttract
      state.trackAttract = 0.65 + beat * 0.35;
      state.spinYaw = (state.spinYaw ?? 0) + spinRate * dt * 0.25;
      cloudPivot.rotation.y = state.spinYaw;
      break;
    }

    case "audioDolly": {
      cloudPivot.rotation.y = (state.spinYaw ?? 0) + spinRate * dt * 0.2;
      state.spinYaw = cloudPivot.rotation.y;
      if (state.camUserOverride || state.camDrive === false) break;
      const push = musicBus.bass * (params.bassDrive?.value ?? 0.85) * (params.dollyRange?.value ?? 0.85);
      camera.position.set(CAM_BASE.x, CAM_BASE.y, CAM_BASE.z - push * 1.4);
      break;
    }

    case "parallax":
      // Free user orbit — never write camera.position
      cloudPivot.rotation.set(0, state.spinYaw ?? 0, 0);
      break;

    case "turntable":
    default:
      state.spinYaw = (state.spinYaw ?? 0) + spinRate * dt;
      cloudPivot.rotation.y = state.spinYaw;
      // Co-orbit camera only if spinOrbit > 0 and user has not seized control
      if (
        mode === "turntable" &&
        !state.camUserOverride &&
        state.camDrive !== false
      ) {
        const co = params.spinOrbit?.value ?? 0;
        if (Math.abs(co) > 0.01 && Math.abs(spinRate) > 0.001) {
          const offset = ctx._camOffset;
          offset.subVectors(camera.position, controls.target);
          offset.applyAxisAngle(ctx._yAxis, spinRate * dt * co);
          camera.position.copy(controls.target).add(offset);
        }
      }
      break;
  }

  if (mode !== "counterSpin" && layerClouds) {
    for (const cloud of Object.values(layerClouds)) cloud.pts.rotation.y = 0;
  }

  return null;
}

/** Extra offsets applied when rebuilding point positions. */
export function motionShardOffset(px, py, pz, state, params, jointHint = null) {
  const radial = Math.hypot(px, py);
  if (state.motionDissolve > 0) {
    const d = state.motionDissolve;
    px *= 1 + d * 0.12;
    py *= 1 + d * 0.12;
    pz += d * 0.18;
  }
  if (state.motionBurst > 0) {
    const bp = params.burstPower?.value ?? 0.9;
    const push = state.motionBurst * bp * 0.14;
    if (radial > 0.001) {
      px += (px / radial) * push;
      py += (py / radial) * push;
    }
    pz += push * 0.35;
  }
  if (state.motionDepthWave > 0) {
    pz += Math.sin(radial * 7 - (state.motionTime ?? 0) * 4) * state.motionDepthWave * 0.2;
  }
  // Track attract — pull shards toward nearest joint hint
  if ((state.trackAttract ?? 0) > 0.01 && jointHint) {
    const k = state.trackAttract * 0.18;
    px += (jointHint.x - px) * k;
    py += (jointHint.y - py) * k;
    pz += (jointHint.z - pz) * k * 0.6;
  }
  return { x: px, y: py, z: pz };
}

export { CAM_BASE, PIVOT_BASE };