import type { EffectKind, EffectPropsByKind } from "./types";

/**
 * Default uniforms per effect. Match the "neutral" or "off" state where
 * possible so a layer can be toggled on without an instant visual jump,
 * and then driven by the AI channel.
 */
export const DEFAULTS: { [K in EffectKind]: EffectPropsByKind[K] } = {
  sampling: {
    pixel: 1,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    animation: "seamless",
    step: 16,
  },
  unfocused: {
    blur: 0,
    angle: 0,
    falloff: 0.5,
    type: "quadratic",
    originX: 0.5,
    originY: 0.5,
    distortion: 0,
    dispersion: 0,
    noise: 0,
    blend: "none",
  },
  burn: {
    burn: 0,
    density: 0.5,
    distortion: 0.2,
    hardness: 0.4,
    dispersion: 0.2,
    edgeColor: [1.0, 0.36, 0.18],
    maskColor: [0.0, 0.0, 0.0],
    transparent: true,
    invert: false,
  },
  glass: {
    ior: 1.0,
    roughness: 0.0,
    bump: 0.0,
    dispersion: 0.0,
    pattern: "lens",
    depth: 0.0,
  },
  magnifier: {
    originX: 0.5,
    originY: 0.5,
    radius: 0.0,
    strength: 0.5,
    space: 0.3,
    disturbance: 0.0,
    feather: 0.2,
    threshold: 0.5,
    compensation: 0.5,
    dispersion: 0.0,
    scale: 0.0,
  },
  crack: {
    segment: 1,
    strength: 0.0,
    dispersion: 0.0,
    type: "modern",
    fadeIn: false,
  },
};
