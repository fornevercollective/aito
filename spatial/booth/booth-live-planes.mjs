/**
 * Live feed as spatial video planes:
 *  - Floor: high-res, face-up on the ground
 *  - Float: see-through copy scaled at center of the booth
 */

import * as THREE from "three";

export const LIVE_PLANE_PARAMS = {
  liveFloor: { min: 0, max: 1, step: 1, value: 1, label: "Live floor video", group: "livevid" },
  liveFloat: { min: 0, max: 1, step: 1, value: 1, label: "Live float ghost", group: "livevid" },
  liveFloorW: { min: 1.2, max: 8, step: 0.05, value: 3.6, label: "Floor width", group: "livevid" },
  liveFloorY: { min: -1.2, max: 0.2, step: 0.02, value: -0.62, label: "Floor Y", group: "livevid" },
  liveFloorOpacity: { min: 0.15, max: 1, step: 0.02, value: 0.92, label: "Floor opacity", group: "livevid" },
  liveFloatScale: { min: 0.4, max: 4, step: 0.05, value: 1.65, label: "Float scale", group: "livevid" },
  liveFloatY: { min: -0.2, max: 2.5, step: 0.02, value: 0.55, label: "Float height", group: "livevid" },
  liveFloatZ: { min: -1.5, max: 2.5, step: 0.05, value: 0.35, label: "Float Z", group: "livevid" },
  liveFloatOpacity: { min: 0.08, max: 0.85, step: 0.02, value: 0.38, label: "Float opacity", group: "livevid" },
  liveFloatBillboard: { min: 0, max: 1, step: 1, value: 0, label: "Float face camera", group: "livevid" },
};

export class LiveVideoPlanes {
  /**
   * @param {HTMLVideoElement} video
   * @param {object} params
   */
  constructor(video, params) {
    this.video = video;
    this.params = params;
    this.group = new THREE.Group();
    this.group.name = "live-video-planes";
    this.texture = null;
    this.floor = null;
    this.float = null;
    this.floorFrame = null;
    this.floatFrame = null;
    this.active = false;
    this._hiResCanvas = document.createElement("canvas");
    this._hiResCanvas.width = 1280;
    this._hiResCanvas.height = 720;
    this._hiResCtx = this._hiResCanvas.getContext("2d", { alpha: false });
    this._useCanvasTex = false;
  }

  attach(parent) {
    parent.add(this.group);
    this._ensureMeshes();
    this.setVisible(false);
  }

  _ensureMeshes() {
    if (this.floor) return;

    // Prefer VideoTexture for live fidelity; fallback canvas path if needed
    try {
      this.texture = new THREE.VideoTexture(this.video);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.generateMipmaps = false;
      this._useCanvasTex = false;
    } catch {
      this.texture = new THREE.CanvasTexture(this._hiResCanvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this._useCanvasTex = true;
    }

    const floorMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: true,
      toneMapped: false,
    });
    // High-res floor: large plane, face up (-X rotation so video faces sky / room)
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.025), floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, -0.62, 0.4);
    this.floor.name = "live-floor";
    this.floor.renderOrder = 1;
    this.group.add(this.floor);

    // Subtle floor frame
    this.floorFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.62, 2.04)),
      new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.55 }),
    );
    this.floorFrame.rotation.x = -Math.PI / 2;
    this.floorFrame.position.copy(this.floor.position);
    this.floorFrame.position.y += 0.002;
    this.group.add(this.floorFrame);

    const floatMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NormalBlending,
    });
    this.float = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), floatMat);
    this.float.position.set(0, 0.55, 0.35);
    this.float.name = "live-float";
    this.float.renderOrder = 10;
    this.group.add(this.float);

    this.floatFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.62, 0.92)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 }),
    );
    this.floatFrame.position.copy(this.float.position);
    this.group.add(this.floatFrame);
  }

  /** Call when live feed is staged / unstaged */
  setActive(on) {
    this.active = !!on;
    this._ensureMeshes();
    this.setVisible(on);
    if (on && this.video?.readyState >= 2) {
      this._fitAspect();
    }
  }

  setVisible(v) {
    this.group.visible = v;
    if (this.floor) this.floor.visible = v && (this.params.liveFloor?.value ?? 1) >= 0.5;
    if (this.floorFrame) this.floorFrame.visible = this.floor?.visible;
    if (this.float) this.float.visible = v && this.isFloatVisible();
    if (this.floatFrame) this.floatFrame.visible = this.float?.visible;
  }

  isFloatVisible() {
    return (this.params.liveFloat?.value ?? 1) >= 0.5;
  }

  /** Show/hide floating center player only (floor independent). */
  setFloatVisible(visible) {
    const spec = this.params.liveFloat;
    if (spec) {
      spec.value = visible ? 1 : 0;
      delete spec._handBase;
      if (spec.input) spec.input.value = String(spec.value);
      if (spec.output && typeof window.formatParam === "function") {
        spec.output.textContent = window.formatParam("liveFloat", spec.value);
      }
    }
    if (this.float) this.float.visible = !!(this.active && visible);
    if (this.floatFrame) this.floatFrame.visible = !!(this.active && visible);
  }

  _fitAspect() {
    const vw = this.video.videoWidth || 16;
    const vh = this.video.videoHeight || 9;
    const aspect = vw / vh;

    // Floor: high-res footprint
    const fw = this.params.liveFloorW?.value ?? 3.6;
    const fh = fw / aspect;
    if (this.floor) {
      this.floor.geometry.dispose();
      this.floor.geometry = new THREE.PlaneGeometry(fw, fh);
    }
    if (this.floorFrame) {
      this.floorFrame.geometry.dispose();
      this.floorFrame.geometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(fw * 1.01, fh * 1.01));
    }

    // Float: scaled relative to floor, readable aspect
    const scale = this.params.liveFloatScale?.value ?? 1.65;
    const baseW = 1.15 * scale;
    const baseH = baseW / aspect;
    if (this.float) {
      this.float.geometry.dispose();
      this.float.geometry = new THREE.PlaneGeometry(baseW, baseH);
    }
    if (this.floatFrame) {
      this.floatFrame.geometry.dispose();
      this.floatFrame.geometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(baseW * 1.02, baseH * 1.02));
    }
  }

  /**
   * Per-frame: layout + texture refresh.
   * @param {THREE.Camera} [camera]
   */
  update(camera) {
    if (!this.active) {
      this.setVisible(false);
      return;
    }
    this._ensureMeshes();

    const floorOn = (this.params.liveFloor?.value ?? 1) >= 0.5;
    const floatOn = (this.params.liveFloat?.value ?? 1) >= 0.5;
    this.group.visible = floorOn || floatOn;
    if (this.floor) this.floor.visible = floorOn;
    if (this.floorFrame) this.floorFrame.visible = floorOn;
    if (this.float) this.float.visible = floatOn;
    if (this.floatFrame) this.floatFrame.visible = floatOn;

    // High-res canvas path when VideoTexture unavailable
    if (this._useCanvasTex && this.video.readyState >= 2 && this._hiResCtx) {
      const tw = this._hiResCanvas.width;
      const th = this._hiResCanvas.height;
      this._hiResCtx.drawImage(this.video, 0, 0, tw, th);
      if (this.texture) this.texture.needsUpdate = true;
    } else if (this.texture) {
      this.texture.needsUpdate = true;
    }

    if (this.video.readyState >= 2) this._fitAspect();

    // Floor placement — face up
    const fy = this.params.liveFloorY?.value ?? -0.62;
    if (this.floor) {
      this.floor.position.set(0, fy, 0.45);
      this.floor.rotation.set(-Math.PI / 2, 0, 0);
      if (this.floor.material) {
        this.floor.material.opacity = this.params.liveFloorOpacity?.value ?? 0.92;
      }
    }
    if (this.floorFrame) {
      this.floorFrame.position.set(0, fy + 0.003, 0.45);
      this.floorFrame.rotation.set(-Math.PI / 2, 0, 0);
    }

    // Floating see-through at center scale
    const fY = this.params.liveFloatY?.value ?? 0.55;
    const fZ = this.params.liveFloatZ?.value ?? 0.35;
    if (this.float) {
      this.float.position.set(0, fY, fZ);
      if (this.float.material) {
        this.float.material.opacity = this.params.liveFloatOpacity?.value ?? 0.38;
      }
      const billboard = (this.params.liveFloatBillboard?.value ?? 0) >= 0.5;
      if (billboard && camera) {
        this.float.quaternion.copy(camera.quaternion);
      } else {
        // Slight upright float, mild tilt toward viewer
        this.float.rotation.set(-0.08, 0, 0);
      }
    }
    if (this.floatFrame) {
      this.floatFrame.position.copy(this.float.position);
      this.floatFrame.quaternion.copy(this.float.quaternion);
      this.floatFrame.rotation.copy(this.float.rotation);
    }
  }

  dispose() {
    for (const m of [this.floor, this.float, this.floorFrame, this.floatFrame]) {
      if (!m) continue;
      m.geometry?.dispose?.();
      m.material?.dispose?.();
    }
    this.texture?.dispose?.();
  }
}
