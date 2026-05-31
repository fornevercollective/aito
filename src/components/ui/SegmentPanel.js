import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useApp } from "@/state/store";
import { ensureSam, getSamState, onSamState, processBatchItem, } from "@/segmentation/segmentService";
export function SegmentPanel() {
    const segmentTool = useApp((s) => s.segmentTool);
    const segmentBackend = useApp((s) => s.segmentBackend);
    const segments = useApp((s) => s.segments);
    const activeId = useApp((s) => s.activeSegmentId);
    const showStickers = useApp((s) => s.showStickers);
    const samReady = useApp((s) => s.samReady);
    const segmentBusy = useApp((s) => s.segmentBusy);
    const before = useApp((s) => s.before);
    const channel = useApp((s) => s.channel);
    const adjustmentScope = useApp((s) => s.adjustmentScope);
    const useActiveMask = adjustmentScope.useActiveMask;
    const brush = useApp((s) => s.brush);
    const toggleBrush = useApp((s) => s.toggleBrush);
    const setBrush = useApp((s) => s.setBrush);
    const setSegmentTool = useApp((s) => s.setSegmentTool);
    const setSegmentBackend = useApp((s) => s.setSegmentBackend);
    const setShowStickers = useApp((s) => s.setShowStickers);
    const selectSegment = useApp((s) => s.selectSegment);
    const removeSegment = useApp((s) => s.removeSegment);
    const clearSegments = useApp((s) => s.clearSegments);
    const setSegmentBusy = useApp((s) => s.setSegmentBusy);
    const setSegments = useApp((s) => s.setSegments);
    const [samState, setSamState] = useState(getSamState().state);
    useEffect(() => {
        const unsub = onSamState(setSamState);
        return unsub;
    }, []);
    const backend = channel === "live" ? "server" : segmentBackend;
    const loadSam = async () => {
        setSegmentBusy(true);
        await ensureSam();
        setSegmentBusy(false);
    };
    const tapAuto = async () => {
        setSegmentBusy(true);
        try {
            if (backend === "sam")
                await ensureSam();
            const { segmentAuto } = await import("@/segmentation/segmentService");
            const masks = await segmentAuto(before, backend);
            if (masks.length)
                setSegments(masks);
        }
        finally {
            setSegmentBusy(false);
        }
    };
    return (_jsxs("div", { className: "segment-panel", children: [_jsx("h3", { children: "Segment (SAM)" }), _jsxs("div", { className: "pill-row", children: [["slider", "tap", "auto"].map((t) => (_jsx("span", { className: `pill ${segmentTool === t ? "active" : ""}`, onClick: () => setSegmentTool(t), children: t }, t))), _jsx("span", { className: `pill ${brush.active ? "active" : ""}`, onClick: () => toggleBrush(), title: "Freehand refine active mask (add/subtract)", children: "brush" })] }), brush.active && (_jsxs("div", { style: { marginTop: 8, fontSize: 11 }, children: [_jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("span", { children: "size" }), _jsx("input", { type: "range", min: 8, max: 180, value: brush.size, onChange: (e) => setBrush({ size: Number(e.target.value) }), style: { flex: 1 } }), _jsx("span", { style: { width: 28, textAlign: "right" }, children: brush.size })] }), _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 4 }, children: [_jsx("span", { children: "hard" }), _jsx("input", { type: "range", min: 0, max: 1, step: 0.05, value: brush.hardness, onChange: (e) => setBrush({ hardness: Number(e.target.value) }), style: { flex: 1 } }), _jsx("span", { style: { width: 28, textAlign: "right" }, children: brush.hardness.toFixed(1) })] }), _jsx("div", { className: "pill-row", style: { marginTop: 4 }, children: ["add", "subtract"].map((m) => (_jsx("span", { className: `pill side ${brush.mode === m ? "active" : ""}`, onClick: () => setBrush({ mode: m }), children: m }, m))) })] })), _jsxs("div", { className: "pill-row", children: [["sam", "mock"].map((b) => (_jsx("span", { className: `pill side ${segmentBackend === b && channel !== "live" ? "active" : ""}`, onClick: () => setSegmentBackend(b), children: b }, b))), channel === "live" && (_jsx("span", { className: "pill side active", children: "server" }))] }), _jsxs("div", { className: "row-actions", children: [_jsx("button", { type: "button", onClick: () => void loadSam(), disabled: segmentBusy, children: samState === "ready" || samReady ? "SAM ready" : "Load SAM" }), _jsx("button", { type: "button", onClick: () => void tapAuto(), disabled: segmentBusy, children: "Auto subjects" }), _jsx("button", { type: "button", onClick: () => clearSegments(), children: "Clear" })] }), _jsxs("label", { className: "check", children: [_jsx("input", { type: "checkbox", checked: showStickers, onChange: (e) => setShowStickers(e.target.checked) }), "Sticker preview"] }), _jsxs("p", { className: "hint", children: ["Tap / Auto subjects \u2192 then use ", _jsx("strong", { children: "Adjust" }), " panel with \"Scope to active mask\". This is the core masked corrections flow."] }), _jsxs("h3", { children: ["Masks (", segments.length, ")"] }), _jsx("ul", { className: "mask-list", children: segments.map((m) => (_jsxs("li", { className: m.id === activeId ? "active" : "", onClick: () => selectSegment(m.id), children: [_jsx("span", { children: m.label ?? m.id }), _jsxs("span", { className: "score", children: [(m.score * 100).toFixed(0), "%"] }), m.id === activeId && useActiveMask && (_jsx("span", { className: "pill side", style: { background: "var(--accent)", color: "#000", fontSize: 9, padding: "1px 5px" }, children: "corrections" })), _jsx("button", { type: "button", className: "x", onClick: (e) => {
                                e.stopPropagation();
                                removeSegment(m.id);
                            }, children: "\u00D7" })] }, m.id))) })] }));
}
export function BatchPanel() {
    const batch = useApp((s) => s.batch);
    const batchRunning = useApp((s) => s.batchRunning);
    const segmentBackend = useApp((s) => s.segmentBackend);
    const channel = useApp((s) => s.channel);
    const addBatchFiles = useApp((s) => s.addBatchFiles);
    const removeBatchItem = useApp((s) => s.removeBatchItem);
    const updateBatchItem = useApp((s) => s.updateBatchItem);
    const setBatchRunning = useApp((s) => s.setBatchRunning);
    const setSources = useApp((s) => s.setSources);
    const backend = channel === "live" ? "server" : segmentBackend;
    const runBatch = async () => {
        if (batchRunning || !batch.length)
            return;
        setBatchRunning(true);
        if (backend === "sam")
            await ensureSam();
        for (const item of batch) {
            if (item.status === "done")
                continue;
            try {
                const result = await processBatchItem(item, backend, (p, status) => {
                    updateBatchItem(item.id, { progress: p, status });
                });
                updateBatchItem(item.id, {
                    segments: result.segments,
                    after: result.after,
                    status: "done",
                    progress: 1,
                });
                setSources(item.before, result.after ?? item.before);
            }
            catch (e) {
                updateBatchItem(item.id, {
                    status: "error",
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }
        setBatchRunning(false);
    };
    return (_jsxs("div", { className: "batch-panel", children: [_jsx("h3", { children: "Batch retouch" }), _jsx("input", { type: "file", accept: "image/*", multiple: true, onChange: (e) => e.target.files && addBatchFiles(e.target.files) }), _jsx("div", { className: "row-actions", children: _jsx("button", { type: "button", onClick: () => void runBatch(), disabled: batchRunning || batch.length === 0, children: batchRunning ? "Running…" : `Run ${batch.length} items` }) }), _jsx("ul", { className: "batch-list", children: batch.map((b) => (_jsxs("li", { children: [_jsx("span", { className: "name", children: b.name }), _jsx("span", { className: "status", children: b.status }), _jsxs("span", { className: "prog", children: [(b.progress * 100).toFixed(0), "%"] }), _jsx("button", { type: "button", onClick: () => removeBatchItem(b.id), children: "\u00D7" })] }, b.id))) })] }));
}
