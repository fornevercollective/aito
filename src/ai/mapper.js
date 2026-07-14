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
import { handToGlassUniforms, readBoothBridge } from "@/lib/spatial-depth";
const lerp = (a, b, t) => a + (b - a) * t;
export const aiMappers = {
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
        if (!ai.busy)
            return { burn: 0 };
        return { burn: lerp(0, 0.65, ai.progress), hardness: base.hardness };
    },
    /**
     * Glass = depth/3D preview hook. Confidence biases depth so a
     * well-trusted gsplat bake renders crisply; uncertain bakes go
     * rougher. When aito-mac booth hand bridge is present, nest hand
     * depth/wave into glass (Splatline / booth spatial path).
     */
    glass: (ai) => {
        let depth = 0.3 + 0.4 * ai.confidence;
        let roughness = 0.05 + 0.25 * (1 - ai.confidence);
        let bump;
        let dispersion;
        const bridge = readBoothBridge();
        if (bridge?.hand) {
            const h = handToGlassUniforms(bridge.hand);
            depth = lerp(depth, h.depth, 0.55);
            roughness = lerp(roughness, h.roughness, 0.4);
            bump = h.bump;
            dispersion = h.dispersion;
        }
        return {
            depth,
            roughness,
            ...(bump != null ? { bump } : {}),
            ...(dispersion != null ? { dispersion } : {}),
        };
    },
    /**
     * Magnifier = "look here" call-out. The radius grows briefly at the
     * end of the job to draw the eye to the focus point.
     */
    magnifier: (ai) => {
        const callout = ai.progress > 0.85 && !ai.busy
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
export function mergeAi(kind, base, ai) {
    const patch = aiMappers[kind](ai, base);
    return { ...base, ...patch };
}
