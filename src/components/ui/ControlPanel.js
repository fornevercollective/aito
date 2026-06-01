import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useApp } from "@/state/store";
import { applyLutPreset } from "@/lib/lutPresets";
const ADJ_FIELDS = [
    { key: "exposure", label: "exposure", min: -2, max: 2, step: 0.01 },
    { key: "contrast", label: "contrast", min: -1, max: 1, step: 0.01 },
    { key: "saturation", label: "saturation", min: -1, max: 1, step: 0.01 },
    { key: "temperature", label: "temperature", min: -1, max: 1, step: 0.01 },
    { key: "tint", label: "tint", min: -1, max: 1, step: 0.01 },
    { key: "clarity", label: "clarity", min: -1, max: 1, step: 0.01 },
];
const KINDS = [
    "sampling",
    "unfocused",
    "burn",
    "glass",
    "magnifier",
    "crack",
];
const SIDES = ["before", "after", "both"];
const FIELDS = {
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
    return (_jsxs(_Fragment, { children: [_jsx("h3", { children: "Adjust (after)" }), _jsxs("div", { style: { marginBottom: 8 }, children: [ADJ_FIELDS.map((f) => {
                        const val = adj[f.key];
                        const numVal = typeof val === 'number' ? val : 0;
                        return (_jsxs("div", { className: "row", children: [_jsx("label", { children: f.label }), _jsx("input", { type: "number", value: Number.isFinite(numVal) ? numVal.toFixed(2) : "0", step: f.step, onChange: (e) => setAdj(f.key, Number(e.target.value)) }), _jsx("input", { style: { gridColumn: "1 / 3" }, type: "range", min: f.min, max: f.max, step: f.step, value: numVal, onChange: (e) => setAdj(f.key, Number(e.target.value)) })] }, f.key));
                    }), _jsx("button", { type: "button", onClick: resetAdj, style: { marginTop: 6, width: "100%", fontSize: 11 }, children: "Reset adjustments" }), _jsxs("div", { style: { marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }, children: [_jsxs("label", { className: "check", style: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }, children: [_jsx("input", { type: "checkbox", checked: scope.useActiveMask, onChange: (e) => setScope({ useActiveMask: e.target.checked }) }), _jsx("span", { children: "Scope to active mask" })] }), _jsxs("label", { className: "check", style: { display: "flex", alignItems: "center", gap: 6, marginTop: 4, cursor: "pointer" }, children: [_jsx("input", { type: "checkbox", checked: scope.invert, onChange: (e) => setScope({ invert: e.target.checked }), disabled: !scope.useActiveMask }), _jsx("span", { children: "Invert (edit background)" })] }), _jsx("div", { style: { fontSize: 10, color: "var(--muted)", marginTop: 4 }, children: "Use Segment tab to tap/auto subjects. Corrections only affect the selected region." })] }), _jsxs("div", { style: { marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--line)" }, children: [_jsxs("div", { style: { fontSize: 11, color: "var(--muted)", marginBottom: 4, display: 'flex', justifyContent: 'space-between' }, children: [_jsx("span", { children: "LUT Styling" }), _jsx("span", { style: { fontSize: 9, opacity: 0.6 }, children: "AI + Presets" })] }), _jsxs("select", { value: adj.lutPreset || 'none', onChange: (e) => {
                                    const presetId = e.target.value;
                                    setAdj('lutPreset', presetId);
                                    if (presetId !== 'none') {
                                        applyLutPreset(presetId, setAdj);
                                    }
                                }, style: { width: '100%', marginBottom: 6, background: '#111', color: '#eee', border: '1px solid #333', padding: 4 }, children: [_jsx("option", { value: "none", children: "None / Custom" }), _jsxs("optgroup", { label: "VSCO / Film", children: [_jsx("option", { value: "vsco-kodak-portra", children: "VSCO Kodak Portra" }), _jsx("option", { value: "vsco-fuji-superia", children: "VSCO Fuji Superia" }), _jsx("option", { value: "film-kodak-2383", children: "Kodak 2383 (Cinema)" }), _jsx("option", { value: "film-fuji-3510", children: "Fuji 3510" })] }), _jsxs("optgroup", { label: "Cinema LUTs", children: [_jsx("option", { value: "cinema-teal-orange", children: "Teal & Orange Blockbuster" }), _jsx("option", { value: "cinema-bleach-bypass", children: "Bleach Bypass" }), _jsx("option", { value: "cinema-vintage", children: "Vintage 70s" })] }), _jsxs("optgroup", { label: "Lens Effects", children: [_jsx("option", { value: "lens-anamorphic", children: "Anamorphic Flare" }), _jsx("option", { value: "lens-vintage-glass", children: "Vintage Glass" })] })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsx("input", { type: "range", min: "0", max: "1", step: "0.01", value: adj.lutIntensity ?? 0, onChange: (e) => setAdj('lutIntensity', parseFloat(e.target.value)), style: { flex: 1 } }), _jsxs("span", { style: { width: 32, fontSize: 11 }, children: [((adj.lutIntensity ?? 0) * 100).toFixed(0), "%"] })] }), _jsxs("div", { style: { marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }, children: [_jsxs("label", { style: { fontSize: 10, padding: '2px 6px', background: '#222', cursor: 'pointer' }, children: ["Load Custom LUT", _jsx("input", { type: "file", accept: "image/*", style: { display: 'none' }, onChange: (e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) {
                                                        const url = URL.createObjectURL(file);
                                                        setAdj('customLutUrl', url);
                                                        setAdj('lutIntensity', 0.8);
                                                        alert('Custom LUT loaded (simulated). Full 3D sampling coming soon.');
                                                    }
                                                } })] }), _jsx("button", { onClick: () => {
                                            // Trigger Grok LUT suggestion from main app context
                                            window.dispatchEvent(new CustomEvent('aito:grok-lut-suggest'));
                                        }, style: { fontSize: 10, padding: '2px 6px' }, children: "Ask Grok" })] }), _jsx("div", { style: { fontSize: 9, color: "#555", marginTop: 2 }, children: "Presets auto-apply film/cinema looks. Grok can detect style from image or create new ones." })] }), _jsxs("div", { style: { marginTop: 8 }, children: [_jsx("div", { style: { fontSize: 11, color: "var(--muted)", marginBottom: 4 }, children: "More Tools" }), _jsxs("div", { className: "row", children: [_jsx("label", { children: "Sharpen" }), _jsx("input", { type: "range", min: "0", max: "2", step: "0.05", value: adj.sharpen ?? 0, onChange: (e) => setAdj('sharpen', parseFloat(e.target.value)) })] }), _jsxs("div", { className: "row", children: [_jsx("label", { children: "Vignette" }), _jsx("input", { type: "range", min: "-1", max: "1", step: "0.05", value: adj.vignette ?? 0, onChange: (e) => setAdj('vignette', parseFloat(e.target.value)) })] })] })] }), _jsx("h3", { children: "Add layer" }), _jsx("div", { className: "pill-row", children: KINDS.map((k) => (_jsxs("span", { className: "pill", onClick: () => addLayer(k, "after"), children: ["+ ", k] }, k))) }), layers.map((layer) => (_jsx(LayerPanel, { layer: layer, onToggle: () => toggleLayer(layer.id), onRemove: () => removeLayer(layer.id), onChange: (patch) => updateLayer(layer.id, patch), onSide: (s) => setLayerSide(layer.id, s) }, layer.id)))] }));
}
function LayerPanel({ layer, onToggle, onRemove, onSide, onChange, }) {
    const fields = FIELDS[layer.kind];
    return (_jsxs("div", { style: { marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--line)" }, children: [_jsxs("h3", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [_jsx("span", { style: { flex: 1 }, children: layer.kind }), _jsx("span", { className: "pill", onClick: onToggle, children: layer.enabled ? "on" : "off" }), _jsx("span", { className: "pill", onClick: onRemove, children: "\u00D7" })] }), _jsx("div", { className: "pill-row", children: SIDES.map((s) => (_jsx("span", { className: `pill side ${layer.side === s ? "active" : ""}`, onClick: () => onSide(s), children: s }, s))) }), fields.map((f) => {
                const val = layer.props[f.key];
                return (_jsxs("div", { className: "row", children: [_jsx("label", { children: f.label }), _jsx("input", { type: "number", value: Number.isFinite(val) ? val : 0, step: f.step ?? 1, onChange: (e) => onChange({ [f.key]: Number(e.target.value) }) }), _jsx("input", { style: { gridColumn: "1 / 3" }, type: "range", min: f.min, max: f.max, step: f.step ?? 1, value: Number.isFinite(val) ? val : 0, onChange: (e) => onChange({ [f.key]: Number(e.target.value) }) })] }, f.key));
            })] }));
}
