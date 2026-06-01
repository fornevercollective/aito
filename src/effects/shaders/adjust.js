import { COLOR_OPS, SLIDER_CLIP, VERTEX_FLAT } from "./common.glsl";
/**
 * Adjust: core photo corrections pass (Resolve-inspired).
 *
 * Applied to the "after" base before artistic effect layers.
 * All values are artist-friendly and centered at 0 = no change.
 */
export const ADJUST_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uExposure;    // -2..2  (stops)
  uniform float uContrast;    // -1..1
  uniform float uSaturation;  // -1..1
  uniform float uTemperature; // -1..1  (blue <-> yellow)
  uniform float uTint;        // -1..1  (green <-> magenta)
  uniform float uClarity;     // -1..1  (local contrast)
  uniform float uLutIntensity; // 0..1  LUT strength (AI + film emulation ready)
  uniform sampler2D uMask;    // optional active SAM/brush mask (alpha = selection)
  uniform float uUseMask;     // 0 = ignore mask (full image), 1 = use mask
  uniform float uInvertMask;  // 0 = normal, 1 = invert (apply to background)
  varying vec2 vUv;

  ${COLOR_OPS}
  ${SLIDER_CLIP}

  // Simple white balance shift in approx LMS-like space
  vec3 whiteBalance(vec3 c, float temp, float tint) {
    // temp: cool (negative) pushes blue, warm pushes yellow/orange
    float t = temp * 0.08;
    c.r *= 1.0 + t;
    c.b *= 1.0 - t * 0.7;

    // tint: green (negative) vs magenta
    float m = tint * 0.06;
    c.g *= 1.0 + m;
    c.r *= 1.0 - m * 0.5;
    c.b *= 1.0 - m * 0.5;
    return c;
  }

  // Cheap clarity via blurred luminance subtraction (unsharp style)
  float clarityMask(vec2 uv, float amount) {
    // 5-tap cross blur for speed
    vec2 px = 1.0 / uResolution;
    float c = dot(texture2D(uMap, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
    float b = (
      dot(texture2D(uMap, uv + vec2(px.x, 0)).rgb, vec3(0.2126, 0.7152, 0.0722)) +
      dot(texture2D(uMap, uv - vec2(px.x, 0)).rgb, vec3(0.2126, 0.7152, 0.0722)) +
      dot(texture2D(uMap, uv + vec2(0, px.y)).rgb, vec3(0.2126, 0.7152, 0.0722)) +
      dot(texture2D(uMap, uv - vec2(0, px.y)).rgb, vec3(0.2126, 0.7152, 0.0722))
    ) * 0.25;
    return (c - b) * amount * 1.8;
  }

  void main() {
    // For the adjustment base pass we usually want the full after (no slider clip),
    // but we still respect the uniform so it can be reused in layered contexts.
    sliderClip(vUv);

    vec3 c = texture2D(uMap, vUv).rgb;

    // === Masked corrections support ===
    float maskFactor = 1.0;
    if (uUseMask > 0.5) {
      float m = texture2D(uMask, vUv).a;           // 0..1 from mask alpha
      maskFactor = (uInvertMask > 0.5) ? (1.0 - m) : m;
    }

    // Scale all correction amounts by the mask (0 = no change in that region)
    float effExposure   = uExposure   * maskFactor;
    float effContrast   = uContrast   * maskFactor;
    float effSaturation = uSaturation * maskFactor;
    float effTemp       = uTemperature * maskFactor;
    float effTint       = uTint       * maskFactor;
    float effClarity    = uClarity    * maskFactor;

    // Exposure in stops
    c *= pow(2.0, effExposure);

    // White balance before contrast/sat
    c = whiteBalance(c, effTemp, effTint);

    // Main BCS
    c = applyBCS(c, 0.0, effContrast, effSaturation);

    // Clarity (local contrast)
    if (abs(effClarity) > 0.001) {
      c += clarityMask(vUv, effClarity);
    }

    // LUT placeholder (AI/Grok can drive intensity + future LUT selection)
    if (uLutIntensity > 0.001) {
      // TODO: Sample actual 3D/2D LUT texture here
      // For now: simple stylized shift to simulate film LUT
      float lutMix = uLutIntensity;
      c = mix(c, vec3(c.r * 0.9 + 0.1, c.g * 1.05, c.b * 0.85), lutMix * 0.6);
    }

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;
export const ADJUST_VERT = VERTEX_FLAT;
