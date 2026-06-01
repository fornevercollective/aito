import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { BeforeAfter } from "./components/BeforeAfter";
import { ControlPanel } from "./components/ui/ControlPanel";
import { BatchPanel, SegmentPanel } from "./components/ui/SegmentPanel";
import { AIStatus } from "./components/ui/AIStatus";
import { connectAiChannel } from "./ai/channel";
import { useApp } from "./state/store";
import { loadFile } from "./lib/image";
const WS_URL = import.meta.env.VITE_AI_WS ?? "";
export default function App() {
    const [tab, setTabState] = useState("segment");
    const slider = useApp((s) => s.slider);
    const sliderDragging = useApp((s) => s.sliderDragging);
    const setSlider = useApp((s) => s.setSlider);
    const ai = useApp((s) => s.ai);
    const channel = useApp((s) => s.channel);
    const loadImage = useApp((s) => s.loadImage);
    const before = useApp((s) => s.before);
    const adjustmentScope = useApp((s) => s.adjustmentScope);
    const activeSegmentId = useApp((s) => s.activeSegmentId);
    const fileInputRef = useRef(null);
    const openFile = () => fileInputRef.current?.click();
    const onFileChosen = async (e) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const loaded = await loadFile(file);
                loadImage("both", loaded); // open photo ready to edit
                // Make SAM central immediately
                setTabState("segment");
            }
            catch (err) {
                console.error(err);
            }
        }
        // allow re-selecting the same file
        e.target.value = "";
    };
    // One-time auto subject lift when user opens a fresh photo (immediate "it just works")
    const didAutoSegmentRef = useRef("");
    useEffect(() => {
        if (!before || didAutoSegmentRef.current === before)
            return;
        // Only auto for user-loaded images (object URLs), not the initial demo
        if (before.startsWith("blob:")) {
            didAutoSegmentRef.current = before;
            // Small delay so the image is ready in textures/SAM cache
            const id = window.setTimeout(() => {
                // Trigger the existing auto flow by switching tool if user is on segment tab
                const st = useApp.getState();
                if (st.segmentTool !== "auto" && !st.segmentBusy) {
                    st.setSegmentTool("auto");
                    // reset back to tap after it fires (the effect in BeforeAfter runs once)
                    window.setTimeout(() => st.setSegmentTool("tap"), 1200);
                }
            }, 420);
            return () => clearTimeout(id);
        }
    }, [before]);
    // Basic "what you see on the right side" export. Good enough for Phase 0;
    // later versions will do full-resolution bake of after + corrections + layers.
    const exportCurrent = async () => {
        const stage = document.querySelector(".stage");
        const glCanvas = stage?.querySelector("canvas");
        if (!glCanvas)
            return;
        // Briefly drive slider to full "after" for a clean export of the right side
        const prevSlider = useApp.getState().slider;
        const setSlider = useApp.getState().setSlider;
        setSlider(1);
        // Wait two frames for the GL render to settle (slider clip + any easing)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const rect = glCanvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const out = document.createElement("canvas");
        out.width = Math.floor(rect.width * dpr);
        out.height = Math.floor(rect.height * dpr);
        const ctx = out.getContext("2d", { alpha: false });
        ctx.scale(dpr, dpr);
        ctx.drawImage(glCanvas, 0, 0, rect.width, rect.height);
        // Restore slider
        setSlider(prevSlider);
        const a = document.createElement("a");
        const name = useApp.getState().afterMeta?.name?.replace(/\.[^.]+$/, "") || "aito-edit";
        a.href = out.toDataURL("image/png");
        a.download = `${name}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    };
    // Mask-aware "hatch for export" variants — Apple-style subject lift with treatments.
    // Uses the active SAM mask + current corrected view for clean pixel output.
    const exportMasked = async (mode) => {
        const stage = document.querySelector(".stage");
        const glCanvas = stage?.querySelector("canvas");
        const s = useApp.getState();
        const activeMask = s.segments.find((m) => m.id === s.activeSegmentId);
        if (!glCanvas || !activeMask)
            return;
        // Capture the corrected "after" view (full right side)
        const prevSlider = s.slider;
        const setSlider = s.setSlider;
        setSlider(1);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const rect = glCanvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const capture = document.createElement("canvas");
        capture.width = Math.floor(rect.width * dpr);
        capture.height = Math.floor(rect.height * dpr);
        const cctx = capture.getContext("2d", { alpha: true });
        cctx.scale(dpr, dpr);
        cctx.drawImage(glCanvas, 0, 0, rect.width, rect.height);
        setSlider(prevSlider);
        // Load the high-res mask and composite
        const maskImg = await new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = activeMask.dataUrl;
        });
        const out = document.createElement("canvas");
        out.width = capture.width;
        out.height = capture.height;
        const octx = out.getContext("2d", { alpha: true });
        // Draw base corrected image
        octx.drawImage(capture, 0, 0);
        // Use mask as alpha mask for the desired region
        octx.globalCompositeOperation = "destination-in";
        // Scale the mask to the capture size (masks are stored at native image res)
        const mw = maskImg.width;
        const mh = maskImg.height;
        const scaleX = capture.width / mw;
        const scaleY = capture.height / mh;
        octx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
        if (mode === "subject") {
            octx.drawImage(maskImg, 0, 0);
        }
        else {
            // background = invert mask
            octx.fillStyle = "#fff";
            octx.fillRect(0, 0, mw, mh);
            octx.globalCompositeOperation = "destination-out";
            octx.drawImage(maskImg, 0, 0);
        }
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.globalCompositeOperation = "source-over";
        const a = document.createElement("a");
        const name = s.afterMeta?.name?.replace(/\.[^.]+$/, "") || "aito-edit";
        const suffix = mode === "subject" ? "-subject" : "-background";
        a.href = out.toDataURL("image/png");
        a.download = `${name}${suffix}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    };
    useEffect(() => {
        const handle = connectAiChannel(WS_URL || undefined);
        return () => handle.close();
    }, []);
    useEffect(() => {
        if (sliderDragging || !ai.busy)
            return;
        const target = 1 - ai.progress * 0.5;
        const id = requestAnimationFrame(() => {
            setSlider(slider + (target - slider) * 0.08);
        });
        return () => cancelAnimationFrame(id);
    }, [ai.busy, ai.progress, slider, sliderDragging, setSlider]);
    return (_jsxs("div", { className: "app", children: [_jsxs("div", { className: "top", children: [_jsx("span", { className: "brand", children: "aito" }), _jsx("a", { href: "/aito/", className: "version-link", style: { color: '#888', marginLeft: '8px' }, children: "hub" }), _jsx("span", { className: "version-badge", children: "main" }), _jsx("button", { type: "button", className: "open-btn", onClick: openFile, children: "Open" }), _jsx("button", { type: "button", className: "top-btn", onClick: () => {
                            const b = useApp.getState().before;
                            const bm = useApp.getState().beforeMeta;
                            useApp.getState().setSources(b, b, bm, bm);
                        }, children: "Reset" }), _jsx("button", { type: "button", className: "top-btn", onClick: () => {
                            const s = useApp.getState();
                            s.setSources(s.after, s.before, s.afterMeta, s.beforeMeta);
                        }, children: "Swap" }), _jsx("button", { type: "button", className: "top-btn primary", onClick: () => void exportCurrent(), children: "Export Full" }), adjustmentScope.useActiveMask && activeSegmentId && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "top-btn", onClick: () => void exportMasked("subject"), children: "Export Subject" }), _jsx("button", { type: "button", className: "top-btn", onClick: () => void exportMasked("background"), children: "Export BG" })] })), _jsx("span", { className: "muted", children: "SAM \u00B7 corrections \u00B7 before/after" }), _jsx("div", { className: "spacer" }), _jsxs("span", { className: "muted", children: ["ws: ", _jsx("code", { children: WS_URL || "(mock)" }), " \u00B7 ", channel] }), _jsx("input", { ref: fileInputRef, type: "file", accept: "image/*", hidden: true, onChange: onFileChosen })] }), _jsx(BeforeAfter, {}), _jsxs("aside", { className: "panel", children: [_jsx("div", { className: "tabs", children: ["segment", "batch", "effects"].map((t) => (_jsx("button", { type: "button", className: tab === t ? "active" : "", onClick: () => setTabState(t), children: t }, t))) }), tab === "effects" && _jsx(ControlPanel, {}), tab === "segment" && _jsx(SegmentPanel, {}), tab === "batch" && _jsx(BatchPanel, {})] }), _jsx(AIStatus, {})] }));
}
