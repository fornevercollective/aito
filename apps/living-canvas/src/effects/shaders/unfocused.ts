import { NOISE_2D, SLIDER_CLIP, VERTEX_FLAT } from "./common.glsl";

/**
 * Unfocused: directional defocus with falloff from a focal origin.
 *
 * Multi-tap blur in direction `angle`, weighted by distance from
 * (originX, originY) per `type` falloff. Chromatic dispersion samples
 * R/G/B at slightly different offsets near heavily blurred zones.
 *
 * Drives from attention/confidence maps:
 *   uBlur scales with (1 - confidence) at a region of interest.
 */

export const UNFOCUSED_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uBlur;       // 0..1000 (px)
  uniform float uAngle;      // 0..360 (deg)
  uniform float uFalloff;    // 0..1
  uniform int   uType;       // 0 linear 1 quadratic 2 cubic 3 square
  uniform vec2  uOrigin;     // 0..1
  uniform float uDistortion; // -1..1
  uniform float uDispersion; // 0..1
  uniform float uNoise;      // 0..1
  uniform int   uBlend;      // 0 none 1 darker 2 lighter 3 both
  varying vec2 vUv;

  ${NOISE_2D}
  ${SLIDER_CLIP}

  float falloffCurve(float d, int t) {
    if (t == 0) return d;
    if (t == 1) return d * d;
    if (t == 2) return d * d * d;
    return step(0.5, d); // square = hard binary
  }

  vec3 sampleBlur(vec2 uv, vec2 dir, float radiusPx, float dispersion) {
    float r = radiusPx;
    vec2 step = (dir * r) / uResolution;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    const int N = 9;
    for (int i = -N; i <= N; i++) {
      float fi = float(i) / float(N);
      float w = exp(-fi * fi * 2.0);
      vec2 ofs = step * fi;
      vec3 s;
      // chromatic dispersion: R/G/B sampled at slightly offset positions
      s.r = texture2D(uMap, uv + ofs * (1.0 + dispersion * 0.6)).r;
      s.g = texture2D(uMap, uv + ofs).g;
      s.b = texture2D(uMap, uv + ofs * (1.0 - dispersion * 0.6)).b;
      acc += s * w;
      wsum += w;
    }
    return acc / wsum;
  }

  void main() {
    sliderClip(vUv);
    vec2 uv = vUv;

    // Optional barrel distortion bending the center.
    if (abs(uDistortion) > 0.001) {
      vec2 c = uv - uOrigin;
      float r2 = dot(c, c);
      uv = uOrigin + c * (1.0 + uDistortion * r2 * 2.0);
    }

    float d = clamp(distance(uv, uOrigin) / 0.7071, 0.0, 1.0);
    float fall = mix(d, falloffCurve(d, uType), clamp(uFalloff, 0.0, 1.0));
    float radiusPx = uBlur * fall;

    float a = radians(uAngle);
    vec2 dir = vec2(cos(a), sin(a));

    vec3 base = texture2D(uMap, uv).rgb;
    vec3 col = sampleBlur(uv, dir, radiusPx, uDispersion);

    if (uNoise > 0.0) {
      float n = (fbm(uv * uResolution * 0.05) - 0.5) * 2.0 * uNoise;
      if (uBlend == 0) {
        col += n;
      } else if (uBlend == 1) {
        col = min(col, col + n);
      } else if (uBlend == 2) {
        col = max(col, col + n);
      } else {
        col += n;
      }
    }

    // Avoid blurring perfectly sharp areas (near origin) — blend back base.
    col = mix(base, col, smoothstep(0.0, 0.05, radiusPx));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const UNFOCUSED_VERT = VERTEX_FLAT;
