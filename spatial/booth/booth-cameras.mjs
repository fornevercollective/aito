/**
 * Dual-camera source for aito-mac spatial booth.
 * Desktop (FaceTime / built-in) + iPhone Continuity Camera / Desk View.
 *
 * Continuity Camera appears in getUserMedia as e.g. "Brick Camera" or
 * "Someone's iPhone Camera" once the phone is nearby with Continuity enabled.
 * Requesting a stream on that deviceId is the "launch" — macOS wakes the link.
 */

/** @typedef {{ deviceId: string, label: string, kind: 'iphone' | 'deskview' | 'desktop' | 'other' }} CamDevice */

const IDEAL = { width: { ideal: 1280 }, height: { ideal: 720 } };

/**
 * Classify a media device label for Continuity / built-in heuristics.
 * @param {string} label
 * @returns {CamDevice['kind']}
 */
export function classifyCameraLabel(label) {
  const s = (label || "").toLowerCase();
  if (!s) return "other";
  if (s.includes("desk view") || s.includes("deskview")) return "deskview";
  // Continuity Camera: iPhone model name, "iphone", or Continuity brand strings
  if (
    s.includes("iphone") ||
    s.includes("continuity") ||
    /\biphone\s*\d/i.test(label) ||
    // Device name often becomes "<Name> Camera" with iPhone model in system_profiler;
    // web labels are usually "Foo Camera" for Continuity — detect common patterns
    s.includes(" rear camera") ||
    s.includes(" front camera") ||
    // Model-style Continuity labels sometimes drop "iPhone" in browser
    /camera\s*\(\s*iphone/i.test(label)
  ) {
    return "iphone";
  }
  if (
    s.includes("facetime") ||
    s.includes("built-in") ||
    s.includes("built in") ||
    s.includes("macbook") ||
    s.includes("imac") ||
    s.includes("studio display")
  ) {
    return "desktop";
  }
  return "other";
}

/**
 * After a permission grant, re-classify ambiguous Continuity devices.
 * If exactly one non-desktop camera exists and system shows Continuity, treat as iphone.
 * @param {CamDevice[]} devices
 */
export function refineDeviceKinds(devices) {
  const desktops = devices.filter((d) => d.kind === "desktop");
  const others = devices.filter((d) => d.kind === "other");
  // Single extra camera next to FaceTime is almost always Continuity Camera
  if (desktops.length >= 1 && others.length === 1 && !devices.some((d) => d.kind === "iphone")) {
    others[0].kind = "iphone";
  }
  // "X Camera" + "X Desk View Camera" pattern
  for (const d of devices) {
    if (d.kind !== "other") continue;
    const base = d.label.replace(/\s*camera\s*$/i, "").trim().toLowerCase();
    if (!base) continue;
    const hasDesk = devices.some(
      (x) => x.kind === "deskview" && x.label.toLowerCase().includes(base),
    );
    if (hasDesk) d.kind = "iphone";
  }
  return devices;
}

/**
 * @param {MediaDeviceInfo[]} list
 * @returns {CamDevice[]}
 */
export function mapVideoDevices(list) {
  const raw = list
    .filter((d) => d.kind === "videoinput")
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${d.deviceId.slice(0, 6)}`,
      kind: classifyCameraLabel(d.label),
    }));
  return refineDeviceKinds(raw);
}

export function isContinuityKind(kind) {
  return kind === "iphone" || kind === "deskview";
}

/**
 * Manage primary + optional secondary MediaStreams for spatial dual-cam.
 */
export class DualCameraHub {
  /**
   * @param {HTMLVideoElement} primaryVideo
   * @param {HTMLVideoElement} secondaryVideo
   */
  constructor(primaryVideo, secondaryVideo) {
    this.primaryVideo = primaryVideo;
    this.secondaryVideo = secondaryVideo;
    /** @type {MediaStream | null} */
    this.primaryStream = null;
    /** @type {MediaStream | null} */
    this.secondaryStream = null;
    /** @type {CamDevice[]} */
    this.devices = [];
    /** 'none' | 'desktop' | 'iphone' | 'deskview' | 'dual' | 'device' */
    this.mode = "none";
    /** How to sample into the booth pipeline: 'primary' | 'sbs' | 'pip' | 'spatial' */
    this.combine = "spatial";
    /** Baseline offset for spatial dual clouds (world X) */
    this.spatialBaseline = 1.15;
    /** When true, dual secondary always maps to its own spatial layer (even if combine ≠ spatial) */
    this.spatialLayer = true;
    this.primaryDeviceId = null;
    this.secondaryDeviceId = null;
    this.primaryLabel = "";
    this.secondaryLabel = "";
  }

  get active() {
    return this.mode !== "none" && !!(this.primaryStream || this.secondaryStream);
  }

  get hasSecondary() {
    return !!(this.secondaryStream && this.secondaryVideo.readyState >= 2);
  }

  get label() {
    if (this.mode === "dual") {
      return `Dual · ${shortLabel(this.primaryLabel)} + ${shortLabel(this.secondaryLabel)}`;
    }
    if (this.mode === "iphone") return `iPhone · ${shortLabel(this.primaryLabel)}`;
    if (this.mode === "deskview") return `Desk View · ${shortLabel(this.primaryLabel)}`;
    if (this.mode === "desktop") return `Desktop · ${shortLabel(this.primaryLabel)}`;
    if (this.mode === "device") return shortLabel(this.primaryLabel) || "Camera";
    return "Off";
  }

  /**
   * Ensure permission so device labels are populated, then list cameras.
   * @returns {Promise<CamDevice[]>}
   */
  async listDevices({ requestPermission = true } = {}) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error("mediaDevices.enumerateDevices unavailable");
    }
    if (requestPermission) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        for (const t of tmp.getTracks()) t.stop();
      } catch {
        // Permission denied — labels may be empty; still return ids
      }
    }
    const list = await navigator.mediaDevices.enumerateDevices();
    this.devices = mapVideoDevices(list);
    return this.devices;
  }

  /** @param {CamDevice['kind'] | 'continuity'} kind */
  findDevice(kind) {
    if (kind === "continuity") {
      return (
        this.devices.find((d) => d.kind === "iphone") ||
        this.devices.find((d) => d.kind === "deskview") ||
        null
      );
    }
    return this.devices.find((d) => d.kind === kind) || null;
  }

  findDesktop() {
    return (
      this.devices.find((d) => d.kind === "desktop") ||
      this.devices.find((d) => d.kind === "other") ||
      this.devices[0] ||
      null
    );
  }

  findIPhone() {
    return this.findDevice("iphone") || this.findDevice("continuity");
  }

  findDeskView() {
    return this.findDevice("deskview");
  }

  _stopTrack(stream) {
    if (!stream) return;
    for (const t of stream.getTracks()) t.stop();
  }

  stop() {
    this._stopTrack(this.primaryStream);
    this._stopTrack(this.secondaryStream);
    this.primaryStream = null;
    this.secondaryStream = null;
    this.primaryVideo.srcObject = null;
    this.secondaryVideo.srcObject = null;
    this.mode = "none";
    this.primaryDeviceId = null;
    this.secondaryDeviceId = null;
    this.primaryLabel = "";
    this.secondaryLabel = "";
  }

  /**
   * @param {string} deviceId
   * @returns {Promise<MediaStream>}
   */
  async _openDevice(deviceId) {
    const constraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, ...IDEAL }
        : { facingMode: "user", ...IDEAL },
      audio: false,
    };
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Fallback without exact (some Continuity devices flake on exact)
      if (deviceId) {
        return await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { ideal: deviceId }, ...IDEAL },
          audio: false,
        });
      }
      throw err;
    }
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {MediaStream} stream
   */
  async _attach(video, stream) {
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch {
      /* autoplay policy — muted should be fine */
    }
  }

  /**
   * Open a single camera as primary.
   * @param {CamDevice | null} device
   * @param {DualCameraHub['mode']} mode
   */
  async startSingle(device, mode = "device") {
    this.stop();
    const stream = await this._openDevice(device?.deviceId || "");
    this.primaryStream = stream;
    this.primaryDeviceId = device?.deviceId || null;
    this.primaryLabel = device?.label || stream.getVideoTracks()[0]?.label || "Camera";
    this.mode = mode;
    await this._attach(this.primaryVideo, stream);
    return stream;
  }

  async startDesktop() {
    if (!this.devices.length) await this.listDevices();
    const dev = this.findDesktop();
    if (!dev) {
      // Default user-facing camera
      return this.startSingle(null, "desktop");
    }
    return this.startSingle(dev, "desktop");
  }

  /**
   * Launch Continuity Camera (iPhone link). Wakes Continuity when available.
   */
  async startIPhone() {
    if (!this.devices.length) await this.listDevices();
    const dev = this.findIPhone();
    if (!dev) {
      const names = this.devices.map((d) => d.label).join(", ") || "none";
      throw new Error(
        `No iPhone Continuity Camera found. Enable Continuity Camera on iPhone, keep it nearby unlocked, then retry. Seen: ${names}`,
      );
    }
    return this.startSingle(dev, "iphone");
  }

  async startDeskView() {
    if (!this.devices.length) await this.listDevices();
    const dev = this.findDeskView();
    if (!dev) {
      throw new Error(
        "No Desk View camera found. Open Continuity Camera Control Center → Desk View, or use iPhone first.",
      );
    }
    return this.startSingle(dev, "deskview");
  }

  /**
   * Pick a secondary camera that is not primary.
   * Prefer Continuity / Desk View, else any other videoinput.
   * @param {string | null} [excludeId]
   * @param {{ preferDeskView?: boolean }} [opts]
   */
  findSecondaryCandidate(excludeId = null, opts = {}) {
    const excl = excludeId || this.primaryDeviceId;
    const notPrimary = (d) => d && d.deviceId && d.deviceId !== excl;
    if (opts.preferDeskView) {
      const desk = this.devices.find((d) => d.kind === "deskview" && notPrimary(d));
      if (desk) return desk;
    }
    const phone = this.devices.find((d) => d.kind === "iphone" && notPrimary(d));
    if (phone) return phone;
    const cont = this.devices.find(
      (d) => (d.kind === "deskview" || d.kind === "iphone") && notPrimary(d),
    );
    if (cont) return cont;
    // Any other physical camera (USB / virtual) — enables dual without Continuity
    const other = this.devices.find((d) => d.kind === "other" && notPrimary(d));
    if (other) return other;
    // Last resort: second desktop-ish (e.g. two webcams both classified desktop)
    return this.devices.find((d) => notPrimary(d)) || null;
  }

  /**
   * Open two cameras for spatial multi-view.
   * Primary = desktop / person path; secondary = Continuity or any other device.
   * @param {{
   *   preferDeskView?: boolean,
   *   primaryId?: string | null,
   *   secondaryId?: string | null,
   * }} [opts]
   */
  async startDual(opts = {}) {
    if (!this.devices.length) await this.listDevices({ requestPermission: true });

    let primary =
      (opts.primaryId && this.devices.find((d) => d.deviceId === opts.primaryId)) ||
      this.findDesktop();
    let secondary =
      (opts.secondaryId && this.devices.find((d) => d.deviceId === opts.secondaryId)) ||
      this.findSecondaryCandidate(primary?.deviceId, opts);

    // If only one Continuity-style cam and no desktop, use it as primary
    if (!secondary && primary) {
      secondary = this.findSecondaryCandidate(primary.deviceId, opts);
    }
    if (!primary && secondary) {
      primary = this.findDesktop() || this.devices.find((d) => d.deviceId !== secondary.deviceId);
    }
    if (!primary) {
      const names = this.devices.map((d) => d.label).join(", ") || "none";
      throw new Error(`No camera for primary. Seen: ${names}`);
    }
    if (!secondary || secondary.deviceId === primary.deviceId) {
      const names = this.devices.map((d) => d.label).join(", ") || "none";
      throw new Error(
        `Need a second camera for dual (Continuity or USB). Seen: ${names}. Pick Secondary in Cameras, then Open secondary / Open dual.`,
      );
    }

    this.stop();
    // Open secondary first when Continuity (wakes link), else primary first
    const secondaryFirst = isContinuityKind(secondary.kind);
    let secondaryStream;
    let primaryStream;
    try {
      if (secondaryFirst) {
        secondaryStream = await this._openDevice(secondary.deviceId);
        primaryStream = await this._openDevice(primary.deviceId);
      } else {
        primaryStream = await this._openDevice(primary.deviceId);
        secondaryStream = await this._openDevice(secondary.deviceId);
      }
    } catch (err) {
      this._stopTrack(secondaryStream);
      this._stopTrack(primaryStream);
      const msg = err?.message || String(err);
      throw new Error(
        `Dual open failed (${primary.label} + ${secondary.label}): ${msg}. Close other apps using the camera and retry.`,
      );
    }

    this.primaryStream = primaryStream;
    this.secondaryStream = secondaryStream;
    this.primaryDeviceId = primary.deviceId;
    this.secondaryDeviceId = secondary.deviceId;
    this.primaryLabel = primary.label;
    this.secondaryLabel = secondary.label;
    this.mode = "dual";
    this.combine = this.combine === "primary" ? "spatial" : this.combine || "spatial";
    await this._attach(this.primaryVideo, primaryStream);
    await this._attach(this.secondaryVideo, secondaryStream);
    return { primary: primaryStream, secondary: secondaryStream };
  }

  /**
   * Swap / add a secondary camera while keeping primary when possible.
   * @param {string} deviceId
   */
  async startSecondary(deviceId) {
    if (!deviceId) throw new Error("No secondary deviceId");
    if (!this.devices.length) await this.listDevices({ requestPermission: true });
    const dev = this.devices.find((d) => d.deviceId === deviceId);
    if (!dev) throw new Error("Secondary camera not found — refresh device list");
    if (this.primaryDeviceId && deviceId === this.primaryDeviceId) {
      throw new Error("Secondary must be a different camera than primary");
    }

    // If no primary yet, open as dual with desktop + this device
    if (!this.primaryStream) {
      return this.startDual({ secondaryId: deviceId });
    }

    this._stopTrack(this.secondaryStream);
    this.secondaryStream = null;
    this.secondaryVideo.srcObject = null;

    let stream;
    try {
      stream = await this._openDevice(deviceId);
    } catch (err) {
      throw new Error(
        `Could not open ${dev.label}: ${err?.message || err}. Camera may be in use by another app.`,
      );
    }
    this.secondaryStream = stream;
    this.secondaryDeviceId = deviceId;
    this.secondaryLabel = dev.label;
    this.mode = "dual";
    if (this.combine === "primary") this.combine = "spatial";
    await this._attach(this.secondaryVideo, stream);
    return { primary: this.primaryStream, secondary: stream };
  }

  /**
   * Promote a listed device to primary without dropping secondary if different.
   * @param {string} deviceId
   */
  async startPrimary(deviceId) {
    if (!deviceId) return this.startDesktop();
    if (!this.devices.length) await this.listDevices({ requestPermission: true });
    const dev = this.devices.find((d) => d.deviceId === deviceId) || {
      deviceId,
      label: "Camera",
      kind: "other",
    };
    const keepSecondaryId =
      this.secondaryDeviceId && this.secondaryDeviceId !== deviceId
        ? this.secondaryDeviceId
        : null;

    this._stopTrack(this.primaryStream);
    this.primaryStream = null;
    this.primaryVideo.srcObject = null;

    const stream = await this._openDevice(dev.deviceId);
    this.primaryStream = stream;
    this.primaryDeviceId = dev.deviceId;
    this.primaryLabel = dev.label;
    await this._attach(this.primaryVideo, stream);

    if (keepSecondaryId && this.secondaryStream) {
      this.mode = "dual";
    } else if (keepSecondaryId) {
      try {
        await this.startSecondary(keepSecondaryId);
      } catch {
        this.mode = dev.kind === "iphone" ? "iphone" : dev.kind === "deskview" ? "deskview" : "device";
      }
    } else {
      this.mode =
        dev.kind === "iphone" ? "iphone" : dev.kind === "deskview" ? "deskview" : "device";
    }
    return stream;
  }

  /**
   * Draw primary (and optional combine) into target ctx for segmentation.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   * @param {boolean} mirror
   */
  drawPrimary(ctx, w, h, mirror = false) {
    if (this.primaryVideo.readyState < 2) return false;
    ctx.save();
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    if (this.mode === "dual" && this.combine === "sbs" && this.secondaryVideo.readyState >= 2) {
      const half = w / 2;
      ctx.drawImage(this.primaryVideo, 0, 0, half, h);
      ctx.drawImage(this.secondaryVideo, half, 0, half, h);
    } else if (this.mode === "dual" && this.combine === "pip" && this.secondaryVideo.readyState >= 2) {
      ctx.drawImage(this.primaryVideo, 0, 0, w, h);
      const pw = Math.round(w * 0.32);
      const ph = Math.round(h * 0.32);
      ctx.drawImage(this.secondaryVideo, w - pw - 4, 4, pw, ph);
    } else {
      ctx.drawImage(this.primaryVideo, 0, 0, w, h);
    }
    ctx.restore();
    return true;
  }

  /**
   * Draw secondary Continuity feed (no mirror by default — rear cam).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   * @param {boolean} mirror
   */
  drawSecondary(ctx, w, h, mirror = false) {
    if (!this.secondaryStream || this.secondaryVideo.readyState < 2) return false;
    ctx.save();
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.secondaryVideo, 0, 0, w, h);
    ctx.restore();
    return true;
  }

  /** Snapshot both cameras as PNG data URLs (for Splatline multi-view export). */
  async snapshotPair(w = 640, h = 480) {
    const a = document.createElement("canvas");
    const b = document.createElement("canvas");
    a.width = b.width = w;
    a.height = b.height = h;
    const ca = a.getContext("2d");
    const cb = b.getContext("2d");
    const okA = this.drawPrimary(ca, w, h, false);
    const okB = this.drawSecondary(cb, w, h, false);
    return {
      desktop: okA ? a.toDataURL("image/jpeg", 0.92) : null,
      iphone: okB ? b.toDataURL("image/jpeg", 0.92) : null,
      primaryLabel: this.primaryLabel,
      secondaryLabel: this.secondaryLabel,
      mode: this.mode,
    };
  }
}

function shortLabel(label) {
  if (!label) return "?";
  return label.length > 28 ? `${label.slice(0, 26)}…` : label;
}
