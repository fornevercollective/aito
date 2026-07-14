#!/usr/bin/env node
/**
 * Static server for aito-mac — booth/, wasm/, plus light APIs:
 *   GET  /api/health
 *   GET  /api/x/resolve?id=STATUS[&handle=user]
 *   GET  /api/yt/resolve?v=VIDEO_ID[&h=720]
 *   GET  /api/hls?url=…
 *   GET  /api/proxy?url=…
 *   GET  /api/ffmpeg/status
 *   GET  /api/ffmpeg/codecs          full decoder/encoder/format catalog
 *   POST /api/media/open             { path, fps?, kind?: auto|file|sequence, start? }
 *   POST /api/media/sequence         { path|pattern|dir|files, fps?, start? }
 *   POST /api/media/upload           ?name=&fps=  (raw body)
 *   PATCH/POST /api/media/fps        { id, fps }
 *   GET  /api/media/stream?id=…[&mode=auto|copy|transcode&fps=&vcodec=&acodec=&hwaccel=]
 *   GET  /api/media/probe?id=…
 *   GET  /api/media/ffplay?id=…|path=…|url=…[&fps=]
 *   POST /api/media/ffplay           { id|path|url, fps? }
 *   POST /api/media/ffplay/stop
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  codecCatalog,
  entryPublic,
  ffmpegStatus,
  getEntry,
  openLocalPath,
  openSequenceFromFiles,
  pipeStream,
  playEntry,
  playWithFfplay,
  probeEntry,
  readBody,
  resolveMediaSource,
  saveUpload,
  stopFfplay,
  parseFps,
  FPS_PRESETS,
} from "./booth-media.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AITO_PORT || process.argv[2]) || 8768;
const HOST = process.env.AITO_HOST || "127.0.0.1";
/** QBPM static shell — ~/Projects/Qbpm (override with QBPM_ROOT) */
const QBPM_ROOT = path.resolve(
  process.env.QBPM_ROOT || path.join(process.env.HOME || "", "Projects/Qbpm"),
);
const QBPM_WEB = fs.existsSync(path.join(QBPM_ROOT, "web", "index.html"))
  ? path.join(QBPM_ROOT, "web")
  : fs.existsSync(path.join(QBPM_ROOT, "index.html"))
    ? QBPM_ROOT
    : null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

const xCache = new Map();
const ytCache = new Map();

function runCmd(cmd, args, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timeout`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function whichYtdlp() {
  const candidates = [
    process.env.YT_DLP,
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
    "yt-dlp",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (c.includes("/") && fs.existsSync(c)) return c;
      if (!c.includes("/")) return c;
    } catch {
      /* */
    }
  }
  return "yt-dlp";
}

/**
 * Resolve YouTube progressive/HLS stream via yt-dlp (studio broadcast path).
 * @param {string} videoId
 * @param {number} [height]
 */
async function resolveYoutube(videoId, height = 720) {
  const key = `${videoId}:${height}`;
  if (ytCache.has(key)) return ytCache.get(key);
  const ytdlp = whichYtdlp();
  const page = `https://www.youtube.com/watch?v=${videoId}`;
  // Prefer HLS (m3u8) for live; progressive often unavailable on live broadcasts
  const fmt = `best[height<=${height}][protocol^=m3u8]/best[height<=${height}]/best`;
  let proc = await runCmd(ytdlp, [
    "-f",
    fmt,
    "-g",
    "--no-playlist",
    "--no-warnings",
    page,
  ]);
  if (proc.code !== 0) {
    proc = await runCmd(ytdlp, ["-g", "--no-playlist", "--no-warnings", page]);
  }
  if (proc.code !== 0) {
    throw new Error((proc.stderr || "yt-dlp failed").trim().slice(0, 400));
  }
  const lines = proc.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("no stream URL from yt-dlp");
  // Prefer m3u8 line when multiple (video+audio)
  const stream = lines.find((l) => /\.m3u8|manifest/i.test(l)) || lines[0];
  let title = videoId;
  let isLive = false;
  try {
    const meta = await runCmd(ytdlp, ["--no-download", "-J", "--no-playlist", "--no-warnings", page], 90000);
    if (meta.code === 0 && meta.stdout) {
      const info = JSON.parse(meta.stdout);
      title = info.title || title;
      isLive = !!(info.is_live || info.live_status === "is_live");
    }
  } catch {
    /* title optional */
  }
  // Live URLs often contain live_broadcast even before meta
  if (!isLive && /live_broadcast|live\/1|source\/yt_live/i.test(stream)) isLive = true;
  const kind = /\.m3u8|manifest/i.test(stream) ? "hls" : "video";
  const out = {
    id: videoId,
    title,
    is_live: isLive,
    kind,
    stream,
    proxy: `/api/proxy?url=${encodeURIComponent(stream)}`,
    hls_proxy: kind === "hls" ? `/api/hls?url=${encodeURIComponent(stream)}` : null,
  };
  ytCache.set(key, out);
  // Live URLs expire faster — shorter cache
  const ttl = isLive ? 90 * 1000 : 8 * 60 * 1000;
  setTimeout(() => ytCache.delete(key), ttl).unref?.();
  return out;
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded.replace(/^\/+/, "") || "booth/index.html";
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;
  return abs;
}

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function cors(res, extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": "no-store",
    ...extra,
  };
}

async function readJsonBody(req) {
  const buf = await readBody(req, 2 * 1024 * 1024);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new Error("invalid JSON body");
  }
}

function pickXStream(mediaItem) {
  const variants = [...(mediaItem.variants || []), ...(mediaItem.formats || [])].filter(
    (v) => v?.url,
  );
  const mp4s = variants
    .filter((v) => {
      const ct = String(v.content_type || v.container || "").toLowerCase();
      return ct.includes("mp4") || /\.mp4(\?|$)/i.test(v.url);
    })
    .map((v) => ({ url: v.url, bitrate: Number(v.bitrate) || 0 }))
    .sort((a, b) => a.bitrate - b.bitrate);

  if (mp4s.length) {
    let best = mp4s[0];
    for (const v of mp4s) {
      if (v.bitrate > 0 && v.bitrate <= 2_500_000) best = v;
    }
    return { kind: "video", src: best.url };
  }
  if (mediaItem.url && /\.mp4(\?|$)/i.test(mediaItem.url)) {
    return { kind: "video", src: mediaItem.url };
  }
  const hls = variants.find(
    (v) =>
      String(v.content_type || "").toLowerCase().includes("mpegurl") ||
      /\.m3u8(\?|$)/i.test(v.url || ""),
  );
  if (hls?.url) return { kind: "hls", src: hls.url };
  if (mediaItem.url && /\.m3u8(\?|$)/i.test(mediaItem.url)) {
    return { kind: "hls", src: mediaItem.url };
  }
  return null;
}

function mediaFromTweet(tweet, statusId) {
  const author = tweet?.author?.screen_name || "x";
  const root = tweet?.media || {};
  const list = root.videos || root.all || root.photos || [];
  const media = [];
  for (const item of list) {
    const mtype = String(item.type || "photo").toLowerCase();
    if (mtype === "video" || mtype === "gif" || mtype === "animated_gif") {
      const stream = pickXStream(item);
      if (!stream) continue;
      media.push({
        kind: stream.kind,
        src: stream.src,
        url: stream.src,
        label: `X · @${author}`,
        drawable: true,
        thumbnail: item.thumbnail_url || null,
        mediaType: mtype.includes("gif") ? "gif" : "video",
        duration: item.duration ?? null,
      });
    } else if (mtype === "photo" || mtype === "image") {
      const src = item.url || item.thumbnail_url;
      if (!src) continue;
      media.push({
        kind: "image",
        src,
        url: src,
        label: `X · @${author} · photo`,
        drawable: true,
        thumbnail: src,
        mediaType: "photo",
      });
    }
  }
  return {
    id: statusId,
    handle: author,
    title: String(tweet?.text || "").slice(0, 120),
    media,
  };
}

async function resolveX(statusId, handle) {
  const cacheKey = `${handle || ""}:${statusId}`;
  if (xCache.has(cacheKey)) return xCache.get(cacheKey);

  const endpoints = [];
  if (handle) endpoints.push(`https://api.fxtwitter.com/${encodeURIComponent(handle)}/status/${statusId}`);
  endpoints.push(`https://api.fxtwitter.com/status/${statusId}`);

  let lastErr = "FxTwitter unreachable";
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "aito-mac-booth/1.0",
        },
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const data = await res.json();
      if (data?.code === 200 && data.tweet) {
        const out = mediaFromTweet(data.tweet, statusId);
        if (!out.media.length) throw new Error("X post has no video/photo media");
        xCache.set(cacheKey, out);
        return out;
      }
      lastErr = data?.message || "not found";
    } catch (e) {
      lastErr = e?.message || String(e);
    }
  }
  throw new Error(lastErr);
}

/** Browser-like headers — googlevideo rejects bare/bot UAs on live segments. */
const YT_PROXY_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.youtube.com",
  Referer: "https://www.youtube.com/",
};

/**
 * True only for playlist bodies — NOT media segments.
 * YouTube live segment URLs embed ".../playlist/index.m3u8/sq/N/.../file/seg.ts"
 * so a naive target.includes(".m3u8") wrongly rewrote MPEG-TS as text (broke streaming).
 */
function isHlsPlaylistBody(target, ctype, buf) {
  const head = buf.subarray(0, 16).toString("utf8");
  if (head.startsWith("#EXTM3U")) return true;
  if (ctype.includes("mpegurl") || ctype.includes("x-mpegURL")) return true;
  // Explicit playlist file ending (not path-containing .m3u8 mid-URL)
  try {
    const u = new URL(target);
    if (/\.m3u8$/i.test(u.pathname)) return true;
  } catch {
    /* */
  }
  return false;
}

async function proxyUrl(target, res) {
  if (!/^https?:\/\//i.test(target)) {
    sendJson(res, { error: "invalid url" }, 400);
    return;
  }
  try {
    const upstream = await fetch(target, {
      headers: YT_PROXY_HEADERS,
      redirect: "follow",
    });
    if (!upstream.ok) {
      sendJson(res, { error: `upstream ${upstream.status}` }, 502);
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    let ctype = upstream.headers.get("content-type") || "application/octet-stream";
    // Rewrite m3u8 playlists through proxy (media segments pass through binary)
    if (isHlsPlaylistBody(target, ctype, buf)) {
      const text = buf.toString("utf8");
      let base;
      try {
        base = new URL(".", target).href;
      } catch {
        base = target.replace(/\/[^/]*$/, "/");
      }
      const rewritten = text
        .split(/\r?\n/)
        .map((line) => {
          const s = line.trim();
          if (!s || s.startsWith("#")) {
            return line.replace(/URI="([^"]+)"/g, (_m, u) => {
              try {
                const abs = u.startsWith("http") ? u : new URL(u, base).href;
                return `URI="/api/proxy?url=${encodeURIComponent(abs)}"`;
              } catch {
                return _m;
              }
            });
          }
          try {
            const abs = s.startsWith("http") ? s : new URL(s, base).href;
            return `/api/proxy?url=${encodeURIComponent(abs)}`;
          } catch {
            return line;
          }
        })
        .join("\n");
      const body = Buffer.from(rewritten, "utf8");
      res.writeHead(
        200,
        cors(res, {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Content-Length": body.length,
          "Cache-Control": "no-store",
        }),
      );
      res.end(body);
      return;
    }
    // MPEG-TS / fMP4 / audio segments
    if (buf[0] === 0x47 || ctype.includes("mp2t") || ctype.includes("octet-stream")) {
      ctype = ctype.includes("octet-stream") ? "video/mp2t" : ctype;
    }
    res.writeHead(
      200,
      cors(res, {
        "Content-Type": ctype,
        "Content-Length": buf.length,
        "Cache-Control": "no-store",
      }),
    );
    res.end(buf);
  } catch (e) {
    sendJson(res, { error: `proxy: ${e?.message || e}` }, 502);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors(res));
    res.end();
    return;
  }

  if (url.pathname === "/api/health") {
    const ff = ffmpegStatus();
    sendJson(res, {
      ok: true,
      root: ROOT,
      x: true,
      ffmpeg: !!ff.ffmpeg,
      ffplay: !!ff.ffplay,
      mkv: !!(ff.ffmpeg || ff.ffplay),
      qbpm: !!QBPM_WEB,
      qbpmRoot: QBPM_WEB || null,
    });
    return;
  }

  // Mount QBPM static workspace at /qbpm/ (same-origin embed)
  // Absolute /static /graphs paths in QBPM HTML/JS are rewritten to /qbpm/...
  if (url.pathname === "/qbpm" || url.pathname.startsWith("/qbpm/")) {
    if (!QBPM_WEB) {
      sendJson(
        res,
        { error: "QBPM not found", hint: "Set QBPM_ROOT or install ~/Projects/Qbpm" },
        404,
      );
      return;
    }
    let rel = url.pathname.replace(/^\/qbpm\/?/, "") || "index.html";
    // Resolve under web/, then project root static/graphs, then bare web assets
    const candidates = [
      path.resolve(QBPM_WEB, rel),
      path.resolve(QBPM_ROOT, rel),
      path.resolve(QBPM_ROOT, "static", rel.replace(/^static\//, "")),
      path.resolve(QBPM_WEB, rel.replace(/^static\//, "")),
    ];
    let filePath = null;
    for (const c of candidates) {
      const rootOk =
        c.startsWith(QBPM_WEB + path.sep) ||
        c === QBPM_WEB ||
        c.startsWith(QBPM_ROOT + path.sep) ||
        c === QBPM_ROOT;
      if (!rootOk) continue;
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        const idx = path.join(c, "index.html");
        if (fs.existsSync(idx)) {
          filePath = idx;
          break;
        }
      } else if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        filePath = c;
        break;
      }
    }
    if (!filePath) {
      res.writeHead(404, cors(res));
      res.end(`QBPM asset not found: ${rel}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const ctype = MIME[ext] || "application/octet-stream";
    // Rewrite root-absolute asset URLs so the iframe under /qbpm/ can load
    if (ext === ".html" || ext === ".js" || ext === ".mjs" || ext === ".css" || ext === ".json") {
      let body = fs.readFileSync(filePath, "utf8");
      body = body
        .replace(/(["'`])\/static\//g, "$1/qbpm/static/")
        .replace(/(["'`])\/graphs\//g, "$1/qbpm/graphs/")
        .replace(/(["'`])\/manifest\.webmanifest/g, "$1/qbpm/manifest.webmanifest")
        .replace(/(["'`])\/sw\.js/g, "$1/qbpm/sw.js")
        .replace(/(["'`])\/web\//g, "$1/qbpm/");
      if (ext === ".html" && !/<base\s/i.test(body)) {
        body = body.replace(/<head([^>]*)>/i, '<head$1>\n  <base href="/qbpm/" />');
      }
      const buf = Buffer.from(body, "utf8");
      res.writeHead(200, {
        "Content-Type": ctype,
        "Content-Length": buf.length,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(buf);
      return;
    }
    res.writeHead(200, {
      "Content-Type": ctype,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (url.pathname === "/api/ffmpeg/status") {
    sendJson(res, ffmpegStatus());
    return;
  }

  if (url.pathname === "/api/ffmpeg/codecs") {
    sendJson(res, codecCatalog());
    return;
  }

  if (url.pathname === "/api/media/probe") {
    try {
      const { entry, source } = resolveMediaSource({
        id: url.searchParams.get("id"),
        path: url.searchParams.get("path"),
        url: url.searchParams.get("url"),
        fps: url.searchParams.get("fps"),
        kind: url.searchParams.get("kind"),
        start: url.searchParams.get("start"),
      });
      if (entry) {
        sendJson(res, { ...probeEntry(entry), ...entryPublic(entry) });
      } else {
        sendJson(res, { source, note: "remote URL — use ffplay or upload first" });
      }
    } catch (e) {
      sendJson(res, { error: e?.message || String(e) }, 400);
    }
    return;
  }

  if (url.pathname === "/api/media/stream") {
    try {
      const id = url.searchParams.get("id");
      const p = url.searchParams.get("path");
      let entry = id ? getEntry(id) : null;
      if (!entry && p) {
        entry = openLocalPath(p, {
          fps: url.searchParams.get("fps"),
          kind: url.searchParams.get("kind"),
          start: url.searchParams.get("start"),
        });
      }
      if (!entry) {
        sendJson(res, { error: "missing id or path" }, 400);
        return;
      }
      pipeStream(entry, res, {
        mode: (url.searchParams.get("mode") || "auto").toLowerCase(),
        fps: url.searchParams.get("fps"),
        vcodec: url.searchParams.get("vcodec") || undefined,
        acodec: url.searchParams.get("acodec") || undefined,
        crf: url.searchParams.get("crf"),
        preset: url.searchParams.get("preset") || undefined,
        hwaccel: url.searchParams.get("hwaccel") || undefined,
        duration: url.searchParams.get("duration"),
      });
    } catch (e) {
      sendJson(res, { error: e?.message || String(e) }, 400);
    }
    return;
  }

  if (url.pathname === "/api/media/ffplay" && req.method === "GET") {
    try {
      const fps = url.searchParams.get("fps");
      const { entry, source } = resolveMediaSource({
        id: url.searchParams.get("id"),
        path: url.searchParams.get("path"),
        url: url.searchParams.get("url"),
        fps,
        kind: url.searchParams.get("kind"),
        start: url.searchParams.get("start"),
      });
      const title = url.searchParams.get("title") || undefined;
      const result = entry
        ? playEntry(entry, { fps })
        : playWithFfplay(source, title || "aito-mac · ffplay", { fps });
      sendJson(res, result);
    } catch (e) {
      sendJson(res, { error: e?.message || String(e) }, 400);
    }
    return;
  }

  if (url.pathname === "/api/media/ffplay" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const { entry, source } = resolveMediaSource({
        id: body.id,
        path: body.path,
        url: body.url || body.source,
        fps: body.fps,
        kind: body.kind,
        start: body.start,
      });
      const result = entry
        ? playEntry(entry, { fps: body.fps })
        : playWithFfplay(source, body.title || "aito-mac · ffplay", { fps: body.fps });
      sendJson(res, result);
    } catch (e) {
      sendJson(res, { error: e?.message || String(e) }, 400);
    }
    return;
  }

  if (url.pathname === "/api/media/ffplay/stop" && (req.method === "POST" || req.method === "GET")) {
    sendJson(res, stopFfplay());
    return;
  }

  if (url.pathname === "/api/media/open" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const entry = openLocalPath(body.path || body.file || body.source || body.pattern || body.dir, {
        fps: body.fps,
        kind: body.kind,
        start: body.start ?? body.start_number,
      });
      sendJson(res, entryPublic(entry));
    } catch (e) {
      sendJson(res, { error: e?.message || String(e) }, 400);
    }
    return;
  }

  if (url.pathname === "/api/media/sequence" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      let entry;
      if (Array.isArray(body.files) && body.files.length) {
        entry = openSequenceFromFiles(body.files, {
          fps: body.fps,
          start: body.start ?? body.start_number,
        });
      } else {
        entry = openLocalPath(body.path || body.pattern || body.dir || body.source, {
          fps: body.fps ?? 24,
          kind: "sequence",
          start: body.start ?? body.start_number,
        });
      }
      sendJson(res, entryPublic(entry));
    } catch (e) {
      sendJson(res, { error: e?.message || String(e) }, 400);
    }
    return;
  }

  if (
    (url.pathname === "/api/media/fps" || url.pathname === "/api/media/configure") &&
    req.method === "POST"
  ) {
    try {
      const body = await readJsonBody(req);
      if (!body.id) {
        sendJson(res, { error: "missing id" }, 400);
        return;
      }
      const entry = getEntry(body.id);
      if (!entry) {
        sendJson(res, { error: "unknown media id" }, 404);
        return;
      }
      if (body.fps === "native" || body.fps === "auto" || body.fps === "" || body.fps == null) {
        entry.fps = null;
      } else {
        entry.fps = parseFps(body.fps, null);
      }
      if (entry.sequence) entry.sequence.fps = entry.fps ?? entry.sequence.fps;
      sendJson(res, entryPublic(entry));
    } catch (e) {
      sendJson(res, { error: e?.message || String(e) }, 400);
    }
    return;
  }

  if (url.pathname === "/api/media/upload" && req.method === "POST") {
    try {
      const name =
        url.searchParams.get("name") ||
        req.headers["x-file-name"] ||
        "upload.bin";
      const fps = url.searchParams.get("fps");
      const buf = await readBody(req);
      if (!buf.length) {
        sendJson(res, { error: "empty body" }, 400);
        return;
      }
      const entry = await saveUpload(buf, String(name), { fps });
      sendJson(res, entryPublic(entry));
    } catch (e) {
      sendJson(res, { error: e?.message || String(e) }, 400);
    }
    return;
  }

  if (url.pathname === "/api/media/presets" && req.method === "GET") {
    sendJson(res, { fps: FPS_PRESETS });
    return;
  }

  if (url.pathname === "/api/x/resolve") {
    let statusId = (url.searchParams.get("id") || url.searchParams.get("status") || "").trim();
    let handle = (url.searchParams.get("handle") || url.searchParams.get("user") || "").trim() || null;
    const page = url.searchParams.get("url") || "";
    if (!statusId && page) {
      const m =
        page.match(/(?:x|twitter|fxtwitter|vxtwitter)\.com\/(?:([^/]+)\/)?status(?:es)?\/(\d+)/i) ||
        page.match(/\/i\/status\/(\d+)/i);
      if (m) {
        if (m[2]) {
          handle = handle || (m[1] === "i" ? null : m[1]);
          statusId = m[2];
        } else {
          statusId = m[1];
        }
      }
    }
    if (!/^\d{5,}$/.test(statusId || "")) {
      sendJson(res, { error: "missing or invalid X status id" }, 400);
      return;
    }
    if (handle === "i" || handle === "intent") handle = null;
    try {
      const info = await resolveX(statusId, handle);
      sendJson(res, info);
    } catch (e) {
      sendJson(res, { error: e?.message || String(e) }, 502);
    }
    return;
  }

  if (url.pathname === "/api/yt/resolve") {
    let vid = (url.searchParams.get("v") || url.searchParams.get("id") || "").trim();
    const page = url.searchParams.get("url") || "";
    if (!vid && page) {
      const m = page.match(/[?&]v=([\w-]{6,})/) || page.match(/youtu\.be\/([\w-]{6,})/);
      if (m) vid = m[1];
    }
    if (!vid) {
      sendJson(res, { error: "missing v" }, 400);
      return;
    }
    let height = 720;
    try {
      height = Math.max(240, Math.min(2160, parseInt(url.searchParams.get("h") || "720", 10) || 720));
    } catch {
      height = 720;
    }
    try {
      const info = await resolveYoutube(vid, height);
      sendJson(res, info);
    } catch (e) {
      sendJson(res, { error: e?.message || String(e) }, 502);
    }
    return;
  }

  if (url.pathname === "/api/hls") {
    const target = url.searchParams.get("url") || "";
    await proxyUrl(target, res);
    return;
  }

  if (url.pathname === "/api/proxy") {
    const target = url.searchParams.get("url") || "";
    await proxyUrl(target, res);
    return;
  }

  let filePath = safePath(url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  if (process.env.AITO_QUIET !== "1") {
    const ff = ffmpegStatus();
    console.log(`aito-mac booth server`);
    console.log(`  root  ${ROOT}`);
    console.log(`  url   http://${HOST}:${PORT}/booth/`);
    console.log(`  api   http://${HOST}:${PORT}/api/x/resolve?id=2066922118231503102`);
    console.log(
      `  mkv   ffmpeg=${ff.ffmpeg ? "yes" : "no"} ffplay=${ff.ffplay ? "yes" : "no"} · /api/media/*`,
    );
  }
});
