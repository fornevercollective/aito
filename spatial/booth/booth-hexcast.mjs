/** hexcast-compatible screen share + BroadcastChannel receive (hexcast-stream). */

export const HEXCAST_CHANNEL = "hexcast-stream";

export class HexcastSource {
  /** @param {HTMLVideoElement} video */
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.channel = null;
    this.mode = "none";
    this.receiving = false;
    this.lastHexMs = 0;
    this.hexResolution = 144;
    this._hexCanvas = document.createElement("canvas");
    this._hexCtx = this._hexCanvas.getContext("2d", { willReadFrequently: true });
    this._frameCanvas = document.createElement("canvas");
    this._frameCtx = this._frameCanvas.getContext("2d", { willReadFrequently: true });
  }

  get active() {
    return this.mode !== "none";
  }

  get label() {
    if (this.mode === "camera") return "Camera";
    if (this.mode === "screen") return "Screen";
    if (this.mode === "hexcast") return "Hexcast";
    return "Off";
  }

  _stopStream() {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  _closeChannel() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.receiving = false;
  }

  stop() {
    this._stopStream();
    this._closeChannel();
    this.mode = "none";
  }

  /**
   * @param {MediaStream} stream
   * @param {string} mode
   * @param {{ keepChannel?: boolean }} [opts]
   */
  useStream(stream, mode, opts = {}) {
    this._stopStream();
    if (!opts.keepChannel) this._closeChannel();
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    this.mode = mode;
    return this.video.play().catch(() => {});
  }

  async startCamera(constraints = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, ...constraints.video },
      audio: false,
      ...constraints,
    });
    await this.useStream(stream, "camera");
    return stream;
  }

  /**
   * Screen / window share. Does not touch other booth sources (dual cam can stay up).
   * @param {{ preferCurrentTab?: boolean }} [opts]
   */
  async startScreen(opts = {}) {
    this._stopStream();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 60 },
        displaySurface: "monitor",
        // Browser may ignore; still request window/tab flexibility
        ...(opts.preferCurrentTab ? { displaySurface: "browser" } : {}),
      },
      audio: false,
      preferCurrentTab: !!opts.preferCurrentTab,
    });
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (this.mode === "screen") this.stop();
    });
    await this.useStream(stream, "screen", { keepChannel: false });
    return stream;
  }

  get isScreen() {
    return this.mode === "screen" && this.video?.readyState >= 2;
  }

  /** Listen for hexcast.html / hexcast-send BroadcastChannel frames. */
  startReceive() {
    this._stopStream();
    this._closeChannel();
    this.mode = "hexcast";
    this.receiving = true;
    this.channel = new BroadcastChannel(HEXCAST_CHANNEL);
    this.channel.onmessage = (e) => this._onMessage(e.data);
    return true;
  }

  _onMessage(data) {
    if (!data || typeof data !== "object") return;
    if (data.type === "hexframe" || data.type === "hex-frame") {
      const hex = data.hex instanceof Uint8Array ? data.hex : new Uint8Array(data.hex || []);
      const res = data.res || data.resolution || this.hexResolution;
      this._renderHex(hex, res);
      this.lastHexMs = performance.now();
      return;
    }
    if (data.type === "frame" && data.b64) {
      this._renderJpeg(data.b64, data.w, data.h);
      this.lastHexMs = performance.now();
    }
  }

  _renderHex(hex, res) {
    if (!hex.length || res <= 0) return;
    this.hexResolution = res;
    this._hexCanvas.width = res;
    this._hexCanvas.height = res;
    const img = this._hexCtx.createImageData(res, res);
    const n = Math.min(hex.length, res * res);
    for (let i = 0; i < n; i++) {
      const v = hex[i];
      const o = i * 4;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
    this._hexCtx.putImageData(img, 0, 0);
  }

  _renderJpeg(b64, w, h) {
    const img = new Image();
    img.onload = () => {
      this._frameCanvas.width = w || img.width;
      this._frameCanvas.height = h || img.height;
      this._frameCtx.drawImage(img, 0, 0);
      this.lastHexMs = performance.now();
    };
    img.src = `data:image/jpeg;base64,${b64}`;
  }

  /** Draw current source into target canvas (video, screen, or decoded hex). */
  drawTo(ctx, w, h, mirror = false) {
    if (this.mode === "hexcast") {
      const age = performance.now() - this.lastHexMs;
      if (age > 3000) return false;
      const src = this._hexCanvas.width > 0 ? this._hexCanvas : this._frameCanvas;
      if (!src.width) return false;
      ctx.save();
      if (mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(src, 0, 0, w, h);
      ctx.restore();
      return true;
    }
    if (this.video.readyState < 2) return false;
    ctx.save();
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.video, 0, 0, w, h);
    ctx.restore();
    return true;
  }

  /** Minimal window.hexcast shim for cross-tab scripts. */
  exposeApi() {
    window.hexcast = window.hexcast || {};
    window.hexcast.booth = {
      source: this,
      startScreen: () => this.startScreen(),
      startReceive: () => this.startReceive(),
      stop: () => this.stop(),
      get state() {
        return { source: this.source.mode, receiving: this.source.receiving, label: this.source.label };
      },
    };
  }
}