import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useApp } from "@/state/store";
import { formatExifForDisplay } from "@/lib/exif";
function TetherControls({ onCapture, onDisconnect, onSettingChange }) {
    const tetherCamera = useApp((s) => s.tetherCamera);
    return (_jsxs("div", { className: "inspector-section tether", children: [_jsxs("div", { className: "inspector-header", children: [_jsx("div", { className: "live-dot" }), "LIVE TETHER"] }), _jsxs("div", { className: "tether-info", children: [_jsx("div", { className: "tether-camera", children: tetherCamera || "Camera via companion" }), _jsx("div", { className: "tether-note", children: "Supports Canon, Sony, Nikon, Phase One, Fujifilm, Blackmagic, and any PTP/IP or SDK camera the local companion can reach." })] }), _jsxs("div", { className: "tether-controls", children: [_jsxs("label", { children: ["ISO", _jsx("input", { type: "number", defaultValue: 400, onChange: (e) => onSettingChange("iso", e.target.value) })] }), _jsxs("label", { children: ["Shutter", _jsxs("select", { defaultValue: "1/125", onChange: (e) => onSettingChange("shutter", e.target.value), children: [_jsx("option", { children: "1/1000" }), _jsx("option", { children: "1/500" }), _jsx("option", { children: "1/250" }), _jsx("option", { children: "1/125" }), _jsx("option", { children: "1/60" }), _jsx("option", { children: "1/30" }), _jsx("option", { children: "1/15" })] })] }), _jsx("button", { className: "capture-btn", onClick: onCapture, children: "CAPTURE" }), _jsx("button", { className: "disconnect-btn", onClick: onDisconnect, children: "Disconnect" })] })] }));
}
export function Inspector() {
    const beforeMeta = useApp((s) => s.beforeMeta);
    const exif = useApp((s) => s.exif);
    const isTethered = useApp((s) => s.isTethered);
    const setIsTethered = useApp((s) => s.setIsTethered);
    const exifRows = formatExifForDisplay(exif);
    const handleCapture = () => {
        const ws = window.__aitoTether;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "capture" }));
        }
        else {
            // In mock mode, just nudge the slider or log
            console.log("[Tether] Capture requested (no live WS)");
        }
    };
    const handleDisconnect = () => {
        const ws = window.__aitoTether;
        if (ws)
            ws.close();
        setIsTethered(false);
        useApp.getState().setTetherCamera(null);
    };
    const handleSettingChange = (key, value) => {
        const ws = window.__aitoTether;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "setting", key, value }));
        }
    };
    return (_jsxs("aside", { className: "inspector", children: [isTethered && (_jsx(TetherControls, { onCapture: handleCapture, onDisconnect: handleDisconnect, onSettingChange: handleSettingChange })), _jsxs("div", { className: "inspector-section meta", children: [_jsx("div", { className: "inspector-header", children: "METADATA" }), beforeMeta && (_jsxs("div", { className: "meta-row", children: [_jsx("span", { className: "meta-label", children: "File" }), _jsx("span", { className: "meta-value", title: beforeMeta.name, children: beforeMeta.name || "untitled" })] })), beforeMeta && (_jsxs("div", { className: "meta-row", children: [_jsx("span", { className: "meta-label", children: "Dimensions" }), _jsxs("span", { className: "meta-value", children: [beforeMeta.width, " \u00D7 ", beforeMeta.height] })] })), exifRows.length > 0 ? (exifRows.map((row, i) => (_jsxs("div", { className: "meta-row", children: [_jsx("span", { className: "meta-label", children: row.label }), _jsx("span", { className: "meta-value", children: row.value })] }, i)))) : (_jsx("div", { className: "meta-empty", children: beforeMeta ? "No EXIF data" : "Load an image to see metadata" }))] }), !isTethered && (_jsx("div", { className: "inspector-footer", children: _jsx("div", { className: "inspector-note", children: "Connect a camera via the local companion for live tethering and real-time EXIF." }) }))] }));
}
