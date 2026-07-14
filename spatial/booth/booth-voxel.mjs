import * as THREE from "three";

/**
 * Voxel sphere — multi-source layers mapped onto nested spherical shells
 * with spatial parallax (outer shells move more than inner cores).
 *
 * Replaces flat Z-stack with:
 *  - shell radius by voxelSlot / source weight
 *  - angular placement (golden-angle spiral) for multi-source mix
 *  - nested parallax offsets driven by camera / hand / motion
 */

/** Golden angle for even angular distribution of shells */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export class VoxelStack {
  constructor(feeds, params) {
    this.feeds = feeds;
    this.params = params;
    this.group = new THREE.Group();
    this.group.name = "voxel-sphere";
    this.grid = null;
    this.shellMeshes = [];
    this.layout = "sphere"; // "sphere" | "stack"
    this._parallax = { x: 0, y: 0, z: 0 };
  }

  slot(layerId) {
    const f = this.feeds[layerId];
    return f?.voxelSlot ?? 0;
  }

  /** Shell radius for a layer (nested variations). */
  shellRadius(layerId) {
    const slot = this.slot(layerId);
    const base = this.params.sphereRadius?.value ?? 1.15;
    const nest = this.params.sphereNest?.value ?? 0.22;
    // Inner person shells closer to core; later slots outer rings
    return base * (0.35 + nest * slot * 0.55);
  }

  /** Angular placement for multi-source mix on the sphere. */
  shellAngles(layerId) {
    const slot = this.slot(layerId);
    const yaw = slot * GOLDEN + (this.params.sphereSpin?.value ?? 0);
    const pitch = ((slot % 5) - 2) * 0.18;
    return { yaw, pitch };
  }

  /**
   * World offset for a sample point belonging to layerId.
   * Nested parallax: outer shells get larger camera-relative shift.
   */
  offsetPosition(x, y, z, layerId) {
    if (this.layout === "stack") {
      return this._stackOffset(x, y, z, layerId);
    }
    return this._sphereOffset(x, y, z, layerId);
  }

  _stackOffset(x, y, z, layerId) {
    const slot = this.slot(layerId);
    const sep = this.params.voxelSep?.value ?? 0.55;
    const spread = this.params.voxelSpread?.value ?? 0.28;
    const center = 3;
    const px = this._parallax.x * (0.15 + slot * 0.04);
    const py = this._parallax.y * (0.12 + slot * 0.03);
    return {
      x: x + (slot - center) * spread * 0.22 + px,
      y: y + py,
      z: z + slot * sep + this._parallax.z * slot * 0.05,
    };
  }

  _sphereOffset(x, y, z, layerId) {
    const slot = this.slot(layerId);
    const R = this.shellRadius(layerId);
    const { yaw, pitch } = this.shellAngles(layerId);
    const sep = this.params.voxelSep?.value ?? 0.55;
    const spread = this.params.voxelSpread?.value ?? 0.28;

    // Map planar (x,y) onto shell surface + original depth as radial thickness
    const radialThick = z * (0.35 + sep * 0.25);
    const shellR = R + radialThick;

    // Local UV-ish on shell
    const localYaw = yaw + x * spread * 0.55;
    const localPitch = pitch + y * spread * 0.4;

    const cy = Math.cos(localYaw);
    const sy = Math.sin(localYaw);
    const cp = Math.cos(localPitch);
    const sp = Math.sin(localPitch);

    // Nested parallax — outer shells shift more (spatial need)
    const paraGain = 0.12 + R * (this.params.sphereParallax?.value ?? 0.65);
    const px = this._parallax.x * paraGain;
    const py = this._parallax.y * paraGain;
    const pz = this._parallax.z * paraGain * 0.5;

    // Blend planar cloud (readable faces) with sphere shell mapping
    const blend = this.params.sphereBlend?.value ?? 0.55;
    const sx = shellR * cp * sy + px;
    const syy = shellR * sp + py;
    const sz = shellR * cp * cy * 0.85 + pz;

    return {
      x: x * (1 - blend) + sx * blend + (slot - 4) * spread * 0.04,
      y: y * (1 - blend) + syy * blend,
      z: z * (1 - blend) * 0.5 + sz * blend + slot * sep * (1 - blend),
    };
  }

  /** Update parallax drivers (camera offset, hand, motion). */
  setParallax(px, py, pz = 0) {
    this._parallax.x = px;
    this._parallax.y = py;
    this._parallax.z = pz;
  }

  setLayout(layout) {
    this.layout = layout === "stack" ? "stack" : "sphere";
    this.rebuildGrid();
  }

  attach(scene) {
    scene.add(this.group);
    this.rebuildGrid();
  }

  rebuildGrid() {
    // dispose old helpers
    if (this.grid) {
      this.group.remove(this.grid);
      this.grid.geometry?.dispose?.();
      this.grid.material?.dispose?.();
      this.grid = null;
    }
    for (const m of this.shellMeshes) {
      this.group.remove(m);
      m.geometry?.dispose?.();
      m.material?.dispose?.();
    }
    this.shellMeshes = [];
    while (this.group.children.length) {
      const c = this.group.children[this.group.children.length - 1];
      this.group.remove(c);
    }

    const slots = Object.values(this.feeds)
      .map((f) => f.voxelSlot)
      .filter((s) => s != null);
    const maxSlot = slots.length ? Math.max(...slots) : 5;

    if (this.layout === "stack") {
      const sep = this.params.voxelSep?.value ?? 0.55;
      const divisions = maxSlot + 2;
      const size = (maxSlot + 1) * sep + 1.2;
      this.grid = new THREE.GridHelper(size, divisions, 0xf97316, 0x27272a);
      this.grid.rotation.x = Math.PI / 2;
      this.grid.position.z = (maxSlot * sep) * 0.5;
      this.grid.material.opacity = 0.22;
      this.grid.material.transparent = true;
      this.group.add(this.grid);
    } else {
      // Nested wire spheres for spatial shells
      const nest = this.params.sphereNest?.value ?? 0.22;
      const base = this.params.sphereRadius?.value ?? 1.15;
      for (let shell = 0; shell < 4; shell++) {
        const r = base * (0.4 + nest * shell * 1.1);
        const geo = new THREE.SphereGeometry(r, 24, 16);
        const mat = new THREE.MeshBasicMaterial({
          color: shell === 0 ? 0xf97316 : 0x3f3f46,
          wireframe: true,
          transparent: true,
          opacity: 0.08 + shell * 0.03,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `voxel-shell-${shell}`;
        mesh.userData.shell = shell;
        this.group.add(mesh);
        this.shellMeshes.push(mesh);
      }
    }

    // Per-feed ghost planes / markers
    for (const feed of Object.values(this.feeds)) {
      if (feed.voxelSlot == null) continue;
      const tint = feed.tint
        ? new THREE.Color(feed.tint[0] / 255, feed.tint[1] / 255, feed.tint[2] / 255)
        : new THREE.Color(0xffffff);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.7),
        new THREE.MeshBasicMaterial({
          color: tint,
          transparent: true,
          opacity: 0.05,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      const o = this.offsetPosition(0, 0, 0.1, feed.id);
      plane.position.set(o.x, o.y, o.z);
      plane.lookAt(0, 0, 0);
      plane.name = `voxel-slice-${feed.id}`;
      plane.userData.voxelSlot = feed.voxelSlot;
      plane.userData.baseZ = plane.position.z;
      plane.userData.basePos = plane.position.clone();
      plane.userData.layerId = feed.id;
      this.group.add(plane);
    }
  }

  /** Animate shell markers with nested parallax / layer drift */
  tickMotion(motionTime, driftSpd = 0) {
    for (const child of this.group.children) {
      if (child.userData?.voxelSlot == null) continue;
      const base = child.userData.basePos;
      if (!base) continue;
      const slot = child.userData.voxelSlot;
      const drift = motionTime * driftSpd * (slot + 1) * 0.08;
      child.position.set(
        base.x + Math.sin(drift + slot) * 0.04,
        base.y + Math.cos(drift * 0.7) * 0.03,
        base.z + Math.sin(drift * 0.5) * 0.05,
      );
    }
    // Slow spin of wire shells
    for (const m of this.shellMeshes) {
      m.rotation.y = motionTime * 0.08 * (1 + (m.userData.shell || 0) * 0.15);
      m.rotation.x = Math.sin(motionTime * 0.05) * 0.08;
    }
  }

  setVisible(v) {
    this.group.visible = v;
  }
}
