/**
 * Spatial depth bridge — shared vocabulary with aito-mac booth + Splatline.
 * Used for glass/gsplat bake previews and multi-source nesting metadata.
 */

export type DepthModeId =
  | "radial"
  | "luma"
  | "jax"
  | "fog"
  | "focus"
  | "filter"
  | "nested";

export const DEPTH_MODE_LABELS: Record<DepthModeId, string> = {
  radial: "Radial",
  luma: "Luma",
  jax: "JAX",
  fog: "Fog grade",
  focus: "Selective focus",
  filter: "Distance filter",
  nested: "Nested parallax",
};

/** Nested voxel-sphere shell radius for a source slot (0..N). */
export function shellRadius(slot: number, base = 1.15, nest = 0.22): number {
  return base * (0.35 + nest * slot * 0.55);
}

/**
 * Nested parallax gain — outer shells shift more (spatial need).
 * Match aito-mac booth-voxel `sphereParallax`.
 */
export function nestedParallaxGain(radius: number, parallax = 0.65): number {
  return 0.12 + radius * parallax;
}

/**
 * Map hand control signals → glass depth / waveform uniforms (0..1 domain).
 * Aligns with aito-mac HandController (MediaPipe 0.10.35 + gesture labels).
 * Resources: ~/dev/aito-mac/booth/hand-tracking-resources.mjs
 */
export function handToGlassUniforms(signals: {
  depthMod?: number;
  waveMod?: number;
  sizeMod?: number;
  gestureL?: string;
  gestureR?: string;
  twoHandSpan?: number;
}): { depth: number; roughness: number; bump: number; dispersion: number } {
  const d = signals.depthMod ?? 0;
  const w = signals.waveMod ?? 0;
  const span = signals.twoHandSpan ?? 0;
  // Fist / open (measure_plan-style) nudge roughness; peace adds dispersion shimmer
  const g = signals.gestureR || signals.gestureL || "";
  const fist = g === "fist" ? 0.12 : 0;
  const open = g === "open" ? 0.08 : 0;
  const peace = g === "peace" ? 0.1 : 0;
  return {
    depth: clamp01(0.35 + d * 0.45 + w * 0.1 + span * 0.08),
    roughness: clamp01(0.2 + (1 - (signals.sizeMod ?? 0)) * 0.25 + fist - open * 0.5),
    bump: clamp01(0.4 + w * 0.4 + open * 0.1),
    dispersion: clamp01(0.15 + w * 0.35 + peace),
  };
}

/** Near-warm / far-cool tint factor for depth grading (Splatline-style). */
export function depthGradeTint(depth01: number, nearWarm = 0.35, farCool = 0.45) {
  const t = clamp01(depth01);
  return {
    r: 1 + nearWarm * (1 - t) * 0.35,
    g: 1 + nearWarm * (1 - t) * 0.08,
    b: 1 + farCool * t * 0.45,
    fog: t,
  };
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Optional bridge to a live aito-mac booth window on localhost.
 * Reads window.aitoBoothHand / aitoBoothDepth when same-origin or exposed.
 */
export function readBoothBridge(): {
  hand?: { depthMod: number; waveMod: number };
  depthMode?: string;
} | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    aitoBoothHand?: { depthMod: number; waveMod: number };
    aitoBoothDepth?: { resolve: () => { label: string } };
  };
  if (!w.aitoBoothHand && !w.aitoBoothDepth) return null;
  return {
    hand: w.aitoBoothHand
      ? { depthMod: w.aitoBoothHand.depthMod, waveMod: w.aitoBoothHand.waveMod }
      : undefined,
    depthMode: w.aitoBoothDepth?.resolve?.()?.label,
  };
}
