import { NOISE_2D, SLIDER_CLIP, VERTEX_FLAT } from "./common.glsl";

/**
 * Crack: grid-segmented displacement, used to visualize tiled
 * inference: each cell is a "chunk" that snaps into place as
 * the AI restitches.
 *
 *   - "modern" type: cells stay fixed but the sampled UV inside
 *     each cell is offset; produces wrinkle/pleat look.
 *   - "classic" type: whole cell is translated; produces a
 *     dispersed mosaic that resolves into the final image as
 *     `uStrength` → 0.
 *
 * `uReady` (0..1) is a fade-in over `uFadeIn` flag — drive from
 * the fraction of tiles received.
 */

export const CRACK_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec2  uResolution;
  uniform float uSegment;    // 1..100
  uniform float uStrength;   // 0..1
  uniform float uDispersion; // 0..1
  uniform int   uType;       // 0 classic 1 modern
  uniform float uReady;      // 0..1 fade-in progress
  uniform bool  uFadeIn;
  varying vec2 vUv;

  ${NOISE_2D}
  ${SLIDER_CLIP}

  vec2 cellRand(vec2 id) {
    return vec2(hash21(id), hash21(id + 17.3)) * 2.0 - 1.0;
  }

  void main() {
    sliderClip(vUv);
    float seg = max(uSegment, 1.0);
    vec2 g = vec2(seg);
    vec2 cellId = floor(vUv * g);
    vec2 local  = fract(vUv * g);
    vec2 r = cellRand(cellId);

    vec2 srcUv;
    if (uType == 0) {
      // classic: cells displaced as wholes
      vec2 cellOrigin = (cellId + 0.5) / g + r * uStrength * 0.5 / g;
      srcUv = cellOrigin + (local - 0.5) / g;
    } else {
      // modern: sample within cell, offset locally
      vec2 jitter = r * uStrength * 0.5;
      srcUv = (cellId + local + jitter) / g;
    }

    vec3 col;
    vec2 chro = r * uDispersion * 0.02;
    col.r = texture2D(uMap, srcUv + chro).r;
    col.g = texture2D(uMap, srcUv).g;
    col.b = texture2D(uMap, srcUv - chro).b;

    // Per-cell fade-in based on uReady, sequenced by cell hash.
    float a = 1.0;
    if (uFadeIn) {
      float order = hash21(cellId);
      a = smoothstep(order - 0.1, order + 0.1, uReady);
    }
    gl_FragColor = vec4(col, a);
  }
`;

export const CRACK_VERT = VERTEX_FLAT;
