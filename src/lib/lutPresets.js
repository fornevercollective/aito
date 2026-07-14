// LUT Presets System for aito
// Supports VSCO, Film Stocks, Cinema Looks, Lens Effects + full imagine catalog.
// ---------------------------------------------------------------------------
// Full catalog is synced from the sibling workspace:
//   /Users/qbit/dev/imagine/style_presets/
// (styles.json is the manifest; prompt.txt per folder carries the exact
// film-production language passed to Grok Imagine for consistent looks.)
// Run `npm run sync:imagine-presets` when the upstream catalog changes.
// The JSON lives at src/data/imagine-presets.json so it is bundled for PWA/offline.
import imaginePresets from '@/data/imagine-presets.json';
// Map imagine category + tags -> simulated adjustment seeds (tasteful starting points)
function defaultAdjustmentsFor(p) {
    const c = p.category;
    const tags = (p.tags || []).join(' ').toLowerCase();
    const a = {};
    if (c === 'film_emulation') {
        a.lutIntensity = 0.88;
        if (tags.includes('warm') || tags.includes('portra') || tags.includes('gold'))
            a.temperature = 0.12;
        if (tags.includes('cool') || tags.includes('superia'))
            a.temperature = -0.15;
        if (tags.includes('bw') || tags.includes('tri-x') || tags.includes('acros') || tags.includes('hp5')) {
            a.saturation = -0.6;
            a.contrast = 0.1;
        }
        if (tags.includes('saturated') || tags.includes('velvia') || tags.includes('ektar'))
            a.saturation = 0.25;
        if (tags.includes('grain') || tags.includes('ultramax'))
            a.vignette = -0.08;
        if (tags.includes('cinematic') || tags.includes('eterna') || tags.includes('vision3'))
            a.contrast = 0.15;
    }
    else if (c === 'cinematic_genre') {
        a.lutIntensity = 0.82;
        if (tags.includes('teal') || tags.includes('blockbuster') || p.slug.includes('teal-orange')) {
            a.temperature = 0.35;
            a.tint = -0.3;
            a.contrast = 0.3;
        }
        if (tags.includes('bleach') || tags.includes('bypass')) {
            a.contrast = 0.4;
            a.saturation = -0.25;
        }
        if (tags.includes('anamorphic') || tags.includes('lens') || tags.includes('flare'))
            a.vignette = -0.15;
        if (tags.includes('vhs') || tags.includes('grain') || tags.includes('horror'))
            a.contrast = 0.1;
        if (tags.includes('noir') || tags.includes('dramatic')) {
            a.contrast = 0.35;
            a.saturation = -0.2;
        }
    }
    else if (c === 'pinterest_aesthetic') {
        a.lutIntensity = 0.78;
        if (tags.includes('soft') || tags.includes('light') || tags.includes('clean'))
            a.contrast = -0.1;
        if (tags.includes('moody') || tags.includes('dark') || tags.includes('grunge'))
            a.contrast = 0.15;
        if (tags.includes('pink') || tags.includes('barbie') || tags.includes('y2k'))
            a.saturation = 0.2;
    }
    else {
        a.lutIntensity = 0.75;
    }
    return a;
}
const RAW = imaginePresets.presets || [];
export const LUT_PRESETS = RAW.map((p) => {
    const adj = defaultAdjustmentsFor(p);
    const intensity = adj.lutIntensity ?? 0.82;
    delete adj.lutIntensity;
    return {
        id: p.slug,
        name: p.display,
        category: p.category || 'other',
        description: p.tags?.slice(0, 3).join(', ') || p.category,
        adjustments: adj,
        lutIntensity: intensity,
    };
});
// Legacy id aliases (old UI ids -> new canonical imagine slugs) for smooth transition
const LEGACY_ALIASES = {
    'vsco-kodak-portra': 'kodak-portra-400',
    'vsco-fuji-superia': 'fuji-superia-400',
    'film-kodak-2383': 'kodak-vision3-500t',
    'film-fuji-3510': 'fuji-eterna-500',
    'cinema-teal-orange': 'teal-orange-blockbuster',
    'cinema-bleach-bypass': 'bleach-bypass-lut',
    'cinema-vintage': 'vintage-35mm',
    'lens-anamorphic': 'anamorphic-cinematic',
    'lens-vintage-glass': 'vintage-35mm',
};
export function resolvePresetId(presetId) {
    return LEGACY_ALIASES[presetId] || presetId;
}
export function applyLutPreset(presetId, setAdj) {
    const resolved = resolvePresetId(presetId);
    const preset = LUT_PRESETS.find(p => p.id === resolved);
    if (!preset)
        return;
    Object.entries(preset.adjustments).forEach(([key, val]) => {
        if (val !== undefined)
            setAdj(key, val);
    });
    setAdj('lutIntensity', preset.lutIntensity);
    // Also record the canonical preset name so AI / state use imagine slugs
    setAdj('lutPreset', resolved);
}
// Future: Grok can return a custom preset description and we can synthesize adjustments
export function synthesizeLutFromDescription(description) {
    // Simple heuristic — in production this would be Grok-generated or matched against imagine catalog
    const lower = description.toLowerCase();
    const adj = {};
    if (lower.includes('warm') || lower.includes('golden'))
        adj.temperature = 0.5;
    if (lower.includes('cool') || lower.includes('teal'))
        adj.temperature = -0.3;
    if (lower.includes('contrast') || lower.includes('punchy'))
        adj.contrast = 0.3;
    if (lower.includes('soft') || lower.includes('skin'))
        adj.contrast = -0.15;
    return {
        adjustments: adj,
        lutIntensity: 0.75,
        suggestedName: description.slice(0, 40),
    };
}
// For UI / Grok tool schema: the live list of canonical slugs (from imagine)
export function getAllPresetSlugs() {
    return LUT_PRESETS.map(p => p.id);
}
export function getPresetById(id) {
    const resolved = resolvePresetId(id);
    return LUT_PRESETS.find(p => p.id === resolved);
}
