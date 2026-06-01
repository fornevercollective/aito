import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { EffectStage } from "./EffectStage";
import { MaskOverlay } from "./MaskOverlay";
import { BrushOverlay } from "./BrushOverlay";
import { useApp } from "@/state/store";
import { clearSamCache, ensureSam, onSamState, segmentAuto, segmentTap, } from "@/segmentation/segmentService";
import { loadFile } from "@/lib/image";
/**
 * Before/after stage with separate interaction modes:
 *   slider — drag the handle only
 *   tap    — SAM / mock point mask (Apple sticker style)
 *   auto   — grid auto-mask all subjects
 */
export function BeforeAfter() {
    const slider = useApp((s) => s.slider);
    const setSlider = useApp((s) => s.setSlider);
    const setSliderDragging = useApp((s) => s.setSliderDragging);
    const segmentTool = useApp((s) => s.segmentTool);
    const segmentBackend = useApp((s) => s.segmentBackend);
    const before = useApp((s) => s.before);
    const segmentBusy = useApp((s) => s.segmentBusy);
    const setSegmentBusy = useApp((s) => s.setSegmentBusy);
    const addSegment = useApp((s) => s.addSegment);
    const setSegments = useApp((s) => s.setSegments);
    const setSamReady = useApp((s) => s.setSamReady);
    const ai = useApp((s) => s.ai);
    const wrapRef = useRef(null);
    const dragging = useRef(false);
    useEffect(() => {
        const unsub = onSamState((s) => setSamReady(s === "ready"));
        return unsub;
    }, [setSamReady]);
    useEffect(() => {
        clearSamCache();
    }, [before]);
    const onHandlePointerDown = (e) => {
        e.stopPropagation();
        dragging.current = true;
        setSliderDragging(true);
        const move = (ev) => {
            if (!dragging.current || !wrapRef.current)
                return;
            const r = wrapRef.current.getBoundingClientRect();
            setSlider((ev.clientX - r.left) / r.width);
        };
        const up = () => {
            dragging.current = false;
            setSliderDragging(false);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };
    const onStageClick = useCallback(async (e) => {
        if (segmentTool === "slider" || segmentBusy)
            return;
        if (!wrapRef.current)
            return;
        const r = wrapRef.current.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        if (segmentTool === "tap") {
            setSegmentBusy(true);
            try {
                const mask = await segmentTap(before, x, y, segmentBackend);
                if (mask)
                    addSegment(mask);
            }
            finally {
                setSegmentBusy(false);
            }
        }
    }, [segmentTool, segmentBusy, before, segmentBackend, addSegment, setSegmentBusy]);
    const runAuto = useCallback(async () => {
        if (segmentBusy)
            return;
        setSegmentBusy(true);
        try {
            if (segmentBackend === "sam")
                await ensureSam();
            const masks = await segmentAuto(before, segmentBackend);
            if (masks.length)
                setSegments(masks);
        }
        finally {
            setSegmentBusy(false);
        }
    }, [before, segmentBackend, segmentBusy, setSegmentBusy, setSegments]);
    useEffect(() => {
        if (segmentTool === "auto")
            void runAuto();
    }, [segmentTool, before]); // eslint-disable-line react-hooks/exhaustive-deps
    // --- Drag & drop image loading (direct) ---
    const [isDragging, setIsDragging] = useState(false);
    const loadImage = useApp((s) => s.loadImage);
    const onDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setIsDragging(true);
    };
    const onDragLeave = (e) => {
        // Only leave if we're truly leaving the stage
        if (!wrapRef.current?.contains(e.relatedTarget)) {
            setIsDragging(false);
        }
    };
    const onDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith("image/")) {
            try {
                // Exit any live tether mode and clear stale AI slider animation
                const ws = window.__aitoTether;
                if (ws) {
                    ws.close();
                    window.__aitoTether = null;
                }
                // Note: isTethered is local to App, but we can dispatch a reset
                useApp.getState().setAi({ busy: false, progress: 0 });
                useApp.getState().setIsTethered(false);
                const loaded = await loadFile(file);
                // Primary flow: open as new photo to edit (before + after = same)
                loadImage("both", loaded);
            }
            catch (err) {
                console.error("Failed to load dropped image", err);
            }
        }
    };
    // Also support clicking the stage in certain empty-ish states later;
    // for now drag is the hero gesture.
    return (_jsxs("div", { ref: wrapRef, className: `stage tool-${segmentTool} ${isDragging ? "drag-over" : ""}`, onClick: onStageClick, onDragOver: onDragOver, onDragLeave: onDragLeave, onDrop: onDrop, children: [_jsx("div", { className: "canvas-wrap", children: _jsx(EffectStage, {}) }), _jsx(MaskOverlay, {}), _jsx(BrushOverlay, {}), _jsx("div", { className: "slider-handle", style: { left: `${slider * 100}%` } }), _jsx("div", { className: "slider-drag", style: { left: `${slider * 100}%` }, onPointerDown: onHandlePointerDown }), _jsxs("div", { className: "labels", children: [_jsx("span", { className: slider > 0.05 ? "active" : "", children: "Before" }), _jsx("span", { children: "\u00B7" }), _jsx("span", { className: slider < 0.95 ? "active" : "", children: "After" }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: segmentBusy ? "segmenting…" : ai.busy ? ai.status : "idle" })] }), isDragging && (_jsx("div", { className: "drop-overlay", children: _jsx("div", { className: "drop-card", children: "Drop image to edit" }) }))] }));
}
