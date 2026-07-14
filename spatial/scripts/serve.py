#!/usr/bin/env python3
"""aito-mac static server + studio YouTube/HLS CORS proxy."""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(os.environ.get("AITO_MAC_ROOT", Path(__file__).resolve().parent.parent))
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("audio/wav", ".wav")
mimetypes.add_type("application/vnd.apple.mpegurl", ".m3u8")
mimetypes.add_type("video/x-matroska", ".mkv")
mimetypes.add_type("video/webm", ".webm")

# Cache yt-dlp resolved streams briefly
_YT_CACHE: dict[str, dict] = {}
_X_CACHE: dict[str, dict] = {}

# Local media registry (MKV upload / path open) for ffmpeg stream + ffplay
_MEDIA: dict[str, dict] = {}
_MEDIA_ROOT = Path(os.environ.get("TMPDIR", "/tmp")) / "aito-mac-media"
_FFPLAY_PROC: subprocess.Popen | None = None

_X_STATUS_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx)\.com/"
    r"(?:(?P<handle>[^/]+)/)?status(?:es)?/(?P<id>\d+)",
    re.I,
)


def _best_x_mp4(media_item: dict) -> tuple[str, str] | None:
    """Return (kind, url) for best progressive mp4 or HLS from FxTwitter media item."""
    variants = list(media_item.get("variants") or []) + list(media_item.get("formats") or [])
    mp4s = []
    hls = None
    for v in variants:
        url = v.get("url") or ""
        ct = str(v.get("content_type") or v.get("container") or "").lower()
        if not url:
            continue
        if "mp4" in ct or re.search(r"\.mp4(\?|$)", url, re.I):
            mp4s.append((int(v.get("bitrate") or 0), url))
        elif "mpegurl" in ct or re.search(r"\.m3u8(\?|$)", url, re.I):
            hls = url
    if mp4s:
        mp4s.sort(key=lambda t: t[0])
        best = mp4s[0][1]
        for br, url in mp4s:
            if 0 < br <= 2_500_000:
                best = url
        return "video", best
    direct = media_item.get("url") or ""
    if re.search(r"\.mp4(\?|$)", direct, re.I):
        return "video", direct
    if hls:
        return "hls", hls
    if re.search(r"\.m3u8(\?|$)", direct, re.I):
        return "hls", direct
    return None


def _resolve_x_status(status_id: str, handle: str | None = None) -> dict:
    key = f"{handle or ''}:{status_id}"
    if key in _X_CACHE:
        return _X_CACHE[key]

    endpoints = []
    if handle:
        endpoints.append(f"https://api.fxtwitter.com/{handle}/status/{status_id}")
    endpoints.append(f"https://api.fxtwitter.com/status/{status_id}")

    last_err = "FxTwitter unreachable"
    tweet = None
    for url in endpoints:
        try:
            data, _ct = _fetch(url, timeout=18.0)
            payload = json.loads(data.decode("utf-8", errors="replace"))
            if payload.get("code") == 200 and payload.get("tweet"):
                tweet = payload["tweet"]
                break
            last_err = str(payload.get("message") or "not found")
        except Exception as e:
            last_err = str(e)

    if not tweet:
        # yt-dlp fallback (HLS/mp4)
        ytdlp = shutil.which("yt-dlp")
        if ytdlp:
            page = (
                f"https://x.com/{handle}/status/{status_id}"
                if handle
                else f"https://x.com/i/status/{status_id}"
            )
            proc = subprocess.run(
                [ytdlp, "-f", "best[ext=mp4]/best", "-g", "--no-playlist", page],
                capture_output=True,
                text=True,
                timeout=90,
                check=False,
            )
            if proc.returncode == 0:
                lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
                if lines:
                    stream = lines[0]
                    kind = "hls" if ".m3u8" in stream else "video"
                    out = {
                        "id": status_id,
                        "handle": handle,
                        "title": status_id,
                        "media": [
                            {
                                "kind": kind,
                                "src": stream,
                                "url": stream,
                                "label": f"X · {status_id[:10]}",
                                "drawable": True,
                                "mediaType": "video",
                            }
                        ],
                    }
                    _X_CACHE[key] = out
                    return out
        raise RuntimeError(last_err)

    author = (tweet.get("author") or {}).get("screen_name") or handle or "x"
    media_root = tweet.get("media") or {}
    items = media_root.get("videos") or media_root.get("all") or media_root.get("photos") or []
    media_out: list[dict] = []
    for item in items:
        mtype = str(item.get("type") or "photo").lower()
        if mtype in ("video", "gif", "animated_gif"):
            picked = _best_x_mp4(item)
            if not picked:
                continue
            kind, src = picked
            media_out.append(
                {
                    "kind": kind,
                    "src": src,
                    "url": src,
                    "label": f"X · @{author}",
                    "drawable": True,
                    "thumbnail": item.get("thumbnail_url"),
                    "mediaType": "gif" if "gif" in mtype else "video",
                    "duration": item.get("duration"),
                }
            )
        elif mtype in ("photo", "image"):
            src = item.get("url") or item.get("thumbnail_url")
            if not src:
                continue
            media_out.append(
                {
                    "kind": "image",
                    "src": src,
                    "url": src,
                    "label": f"X · @{author} · photo",
                    "drawable": True,
                    "thumbnail": src,
                    "mediaType": "photo",
                }
            )

    if not media_out:
        raise RuntimeError("X post has no video/photo media")

    out = {
        "id": status_id,
        "handle": author,
        "title": (tweet.get("text") or "")[:120],
        "media": media_out,
    }
    _X_CACHE[key] = out
    return out


def _cors(handler: SimpleHTTPRequestHandler) -> None:
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "*")
    handler.send_header("Cache-Control", "no-store")
    handler._cors_sent = True


def _fetch(url: str, timeout: float = 20.0) -> tuple[bytes, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (aito-mac-booth)",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
        ctype = resp.headers.get("Content-Type") or "application/octet-stream"
        return data, ctype


def _resolve_youtube(video_id: str, height: int = 720) -> dict:
    key = f"{video_id}:{height}"
    if key in _YT_CACHE:
        return _YT_CACHE[key]
    ytdlp = shutil.which("yt-dlp")
    if not ytdlp:
        raise RuntimeError("yt-dlp not found")
    url = f"https://www.youtube.com/watch?v={video_id}"
    # Prefer progressive/hls with height cap for booth
    fmt = f"best[height<={height}]/best"
    cmd = [
        ytdlp,
        "-f",
        fmt,
        "-g",
        "--no-playlist",
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90, check=False)
    if proc.returncode != 0:
        # fallback any
        cmd = [ytdlp, "-g", "--no-playlist", url]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90, check=False)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "yt-dlp failed")
    lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
    if not lines:
        raise RuntimeError("no stream URL from yt-dlp")
    stream = lines[0]
    meta_cmd = [ytdlp, "--no-download", "-J", "--no-playlist", url]
    title = video_id
    is_live = False
    try:
        mp = subprocess.run(meta_cmd, capture_output=True, text=True, timeout=90, check=False)
        if mp.returncode == 0 and mp.stdout:
            info = json.loads(mp.stdout)
            title = info.get("title") or title
            is_live = bool(info.get("is_live"))
    except Exception:
        pass
    kind = "hls" if ".m3u8" in stream or "manifest" in stream else "video"
    out = {
        "id": video_id,
        "title": title,
        "is_live": is_live,
        "kind": kind,
        "stream": stream,
        "proxy": f"/api/proxy?url={urllib.parse.quote(stream, safe='')}",
        "hls_proxy": f"/api/hls?url={urllib.parse.quote(stream, safe='')}" if kind == "hls" else None,
    }
    _YT_CACHE[key] = out
    return out


def _rewrite_m3u8(body: str, base_url: str) -> str:
    """Rewrite playlist lines to go through /api/proxy."""
    base = base_url.rsplit("/", 1)[0] + "/"
    out_lines = []
    for line in body.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            # URI="..." in tags
            if "URI=\"" in line:
                def repl(m: re.Match[str]) -> str:
                    u = m.group(1)
                    if not u.startswith("http"):
                        u = urllib.parse.urljoin(base, u)
                    return f'URI="/api/proxy?url={urllib.parse.quote(u, safe="")}"'

                out_lines.append(re.sub(r'URI="([^"]+)"', repl, line))
            else:
                out_lines.append(line)
            continue
        if s.startswith("http://") or s.startswith("https://"):
            abs_u = s
        else:
            abs_u = urllib.parse.urljoin(base, s)
        out_lines.append(f"/api/proxy?url={urllib.parse.quote(abs_u, safe='')}")
    return "\n".join(out_lines) + "\n"


def _which(name: str) -> str | None:
    return shutil.which(name) or next(
        (
            p
            for p in (
                f"/opt/homebrew/bin/{name}",
                f"/usr/local/bin/{name}",
                f"/opt/local/bin/{name}",
            )
            if Path(p).is_file()
        ),
        None,
    )


def _ffmpeg_status() -> dict:
    home = Path.home()
    repel_candidates = [
        _which("repel"),
        str(home / "dev/ffmpeg/repel/target/release/repel"),
        str(ROOT / "bin/repel"),
    ]
    repel = next((p for p in repel_candidates if p and Path(p).is_file()), None)
    return {
        "ok": bool(_which("ffmpeg") or _which("ffplay")),
        "ffmpeg": _which("ffmpeg"),
        "ffplay": _which("ffplay"),
        "ffprobe": _which("ffprobe"),
        "repel": repel,
        "mediaRoot": str(_MEDIA_ROOT),
        "entries": len(_MEDIA),
        "ffplayRunning": _FFPLAY_PROC is not None and _FFPLAY_PROC.poll() is None,
    }


def _assert_local_media_path(raw: str) -> Path:
    p = (raw or "").strip()
    if not p:
        raise ValueError("missing path")
    if p.startswith("file://"):
        p = urllib.parse.unquote(urllib.parse.urlparse(p).path)
    if p.startswith("~/"):
        p = str(Path.home() / p[2:])
    path = Path(p).expanduser().resolve()
    home = Path.home().resolve()
    media_root = _MEDIA_ROOT.resolve()
    sp = str(path)
    ok = (
        path == home
        or sp.startswith(str(home) + os.sep)
        or sp.startswith("/Volumes/")
        or sp.startswith(str(media_root) + os.sep)
        or sp.startswith("/tmp/")
        or sp.startswith("/private/tmp/")
        or sp.startswith("/var/folders/")
    )
    if not ok:
        raise ValueError("path not under home / Volumes / media cache")
    if not path.is_file():
        raise ValueError("file not found")
    return path


_FPS_PRESETS = [12, 15, 18, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120, 144, 240]
_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".exr", ".dpx", ".tga", ".hdr", ".heic"}


def _parse_fps(raw, fallback=None):
    if raw is None or raw == "" or raw in ("native", "auto"):
        return fallback
    n = float(raw)
    if n <= 0 or n > 480:
        raise ValueError("fps must be 0–480")
    if abs(n - 23.98) < 0.01:
        return 24000 / 1001
    if abs(n - 29.97) < 0.01:
        return 30000 / 1001
    if abs(n - 59.94) < 0.01:
        return 60000 / 1001
    return n


def _register_media(
    path: Path,
    name: str | None = None,
    source: str = "path",
    *,
    kind: str = "file",
    fps=None,
    sequence: dict | None = None,
) -> dict:
    import secrets

    _MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    mid = secrets.token_hex(8)
    entry = {
        "id": mid,
        "path": str(path),
        "name": name or path.name,
        "source": source,
        "kind": kind,
        "fps": fps,
        "sequence": sequence,
    }
    _MEDIA[mid] = entry
    return entry


def _entry_public(entry: dict) -> dict:
    mid = entry["id"]
    p = entry["path"]
    kind = entry.get("kind") or "file"
    fps = entry.get("fps")
    needs = kind in ("sequence", "image", "audio") or bool(
        re.search(
            r"\.(mkv|avi|m2ts|mts|ts|flv|wmv|mpeg|mpg|mxf|prores|hevc|wav|flac|exr|dpx)$",
            p,
            re.I,
        )
    )
    q = f"id={urllib.parse.quote(mid)}"
    if fps is not None:
        q += f"&fps={urllib.parse.quote(str(fps))}"
    return {
        "id": mid,
        "name": entry["name"],
        "source": entry.get("source", "path"),
        "kind": kind,
        "fps": fps,
        "stream": f"/api/media/stream?{q}",
        "streamTranscode": f"/api/media/stream?{q}&mode=transcode",
        "streamCopy": f"/api/media/stream?{q}&mode=copy",
        "ffplay": f"/api/media/ffplay?{q}",
        "probe": f"/api/media/probe?id={urllib.parse.quote(mid)}",
        "needsFfmpeg": needs,
        "sequence": (
            {
                "patternType": (entry.get("sequence") or {}).get("patternType"),
                "dir": (entry.get("sequence") or {}).get("dir"),
                "count": (entry.get("sequence") or {}).get("count"),
                "startNumber": (entry.get("sequence") or {}).get("startNumber"),
                "fps": (entry.get("sequence") or {}).get("fps"),
            }
            if entry.get("sequence")
            else None
        ),
        "fpsPresets": _FPS_PRESETS,
    }


def _open_sequence(raw: str, fps=24.0, start: int = 0) -> dict:
    """Directory or printf pattern → sequence entry."""
    p = (raw or "").strip()
    if p.startswith("~/"):
        p = str(Path.home() / p[2:])
    path = Path(p).expanduser()
    rate = _parse_fps(fps, 24.0) or 24.0
    if "%d" in p or re.search(r"%0?\d*d", p):
        seq = {
            "patternType": "printf",
            "pattern": str(path),
            "dir": str(path.parent),
            "startNumber": int(start or 0),
            "count": None,
            "fps": rate,
        }
        return _register_media(
            path, path.parent.name + " · seq", "sequence", kind="sequence", fps=rate, sequence=seq
        )
    if not path.is_dir():
        raise ValueError("sequence path must be directory or printf pattern")
    names = sorted(
        [n for n in os.listdir(path) if Path(n).suffix.lower() in _IMAGE_EXT],
        key=lambda n: [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", n)],
    )
    if not names:
        raise ValueError("no images in directory")
    # Infer printf
    m = re.match(r"^(.*?)(\d+)(\.[^.]+)$", names[0])
    if m and all(re.match(re.escape(m.group(1)) + r"\d+" + re.escape(m.group(3)) + r"$", n) for n in names):
        width = len(m.group(2))
        start_n = min(int(re.search(r"(\d+)", n).group(1)) for n in names)  # type: ignore
        pattern = str(path / f"{m.group(1)}%0{width}d{m.group(3)}")
        seq = {
            "patternType": "printf",
            "pattern": pattern,
            "dir": str(path),
            "startNumber": start_n,
            "count": len(names),
            "fps": rate,
            "files": [str(path / n) for n in names],
        }
        return _register_media(
            Path(pattern), path.name + " · seq", "sequence", kind="sequence", fps=rate, sequence=seq
        )
    # concat list fallback
    import secrets

    list_path = _MEDIA_ROOT / f"{secrets.token_hex(6)}-seq.txt"
    _MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    dur = 1.0 / rate
    lines = []
    for n in names:
        f = str(path / n).replace("'", r"'\''")
        lines.append(f"file '{f}'")
        lines.append(f"duration {dur}")
    last = str(path / names[-1]).replace("'", r"'\''")
    lines.append(f"file '{last}'")
    list_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    seq = {
        "patternType": "concat",
        "pattern": str(list_path),
        "dir": str(path),
        "startNumber": 0,
        "count": len(names),
        "fps": rate,
        "files": [str(path / n) for n in names],
    }
    return _register_media(
        list_path, path.name + " · seq", "sequence", kind="sequence", fps=rate, sequence=seq
    )


def _probe_entry(entry: dict) -> dict:
    ffprobe = _which("ffprobe")
    if not ffprobe:
        return {"error": "ffprobe not found", "name": entry["name"], "path": entry["path"]}
    proc = subprocess.run(
        [
            ffprobe,
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            entry["path"],
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if proc.returncode != 0:
        return {"error": (proc.stderr or proc.stdout or "ffprobe failed")[:400]}
    try:
        data = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as e:
        return {"error": str(e)}
    streams = data.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    browser = bool(
        v
        and re.match(r"^(h264|avc)$", str(v.get("codec_name") or ""), re.I)
        and (not a or re.match(r"^(aac|mp3|opus)$", str(a.get("codec_name") or ""), re.I))
    )
    return {
        "id": entry["id"],
        "name": entry["name"],
        "path": entry["path"],
        "duration": float(data.get("format", {}).get("duration") or 0) or None,
        "format": data.get("format", {}).get("format_name"),
        "video": (
            {
                "codec": v.get("codec_name"),
                "width": v.get("width"),
                "height": v.get("height"),
            }
            if v
            else None
        ),
        "audio": ({"codec": a.get("codec_name")} if a else None),
        "browserFriendly": browser,
    }


def _stop_ffplay() -> dict:
    global _FFPLAY_PROC
    if _FFPLAY_PROC and _FFPLAY_PROC.poll() is None:
        try:
            _FFPLAY_PROC.terminate()
        except Exception:
            pass
    _FFPLAY_PROC = None
    return {"ok": True, "stopped": True}


def _play_source(source: str, title: str = "aito-mac · media") -> dict:
    global _FFPLAY_PROC
    _stop_ffplay()
    st = _ffmpeg_status()
    if st.get("repel"):
        proc = subprocess.Popen(
            [st["repel"], "play", source, "-window_title", title, "-autoexit"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        _FFPLAY_PROC = proc
        return {"ok": True, "tool": "repel", "pid": proc.pid, "source": source}
    ffplay = st.get("ffplay")
    if not ffplay:
        raise RuntimeError("ffplay not found — brew install ffmpeg")
    proc = subprocess.Popen(
        [ffplay, "-autoexit", "-window_title", title, "-noborder", source],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    _FFPLAY_PROC = proc
    return {"ok": True, "tool": "ffplay", "pid": proc.pid, "source": source}


def _pipe_stream(handler: "Handler", entry: dict, mode: str = "auto", fps=None) -> None:
    ffmpeg = _which("ffmpeg")
    if not ffmpeg:
        handler._json({"error": "ffmpeg not found — brew install ffmpeg"}, 503)
        return
    rate = _parse_fps(fps, entry.get("fps"))
    kind = entry.get("kind") or "file"
    use_tc = mode == "transcode" or kind in ("sequence", "image", "audio") or rate is not None
    if mode == "auto" and not use_tc:
        info = _probe_entry(entry)
        if not info.get("error") and not info.get("browserFriendly"):
            use_tc = True
    if mode == "copy" and kind in ("sequence", "image", "audio"):
        use_tc = True

    args = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error"]
    seq = entry.get("sequence") or {}
    if kind == "sequence" and seq.get("patternType") == "printf":
        args += [
            "-framerate",
            str(rate or seq.get("fps") or 24),
            "-start_number",
            str(seq.get("startNumber") or 0),
            "-i",
            seq.get("pattern") or entry["path"],
        ]
    elif kind == "sequence" and seq.get("patternType") == "concat":
        args += ["-f", "concat", "-safe", "0", "-i", seq.get("pattern") or entry["path"]]
    elif kind == "image":
        args += ["-loop", "1", "-framerate", str(rate or 24), "-i", entry["path"]]
    else:
        if rate is not None:
            args += ["-r", str(rate)]
        args += ["-i", entry["path"]]

    if use_tc:
        args += [
            "-map",
            "0:v:0?",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ac",
            "2",
        ]
        if rate is not None:
            args += ["-r", str(rate)]
        if kind == "image":
            args += ["-an", "-t", "10"]
    else:
        args += ["-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy"]
    args += [
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "-f",
        "mp4",
        "pipe:1",
    ]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdout is not None
    handler.send_response(200)
    handler.send_header("Content-Type", "video/mp4")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Aito-Media-Id", entry["id"])
    handler.send_header("X-Aito-Mode", "transcode" if use_tc else "copy")
    handler.send_header("X-Aito-Fps", str(rate) if rate is not None else "native")
    handler.send_header("X-Aito-Kind", kind)
    _cors(handler)
    handler.end_headers()
    try:
        while True:
            chunk = proc.stdout.read(65536)
            if not chunk:
                break
            handler.wfile.write(chunk)
    except (BrokenPipeError, ConnectionResetError):
        pass
    finally:
        try:
            proc.kill()
        except Exception:
            pass
        try:
            proc.wait(timeout=2)
        except Exception:
            pass


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        pass

    def end_headers(self) -> None:
        # CORS applied explicitly on API responses; static gets ACAO once here
        if not getattr(self, "_cors_sent", False):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        _cors(self)
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        length = int(self.headers.get("Content-Length") or 0)

        if path == "/api/media/open":
            try:
                raw = self.rfile.read(length) if length else b"{}"
                body = json.loads(raw.decode("utf-8") or "{}")
                src = body.get("path") or body.get("file") or body.get("source") or body.get("pattern") or body.get("dir") or ""
                kind = (body.get("kind") or "auto").lower()
                fps = body.get("fps")
                if kind == "sequence" or "%d" in src or "*" in src:
                    entry = _open_sequence(src, fps=fps or 24, start=int(body.get("start") or body.get("start_number") or 0))
                else:
                    # directory of images?
                    try:
                        cand = Path(src).expanduser()
                        if cand.is_dir():
                            entry = _open_sequence(src, fps=fps or 24, start=int(body.get("start") or 0))
                        else:
                            p = _assert_local_media_path(src)
                            ext = p.suffix.lower()
                            ekind = "image" if ext in _IMAGE_EXT else "file"
                            entry = _register_media(p, p.name, "path", kind=ekind, fps=_parse_fps(fps, None))
                    except Exception:
                        p = _assert_local_media_path(src)
                        entry = _register_media(p, p.name, "path", fps=_parse_fps(fps, None))
                self._json(_entry_public(entry))
            except Exception as e:
                self._json({"error": str(e)}, 400)
            return

        if path == "/api/media/sequence":
            try:
                raw = self.rfile.read(length) if length else b"{}"
                body = json.loads(raw.decode("utf-8") or "{}")
                if body.get("files"):
                    # multi-file: use first file's dir via concat list
                    files = body["files"]
                    tmp = Path(files[0]).parent
                    # write temp dir listing approach: open as concat from files
                    import secrets

                    list_path = _MEDIA_ROOT / f"{secrets.token_hex(6)}-seq.txt"
                    _MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
                    rate = _parse_fps(body.get("fps"), 24.0) or 24.0
                    dur = 1.0 / rate
                    lines = []
                    for f in files:
                        esc = str(f).replace("'", r"'\''")
                        lines.append(f"file '{esc}'")
                        lines.append(f"duration {dur}")
                    last = str(files[-1]).replace("'", r"'\''")
                    lines.append(f"file '{last}'")
                    list_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
                    seq = {
                        "patternType": "concat",
                        "pattern": str(list_path),
                        "dir": str(tmp),
                        "count": len(files),
                        "startNumber": 0,
                        "fps": rate,
                        "files": list(files),
                    }
                    entry = _register_media(
                        list_path,
                        f"seq · {len(files)}f",
                        "sequence",
                        kind="sequence",
                        fps=rate,
                        sequence=seq,
                    )
                else:
                    entry = _open_sequence(
                        body.get("path") or body.get("pattern") or body.get("dir") or "",
                        fps=body.get("fps") or 24,
                        start=int(body.get("start") or body.get("start_number") or 0),
                    )
                self._json(_entry_public(entry))
            except Exception as e:
                self._json({"error": str(e)}, 400)
            return

        if path in ("/api/media/fps", "/api/media/configure"):
            try:
                raw = self.rfile.read(length) if length else b"{}"
                body = json.loads(raw.decode("utf-8") or "{}")
                entry = _MEDIA.get(body.get("id") or "")
                if not entry:
                    self._json({"error": "unknown media id"}, 404)
                    return
                if body.get("fps") in (None, "", "native", "auto"):
                    entry["fps"] = None
                else:
                    entry["fps"] = _parse_fps(body.get("fps"), None)
                if entry.get("sequence") and entry.get("fps") is not None:
                    entry["sequence"]["fps"] = entry["fps"]
                self._json(_entry_public(entry))
            except Exception as e:
                self._json({"error": str(e)}, 400)
            return

        if path == "/api/media/upload":
            try:
                name = (qs.get("name") or [None])[0] or self.headers.get("X-File-Name") or "upload.bin"
                data = self.rfile.read(length) if length else b""
                if not data:
                    self._json({"error": "empty body"}, 400)
                    return
                _MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
                import secrets

                mid = secrets.token_hex(8)
                safe = re.sub(r"[^\w.\- ()[\]]+", "_", str(name))[:120]
                dest = _MEDIA_ROOT / f"{mid}-{safe}"
                dest.write_bytes(data)
                entry = {"id": mid, "path": str(dest), "name": safe, "source": "upload"}
                _MEDIA[mid] = entry
                self._json(_entry_public(entry))
            except Exception as e:
                self._json({"error": str(e)}, 400)
            return

        if path == "/api/media/ffplay":
            try:
                raw = self.rfile.read(length) if length else b"{}"
                body = json.loads(raw.decode("utf-8") or "{}")
                title = body.get("title") or "aito-mac · media"
                if body.get("id") and body["id"] in _MEDIA:
                    entry = _MEDIA[body["id"]]
                    self._json(_play_source(entry["path"], f"aito-mac · {entry['name']}"))
                elif body.get("path"):
                    p = _assert_local_media_path(body["path"])
                    self._json(_play_source(str(p), title))
                elif body.get("url") or body.get("source"):
                    self._json(_play_source(body.get("url") or body.get("source"), title))
                else:
                    self._json({"error": "need id, path, or url"}, 400)
            except Exception as e:
                self._json({"error": str(e)}, 400)
            return

        if path == "/api/media/ffplay/stop":
            self._json(_stop_ffplay())
            return

        self._json({"error": "not found"}, 404)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/api/health":
            ff = _ffmpeg_status()
            self._json(
                {
                    "ok": True,
                    "root": str(ROOT),
                    "ffmpeg": bool(ff.get("ffmpeg")),
                    "ffplay": bool(ff.get("ffplay")),
                    "mkv": bool(ff.get("ffmpeg") or ff.get("ffplay")),
                }
            )
            return

        if path == "/api/ffmpeg/status":
            self._json(_ffmpeg_status())
            return

        if path == "/api/media/probe":
            try:
                mid = (qs.get("id") or [""])[0]
                pth = (qs.get("path") or [""])[0]
                if mid and mid in _MEDIA:
                    entry = _MEDIA[mid]
                elif pth:
                    p = _assert_local_media_path(pth)
                    entry = _register_media(p, p.name, "path")
                else:
                    self._json({"error": "need id or path"}, 400)
                    return
                out = _probe_entry(entry)
                out.update(_entry_public(entry))
                self._json(out)
            except Exception as e:
                self._json({"error": str(e)}, 400)
            return

        if path == "/api/ffmpeg/codecs":
            # lightweight: point clients at system ffmpeg -encoders via status
            st = _ffmpeg_status()
            self._json(
                {
                    "note": "Use node serve.mjs for full codec catalog; ffmpeg binary listed in status",
                    "ffmpeg": st.get("ffmpeg"),
                    "fpsPresets": _FPS_PRESETS,
                }
            )
            return

        if path == "/api/media/stream":
            try:
                mid = (qs.get("id") or [""])[0]
                pth = (qs.get("path") or [""])[0]
                mode = ((qs.get("mode") or ["auto"])[0] or "auto").lower()
                fps = (qs.get("fps") or [None])[0]
                if mid and mid in _MEDIA:
                    entry = _MEDIA[mid]
                elif pth:
                    p = _assert_local_media_path(pth)
                    entry = _register_media(p, p.name, "path", fps=_parse_fps(fps, None))
                else:
                    self._json({"error": "missing id or path"}, 400)
                    return
                _pipe_stream(self, entry, mode, fps=fps)
            except Exception as e:
                self._json({"error": str(e)}, 400)
            return

        if path == "/api/media/ffplay":
            try:
                mid = (qs.get("id") or [""])[0]
                pth = (qs.get("path") or [""])[0]
                url = (qs.get("url") or [""])[0]
                title = (qs.get("title") or ["aito-mac · media"])[0]
                if mid and mid in _MEDIA:
                    entry = _MEDIA[mid]
                    self._json(_play_source(entry["path"], f"aito-mac · {entry['name']}"))
                elif pth:
                    p = _assert_local_media_path(pth)
                    self._json(_play_source(str(p), title))
                elif url:
                    self._json(_play_source(url, title))
                else:
                    self._json({"error": "need id, path, or url"}, 400)
            except Exception as e:
                self._json({"error": str(e)}, 400)
            return

        if path == "/api/media/ffplay/stop":
            self._json(_stop_ffplay())
            return

        if path == "/api/yt/resolve":
            vid = (qs.get("v") or qs.get("id") or [""])[0].strip()
            if not vid:
                url = (qs.get("url") or [""])[0]
                m = re.search(r"[?&]v=([\w-]{6,})", url) or re.search(r"youtu\.be/([\w-]{6,})", url)
                vid = m.group(1) if m else ""
            if not vid:
                self._json({"error": "missing v"}, 400)
                return
            try:
                height = int((qs.get("h") or ["720"])[0])
            except ValueError:
                height = 720
            try:
                info = _resolve_youtube(vid, height=height)
                self._json(info)
            except Exception as e:
                self._json({"error": str(e)}, 502)
            return

        if path == "/api/x/resolve":
            status_id = (qs.get("id") or qs.get("status") or [""])[0].strip()
            handle = (qs.get("handle") or qs.get("user") or [""])[0].strip() or None
            if not status_id:
                url = (qs.get("url") or [""])[0]
                m = _X_STATUS_RE.search(url or "")
                if m:
                    status_id = m.group("id")
                    handle = handle or m.group("handle")
            if not status_id or not re.fullmatch(r"\d{5,}", status_id):
                self._json({"error": "missing or invalid X status id"}, 400)
                return
            if handle in (None, "", "i", "intent"):
                handle = None
            try:
                info = _resolve_x_status(status_id, handle)
                self._json(info)
            except Exception as e:
                self._json({"error": str(e)}, 502)
            return

        if path == "/api/hls":
            url = (qs.get("url") or [""])[0]
            if not url:
                self._json({"error": "missing url"}, 400)
                return
            try:
                data, _ctype = _fetch(url)
                text = data.decode("utf-8", errors="replace")
                rewritten = _rewrite_m3u8(text, url)
                body = rewritten.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.apple.mpegurl")
                self.send_header("Content-Length", str(len(body)))
                _cors(self)
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self._json({"error": f"hls proxy: {e}"}, 502)
            return

        if path == "/api/proxy":
            url = (qs.get("url") or [""])[0]
            if not url:
                self._json({"error": "missing url"}, 400)
                return
            # Only allow http(s)
            if not url.startswith("http://") and not url.startswith("https://"):
                self._json({"error": "invalid url"}, 400)
                return
            try:
                data, ctype = _fetch(url)
                # If playlist slipped through proxy, rewrite
                if "mpegurl" in ctype or url.endswith(".m3u8") or b"#EXTM3U" in data[:64]:
                    text = data.decode("utf-8", errors="replace")
                    data = _rewrite_m3u8(text, url).encode("utf-8")
                    ctype = "application/vnd.apple.mpegurl"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                _cors(self)
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self._json({"error": f"proxy: {e}"}, 502)
            return

        return super().do_GET()

    def _json(self, obj: object, status: int = 200) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        _cors(self)
        self.end_headers()
        self.wfile.write(body)


def booth_already_up(host: str = "127.0.0.1") -> int | None:
    port_file = Path("/tmp/aito-mac.port")
    ports = []
    if port_file.exists():
        try:
            ports.append(int(port_file.read_text(encoding="utf-8").strip()))
        except ValueError:
            pass
    ports.extend(range(8768, 8779))
    seen: set[int] = set()
    for port in ports:
        if port in seen:
            continue
        seen.add(port)
        try:
            with urllib.request.urlopen(f"http://{host}:{port}/api/health", timeout=0.4) as resp:
                if resp.status == 200:
                    return port
        except (urllib.error.URLError, TimeoutError, OSError):
            # Fall back to booth page for old servers
            try:
                with urllib.request.urlopen(f"http://{host}:{port}/booth/", timeout=0.3) as resp:
                    if resp.status == 200:
                        return port
            except (urllib.error.URLError, TimeoutError, OSError):
                continue
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("port", nargs="?", type=int, default=8768)
    parser.add_argument("--force", action="store_true", help="Bind even if another server responds")
    args = parser.parse_args()
    host = "127.0.0.1"
    port_file = Path("/tmp/aito-mac.port")

    if not args.force:
        existing = booth_already_up(host)
        if existing is not None:
            # If old server lacks /api/health, still report it (caller may force restart)
            port_file.write_text(str(existing), encoding="utf-8")
            try:
                with urllib.request.urlopen(f"http://{host}:{existing}/api/health", timeout=0.5) as resp:
                    if resp.status == 200:
                        print(
                            f"aito-mac booth already running\n  url   http://{host}:{existing}/booth/",
                            flush=True,
                        )
                        return
            except Exception:
                print(
                    f"aito-mac booth on {existing} is outdated (no /api) — start with --force after stop-booth.sh",
                    flush=True,
                )
                port_file.write_text(str(existing), encoding="utf-8")
                print(f"  url   http://{host}:{existing}/booth/", flush=True)
                return

    httpd = None
    port = args.port
    for candidate in range(args.port, args.port + 11):
        try:
            httpd = ThreadingHTTPServer((host, candidate), Handler)
            port = candidate
            break
        except OSError:
            continue

    if httpd is None:
        raise SystemExit(f"no free port in {args.port}–{args.port + 10}")

    port_file.write_text(str(port), encoding="utf-8")
    print(
        f"aito-mac booth server\n  root  {ROOT}\n  url   http://{host}:{port}/booth/\n  api   http://{host}:{port}/api/yt/resolve?v=IP3P-B-Pf88",
        flush=True,
    )
    try:
        httpd.serve_forever()
    finally:
        port_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
