/**
 * Lazy load + single-flight ops with retries and structured error handling.
 * Prevents double-init of MediaPipe/HLS and surfaces clear progress/errors.
 */

/**
 * @typedef {{
 *   key: string,
 *   label?: string,
 *   phase: 'loading'|'ready'|'error'|'idle',
 *   attempt?: number,
 *   error?: Error|unknown,
 *   detail?: string,
 * }} LazyProgress
 */

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function errMessage(err, fallback = "Unknown error") {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name || fallback;
  if (err?.message) return String(err.message);
  try {
    return String(err);
  } catch {
    return fallback;
  }
}

/**
 * @param {object} [opts]
 * @param {(p: LazyProgress) => void} [opts.onProgress]
 */
export function createLazyCache(opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();
  /** @type {Map<string, any>} */
  const cache = new Map();
  /** @type {Map<string, { error: unknown, at: number }>} */
  const lastError = new Map();
  /** @type {Map<string, LazyProgress['phase']>} */
  const phase = new Map();

  /**
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fn
   * @param {{
   *   label?: string,
   *   retries?: number,
   *   retryDelayMs?: number,
   *   force?: boolean,
   *   timeoutMs?: number,
   * }} [loadOpts]
   * @returns {Promise<T>}
   */
  async function load(key, fn, loadOpts = {}) {
    const {
      label = key,
      retries = 1,
      retryDelayMs = 450,
      force = false,
      timeoutMs = 0,
    } = loadOpts;

    if (!force && cache.has(key)) {
      phase.set(key, "ready");
      return cache.get(key);
    }
    if (!force && inflight.has(key)) return inflight.get(key);

    if (force) {
      cache.delete(key);
      lastError.delete(key);
    }

    const run = (async () => {
      let lastErr;
      const maxAttempts = Math.max(1, retries + 1);
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        phase.set(key, "loading");
        onProgress({ key, label, phase: "loading", attempt });
        try {
          const work = Promise.resolve().then(() => fn());
          const result =
            timeoutMs > 0
              ? await Promise.race([
                  work,
                  sleep(timeoutMs).then(() => {
                    throw new Error(`${label} timed out after ${timeoutMs}ms`);
                  }),
                ])
              : await work;
          cache.set(key, result);
          lastError.delete(key);
          phase.set(key, "ready");
          onProgress({ key, label, phase: "ready", attempt });
          return result;
        } catch (e) {
          lastErr = e;
          lastError.set(key, { error: e, at: Date.now() });
          phase.set(key, "error");
          onProgress({
            key,
            label,
            phase: "error",
            attempt,
            error: e,
            detail: errMessage(e),
          });
          if (attempt < maxAttempts) {
            await sleep(retryDelayMs * attempt);
          }
        }
      }
      const wrapped = new Error(errMessage(lastErr, `${label} failed`));
      wrapped.cause = lastErr;
      wrapped.lazyKey = key;
      throw wrapped;
    })();

    // Always clear inflight when settled so failed ops can be retried
    const tracked = run.finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, tracked);
    return tracked;
  }

  function get(key) {
    return cache.has(key) ? cache.get(key) : undefined;
  }

  function has(key) {
    return cache.has(key);
  }

  function isLoading(key) {
    return inflight.has(key) || phase.get(key) === "loading";
  }

  function getError(key) {
    return lastError.get(key)?.error;
  }

  function getPhase(key) {
    return phase.get(key) || (cache.has(key) ? "ready" : "idle");
  }

  function reset(key) {
    if (key) {
      cache.delete(key);
      lastError.delete(key);
      phase.set(key, "idle");
      return;
    }
    cache.clear();
    lastError.clear();
    phase.clear();
  }

  function snapshot() {
    const keys = new Set([...cache.keys(), ...inflight.keys(), ...lastError.keys()]);
    const out = {};
    for (const k of keys) {
      out[k] = {
        phase: getPhase(k),
        ready: cache.has(k),
        loading: inflight.has(k),
        error: lastError.has(k) ? errMessage(lastError.get(k).error) : null,
      };
    }
    return out;
  }

  return {
    load,
    get,
    has,
    isLoading,
    getError,
    getPhase,
    reset,
    snapshot,
    inflight,
  };
}

/**
 * Wrap an async operation so only one runs; subsequent callers share the same promise.
 * @template T
 * @param {() => Promise<T>} fn
 */
export function singleFlight(fn) {
  let current = null;
  return function run(...args) {
    if (current) return current;
    current = Promise.resolve()
      .then(() => fn.apply(this, args))
      .finally(() => {
        current = null;
      });
    return current;
  };
}

/**
 * Safe JSON fetch with timeout + non-JSON error bodies.
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [init]
 */
export async function fetchJson(url, init = {}) {
  const { timeoutMs = 30000, ...rest } = init;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...rest, signal: ctrl.signal });
    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      if (!resp.ok) {
        throw new Error(text.slice(0, 180) || `HTTP ${resp.status}`);
      }
      throw new Error("Invalid JSON response");
    }
    if (!resp.ok) {
      throw new Error(data?.error || data?.message || `HTTP ${resp.status}`);
    }
    return data;
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error(`Request timed out (${timeoutMs}ms)`);
    }
    throw e;
  } finally {
    clearTimeout(tid);
  }
}
