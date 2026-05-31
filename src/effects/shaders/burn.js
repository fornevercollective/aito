import { NOISE_2D, SLIDER_CLIP, VERTEX_FLAT } from "./common.glsl";
/**
 * Burn: noise-driven masking with glowing edge band.
 *
 * `uBurn` (0..1) is the threshold; fBm noise compared against it
 * decides what's burnt away. Pixels just under the threshold form
 * the edge band, tinted by `uEdgeColor`. Beyond the threshold the
 * pixel is either transparent (uTransparent) or filled with
 * `uMaskColor`.
 *
 * Drives from job lifecycle:
 *   uBurn animates 0 → 1 across the job duration, then snaps back
 *   after the new "after" image is committed.
 */
export const BURN_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec2  uResolution;
  uniform float uBurn;        // 0..1 progress
  uniform float uDensity;     // 0..1
  uniform float uDistortion;  // 0..1
  uniform float uHardness;    // 0..1 (sharpness of edge band)
  uniform float uDispersion;  // 0..1
  uniform vec3  uEdgeColor;
  uniform vec3  uMaskColor;
  uniform bool  uTransparent;
  uniform bool  uInvert;
  varying vec2 vUv;

  ${NOISE_2D}
  ${SLIDER_CLIP}

  void main() {
    sliderClip(vUv);
    vec2 uv = vUv;

    // Density shapes the noise frequency; more nodes when higher.
    float freq = mix(2.5, 20.0, clamp(uDensity, 0.0, 1.0));
    float n = fbm(uv * freq);

    // Distortion warps the source UV near the edge.
    float band = 1.0 - smoothstep(0.0, mix(0.25, 0.02, uHardness), abs(n - uBurn));
    vec2 warp = vec2(
      fbm(uv * freq + 3.1),
      fbm(uv * freq + 7.7)
    ) - 0.5;
    vec2 srcUv = uv + warp * uDistortion * 0.05;

    // Chromatic dispersion near edge.
    vec3 col;
    col.r = texture2D(uMap, srcUv + warp * uDispersion * 0.01).r;
    col.g = texture2D(uMap, srcUv).g;
    col.b = texture2D(uMap, srcUv - warp * uDispersion * 0.01).b;

    bool burnt = uInvert ? (n > uBurn) : (n < uBurn);
    float alpha = 1.0;
    if (burnt) {
      if (uTransparent) {
        alpha = 0.0;
        col = vec3(0.0);
      } else {
        col = uMaskColor;
      }
    }
    // Edge band overlay regardless of side.
    col = mix(col, uEdgeColor, band * (burnt ? 0.6 : 1.0));
    if (band > 0.01) alpha = max(alpha, band);

    gl_FragColor = vec4(col, alpha);
  }
`;
export const BURN_VERT = VERTEX_FLAT;
