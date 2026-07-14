import { NOISE_2D, SLIDER_CLIP, VERTEX_FLAT } from "./common.glsl";

/**
 * Glass: refraction + roughness + chromatic dispersion.
 *
 * v0 generates a procedural height/normal field. Patterns:
 *   - lens:   radial bump (one big lens centered at origin)
 *   - ripple: stacked sine waves (fluted glass feel)
 *   - splat:  fBm hills, intended as a stand-in for a gsplat-
 *             baked normal map; later swap for a real RGBA normal
 *             texture from the inference pipeline.
 *
 * `uDepth` lifts the apparent depth so highlights and refraction
 * scale together, matching the volumetric look of real glass.
 */

export const GLASS_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec2  uResolution;
  uniform float uIor;        // 0..2 (1 = passthrough)
  uniform float uRoughness;  // 0..1
  uniform float uBump;       // 0..1
  uniform float uDispersion; // 0..1
  uniform float uDepth;      // 0..1
  uniform int   uPattern;    // 0 lens, 1 ripple, 2 splat
  varying vec2 vUv;

  ${NOISE_2D}
  ${SLIDER_CLIP}

  float heightField(vec2 uv) {
    if (uPattern == 0) {
      // Radial lens centered at canvas center.
      vec2 c = uv - 0.5;
      return 1.0 - smoothstep(0.0, 0.5, length(c));
    } else if (uPattern == 1) {
      return 0.5 + 0.5 * sin(uv.x * 40.0) * cos(uv.y * 12.0);
    } else {
      return fbm(uv * 5.0);
    }
  }

  vec2 gradient(vec2 uv) {
    float e = 1.0 / max(uResolution.x, uResolution.y);
    float hx = heightField(uv + vec2(e, 0.0)) - heightField(uv - vec2(e, 0.0));
    float hy = heightField(uv + vec2(0.0, e)) - heightField(uv - vec2(0.0, e));
    return vec2(hx, hy) / (2.0 * e);
  }

  vec3 sampleRough(vec2 uv, float r) {
    if (r <= 0.001) return texture2D(uMap, uv).rgb;
    vec3 acc = vec3(0.0);
    const int N = 6;
    for (int i = 0; i < N; i++) {
      float a = float(i) / float(N) * 6.2831853;
      vec2 ofs = vec2(cos(a), sin(a)) * r / uResolution;
      acc += texture2D(uMap, uv + ofs).rgb;
    }
    return acc / float(N);
  }

  void main() {
    sliderClip(vUv);
    vec2 uv = vUv;
    vec2 g = gradient(uv) * uBump * (1.0 + uDepth);
    float ior = mix(1.0, 1.6, clamp(uIor * 0.5, 0.0, 1.0));
    vec2 refr = g * (ior - 1.0) * 0.15;

    vec3 col;
    col.r = sampleRough(uv - refr * (1.0 + uDispersion * 0.6), uRoughness * 20.0).r;
    col.g = sampleRough(uv - refr, uRoughness * 20.0).g;
    col.b = sampleRough(uv - refr * (1.0 - uDispersion * 0.6), uRoughness * 20.0).b;

    // Specular highlight from a fixed light direction.
    vec3 L = normalize(vec3(0.5, 0.7, 1.0));
    vec3 N = normalize(vec3(-g, 1.0));
    float spec = pow(max(dot(N, L), 0.0), mix(64.0, 8.0, uRoughness));
    col += spec * 0.25 * uDepth;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const GLASS_VERT = VERTEX_FLAT;
