import { useApp } from "@/state/store";
import type {
  ActiveLayer,
  EffectKind,
  EffectPropsByKind,
  EffectSide,
} from "@/effects/types";
import { applyLutPreset } from "@/lib/lutPresets";

interface AdjField {
  key: keyof ReturnType<typeof useApp.getState>["adjustments"];
  label: string;
  min: number;
  max: number;
  step: number;
}

const ADJ_FIELDS: AdjField[] = [
  { key: "exposure", label: "exposure", min: -2, max: 2, step: 0.01 },
  { key: "contrast", label: "contrast", min: -1, max: 1, step: 0.01 },
  { key: "saturation", label: "saturation", min: -1, max: 1, step: 0.01 },
  { key: "temperature", label: "temperature", min: -1, max: 1, step: 0.01 },
  { key: "tint", label: "tint", min: -1, max: 1, step: 0.01 },
  { key: "clarity", label: "clarity", min: -1, max: 1, step: 0.01 },
];

const KINDS: EffectKind[] = [
  "sampling",
  "unfocused",
  "burn",
  "glass",
  "magnifier",
  "crack",
];

const SIDES: EffectSide[] = ["before", "after", "both"];

interface Field {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
}

const FIELDS: { [K in EffectKind]: Field[] } = {
  sampling: [
    { key: "pixel", label: "pixel", min: 1, max: 100 },
    { key: "brightness", label: "brightness", min: -1, max: 1, step: 0.01 },
    { key: "contrast", label: "contrast", min: -1, max: 2, step: 0.01 },
    { key: "saturation", label: "saturation", min: -1, max: 2, step: 0.01 },
    { key: "step", label: "step", min: 1, max: 100 },
  ],
  unfocused: [
    { key: "blur", label: "blur", min: 0, max: 500 },
    { key: "angle", label: "angle", min: 0, max: 360 },
    { key: "falloff", label: "falloff", min: 0, max: 1, step: 0.01 },
    { key: "originX", label: "originX", min: 0, max: 1, step: 0.01 },
    { key: "originY", label: "originY", min: 0, max: 1, step: 0.01 },
    { key: "distortion", label: "distortion", min: -1, max: 1, step: 0.01 },
    { key: "dispersion", label: "dispersion", min: 0, max: 1, step: 0.01 },
    { key: "noise", label: "noise", min: 0, max: 1, step: 0.01 },
  ],
  burn: [
    { key: "burn", label: "burn", min: 0, max: 1, step: 0.01 },
    { key: "density", label: "density", min: 0, max: 1, step: 0.01 },
    { key: "distortion", label: "distortion", min: 0, max: 1, step: 0.01 },
    { key: "hardness", label: "hardness", min: 0, max: 1, step: 0.01 },
    { key: "dispersion", label: "dispersion", min: 0, max: 1, step: 0.01 },
  ],
  glass: [
    { key: "ior", label: "ior", min: 0, max: 2, step: 0.01 },
    { key: "roughness", label: "roughness", min: 0, max: 1, step: 0.01 },
    { key: "bump", label: "bump", min: 0, max: 1, step: 0.01 },
    { key: "dispersion", label: "dispersion", min: 0, max: 1, step: 0.01 },
    { key: "depth", label: "depth", min: 0, max: 1, step: 0.01 },
  ],
  magnifier: [
    { key: "originX", label: "originX", min: 0, max: 1, step: 0.01 },
    { key: "originY", label: "originY", min: 0, max: 1, step: 0.01 },
    { key: "radius", label: "radius", min: 0, max: 1, step: 0.01 },
    { key: "strength", label: "strength", min: 0, max: 1, step: 0.01 },
    { key: "space", label: "space", min: 0, max: 1, step: 0.01 },
    { key: "disturbance", label: "disturbance", min: 0, max: 1, step: 0.01 },
    { key: "feather", label: "feather", min: 0, max: 1, step: 0.01 },
    { key: "scale", label: "scale", min: 0, max: 1, step: 0.01 },
    { key: "dispersion", label: "dispersion", min: 0, max: 1, step: 0.01 },
  ],
  crack: [
    { key: "segment", label: "segment", min: 1, max: 60 },
    { key: "strength", label: "strength", min: 0, max: 1, step: 0.01 },
    { key: "dispersion", label: "dispersion", min: 0, max: 1, step: 0.01 },
  ],
};

export function ControlPanel() {
  const layers = useApp((s) => s.layers);
  const addLayer = useApp((s) => s.addLayer);
  const removeLayer = useApp((s) => s.removeLayer);
  const toggleLayer = useApp((s) => s.toggleLayer);
  const updateLayer = useApp((s) => s.updateLayer);
  const setLayerSide = useApp((s) => s.setLayerSide);

  const adj = useApp((s) => s.adjustments);
  const setAdj = useApp((s) => s.setAdjustment);
  const resetAdj = useApp((s) => s.resetAdjustments);

  const scope = useApp((s) => s.adjustmentScope);
  const setScope = useApp((s) => s.setAdjustmentScope);

  return (
    <>
      <h3>Adjust (after)</h3>
      <div style={{ marginBottom: 8 }}>
        {ADJ_FIELDS.map((f) => {
          const val = adj[f.key];
          const numVal = typeof val === 'number' ? val : 0;
          return (
            <div className="row" key={f.key}>
              <label>{f.label}</label>
              <input
                type="number"
                value={Number.isFinite(numVal) ? numVal.toFixed(2) : "0"}
                step={f.step}
                onChange={(e) => setAdj(f.key, Number(e.target.value))}
              />
              <input
                style={{ gridColumn: "1 / 3" }}
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={numVal}
                onChange={(e) => setAdj(f.key, Number(e.target.value))}
              />
            </div>
          );
        })}
        <button
          type="button"
          onClick={resetAdj}
          style={{ marginTop: 6, width: "100%", fontSize: 11 }}
        >
          Reset adjustments
        </button>

        {/* Masked corrections — core feature using SAM */}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
          <label className="check" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={scope.useActiveMask}
              onChange={(e) => setScope({ useActiveMask: e.target.checked })}
            />
            <span>Scope to active mask</span>
          </label>
          <label className="check" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={scope.invert}
              onChange={(e) => setScope({ invert: e.target.checked })}
              disabled={!scope.useActiveMask}
            />
            <span>Invert (edit background)</span>
          </label>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
            Use Segment tab to tap/auto subjects. Corrections only affect the selected region.
          </div>
        </div>

        {/* LUT Creation / Detection / Styling - VSCO, Film, Cinema, Lens, Grok-powered */}
        <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
            <span>LUT Styling</span>
            <span style={{ fontSize: 9, opacity: 0.6 }}>AI + Presets</span>
          </div>

          <select 
            value={adj.lutPreset || 'none'} 
            onChange={(e) => {
              const presetId = e.target.value;
              (setAdj as any)('lutPreset', presetId);
              if (presetId !== 'none') {
                applyLutPreset(presetId, setAdj as any);
              }
            }}
            style={{ width: '100%', marginBottom: 6, background: '#111', color: '#eee', border: '1px solid #333', padding: 4 }}
          >
            <option value="none">None / Custom</option>
            <optgroup label="VSCO / Film">
              <option value="vsco-kodak-portra">VSCO Kodak Portra</option>
              <option value="vsco-fuji-superia">VSCO Fuji Superia</option>
              <option value="film-kodak-2383">Kodak 2383 (Cinema)</option>
              <option value="film-fuji-3510">Fuji 3510</option>
            </optgroup>
            <optgroup label="Cinema LUTs">
              <option value="cinema-teal-orange">Teal & Orange Blockbuster</option>
              <option value="cinema-bleach-bypass">Bleach Bypass</option>
              <option value="cinema-vintage">Vintage 70s</option>
            </optgroup>
            <optgroup label="Lens Effects">
              <option value="lens-anamorphic">Anamorphic Flare</option>
              <option value="lens-vintage-glass">Vintage Glass</option>
            </optgroup>
          </select>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.01" 
              value={adj.lutIntensity ?? 0} 
              onChange={(e) => setAdj('lutIntensity', parseFloat(e.target.value))} 
              style={{flex: 1}}
            />
            <span style={{width: 32, fontSize: 11}}>{((adj.lutIntensity ?? 0) * 100).toFixed(0)}%</span>
          </div>

          <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 10, padding: '2px 6px', background: '#222', cursor: 'pointer' }}>
              Load Custom LUT
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const url = URL.createObjectURL(file);
                  (setAdj as any)('customLutUrl', url);
                  setAdj('lutIntensity', 0.8);
                  alert('Custom LUT loaded (simulated). Full 3D sampling coming soon.');
                }
              }} />
            </label>
            <button onClick={() => {
              // Trigger Grok LUT suggestion from main app context
              window.dispatchEvent(new CustomEvent('aito:grok-lut-suggest'));
            }} style={{ fontSize: 10, padding: '2px 6px' }}>Ask Grok</button>
          </div>
          <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>
            Presets auto-apply film/cinema looks. Grok can detect style from image or create new ones.
          </div>
        </div>

        {/* Additional Pro Tools */}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>More Tools</div>
          <div className="row">
            <label>Sharpen</label>
            <input type="range" min="0" max="2" step="0.05" value={adj.sharpen ?? 0} onChange={(e) => setAdj('sharpen', parseFloat(e.target.value))} />
          </div>
          <div className="row">
            <label>Vignette</label>
            <input type="range" min="-1" max="1" step="0.05" value={adj.vignette ?? 0} onChange={(e) => setAdj('vignette', parseFloat(e.target.value))} />
          </div>
        </div>
      </div>

      <h3>Add layer</h3>
      <div className="pill-row">
        {KINDS.map((k) => (
          <span
            key={k}
            className="pill"
            onClick={() => addLayer(k, "after")}
          >
            + {k}
          </span>
        ))}
      </div>

      {layers.map((layer) => (
        <LayerPanel
          key={layer.id}
          layer={layer}
          onToggle={() => toggleLayer(layer.id)}
          onRemove={() => removeLayer(layer.id)}
          onChange={(patch) => updateLayer(layer.id, patch as never)}
          onSide={(s) => setLayerSide(layer.id, s)}
        />
      ))}
    </>
  );
}

interface LayerPanelProps {
  layer: ActiveLayer;
  onToggle(): void;
  onRemove(): void;
  onSide(side: EffectSide): void;
  onChange(patch: Partial<EffectPropsByKind[EffectKind]>): void;
}

function LayerPanel({
  layer,
  onToggle,
  onRemove,
  onSide,
  onChange,
}: LayerPanelProps) {
  const fields = FIELDS[layer.kind];
  return (
    <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
      <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1 }}>{layer.kind}</span>
        <span className="pill" onClick={onToggle}>
          {layer.enabled ? "on" : "off"}
        </span>
        <span className="pill" onClick={onRemove}>×</span>
      </h3>
      <div className="pill-row">
        {SIDES.map((s) => (
          <span
            key={s}
            className={`pill side ${layer.side === s ? "active" : ""}`}
            onClick={() => onSide(s)}
          >
            {s}
          </span>
        ))}
      </div>
      {fields.map((f) => {
        const val = (layer.props as unknown as Record<string, number>)[f.key];
        return (
          <div className="row" key={f.key}>
            <label>{f.label}</label>
            <input
              type="number"
              value={Number.isFinite(val) ? val : 0}
              step={f.step ?? 1}
              onChange={(e) =>
                onChange({ [f.key]: Number(e.target.value) } as never)
              }
            />
            <input
              style={{ gridColumn: "1 / 3" }}
              type="range"
              min={f.min}
              max={f.max}
              step={f.step ?? 1}
              value={Number.isFinite(val) ? val : 0}
              onChange={(e) =>
                onChange({ [f.key]: Number(e.target.value) } as never)
              }
            />
          </div>
        );
      })}
    </div>
  );
}
