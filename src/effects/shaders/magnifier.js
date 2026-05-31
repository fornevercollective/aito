import { NOISE_2D, SLIDER_CLIP, VERTEX_FLAT } from "./common.glsl";
/**
 * Magnifier: liquid-lens distortion at (originX, originY).
 *
 * Inside `uRadius` we displace UVs radially based on `uStrength`,
 * with a flat center (`uSpace`) and feathered edge (`uFeather`,
 * `uThreshold`, `uCompensation`). `uScale` zooms the contents.
 * Chromatic dispersion is applied at the edge band.
 *
 * AI hint: model can suggest a "look here" coordinate and we lerp
 * the magnifier origin to it for cinematic call-outs of edits.
 */
export const MAGNIFIER_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec2  uResolution;
  uniform vec2  uOrigin;       // 0..1
  uniform float uRadius;       // 0..1 (fraction of long side)
  uniform float uStrength;     // 0..1
  uniform float uSpace;        // 0..1
  uniform float uDisturbance;  // 0..1
  uniform float uFeather;      // 0..1
  uniform float uThreshold;    // 0..1
  uniform float uCompensation; // 0..1
  uniform float uDispersion;   // 0..1
  uniform float uScale;        // 0..1
  varying vec2 vUv;

  ${NOISE_2D}
  ${SLIDER_CLIP}

  void main() {
    sliderClip(vUv);
    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;

    // Work in normalized aspect-corrected space.
    vec2 p = vec2((uv.x - uOrigin.x) * aspect, uv.y - uOrigin.y);
    float d = length(p);

    float maxSide = max(uResolution.x, uResolution.y);
    float minSide = min(uResolution.x, uResolution.y);
    float R = uRadius * (maxSide / minSide);

    if (uRadius <= 0.001) {
      gl_FragColor = vec4(texture2D(uMap, uv).rgb, 1.0);
      return;
    }

    // Lens profile: flat in the middle (uSpace), curved toward edge.
    float t = clamp(d / R, 0.0, 1.0);
    float flat = smoothstep(0.0, uSpace, t);
    float edge = smoothstep(uThreshold, 1.0 - uCompensation * 0.5, t);
    float lens = mix(flat, 1.0, edge);

    // Feathered alpha for the lens region.
    float fade = 1.0 - smoothstep(1.0 - uFeather, 1.0, t);

    // Radial displacement.
    vec2 dir = (d > 1e-5) ? p / d : vec2(0.0);
    float push = uStrength * 0.2 * lens * fade;
    vec2 disp = dir * push;
    disp.x /= aspect;

    // Optional zoom in lens region.
    vec2 zoomed = mix(uv, uOrigin + (uv - uOrigin) / (1.0 + uScale * 1.5), fade);
    vec2 srcUv = zoomed - disp;

    // Disturbance: noise warp on the lens surface.
    if (uDisturbance > 0.0) {
      vec2 w = vec2(
        fbm(uv * 20.0),
        fbm(uv * 20.0 + 5.3)
      ) - 0.5;
      srcUv += w * uDisturbance * 0.02 * fade;
    }

    // Chromatic dispersion strongest at edge.
    vec3 col;
    float chro = uDispersion * fade * 0.01 * lens;
    col.r = texture2D(uMap, srcUv + dir * chro * 1.5).r;
    col.g = texture2D(uMap, srcUv).g;
    col.b = texture2D(uMap, srcUv - dir * chro * 1.5).b;

    // Outside lens: passthrough.
    vec3 outside = texture2D(uMap, uv).rgb;
    col = mix(outside, col, fade);
    gl_FragColor = vec4(col, 1.0);
  }
`;
export const MAGNIFIER_VERT = VERTEX_FLAT;
