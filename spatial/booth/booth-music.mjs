/** Live musicality bus — MIDI, note-on, mic/file FFT → shader uniforms. */

export const DEFAULT_TRACK = "/music/rosegold.m4a";
export const DEFAULT_TRACK_LABEL = "Roségold";

export class MusicBus {
  constructor() {
    this.beat = 0;
    this.energy = 0;
    this.lastNote = 0;
    this.ccEnergy = 0;
    this.harmonic = 0;
    this.bass = 0;
    this.mid = 0;
    this.high = 0;
    this.audioEnergy = 0;
  }

  /** @param {number} velocity01 0..1 */
  ping(velocity01 = 1, sens = 1) {
    const v = velocity01 * sens;
    this.beat = Math.min(1, this.beat + v * 0.85);
    this.energy = Math.min(1, this.energy + v * 0.5);
    this.ccEnergy = Math.min(1, this.ccEnergy + v * 0.35);
  }

  noteOn(note, velocity01 = 1) {
    this.lastNote = note;
    this.harmonic = (note % 12) / 12;
    this.ping(velocity01);
  }

  /** @param {{ bass?: number, mid?: number, high?: number, energy?: number }} bands 0..1 */
  ingestAudio(bands, gain = 1) {
    const g = gain;
    const e = Math.min(1, (bands.energy ?? 0) * g);
    this.bass = Math.min(1, (bands.bass ?? 0) * g);
    this.mid = Math.min(1, (bands.mid ?? 0) * g);
    this.high = Math.min(1, (bands.high ?? 0) * g);
    this.audioEnergy = e;
    if (e > 0.08) {
      this.beat = Math.min(1, this.beat + e * 0.45);
      this.energy = Math.min(1, this.energy + e * 0.35);
    }
  }

  tick(beatDecay = 0.93, noteDecay = 0.94) {
    this.beat *= beatDecay;
    this.energy *= beatDecay;
    this.ccEnergy *= beatDecay;
    this.harmonic *= noteDecay;
    this.bass *= beatDecay;
    this.mid *= beatDecay;
    this.high *= beatDecay;
    this.audioEnergy *= beatDecay;
  }

  /** Combined 0..1 drive for splat pulse */
  drive(gain = 1, bassDrive = 0, midDrive = 0) {
    const midi = this.beat * 0.55 + this.energy * 0.3 + this.ccEnergy * 0.15;
    const audio = this.bass * bassDrive + this.mid * midDrive * 0.6 + this.audioEnergy * 0.25;
    return Math.min(1, (midi + audio) * gain);
  }
}

function bandsFromFreq(freq) {
  const n = freq.length;
  const bEnd = Math.floor(n * 0.12);
  const mEnd = Math.floor(n * 0.45);
  let bass = 0;
  let mid = 0;
  let high = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const v = freq[i] / 255;
    total += v;
    if (i < bEnd) bass += v;
    else if (i < mEnd) mid += v;
    else high += v;
  }
  return {
    bass: bass / (bEnd || 1),
    mid: mid / ((mEnd - bEnd) || 1),
    high: high / ((n - mEnd) || 1),
    energy: total / n,
    bins: freq,
  };
}

/** Web Audio mic or file playback → FFT for the music path. */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
    this.element = null;
    this.freq = null;
    this.active = false;
    this.mode = null;
    this.trackUrl = "";
    this.trackLabel = "";
  }

  _ensureAnalyser() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      // Higher resolution for studio waveform visibility
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.55;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -18;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeDomain = new Uint8Array(this.analyser.fftSize);
    }
    return this.analyser;
  }

  async startMic() {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    this._ensureAnalyser();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    this.active = true;
    this.mode = "mic";
    this.trackUrl = "";
    this.trackLabel = "Mic";
    return true;
  }

  /** @param {string} url HTTP URL or blob: URL */
  async loadTrack(url, label = "Track") {
    this.stop();
    this._ensureAnalyser();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.loop = true;
    el.preload = "auto";
    el.src = url;

    await new Promise((resolve, reject) => {
      el.addEventListener("canplaythrough", resolve, { once: true });
      el.addEventListener("error", () => reject(new Error(`Failed to load track: ${label}`)), {
        once: true,
      });
      el.load();
    });

    this.source = this.ctx.createMediaElementSource(el);
    this.source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    await el.play();
    this.element = el;
    this.active = true;
    this.mode = "track";
    this.trackUrl = url;
    this.trackLabel = label;
    return true;
  }

  async loadDefaultTrack() {
    return this.loadTrack(DEFAULT_TRACK, DEFAULT_TRACK_LABEL);
  }

  togglePause() {
    if (!this.active || this.mode !== "track" || !this.element) return false;
    if (this.element.paused) {
      this.element.play().catch(() => {});
      return true;
    }
    this.element.pause();
    return false;
  }

  stop() {
    if (this.element) {
      this.element.pause();
      this.element.src = "";
      this.element = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch { /* */ }
      this.source = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch { /* */ }
    }
    this.active = false;
    this.mode = null;
    this.trackUrl = "";
    this.trackLabel = "";
  }

  /**
   * Tap audio from a playing HTMLMediaElement (live HLS / staged video).
   * @param {HTMLMediaElement} el
   * @param {string} [label]
   */
  async connectMediaElement(el, label = "Live A/V") {
    if (!el) throw new Error("No media element");
    this.stop();
    this._ensureAnalyser();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    // captureStream preferred when available (same process audio+video)
    let srcNode = null;
    try {
      if (typeof el.captureStream === "function") {
        const stream = el.captureStream();
        if (stream.getAudioTracks().length) {
          this.stream = stream;
          srcNode = this.ctx.createMediaStreamSource(stream);
        }
      }
    } catch {
      /* fall through */
    }
    if (!srcNode) {
      try {
        el.crossOrigin = el.crossOrigin || "anonymous";
        srcNode = this.ctx.createMediaElementSource(el);
        // Keep audible through speakers for studio monitoring
        srcNode.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
        this.source = srcNode;
        this.element = el;
        this.active = true;
        this.mode = "media";
        this.trackLabel = label;
        return true;
      } catch (e) {
        throw new Error(`Audio tap failed (CORS?): ${e?.message || e}`);
      }
    }
    srcNode.connect(this.analyser);
    // Don't double-route destination if only analysing captureStream
    this.source = srcNode;
    this.element = el;
    this.active = true;
    this.mode = "media";
    this.trackLabel = label;
    return true;
  }

  /** @returns {{ bass: number, mid: number, high: number, energy: number, bins: Uint8Array|null, wave: Uint8Array|null, playing: boolean }} */
  sample() {
    if (!this.active || !this.analyser || !this.freq) {
      return { bass: 0, mid: 0, high: 0, energy: 0, bins: null, wave: null, playing: false };
    }
    if ((this.mode === "track" || this.mode === "media") && this.element?.paused) {
      return { bass: 0, mid: 0, high: 0, energy: 0, bins: null, wave: null, playing: false };
    }
    this.analyser.getByteFrequencyData(this.freq);
    if (this.timeDomain) this.analyser.getByteTimeDomainData(this.timeDomain);
    const bands = bandsFromFreq(this.freq);
    // Peak boost for visible reaction
    const peak = Math.max(bands.bass, bands.mid, bands.high, bands.energy);
    const boost = peak > 0.02 ? 1.35 : 1;
    return {
      bass: Math.min(1, bands.bass * boost * 1.25),
      mid: Math.min(1, bands.mid * boost * 1.15),
      high: Math.min(1, bands.high * boost * 1.35),
      energy: Math.min(1, bands.energy * boost * 1.2),
      bins: this.freq,
      wave: this.timeDomain || null,
      playing: true,
    };
  }
}

/** @deprecated use AudioEngine */
export const AudioAnalyser = AudioEngine;