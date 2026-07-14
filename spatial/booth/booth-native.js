/**
 * aito-mac native bridge — Lua presets, JAX / ZipDepth depth, WASM modulator, repel status.
 */
(function () {
  const JAX_URL = "http://127.0.0.1:8767";
  const ZIPDEPTH_URL = "http://127.0.0.1:8766";
  let wasmMod = null;
  let jaxDepth = null;
  let jaxEnabled = false;
  let zipDepth = null;
  let zipDepthBackend = null;
  let zipDepthEnabled = false;

  async function loadWasmModulator() {
    if (wasmMod) return wasmMod;
    try {
      // Relative candidates so GH Pages (/aito/spatial/booth/) and localhost :8768 both work
      const here = document.baseURI || location.href;
      const wasmCandidates = [
        new URL("../wasm/booth_modulator.wasm", here).href,
        new URL("wasm/booth_modulator.wasm", here).href,
        new URL("../../wasm/booth_modulator.wasm", here).href,
        "/wasm/booth_modulator.wasm",
        "/aito/wasm/booth_modulator.wasm",
        "/aito/spatial/wasm/booth_modulator.wasm",
      ];
      let resp = null;
      for (const u of wasmCandidates) {
        try {
          const r = await fetch(u);
          if (r.ok) {
            resp = r;
            break;
          }
        } catch {
          /* try next */
        }
      }
      if (!resp) return null;
      if (!resp.ok) return null;
      const { instance } = await WebAssembly.instantiate(await resp.arrayBuffer(), {});
      wasmMod = instance.exports;
      return wasmMod;
    } catch {
      return null;
    }
  }

  function postNative(type, payload = {}) {
    if (window.webkit?.messageHandlers?.aitoMac) {
      window.webkit.messageHandlers.aitoMac.postMessage({ type, ...payload });
    }
  }

  function packRgbDepthBody(rgb, w, h) {
    const header = new ArrayBuffer(8);
    new DataView(header).setUint32(0, w, true);
    new DataView(header).setUint32(4, h, true);
    const body = new Uint8Array(8 + rgb.length);
    body.set(new Uint8Array(header), 0);
    body.set(rgb, 8);
    return body;
  }

  async function fetchJaxDepth(rgb, w, h) {
    if (!jaxEnabled) return null;
    try {
      const resp = await fetch(`${JAX_URL}/depth`, {
        method: "POST",
        body: packRgbDepthBody(rgb, w, h),
        cache: "no-store",
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      jaxDepth = data.depth;
      return data;
    } catch {
      return null;
    }
  }

  /** ZipDepth-inspired monocular depth (fabiotosi92/ZipDepth sidecar on :8766). */
  async function fetchZipDepth(rgb, w, h) {
    if (!zipDepthEnabled) return null;
    try {
      const resp = await fetch(`${ZIPDEPTH_URL}/depth`, {
        method: "POST",
        body: packRgbDepthBody(rgb, w, h),
        cache: "no-store",
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      zipDepth = data.depth;
      zipDepthBackend = data.backend || "zipdepth";
      return data;
    } catch {
      return null;
    }
  }

  function applyPreset(preset) {
    if (!preset || !window.PARAMS) return;
    for (const [key, val] of Object.entries(preset)) {
      const spec = window.PARAMS[key];
      if (!spec || typeof val !== "number") continue;
      spec.value = Math.max(spec.min, Math.min(spec.max, val));
      if (typeof window.syncParamUi === "function") {
        window.syncParamUi(key, spec);
      } else if (spec.input) {
        if (spec.input.type === "checkbox") spec.input.checked = spec.value >= 0.5;
        else spec.input.value = String(spec.value);
        if (spec.output && window.formatParam) {
          spec.output.textContent = window.formatParam(key, spec.value);
        }
      }
    }
    if (window.syncUniforms) window.syncUniforms();
  }

  function applyWasmMidi(cc, value01, t) {
    const ex = wasmMod;
    if (!ex) return null;
    if (cc === 1 && ex.booth_dispersion) return ex.booth_dispersion(t, value01);
    if (cc === 2 && ex.booth_depth_lift) return ex.booth_depth_lift(t, value01);
    if (cc === 4 && ex.booth_spin) return ex.booth_spin(t, value01);
    return null;
  }

  window.aitoMac = {
    applyPreset,
    fetchJaxDepth,
    fetchZipDepth,
    applyWasmMidi,
    hasWasm: () => !!wasmMod,
    setJaxEnabled(v) {
      jaxEnabled = !!v;
    },
    setZipDepthEnabled(v) {
      zipDepthEnabled = !!v;
    },
    getJaxDepth() {
      return jaxDepth;
    },
    getZipDepth() {
      return zipDepth;
    },
    getZipDepthBackend() {
      return zipDepthBackend;
    },
    depthAt(idx) {
      return jaxDepth?.[idx] ?? null;
    },
    zipDepthAt(idx) {
      return zipDepth?.[idx] ?? null;
    },
    notifyReady() {
      postNative("ready");
    },
    requestPresets() {
      postNative("loadPresets");
    },
    repelCamera(opts = {}) {
      postNative("repelCamera", {
        iphone: !!opts.iphone,
        deskView: !!opts.deskView,
      });
    },
    repelDualCamera() {
      postNative("repelDualCamera");
    },
    /** Play local path / URL / MKV via native repel or ffplay. */
    repelPlay(source, title) {
      if (!source) return;
      postNative("repelPlay", {
        source: String(source),
        title: title || "aito-mac · media",
      });
    },
    listNativeCameras() {
      postNative("listCameras");
    },
    walkerScan() {
      postNative("walkerScan");
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    loadWasmModulator();
    const sel = document.createElement("select");
    sel.id = "booth-preset-select";
    sel.className = "booth-btn";
    sel.innerHTML = '<option value="">Preset…</option>';
    sel.addEventListener("change", () => {
      const name = sel.value;
      if (!name) return;
      postNative("applyPreset", { name });
    });
    const bar =
      document.querySelector("#booth-toolbar-audio") ||
      document.querySelector(".booth-chrome") ||
      document.querySelector(".booth-bar");
    if (bar) {
      const midi = bar.querySelector("#booth-midi");
      if (midi) bar.insertBefore(sel, midi);
      else bar.appendChild(sel);
    }

    window.addEventListener("aitoMacPresets", (ev) => {
      const presets = ev.detail?.presets || {};
      sel.innerHTML = '<option value="">Preset…</option>';
      for (const [k, p] of Object.entries(presets)) {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = p.label || k;
        sel.appendChild(opt);
      }
    });

    window.addEventListener("aitoMacApplyPreset", (ev) => {
      applyPreset(ev.detail);
    });

    window.aitoMac.notifyReady();
  });
})();