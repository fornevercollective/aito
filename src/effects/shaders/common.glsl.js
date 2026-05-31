/**
 * Snippets shared by multiple effect shaders.
 *
 * Kept as plain strings (rather than #include) so r3f's onBeforeCompile
 * is not required and we stay portable across renderers.
 */
export const VERTEX_FLAT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const NOISE_2D = /* glsl */ `
  // Cheap value noise; good enough for masks/perturbation, not for art.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }
`;
export const COLOR_OPS = /* glsl */ `
  vec3 applyBCS(vec3 c, float brightness, float contrast, float saturation) {
    c += brightness;
    c = (c - 0.5) * (1.0 + contrast) + 0.5;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(l), c, 1.0 + saturation);
  }
`;
/**
 * Slider clip: discard fragments on the wrong side of the slider.
 *   uClipSign:
 *      0  = no clipping (effect applies to both sides)
 *     -1  = keep only left of uClipX
 *     +1  = keep only right of uClipX
 *   uClipX: 0..1 in UV space (matches App's `slider`).
 */
export const SLIDER_CLIP = /* glsl */ `
  uniform float uClipSign;
  uniform float uClipX;
  void sliderClip(vec2 uv) {
    if (uClipSign * (uv.x - uClipX) > 0.0) discard;
  }
`;
