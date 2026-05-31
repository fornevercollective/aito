import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { useApp } from "@/state/store";
import { createBrushStrokeNode } from "@/lib/bake-tree";
/**
 * BrushOverlay — freehand mask refinement (add/subtract) for Apple-style corrections.
 *
 * - Only active when brush tool is enabled in SegmentPanel.
 * - Paints directly into a temp canvas, then on pointer up composites the
 *   delta into the active SegmentMask's dataUrl and records a BakeNode
 *   (tree-sitter style) so the live bake walker can do incremental work.
 * - Integrates with BeforeAfter interaction (pointer capture when brush.active).
 *
 * Future: soft brush with hardness via radial gradient, pressure support,
 * and vwall ladder for brush patch deltas instead of full mask re-encode.
 */
export function BrushOverlay() {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const brush = useApp((s) => s.brush);
    const activeId = useApp((s) => s.activeSegmentId);
    const segments = useApp((s) => s.segments);
    const appendBakeNode = useApp((s) => s.appendBakeNode);
    const currentHead = useApp((s) => s.currentBakeHead);
    const activeMask = segments.find((m) => m.id === activeId);
    useEffect(() => {
        if (!brush.active || !activeMask || !wrapRef.current)
            return;
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext("2d", { alpha: true });
        let drawing = false;
        let lastX = 0;
        let lastY = 0;
        const resize = () => {
            const r = wrap.getBoundingClientRect();
            canvas.width = r.width;
            canvas.height = r.height;
            // Clear any previous temp strokes
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        };
        resize();
        const getPos = (e) => {
            const r = wrap.getBoundingClientRect();
            return {
                x: ((e.clientX - r.left) / r.width) * canvas.width,
                y: ((e.clientY - r.top) / r.height) * canvas.height,
            };
        };
        const drawStroke = (x, y, pressure = 1) => {
            const size = brush.size * pressure;
            const hardness = brush.hardness;
            ctx.save();
            ctx.globalCompositeOperation = brush.mode === "add" ? "source-over" : "destination-out";
            // Simple soft brush approximation (radial gradient for hardness)
            const grad = ctx.createRadialGradient(x, y, size * 0.2, x, y, size);
            grad.addColorStop(0, `rgba(255,255,255,${hardness})`);
            grad.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
            // Connect to previous point for smooth lines
            if (lastX && lastY) {
                ctx.lineWidth = size * 0.8;
                ctx.strokeStyle = `rgba(255,255,255,${hardness})`;
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(x, y);
                ctx.stroke();
            }
            ctx.restore();
            lastX = x;
            lastY = y;
        };
        const onDown = (e) => {
            if (!brush.active)
                return;
            drawing = true;
            const { x, y } = getPos(e);
            lastX = x;
            lastY = y;
            drawStroke(x, y, e.pressure || 1);
            e.target.setPointerCapture(e.pointerId);
        };
        const onMove = (e) => {
            if (!drawing || !brush.active)
                return;
            const { x, y } = getPos(e);
            drawStroke(x, y, e.pressure || 1);
        };
        const onUp = async (e) => {
            if (!drawing || !activeMask)
                return;
            drawing = false;
            e.target.releasePointerCapture(e.pointerId);
            // Capture the brush delta as a small dataUrl patch
            const patchUrl = canvas.toDataURL("image/png");
            // Record as BakeNode for the live tree (tree-sitter walker + vwall ladder ready)
            if (currentHead || activeMask.id) {
                const strokeNode = createBrushStrokeNode(currentHead || activeMask.id, activeMask.id, {
                    points: [],
                    size: brush.size,
                    hardness: brush.hardness,
                    mode: brush.mode,
                });
                // Attach the raster patch — this enables the live incremental bake path
                strokeNode.payload.patchDataUrl = patchUrl;
                strokeNode.payload.screenRect = {
                    x: 0, y: 0, w: canvas.width, h: canvas.height
                };
                appendBakeNode(strokeNode);
                // TODO (next step): composite patchUrl into the real activeMask.dataUrl
                // using offscreen canvas + the patch as source-in/destination-out,
                // then update the segment in store so SAM masks + brush strokes merge.
                // For now the temp canvas + bake node gives live visual + structured history.
            }
            // Clear temp overlay strokes
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            lastX = lastY = 0;
        };
        const el = wrap;
        el.addEventListener("pointerdown", onDown);
        el.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        const ro = new ResizeObserver(resize);
        ro.observe(wrap);
        return () => {
            el.removeEventListener("pointerdown", onDown);
            el.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            ro.disconnect();
        };
    }, [brush.active, brush.size, brush.hardness, brush.mode, activeMask, appendBakeNode, currentHead]);
    if (!brush.active || !activeMask)
        return null;
    return (_jsx("div", { ref: wrapRef, className: "brush-overlay", style: { position: "absolute", inset: 0, pointerEvents: "auto", zIndex: 5 }, children: _jsx("canvas", { ref: canvasRef, style: { width: "100%", height: "100%", touchAction: "none" } }) }));
}
