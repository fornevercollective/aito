import { create } from "zustand";
import { DEFAULTS } from "@/effects/presets";
import { BakeTreeWalker } from "@/lib/bake-tree";
let idCounter = 0;
const nextId = () => `layer-${++idCounter}`;
let batchId = 0;
const nextBatchId = () => `batch-${++batchId}`;
export const useApp = create((set) => ({
    before: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1600&q=80&auto=format",
    after: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1600&q=80&auto=format",
    beforeMeta: null,
    afterMeta: null,
    slider: 0.5,
    sliderDragging: false,
    channel: "idle",
    segmentTool: "tap",
    segmentBackend: "sam",
    segments: [],
    activeSegmentId: null,
    segmentBusy: false,
    showStickers: true,
    samReady: false,
    batch: [],
    batchRunning: false,
    adjustments: {
        exposure: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
        tint: 0,
        clarity: 0,
        lutIntensity: 0,
        sharpen: 0,
        vignette: 0,
        customLutUrl: undefined,
        lutPreset: undefined,
    },
    adjustmentScope: {
        useActiveMask: false,
        invert: false,
    },
    brush: {
        active: false,
        size: 48,
        hardness: 0.6,
        mode: "add",
    },
    isTethered: false,
    bakeWalker: new BakeTreeWalker(),
    currentBakeHead: null,
    bakeHistory: [],
    layers: [
        {
            id: nextId(),
            kind: "sampling",
            side: "after",
            enabled: true,
            props: { ...DEFAULTS.sampling, pixel: 1 },
        },
    ],
    ai: {
        progress: 1,
        confidence: 1,
        tilesReady: 1,
        focus: { x: 0.5, y: 0.5 },
        busy: false,
        status: "idle",
    },
    setSources: (b, a, bMeta = null, aMeta = null) => {
        set({
            before: b,
            after: a,
            beforeMeta: bMeta,
            afterMeta: aMeta,
            segments: [],
            activeSegmentId: null,
        });
    },
    loadImage: (target, img) => {
        set(() => {
            const clearSegs = { segments: [], activeSegmentId: null };
            if (target === "before") {
                return { before: img.url, beforeMeta: { width: img.width, height: img.height, name: img.name }, ...clearSegs };
            }
            if (target === "after") {
                return { after: img.url, afterMeta: { width: img.width, height: img.height, name: img.name } };
            }
            // both (typical "open new photo to edit" flow)
            return {
                before: img.url,
                after: img.url,
                beforeMeta: { width: img.width, height: img.height, name: img.name },
                afterMeta: { width: img.width, height: img.height, name: img.name },
                ...clearSegs,
            };
        });
    },
    setSlider: (v) => set({ slider: Math.max(0, Math.min(1, v)) }),
    setSliderDragging: (d) => set({ sliderDragging: d }),
    setChannel: (c) => set({ channel: c }),
    setAi: (patch) => set((s) => ({ ai: { ...s.ai, ...patch } })),
    setSegmentTool: (t) => set({ segmentTool: t }),
    setSegmentBackend: (b) => set({ segmentBackend: b }),
    setSamReady: (v) => set({ samReady: v }),
    setSegmentBusy: (v) => set({ segmentBusy: v }),
    setShowStickers: (v) => set({ showStickers: v }),
    addSegment: (m) => set((s) => ({
        segments: [...s.segments.map((x) => ({ ...x, selected: false })), m],
        activeSegmentId: m.id,
        ai: { ...s.ai, focus: m.centroid, confidence: m.score },
    })),
    setSegments: (masks) => set((s) => ({
        segments: masks,
        activeSegmentId: masks[0]?.id ?? null,
        ai: masks[0]
            ? { ...s.ai, focus: masks[0].centroid, confidence: masks[0].score }
            : s.ai,
    })),
    selectSegment: (id) => set((s) => {
        const seg = s.segments.find((m) => m.id === id);
        return {
            activeSegmentId: id,
            segments: s.segments.map((m) => ({ ...m, selected: m.id === id })),
            ai: seg
                ? { ...s.ai, focus: seg.centroid, confidence: seg.score }
                : s.ai,
        };
    }),
    removeSegment: (id) => set((s) => ({
        segments: s.segments.filter((m) => m.id !== id),
        activeSegmentId: s.activeSegmentId === id ? null : s.activeSegmentId,
    })),
    clearSegments: () => set({ segments: [], activeSegmentId: null }),
    addBatchFiles: (files) => {
        const list = Array.from(files);
        const items = list.map((f) => ({
            id: nextBatchId(),
            name: f.name,
            before: URL.createObjectURL(f),
            status: "queued",
            segments: [],
            progress: 0,
        }));
        set((s) => ({ batch: [...s.batch, ...items] }));
    },
    removeBatchItem: (id) => set((s) => ({ batch: s.batch.filter((b) => b.id !== id) })),
    updateBatchItem: (id, patch) => set((s) => ({
        batch: s.batch.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    })),
    setBatchRunning: (v) => set({ batchRunning: v }),
    addLayer: (kind, side = "after") => {
        const id = nextId();
        const props = { ...DEFAULTS[kind] };
        set((s) => ({
            layers: [...s.layers, { id, kind, side, enabled: true, props }],
        }));
        return id;
    },
    removeLayer: (id) => set((s) => ({ layers: s.layers.filter((l) => l.id !== id) })),
    toggleLayer: (id) => set((s) => ({
        layers: s.layers.map((l) => l.id === id ? { ...l, enabled: !l.enabled } : l),
    })),
    updateLayer: (id, patch) => set((s) => ({
        layers: s.layers.map((l) => l.id === id
            ? { ...l, props: { ...l.props, ...patch } }
            : l),
    })),
    setLayerSide: (id, side) => set((s) => ({
        layers: s.layers.map((l) => (l.id === id ? { ...l, side } : l)),
    })),
    setAdjustment: (key, value) => set((s) => ({
        adjustments: { ...s.adjustments, [key]: value },
    })),
    resetAdjustments: () => set({
        adjustments: {
            exposure: 0,
            contrast: 0,
            saturation: 0,
            temperature: 0,
            tint: 0,
            clarity: 0,
            lutIntensity: 0,
            sharpen: 0,
            vignette: 0,
            customLutUrl: undefined,
            lutPreset: undefined,
        },
    }),
    setAdjustmentScope: (patch) => set((s) => ({
        adjustmentScope: { ...s.adjustmentScope, ...patch },
    })),
    setBrush: (patch) => set((s) => ({
        brush: { ...s.brush, ...patch },
    })),
    toggleBrush: () => set((s) => ({
        brush: { ...s.brush, active: !s.brush.active },
    })),
    setIsTethered: (v) => set({ isTethered: v }),
    // Live bake tree actions (tree-sitter walker + vwall ladder ready)
    appendBakeNode: (node) => set((s) => {
        s.bakeWalker.addNode(node);
        return {
            currentBakeHead: node.id,
            bakeHistory: [...s.bakeHistory, node].slice(-50), // keep recent for rails
        };
    }),
    createBakeCommit: (label) => set((s) => {
        if (!s.currentBakeHead)
            return {};
        const commit = s.bakeWalker.createCommit(s.currentBakeHead, label);
        return {
            currentBakeHead: commit.id,
            bakeHistory: [...s.bakeHistory, commit].slice(-50),
        };
    }),
}));
export const _internal = { nextId, nextBatchId };
