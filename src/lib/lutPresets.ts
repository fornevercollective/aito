// LUT Presets System for aito
// Supports VSCO, Film Stocks, Cinema Looks, Lens Effects
// Grok can suggest or "create" new ones by describing the look.

export interface LutPreset {
  id: string;
  name: string;
  category: 'vsco' | 'film' | 'cinema' | 'lens';
  description: string;
  // Simulated via adjustments + lutIntensity for now
  // Future: actual 3D LUT texture or Hald CLUT
  adjustments: Partial<Record<string, number>>;
  lutIntensity: number;
}

export const LUT_PRESETS: LutPreset[] = [
  {
    id: 'vsco-kodak-portra',
    name: 'VSCO Kodak Portra',
    category: 'vsco',
    description: 'Soft skin tones, natural contrast, slight warmth',
    adjustments: { temperature: 0.15, contrast: -0.1, saturation: 0.1 },
    lutIntensity: 0.9,
  },
  {
    id: 'vsco-fuji-superia',
    name: 'VSCO Fuji Superia',
    category: 'vsco',
    description: 'Punchy greens, cool shadows, film grain feel',
    adjustments: { temperature: -0.2, saturation: 0.25, contrast: 0.15 },
    lutIntensity: 0.85,
  },
  {
    id: 'film-kodak-2383',
    name: 'Kodak 2383 (Cinema)',
    category: 'cinema',
    description: 'Classic film print look, rich blacks, warm highlights',
    adjustments: { contrast: 0.3, temperature: 0.25, saturation: -0.05 },
    lutIntensity: 0.95,
  },
  {
    id: 'cinema-teal-orange',
    name: 'Teal & Orange Blockbuster',
    category: 'cinema',
    description: 'Modern cinematic — cool shadows, warm skin',
    adjustments: { temperature: 0.4, tint: -0.35, contrast: 0.35, saturation: 0.2 },
    lutIntensity: 0.8,
  },
  {
    id: 'lens-anamorphic',
    name: 'Anamorphic Flare',
    category: 'lens',
    description: 'Horizontal blue flares, oval bokeh, vintage lens character',
    adjustments: { temperature: -0.1, vignette: -0.2 },
    lutIntensity: 0.7,
  },
];

export function applyLutPreset(presetId: string, setAdj: (key: string, val: number) => void) {
  const preset = LUT_PRESETS.find(p => p.id === presetId);
  if (!preset) return;

  Object.entries(preset.adjustments).forEach(([key, val]) => {
    if (val !== undefined) setAdj(key, val);
  });
  setAdj('lutIntensity', preset.lutIntensity);
}

// Future: Grok can return a custom preset description and we can synthesize adjustments
export function synthesizeLutFromDescription(description: string) {
  // Simple heuristic — in production this would be Grok-generated
  const lower = description.toLowerCase();
  const adj: any = {};

  if (lower.includes('warm') || lower.includes('golden')) adj.temperature = 0.5;
  if (lower.includes('cool') || lower.includes('teal')) adj.temperature = -0.3;
  if (lower.includes('contrast') || lower.includes('punchy')) adj.contrast = 0.3;
  if (lower.includes('soft') || lower.includes('skin')) adj.contrast = -0.15;

  return {
    adjustments: adj,
    lutIntensity: 0.75,
    suggestedName: description.slice(0, 40),
  };
}
