/**
 * Boot setup wizard — pick path/setup, probe machine specs, choose devices/feeds,
 * optional AI auto-calibration before entering the booth.
 */

export const BOOT_PATHS = [
  {
    id: "webcam",
    label: "Desktop webcam",
    desc: "FaceTime / built-in → person cloud · T2 tracking",
    tier: 2,
    action: "desktop",
    icon: "💻",
  },
  {
    id: "dual",
    label: "Dual Continuity",
    desc: "Desktop + iPhone spatial stack · desk orbit",
    tier: 2,
    action: "dual",
    icon: "📱",
  },
  {
    id: "studio",
    label: "Studio broadcast",
    desc: "YouTube live · LiDAR room · waveform · float player",
    tier: 4,
    action: "studio",
    icon: "📺",
  },
  {
    id: "live",
    label: "Live rail / file",
    desc: "Paste mp4 · HLS · stage into floor + float",
    tier: 2,
    action: "live",
    icon: "▶",
  },
  {
    id: "screen",
    label: "Screen / window",
    desc: "getDisplayMedia → spatial sphere shell",
    tier: 1,
    action: "screen",
    icon: "🖥",
  },
  {
    id: "blank",
    label: "Blank canvas",
    desc: "Skip capture · tune params · load sources later",
    tier: 2,
    action: "blank",
    icon: "◇",
  },
];

/**
 * Best-effort client machine probe (browser-visible specs only).
 */
export async function probeMachineSpecs() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const mem = nav.deviceMemory; // Chrome: GiB
  const cores = nav.hardwareConcurrency || 0;
  const ua = nav.userAgent || "";
  const platform = nav.platform || nav.userAgentData?.platform || "";
  const lang = nav.language || "";
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const screenW = typeof screen !== "undefined" ? screen.width : 0;
  const screenH = typeof screen !== "undefined" ? screen.height : 0;
  const webgl = probeWebGL();
  const gpu = webgl.renderer || "unknown";
  const maxTex = webgl.maxTextureSize || 0;

  // Rough tier recommendation
  let score = 0;
  if (cores >= 8) score += 2;
  else if (cores >= 4) score += 1;
  if (mem >= 8) score += 2;
  else if (mem >= 4) score += 1;
  if (maxTex >= 8192) score += 1;
  if (/Apple M|Metal|NVIDIA|Radeon|Intel Iris/i.test(gpu)) score += 1;

  let rec = "balanced";
  if (score >= 5) rec = "high";
  else if (score <= 2) rec = "lite";

  // Optional: health of local services
  let jax = false;
  let zipdepth = false;
  let zipdepthBackend = null;
  let boothApi = false;
  try {
    jax = (await fetch("http://127.0.0.1:8767/health", { cache: "no-store" })).ok;
  } catch {
    /* */
  }
  try {
    const zr = await fetch("http://127.0.0.1:8766/health", { cache: "no-store" });
    if (zr.ok) {
      zipdepth = true;
      const zj = await zr.json().catch(() => ({}));
      zipdepthBackend = zj.backend || "live";
    }
  } catch {
    /* */
  }
  try {
    boothApi = (await fetch("/api/health", { cache: "no-store" })).ok;
  } catch {
    /* */
  }

  return {
    cores,
    memoryGb: mem ?? null,
    platform,
    language: lang,
    ua: ua.slice(0, 120),
    dpr,
    screen: `${screenW}×${screenH}`,
    gpu,
    maxTextureSize: maxTex,
    webgl: webgl.ok,
    score,
    recommendation: rec,
    services: { jax, zipdepth, zipdepthBackend, boothApi },
    at: Date.now(),
  };
}

function probeWebGL() {
  try {
    const c = document.createElement("canvas");
    const gl =
      c.getContext("webgl2", { powerPreference: "high-performance" }) ||
      c.getContext("webgl", { powerPreference: "high-performance" });
    if (!gl) return { ok: false, renderer: "none", maxTextureSize: 0 };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg
      ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    return { ok: true, renderer: String(renderer || ""), maxTextureSize };
  } catch {
    return { ok: false, renderer: "error", maxTextureSize: 0 };
  }
}

/** Apply lightweight / balanced / high presets into PARAMS. */
export function applyPerfPreset(params, rec) {
  const set = (k, v) => {
    if (!params[k]) return;
    params[k].value = Math.max(params[k].min, Math.min(params[k].max, v));
    delete params[k]._handBase;
    if (params[k].input) params[k].input.value = String(params[k].value);
  };
  if (rec === "lite") {
    set("stride", 4);
    set("size", 0.02);
    set("opacity", 0.85);
    set("fog", 0.06);
    set("sphereBlend", 0.35);
    set("liveFloorW", 2.4);
    set("liveFloatScale", 1.2);
  } else if (rec === "high") {
    set("stride", 2);
    set("size", 0.014);
    set("opacity", 0.94);
    set("fog", 0.03);
    set("sphereBlend", 0.55);
    set("liveFloorW", 4.2);
    set("liveFloatScale", 1.85);
  } else {
    set("stride", 3);
    set("size", 0.016);
    set("opacity", 0.92);
    set("fog", 0.04);
  }
}

export function formatSpecsHtml(specs) {
  if (!specs) return "<p class='boot-muted'>Run probe…</p>";
  const mem = specs.memoryGb != null ? `${specs.memoryGb} GB` : "n/a";
  const jax = specs.services?.jax ? "up" : "off";
  const zip = specs.services?.zipdepth
    ? `up · ${escapeHtml(specs.services.zipdepthBackend || "live")}`
    : "off";
  const api = specs.services?.boothApi ? "up" : "off";
  return `
    <table class="boot-specs-table">
      <tr><th>CPU cores</th><td>${specs.cores || "—"}</td></tr>
      <tr><th>Memory</th><td>${mem}</td></tr>
      <tr><th>GPU</th><td title="${escapeAttr(specs.gpu)}">${escapeHtml(shortGpu(specs.gpu))}</td></tr>
      <tr><th>Screen</th><td>${escapeHtml(specs.screen)} · dpr ${specs.dpr}</td></tr>
      <tr><th>WebGL</th><td>${specs.webgl ? "ok" : "fail"} · max tex ${specs.maxTextureSize || "—"}</td></tr>
      <tr><th>Score</th><td>${specs.score} · <strong>${specs.recommendation}</strong></td></tr>
      <tr><th>JAX depth</th><td>${jax}</td></tr>
      <tr><th>ZipDepth</th><td>${zip}</td></tr>
      <tr><th>Booth API</th><td>${api}</td></tr>
    </table>`;
}

function shortGpu(s) {
  if (!s) return "—";
  return s.length > 48 ? `${s.slice(0, 46)}…` : s;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
