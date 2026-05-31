/**
 * Effect kinds and per-effect uniform shapes.
 *
 * Each effect is a fragment shader that samples a single source texture
 * (the current "before" or "after" frame at the slider position) and
 * outputs an RGBA color. Uniforms map 1:1 to the property controls of
 * Jay Ji's Reveals components, but every uniform is wired to a typed
 * field here so the AI channel can drive them directly.
 */

export type EffectKind =
  | "sampling"
  | "unfocused"
  | "burn"
  | "glass"
  | "magnifier"
  | "crack";

export type EffectSide = "before" | "after" | "both";

export interface SamplingProps {
  /** Pixel size 1..100. 1 = full res, 100 = chunky mosaic. */
  pixel: number;
  brightness: number; // -1..1
  contrast: number;   // -1..2
  saturation: number; // -1..2
  /** "Stepped" quantizes pixel into N steps for that mechanized reveal. */
  animation: "seamless" | "stepped";
  step: number; // 1..100, used when animation === "stepped"
}

export interface UnfocusedProps {
  blur: number;       // 0..1000 (px)
  angle: number;      // 0..360 (deg)
  falloff: number;    // 0..1
  type: "linear" | "quadratic" | "cubic" | "square";
  originX: number;    // 0..1
  originY: number;    // 0..1
  distortion: number; // -1..1
  dispersion: number; // 0..1
  noise: number;      // 0..1
  blend: "none" | "darker" | "lighter" | "both";
}

export interface BurnProps {
  /** Reveal progress 0..1. 1 = fully burnt (invisible) unless invert. */
  burn: number;
  density: number;    // 0..1
  distortion: number; // 0..1
  hardness: number;   // 0..1
  dispersion: number; // 0..1
  edgeColor: [number, number, number];
  maskColor: [number, number, number];
  transparent: boolean;
  invert: boolean;
}

export interface GlassProps {
  /** Refractive index analog 0..2 (1 = passthrough). */
  ior: number;
  /** Surface roughness; higher = blurrier glass. 0..1 */
  roughness: number;
  /** Strength of normal-map perturbation. 0..1 */
  bump: number;
  /** Chromatic aberration at edges. 0..1 */
  dispersion: number;
  /** Pattern: simulates the gsplat → image bake; 0..1 selects between. */
  pattern: "lens" | "ripple" | "splat";
  /** Camera-like depth bias 0..1 — drives volumetric look. */
  depth: number;
}

export interface MagnifierProps {
  /** Position of the lens in normalized image coords. */
  originX: number; // 0..1
  originY: number; // 0..1
  /** Radius as fraction of the longer image side. 0..1 */
  radius: number;
  /** Distortion strength. 0..1 */
  strength: number;
  /** Center flatness. 0..1 */
  space: number;
  /** Surface texture intensity. 0..1 */
  disturbance: number;
  feather: number;     // 0..1
  threshold: number;   // 0..1
  compensation: number; // 0..1
  dispersion: number;   // 0..1
  scale: number;        // 0..1, content zoom inside lens
}

export interface CrackProps {
  /** Grid resolution; image is cut segment×segment. 1..100 */
  segment: number;
  /** Displacement amplitude 0..1. */
  strength: number;
  /** Chroma offset at cell edges. 0..1 */
  dispersion: number;
  /** "classic" = displace whole cell; "modern" = displace within cell. */
  type: "classic" | "modern";
  fadeIn: boolean;
}

export type EffectPropsByKind = {
  sampling: SamplingProps;
  unfocused: UnfocusedProps;
  burn: BurnProps;
  glass: GlassProps;
  magnifier: MagnifierProps;
  crack: CrackProps;
};

export type AnyEffectProps = EffectPropsByKind[EffectKind];

export interface ActiveLayer<K extends EffectKind = EffectKind> {
  id: string;
  kind: K;
  side: EffectSide;
  enabled: boolean;
  props: EffectPropsByKind[K];
}
