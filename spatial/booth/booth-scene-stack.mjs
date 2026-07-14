/**
 * Live spatial dual stack — desk / person / screen placement so you can
 * orbit a person at a table and perceive the scene they are viewing.
 *
 * Layers (world space on cloudPivot):
 *  - person anchor (desktop cam / segmented body)
 *  - desk / table plane
 *  - screen plane + content-depth cloud (what they look at)
 *  - dual / Continuity camera markers + baseline distances
 *  - gaze / view frustum indicator (face → screen)
 */

import * as THREE from "three";

export const SCENE_STACK_PARAMS = {
  stackEnable: { min: 0, max: 1, step: 1, value: 1, label: "Scene stack", group: "stack" },
  stackPersonZ: { min: -1, max: 2, step: 0.05, value: 0.15, label: "Person Z", group: "stack" },
  stackDeskY: { min: -1.5, max: 0.2, step: 0.02, value: -0.55, label: "Desk height", group: "stack" },
  stackDeskDepth: { min: 0.4, max: 2.5, step: 0.05, value: 1.1, label: "Desk depth", group: "stack" },
  stackScreenDist: { min: 0.4, max: 3.5, step: 0.05, value: 1.35, label: "Screen distance", group: "stack" },
  stackScreenH: { min: -0.4, max: 1.2, step: 0.02, value: 0.22, label: "Screen height", group: "stack" },
  stackScreenW: { min: 0.6, max: 2.8, step: 0.05, value: 1.45, label: "Screen width", group: "stack" },
  stackScreenTilt: { min: -0.6, max: 0.6, step: 0.02, value: -0.12, label: "Screen tilt", group: "stack" },
  stackCamADist: { min: 0.5, max: 4, step: 0.05, value: 1.6, label: "Desktop cam dist", group: "stack" },
  stackCamBDist: { min: 0.5, max: 4, step: 0.05, value: 1.85, label: "Dual cam dist", group: "stack" },
  stackCamBAz: { min: -2.5, max: 2.5, step: 0.05, value: 0.85, label: "Dual cam azimuth", group: "stack" },
  stackContentDepth: { min: 0, max: 2, step: 0.05, value: 0.75, label: "Content depth", group: "stack" },
  stackGaze: { min: 0, max: 1, step: 1, value: 1, label: "Gaze indicator", group: "stack" },
  stackIndicators: { min: 0, max: 1, step: 1, value: 1, label: "Object indicators", group: "stack" },
};

export class SceneStack {
  /**
   * @param {object} params PARAMS ref
   */
  constructor(params) {
    this.params = params;
    this.group = new THREE.Group();
    this.group.name = "scene-stack";
    this._built = false;
    this.desk = null;
    this.screenFrame = null;
    this.screenPlane = null;
    this.personRing = null;
    this.camAMarker = null;
    this.camBMarker = null;
    this.gazeLine = null;
    this.labels = [];
    this.screenTex = null;
    this._texCanvas = document.createElement("canvas");
    this._texCanvas.width = 320;
    this._texCanvas.height = 200;
    this._texCtx = this._texCanvas.getContext("2d");
    /** Last face/gaze tip in cloud space */
    this.gazeFrom = new THREE.Vector3(0, 0.25, 0.1);
    this.gazeTo = new THREE.Vector3(0, 0.22, 1.35);
  }

  get enabled() {
    return (this.params.stackEnable?.value ?? 1) >= 0.5;
  }

  attach(parent) {
    parent.add(this.group);
    this.rebuild();
  }

  rebuild() {
    while (this.group.children.length) {
      const c = this.group.children[0];
      this.group.remove(c);
      c.geometry?.dispose?.();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material.dispose?.();
      }
    }
    this.labels = [];
    if (!this.enabled) {
      this._built = false;
      return;
    }

    const deskY = this.params.stackDeskY?.value ?? -0.55;
    const deskD = this.params.stackDeskDepth?.value ?? 1.1;
    const screenDist = this.params.stackScreenDist?.value ?? 1.35;
    const screenH = this.params.stackScreenH?.value ?? 0.22;
    const screenW = this.params.stackScreenW?.value ?? 1.45;
    const tilt = this.params.stackScreenTilt?.value ?? -0.12;
    const personZ = this.params.stackPersonZ?.value ?? 0.15;

    // Desk / table
    const deskGeo = new THREE.BoxGeometry(2.2, 0.04, deskD);
    const deskMat = new THREE.MeshBasicMaterial({
      color: 0x3f3f46,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.desk = new THREE.Mesh(deskGeo, deskMat);
    this.desk.position.set(0, deskY, personZ + deskD * 0.35);
    this.desk.name = "desk";
    this.group.add(this.desk);

    // Desk edge highlight
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(deskGeo),
      new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.55 }),
    );
    edge.position.copy(this.desk.position);
    this.group.add(edge);

    // Screen plane (content surface person is viewing)
    const aspect = 16 / 10;
    const sh = screenW / aspect;
    if (!this.screenTex) {
      this.screenTex = new THREE.CanvasTexture(this._texCanvas);
      this.screenTex.colorSpace = THREE.SRGBColorSpace;
      this.screenTex.minFilter = THREE.LinearFilter;
      this.screenTex.magFilter = THREE.LinearFilter;
    }
    const screenMat = new THREE.MeshBasicMaterial({
      map: this.screenTex,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.screenPlane = new THREE.Mesh(new THREE.PlaneGeometry(screenW, sh), screenMat);
    this.screenPlane.position.set(0, deskY + screenH + sh * 0.5, personZ + screenDist);
    this.screenPlane.rotation.x = tilt;
    this.screenPlane.name = "view-screen";
    this.group.add(this.screenPlane);

    // Screen bezel / indicator frame
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(screenW * 1.02, sh * 1.05)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 }),
    );
    frame.position.copy(this.screenPlane.position);
    frame.rotation.copy(this.screenPlane.rotation);
    this.screenFrame = frame;
    this.group.add(frame);

    // Person anchor ring (where body cloud sits)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.28, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, deskY + 0.03, personZ);
    this.personRing = ring;
    this.group.add(ring);

    // Camera distance markers (desktop + dual Continuity)
    this.camAMarker = this._makeCamGizmo(0x22d3ee, "Desktop cam");
    this.camBMarker = this._makeCamGizmo(0x34d399, "Dual cam");
    this.group.add(this.camAMarker);
    this.group.add(this.camBMarker);
    this._placeCameras();

    // Gaze line person → screen
    const gazeGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.35, personZ),
      this.screenPlane.position.clone(),
    ]);
    this.gazeLine = new THREE.Line(
      gazeGeo,
      new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.7 }),
    );
    this.gazeLine.name = "gaze";
    this.group.add(this.gazeLine);

    // View frustum cone (lightweight)
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.9, 4, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
        wireframe: true,
      }),
    );
    cone.position.copy(this.screenPlane.position);
    cone.position.z -= 0.45;
    cone.rotation.x = Math.PI / 2 + tilt;
    cone.name = "view-frustum";
    this.group.add(cone);

    this.gazeTo.copy(this.screenPlane.position);
    this._built = true;
    this.group.visible = true;
  }

  _makeCamGizmo(color, name) {
    const g = new THREE.Group();
    g.name = name;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.1, 0.18),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }),
    );
    const lens = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    lens.position.z = 0.1;
    g.add(body, lens);
    // Distance ray toward person
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -0.5),
      ]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 }),
    );
    g.add(ray);
    g.userData.ray = ray;
    return g;
  }

  _placeCameras() {
    const personZ = this.params.stackPersonZ?.value ?? 0.15;
    const aDist = this.params.stackCamADist?.value ?? 1.6;
    const bDist = this.params.stackCamBDist?.value ?? 1.85;
    const bAz = this.params.stackCamBAz?.value ?? 0.85;
    const deskY = this.params.stackDeskY?.value ?? -0.55;

    // Desktop cam in front of person (typical laptop/webcam position)
    if (this.camAMarker) {
      this.camAMarker.position.set(0, deskY + 0.85, personZ + aDist * 0.15);
      // Actually place camera behind viewing axis looking at person: negative Z from person
      this.camAMarker.position.set(0.05, 0.35, personZ - aDist * 0.55);
      this.camAMarker.lookAt(0, 0.2, personZ);
      this._updateCamRay(this.camAMarker, new THREE.Vector3(0, 0.2, personZ));
    }
    // Dual Continuity off to the side / farther
    if (this.camBMarker) {
      const x = Math.sin(bAz) * bDist;
      const z = personZ - Math.cos(bAz) * bDist * 0.55;
      this.camBMarker.position.set(x, 0.4, z);
      this.camBMarker.lookAt(0, 0.25, personZ);
      this._updateCamRay(this.camBMarker, new THREE.Vector3(0, 0.25, personZ));
    }
  }

  _updateCamRay(marker, target) {
    const ray = marker.userData.ray;
    if (!ray) return;
    const local = marker.worldToLocal(target.clone());
    // marker is not in scene graph with updated matrices until render — approximate local
    const dx = target.x - marker.position.x;
    const dy = target.y - marker.position.y;
    const dz = target.z - marker.position.z;
    // Ray is child of marker; convert to marker local by inverse rotation approx via lookAt
    ray.geometry.setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, Math.hypot(dx, dy, dz)),
    ]);
    ray.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * World offsets applied to person / dual / screen point clouds for stacked placement.
   */
  placementFor(layerId) {
    if (!this.enabled) return { x: 0, y: 0, z: 0, scale: 1 };
    const personZ = this.params.stackPersonZ?.value ?? 0.15;
    const screenDist = this.params.stackScreenDist?.value ?? 1.35;
    const screenH = this.params.stackScreenH?.value ?? 0.22;
    const deskY = this.params.stackDeskY?.value ?? -0.55;
    const bDist = this.params.stackCamBDist?.value ?? 1.85;
    const bAz = this.params.stackCamBAz?.value ?? 0.85;

    if (layerId === "screen") {
      return {
        x: 0,
        y: deskY + screenH + 0.35,
        z: personZ + screenDist,
        scale: 0.55,
        contentDepth: this.params.stackContentDepth?.value ?? 0.75,
      };
    }
    if (layerId === "iphone" || layerId === "dual") {
      const x = Math.sin(bAz) * 0.35;
      return {
        x,
        y: 0.05,
        z: personZ - Math.cos(bAz) * bDist * 0.12,
        scale: 0.85,
        contentDepth: 0,
      };
    }
    // person / face / composite body stay near person anchor
    if (
      layerId === "person" ||
      layerId === "person2" ||
      layerId === "person3" ||
      layerId === "person4" ||
      layerId === "face" ||
      layerId === "pose" ||
      layerId === "leftHand" ||
      layerId === "rightHand" ||
      layerId === "fingers" ||
      layerId === "joints" ||
      layerId === "composite" ||
      layerId === "background"
    ) {
      return { x: 0, y: 0.05, z: personZ, scale: 1, contentDepth: 0 };
    }
    return { x: 0, y: 0, z: 0, scale: 1, contentDepth: 0 };
  }

  /**
   * Update screen texture from RGB frame + gaze from face tip.
   * @param {ImageData | {data:Uint8ClampedArray,width:number,height:number} | null} rgb
   * @param {{x:number,y:number,z?:number}|null} faceTip normalized 0..1 image coords
   */
  update(rgb, faceTip = null) {
    if (!this.enabled) {
      this.group.visible = false;
      return;
    }
    if (!this._built) this.rebuild();
    this.group.visible = true;
    this._placeCameras();

    const showInd = (this.params.stackIndicators?.value ?? 1) >= 0.5;
    if (this.desk) this.desk.visible = showInd;
    if (this.camAMarker) this.camAMarker.visible = showInd;
    if (this.camBMarker) this.camBMarker.visible = showInd;
    if (this.personRing) this.personRing.visible = showInd;

    // Screen content texture
    if (rgb?.data && this._texCtx) {
      const tw = this._texCanvas.width;
      const th = this._texCanvas.height;
      // draw via temp canvas path: putImageData needs matching size — scale with drawImage
      const tmp = document.createElement("canvas");
      tmp.width = rgb.width || SAMPLE_FALLBACK_W;
      tmp.height = rgb.height || SAMPLE_FALLBACK_H;
      // If ImageData
      if (rgb instanceof ImageData || (rgb.data && rgb.width)) {
        try {
          const id =
            rgb instanceof ImageData
              ? rgb
              : new ImageData(
                  new Uint8ClampedArray(rgb.data),
                  rgb.width,
                  rgb.height,
                );
          tmp.getContext("2d").putImageData(id, 0, 0);
          this._texCtx.drawImage(tmp, 0, 0, tw, th);
          if (this.screenTex) this.screenTex.needsUpdate = true;
        } catch {
          /* ignore frame */
        }
      }
    }

    // Gaze
    const showGaze = (this.params.stackGaze?.value ?? 1) >= 0.5;
    if (this.gazeLine) this.gazeLine.visible = showGaze;
    if (showGaze && this.gazeLine && this.screenPlane) {
      const personZ = this.params.stackPersonZ?.value ?? 0.15;
      let fx = 0;
      let fy = 0.35;
      let fz = personZ;
      if (faceTip) {
        fx = (faceTip.x - 0.5) * 0.8;
        fy = (0.5 - faceTip.y) * 0.9 + 0.2;
        fz = personZ + (faceTip.z ?? 0) * 0.3;
      }
      this.gazeFrom.set(fx, fy, fz);
      this.gazeTo.copy(this.screenPlane.position);
      this.gazeLine.geometry.setFromPoints([this.gazeFrom, this.gazeTo]);
      this.gazeLine.geometry.attributes.position.needsUpdate = true;
    }

    // Soft pulse on screen frame
    if (this.screenFrame?.material) {
      this.screenFrame.material.opacity = 0.55 + Math.sin(performance.now() * 0.003) * 0.2;
    }
  }

  setVisible(v) {
    this.group.visible = v && this.enabled;
  }
}

const SAMPLE_FALLBACK_W = 240;
const SAMPLE_FALLBACK_H = 180;
