// LUT Presets System for aito (JS companion for legacy modules)
// Supports the full catalog from sibling /Users/qbit/dev/imagine/style_presets
// See lutPresets.ts for the canonical implementation + sync notes.

import imaginePresets from '@/data/imagine-presets.json';

export const LEGACY_ALIASES = {
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

function resolvePresetId(presetId) {
  return LEGACY_ALIASES[presetId] || presetId;
}

const RAW = (imaginePresets && imaginePresets.presets) || [];
export const LUT_PRESETS = RAW.map((p) => ({
  id: p.slug,
  name: p.display,
  category: p.category || 'other',
  description: (p.tags || []).slice(0,3).join(', ') || p.category,
  adjustments: {},
  lutIntensity: 0.82,
}));

export function applyLutPreset(presetId, setAdj) {
  const resolved = resolvePresetId(presetId);
  const preset = LUT_PRESETS.find(p => p.id === resolved) || LUT_PRESETS.find(p => p.id === presetId);
  if (!preset) {
    try { (setAdj)('lutPreset', resolved); } catch {}
    setAdj('lutIntensity', 0.8);
    return;
  }
  const tags = (RAW.find(r => r.slug === preset.id) || {}).tags || [];
  const tstr = tags.join(' ').toLowerCase();
  if (tstr.includes('warm') || preset.id.includes('portra')) setAdj('temperature', 0.12);
  if (tstr.includes('teal') || preset.id.includes('teal-orange')) { setAdj('temperature', 0.35); setAdj('tint', -0.28); }
  if (tstr.includes('bleach') || preset.id.includes('bleach')) setAdj('contrast', 0.35);
  setAdj('lutIntensity', preset.lutIntensity);
  try { (setAdj)('lutPreset', resolved); } catch {}
}

export function synthesizeLutFromDescription(description) {
  const lower = description.toLowerCase();
  const adj = {};
  if (lower.includes('warm') || lower.includes('golden')) adj.temperature = 0.5;
  if (lower.includes('cool') || lower.includes('teal')) adj.temperature = -0.3;
  if (lower.includes('contrast') || lower.includes('punchy')) adj.contrast = 0.3;
  if (lower.includes('soft') || lower.includes('skin')) adj.contrast = -0.15;
  return { adjustments: adj, lutIntensity: 0.75, suggestedName: description.slice(0, 40) };
}

export function getAllPresetSlugs() { return LUT_PRESETS.map(p => p.id); }
export function getPresetById(id) { const r=resolvePresetId(id); return LUT_PRESETS.find(p=>p.id===r); }
