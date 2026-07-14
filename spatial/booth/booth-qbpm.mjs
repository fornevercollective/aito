/**
 * QBPM bridge — optional center-stage host for ~/Projects/Qbpm.
 *
 * Performance rules (browser budget):
 *  - QBPM tab only shows side-rail handlers by default
 *  - Center stage is OPT-IN (heavy iframe) — never auto-loads
 *  - When center is open, booth WebGL/MediaPipe is paused via onCenterChange
 *  - Bus ticks slowly and only while center is open
 */

const DEFAULT_URLS = [
  "/qbpm/",
  "http://127.0.0.1:8796/",
  "http://127.0.0.1:8796/web/",
];

const BC_NAME = "aito-qbpm";

function lsGet(key, fallback = null) {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function lsSet(key, val) {
  try {
    localStorage?.setItem?.(key, val);
  } catch {
    /* */
  }
}

export class QbpmBridge {
  /**
   * @param {{
   *   onStatus?: (msg: string, err?: boolean) => void,
   *   getIkBus?: () => object | null,
   *   getLiveLabel?: () => string,
   *   getStagedUrl?: () => string | null,
   *   onCenterChange?: (active: boolean) => void,
   * }} opts
   */
  constructor(opts = {}) {
    this.onStatus = opts.onStatus || (() => {});
    this.getIkBus = opts.getIkBus || (() => null);
    this.getLiveLabel = opts.getLiveLabel || (() => "");
    this.getStagedUrl = opts.getStagedUrl || (() => null);
    this.onCenterChange = opts.onCenterChange || (() => {});
    this.url = lsGet("aito.qbpm.url") || DEFAULT_URLS[0];
    this.online = false;
    this.centerOn = false;
    this.pinned = false; // pin disabled by default — was fighting canvas
    this.cloudUnderlay = false;
    this._bc = null;
    this._panel = null;
    this._stage = null;
    this._iframe = null;
    this._busTimer = null;
    this._loadedUrl = null;
  }

  /**
   * @param {HTMLElement | null} controlHost
   * @param {HTMLElement | null} stageHost
   */
  mount(controlHost, stageHost) {
    this._panel = controlHost;
    this._stage = stageHost || document.getElementById("booth-center-stage");
    this._iframe =
      this._stage?.querySelector("#booth-center-frame") ||
      document.getElementById("booth-center-frame");

    if (controlHost) {
      controlHost.innerHTML = `
      <div class="qbpm-panel" id="qbpm-panel-root">
        <p class="qbpm-hint qbpm-hint--lead">
          <strong>Lightweight shell.</strong> Side columns stay handlers.
          Center stage is <em>optional</em> — loading full QBPM pauses the point cloud
          so the browser is not running two apps at once.
        </p>
        <div class="qbpm-row">
          <label class="qbpm-field">
            <span>QBPM URL</span>
            <input type="url" class="booth-input qbpm-url" id="qbpm-url"
              value="${esc(this.url)}" spellcheck="false"
              placeholder="/qbpm/" />
          </label>
        </div>
        <div class="qbpm-row qbpm-row--actions">
          <button type="button" class="booth-btn booth-btn--flat-accent" id="qbpm-center" title="Load QBPM (pauses cloud)">Load center</button>
          <button type="button" class="booth-btn" id="qbpm-probe" title="Probe">Probe</button>
          <button type="button" class="booth-btn" id="qbpm-open" title="Open in its own window (recommended)">Pop out</button>
        </div>
        <div class="qbpm-row qbpm-row--actions">
          <button type="button" class="booth-btn booth-btn--seg" id="qbpm-bus" title="Push IK bus">Push IK</button>
          <button type="button" class="booth-btn booth-btn--seg" id="qbpm-send-live" title="Send staged URL">Send live</button>
        </div>
        <p class="qbpm-status" id="qbpm-status">QBPM · handlers ready · center off (cloud free)</p>
        <p class="qbpm-hint">
          Prefer <strong>Pop out</strong> for full graph/music tools.
          In-center load is for quick peek only. Bus: <code>${BC_NAME}</code>
        </p>
      </div>`;
    }

    this._bind();
    this.ensureBus();
    this._syncChrome();
    // Ensure center is closed on mount so canvas works
    this.setCenter(false, { silent: true });
    void this.probe();
  }

  mountPanel(host) {
    this.mount(host, document.getElementById("booth-center-stage"));
  }

  _bind() {
    const h = this._panel;
    const stage = this._stage;

    h?.querySelector("#qbpm-probe")?.addEventListener("click", () => void this.probe());
    h?.querySelector("#qbpm-open")?.addEventListener("click", () => this.openWindow());
    h?.querySelector("#qbpm-center")?.addEventListener("click", () => this.setCenter(!this.centerOn));
    h?.querySelector("#qbpm-bus")?.addEventListener("click", () => this.pushBus(true));
    h?.querySelector("#qbpm-send-live")?.addEventListener("click", () => this.sendLive());
    h?.querySelector("#qbpm-url")?.addEventListener("change", (ev) => {
      this.url = String(ev.target.value || "").trim() || DEFAULT_URLS[0];
      lsSet("aito.qbpm.url", this.url);
    });

    stage?.querySelector("#booth-center-reload")?.addEventListener("click", () => this.reload());
    stage?.querySelector("#booth-center-cloud")?.addEventListener("click", () => {
      // Cloud underlay while QBPM open is expensive — keep off; button closes center instead
      this.setCenter(false);
    });
    stage?.querySelector("#booth-center-pin")?.addEventListener("click", () => {
      this.setStatus("Pin disabled — use Pop out for parallel QBPM");
    });
    stage?.querySelector("#booth-center-pop")?.addEventListener("click", () => this.openWindow());
    stage?.querySelector("#booth-center-close")?.addEventListener("click", () => this.setCenter(false));

    document.getElementById("booth-qbpm-center")?.addEventListener("click", () => this.setCenter(true));
    document.getElementById("booth-qbpm-probe")?.addEventListener("click", () => void this.probe());
    document.getElementById("booth-qbpm-open")?.addEventListener("click", () => this.openWindow());
    document.getElementById("booth-qbpm-bus")?.addEventListener("click", () => this.pushBus(true));
    document.getElementById("booth-qbpm-live")?.addEventListener("click", () => this.sendLive());
  }

  setStatus(msg, err = false) {
    const el = this._panel?.querySelector("#qbpm-status");
    if (el) {
      el.textContent = msg;
      el.classList.toggle("is-err", !!err);
    }
    const bar = document.getElementById("booth-center-status");
    if (bar) {
      bar.textContent = msg;
      bar.classList.toggle("is-err", !!err);
    }
    if (!err) this.onStatus(msg, false);
    else this.onStatus(msg, true);
  }

  ensureBus() {
    if (this._bc) return;
    try {
      this._bc = new BroadcastChannel(BC_NAME);
    } catch {
      this._bc = null;
    }
    if (!this._busTimer) {
      // Slow bus — only while center open
      this._busTimer = setInterval(() => {
        if (this.centerOn) this.pushBus(false);
      }, 400);
    }
  }

  post(msg) {
    const payload = { source: "aito-booth", t: performance.now(), ...msg };
    try {
      this._bc?.postMessage(payload);
    } catch {
      /* */
    }
    try {
      this._iframe?.contentWindow?.postMessage(payload, "*");
    } catch {
      /* */
    }
  }

  pushBus(manual = false) {
    this.post({
      type: "aito-bus",
      ik: this.getIkBus?.(),
      live: this.getLiveLabel?.() || "",
      staged: this.getStagedUrl?.() || null,
      center: this.centerOn,
    });
    if (manual) this.setStatus("QBPM bus · pushed");
  }

  sendLive() {
    const url = this.getStagedUrl?.();
    if (!url) {
      this.setStatus("Stage a drawable feed first", true);
      return;
    }
    this.post({ type: "aito-live-url", url, label: this.getLiveLabel?.() || "live" });
    this.setStatus(`Sent live · ${String(url).slice(0, 40)}`);
  }

  openGraph(name) {
    this.openWindow();
    this.post({ type: "aito-open-graph", graph: name });
  }

  openWindow() {
    this.syncUrlFromInput();
    // Prefer full QBPM in its own window — does not fight WebGL
    const u = this.url.startsWith("/") ? `${location.origin}${this.url}` : this.url;
    window.open(u, "qbpm-workspace", "noopener,noreferrer");
    this.setStatus(`QBPM window · ${u}`);
    this.post({ type: "aito-hello", role: "booth" });
  }

  syncUrlFromInput() {
    const inp = this._panel?.querySelector("#qbpm-url");
    if (inp?.value) {
      this.url = inp.value.trim();
      lsSet("aito.qbpm.url", this.url);
    }
  }

  /**
   * Menubar: do NOT auto-load heavy iframe. Only update chrome hints.
   * @param {string} menuId
   */
  onMenuActivate(menuId) {
    if (menuId === "qbpm") {
      this.setStatus("QBPM handlers · Load center (pauses cloud) or Pop out");
      return;
    }
    // Leaving QBPM tab always frees center unless user explicitly re-opens
    if (this.centerOn) this.setCenter(false, { silent: true });
  }

  /**
   * @param {boolean} on
   * @param {{ silent?: boolean }} [opts]
   */
  setCenter(on, opts = {}) {
    this.syncUrlFromInput();
    const next = !!on;
    const stage = this._stage || document.getElementById("booth-center-stage");
    this._stage = stage;
    this._iframe =
      stage?.querySelector("#booth-center-frame") || document.getElementById("booth-center-frame");

    const changed = next !== this.centerOn;
    this.centerOn = next;

    if (stage) {
      if (next) stage.removeAttribute("hidden");
      else stage.setAttribute("hidden", "");
    }

    if (next) {
      this._loadFrame(false);
      if (!opts.silent) this.setStatus("QBPM center · cloud paused");
    } else {
      // Unload iframe to free RAM/GPU when closed
      if (this._iframe) {
        this._iframe.src = "about:blank";
        this._loadedUrl = null;
      }
      if (!opts.silent) this.setStatus("QBPM center off · cloud free");
    }

    this._applyRootClasses();
    this._syncChrome();
    if (changed) this.onCenterChange(this.centerOn);
  }

  reload() {
    this.syncUrlFromInput();
    this._loadFrame(true);
    this.setStatus("QBPM reloaded");
  }

  _loadFrame(force) {
    if (!this._iframe) return;
    const target = this.url || DEFAULT_URLS[0];
    if (force || this._loadedUrl !== target) {
      this._iframe.src = target;
      this._loadedUrl = target;
    }
    const title = document.getElementById("booth-center-title");
    if (title) title.textContent = `QBPM · ${shortUrl(target)} · cloud paused`;
  }

  _applyRootClasses() {
    const root = document.getElementById("booth-root");
    if (!root) return;
    root.classList.toggle("booth--qbpm-center", !!this.centerOn);
    root.classList.remove("booth--qbpm-cloud"); // underlay disabled (too heavy)
  }

  _syncChrome() {
    const on = this.centerOn;
    document.getElementById("booth-qbpm-center")?.classList.toggle("booth-btn--on", on);
    this._panel?.querySelector("#qbpm-center")?.classList.toggle("booth-btn--on", on);
    const label = this._panel?.querySelector("#qbpm-center");
    if (label) label.textContent = on ? "Close center" : "Load center";
  }

  toggleEmbed() {
    this.setCenter(!this.centerOn);
  }
  setEmbed(on) {
    this.setCenter(on);
  }
  get embedOn() {
    return this.centerOn;
  }

  async probe() {
    this.syncUrlFromInput();
    const candidates = [this.url, ...DEFAULT_URLS.filter((u) => u !== this.url)];
    for (const u of candidates) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 1500);
        const res = await fetch(u, { method: "GET", mode: "cors", signal: ctrl.signal, cache: "no-store" });
        clearTimeout(tid);
        if (res.ok || res.type === "opaque") {
          this.online = true;
          this.url = u;
          lsSet("aito.qbpm.url", u);
          const inp = this._panel?.querySelector("#qbpm-url");
          if (inp) inp.value = u;
          this.setStatus(`QBPM online · ${u}`);
          return true;
        }
      } catch {
        /* next */
      }
    }
    this.online = false;
    this.setStatus("QBPM offline · /qbpm/ or :8796", true);
    return false;
  }

  dispose() {
    if (this._busTimer) clearInterval(this._busTimer);
    this._busTimer = null;
    try {
      this._bc?.close();
    } catch {
      /* */
    }
    this._bc = null;
    this.setCenter(false, { silent: true });
  }
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function shortUrl(u) {
  try {
    if (String(u).startsWith("/")) return u;
    const x = new URL(u, location.origin);
    return (x.host + x.pathname).slice(0, 40);
  } catch {
    return String(u).slice(0, 40);
  }
}
