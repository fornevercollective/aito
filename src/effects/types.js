/**
 * Effect kinds and per-effect uniform shapes.
 *
 * Each effect is a fragment shader that samples a single source texture
 * (the current "before" or "after" frame at the slider position) and
 * outputs an RGBA color. Uniforms map 1:1 to the property controls of
 * Jay Ji's Reveals components, but every uniform is wired to a typed
 * field here so the AI channel can drive them directly.
 */
export {};
