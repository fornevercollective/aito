/**
 * Live spatial analysis — person voxel waveforms + pattern prediction.
 *
 * Tuned for elevated multi-cam crowds (spire / plaza views, e.g. Makkah Live):
 *  - ring-buffer of cluster centers + density + audio
 *  - circular-flow scoring (tawaf-style orbits)
 *  - optional TensorFlow.js online dense net for short-horizon prediction
 *  - wave-lift fields that modulate person cloud Z / column pulse
 */

export const ANALYSIS_PARAMS = {
  analysisEnable: {
    min: 0,
    max: 1,
    step: 1,
    value: 1,
    label: "Spatial analysis",
    group: "analysis",
  },
  analysisPredict: {
    min: 0,
    max: 1,
    step: 1,
    value: 1,
    label: "TF pattern predict",
    group: "analysis",
  },
  analysisHorizon: {
    min: 2,
    max: 24,
    step: 1,
    value: 10,
    label: "Predict horizon",
    group: "analysis",
  },
  analysisWaveLift: {
    min: 0,
    max: 2.5,
    step: 0.05,
    value: 1.2,
    label: "Voxel wave lift",
    group: "analysis",
  },
  analysisHistory: {
    min: 16,
    max: 120,
    step: 1,
    value: 48,
    label: "History frames",
    group: "analysis",
  },
  analysisTrain: {
    min: 0,
    max: 1,
    step: 1,
    value: 1,
    label: "Online TF train",
    group: "analysis",
  },
};

const TF_CDN = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/+esm";
const FEAT_DIM = 8; // nx, ny, dens, bass, mid, high, vx, vy
const WINDOW = 8;

/**
 * @typedef {{ nx: number, ny: number, v?: number }} Cluster
 * @typedef {{
 *   t: number,
 *   clusters: Cluster[],
 *   personFrac: number,
 *   bass: number,
 *   mid: number,
 *   high: number,
 *   beat: number,
 *   energy: number,
 * }} AnalysisFrame
 */

export class SpatialPatternAnalyzer {
  constructor(params) {
    this.params = params;
    /** @type {AnalysisFrame[]} */
    this.history = [];
    /** @type {{ nx: number, ny: number, t: number, id: number }[]} */
    this.tracks = [];
    this.nextTrackId = 1;
    /** @type {{ nx: number, ny: number, conf: number, t: number }[]} */
    this.predictions = [];
    this.pattern = "idle";
    this.patternScore = 0;
    this.circularity = 0;
    this.angularVel = 0;
    this.flowEnergy = 0;
    this.tfReady = false;
    this.tfError = null;
    this.tfLoading = null;
    /** @type {any} */
    this.tf = null;
    /** @type {any} */
    this.model = null;
    this.trainSteps = 0;
    this.lastPredictMs = 0;
    this.lastStatus = "analysis · idle";
    /** Sparse wave field samples for person Z lift */
    this._waveField = [];
    this.sampleCount = 0;
  }

  get enabled() {
    return (this.params.analysisEnable?.value ?? 1) >= 0.5;
  }

  get predictOn() {
    return this.enabled && (this.params.analysisPredict?.value ?? 1) >= 0.5;
  }

  get trainOn() {
    return this.predictOn && (this.params.analysisTrain?.value ?? 1) >= 0.5;
  }

  /**
   * Ingest one analysis frame from studio clusters + audio drive.
   * @param {{
   *   clusters: Cluster[],
   *   personFrac?: number,
   *   audio?: { bass?: number, mid?: number, high?: number, beat?: number, energy?: number },
   *   t?: number,
   * }} frame
   */
  push(frame) {
    if (!this.enabled) {
      this.lastStatus = "analysis · off";
      return this.snapshot();
    }
    const t = frame.t ?? performance.now() * 0.001;
    const audio = frame.audio || {};
    const clusters = (frame.clusters || []).map((c) => ({
      nx: clamp01(c.nx),
      ny: clamp01(c.ny),
      v: c.v ?? 0.5,
    }));
    const entry = {
      t,
      clusters,
      personFrac: frame.personFrac ?? 0,
      bass: audio.bass ?? 0,
      mid: audio.mid ?? 0,
      high: audio.high ?? 0,
      beat: audio.beat ?? 0,
      energy: audio.energy ?? 0,
    };
    this.history.push(entry);
    const maxH = Math.round(this.params.analysisHistory?.value ?? 48);
    if (this.history.length > maxH) this.history.splice(0, this.history.length - maxH);
    this.sampleCount++;

    this._updateTracks(clusters, t);
    this._scorePatterns();
    this._buildWaveField(entry);
    if (this.predictOn) {
      void this._maybePredict(t);
    }
    this.lastStatus = this._statusLine();
    return this.snapshot();
  }

  /**
   * Extra Z / size lift for a person sample at normalized image coords.
   * Used when lifting voxel waveforms of people.
   */
  waveLiftAt(nx, ny) {
    if (!this.enabled || !this._waveField.length) return 0;
    const gain = this.params.analysisWaveLift?.value ?? 1.2;
    let best = 0;
    let bestD = 0.35;
    for (const w of this._waveField) {
      const d = Math.hypot(w.nx - nx, w.ny - ny);
      if (d < bestD) {
        bestD = d;
        best = w.amp;
      }
    }
    // falloff
    const fall = Math.max(0, 1 - bestD / 0.35);
    return best * fall * gain;
  }

  snapshot() {
    return {
      pattern: this.pattern,
      patternScore: this.patternScore,
      circularity: this.circularity,
      angularVel: this.angularVel,
      flowEnergy: this.flowEnergy,
      predictions: this.predictions.slice(),
      tracks: this.tracks.map((tr) => ({ ...tr })),
      tfReady: this.tfReady,
      tfError: this.tfError,
      trainSteps: this.trainSteps,
      historyLen: this.history.length,
      sampleCount: this.sampleCount,
      status: this.lastStatus,
      waveField: this._waveField.slice(0, 12),
    };
  }

  /** UI string */
  _statusLine() {
    const pred = this.predictions.length;
    const tf = this.tfReady ? `tf·${this.trainSteps}` : this.tfError ? "tf·err" : this.predictOn ? "tf·…" : "tf·off";
    return `analysis · ${this.pattern} ${(this.patternScore * 100) | 0}% · circ ${(this.circularity * 100) | 0}% · ω ${this.angularVel.toFixed(2)} · pred ${pred} · ${tf}`;
  }

  _updateTracks(clusters, t) {
    const assigned = new Set();
    const next = [];
    for (const c of clusters) {
      let best = null;
      let bestD = 0.14;
      for (const tr of this.tracks) {
        if (assigned.has(tr.id)) continue;
        const d = Math.hypot(tr.nx - c.nx, tr.ny - c.ny);
        if (d < bestD) {
          bestD = d;
          best = tr;
        }
      }
      if (best) {
        assigned.add(best.id);
        const dt = Math.max(0.008, t - best.t);
        best.vx = (c.nx - best.nx) / dt;
        best.vy = (c.ny - best.ny) / dt;
        best.nx = c.nx;
        best.ny = c.ny;
        best.v = c.v;
        best.t = t;
        best.age = (best.age || 0) + 1;
        next.push(best);
      } else {
        next.push({
          id: this.nextTrackId++,
          nx: c.nx,
          ny: c.ny,
          v: c.v,
          vx: 0,
          vy: 0,
          t,
          age: 1,
        });
      }
    }
    // keep briefly missing tracks for prediction continuity
    for (const tr of this.tracks) {
      if (assigned.has(tr.id)) continue;
      if (t - tr.t < 0.45) next.push(tr);
    }
    this.tracks = next.slice(0, 12);
  }

  _scorePatterns() {
    if (this.tracks.length < 1 || this.history.length < 4) {
      this.pattern = "warming";
      this.patternScore = 0.15;
      this.circularity = 0;
      this.angularVel = 0;
      this.flowEnergy = 0;
      return;
    }

    // Mean position as plaza center proxy
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const tr of this.tracks) {
      cx += tr.nx;
      cy += tr.ny;
      n++;
    }
    cx /= n;
    cy /= n;

    let angSum = 0;
    let angAbs = 0;
    let radVar = 0;
    let speed = 0;
    const rs = [];
    for (const tr of this.tracks) {
      const dx = tr.nx - cx;
      const dy = tr.ny - cy;
      const r = Math.hypot(dx, dy) + 1e-5;
      rs.push(r);
      // tangential component of velocity
      const tx = -dy / r;
      const ty = dx / r;
      const tang = tr.vx * tx + tr.vy * ty;
      angSum += tang / r;
      angAbs += Math.abs(tang);
      speed += Math.hypot(tr.vx, tr.vy);
    }
    this.angularVel = angSum / n;
    this.flowEnergy = Math.min(1, speed / Math.max(1, n) * 2.2);

    const meanR = rs.reduce((a, b) => a + b, 0) / rs.length;
    radVar = rs.reduce((a, r) => a + (r - meanR) ** 2, 0) / rs.length;
    // high |angular| + stable radius → circular crowd orbit (spire cam / tawaf-like)
    const angCoherence = Math.min(1, Math.abs(this.angularVel) * 8);
    const radStability = Math.max(0, 1 - radVar * 40);
    this.circularity = clamp01(angCoherence * 0.55 + radStability * 0.45);

    const radialPulse =
      this.history.length >= 6
        ? Math.abs(
            (this.history[this.history.length - 1].personFrac || 0) -
              (this.history[this.history.length - 6].personFrac || 0),
          )
        : 0;

    if (this.circularity > 0.55 && Math.abs(this.angularVel) > 0.02) {
      this.pattern = "circular_flow";
      this.patternScore = this.circularity;
    } else if (radialPulse > 0.08 && this.flowEnergy < 0.25) {
      this.pattern = "density_wave";
      this.patternScore = clamp01(radialPulse * 4);
    } else if (this.flowEnergy > 0.35) {
      this.pattern = "linear_drift";
      this.patternScore = clamp01(this.flowEnergy);
    } else if (this.flowEnergy < 0.08) {
      this.pattern = "static_cluster";
      this.patternScore = 0.5;
    } else {
      this.pattern = "mixed";
      this.patternScore = 0.35 + this.circularity * 0.3;
    }

    // audio reinforces wave pattern
    const last = this.history[this.history.length - 1];
    if (last && last.energy > 0.45 && this.pattern === "circular_flow") {
      this.patternScore = Math.min(1, this.patternScore + 0.08);
    }
  }

  _buildWaveField(entry) {
    const field = [];
    const lift = this.params.analysisWaveLift?.value ?? 1.2;
    const circBoost = 1 + this.circularity * 0.8;
    for (const tr of this.tracks) {
      const speed = Math.hypot(tr.vx || 0, tr.vy || 0);
      const tang = Math.abs(this.angularVel) * 2;
      const audio = entry.bass * 0.45 + entry.mid * 0.25 + entry.beat * 0.4;
      const amp =
        (0.08 + speed * 0.35 + tang * 0.2 + (tr.v || 0.4) * 0.12 + audio * 0.25) * circBoost;
      field.push({
        nx: tr.nx,
        ny: tr.ny,
        amp: amp * Math.min(1.8, lift),
        id: tr.id,
      });
    }
    // density-grid residual wave for untracked mass
    if (entry.clusters.length) {
      for (const c of entry.clusters) {
        field.push({
          nx: c.nx,
          ny: c.ny,
          amp: (0.05 + (c.v || 0.4) * 0.15 + entry.high * 0.12) * lift * 0.7,
          id: -1,
        });
      }
    }
    this._waveField = field.slice(0, 24);
  }

  async ensureTf() {
    if (this.tfReady) return true;
    if (this.tfError) return false;
    if (this.tfLoading) return this.tfLoading;
    this.tfLoading = (async () => {
      try {
        const mod = await import(/* @vite-ignore */ TF_CDN);
        this.tf = mod.default || mod;
        if (this.tf?.ready) await this.tf.ready();
        this.model = this._buildModel();
        this.tfReady = true;
        this.tfError = null;
        return true;
      } catch (e) {
        this.tfError = e?.message || String(e);
        this.tfReady = false;
        return false;
      } finally {
        this.tfLoading = null;
      }
    })();
    return this.tfLoading;
  }

  _buildModel() {
    const tf = this.tf;
    const model = tf.sequential();
    model.add(
      tf.layers.dense({
        units: 24,
        activation: "relu",
        inputShape: [WINDOW * FEAT_DIM],
      }),
    );
    model.add(tf.layers.dense({ units: 16, activation: "relu" }));
    model.add(tf.layers.dense({ units: 2, activation: "linear" })); // dnx, dny
    model.compile({ optimizer: tf.train.adam(0.008), loss: "meanSquaredError" });
    return model;
  }

  _featFromTrack(tr, audio) {
    return [
      tr.nx,
      tr.ny,
      tr.v ?? 0.5,
      audio.bass ?? 0,
      audio.mid ?? 0,
      audio.high ?? 0,
      clamp(tr.vx ?? 0, -1, 1),
      clamp(tr.vy ?? 0, -1, 1),
    ];
  }

  async _maybePredict(t) {
    const now = performance.now();
    if (now - this.lastPredictMs < 80) return; // ~12 Hz
    this.lastPredictMs = now;

    const horizon = Math.round(this.params.analysisHorizon?.value ?? 10);
    const preds = [];

    // Heuristic circular / ballistic predictions (always available)
    for (const tr of this.tracks) {
      if ((tr.age || 0) < 2) continue;
      let nx = tr.nx;
      let ny = tr.ny;
      let vx = tr.vx || 0;
      let vy = tr.vy || 0;
      // Bias velocity toward circular field when circular_flow
      if (this.pattern === "circular_flow" && this.circularity > 0.4) {
        const cx = 0.5;
        const cy = 0.52;
        const dx = nx - cx;
        const dy = ny - cy;
        const r = Math.hypot(dx, dy) + 1e-5;
        const omega = this.angularVel || 0.08 * Math.sign(this.angularVel || 1);
        // tangential unit
        const tx = -dy / r;
        const ty = dx / r;
        vx = vx * 0.35 + tx * omega * r * 0.65;
        vy = vy * 0.35 + ty * omega * r * 0.65;
      }
      const step = 0.05; // ~ predicted 50ms steps
      for (let h = 1; h <= horizon; h++) {
        nx = clamp01(nx + vx * step);
        ny = clamp01(ny + vy * step);
        // slight radial restore toward mean ring
        if (this.circularity > 0.5) {
          const cx = 0.5;
          const cy = 0.52;
          const dx = nx - cx;
          const dy = ny - cy;
          const r = Math.hypot(dx, dy) + 1e-5;
          const targetR = 0.22;
          const corr = (targetR - r) * 0.04;
          nx = clamp01(nx + (dx / r) * corr);
          ny = clamp01(ny + (dy / r) * corr);
        }
        if (h === horizon || h % 2 === 0) {
          preds.push({
            nx,
            ny,
            conf: clamp01(0.35 + this.patternScore * 0.4 + (tr.age || 1) * 0.02),
            t: t + h * step,
            trackId: tr.id,
            source: "heuristic",
          });
        }
      }
    }

    // TF residual correction when ready
    if (this.predictOn) {
      const ok = await this.ensureTf();
      if (ok && this.model && this.history.length >= WINDOW + 1) {
        try {
          await this._tfTrainAndPredict(preds, horizon, t);
        } catch (e) {
          this.tfError = e?.message || String(e);
        }
      }
    }

    this.predictions = preds.slice(0, 48);
  }

  async _tfTrainAndPredict(preds, horizon, t) {
    const tf = this.tf;
    const last = this.history[this.history.length - 1];
    if (!last?.clusters?.length || this.tracks.length === 0) return;

    // Build one training pair from track-averaged features over window
    if (this.trainOn && this.history.length >= WINDOW + 1) {
      const xs = [];
      const ys = [];
      const hist = this.history;
      for (let i = hist.length - WINDOW - 1; i >= Math.max(0, hist.length - WINDOW - 6); i--) {
        const windowFrames = hist.slice(i, i + WINDOW);
        const target = hist[i + WINDOW];
        if (windowFrames.length < WINDOW || !target) continue;
        const flat = [];
        for (const f of windowFrames) {
          const c = meanCluster(f.clusters);
          flat.push(
            c.nx,
            c.ny,
            f.personFrac || 0,
            f.bass,
            f.mid,
            f.high,
            0,
            0,
          );
        }
        const tc = meanCluster(target.clusters);
        const pc = meanCluster(windowFrames[WINDOW - 1].clusters);
        xs.push(flat);
        ys.push([tc.nx - pc.nx, tc.ny - pc.ny]);
      }
      if (xs.length) {
        const xTensor = tf.tensor2d(xs);
        const yTensor = tf.tensor2d(ys);
        await this.model.fit(xTensor, yTensor, { epochs: 1, batchSize: xs.length, verbose: 0 });
        xTensor.dispose();
        yTensor.dispose();
        this.trainSteps += 1;
      }
    }

    // Predict residual delta for each track mean feature
    for (const tr of this.tracks.slice(0, 6)) {
      const flat = [];
      const histSlice = this.history.slice(-WINDOW);
      while (histSlice.length < WINDOW) {
        histSlice.unshift(histSlice[0] || last);
      }
      for (const f of histSlice) {
        flat.push(
          tr.nx,
          tr.ny,
          tr.v ?? 0.5,
          f.bass,
          f.mid,
          f.high,
          clamp(tr.vx ?? 0, -1, 1),
          clamp(tr.vy ?? 0, -1, 1),
        );
      }
      const x = tf.tensor2d([flat]);
      const y = this.model.predict(x);
      const delta = await y.data();
      x.dispose();
      y.dispose();
      let nx = tr.nx;
      let ny = tr.ny;
      const dnx = delta[0] || 0;
      const dny = delta[1] || 0;
      for (let h = 1; h <= Math.min(horizon, 8); h++) {
        nx = clamp01(nx + dnx);
        ny = clamp01(ny + dny);
        preds.push({
          nx,
          ny,
          conf: clamp01(0.4 + this.patternScore * 0.35),
          t: t + h * 0.05,
          trackId: tr.id,
          source: "tf",
        });
      }
    }
  }
}

function meanCluster(clusters) {
  if (!clusters?.length) return { nx: 0.5, ny: 0.5, v: 0 };
  let nx = 0;
  let ny = 0;
  let v = 0;
  for (const c of clusters) {
    nx += c.nx;
    ny += c.ny;
    v += c.v || 0;
  }
  const n = clusters.length;
  return { nx: nx / n, ny: ny / n, v: v / n };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Kaaba / elevated plaza live — default test stream (spire multiview crowd). */
export const CROWD_SPIRE_YT = "https://www.youtube.com/watch?v=m9-Umj3aL1I";
export const CROWD_SPIRE_YT_ID = "m9-Umj3aL1I";
export const CROWD_SPIRE_LABEL = "Makkah Live · spire cams";
