/**
 * Selection ability — feed/layer pick + 3D raycast toward point clouds.
 * Ported concepts from Splatline event/path selection into booth interaction.
 */

import * as THREE from "three";

export class SelectionHub {
  /**
   * @param {{
   *   canvas: HTMLCanvasElement,
   *   camera: THREE.Camera,
   *   layerClouds: Record<string, { pts: THREE.Points, geo: THREE.BufferGeometry }>,
   *   feeds: () => Record<string, any>,
   *   onSelect?: (sel: object) => void,
   *   onStatus?: (msg: string) => void,
   * }} opts
   */
  constructor(opts) {
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.layerClouds = opts.layerClouds;
    this.getFeeds = opts.feeds;
    this.onSelect = opts.onSelect || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points = { threshold: 0.08 };
    this.pointer = new THREE.Vector2();
    /** @type {{ kind: string, id: string, point?: THREE.Vector3, count?: number } | null} */
    this.selected = null;
    this.enabled = true;
    this._bound = false;
  }

  bind() {
    if (this._bound || !this.canvas) return;
    this._bound = true;
    this.canvas.addEventListener("pointerdown", (ev) => {
      if (!this.enabled || ev.button !== 0) return;
      // Alt/Option+click or double-click selects (OrbitControls uses left-drag)
      if (!ev.altKey && ev.detail < 2) return;
      this.pickAtEvent(ev);
    });
    this.canvas.addEventListener("contextmenu", (ev) => {
      if (!this.enabled) return;
      ev.preventDefault();
      this.pickAtEvent(ev);
    });
  }

  pickAtEvent(ev) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const clouds = Object.entries(this.layerClouds)
      .filter(([, c]) => c.pts?.visible && c.geo?.drawRange?.count > 0)
      .map(([, c]) => c.pts);

    if (!clouds.length) {
      this.clear();
      this.onStatus("Select · no points");
      return null;
    }

    const hits = this.raycaster.intersectObjects(clouds, false);
    if (!hits.length) {
      this.clear();
      this.onStatus("Select · miss");
      return null;
    }

    const hit = hits[0];
    const layerId = Object.keys(this.layerClouds).find(
      (id) => this.layerClouds[id].pts === hit.object,
    );
    const feeds = this.getFeeds();
    const feed = feeds[layerId];
    this.selected = {
      kind: "layer",
      id: layerId,
      label: feed?.label || layerId,
      point: hit.point.clone(),
      index: hit.index,
      count: hit.object.geometry?.drawRange?.count ?? 0,
      distance: hit.distance,
    };
    this.applyHighlight();
    this.onSelect(this.selected);
    this.onStatus(
      `Select · ${this.selected.label} · idx ${hit.index ?? "—"} · d ${hit.distance.toFixed(2)}`,
    );
    return this.selected;
  }

  /** Programmatic feed strip selection */
  selectFeed(id) {
    const feeds = this.getFeeds();
    if (!feeds[id]) return null;
    this.selected = {
      kind: "feed",
      id,
      label: feeds[id].label || id,
      count: this.layerClouds[id]?.geo?.drawRange?.count ?? 0,
    };
    this.applyHighlight();
    this.onSelect(this.selected);
    return this.selected;
  }

  applyHighlight() {
    const id = this.selected?.id;
    for (const [lid, cloud] of Object.entries(this.layerClouds)) {
      const mat = cloud.mat;
      if (!mat?.uniforms) continue;
      // Dim non-selected when something is selected
      if (id && lid !== id) {
        if (mat.uniforms.uOpacity) {
          mat.userData._selOpacity = mat.userData._selOpacity ?? mat.uniforms.uOpacity.value;
          mat.uniforms.uOpacity.value = (mat.userData._selOpacity ?? 0.9) * 0.28;
        }
      } else if (mat.userData._selOpacity != null && mat.uniforms.uOpacity) {
        mat.uniforms.uOpacity.value = mat.userData._selOpacity;
        delete mat.userData._selOpacity;
      }
      if (lid === id && mat.uniforms.uGlow) {
        mat.userData._selGlow = mat.userData._selGlow ?? mat.uniforms.uGlow.value;
        mat.uniforms.uGlow.value = Math.min(2.5, (mat.userData._selGlow ?? 0.85) * 1.55);
      } else if (mat.userData._selGlow != null && mat.uniforms.uGlow) {
        mat.uniforms.uGlow.value = mat.userData._selGlow;
        delete mat.userData._selGlow;
      }
    }
  }

  clear() {
    this.selected = null;
    for (const cloud of Object.values(this.layerClouds)) {
      const mat = cloud.mat;
      if (!mat) continue;
      if (mat.userData._selOpacity != null && mat.uniforms?.uOpacity) {
        mat.uniforms.uOpacity.value = mat.userData._selOpacity;
        delete mat.userData._selOpacity;
      }
      if (mat.userData._selGlow != null && mat.uniforms?.uGlow) {
        mat.uniforms.uGlow.value = mat.userData._selGlow;
        delete mat.userData._selGlow;
      }
    }
    this.onSelect(null);
  }

  /** Solo selected layer (selection ability → process flags) */
  soloSelected() {
    if (!this.selected?.id) return;
    const feeds = this.getFeeds();
    for (const f of Object.values(feeds)) {
      if (f.id === "camera" || f.id === "depth" || f.id === "spectrum") continue;
      f.process = f.id === this.selected.id;
    }
    this.onStatus(`Solo · ${this.selected.label}`);
  }

  isSelected(id) {
    return this.selected?.id === id;
  }
}
