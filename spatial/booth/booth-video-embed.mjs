/**
 * Video URL / embed parser — patterns from Qbpm video-embed-parse + blank video-ingest.
 * YouTube · Vimeo · X · Twitch · HLS · direct mp4/webm · local MKV (ffmpeg stream).
 */

function tryUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

export function splitVideoPaste(text) {
  let t = String(text || "").trim();
  while (t.length >= 2 && t.startsWith("{") && t.endsWith("}")) t = t.slice(1, -1).trim();
  return t.split(/[\r\n\s,;{}<>]+/).map((s) => s.trim()).filter(Boolean);
}

export function youtubeIdFromUrl(raw) {
  const parsed = tryUrl(raw);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") {
    const id = parsed.pathname.replace(/^\//, "").split("/")[0];
    return id && id.length >= 6 ? id : null;
  }
  if (host.includes("youtube.com") || host === "m.youtube.com" || host === "music.youtube.com") {
    const v = parsed.searchParams.get("v");
    if (v) return v;
    const embed = parsed.pathname.match(/^\/embed\/([^/?]+)/);
    if (embed) return embed[1];
    const shorts = parsed.pathname.match(/^\/shorts\/([^/?]+)/);
    if (shorts) return shorts[1];
    const live = parsed.pathname.match(/^\/live\/([^/?]+)/);
    if (live) return live[1];
  }
  return null;
}

export function vimeoIdFromUrl(raw) {
  const parsed = tryUrl(raw);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "vimeo.com") {
    const m = parsed.pathname.match(/^\/(\d+)/);
    return m ? m[1] : null;
  }
  if (host === "player.vimeo.com") {
    const m = parsed.pathname.match(/\/video\/(\d+)/);
    return m ? m[1] : null;
  }
  return null;
}

/** Hosts that point at X / Twitter posts (incl. fixup / fx embed domains). */
export function isXHost(host) {
  const h = String(host || "")
    .replace(/^www\./, "")
    .toLowerCase();
  return (
    h === "x.com" ||
    h === "twitter.com" ||
    h === "mobile.twitter.com" ||
    h === "mobile.x.com" ||
    h === "fxtwitter.com" ||
    h === "vxtwitter.com" ||
    h === "fixupx.com" ||
    h === "fixvx.com" ||
    h.endsWith(".fxtwitter.com")
  );
}

/**
 * @returns {{ id: string, handle: string | null } | null}
 */
export function xStatusFromUrl(raw) {
  const parsed = tryUrl(raw);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (!isXHost(host)) return null;
  // /user/status/123, /user/status/123/video/1, /user/status/123/photo/1
  let m = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
  if (m) {
    const handle = m[1] === "i" || m[1] === "intent" ? null : m[1];
    return { id: m[2], handle };
  }
  m = parsed.pathname.match(/^\/i\/status\/(\d+)/);
  if (m) return { id: m[1], handle: null };
  // query form ?status_id=
  const q = parsed.searchParams.get("id") || parsed.searchParams.get("status_id");
  if (q && /^\d{5,}$/.test(q)) return { id: q, handle: null };
  return null;
}

export function xStatusIdFromUrl(raw) {
  return xStatusFromUrl(raw)?.id || null;
}

export function tweetEmbedSrc(statusId, theme = "dark") {
  return `https://platform.twitter.com/embed/Tweet.html?${new URLSearchParams({
    id: statusId,
    theme,
  }).toString()}`;
}

/**
 * Pick a booth-friendly progressive mp4 (prefer ~720p / ≤2.5Mbps), else HLS.
 * @param {Record<string, any>} mediaItem
 * @returns {{ kind: 'video'|'hls', src: string, bitrate?: number } | null}
 */
export function pickXMediaStream(mediaItem) {
  if (!mediaItem) return null;
  const variants = [
    ...(mediaItem.variants || []),
    ...(mediaItem.formats || []),
  ].filter((v) => v && v.url);

  const mp4s = variants
    .filter((v) => {
      const ct = String(v.content_type || v.container || "").toLowerCase();
      const u = String(v.url || "");
      return ct.includes("mp4") || /\.mp4(\?|$)/i.test(u);
    })
    .map((v) => ({
      url: v.url,
      bitrate: Number(v.bitrate) || 0,
    }))
    .filter((v) => v.url);

  if (mp4s.length) {
    mp4s.sort((a, b) => a.bitrate - b.bitrate);
    // Prefer highest under ~2.5 Mbps for cloud sampling; else best available
    let best = mp4s[0];
    for (const v of mp4s) {
      if (v.bitrate > 0 && v.bitrate <= 2_500_000) best = v;
    }
    if (!best.bitrate && mediaItem.url && /\.mp4/i.test(mediaItem.url)) {
      return { kind: "video", src: mediaItem.url, bitrate: 0 };
    }
    return { kind: "video", src: best.url, bitrate: best.bitrate };
  }

  if (mediaItem.url && /\.mp4(\?|$)/i.test(mediaItem.url)) {
    return { kind: "video", src: mediaItem.url };
  }

  const hls = variants.find((v) => {
    const ct = String(v.content_type || "").toLowerCase();
    return ct.includes("mpegurl") || /\.m3u8(\?|$)/i.test(v.url || "");
  });
  if (hls?.url) return { kind: "hls", src: hls.url };
  if (mediaItem.url && /\.m3u8(\?|$)/i.test(mediaItem.url)) {
    return { kind: "hls", src: mediaItem.url };
  }
  return null;
}

/**
 * Normalize fxtwitter / vxtwitter tweet media into drawable booth items.
 * @param {Record<string, any>} tweet
 * @returns {Array<{ kind: string, platform: string, src: string, label: string, drawable: boolean, thumbnail?: string, statusId?: string, mediaType?: string }>}
 */
export function extractXTweetMediaItems(tweet) {
  if (!tweet) return [];
  const mediaRoot = tweet.media || {};
  const list = mediaRoot.videos || mediaRoot.all || mediaRoot.photos || [];
  const statusId = String(tweet.id || "");
  const handle = tweet.author?.screen_name || "x";
  const out = [];
  let vidIdx = 0;
  let photoIdx = 0;

  for (const item of list) {
    const mtype = String(item.type || "photo").toLowerCase();
    if (mtype === "video" || mtype === "gif" || mtype === "animated_gif") {
      const stream = pickXMediaStream(item);
      if (!stream) continue;
      vidIdx += 1;
      out.push({
        kind: stream.kind,
        platform: "x",
        src: stream.src,
        label:
          list.filter((x) => /video|gif/i.test(String(x.type || ""))).length > 1
            ? `X · @${handle} · v${vidIdx}`
            : `X · @${handle}`,
        drawable: true,
        thumbnail: item.thumbnail_url || item.url || null,
        statusId,
        mediaType: mtype === "gif" || mtype === "animated_gif" ? "gif" : "video",
        duration: item.duration ?? null,
      });
      continue;
    }
    // Still photos — drawable via image→canvas path if wired; mark for preview
    if (mtype === "photo" || mtype === "image") {
      const url = item.url || item.thumbnail_url;
      if (!url) continue;
      photoIdx += 1;
      out.push({
        kind: "image",
        platform: "x",
        src: url,
        label: `X · @${handle} · 🖼${photoIdx}`,
        drawable: true, // LiveFeedHub will paint via ImageBitmap when needed
        thumbnail: url,
        statusId,
        mediaType: "photo",
      });
    }
  }
  return out;
}

/**
 * Resolve an X/Twitter status into drawable media via FxTwitter (CORS *).
 * Falls back to local /api/x/resolve when present.
 * @param {string} statusId
 * @param {string | null} [handle]
 */
export async function resolveXStatusMedia(statusId, handle = null) {
  const id = String(statusId || "").trim();
  if (!/^\d{5,}$/.test(id)) throw new Error("Invalid X status id");

  const endpoints = [];
  // Local booth proxy first (when serve.py is up)
  endpoints.push(`/api/x/resolve?id=${encodeURIComponent(id)}${handle ? `&handle=${encodeURIComponent(handle)}` : ""}`);
  if (handle) endpoints.push(`https://api.fxtwitter.com/${encodeURIComponent(handle)}/status/${id}`);
  endpoints.push(`https://api.fxtwitter.com/status/${id}`);
  // vxtwitter JSON (legacy)
  if (handle) endpoints.push(`https://api.vxtwitter.com/${encodeURIComponent(handle)}/status/${id}`);

  let lastErr = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        mode: "cors",
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} · ${url.split("?")[0]}`);
        continue;
      }
      const data = await res.json();

      // Our /api/x/resolve shape
      if (Array.isArray(data?.media) && data.media.length) {
        return data.media.map((m) => ({
          kind: m.kind || "video",
          platform: "x",
          src: m.src || m.url,
          label: m.label || `X · ${id.slice(0, 8)}`,
          drawable: m.drawable !== false,
          thumbnail: m.thumbnail || null,
          statusId: id,
          mediaType: m.mediaType || "video",
        }));
      }

      // fxtwitter shape
      if (data?.code === 200 && data.tweet) {
        const items = extractXTweetMediaItems(data.tweet);
        if (items.length) return items;
        lastErr = new Error("X post has no video/photo media");
        continue;
      }

      // vxtwitter shape
      if (data?.mediaURLs?.length || data?.media_extended?.length) {
        const items = [];
        const ext = data.media_extended || [];
        if (ext.length) {
          for (const m of ext) {
            if (m.type === "video" || m.type === "gif") {
              const src = m.url;
              if (!src) continue;
              items.push({
                kind: /\.m3u8/i.test(src) ? "hls" : "video",
                platform: "x",
                src,
                label: `X · ${data.user_name || id.slice(0, 8)}`,
                drawable: true,
                thumbnail: m.thumbnail_url || data.mediaURLs?.[0] || null,
                statusId: id,
                mediaType: m.type,
              });
            } else if (m.type === "image" && m.url) {
              items.push({
                kind: "image",
                platform: "x",
                src: m.url,
                label: `X · photo`,
                drawable: true,
                thumbnail: m.url,
                statusId: id,
                mediaType: "photo",
              });
            }
          }
        } else {
          for (const src of data.mediaURLs || []) {
            if (/\.(mp4|m3u8)(\?|$)/i.test(src)) {
              items.push({
                kind: /\.m3u8/i.test(src) ? "hls" : "video",
                platform: "x",
                src,
                label: `X · ${id.slice(0, 8)}`,
                drawable: true,
                statusId: id,
                mediaType: "video",
              });
            }
          }
        }
        if (items.length) return items;
      }

      lastErr = new Error(data?.message || "No media in response");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Could not resolve X media");
}

/** Twitch embed needs parent= matching page host. */
export function twitchEmbedInfo(raw) {
  try {
    const u = tryUrl(raw);
    if (!u) return null;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!host.endsWith("twitch.tv")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "videos" && parts[1]) return { type: "video", id: parts[1] };
    if (parts[0] === "clip" && parts[1]) return { type: "clip", id: parts[1] };
    const skip = new Set(["directory", "settings", "subscriptions", "inventory", "wallet"]);
    if (parts[0] && !skip.has(parts[0].toLowerCase())) {
      return { type: "channel", id: parts[0] };
    }
    return null;
  } catch {
    return null;
  }
}

function twitchParentQuery() {
  const hosts = [];
  try {
    const h = globalThis.location?.hostname;
    if (h) hosts.push(h);
  } catch {
    /* */
  }
  for (const h of ["localhost", "127.0.0.1"]) {
    if (!hosts.includes(h)) hosts.push(h);
  }
  return hosts.map((h) => `parent=${encodeURIComponent(h)}`).join("&");
}

/**
 * @returns {{ kind: 'iframe'|'video'|'hls', platform: string, src: string, label: string, drawable: boolean } | null}
 */
export function parseVideoEmbedLine(raw) {
  const line = String(raw || "").trim();
  const parsed = tryUrl(line);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const path = parsed.pathname || "";

  const yt = youtubeIdFromUrl(line);
  if (yt) {
    return {
      kind: "iframe",
      platform: "youtube",
      src: `https://www.youtube.com/embed/${encodeURIComponent(yt)}?autoplay=1&mute=1&playsinline=1`,
      label: `YT · ${yt.slice(0, 8)}`,
      drawable: false,
    };
  }

  const vim = vimeoIdFromUrl(line);
  if (vim) {
    return {
      kind: "iframe",
      platform: "vimeo",
      src: `https://player.vimeo.com/video/${vim}?autoplay=1&muted=1`,
      label: `Vimeo · ${vim}`,
      drawable: false,
    };
  }

  const xInfo = xStatusFromUrl(line);
  if (xInfo?.id) {
    return {
      kind: "iframe",
      platform: "x",
      src: tweetEmbedSrc(xInfo.id, "dark"),
      label: xInfo.handle ? `X · @${xInfo.handle}` : `X · ${xInfo.id.slice(0, 10)}`,
      drawable: false,
      needsResolve: true,
      statusId: xInfo.id,
      handle: xInfo.handle,
      original: line,
    };
  }

  // Direct X CDN media (video.twimg / pbs)
  if (host === "video.twimg.com" || host.endsWith(".video.twimg.com") || host === "video.twitter.com") {
    if (/\.m3u8(\?|$)/i.test(path) || parsed.searchParams.has("m3u8")) {
      return {
        kind: "hls",
        platform: "x",
        src: parsed.href,
        label: "X · HLS",
        drawable: true,
      };
    }
    return {
      kind: "video",
      platform: "x",
      src: parsed.href,
      label: "X · mp4",
      drawable: true,
    };
  }
  if (host === "pbs.twimg.com" || host.endsWith(".twimg.com")) {
    if (/\.(mp4|webm|mov)(\?|$)/i.test(path)) {
      return {
        kind: "video",
        platform: "x",
        src: parsed.href,
        label: "X · media",
        drawable: true,
      };
    }
    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(path) || path.includes("/media/")) {
      return {
        kind: "image",
        platform: "x",
        src: parsed.href,
        label: "X · image",
        drawable: true,
        mediaType: "photo",
      };
    }
  }

  const tw = twitchEmbedInfo(line);
  if (tw) {
    let src;
    if (tw.type === "channel") {
      src = `https://player.twitch.tv/?channel=${encodeURIComponent(tw.id)}&${twitchParentQuery()}&muted=true`;
    } else if (tw.type === "video") {
      src = `https://player.twitch.tv/?video=${encodeURIComponent(tw.id)}&${twitchParentQuery()}&muted=true`;
    } else {
      src = `https://clips.twitch.tv/embed?clip=${encodeURIComponent(tw.id)}&${twitchParentQuery()}&muted=true`;
    }
    return {
      kind: "iframe",
      platform: "twitch",
      src,
      label: `Twitch · ${tw.id}`,
      drawable: false,
    };
  }

  if (/\.m3u8(\?.*)?$/i.test(path) || parsed.searchParams.has("m3u8")) {
    return {
      kind: "hls",
      platform: "hls",
      src: parsed.href,
      label: `HLS · ${host}`,
      drawable: true,
    };
  }

  if (/\.(mp4|webm|ogg|ogv|mov)(\?.*)?$/i.test(path)) {
    return {
      kind: "video",
      platform: "direct",
      src: parsed.href,
      label: path.split("/").pop()?.slice(0, 24) || "video",
      drawable: true,
    };
  }

  // Browser-unfriendly containers / any pro codec → ffmpeg stream via booth API
  if (
    /\.(mkv|avi|m2ts|mts|ts|flv|wmv|asf|mpeg|mpg|vob|mxf|r3d|braw|rm|rmvb|3gp|3g2|f4v|ogv|divx|xvid|nut|yuv|y4m|dv|m2v|hevc|h265|h264|av1|ivf|prores|mka)(\?.*)?$/i.test(
      path,
    )
  ) {
    const name = path.split("/").pop()?.slice(0, 28) || "media";
    return {
      kind: "video",
      platform: "ffmpeg",
      src: parsed.href,
      label: `FF · ${name}`,
      drawable: true,
      needsFfmpeg: true,
      original: line,
    };
  }

  // Audio-only → ffmpeg (black + audio stream for booth video element)
  if (/\.(mp3|aac|m4a|wav|flac|ogg|opus|wma|aiff|aif|ac3|eac3|dts|caf|amr)(\?.*)?$/i.test(path)) {
    const name = path.split("/").pop()?.slice(0, 28) || "audio";
    return {
      kind: "video",
      platform: "ffmpeg",
      src: parsed.href,
      label: `Audio · ${name}`,
      drawable: true,
      needsFfmpeg: true,
      mediaType: "audio",
      original: line,
    };
  }

  // TikTok / generic page — not drawable in-browser without yt-dlp proxy
  if (host.includes("tiktok.com")) {
    return {
      kind: "iframe",
      platform: "tiktok",
      src: parsed.href,
      label: "TikTok · resolve via yt-dlp",
      drawable: false,
      note: "Paste direct .m3u8/.mp4 after yt-dlp, or use blank/qbpm ingest",
    };
  }

  return null;
}

export function liveVideoDedupeKey(srcOrItem) {
  if (srcOrItem && typeof srcOrItem === "object") {
    if (srcOrItem.statusId) return `x:${srcOrItem.statusId}:${srcOrItem.src || ""}`;
    if (srcOrItem.platform === "x" && srcOrItem.needsResolve && srcOrItem.statusId) {
      return `x-pending:${srcOrItem.statusId}`;
    }
    return liveVideoDedupeKey(srcOrItem.src || srcOrItem.original || "");
  }
  const src = String(srcOrItem || "");
  const yt = src.match(/youtube\.com\/embed\/([^/?&]+)/i);
  if (yt) return `yt:${decodeURIComponent(yt[1])}`;
  const xEmbed = src.match(/[?&]id=(\d+)/);
  if (xEmbed && /twitter\.com|platform\.twitter/i.test(src)) return `x-pending:${xEmbed[1]}`;
  const xStatus = xStatusIdFromUrl(src);
  if (xStatus) return `x-pending:${xStatus}`;
  // strip query noise on twimg for stable keys
  if (/twimg\.com/i.test(src)) {
    try {
      const u = new URL(src);
      return `twimg:${u.hostname}${u.pathname}`;
    } catch {
      /* */
    }
  }
  return src;
}

const LOCAL_MEDIA_EXT =
  /\.(mkv|webm|avi|m4v|mov|mp4|ts|m2ts|mts|flv|wmv|asf|ogv|mpeg|mpg|vob|mxf|r3d|3gp|f4v|divx|nut|yuv|y4m|dv|m2v|hevc|h265|h264|av1|ivf|prores|mka|mp3|aac|m4a|wav|flac|ogg|opus|wma|aiff|aif|ac3|eac3|dts|caf|png|jpe?g|webp|tif{1,2}|bmp|gif|exr|dpx|tga|hdr|heic)$/i;

/** Local absolute / ~/ / file:// media path, dir, or image sequence pattern. */
export function parseLocalMediaPath(raw) {
  let line = String(raw || "").trim();
  if (!line) return null;
  // Drop wrapping quotes from shell paste
  if (
    (line.startsWith('"') && line.endsWith('"')) ||
    (line.startsWith("'") && line.endsWith("'"))
  ) {
    line = line.slice(1, -1);
  }
  if (line.startsWith("file://")) {
    try {
      line = decodeURIComponent(new URL(line).pathname);
    } catch {
      return null;
    }
  }
  // Absolute unix path or ~/… — not a URL scheme
  if (!/^(\/|~\/)/.test(line)) return null;

  // Image sequence printf / glob
  if (/%0?\d*d|%d|\*\.(png|jpe?g|webp|tif{1,2}|exr|dpx|tga|bmp)/i.test(line)) {
    const base = line.split("/").pop() || "seq";
    return {
      kind: "video",
      platform: "sequence",
      src: line,
      label: `Seq · ${base.slice(0, 24)}`,
      drawable: true,
      needsFfmpeg: true,
      needsMediaOpen: true,
      localPath: line,
      mediaKind: "sequence",
      original: line,
    };
  }

  // Directory (no extension) — treat as sequence folder
  if (!pathHasExt(line) || line.endsWith("/")) {
    const name = line.replace(/\/+$/, "").split("/").pop() || "seq";
    return {
      kind: "video",
      platform: "sequence",
      src: line,
      label: `Seq · ${name.slice(0, 24)}`,
      drawable: true,
      needsFfmpeg: true,
      needsMediaOpen: true,
      localPath: line,
      mediaKind: "sequence",
      original: line,
    };
  }

  if (!LOCAL_MEDIA_EXT.test(line)) return null;

  const name = line.split("/").pop() || "media";
  const needsFfmpeg =
    /\.(mkv|avi|m2ts|mts|ts|flv|wmv|asf|mpeg|mpg|vob|mxf|r3d|3gp|f4v|ogv|divx|nut|yuv|y4m|dv|m2v|hevc|h265|av1|prores|mka|mp3|aac|m4a|wav|flac|ogg|opus|wma|aiff|aif|ac3|eac3|dts|caf|png|jpe?g|webp|tif{1,2}|bmp|exr|dpx|tga|hdr|heic)$/i.test(
      line,
    );
  const isAudio = /\.(mp3|aac|m4a|wav|flac|ogg|opus|wma|aiff|aif|ac3|eac3|dts|caf)$/i.test(line);
  const isImage = /\.(png|jpe?g|webp|tif{1,2}|bmp|gif|exr|dpx|tga|hdr|heic)$/i.test(line);
  return {
    kind: "video",
    platform: needsFfmpeg ? "ffmpeg" : "file",
    src: line,
    label: `${isAudio ? "Audio" : isImage ? "Still" : needsFfmpeg ? "FF" : "File"} · ${name.slice(0, 24)}`,
    drawable: true,
    needsFfmpeg,
    needsMediaOpen: true,
    localPath: line,
    mediaKind: isAudio ? "audio" : isImage ? "image" : "file",
    original: line,
  };
}

function pathHasExt(p) {
  const base = p.split("/").pop() || "";
  return /\.[a-z0-9]{1,8}$/i.test(base);
}

export function parsePasteToItems(text) {
  const items = [];
  const seen = new Set();
  // Prefer whole-line paste for paths with spaces (shell drag-drop / Finder)
  const whole = String(text || "").trim();
  const wholeLocal = parseLocalMediaPath(whole);
  const lines = wholeLocal
    ? [whole]
    : whole
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
  const tokens = wholeLocal ? lines : lines.flatMap((ln) => {
    const local = parseLocalMediaPath(ln);
    return local ? [ln] : splitVideoPaste(ln);
  });
  for (const line of tokens) {
    const parsed = parseVideoEmbedLine(line) || parseLocalMediaPath(line);
    if (!parsed) continue;
    const key =
      parsed.needsResolve && parsed.statusId
        ? `x-pending:${parsed.statusId}`
        : liveVideoDedupeKey(parsed.src || parsed.localPath || parsed.original);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `lv-${key.replace(/[^a-z0-9:+_-]/gi, "").slice(0, 48)}`,
      kind: parsed.kind,
      platform: parsed.platform,
      src: parsed.src,
      label: parsed.label,
      drawable: parsed.drawable,
      note: parsed.note || null,
      original: (parsed.original || line).slice(0, 160),
      needsResolve: !!parsed.needsResolve,
      needsFfmpeg: !!parsed.needsFfmpeg,
      needsMediaOpen: !!parsed.needsMediaOpen,
      localPath: parsed.localPath || null,
      mediaId: parsed.mediaId || null,
      mediaKind: parsed.mediaKind || null,
      statusId: parsed.statusId || null,
      handle: parsed.handle || null,
      mediaType: parsed.mediaType || null,
      thumbnail: parsed.thumbnail || null,
    });
  }
  return items;
}

export function appendUniqueLiveVideos(prev, candidates) {
  const seen = new Set(
    (prev || []).map((x) =>
      x.needsResolve && x.statusId ? `x-pending:${x.statusId}` : liveVideoDedupeKey(x),
    ),
  );
  const trulyNew = [];
  for (const item of candidates || []) {
    const k =
      item.needsResolve && item.statusId
        ? `x-pending:${item.statusId}`
        : liveVideoDedupeKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    trulyNew.push(item);
  }
  return {
    merged: [...(prev || []), ...trulyNew],
    focusLastId: trulyNew.length ? trulyNew[trulyNew.length - 1].id : undefined,
  };
}
