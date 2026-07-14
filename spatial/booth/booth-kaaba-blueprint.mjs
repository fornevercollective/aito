/**
 * Kaaba / Masjid al-Haram spatial blueprint — desk-stack equivalent for Mecca live.
 *
 * Scaled architectural reference (1 booth unit ≈ 10 m):
 *  - Kaaba cube ~13.1 m H × 11.03×12.86 m base
 *  - Al-Hatim semicircle NW
 *  - Black Stone eastern corner · door NE (Bab ar-Rahmah)
 *  - Mataf concentric rings + multi-level elevated rings
 *  - Strategic gates with twin minarets
 *  - Abraj Al Bait clock tower (south)
 *  - Green lantern (tawaf start line · eastern corner alignment)
 *  - Courtyard chandeliers / interior lamp markers
 *
 * Camera rigs (like dual desk cams): flythrough, above approach, tower/level cams.
 */

import * as THREE from "three";

/** meters → booth units */
const M = 0.1;

export const KAABA_DIMS = {
  heightM: 13.1,
  sideAM: 11.03, // ~N-S related
  sideBM: 12.86, // ~E-W related
  doorHeightM: 2.13,
  blackStoneHeightM: 1.5,
  hatimHeightM: 1.25,
  hatimRadiusM: 4.5, // approx semi-circle to NW
};

/**
 * Gate bearings (degrees from +Z world / “north-ish” for layout).
 * Approximate plaza layout for orientation in the live stream.
 */
export const HARAM_GATES = [
  { id: "abdulaziz", label: "King Abdulaziz · G1", gate: 1, azDeg: 180, distM: 95, color: 0xf97316 },
  { id: "fath", label: "Bab al-Fath · G45", gate: 45, azDeg: 0, distM: 88, color: 0x38bdf8 },
  { id: "umrah", label: "Bab Umrah · G62", gate: 62, azDeg: 315, distM: 82, color: 0xa78bfa },
  { id: "fahd", label: "King Fahd · G79", gate: 79, azDeg: 270, distM: 90, color: 0x34d399 },
  { id: "abdullah", label: "King Abdullah · G100", gate: 100, azDeg: 20, distM: 110, color: 0xfbbf24 },
];

/** Minarets / towers around perimeter (approx corners + clock tower). */
export const HARAM_TOWERS = [
  { id: "minaret_ne", label: "Minaret NE", azDeg: 45, distM: 105, heightM: 89, kind: "minaret" },
  { id: "minaret_se", label: "Minaret SE", azDeg: 135, distM: 105, heightM: 89, kind: "minaret" },
  { id: "minaret_sw", label: "Minaret SW", azDeg: 225, distM: 105, heightM: 89, kind: "minaret" },
  { id: "minaret_nw", label: "Minaret NW", azDeg: 315, distM: 105, heightM: 89, kind: "minaret" },
  { id: "minaret_g1", label: "Twin minarets G1", azDeg: 175, distM: 98, heightM: 92, kind: "minaret" },
  { id: "minaret_g1b", label: "Twin minarets G1b", azDeg: 185, distM: 98, heightM: 92, kind: "minaret" },
  { id: "clock", label: "Abraj Al Bait", azDeg: 180, distM: 145, heightM: 601, kind: "clock" },
  { id: "salman_a", label: "King Salman tower A", azDeg: 200, distM: 160, heightM: 220, kind: "tower" },
  { id: "salman_b", label: "King Salman tower B", azDeg: 160, distM: 155, heightM: 180, kind: "tower" },
];

/** Mataf ring radii (m) — concentric traffic tracks + elevated levels. */
export const MATAF_RINGS = [
  { id: "inner", rM: 22, yM: 0, level: 0, label: "Mataf inner", opacity: 0.55 },
  { id: "mid", rM: 38, yM: 0, level: 0, label: "Mataf mid", opacity: 0.4 },
  { id: "outer", rM: 55, yM: 0, level: 0, label: "Mataf outer", opacity: 0.32 },
  { id: "bridge1", rM: 42, yM: 6.5, level: 1, label: "Elevated ring L1", opacity: 0.38 },
  { id: "bridge2", rM: 48, yM: 12, level: 2, label: "Elevated ring L2", opacity: 0.34 },
  { id: "bridge3", rM: 54, yM: 18, level: 3, label: "Elevated ring L3", opacity: 0.28 },
];

/** Named camera presets (towers / levels / fly paths). */
export const KAABA_CAM_PRESETS = [
  { id: "tawaf", label: "Tawaf orbit", kind: "orbit", desc: "Counter-clockwise Mataf orbit (pilgrim eye)" },
  { id: "flythrough", label: "Flythrough gates", kind: "fly", desc: "Abdulaziz gate → Mataf → orbit" },
  { id: "above", label: "Above approach", kind: "above", desc: "High crane descent onto Kaaba" },
  { id: "level0", label: "Mataf L0", kind: "level", level: 0, desc: "Ground marble tracks" },
  { id: "level1", label: "Elevated L1", kind: "level", level: 1, desc: "First circular bridge" },
  { id: "level2", label: "Elevated L2", kind: "level", level: 2, desc: "Mid multi-tier ring" },
  { id: "level3", label: "Elevated L3", kind: "level", level: 3, desc: "Upper multi-tier ring" },
  { id: "tower_ne", label: "Tower NE", kind: "tower", towerId: "minaret_ne" },
  { id: "tower_se", label: "Tower SE", kind: "tower", towerId: "minaret_se" },
  { id: "tower_sw", label: "Tower SW", kind: "tower", towerId: "minaret_sw" },
  { id: "tower_nw", label: "Tower NW", kind: "tower", towerId: "minaret_nw" },
  { id: "clock", label: "Clock tower cam", kind: "tower", towerId: "clock" },
  { id: "green_line", label: "Green lantern line", kind: "special", desc: "Aligned with eastern corner start/stop" },
];

export const KAABA_PARAMS = {
  kaabaEnable: { min: 0, max: 1, step: 1, value: 0, label: "Kaaba blueprint", group: "kaaba" },
  kaabaScale: { min: 0.4, max: 2.2, step: 0.05, value: 1, label: "Blueprint scale", group: "kaaba" },
  kaabaRings: { min: 0, max: 1, step: 1, value: 1, label: "Mataf rings", group: "kaaba" },
  kaabaLevels: { min: 0, max: 1, step: 1, value: 1, label: "Elevated levels", group: "kaaba" },
  kaabaGates: { min: 0, max: 1, step: 1, value: 1, label: "Gates · exits", group: "kaaba" },
  kaabaTowers: { min: 0, max: 1, step: 1, value: 1, label: "Towers · minarets", group: "kaaba" },
  kaabaLanterns: { min: 0, max: 1, step: 1, value: 1, label: "Lanterns · green line", group: "kaaba" },
  kaabaCams: { min: 0, max: 1, step: 1, value: 1, label: "Cam markers", group: "kaaba" },
  kaabaFlow: { min: 0, max: 1, step: 1, value: 1, label: "Tawaf flow arrows", group: "kaaba" },
  kaabaY: { min: -1.5, max: 0.5, step: 0.02, value: -0.55, label: "Blueprint floor Y", group: "kaaba" },
  kaabaCamPreset: { min: 0, max: KAABA_CAM_PRESETS.length - 1, step: 1, value: 0, label: "Cam preset", group: "kaaba" },
  kaabaOrbitR: { min: 0.8, max: 8, step: 0.05, value: 3.6, label: "Orbit radius", group: "kaaba" },
  kaabaOrbitH: { min: 0.1, max: 6, step: 0.05, value: 1.15, label: "Orbit height", group: "kaaba" },
  kaabaFlySpeed: { min: 0.2, max: 3, step: 0.05, value: 0.85, label: "Flythrough speed", group: "kaaba" },
};

function azToXZ(azDeg, distM, scale) {
  const a = ((azDeg - 90) * Math.PI) / 180; // 0° = +Z north-ish in our layout
  const d = distM * M * scale;
  return { x: Math.cos(a) * d, z: Math.sin(a) * d };
}

function disposeObject(obj) {
  obj.traverse?.((c) => {
    c.geometry?.dispose?.();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
      else c.material.dispose?.();
    }
  });
}

/** Build order for progressive lazy load (light → heavy). */
export const KAABA_PART_ORDER = [
  "core", // floor + Kaaba cube + black stone + hatim (required for orbit)
  "rings", // Mataf rings + elevated levels
  "gates", // exits / paths
  "towers", // minarets + clock
  "lanterns", // green line + courtyard lamps
  "flow", // tawaf arrows (rotates each frame — load late)
  "cams", // camera markers
];

export class KaabaBlueprint {
  constructor(params) {
    this.params = params;
    this.group = new THREE.Group();
    this.group.name = "kaaba-blueprint";
    this._built = false;
    /** @type {Set<string>} */
    this._loadedParts = new Set();
    /** Queue of part ids still to build across frames */
    this._partQueue = [];
    this._building = false;
    this._parent = null;
    this.camMarkers = new THREE.Group();
    this.camMarkers.name = "kaaba-cams";
    this.flowGroup = new THREE.Group();
    this.flowGroup.name = "tawaf-flow";
    this.time = 0;
    this.activeCamId = "tawaf";
    /** Skip decorative pulse when FPS / spin load is high */
    this.lod = "full"; // full | orbit | minimal
    this._lastCamMs = 0;
    this._lastUpdateMs = 0;
    /** @type {Record<string, THREE.Object3D>} */
    this.nodes = {};
    /** Part root groups for show/hide without rebuild */
    this.partRoots = {};
  }

  get enabled() {
    return (this.params.kaabaEnable?.value ?? 1) >= 0.5;
  }

  get scale() {
    return this.params.kaabaScale?.value ?? 1;
  }

  get loadProgress() {
    const total = KAABA_PART_ORDER.length;
    return { loaded: this._loadedParts.size, total, ready: this._loadedParts.has("core") };
  }

  attach(parent) {
    this._parent = parent;
    if (!this.group.parent) parent.add(this.group);
    // Progressive: only schedule; don't block frame 0 with full mesh build
    this.scheduleLazyBuild({ force: true });
  }

  setVisible(v) {
    this.group.visible = !!v && this.enabled;
  }

  /**
   * Tear down and re-queue progressive build.
   * @param {{ force?: boolean, eager?: boolean }} [opts]
   *   eager=true builds all remaining parts immediately (use sparingly).
   */
  rebuild(opts = {}) {
    const force = opts.force !== false;
    if (force) this._clearAll();
    if (!this.enabled) {
      this._built = false;
      this.group.visible = false;
      this._partQueue = [];
      return;
    }
    this.group.visible = true;
    this.scheduleLazyBuild({ force: true, eager: !!opts.eager });
  }

  _clearAll() {
    while (this.group.children.length) {
      const c = this.group.children[0];
      this.group.remove(c);
      disposeObject(c);
    }
    this.nodes = {};
    this.partRoots = {};
    this.camMarkers = new THREE.Group();
    this.camMarkers.name = "kaaba-cams";
    this.flowGroup = new THREE.Group();
    this.flowGroup.name = "tawaf-flow";
    this._loadedParts.clear();
    this._built = false;
  }

  /**
   * Queue parts not yet loaded. Processes 1 part per call by default
   * so orbit/rotation frames stay light.
   */
  scheduleLazyBuild(opts = {}) {
    if (!this.enabled) return;
    if (opts.force) {
      this._partQueue = KAABA_PART_ORDER.filter((p) => this._partWanted(p) && !this._loadedParts.has(p));
    } else {
      for (const p of KAABA_PART_ORDER) {
        if (this._partWanted(p) && !this._loadedParts.has(p) && !this._partQueue.includes(p)) {
          this._partQueue.push(p);
        }
      }
    }
    if (opts.eager) {
      while (this._partQueue.length) this._buildNextPart();
      return;
    }
    // Kick one part now if nothing loaded yet (core must exist for orbit)
    if (!this._loadedParts.has("core")) this._buildNextPart();
  }

  _partWanted(id) {
    switch (id) {
      case "core":
        return true;
      case "rings":
        return (this.params.kaabaRings?.value ?? 1) >= 0.5;
      case "gates":
        return (this.params.kaabaGates?.value ?? 1) >= 0.5;
      case "towers":
        return (this.params.kaabaTowers?.value ?? 1) >= 0.5;
      case "lanterns":
        return (this.params.kaabaLanterns?.value ?? 1) >= 0.5;
      case "flow":
        return (this.params.kaabaFlow?.value ?? 1) >= 0.5;
      case "cams":
        return (this.params.kaabaCams?.value ?? 1) >= 0.5;
      default:
        return false;
    }
  }

  /**
   * Call each frame: loads at most `budget` parts (default 1).
   * Safe during high spin — never rebuilds whole scene.
   * @param {{ budget?: number, busy?: boolean }} [opts]
   *   busy=true (heavy seg/FPS) → only ensure core, defer rest
   */
  pumpLazy(opts = {}) {
    if (!this.enabled) return this.loadProgress;
    if (opts.busy) {
      if (!this._loadedParts.has("core")) this._buildNextPart();
      return this.loadProgress;
    }
    let budget = opts.budget ?? 1;
    // While orbiting, never spend more than 1 part / frame
    if (this.lod === "orbit" || this.lod === "minimal") budget = Math.min(budget, 1);
    while (budget-- > 0 && this._partQueue.length) {
      this._buildNextPart();
    }
    // Re-queue if toggles turned parts back on
    if (!this._partQueue.length) {
      for (const p of KAABA_PART_ORDER) {
        if (this._partWanted(p) && !this._loadedParts.has(p)) this._partQueue.push(p);
      }
    }
    return this.loadProgress;
  }

  _buildNextPart() {
    if (this._building) return;
    const id = this._partQueue.shift();
    if (!id || this._loadedParts.has(id)) return;
    if (!this._partWanted(id)) return;
    this._building = true;
    try {
      switch (id) {
        case "core":
          this._buildCore();
          break;
        case "rings":
          this._buildRings();
          break;
        case "gates":
          this._buildGates();
          break;
        case "towers":
          this._buildTowers();
          break;
        case "lanterns":
          this._buildLanterns();
          break;
        case "flow":
          this._buildFlow();
          break;
        case "cams":
          this._buildCams();
          break;
        default:
          break;
      }
      this._loadedParts.add(id);
      this._built = this._loadedParts.has("core");
    } finally {
      this._building = false;
    }
  }

  _partRoot(name) {
    if (this.partRoots[name]) return this.partRoots[name];
    const g = new THREE.Group();
    g.name = `kaaba-part-${name}`;
    this.partRoots[name] = g;
    this.group.add(g);
    return g;
  }

  _buildCore() {
    const s = this.scale;
    const floorY = this.params.kaabaY?.value ?? -0.55;
    const root = this._partRoot("core");

    // Lower-poly floor for lazy core (48 segs vs 96)
    const floorR = 62 * M * s;
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(floorR, 48),
      new THREE.MeshBasicMaterial({
        color: 0xe8e4dc,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY;
    floor.name = "mataf-floor";
    root.add(floor);

    const kh = KAABA_DIMS.heightM * M * s;
    const kw = KAABA_DIMS.sideBM * M * s;
    const kd = KAABA_DIMS.sideAM * M * s;
    const kaaba = new THREE.Mesh(
      new THREE.BoxGeometry(kw, kh, kd),
      new THREE.MeshBasicMaterial({
        color: 0x1a1520,
        transparent: true,
        opacity: 0.82,
        depthWrite: true,
      }),
    );
    kaaba.position.set(0, floorY + kh * 0.5, 0);
    kaaba.name = "kaaba";
    root.add(kaaba);
    this.nodes.kaaba = kaaba;
    this.nodes._dims = { kh, kw, kd, floorY, s };

    const kaabaEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(kw * 1.01, kh * 1.01, kd * 1.01)),
      new THREE.LineBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.85 }),
    );
    kaabaEdge.position.copy(kaaba.position);
    root.add(kaabaEdge);

    const doorH = KAABA_DIMS.doorHeightM * M * s;
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(kw * 0.18, doorH),
      new THREE.MeshBasicMaterial({
        color: 0xc9a227,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    door.position.set(kw * 0.35, floorY + doorH * 0.5 + 0.05 * s, kd * 0.505);
    door.name = "bab-rahmah";
    root.add(door);

    const bs = new THREE.Mesh(
      new THREE.SphereGeometry(0.045 * s, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x111111 }),
    );
    bs.position.set(kw * 0.5, floorY + KAABA_DIMS.blackStoneHeightM * M * s, kd * 0.5);
    bs.name = "black-stone";
    root.add(bs);
    this.nodes.blackStone = bs;

    // Al-Hatim (lighter 16 segments)
    const hr = KAABA_DIMS.hatimRadiusM * M * s;
    const hh = KAABA_DIMS.hatimHeightM * M * s;
    const hatimPts = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI + (i / 16) * Math.PI;
      hatimPts.push(new THREE.Vector3(Math.cos(a) * hr, floorY + hh, Math.sin(a) * hr - kd * 0.15));
    }
    root.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(hatimPts),
        new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.75 }),
      ),
    );
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(hr, hr, hh, 20, 1, true, Math.PI * 0.5, Math.PI),
      new THREE.MeshBasicMaterial({
        color: 0xcbd5e1,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    wall.position.set(0, floorY + hh * 0.5, -kd * 0.15);
    root.add(wall);

    for (let i = 0; i < 3; i++) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02 * s, 0.02 * s, kh * 0.85, 6),
        new THREE.MeshBasicMaterial({ color: 0x78716c, transparent: true, opacity: 0.55 }),
      );
      pillar.position.set((i - 1) * kw * 0.22, floorY + kh * 0.42, 0);
      root.add(pillar);
    }
  }

  _buildRings() {
    const s = this.scale;
    const floorY = this.params.kaabaY?.value ?? -0.55;
    const root = this._partRoot("rings");
    const segs = this.lod === "minimal" ? 32 : 64;
    for (const ring of MATAF_RINGS) {
      if (ring.level > 0 && (this.params.kaabaLevels?.value ?? 1) < 0.5) continue;
      const r = ring.rM * M * s;
      const y = floorY + ring.yM * M * s;
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.97, r, segs),
        new THREE.MeshBasicMaterial({
          color: ring.level === 0 ? 0xf8fafc : 0x38bdf8,
          transparent: true,
          opacity: ring.opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y + 0.01;
      mesh.name = ring.id;
      mesh.userData.ring = ring;
      root.add(mesh);
      // Fewer posts when lazy / orbiting
      if (ring.level > 0) {
        const nPosts = this.lod === "full" ? 10 : 6;
        for (let i = 0; i < nPosts; i++) {
          const a = (i / nPosts) * Math.PI * 2;
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015 * s, 0.015 * s, Math.max(0.05, y - floorY), 5),
            new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.35 }),
          );
          post.position.set(Math.cos(a) * r, (floorY + y) * 0.5, Math.sin(a) * r);
          root.add(post);
        }
      }
    }
  }

  _buildGates() {
    const s = this.scale;
    const floorY = this.params.kaabaY?.value ?? -0.55;
    const root = this._partRoot("gates");
    for (const g of HARAM_GATES) {
      const { x, z } = azToXZ(g.azDeg, g.distM, s);
      const gate = new THREE.Group();
      const postH = 2.2 * s;
      for (const sx of [-0.35, 0.35]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.08 * s, postH, 0.08 * s),
          new THREE.MeshBasicMaterial({ color: g.color, transparent: true, opacity: 0.7 }),
        );
        post.position.set(sx * s, floorY + postH * 0.5, 0);
        gate.add(post);
      }
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(0.85 * s, 0.08 * s, 0.1 * s),
        new THREE.MeshBasicMaterial({ color: g.color, transparent: true, opacity: 0.75 }),
      );
      lintel.position.set(0, floorY + postH, 0);
      gate.add(lintel);
      gate.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, floorY + 0.04, 0),
            new THREE.Vector3(-x, floorY + 0.04, -z),
          ]),
          new THREE.LineBasicMaterial({ color: g.color, transparent: true, opacity: 0.35 }),
        ),
      );
      gate.position.set(x, 0, z);
      gate.lookAt(0, 0, 0);
      gate.name = g.id;
      gate.userData.gate = g;
      root.add(gate);
      this.nodes[`gate_${g.id}`] = gate;
    }
  }

  _buildTowers() {
    const s = this.scale;
    const floorY = this.params.kaabaY?.value ?? -0.55;
    const root = this._partRoot("towers");
    for (const tw of HARAM_TOWERS) {
      const { x, z } = azToXZ(tw.azDeg, tw.distM, s);
      const hM = tw.kind === "clock" ? Math.min(tw.heightM, 180) : Math.min(tw.heightM, 100);
      const h = hM * M * s * (tw.kind === "clock" ? 0.55 : 0.35);
      const rBase = tw.kind === "clock" ? 0.28 * s : tw.kind === "tower" ? 0.18 * s : 0.06 * s;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(rBase * 0.55, rBase, h, tw.kind === "clock" ? 8 : 6),
        new THREE.MeshBasicMaterial({
          color: tw.kind === "clock" ? 0xb45309 : tw.kind === "tower" ? 0x78716c : 0xd6d3d1,
          transparent: true,
          opacity: 0.55,
        }),
      );
      mesh.position.set(x, floorY + h * 0.5, z);
      mesh.name = tw.id;
      mesh.userData.tower = tw;
      root.add(mesh);
      if (tw.kind === "clock") {
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(rBase * 2.2, rBase * 1.6, rBase * 2.2),
          new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.65 }),
        );
        head.position.set(x, floorY + h + rBase * 0.8, z);
        root.add(head);
      }
      this.nodes[`tower_${tw.id}`] = mesh;
    }
  }

  _buildLanterns() {
    const s = this.scale;
    const floorY = this.params.kaabaY?.value ?? -0.55;
    const dims = this.nodes._dims || {};
    const kh = dims.kh ?? KAABA_DIMS.heightM * M * s;
    const root = this._partRoot("lanterns");

    const green = new THREE.Mesh(
      new THREE.SphereGeometry(0.06 * s, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.95 }),
    );
    const greenR = 28 * M * s;
    green.position.set(greenR * 0.85, floorY + 1.1 * s, greenR * 0.35);
    green.name = "green-lantern";
    root.add(green);
    this.nodes.greenLantern = green;
    if (this.nodes.blackStone) {
      root.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            green.position.clone(),
            this.nodes.blackStone.position.clone(),
          ]),
          new THREE.LineBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.55 }),
        ),
      );
    }
    // Courtyard lamps: fewer when not full LOD
    const nLamps = this.lod === "full" ? 12 : 8;
    for (let i = 0; i < nLamps; i++) {
      const a = (i / nLamps) * Math.PI * 2;
      const r = 48 * M * s;
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.035 * s, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.7 }),
      );
      lamp.position.set(Math.cos(a) * r, floorY + 0.85 * s, Math.sin(a) * r);
      root.add(lamp);
    }
    for (let i = 0; i < 3; i++) {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.025 * s, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.85 }),
      );
      lamp.position.set((i - 1) * 0.12 * s, floorY + kh * 0.75, 0);
      root.add(lamp);
    }
  }

  _buildFlow() {
    const s = this.scale;
    const floorY = this.params.kaabaY?.value ?? -0.55;
    this.flowGroup = new THREE.Group();
    this.flowGroup.name = "tawaf-flow";
    const r = 32 * M * s;
    const n = this.lod === "full" ? 12 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      this.flowGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(cx - tx * 0.12 * s, floorY + 0.06, cz - tz * 0.12 * s),
            new THREE.Vector3(cx + tx * 0.18 * s, floorY + 0.06, cz + tz * 0.18 * s),
          ]),
          new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.65 }),
        ),
      );
    }
    this.group.add(this.flowGroup);
    this.partRoots.flow = this.flowGroup;
  }

  _buildCams() {
    const s = this.scale;
    this.camMarkers = new THREE.Group();
    this.camMarkers.name = "kaaba-cams";
    for (const preset of KAABA_CAM_PRESETS) {
      const pose = this.poseForPreset(preset.id, 0);
      if (!pose) continue;
      const marker = new THREE.Mesh(
        new THREE.ConeGeometry(0.05 * s, 0.12 * s, 6),
        new THREE.MeshBasicMaterial({
          color: preset.kind === "tower" ? 0x22d3ee : preset.kind === "fly" ? 0xf472b6 : 0xa3e635,
          transparent: true,
          opacity: 0.85,
        }),
      );
      marker.position.copy(pose.position);
      marker.lookAt(pose.target);
      marker.rotateX(Math.PI / 2);
      marker.userData.camPreset = preset.id;
      marker.name = `cam-${preset.id}`;
      this.camMarkers.add(marker);
    }
    this.group.add(this.camMarkers);
    this.partRoots.cams = this.camMarkers;
    this.setActiveCam(this.activeCamId);
  }

  /**
   * World pose for a named camera preset (in cloudPivot space).
   * @param {string} id
   * @param {number} t seconds phase
   */
  poseForPreset(id, t = 0) {
    const s = this.scale;
    const floorY = this.params.kaabaY?.value ?? -0.55;
    const orbitR = (this.params.kaabaOrbitR?.value ?? 3.6) * s;
    const orbitH = (this.params.kaabaOrbitH?.value ?? 1.15) * s;
    const target = new THREE.Vector3(0, floorY + KAABA_DIMS.heightM * M * s * 0.45, 0);
    const preset = KAABA_CAM_PRESETS.find((p) => p.id === id) || KAABA_CAM_PRESETS[0];

    if (preset.kind === "orbit" || id === "tawaf") {
      // CCW tawaf (negative angle speed)
      const a = -t * 0.35;
      return {
        position: new THREE.Vector3(Math.cos(a) * orbitR, floorY + orbitH * 0.55, Math.sin(a) * orbitR),
        target,
        preset,
      };
    }
    if (preset.kind === "above" || id === "above") {
      const h = floorY + 4.5 * s + Math.sin(t * 0.4) * 0.4 * s;
      const pull = 2.2 * s + Math.cos(t * 0.25) * 0.6 * s;
      return {
        position: new THREE.Vector3(Math.sin(t * 0.15) * 0.4 * s, h, pull),
        target: new THREE.Vector3(0, floorY + 0.3 * s, 0),
        preset,
      };
    }
    if (preset.kind === "fly" || id === "flythrough") {
      // Gate 1 (south) → approach → mid Mataf orbit blend
      const spd = this.params.kaabaFlySpeed?.value ?? 0.85;
      const phase = (t * spd * 0.2) % 1;
      const gate = azToXZ(180, 95, s);
      if (phase < 0.45) {
        const u = phase / 0.45;
        return {
          position: new THREE.Vector3(
            gate.x * (1 - u) * 0.9,
            floorY + 0.8 * s + u * 0.6 * s,
            gate.z * (1 - u) * 0.9 + u * orbitR * 0.3,
          ),
          target,
          preset,
        };
      }
      const u = (phase - 0.45) / 0.55;
      const a = -u * Math.PI * 2;
      return {
        position: new THREE.Vector3(
          Math.cos(a) * orbitR * 0.85,
          floorY + orbitH * (0.5 + 0.2 * Math.sin(u * Math.PI)),
          Math.sin(a) * orbitR * 0.85,
        ),
        target,
        preset,
      };
    }
    if (preset.kind === "level") {
      const ring = MATAF_RINGS.find((r) => r.level === preset.level) || MATAF_RINGS[0];
      const a = -t * 0.25;
      const r = ring.rM * M * s * 0.92;
      const y = floorY + ring.yM * M * s + 0.35 * s;
      return {
        position: new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
        target,
        preset,
      };
    }
    if (preset.kind === "tower") {
      const tw = HARAM_TOWERS.find((x) => x.id === preset.towerId) || HARAM_TOWERS[0];
      const { x, z } = azToXZ(tw.azDeg, tw.distM * 0.92, s);
      const hM = tw.kind === "clock" ? 90 : Math.min(tw.heightM, 80);
      const y = floorY + hM * M * s * 0.25;
      return {
        position: new THREE.Vector3(x, y, z),
        target,
        preset,
      };
    }
    if (preset.kind === "special" || id === "green_line") {
      const greenR = 28 * M * s;
      return {
        position: new THREE.Vector3(greenR * 1.1, floorY + 1.4 * s, greenR * 0.5),
        target: this.nodes.blackStone
          ? this.nodes.blackStone.position.clone()
          : new THREE.Vector3(0.5 * s, floorY + 0.15 * s, 0.5 * s),
        preset,
      };
    }
    return {
      position: new THREE.Vector3(0, floorY + 2.5 * s, orbitR),
      target,
      preset,
    };
  }

  setActiveCam(id) {
    this.activeCamId = id || "tawaf";
    const idx = KAABA_CAM_PRESETS.findIndex((p) => p.id === this.activeCamId);
    if (idx >= 0 && this.params.kaabaCamPreset) {
      this.params.kaabaCamPreset.value = idx;
    }
    for (const child of this.camMarkers.children) {
      const on = child.userData.camPreset === this.activeCamId;
      if (child.material) {
        child.material.opacity = on ? 1 : 0.45;
        child.scale.setScalar(on ? 1.45 : 1);
      }
    }
  }

  activePreset() {
    const idx = Math.round(this.params.kaabaCamPreset?.value ?? 0);
    return KAABA_CAM_PRESETS[Math.max(0, Math.min(KAABA_CAM_PRESETS.length - 1, idx))];
  }

  /**
   * Drive camera/controls for current Kaaba cam preset.
   * Throttled when busy so rotation + point cloud don't fight for frames.
   * @returns {{ position: THREE.Vector3, target: THREE.Vector3, preset: object } | null}
   */
  applyCamera(camera, controls, t, blend = 0.08, opts = {}) {
    if (!this.enabled || !this._loadedParts.has("core")) return null;
    // Respect free-orbit: never fight OrbitControls after user drag
    if (opts.userOverride || opts.camDrive === false) return null;
    const now = performance.now();
    // During heavy load: update camera ~20fps max
    const minMs = opts.busy || this.lod === "minimal" ? 48 : this.lod === "orbit" ? 24 : 0;
    if (minMs && now - this._lastCamMs < minMs) return null;
    this._lastCamMs = now;

    const preset = this.activePreset();
    if (!preset) return null;
    // Only re-highlight cam markers occasionally
    if (!opts.busy && now - (this._lastHighlightMs || 0) > 400) {
      this.setActiveCam(preset.id);
      this._lastHighlightMs = now;
    }
    const pose = this.poseForPreset(preset.id, t);
    if (!pose) return null;
    const b = opts.busy ? Math.min(blend, 0.05) : blend;
    camera.position.lerp(pose.position, b);
    if (controls?.target) {
      controls.target.lerp(pose.target, b);
      controls.update?.();
    } else {
      camera.lookAt(pose.target);
    }
    this.time = t;
    // Flow rotation only if part loaded and not minimal LOD
    if (this.flowGroup?.parent && this.lod !== "minimal") {
      this.flowGroup.rotation.y = -t * 0.2;
    }
    return pose;
  }

  /**
   * Per-frame tick: progressive load + light animation.
   * @param {number} dt
   * @param {number} t
   * @param {{ busy?: boolean, spinLoad?: number, fps?: number }} [ctx]
   */
  update(dt, t, ctx = {}) {
    if (!this.enabled) {
      this.group.visible = false;
      return this.loadProgress;
    }

    // LOD from spin / FPS pressure so rotation never overloads
    const spinLoad = ctx.spinLoad ?? 0;
    const fps = ctx.fps ?? 60;
    if (ctx.busy || fps < 28 || spinLoad > 1.2) this.lod = "minimal";
    else if (spinLoad > 0.45 || fps < 42) this.lod = "orbit";
    else this.lod = "full";

    // Progressive part load — 0–1 part per frame depending on load
    const budget = this.lod === "minimal" ? (this._loadedParts.has("core") ? 0 : 1) : this.lod === "orbit" ? 1 : 1;
    this.pumpLazy({ budget, busy: this.lod === "minimal" && this._loadedParts.has("core") });

    // Hide heavy parts while under load (already built stay, just skip anim)
    if (this.partRoots.flow) this.partRoots.flow.visible = this.lod !== "minimal";
    if (this.partRoots.cams) this.partRoots.cams.visible = this.lod === "full";
    if (this.partRoots.lanterns) this.partRoots.lanterns.visible = this.lod !== "minimal";

    if (!this._loadedParts.has("core")) {
      this.group.visible = true;
      return this.loadProgress;
    }
    this.group.visible = true;
    this.time = t;

    // Throttle decorative pulse
    const now = performance.now();
    const pulseEvery = this.lod === "full" ? 0 : this.lod === "orbit" ? 66 : 120;
    if (!pulseEvery || now - this._lastUpdateMs >= pulseEvery) {
      this._lastUpdateMs = now;
      if (this.nodes.greenLantern?.material && this.lod !== "minimal") {
        this.nodes.greenLantern.material.opacity = 0.65 + Math.sin(t * 3.2) * 0.3;
        const sc = 1 + Math.sin(t * 3.2) * 0.12;
        this.nodes.greenLantern.scale.setScalar(sc);
      }
      if (this.flowGroup?.parent && this.lod !== "minimal") {
        this.flowGroup.rotation.y = -t * 0.25;
      }
    }
    return this.loadProgress;
  }

  /** Soft-hide a part without dispose (param toggles). */
  syncPartVisibility() {
    for (const id of KAABA_PART_ORDER) {
      if (id === "core") continue;
      const root = this.partRoots[id];
      if (!root) continue;
      root.visible = this._partWanted(id);
    }
  }
}

/** Crowd preset additions for Kaaba blueprint. */
export function applyKaabaBlueprintPreset(params) {
  const set = (k, v) => {
    if (!params[k]) return;
    params[k].value = Math.max(params[k].min, Math.min(params[k].max, v));
    delete params[k]._handBase;
    if (typeof window.syncParamUi === "function") window.syncParamUi(k, params[k]);
  };
  set("kaabaEnable", 1);
  set("kaabaRings", 1);
  set("kaabaLevels", 1);
  set("kaabaGates", 1);
  set("kaabaTowers", 1);
  set("kaabaLanterns", 1);
  set("kaabaCams", 1);
  set("kaabaFlow", 1);
  set("kaabaScale", 1);
  set("kaabaY", -0.55);
  set("kaabaCamPreset", 0); // tawaf
  set("kaabaOrbitR", 3.8);
  set("kaabaOrbitH", 1.25);
  set("kaabaFlySpeed", 0.9);
  // desk stack off so blueprint owns layout (optional soft)
  set("stackEnable", 0);
  set("stackIndicators", 0);
}
