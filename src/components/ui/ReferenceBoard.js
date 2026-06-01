import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useApp } from "@/state/store";
import { useRef } from "react";
export function ReferenceBoard() {
    const references = useApp((s) => s.references);
    const activeIds = useApp((s) => s.activeReferenceIds);
    const addReference = useApp((s) => s.addReference);
    const removeReference = useApp((s) => s.removeReference);
    const toggleActive = useApp((s) => s.toggleActiveReference);
    const clear = useApp((s) => s.clearReferences);
    const fileInputRef = useRef(null);
    const doodleCanvasRef = useRef(null);
    const doodleActiveRef = useRef(false);
    const captureFromCanvas = () => {
        const canvas = document.querySelector('canvas');
        if (!canvas)
            return;
        const url = canvas.toDataURL('image/jpeg', 0.9);
        addReference({
            url,
            label: 'Current Frame',
            source: 'canvas'
        });
    };
    const captureFromTether = () => {
        // In real usage the tether frame is often the current 'before'
        const before = useApp.getState().before;
        if (!before)
            return;
        addReference({
            url: before,
            label: 'Live Tether',
            source: 'tether'
        });
    };
    const handleUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            addReference({
                url: ev.target?.result,
                label: file.name.split('.')[0] || 'Reference',
                source: 'upload'
            });
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };
    // Simple doodle capture
    const startDoodle = () => {
        const canvas = doodleCanvasRef.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#ff5b2e';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        doodleActiveRef.current = true;
    };
    const handleDoodleMove = (e) => {
        if (!doodleActiveRef.current)
            return;
        const canvas = doodleCanvasRef.current;
        if (!canvas)
            return;
        const rect = canvas.getBoundingClientRect();
        const ctx = canvas.getContext('2d');
        ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
        ctx.stroke();
    };
    const endDoodle = () => {
        doodleActiveRef.current = false;
    };
    const captureDoodle = () => {
        const canvas = doodleCanvasRef.current;
        if (!canvas)
            return;
        const url = canvas.toDataURL('image/png');
        addReference({
            url,
            label: 'Doodle / Sketch',
            source: 'doodle'
        });
        // reset doodle
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    return (_jsxs("div", { className: "reference-board", children: [_jsxs("div", { className: "ref-header", children: [_jsxs("div", { children: [_jsx("strong", { children: "Reference Board" }), _jsx("span", { className: "ref-subtitle", children: "For commercial direction" })] }), _jsx("button", { onClick: clear, className: "ref-clear", children: "Clear" })] }), _jsxs("div", { className: "ref-actions", children: [_jsx("button", { onClick: captureFromCanvas, children: "Capture Current" }), _jsx("button", { onClick: captureFromTether, disabled: !useApp.getState().isTethered, children: "From Tether" }), _jsx("button", { onClick: () => fileInputRef.current?.click(), children: "Upload Ref" }), _jsx("input", { ref: fileInputRef, type: "file", accept: "image/*", hidden: true, onChange: handleUpload })] }), _jsxs("div", { className: "doodle-area", children: [_jsx("canvas", { ref: doodleCanvasRef, width: 280, height: 120, onPointerDown: startDoodle, onPointerMove: handleDoodleMove, onPointerUp: endDoodle, onPointerLeave: endDoodle, style: { background: '#111', borderRadius: 4, cursor: 'crosshair' } }), _jsx("button", { onClick: captureDoodle, className: "capture-doodle", children: "Add Doodle as Ref" })] }), _jsxs("div", { className: "ref-grid", children: [references.length === 0 && (_jsx("div", { className: "ref-empty", children: "Add references from camera, canvas, upload, or doodle" })), references.map((ref) => {
                        const isActive = activeIds.includes(ref.id);
                        return (_jsxs("div", { className: `ref-item ${isActive ? 'active' : ''}`, onClick: () => toggleActive(ref.id), children: [_jsx("img", { src: ref.url, alt: ref.label }), _jsx("div", { className: "ref-label", children: ref.label }), _jsx("div", { className: "ref-source", children: ref.source }), _jsx("button", { className: "ref-remove", onClick: (e) => { e.stopPropagation(); removeReference(ref.id); }, children: "\u00D7" })] }, ref.id));
                    })] }), _jsx("div", { className: "ref-hint", children: "Active references are sent to Grok for commercial direction" })] }));
}
