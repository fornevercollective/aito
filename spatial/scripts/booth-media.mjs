/**
 * aito-mac booth · ffmpeg / ffplay media layer
 *
 * - Any container ffmpeg can demux (video + audio codecs)
 * - Image sequences (printf pattern, glob, directory)
 * - Alternate frame rates (input + output)
 * - Browser fMP4 stream · external ffplay/repel · probe
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const MEDIA_ROOT = path.join(os.tmpdir(), "aito-mac-media");
const entries = new Map(); // id -> entry
/** @type {import('node:child_process').ChildProcess | null} */
let ffplayChild = null;
/** @type {Set<import('node:child_process').ChildProcess>} */
const streamChildren = new Set();

/** Common cinema / broadcast / game frame rates */
export const FPS_PRESETS = [
  12, 15, 18, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120, 144, 240,
];

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".jpe",
  ".jfif",
  ".webp",
  ".tif",
  ".tiff",
  ".bmp",
  ".gif",
  ".exr",
  ".dpx",
  ".tga",
  ".psd",
  ".hdr",
  ".heic",
  ".heif",
  ".jp2",
  ".j2k",
  ".pam",
  ".pbm",
  ".pgm",
  ".ppm",
  ".pfm",
  ".sgi",
  ".rgb",
  ".rgba",
]);

/** Containers / raws that almost always need ffmpeg for HTML5 <video>. */
const FORCE_FFMPEG_EXT = new Set([
  ".mkv",
  ".avi",
  ".m2ts",
  ".mts",
  ".ts",
  ".flv",
  ".wmv",
  ".asf",
  ".mpeg",
  ".mpg",
  ".vob",
  ".mxf",
  ".r3d",
  ".braw",
  ".rm",
  ".rmvb",
  ".3gp",
  ".3g2",
  ".f4v",
  ".ogv",
  ".divx",
  ".xvid",
  ".nut",
  ".yuv",
  ".y4m",
  ".prores",
  ".dnxhd",
  ".dnxhr",
  ".dv",
  ".m2v",
  ".m1v",
  ".mod",
  ".tod",
  ".vro",
  ".ifo",
  ".dat",
  ".nsv",
  ".amv",
  ".wtv",
  ".dvr-ms",
]);

const AUDIO_EXT = new Set([
  ".mp3",
  ".aac",
  ".m4a",
  ".wav",
  ".flac",
  ".ogg",
  ".opus",
  ".wma",
  ".aiff",
  ".aif",
  ".alac",
  ".ac3",
  ".eac3",
  ".dts",
  ".ape",
  ".wv",
  ".mka",
  ".caf",
  ".amr",
  ".ra",
  ".mid",
  ".midi",
]);

const VIDEO_EXT = new Set([
  ...FORCE_FFMPEG_EXT,
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".qt",
  ".hevc",
  ".h264",
  ".h265",
  ".av1",
  ".ivf",
]);

function ensureMediaRoot() {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
}

export function whichTool(name) {
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];
  const pathEnv = process.env.PATH || "";
  const dirs = [...pathEnv.split(path.delimiter), ...extra];
  for (const dir of dirs) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      /* */
    }
  }
  return null;
}

function listCodecs(kind /* decoder|encoder */) {
  const ffmpeg = whichTool("ffmpeg");
  if (!ffmpeg) return { video: [], audio: [], subtitle: [], data: [] };
  const flag = kind === "encoder" ? "-encoders" : "-decoders";
  const r = spawnSync(ffmpeg, ["-hide_banner", flag], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const text = r.stdout || "";
  const out = { video: [], audio: [], subtitle: [], data: [] };
  for (const line of text.split("\n")) {
    // V..... h264  description
    const m = line.match(/^\s*([VASD])[A-Z.]{5}\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const bucket =
      m[1] === "V" ? "video" : m[1] === "A" ? "audio" : m[1] === "S" ? "subtitle" : "data";
    out[bucket].push({ name: m[2], desc: (m[3] || "").trim() });
  }
  return out;
}

function listFormats() {
  const ffmpeg = whichTool("ffmpeg");
  if (!ffmpeg) return { demux: [], mux: [] };
  const r = spawnSync(ffmpeg, ["-hide_banner", "-formats"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const demux = [];
  const mux = [];
  for (const line of (r.stdout || "").split("\n")) {
    const m = line.match(/^\s*([D ])([E ])\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const name = m[3];
    if (m[1] === "D") demux.push(name);
    if (m[2] === "E") mux.push(name);
  }
  return { demux, mux };
}

export function ffmpegStatus() {
  const ffmpeg = whichTool("ffmpeg");
  const ffplay = whichTool("ffplay");
  const ffprobe = whichTool("ffprobe");
  const repel =
    whichTool("repel") ||
    (fs.existsSync(path.join(os.homedir(), "dev/ffmpeg/repel/target/release/repel"))
      ? path.join(os.homedir(), "dev/ffmpeg/repel/target/release/repel")
      : null);

  let version = null;
  if (ffmpeg) {
    const r = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
    version = (r.stdout || "").split("\n")[0] || null;
  }

  return {
    ok: !!(ffmpeg || ffplay),
    ffmpeg: ffmpeg || null,
    ffplay: ffplay || null,
    ffprobe: ffprobe || null,
    repel: repel || null,
    version,
    mediaRoot: MEDIA_ROOT,
    entries: entries.size,
    ffplayRunning: !!(ffplayChild && !ffplayChild.killed),
    fpsPresets: FPS_PRESETS,
    imageExts: [...IMAGE_EXT],
    forceFfmpegExts: [...FORCE_FFMPEG_EXT],
  };
}

export function codecCatalog() {
  return {
    decoders: listCodecs("decoder"),
    encoders: listCodecs("encoder"),
    formats: listFormats(),
    fpsPresets: FPS_PRESETS,
    note: "All listed codecs are available to /api/media/stream and ffplay via system ffmpeg",
  };
}

function newId() {
  return randomBytes(8).toString("hex");
}

function safeBasename(name) {
  return String(name || "media.bin")
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .slice(0, 120);
}

function expandUserPath(raw) {
  let p = String(raw || "").trim();
  if (!p) throw new Error("missing path");
  if (p.startsWith("file://")) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
    } catch {
      throw new Error("invalid file:// URL");
    }
  }
  if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
  if (!path.isAbsolute(p)) throw new Error("path must be absolute or ~/…");
  return path.resolve(p);
}

function assertAllowedRoot(absPath) {
  const home = os.homedir();
  const allowed =
    absPath === home ||
    absPath.startsWith(home + path.sep) ||
    absPath.startsWith("/Volumes/") ||
    absPath.startsWith(MEDIA_ROOT + path.sep) ||
    absPath.startsWith("/tmp/") ||
    absPath.startsWith("/private/tmp/") ||
    absPath.startsWith("/var/folders/");
  if (!allowed) throw new Error("path not under home / Volumes / media cache");
  return absPath;
}

/** Existing file under allowed roots. */
export function assertLocalMediaPath(raw) {
  const p = assertAllowedRoot(expandUserPath(raw));
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error("file not found");
  return p;
}

/** Existing directory under allowed roots. */
export function assertLocalDir(raw) {
  const p = assertAllowedRoot(expandUserPath(raw));
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error("directory not found");
  return p;
}

export function isImagePath(p) {
  return IMAGE_EXT.has(path.extname(p).toLowerCase());
}

export function isAudioPath(p) {
  return AUDIO_EXT.has(path.extname(p).toLowerCase());
}

export function isContainerPath(p) {
  const e = path.extname(p).toLowerCase();
  return VIDEO_EXT.has(e) || AUDIO_EXT.has(e) || IMAGE_EXT.has(e);
}

export function needsFfmpegForBrowser(p, kind = "file") {
  if (kind === "sequence") return true;
  const e = path.extname(p).toLowerCase();
  if (FORCE_FFMPEG_EXT.has(e) || IMAGE_EXT.has(e) || AUDIO_EXT.has(e)) return true;
  // mp4/mov/webm may still need transcode for exotic codecs — decided at probe time
  return false;
}

export function parseFps(raw, fallback = null) {
  if (raw == null || raw === "" || raw === "native" || raw === "auto") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 480) throw new Error("fps must be 0–480");
  // Normalize common NTSC fractions
  if (Math.abs(n - 23.98) < 0.01) return 24000 / 1001;
  if (Math.abs(n - 29.97) < 0.01) return 30000 / 1001;
  if (Math.abs(n - 59.94) < 0.01) return 60000 / 1001;
  return n;
}

function fpsLabel(fps) {
  if (fps == null) return "native";
  if (Math.abs(fps - 24000 / 1001) < 0.001) return "23.976";
  if (Math.abs(fps - 30000 / 1001) < 0.001) return "29.97";
  if (Math.abs(fps - 60000 / 1001) < 0.001) return "59.94";
  return String(Number(fps.toFixed(3)));
}

/**
 * Detect image sequence from directory or printf/glob pattern.
 * Returns { kind:'sequence', pattern, dir, startNumber, count, files, fps }
 */
export function detectSequence(raw, opts = {}) {
  const fps = parseFps(opts.fps, 24);
  let input = String(raw || "").trim();
  if (!input) throw new Error("missing sequence path/pattern");

  // Printf pattern: /path/frame_%04d.png
  if (/%0?\d*d/.test(input) || input.includes("%d")) {
    const absPattern = expandUserPath(input.includes("/") || input.startsWith("~") ? input : path.join(process.cwd(), input));
    const dir = path.dirname(absPattern);
    assertAllowedRoot(dir);
    if (!fs.existsSync(dir)) throw new Error("sequence directory not found");
    const startNumber = Number(opts.start ?? opts.start_number ?? 0) || 0;
    return {
      kind: "sequence",
      pattern: absPattern,
      dir,
      startNumber,
      count: null,
      files: [],
      fps,
      patternType: "printf",
    };
  }

  // Glob: /path/*.png
  if (input.includes("*") || input.includes("?")) {
    const abs = expandUserPath(input.startsWith("~") || path.isAbsolute(input) ? input : path.join(process.cwd(), input));
    const dir = path.dirname(abs);
    assertAllowedRoot(dir);
    return {
      kind: "sequence",
      pattern: abs,
      dir,
      startNumber: 0,
      count: null,
      files: [],
      fps,
      patternType: "glob",
    };
  }

  // Directory of images
  const dir = assertLocalDir(input);
  const names = fs
    .readdirSync(dir)
    .filter((n) => IMAGE_EXT.has(path.extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  if (!names.length) throw new Error("no images in directory");

  // Try to build printf pattern from first/last
  const printf = inferPrintfPattern(dir, names);
  if (printf) {
    return {
      kind: "sequence",
      pattern: printf.pattern,
      dir,
      startNumber: printf.startNumber,
      count: names.length,
      files: names.map((n) => path.join(dir, n)),
      fps,
      patternType: "printf",
    };
  }

  // Fallback: concat demuxer list
  ensureMediaRoot();
  const listId = newId();
  const listPath = path.join(MEDIA_ROOT, `${listId}-seq.txt`);
  const duration = 1 / fps;
  const body = names
    .map((n) => {
      const f = path.join(dir, n).replace(/'/g, "'\\''");
      return `file '${f}'\nduration ${duration}`;
    })
    .join("\n");
  // concat demuxer needs last file repeated without duration for some ffmpeg versions
  const last = path.join(dir, names[names.length - 1]).replace(/'/g, "'\\''");
  fs.writeFileSync(listPath, body + `\nfile '${last}'\n`, "utf8");

  return {
    kind: "sequence",
    pattern: listPath,
    dir,
    startNumber: 0,
    count: names.length,
    files: names.map((n) => path.join(dir, n)),
    fps,
    patternType: "concat",
  };
}

function inferPrintfPattern(dir, names) {
  if (names.length < 2) {
    // single frame still works as 1-frame sequence
    const one = names[0];
    const m = one.match(/^(.*?)(\d+)(\.[^.]+)$/);
    if (!m) return null;
    const width = m[2].length;
    return {
      pattern: path.join(dir, `${m[1]}%0${width}d${m[3]}`),
      startNumber: Number(m[2]),
    };
  }
  // Find common prefix/suffix with varying digits
  const parsed = names.map((n) => {
    const m = n.match(/^(.*?)(\d+)(\.[^.]+)$/);
    return m ? { pre: m[1], num: m[2], suf: m[3], n: Number(m[2]) } : null;
  });
  if (parsed.some((p) => !p)) return null;
  const pre = parsed[0].pre;
  const suf = parsed[0].suf;
  if (!parsed.every((p) => p.pre === pre && p.suf === suf)) return null;
  const width = Math.max(...parsed.map((p) => p.num.length));
  const startNumber = Math.min(...parsed.map((p) => p.n));
  return {
    pattern: path.join(dir, `${pre}%0${width}d${suf}`),
    startNumber,
  };
}

function register(entryFields) {
  ensureMediaRoot();
  const id = newId();
  const entry = {
    id,
    created: Date.now(),
    fps: null,
    kind: "file",
    ...entryFields,
  };
  entries.set(id, entry);
  return entry;
}

export function getEntry(id) {
  return entries.get(String(id || "")) || null;
}

export function updateEntry(id, patch) {
  const e = getEntry(id);
  if (!e) throw new Error("unknown media id");
  Object.assign(e, patch || {});
  return e;
}

/**
 * Open local file, directory (sequence), or printf/glob pattern.
 * opts: { fps, kind: 'auto'|'file'|'sequence', start }
 */
export function openLocalPath(rawPath, opts = {}) {
  const kind = opts.kind || "auto";
  const fps = parseFps(opts.fps, null);
  let raw = String(rawPath || "").trim();

  // Explicit sequence or looks like pattern / directory of images
  if (kind === "sequence" || /%0?\d*d|%d|\*|\?/.test(raw)) {
    const seq = detectSequence(raw, { fps: fps ?? 24, start: opts.start });
    return register({
      path: seq.pattern,
      name: path.basename(seq.dir) + " · seq",
      source: "sequence",
      kind: "sequence",
      sequence: seq,
      fps: seq.fps,
    });
  }

  // Try as directory of images
  try {
    const expanded = expandUserPath(raw);
    if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
      if (kind === "file") throw new Error("path is a directory");
      const seq = detectSequence(raw, { fps: fps ?? 24, start: opts.start });
      return register({
        path: seq.pattern,
        name: path.basename(seq.dir) + " · seq",
        source: "sequence",
        kind: "sequence",
        sequence: seq,
        fps: seq.fps,
      });
    }
  } catch (e) {
    if (kind === "sequence") throw e;
  }

  const abs = assertLocalMediaPath(raw);
  const entry = register({
    path: abs,
    name: path.basename(abs),
    source: "path",
    kind: isImagePath(abs) ? "image" : isAudioPath(abs) ? "audio" : "file",
    fps,
  });
  return entry;
}

export async function saveUpload(buffer, filename, opts = {}) {
  ensureMediaRoot();
  const id = newId();
  const base = safeBasename(filename);
  const dest = path.join(MEDIA_ROOT, `${id}-${base}`);
  await fs.promises.writeFile(dest, buffer);
  const fps = parseFps(opts.fps, null);
  const entry = {
    id,
    path: dest,
    name: base,
    created: Date.now(),
    source: "upload",
    kind: isImagePath(base) ? "image" : isAudioPath(base) ? "audio" : "file",
    fps,
  };
  entries.set(id, entry);
  return entry;
}

/**
 * Register a multi-file image sequence upload (already on disk paths under media root or home).
 */
export function openSequenceFromFiles(filePaths, opts = {}) {
  if (!filePaths?.length) throw new Error("no sequence files");
  const fps = parseFps(opts.fps, 24);
  ensureMediaRoot();
  const absFiles = filePaths.map((p) => assertLocalMediaPath(p));
  // Prefer shared directory
  const dir = path.dirname(absFiles[0]);
  const names = absFiles.map((p) => path.basename(p));
  const printf = inferPrintfPattern(dir, names);
  let seq;
  if (printf && absFiles.every((p) => path.dirname(p) === dir)) {
    seq = {
      kind: "sequence",
      pattern: printf.pattern,
      dir,
      startNumber: printf.startNumber,
      count: absFiles.length,
      files: absFiles,
      fps,
      patternType: "printf",
    };
  } else {
    const listId = newId();
    const listPath = path.join(MEDIA_ROOT, `${listId}-seq.txt`);
    const duration = 1 / fps;
    let body = "";
    for (const f of absFiles) {
      const esc = f.replace(/'/g, "'\\''");
      body += `file '${esc}'\nduration ${duration}\n`;
    }
    const last = absFiles[absFiles.length - 1].replace(/'/g, "'\\''");
    body += `file '${last}'\n`;
    fs.writeFileSync(listPath, body, "utf8");
    seq = {
      kind: "sequence",
      pattern: listPath,
      dir,
      startNumber: 0,
      count: absFiles.length,
      files: absFiles,
      fps,
      patternType: "concat",
    };
  }
  return register({
    path: seq.pattern,
    name: `seq · ${absFiles.length}f`,
    source: "sequence",
    kind: "sequence",
    sequence: seq,
    fps: seq.fps,
  });
}

export function entryPublic(entry) {
  const fps = entry.fps;
  const q = (extra = {}) => {
    const sp = new URLSearchParams({ id: entry.id, ...extra });
    if (fps != null) sp.set("fps", String(fps));
    return sp.toString();
  };
  return {
    id: entry.id,
    name: entry.name,
    source: entry.source,
    kind: entry.kind || "file",
    fps: fps,
    fpsLabel: fpsLabel(fps),
    stream: `/api/media/stream?${q()}`,
    streamTranscode: `/api/media/stream?${q({ mode: "transcode" })}`,
    streamCopy: `/api/media/stream?${q({ mode: "copy" })}`,
    ffplay: `/api/media/ffplay?${q()}`,
    probe: `/api/media/probe?id=${encodeURIComponent(entry.id)}`,
    needsFfmpeg: needsFfmpegForBrowser(entry.path, entry.kind),
    sequence: entry.sequence
      ? {
          patternType: entry.sequence.patternType,
          dir: entry.sequence.dir,
          count: entry.sequence.count,
          startNumber: entry.sequence.startNumber,
          fps: entry.sequence.fps,
        }
      : null,
    fpsPresets: FPS_PRESETS,
  };
}

function parseRate(str) {
  if (!str) return null;
  if (String(str).includes("/")) {
    const [a, b] = String(str).split("/").map(Number);
    if (b) return a / b;
  }
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

export function probeEntry(entry) {
  const ffprobe = whichTool("ffprobe");
  if (!ffprobe) return { error: "ffprobe not found", path: entry.path, name: entry.name };

  // Image sequences: probe first frame if available
  let probePath = entry.path;
  let inputArgs = [];
  if (entry.kind === "sequence" && entry.sequence) {
    const seq = entry.sequence;
    if (seq.patternType === "printf") {
      inputArgs = ["-framerate", String(seq.fps || 24), "-start_number", String(seq.startNumber || 0)];
      probePath = seq.pattern;
    } else if (seq.patternType === "glob") {
      inputArgs = ["-framerate", String(seq.fps || 24), "-pattern_type", "glob"];
      probePath = seq.pattern;
    } else if (seq.files?.[0]) {
      probePath = seq.files[0];
      inputArgs = [];
    } else if (seq.patternType === "concat") {
      inputArgs = ["-f", "concat", "-safe", "0"];
      probePath = seq.pattern;
    }
  }

  const r = spawnSync(
    ffprobe,
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      ...inputArgs,
      probePath,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    return {
      error: (r.stderr || r.stdout || "ffprobe failed").slice(0, 600),
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
    };
  }
  try {
    const data = JSON.parse(r.stdout || "{}");
    const streams = data.streams || [];
    const videos = streams.filter((s) => s.codec_type === "video");
    const audios = streams.filter((s) => s.codec_type === "audio");
    const subs = streams.filter((s) => s.codec_type === "subtitle");
    const v = videos[0];
    const a = audios[0];
    const nativeFps =
      parseRate(v?.avg_frame_rate) || parseRate(v?.r_frame_rate) || null;
    const vCodec = (v?.codec_name || "").toLowerCase();
    const aCodec = (a?.codec_name || "").toLowerCase();
    // Browser-safe progressive fMP4
    const browserVideo = /^(h264|avc1|avc)$/.test(vCodec);
    const browserAudio = !a || /^(aac|mp3|opus|mp4a)$/.test(aCodec);
    const browserFriendly =
      entry.kind !== "sequence" &&
      entry.kind !== "audio" &&
      entry.kind !== "image" &&
      !!v &&
      browserVideo &&
      browserAudio;

    return {
      id: entry.id,
      name: entry.name,
      path: entry.path,
      kind: entry.kind,
      duration: Number(data.format?.duration) || null,
      size: Number(data.format?.size) || null,
      format: data.format?.format_name || null,
      bitRate: Number(data.format?.bit_rate) || null,
      nativeFps,
      fps: entry.fps ?? nativeFps,
      video: v
        ? {
            codec: v.codec_name,
            profile: v.profile,
            width: v.width,
            height: v.height,
            pix_fmt: v.pix_fmt,
            color_space: v.color_space,
            avg_frame_rate: v.avg_frame_rate,
            r_frame_rate: v.r_frame_rate,
            bit_rate: v.bit_rate ? Number(v.bit_rate) : null,
            tags: v.tags || null,
          }
        : null,
      audio: a
        ? {
            codec: a.codec_name,
            channels: a.channels,
            sample_rate: a.sample_rate,
            channel_layout: a.channel_layout,
            bit_rate: a.bit_rate ? Number(a.bit_rate) : null,
          }
        : null,
      streams: streams.map((s) => ({
        index: s.index,
        type: s.codec_type,
        codec: s.codec_name,
        codec_long: s.codec_long_name,
        profile: s.profile,
        width: s.width,
        height: s.height,
        sample_rate: s.sample_rate,
        channels: s.channels,
        pix_fmt: s.pix_fmt,
        language: s.tags?.language,
      })),
      videoTracks: videos.length,
      audioTracks: audios.length,
      subtitleTracks: subs.length,
      browserFriendly,
      sequence: entry.sequence
        ? {
            patternType: entry.sequence.patternType,
            count: entry.sequence.count,
            fps: entry.sequence.fps,
          }
        : null,
    };
  } catch (e) {
    return { error: e?.message || String(e), path: entry.path };
  }
}

function buildInputArgs(entry, fpsOverride) {
  const fps = parseFps(fpsOverride, entry.fps);
  const args = [];

  if (entry.kind === "sequence" && entry.sequence) {
    const seq = entry.sequence;
    const rate = fps ?? seq.fps ?? 24;
    if (seq.patternType === "printf") {
      args.push("-framerate", String(rate), "-start_number", String(seq.startNumber || 0), "-i", seq.pattern);
    } else if (seq.patternType === "glob") {
      args.push("-framerate", String(rate), "-pattern_type", "glob", "-i", seq.pattern);
    } else if (seq.patternType === "concat") {
      // concat list already embeds duration from fps at creation; re-create if fps changed
      if (fps != null && seq.files?.length && Math.abs((seq.fps || 0) - fps) > 0.001) {
        const listPath = path.join(MEDIA_ROOT, `${entry.id}-seq-r.txt`);
        const duration = 1 / fps;
        let body = "";
        for (const f of seq.files) {
          const esc = f.replace(/'/g, "'\\''");
          body += `file '${esc}'\nduration ${duration}\n`;
        }
        body += `file '${seq.files[seq.files.length - 1].replace(/'/g, "'\\''")}'\n`;
        fs.writeFileSync(listPath, body, "utf8");
        args.push("-f", "concat", "-safe", "0", "-i", listPath);
      } else {
        args.push("-f", "concat", "-safe", "0", "-i", seq.pattern);
      }
    } else {
      args.push("-i", entry.path);
    }
    return { args, fps: rate, isSequence: true };
  }

  if (entry.kind === "image") {
    const rate = fps ?? 24;
    // Loop single still as video at fps
    args.push("-loop", "1", "-framerate", String(rate), "-i", entry.path);
    return { args, fps: rate, isSequence: false, still: true };
  }

  if (entry.kind === "audio") {
    args.push("-i", entry.path);
    return { args, fps: fps ?? 30, isSequence: false, audioOnly: true };
  }

  // Generic file — optional force input rate (for CFR reinterpret)
  if (fps != null) {
    args.push("-r", String(fps));
  }
  args.push("-i", entry.path);
  return { args, fps, isSequence: false };
}

/**
 * Stream media as fragmented MP4 for HTML5 <video>.
 * opts: { mode: auto|copy|transcode, fps, vcodec, acodec, crf, preset, hwaccel }
 */
export function pipeStream(entry, res, opts = {}) {
  const ffmpeg = whichTool("ffmpeg");
  if (!ffmpeg) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ffmpeg not found — brew install ffmpeg" }));
    return;
  }

  const mode = (opts.mode || "auto").toLowerCase();
  const fpsOverride = opts.fps;
  let useTranscode = mode === "transcode";
  const info = mode === "copy" ? null : probeEntry(entry);

  if (mode === "auto") {
    if (
      entry.kind === "sequence" ||
      entry.kind === "image" ||
      entry.kind === "audio" ||
      (info && !info.error && !info.browserFriendly) ||
      fpsOverride != null ||
      entry.fps != null
    ) {
      // Forcing fps or non-browser codecs → transcode
      if (entry.kind === "sequence" || entry.kind === "image" || entry.kind === "audio") {
        useTranscode = true;
      } else if (info && !info.browserFriendly) {
        useTranscode = true;
      } else if (fpsOverride != null || entry.fps != null) {
        useTranscode = true; // retime requires re-encode
      }
    }
  }
  if (mode === "copy" && (entry.kind === "sequence" || entry.kind === "image" || entry.kind === "audio")) {
    useTranscode = true; // copy impossible for image2 → mp4 without encode
  }

  const { args: inArgs, fps, isSequence, still, audioOnly } = buildInputArgs(entry, fpsOverride);

  const vcodec = opts.vcodec || "libx264";
  const acodec = opts.acodec || "aac";
  const preset = opts.preset || "veryfast";
  const crf = opts.crf != null ? String(opts.crf) : "23";

  const args = ["-nostdin", "-hide_banner", "-loglevel", "error"];

  // Optional hardware decode (macOS)
  if (opts.hwaccel === "videotoolbox" || opts.hwaccel === "1" || opts.hwaccel === "true") {
    args.push("-hwaccel", "videotoolbox");
  }

  args.push(...inArgs);

  if (!useTranscode) {
    args.push(
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      "-f",
      "mp4",
      "pipe:1",
    );
  } else {
    // Video map
    if (audioOnly) {
      // Color bars / black still + audio for browser video element
      args.push(
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=1280x720:r=${fps || 30}`,
        "-map",
        "1:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        vcodec,
        "-preset",
        preset,
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        acodec,
        "-b:a",
        "192k",
        "-ac",
        "2",
        "-shortest",
      );
    } else {
      args.push("-map", "0:v:0?", "-map", "0:a:0?");
      args.push("-c:v", vcodec, "-preset", preset, "-pix_fmt", "yuv420p");
      if (vcodec === "libx264" || vcodec === "libx265") {
        args.push("-crf", crf, "-tune", "zerolatency");
      }
      // Output frame rate
      if (fps != null) {
        args.push("-r", String(fps));
      }
      // Audio
      if (!still && !isSequence) {
        args.push("-c:a", acodec, "-b:a", "192k", "-ac", "2");
      } else if (still) {
        // still image looped — limit duration optional via opts.duration
        args.push("-an");
        if (opts.duration) args.push("-t", String(opts.duration));
        else args.push("-t", "10"); // default 10s loop for stills in booth
      } else {
        // sequence may have no audio
        args.push("-c:a", acodec, "-b:a", "192k", "-ac", "2");
      }
    }
    args.push(
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      "-f",
      "mp4",
      "pipe:1",
    );
  }

  const child = spawn(ffmpeg, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  streamChildren.add(child);

  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d.toString();
    if (stderr.length > 6000) stderr = stderr.slice(-3000);
  });

  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "X-Aito-Media-Id": entry.id,
    "X-Aito-Mode": useTranscode ? "transcode" : "copy",
    "X-Aito-Fps": fps != null ? String(fps) : "native",
    "X-Aito-Kind": entry.kind || "file",
  });

  child.stdout.pipe(res);

  const cleanup = () => {
    streamChildren.delete(child);
    try {
      if (!child.killed) child.kill("SIGTERM");
    } catch {
      /* */
    }
  };

  res.on("close", cleanup);
  res.on("error", cleanup);
  child.on("error", (err) => {
    streamChildren.delete(child);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `ffmpeg spawn: ${err.message}` }));
    } else {
      try {
        res.end();
      } catch {
        /* */
      }
    }
  });
  child.on("close", (code) => {
    streamChildren.delete(child);
    if (code && code !== 0 && !res.writableEnded) {
      try {
        res.end();
      } catch {
        /* */
      }
    }
  });
}

export function playWithFfplay(source, title = "aito-mac · ffplay", opts = {}) {
  const ffplay = whichTool("ffplay");
  const repel = ffmpegStatus().repel;
  stopFfplay();
  const fps = parseFps(opts.fps, null);
  const extra = [];
  if (fps != null) extra.push("-vf", `fps=${fps}`);

  // Sequence / pattern: use ffplay with -framerate when possible
  if (opts.sequence) {
    const seq = opts.sequence;
    const rate = fps ?? seq.fps ?? 24;
    if (!ffplay) throw new Error("ffplay not found");
    const args = ["-autoexit", "-window_title", title, "-noborder"];
    if (seq.patternType === "printf") {
      args.push("-framerate", String(rate), "-start_number", String(seq.startNumber || 0), "-i", seq.pattern);
    } else if (seq.patternType === "glob") {
      args.push("-framerate", String(rate), "-pattern_type", "glob", "-i", seq.pattern);
    } else {
      args.push("-f", "concat", "-safe", "0", "-i", seq.pattern);
    }
    const child = spawn(ffplay, args, {
      stdio: ["ignore", "ignore", "inherit"],
      detached: true,
    });
    child.unref();
    ffplayChild = child;
    return { ok: true, tool: "ffplay", pid: child.pid, source: seq.pattern, title, fps: rate };
  }

  if (repel && !fps) {
    const child = spawn(repel, ["play", source, "-window_title", title, "-autoexit"], {
      stdio: ["ignore", "ignore", "inherit"],
      detached: true,
    });
    child.unref();
    ffplayChild = child;
    return { ok: true, tool: "repel", pid: child.pid, source, title };
  }

  if (!ffplay) throw new Error("ffplay not found — brew install ffmpeg");

  const child = spawn(
    ffplay,
    ["-autoexit", "-window_title", title, "-noborder", ...extra, source],
    {
      stdio: ["ignore", "ignore", "inherit"],
      detached: true,
    },
  );
  child.unref();
  ffplayChild = child;
  return { ok: true, tool: "ffplay", pid: child.pid, source, title, fps: fps ?? null };
}

export function playEntry(entry, opts = {}) {
  const fps = parseFps(opts.fps, entry.fps);
  if (entry.kind === "sequence" && entry.sequence) {
    return playWithFfplay(entry.path, `aito-mac · ${entry.name}`, {
      fps,
      sequence: entry.sequence,
    });
  }
  return playWithFfplay(entry.path, `aito-mac · ${entry.name}`, { fps });
}

export function stopFfplay() {
  if (ffplayChild && !ffplayChild.killed) {
    try {
      process.kill(-ffplayChild.pid, "SIGTERM");
    } catch {
      try {
        ffplayChild.kill("SIGTERM");
      } catch {
        /* */
      }
    }
  }
  ffplayChild = null;
  return { ok: true, stopped: true };
}

export function resolveMediaSource(query) {
  if (query.id) {
    const e = getEntry(query.id);
    if (!e) throw new Error("unknown media id");
    if (query.fps != null && query.fps !== "") {
      try {
        e.fps = parseFps(query.fps, e.fps);
      } catch {
        /* keep */
      }
    }
    return { entry: e, source: e.path };
  }
  if (query.path) {
    const e = openLocalPath(query.path, {
      fps: query.fps,
      kind: query.kind,
      start: query.start,
    });
    return { entry: e, source: e.path };
  }
  if (query.url) {
    const u = String(query.url).trim();
    if (!/^https?:\/\//i.test(u) && !u.startsWith("file://") && !u.startsWith("/") && !u.startsWith("~/")) {
      throw new Error("invalid url");
    }
    if (u.startsWith("file://") || u.startsWith("/") || u.startsWith("~/") || u.includes("%d") || u.includes("*")) {
      const e = openLocalPath(u, { fps: query.fps, kind: query.kind, start: query.start });
      return { entry: e, source: e.path };
    }
    return { entry: null, source: u };
  }
  throw new Error("need id, path, or url");
}

export function readBody(req, limit = 2 * 1024 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("upload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
