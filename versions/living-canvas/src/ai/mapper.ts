/**
 * Map AI signals → per-effect uniform overrides.
 *
 * This is the heart of "AI-controllable" effects: a small declarative
 * function per effect kind that consumes `AiSignals` and returns a
 * partial uniform patch. The active layer's manual props are then
 * merged with the AI-derived patch (`mergeAi` in EffectLayer).
 *
 * Tweaking the visual language of the app is mostly editing this file.
 */

import type {
  AnyEffectProps,
  EffectKind,
  EffectPropsByKind,
} from "@/effects/types";
import type { AiSignals } from "@/state/store";

export type AiMappers = {
  [K in EffectKind]: (
    ai: AiSignals,
    base: EffectPropsByKind[K],
  ) => Partial<EffectPropsByKind[K]>;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const aiMappers: AiMappers = {
  /**
   * Sampling = inference progress. Pixel size shrinks from "chunky"
   * to 1 as progress completes; saturation pops once confident.
   */
  sampling: (ai, base) => ({
    pixel: lerp(64, 1, ai.progress),
    saturation: lerp(-0.4, base.saturation, ai.confidence),
  }),

  /**
   * Unfocused = uncertainty + attention. The blur pools at the focus
   * point and dissolves as confidence rises.
   */
  unfocused: (ai) => ({
    blur: lerp(0, 120, 1 - ai.confidence),
    originX: ai.focus.x,
    originY: ai.focus.y,
    dispersion: 0.4 * (1 - ai.confidence),
  }),

  /**
   * Burn = job lifecycle. While busy, burn pulses toward 1 then resets.
   * Idle state shows nothing.
   */
  burn: (ai, base) => {
    if (!ai.busy) return { burn: 0 };
    return { burn: lerp(0, 0.65, ai.progress), hardness: base.hardness };
  },

  /**
   * Glass = depth/3D preview hook. Confidence biases depth so a
   * well-trusted gsplat bake renders crisply; uncertain bakes go
   * rougher.
   */
  glass: (ai) => ({
    depth: 0.3 + 0.4 * ai.confidence,
    roughness: 0.05 + 0.25 * (1 - ai.confidence),
  }),

  /**
   * Magnifier = "look here" call-out. The radius grows briefly at the
   * end of the job to draw the eye to the focus point.
   */
  magnifier: (ai) => {
    const callout =
      ai.progress > 0.85 && !ai.busy
        ? Math.max(0, 1 - (ai.progress - 0.85) / 0.15)
        : ai.busy
        ? 0
        : 0;
    return {
      originX: ai.focus.x,
      originY: ai.focus.y,
      radius: 0.18 * callout,
      strength: 0.55,
      scale: 0.4 * callout,
    };
  },

  /**
   * Crack = tile readiness. Segments grow with tile count; strength
   * shrinks to 0 as tiles arrive.
   */
  crack: (ai) => ({
    segment: 4 + Math.floor(ai.tilesReady * 12),
    strength: 0.7 * (1 - ai.tilesReady),
    fadeIn: true,
  }),
};

export function mergeAi<K extends EffectKind>(
  kind: K,
  base: EffectPropsByKind[K],
  ai: AiSignals,
): EffectPropsByKind[K] {
  const patch = (aiMappers[kind] as (
    ai: AiSignals,
    base: AnyEffectProps,
  ) => Partial<AnyEffectProps>)(ai, base);
  return { ...base, ...(patch as Partial<EffectPropsByKind[K]>) };
}
