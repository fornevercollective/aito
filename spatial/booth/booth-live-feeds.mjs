/**
 * Live video feeds for aito-mac booth — Qbpm live-video-rail + blank multiview patterns.
 *
 * - Paste YouTube / Vimeo / X / Twitch / HLS / mp4 URLs
 * - Local media via ffmpeg (any codec) · image sequences · alternate FPS
 * - X.com status links resolve to video.twimg mp4/HLS via FxTwitter (drawable frames)
 * - Tab rail (one active player — RAM-safe)
 * - Drawable sources → stage into gsplat sample pipeline
 * - Iframe sources (YT/Twitch) preview only (CORS); stage needs drawable URL
 */

import {
  appendUniqueLiveVideos,
  parsePasteToItems,
  liveVideoDedupeKey,
  resolveXStatusMedia,
} from "./booth-video-embed.mjs";

/** Force through booth ffmpeg (codecs / containers HTML5 won't play natively). */
const FF_EXT =
  /\.(mkv|avi|m2ts|mts|ts|flv|wmv|asf|mpeg|mpg|vob|mxf|r3d|braw|rm|rmvb|3gp|3g2|f4v|ogv|divx|xvid|nut|yuv|y4m|dv|m2v|hevc|h265|av1|ivf|prores|mka|mp3|aac|m4a|wav|flac|ogg|opus|wma|aiff|aif|ac3|eac3|dts|caf|png|jpe?g|webp|tif{1,2}|bmp|exr|dpx|tga|hdr|heic)$/i;

const IMAGE_EXT = /\.(png|jpe?g|webp|tif{1,2}|bmp|gif|exr|dpx|tga|hdr|heic)$/i;

const FPS_PRESETS = [
  "native",
  "12",
  "15",
  "23.976",
  "24",
  "25",
  "29.97",
  "30",
  "48",
  "50",
  "59.94",
  "60",
  "90",
  "120",
  "144",
  "240",
];

let hlsCtorPromise = null;

async function loadHls() {
  if (globalThis.Hls) return globalThis.Hls;
  if (!hlsCtorPromise) {
    hlsCtorPromise = import("https://cdn.jsdelivr.net/npm/hls.js@1.5.17/+esm")
      .then((m) => m.default || m.Hls || m)
      .catch((e) => {
        hlsCtorPromise = null; // allow retry on next call
        console.warn("[live] hls.js load failed", e);
        return null;
      });
  }
  return hlsCtorPromise;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class LiveFeedHub {
  /**
   * @param {{
   *   video: HTMLVideoElement,
   *   onStatus?: (msg: string, err?: boolean) => void,
   *   onStage?: (active: boolean) => void,
   *   onChange?: () => void,
   *   onFloatVisible?: (visible: boolean) => void,
   *   getFloatVisible?: () => boolean,
   * }} opts
   */
  constructor(opts) {
    this.video = opts.video;
    this.onStatus = opts.onStatus || (() => {});
    this.onStage = opts.onStage || (() => {});
    this.onChange = opts.onChange || (() => {});
    this.onFloatVisible = opts.onFloatVisible || (() => {});
    this.getFloatVisible = opts.getFloatVisible || (() => true);
    /** @type {Array<any>} */
    this.items = [];
    this.activeId = null;
    /** When true, drawable active feed drives booth sample canvas */
    this.staging = false;
    this.mode = "none"; // none | preview | stage
    /** @type {any} */
    this._hls = null;
    this._objectUrl = null;
    /** @type {HTMLImageElement | null} still frame for X photos / failed video poster */
    this._imageEl = null;
    this._resolving = false;
    this.host = null;
    /** Global alternate frame rate for ffmpeg streams (null = native) */
    this.fps = null;
  }

  get fpsParam() {
    return this.fps == null || this.fps === "native" ? null : this.fps;
  }

  /** True when staged into the spatial sample path (readyState may still be loading). */
  get active() {
    return !!(this.staging && this.mode === "stage" && this.video);
  }

  /** True when video/still has frames ready to draw. */
  get hasFrame() {
    if (this._imageEl && this._imageEl.naturalWidth > 0) return true;
    return !!(this.video && this.video.readyState >= 2 && this.video.videoWidth > 0);
  }

  get label() {
    const a = this.getActive();
    if (!a) return "Live off";
    if (this.staging) {
      return this.hasFrame ? `Live · ${a.label}` : `Live · loading ${a.label}`;
    }
    return `Preview · ${a.label}`;
  }

  getActive() {
    return this.items.find((x) => x.id === this.activeId) || null;
  }

  mount(hostEl) {
    this.host = hostEl;
    if (!hostEl) return;
    hostEl.innerHTML = `
      <div class="lvr" aria-label="Live video feeds">
        <div class="lvr-hd">
          <span class="lvr-title">live feeds</span>
          <span class="lvr-badge" id="lvr-badge">0</span>
          <button type="button" class="booth-btn lvr-clear" title="Clear all">clear</button>
        </div>
        <div class="lvr-paste-row">
          <textarea class="lvr-paste" rows="2" spellcheck="false"
            placeholder="URL · ~/clip.mkv · ~/frames/ · frame_%04d.png · audio · x.com"></textarea>
          <button type="button" class="booth-btn lvr-add" title="Add feeds">Add</button>
        </div>
        <div class="lvr-fps-row" title="Frame rate for ffmpeg stream / sequences">
          <span class="lvr-fps-label">FPS</span>
          <select class="booth-select lvr-fps" id="lvr-fps" aria-label="Frame rate">
            ${FPS_PRESETS.map(
              (f) =>
                `<option value="${f}"${f === "native" ? " selected" : ""}>${f === "native" ? "native" : f + " fps"}</option>`,
            ).join("")}
          </select>
          <button type="button" class="booth-btn booth-btn--tiny lvr-fps-apply" title="Re-stream active feed at selected FPS">Apply FPS</button>
        </div>
        <div class="lvr-tabs" role="tablist" aria-label="Feed sources"></div>
        <div class="lvr-player" aria-live="polite">
          <div class="lvr-empty">any codec · image seq · FPS · Stage / FFplay</div>
        </div>
        <div class="lvr-tools">
          <button type="button" class="booth-btn lvr-stage" title="Send drawable feed into gsplat stage">→ Stage</button>
          <button type="button" class="booth-btn lvr-unstage" title="Stop staging" disabled>Unstage</button>
          <button type="button" class="booth-btn lvr-file" title="Open local video / audio / image">File</button>
          <button type="button" class="booth-btn lvr-seq" title="Open image sequence (multi-select frames)">Seq</button>
          <button type="button" class="booth-btn lvr-ffplay" title="Play active source in external ffplay / repel" disabled>FFplay</button>
          <input type="file" class="lvr-file-input" accept="video/*,audio/*,image/*,.mkv,.mp4,.webm,.mov,.m3u8,.avi,.m4v,.mxf,.ts,.m2ts,.wmv,.flv,.hevc,.prores,.wav,.flac,.exr,.dpx,.tga" hidden>
          <input type="file" class="lvr-seq-input" accept="image/*,.png,.jpg,.jpeg,.webp,.tif,.tiff,.exr,.dpx,.tga,.bmp,.gif" multiple hidden>
        </div>
        <div class="lvr-playback" id="lvr-playback" aria-label="Staged video playback">
          <button type="button" class="booth-btn lvr-play" title="Play staged video" disabled>Play</button>
          <button type="button" class="booth-btn lvr-pause" title="Pause staged video" disabled>Pause</button>
          <button type="button" class="booth-btn lvr-stop-vid" title="Stop and rewind staged video" disabled>Stop</button>
          <button type="button" class="booth-btn lvr-float-vis" title="Show or hide floating center player" disabled>Hide float</button>
          <span class="lvr-playback-stat" id="lvr-playback-stat">—</span>
        </div>
        <p class="lvr-hint">ffmpeg: all codecs · image sequences · FPS override · FFplay. X.com → Stage. YT/Twitch preview only.</p>
      </div>`;
    this._bind();
    this.render();
  }

  _bind() {
    const h = this.host;
    h?.querySelector(".lvr-add")?.addEventListener("click", () => this.addFromPaste());
    h?.querySelector(".lvr-paste")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        this.addFromPaste();
      }
    });
    h?.querySelector(".lvr-clear")?.addEventListener("click", () => this.clearAll());
    h?.querySelector(".lvr-stage")?.addEventListener("click", () => this.stageActive().catch((e) => this.onStatus(e.message, true)));
    h?.querySelector(".lvr-unstage")?.addEventListener("click", () => this.unstage());
    h?.querySelector(".lvr-file")?.addEventListener("click", () => h.querySelector(".lvr-file-input")?.click());
    h?.querySelector(".lvr-seq")?.addEventListener("click", () => h.querySelector(".lvr-seq-input")?.click());
    h?.querySelector(".lvr-file-input")?.addEventListener("change", (ev) => {
      const file = ev.target.files?.[0];
      if (file) void this.addLocalFile(file);
      ev.target.value = "";
    });
    h?.querySelector(".lvr-seq-input")?.addEventListener("change", (ev) => {
      const files = [...(ev.target.files || [])];
      if (files.length) void this.addImageSequence(files);
      ev.target.value = "";
    });
    h?.querySelector(".lvr-fps")?.addEventListener("change", (ev) => {
      const v = ev.target.value;
      this.fps = v === "native" ? null : v;
    });
    h?.querySelector(".lvr-fps-apply")?.addEventListener("click", () => {
      void this.applyFpsToActive().catch((e) => this.onStatus(e?.message || "FPS apply failed", true));
    });
    h?.querySelector(".lvr-ffplay")?.addEventListener("click", () => {
      void this.ffplayActive().catch((e) => this.onStatus(e?.message || "FFplay failed", true));
    });
    h?.querySelector(".lvr-play")?.addEventListener("click", () => this.playVideo());
    h?.querySelector(".lvr-pause")?.addEventListener("click", () => this.pauseVideo());
    h?.querySelector(".lvr-stop-vid")?.addEventListener("click", () => this.stopVideo());
    h?.querySelector(".lvr-float-vis")?.addEventListener("click", () => this.toggleFloatVisible());
    // Keep play/pause UI in sync with media element
    if (this.video && !this._playbackBound) {
      this._playbackBound = true;
      const sync = () => this._syncPlaybackUi();
      this.video.addEventListener("play", sync);
      this.video.addEventListener("pause", sync);
      this.video.addEventListener("ended", sync);
      this.video.addEventListener("timeupdate", () => {
        // throttle: only update stat every ~0.5s via render path
        if (!this._lastStatMs || performance.now() - this._lastStatMs > 400) {
          this._lastStatMs = performance.now();
          this._syncPlaybackUi();
        }
      });
    }
  }

  /** Whether playback controls apply (staged drawable, or preview with video loaded). */
  get canControlPlayback() {
    const a = this.getActive();
    if (!a?.drawable) return false;
    if (a.kind === "image") return false; // still frame — no transport
    return !!(this.video && (this.staging || this.mode === "preview"));
  }

  playVideo() {
    if (!this.video || !this.canControlPlayback) return;
    this.video.play?.().then(() => {
      this.onStatus(`Play · ${this.getActive()?.label || "live"}`);
      this._syncPlaybackUi();
      this.onChange();
    }).catch((e) => this.onStatus(e?.message || "Play failed", true));
  }

  pauseVideo() {
    if (!this.video || !this.canControlPlayback) return;
    this.video.pause?.();
    this.onStatus(`Pause · ${this.getActive()?.label || "live"}`);
    this._syncPlaybackUi();
    this.onChange();
  }

  /** Stop = pause + seek to start (keeps staged so cloud path stays live). */
  stopVideo() {
    if (!this.video || !this.canControlPlayback) return;
    this.video.pause?.();
    try {
      this.video.currentTime = 0;
    } catch {
      /* live HLS may not allow seek */
    }
    this.onStatus(`Stop · ${this.getActive()?.label || "live"}`);
    this._syncPlaybackUi();
    this.onChange();
  }

  /** Toggle floating center video plane visibility (floor stays). */
  toggleFloatVisible() {
    const next = !this.getFloatVisible();
    this.onFloatVisible(next);
    this.onStatus(next ? "Float player · view" : "Float player · hide");
    this._syncPlaybackUi();
    this.onChange();
  }

  setFloatVisible(visible) {
    this.onFloatVisible(!!visible);
    this._syncPlaybackUi();
  }

  _syncPlaybackUi() {
    const h = this.host;
    if (!h) return;
    const can = this.canControlPlayback;
    const v = this.video;
    const playing = !!(v && !v.paused && !v.ended && v.readyState > 2);
    const playBtn = h.querySelector(".lvr-play");
    const pauseBtn = h.querySelector(".lvr-pause");
    const stopBtn = h.querySelector(".lvr-stop-vid");
    const floatBtn = h.querySelector(".lvr-float-vis");
    const wrap = h.querySelector(".lvr-playback");
    const stat = h.querySelector("#lvr-playback-stat");
    const floatOn = this.getFloatVisible();

    if (wrap) wrap.classList.toggle("lvr-playback--on", can && this.staging);
    if (playBtn) {
      playBtn.disabled = !can || playing;
      playBtn.classList.toggle("booth-btn--on", can && playing);
    }
    if (pauseBtn) {
      pauseBtn.disabled = !can || !playing;
      pauseBtn.classList.toggle("booth-btn--on", can && !playing && this.staging);
    }
    if (stopBtn) stopBtn.disabled = !can;
    if (floatBtn) {
      // Enable once staged (float plane is a staged feature)
      floatBtn.disabled = !this.staging;
      floatBtn.textContent = floatOn ? "Hide float" : "View float";
      floatBtn.title = floatOn
        ? "Hide floating center player (floor video stays)"
        : "Show floating center player";
      floatBtn.classList.toggle("booth-btn--on", this.staging && floatOn);
      floatBtn.classList.toggle("lvr-float-vis--hidden", this.staging && !floatOn);
    }

    if (stat) {
      if (!can && !this.staging) {
        stat.textContent = "stage first";
      } else if (!can) {
        stat.textContent = "…";
      } else {
        const floatTag = floatOn ? "float on" : "float off";
        if (playing) {
          const t = Number.isFinite(v.currentTime) ? v.currentTime : 0;
          const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
          stat.textContent = d
            ? `▶ ${fmtTime(t)} / ${fmtTime(d)} · ${floatTag}`
            : `▶ live ${fmtTime(t)} · ${floatTag}`;
        } else {
          stat.textContent = `❚❚ paused · ${floatTag}`;
        }
      }
    }
  }

  addFromPaste() {
    const ta = this.host?.querySelector(".lvr-paste");
    const text = ta?.value || "";
    const next = parsePasteToItems(text);
    if (!next.length) {
      this.onStatus("No supported URLs (X · YT · MKV path · mp4 · m3u8)", true);
      return;
    }
    const { merged, focusLastId } = appendUniqueLiveVideos(this.items, next);
    this.items = merged;
    if (focusLastId) this.activeId = focusLastId;
    else if (!this.activeId && this.items[0]) this.activeId = this.items[0].id;
    if (ta) ta.value = "";
    this.render();
    this.onStatus(`Live feeds · ${this.items.length} source${this.items.length === 1 ? "" : "s"}`);
    this.onChange();
    // Resolve X.com + open local MKV paths via ffmpeg API
    void this.resolvePendingMedia().then(() => {
      void this.loadActivePreview();
      this.onChange();
    });
  }

  /**
   * Turn pending X status embeds into drawable mp4/HLS/image items.
   * Multi-video posts expand into multiple rail tabs.
   */
  async resolvePendingMedia() {
    // Local MKV / absolute paths first (ffmpeg open)
    await this.resolveLocalMedia();

    const pending = this.items.filter((x) => x.needsResolve && x.platform === "x" && x.statusId);
    if (!pending.length) return;
    this._resolving = true;
    this.render();
    const expanded = [];
    const keepIds = new Set(this.items.map((x) => x.id));

    for (const item of pending) {
      this.onStatus(`Resolving X · ${item.statusId}…`);
      try {
        const media = await resolveXStatusMedia(item.statusId, item.handle);
        const usable = (media || []).filter((m) => m?.src);
        if (!usable.length) {
          item.needsResolve = false;
          item.note = "No media on this post — embed preview only";
          item.drawable = false;
          continue;
        }
        // Prefer videos/gifs over photos for primary slot
        usable.sort((a, b) => {
          const score = (m) =>
            m.mediaType === "video" || m.kind === "video" || m.kind === "hls"
              ? 0
              : m.mediaType === "gif"
                ? 1
                : 2;
          return score(a) - score(b);
        });

        const applyTo = (target, m, idx) => {
          target.kind = m.kind;
          target.platform = "x";
          target.src = m.src;
          target.label = m.label || target.label;
          target.drawable = true;
          target.needsResolve = false;
          target.note = null;
          target.thumbnail = m.thumbnail || null;
          target.statusId = item.statusId;
          target.handle = item.handle;
          target.mediaType = m.mediaType || null;
          target.original = item.original;
          if (idx > 0) {
            target.id = `lv-x-${item.statusId}-${idx}-${String(m.src).slice(-12).replace(/\W/g, "")}`;
          }
        };

        applyTo(item, usable[0], 0);
        for (let i = 1; i < usable.length; i++) {
          const extra = {
            id: `lv-x-${item.statusId}-${i}`,
            kind: "video",
            platform: "x",
            src: "",
            label: "",
            drawable: true,
            needsResolve: false,
            original: item.original,
            statusId: item.statusId,
            handle: item.handle,
          };
          applyTo(extra, usable[i], i);
          if (!keepIds.has(extra.id)) {
            expanded.push(extra);
            keepIds.add(extra.id);
          }
        }
        const nVid = usable.filter((m) => m.kind === "video" || m.kind === "hls").length;
        this.onStatus(
          nVid
            ? `X · ${item.label} · ${nVid} video${nVid > 1 ? "s" : ""} ready`
            : `X · ${item.label} · still frame ready`,
        );
      } catch (err) {
        item.needsResolve = false;
        item.drawable = false;
        item.note = err?.message || "X resolve failed — embed only";
        this.onStatus(`X resolve failed · ${item.statusId}: ${item.note}`, true);
        console.warn("[live] resolve X", item.statusId, err);
      }
    }

    if (expanded.length) {
      this.items = [...this.items, ...expanded];
    }
    this._resolving = false;
    this.render();
  }

  _streamUrl(infoOrId, mode) {
    const id = typeof infoOrId === "string" ? infoOrId : infoOrId?.id;
    if (!id) return null;
    const sp = new URLSearchParams({ id });
    if (mode) sp.set("mode", mode);
    if (this.fpsParam) sp.set("fps", String(this.fpsParam));
    return `/api/media/stream?${sp}`;
  }

  _itemFromMediaInfo(info, name, platform = "ffmpeg") {
    const stream = this._streamUrl(info) || info.stream;
    const fpsTag = this.fpsParam ? ` · ${this.fpsParam}fps` : "";
    return {
      id: `lv-ff-${info.id || Date.now()}`,
      kind: "video",
      platform,
      src: stream,
      streamSrc: stream,
      streamTranscode: this._streamUrl(info, "transcode") || info.streamTranscode || null,
      mediaId: info.id,
      mediaKind: info.kind || null,
      label: `${platform === "sequence" ? "Seq" : "FF"} · ${(name || info.name || "media").slice(0, 20)}${fpsTag}`,
      drawable: true,
      needsFfmpeg: true,
      original: name || info.name,
      fileName: name || info.name,
      fps: this.fpsParam,
      sequence: info.sequence || null,
    };
  }

  /**
   * Local file picker — non-browser codecs/containers go through ffmpeg upload stream.
   * Multi-image pick uses sequence path.
   */
  async addLocalFile(file) {
    if (!file) return;
    const name = file.name || "video";
    const forceFf =
      FF_EXT.test(name) ||
      /matroska|x-msvideo|mpegts|mxf|quicktime|audio\/|image\//i.test(file.type || "");

    if (forceFf) {
      this.onStatus(`Uploading · ${name}…`);
      try {
        const info = await this._uploadMediaFile(file);
        const item = this._itemFromMediaInfo(info, name, IMAGE_EXT.test(name) ? "ffmpeg" : "ffmpeg");
        const { merged } = appendUniqueLiveVideos(this.items, [item]);
        this.items = merged;
        this.activeId = item.id;
        this.render();
        void this.loadActivePreview();
        this.onStatus(`ffmpeg stream · ${name}${this.fpsParam ? ` · ${this.fpsParam}fps` : ""}`);
        this.onChange();
      } catch (e) {
        this.onStatus(e?.message || "upload failed", true);
      }
      return;
    }

    if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
    this._objectUrl = URL.createObjectURL(file);
    const item = {
      id: `lv-file-${Date.now()}`,
      kind: "video",
      platform: "file",
      src: this._objectUrl,
      label: name.slice(0, 28),
      drawable: true,
      original: name,
      fileName: name,
    };
    const { merged } = appendUniqueLiveVideos(this.items, [item]);
    this.items = merged;
    this.activeId = item.id;
    this.render();
    void this.loadActivePreview();
    this.onStatus(`File · ${name}`);
    this.onChange();
  }

  /** Multi-select image frames → upload each, open as sequence via server paths. */
  async addImageSequence(files) {
    const list = [...files].filter((f) => IMAGE_EXT.test(f.name || "") || (f.type || "").startsWith("image/"));
    if (list.length < 1) {
      this.onStatus("No images in selection", true);
      return;
    }
    // Sort by name for stable order
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    this.onStatus(`Sequence · uploading ${list.length} frames…`);
    try {
      const paths = [];
      for (const f of list) {
        const info = await this._uploadMediaFile(f);
        // Server keeps upload under media root; re-open by probing path from probe API
        const probe = await fetch(`/api/media/probe?id=${encodeURIComponent(info.id)}`).then((r) => r.json());
        if (probe.path) paths.push(probe.path);
      }
      if (!paths.length) throw new Error("upload produced no paths");
      const fps = this.fpsParam || 24;
      const res = await fetch("/api/media/sequence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: paths, fps }),
      });
      const info = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(info.error || `sequence HTTP ${res.status}`);
      const item = this._itemFromMediaInfo(info, `${list.length} frames`, "sequence");
      item.fps = fps;
      const { merged } = appendUniqueLiveVideos(this.items, [item]);
      this.items = merged;
      this.activeId = item.id;
      this.render();
      void this.loadActivePreview();
      this.onStatus(`Sequence · ${list.length}f · ${fps}fps`);
      this.onChange();
    } catch (e) {
      this.onStatus(e?.message || "sequence failed", true);
    }
  }

  async _uploadMediaFile(file) {
    const q = new URLSearchParams({ name: file.name || "upload.bin" });
    if (this.fpsParam) q.set("fps", String(this.fpsParam));
    const res = await fetch(`/api/media/upload?${q}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": file.name || "upload.bin",
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `upload HTTP ${res.status}`);
    if (!data.stream) throw new Error("upload missing stream URL");
    return data;
  }

  async _openLocalPath(absPath, extra = {}) {
    const body = {
      path: absPath,
      fps: this.fpsParam ?? extra.fps,
      kind: extra.kind,
      start: extra.start,
    };
    const res = await fetch("/api/media/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `open HTTP ${res.status}`);
    if (!data.stream) throw new Error("open missing stream URL");
    return data;
  }

  /** Re-bind active media stream at selected FPS. */
  async applyFpsToActive() {
    const a = this.getActive();
    const sel = this.host?.querySelector(".lvr-fps");
    if (sel) this.fps = sel.value === "native" ? null : sel.value;

    if (!a) {
      this.onStatus(`FPS · ${this.fpsParam || "native"} (next open)`);
      return;
    }

    if (a.mediaId) {
      const res = await fetch("/api/media/fps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.mediaId, fps: this.fpsParam ?? "native" }),
      });
      const info = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(info.error || `fps HTTP ${res.status}`);
      a.streamSrc = this._streamUrl(info) || info.stream;
      a.streamTranscode = this._streamUrl(info, "transcode") || info.streamTranscode;
      a.src = a.streamSrc;
      a.fps = this.fpsParam;
      a.label = a.label.replace(/\s·\s[\d.]+fps/, "") + (this.fpsParam ? ` · ${this.fpsParam}fps` : "");
      this.render();
      if (this.staging) await this.stageActive();
      else await this.loadActivePreview();
      this.onStatus(`FPS · ${this.fpsParam || "native"} · ${a.label}`);
      this.onChange();
      return;
    }

    // Browser-native file: use HTML playbackRate as approximation for common ratios
    if (this.video && a.platform === "file" && this.fpsParam) {
      // Can't know native fps without probe — set rate 1.0 and note user needs ffmpeg path
      this.onStatus("FPS override needs ffmpeg source (File exotic / path paste / Seq)", true);
      return;
    }
    this.onStatus(`FPS · ${this.fpsParam || "native"}`);
  }

  /** Resolve local paths / sequences into streamable booth sources. */
  async resolveLocalMedia() {
    const pending = this.items.filter(
      (x) =>
        (x.needsMediaOpen && x.localPath) ||
        (x.needsFfmpeg &&
          (x.platform === "mkv" || x.platform === "ffmpeg" || x.platform === "sequence") &&
          !x.mediaId &&
          x.src &&
          !x.src.startsWith("/api/")),
    );
    if (!pending.length) return;

    for (const item of pending) {
      try {
        let info = null;
        if (item.localPath || (item.src && /^(\/|~\/|file:\/\/)/.test(item.src))) {
          const p = item.localPath || item.src;
          this.onStatus(`FFmpeg open · ${item.label}…`);
          info = await this._openLocalPath(p, {
            kind: item.mediaKind === "sequence" || item.platform === "sequence" ? "sequence" : undefined,
          });
        } else if (/^https?:\/\//i.test(item.src || "")) {
          item.note = "Remote file · use FFplay (browser stream needs local path)";
          item.drawable = false;
          item.needsFfmpeg = true;
          item.remoteMkv = item.src;
          continue;
        }
        if (info) {
          item.mediaId = info.id;
          item.streamSrc = this._streamUrl(info) || info.stream;
          item.streamTranscode = this._streamUrl(info, "transcode") || info.streamTranscode || null;
          item.src = item.streamSrc;
          item.drawable = true;
          item.needsMediaOpen = false;
          item.needsFfmpeg = true;
          item.platform = info.kind === "sequence" ? "sequence" : "ffmpeg";
          item.sequence = info.sequence || null;
          item.fps = this.fpsParam;
          item.note = null;
          this.onStatus(`Ready · ${item.label}${this.fpsParam ? ` · ${this.fpsParam}fps` : ""}`);
        }
      } catch (err) {
        item.drawable = false;
        item.note = err?.message || "ffmpeg open failed";
        this.onStatus(`Open failed · ${item.note}`, true);
      }
    }
    this.render();
  }

  /**
   * Launch external ffplay/repel for the active feed.
   */
  async ffplayActive() {
    const a = this.getActive();
    if (!a) throw new Error("No active feed");

    // Native app bridge first
    if (window.aitoMac?.repelPlay) {
      const source = a.localPath || a.remoteMkv || a.original || a.src;
      if (source && !String(source).startsWith("blob:") && !String(source).startsWith("/api/")) {
        window.aitoMac.repelPlay(source);
        this.onStatus(`FFplay (native) · ${a.label}`);
        return;
      }
    }

    const body = { fps: this.fpsParam ?? undefined };
    if (a.mediaId) body.id = a.mediaId;
    else if (a.localPath) body.path = a.localPath;
    else if (a.remoteMkv) body.url = a.remoteMkv;
    else if (a.original && /^(\/|~\/|https?:|file:)/i.test(a.original)) body.path = a.original;
    else if (a.src && /^https?:\/\//i.test(a.src)) body.url = a.src;
    else if (a.src && a.src.includes("/api/media/stream")) {
      const m = a.src.match(/[?&]id=([^&]+)/);
      if (m) body.id = decodeURIComponent(m[1]);
    }

    if (!body.id && !body.path && !body.url) {
      throw new Error("FFplay needs path, media id, or http URL (not blob:)");
    }

    const res = await fetch("/api/media/ffplay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, title: `aito-mac · ${a.label}` }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `ffplay HTTP ${res.status}`);
    this.onStatus(`FFplay · ${data.tool || "ffplay"} · ${a.label}${data.fps ? ` · ${data.fps}fps` : ""}`);
  }

  clearAll() {
    this.unstage();
    this._destroyHls();
    this.items = [];
    this.activeId = null;
    this.render();
    this.onStatus("Live feeds cleared");
    this.onChange();
  }

  removeItem(id) {
    this.items = this.items.filter((x) => x.id !== id);
    if (this.activeId === id) {
      this.activeId = this.items[0]?.id || null;
      if (this.staging) this.unstage();
    }
    this.render();
    void this.loadActivePreview();
    this.onChange();
  }

  setActive(id) {
    this.activeId = id;
    if (this.staging) {
      // re-stage new drawable if possible
      void this.stageActive().catch(() => this.unstage());
    } else {
      void this.loadActivePreview();
    }
    this.render();
    this.onChange();
  }

  render() {
    const h = this.host;
    if (!h) return;
    const badge = h.querySelector("#lvr-badge");
    if (badge) badge.textContent = String(this.items.length);

    const tabs = h.querySelector(".lvr-tabs");
    if (tabs) {
      tabs.innerHTML = this.items
        .map((item, i) => {
          const on = item.id === this.activeId;
          const tag = item.drawable ? "●" : "◌";
          return `<button type="button" class="lvr-tab${on ? " lvr-tab--on" : ""}" role="tab"
            data-id="${esc(item.id)}" aria-selected="${on}">
            <span class="lvr-tab-tag">${tag}</span>
            <span>${esc(item.label || `src ${i + 1}`)}</span>
            <span class="lvr-tab-x" data-rm="${esc(item.id)}" title="Remove">×</span>
          </button>`;
        })
        .join("");
      tabs.querySelectorAll(".lvr-tab").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          if (ev.target?.classList?.contains("lvr-tab-x")) return;
          this.setActive(btn.dataset.id);
        });
      });
      tabs.querySelectorAll(".lvr-tab-x").forEach((x) => {
        x.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.removeItem(x.dataset.rm);
        });
      });
    }

    const stageBtn = h.querySelector(".lvr-stage");
    const unstageBtn = h.querySelector(".lvr-unstage");
    const ffplayBtn = h.querySelector(".lvr-ffplay");
    const active = this.getActive();
    if (stageBtn) {
      const canStage = !!(active?.drawable && !active.needsResolve && !active.needsMediaOpen);
      stageBtn.disabled = !canStage;
      stageBtn.classList.toggle("booth-btn--on", this.staging);
      stageBtn.title = active?.needsResolve
        ? "Resolving X media…"
        : active?.needsMediaOpen
          ? "Opening local MKV via ffmpeg…"
          : canStage
            ? "Send drawable feed into gsplat stage"
            : "Needs drawable source (X video / MKV stream / mp4 / HLS)";
    }
    if (unstageBtn) unstageBtn.disabled = !this.staging;
    if (ffplayBtn) {
      const canFf =
        !!active &&
        !!(
          active.mediaId ||
          active.localPath ||
          active.remoteMkv ||
          (active.original && /^(\/|~\/|https?:|file:)/i.test(active.original)) ||
          (active.src && /^https?:\/\//i.test(active.src) && active.platform !== "file") ||
          (active.src && active.src.includes("/api/media/stream"))
        );
      ffplayBtn.disabled = !canFf;
      ffplayBtn.classList.toggle(
        "booth-btn--on",
        !!(
          active &&
          (active.platform === "mkv" ||
            active.platform === "ffmpeg" ||
            active.platform === "sequence" ||
            active.needsFfmpeg)
        ),
      );
      ffplayBtn.title = canFf
        ? "Play in external ffplay / repel window"
        : "FFplay needs local path, media id, or http URL";
    }
    this._syncPlaybackUi();

    // Player area: if staging, show status; else show iframe or note
    const player = h.querySelector(".lvr-player");
    if (!player) return;
    if (!active) {
      player.innerHTML =
        '<div class="lvr-empty">paste x.com/status/… · multi-source rail · → Stage for cloud</div>';
      return;
    }
    if (active.needsResolve || (this._resolving && active.platform === "x" && !active.drawable)) {
      player.innerHTML = `<div class="lvr-stage-banner lvr-stage-banner--idle">
        <strong>Resolving X…</strong> · ${esc(active.statusId || active.label)} · pulling video frames
      </div>`;
      return;
    }
    if (active.kind === "iframe") {
      const note = active.note
        ? esc(active.note)
        : active.platform === "x"
          ? "X embed fallback · video resolve failed. Try another link."
          : "Embed preview · not sampleable (CORS). Use mp4/HLS or x.com for Stage.";
      player.innerHTML = `<iframe class="lvr-iframe" title="${esc(active.label)}"
        src="${esc(active.src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>
        <p class="lvr-note">${note}</p>`;
    } else if (active.kind === "image") {
      player.innerHTML = `<div class="lvr-x-still">
        <img class="lvr-x-thumb" src="${esc(active.src)}" alt="${esc(active.label)}" referrerpolicy="no-referrer" />
        <div class="lvr-stage-banner lvr-stage-banner--idle">
          <strong>X still</strong> · ${esc(active.label)} · → Stage for cloud frames
        </div>
      </div>`;
    } else if (
      active.needsMediaOpen ||
      ((active.platform === "mkv" || active.platform === "ffmpeg" || active.platform === "sequence") &&
        !active.drawable &&
        active.note)
    ) {
      player.innerHTML = `<div class="lvr-stage-banner lvr-stage-banner--idle">
        <strong>ffmpeg</strong> · ${esc(active.label)} · ${esc(active.note || "opening…")}
      </div>`;
    } else if (this.staging) {
      const ff =
        active.platform === "mkv" ||
        active.platform === "ffmpeg" ||
        active.platform === "sequence"
          ? " · ffmpeg"
          : "";
      const fps = active.fps || this.fpsParam ? ` · ${active.fps || this.fpsParam}fps` : "";
      player.innerHTML = `<div class="lvr-stage-banner">
        <strong>On stage</strong> · ${esc(active.label)} · feeding gsplat sample${ff}${fps}
        ${active.thumbnail ? `<img class="lvr-x-thumb lvr-x-thumb--sm" src="${esc(active.thumbnail)}" alt="" referrerpolicy="no-referrer" />` : ""}
      </div>`;
    } else {
      const kindTag =
        active.platform === "x"
          ? "X video"
          : active.platform === "sequence"
            ? "Seq · ffmpeg"
            : active.platform === "mkv" || active.platform === "ffmpeg"
              ? "ffmpeg"
              : active.platform;
      player.innerHTML = `<div class="lvr-stage-banner lvr-stage-banner--idle">
        <strong>${esc(kindTag)}</strong> · ${esc(active.label)} · drawable · Stage or FFplay
        ${active.thumbnail ? `<img class="lvr-x-thumb lvr-x-thumb--sm" src="${esc(active.thumbnail)}" alt="" referrerpolicy="no-referrer" />` : ""}
      </div>`;
    }
  }

  _destroyHls() {
    if (this._hls) {
      try {
        this._hls.destroy();
      } catch {
        /* */
      }
      this._hls = null;
    }
  }

  async _attachSrc(item) {
    this._destroyHls();
    this._imageEl = null;
    if (!item) return false;

    // Still frames (X photos) — keep image for drawTo
    if (item.kind === "image") {
      if (this.video) {
        try {
          this.video.pause();
        } catch {
          /* */
        }
        this.video.removeAttribute("src");
        this.video.srcObject = null;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("X image load failed (CORS or 404)"));
        img.src = item.src;
      });
      this._imageEl = img;
      return true;
    }

    if (!this.video) return false;
    try {
      this.video.pause();
    } catch {
      /* */
    }
    this.video.removeAttribute("src");
    this.video.srcObject = null;
    try {
      this.video.load();
    } catch {
      /* */
    }

    // Required so drawImage → canvas is not tainted (video.twimg sends ACAO)
    try {
      this.video.crossOrigin = "anonymous";
    } catch {
      /* */
    }

    const isLive =
      !!item.isLive ||
      !!item.live ||
      /live|broadcast/i.test(item.label || "") ||
      /live_broadcast|yt_live|manifest\.googlevideo/i.test(item.src || item.stream || "");

    if (item.kind === "hls") {
      const Hls = await loadHls();
      if (Hls?.isSupported?.()) {
        this._hls = new Hls({
          enableWorker: true,
          lowLatencyMode: !!isLive,
          liveSyncDurationCount: isLive ? 3 : 3,
          liveMaxLatencyDurationCount: isLive ? 10 : Infinity,
          maxBufferLength: isLive ? 20 : 30,
          maxMaxBufferLength: isLive ? 40 : 60,
          backBufferLength: isLive ? 8 : 30,
          fragLoadingMaxRetry: 6,
          manifestLoadingMaxRetry: 6,
          levelLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 500,
          manifestLoadingRetryDelay: 500,
          xhrSetup: (xhr) => {
            try {
              xhr.withCredentials = false;
            } catch {
              /* */
            }
          },
        });
        let fatal = null;
        this._hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data?.fatal) return;
          fatal = data;
          try {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) this._hls.startLoad();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) this._hls.recoverMediaError();
          } catch {
            /* */
          }
          this.onStatus?.(`HLS · ${data.type || "error"} · recovering…`, true);
        });
        this._hls.loadSource(item.src);
        this._hls.attachMedia(this.video);
        await new Promise((resolve, reject) => {
          const tid = setTimeout(() => {
            if (this.video?.readyState >= 2) resolve();
            else if (fatal) reject(new Error(`HLS fatal: ${fatal.details || fatal.type || "error"}`));
            else resolve(); // soft continue; frame wait handles readiness
          }, isLive ? 14000 : 8000);
          this._hls.on(Hls.Events.MANIFEST_PARSED, () => {
            clearTimeout(tid);
            resolve();
          });
          this._hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data?.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              // give recover a moment
            }
          });
        });
      } else if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
        this.video.src = item.src;
      } else {
        throw new Error("HLS not supported in this browser");
      }
    } else if (item.kind === "video") {
      // MKV ffmpeg stream — prefer streamSrc; retry with transcode on error
      let src = item.streamSrc || item.src;
      this.video.src = src;
      // One-shot: if copy remux fails, flip to transcode URL
      if (item.streamTranscode || (item.mediaId && String(src).includes("/api/media/stream"))) {
        const onErr = () => {
          const tc =
            item.streamTranscode ||
            (item.mediaId
              ? `/api/media/stream?id=${encodeURIComponent(item.mediaId)}&mode=transcode`
              : null);
          if (!tc || this.video.dataset.aitoTc === "1") return;
          this.video.dataset.aitoTc = "1";
          this.onStatus(`MKV remux retry · transcode · ${item.label}`);
          this.video.src = tc;
          item.src = tc;
          this.video.play?.().catch(() => {});
        };
        this.video.addEventListener("error", onErr, { once: true });
      }
    } else {
      return false;
    }
    this.video.muted = true;
    this.video.playsInline = true;
    // Never loop live streams (HLS live edge breaks with loop)
    this.video.loop = !isLive && (item.platform === "x" || item.mediaType === "gif" || item.kind === "video");
    item.isLive = isLive;
    try {
      await this.video.play();
    } catch (playErr) {
      // Autoplay policies — still consider attach success if metadata exists
      if (!this.video.src && !this._hls) throw playErr;
    }
    return true;
  }

  async loadActivePreview() {
    const active = this.getActive();
    if (!active?.drawable) {
      this._destroyHls();
      if (this.video && !this.staging) {
        this.video.removeAttribute("src");
        this.video.srcObject = null;
      }
      this.mode = active ? "preview" : "none";
      this.render();
      return;
    }
    // Preload drawable into hidden video without staging
    if (!this.staging) {
      try {
        await this._attachSrc(active);
        this.mode = "preview";
      } catch (e) {
        this.mode = "preview";
        this.onStatus(`Preview failed: ${e?.message || String(e)}`, true);
        console.warn("[live] loadActivePreview", e);
      }
    }
    this.render();
  }

  async stageActive() {
    let active = this.getActive();
    if (!active) throw new Error("No live feed selected");
    // Auto-resolve X links if user stages before resolve finished
    if (active.needsResolve && active.platform === "x" && active.statusId) {
      this.onStatus(`Resolving X · ${active.statusId}…`);
      await this.resolvePendingMedia();
      active = this.getActive();
    }
    if (!active?.drawable) {
      throw new Error(
        active?.platform === "x"
          ? "X post has no drawable video yet. Wait for resolve or paste video.twimg mp4."
          : `${active?.platform || "Embed"} can't feed the point cloud (CORS). Paste x.com / .mp4 / .m3u8.`,
      );
    }
    try {
      await this._attachSrc(active);
    } catch (attachErr) {
      this.staging = false;
      this.mode = "preview";
      this.render();
      this._syncPlaybackUi();
      throw new Error(`Attach failed: ${attachErr?.message || attachErr}`);
    }
    // Wait briefly for first frame so floor/float + sample path light up
    const gotFrame =
      active.kind === "image"
        ? !!(this._imageEl && this._imageEl.naturalWidth > 0)
        : await this._waitForFrame(8000);
    this.staging = true;
    this.mode = "stage";
    try {
      await this.video?.play?.();
    } catch {
      /* autoplay */
    }
    this.render();
    try {
      this.onStage(true);
    } catch (stageHookErr) {
      console.warn("[live] onStage hook", stageHookErr);
    }
    this.onStatus(
      gotFrame || this.hasFrame || this._imageEl
        ? `Live staged · ${active.label} · floor + float + cloud`
        : `Live staged · ${active.label} · waiting for frames…`,
    );
    this.onChange();
    this._syncPlaybackUi();
  }

  /** @param {number} timeoutMs */
  _waitForFrame(timeoutMs = 5000) {
    if (this._imageEl?.naturalWidth > 0) return Promise.resolve(true);
    const v = this.video;
    if (!v) return Promise.resolve(false);
    if (v.readyState >= 2 && v.videoWidth > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        v.removeEventListener("loadeddata", onReady);
        v.removeEventListener("canplay", onReady);
        v.removeEventListener("playing", onReady);
        clearTimeout(tid);
        resolve(ok);
      };
      const onReady = () => finish(true);
      v.addEventListener("loadeddata", onReady);
      v.addEventListener("canplay", onReady);
      v.addEventListener("playing", onReady);
      const tid = setTimeout(() => finish(v.readyState >= 2), timeoutMs);
      v.play?.().catch(() => {});
    });
  }

  unstage() {
    const was = this.staging;
    this.staging = false;
    this.mode = this.getActive() ? "preview" : "none";
    // Pause when leaving stage so center preview stops
    try {
      this.video?.pause?.();
    } catch {
      /* */
    }
    this.render();
    if (was) {
      this.onStage(false);
      this.onStatus("Live unstaged");
    }
    this.onChange();
    this._syncPlaybackUi();
  }

  stop() {
    this.unstage();
    this._destroyHls();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.srcObject = null;
    }
  }

  /**
   * Draw staged live video (or X still) into sample canvas for segmentation / cloud.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   * @param {boolean} mirror
   */
  drawTo(ctx, w, h, mirror = false) {
    if (!this.staging) return false;

    // X photo / still frame path
    if (this._imageEl && this._imageEl.naturalWidth > 0) {
      ctx.save();
      if (mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      try {
        ctx.drawImage(this._imageEl, 0, 0, w, h);
      } catch {
        ctx.restore();
        return false;
      }
      ctx.restore();
      return true;
    }

    if (!this.video) return false;
    // readyState 1 = HAVE_METADATA may still fail drawImage; prefer >= 2
    if (this.video.readyState < 2 || !this.video.videoWidth) {
      // Keep trying play so frames arrive
      this.video.play?.().catch(() => {});
      return false;
    }
    ctx.save();
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    try {
      ctx.drawImage(this.video, 0, 0, w, h);
    } catch {
      ctx.restore();
      return false;
    }
    ctx.restore();
    return true;
  }
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export { liveVideoDedupeKey, parsePasteToItems };
