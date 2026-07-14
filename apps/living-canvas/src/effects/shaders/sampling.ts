import { COLOR_OPS, SLIDER_CLIP, VERTEX_FLAT } from "./common.glsl";

/**
 * Sampling: mechanized pixel-revealing effect.
 *
 * Quantizes UV into N×N cells based on `uPixel` (1..100). Larger pixel
 * → lower resolution. In "stepped" mode the pixel size snaps to the
 * nearest of `uStep` increments for that vintage-equipment feel.
 *
 * Drives nicely from an inference progress signal:
 *   uPixel = lerp(maxPixel, 1, progress)
 */

export const SAMPLING_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uPixel;       // 1..100
  uniform float uBrightness;  // -1..1
  uniform float uContrast;    // -1..2
  uniform float uSaturation;  // -1..2
  uniform float uStep;        // 1..100
  uniform int   uAnimation;   // 0 seamless, 1 stepped
  varying vec2 vUv;

  ${COLOR_OPS}
  ${SLIDER_CLIP}

  void main() {
    sliderClip(vUv);
    float p = uPixel;
    if (uAnimation == 1) {
      float s = max(uStep, 1.0);
      p = floor(p / (100.0 / s) + 0.5) * (100.0 / s);
      p = max(p, 1.0);
    }
    // Convert "pixel size 1..100" into a grid count over the smaller side.
    float minSide = min(uResolution.x, uResolution.y);
    float cells = max(1.0, minSide / max(p, 1.0));
    vec2 grid = vec2(cells * uResolution.x / minSide, cells * uResolution.y / minSide);
    vec2 cell = floor(vUv * grid) / grid + (0.5 / grid);
    vec3 c = texture2D(uMap, cell).rgb;
    c = applyBCS(c, uBrightness, uContrast, uSaturation);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export const SAMPLING_VERT = VERTEX_FLAT;
