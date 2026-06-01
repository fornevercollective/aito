import { create } from "zustand";
import type {
  ActiveLayer,
  EffectKind,
  EffectPropsByKind,
  EffectSide,
} from "@/effects/types";
import { DEFAULTS } from "@/effects/presets";
import type {
  BatchItem,
  SegmentBackend,
  SegmentMask,
  SegmentTool,
} from "@/segmentation/types";
import type { LoadedImage } from "@/lib/image";
import { BakeTreeWalker, type BakeNode } from "@/lib/bake-tree";
import type { ExifData } from "@/lib/exif";

export interface AiSignals {
  progress: number;
  confidence: number;
  tilesReady: number;
  focus: { x: number; y: number };
  busy: boolean;
  status: string;
}

export interface ImageMeta {
  width: number;
  height: number;
  name?: string;
}

export interface Reference {
  id: string;
  url: string;           // data URL or blob URL
  label: string;         // "Hero Product", "Talent Ref", "Mood Board", "Location", "Doodle", etc.
  source: 'upload' | 'canvas' | 'tether' | 'doodle';
  thumbnail?: string;    // smaller version if needed
}

export interface AppState {
  before: string;
  after: string;
  beforeMeta: ImageMeta | null;
  afterMeta: ImageMeta | null;
  slider: number;
  sliderDragging: boolean;
  layers: ActiveLayer[];
  ai: AiSignals;
  channel: "idle" | "connecting" | "live" | "mock" | "error";

  /** Active interaction tool on the stage. */
  segmentTool: SegmentTool;
  segmentBackend: SegmentBackend;
  /** Masks for the current before image. */
  segments: SegmentMask[];
  activeSegmentId: string | null;
  segmentBusy: boolean;
  showStickers: boolean;
  samReady: boolean;

  /** Batch auto-mask + retouch queue. */
  batch: BatchItem[];
  batchRunning: boolean;

  /** Global photo corrections. Applied to the "after" base. */
  adjustments: {
    exposure: number;   // -2 .. +2
    contrast: number;   // -1 .. +1
    saturation: number; // -1 .. +1
    temperature: number; // -1 (cool) .. +1 (warm)
    tint: number;       // -1 (green) .. +1 (magenta)
    clarity: number;    // -1 .. +1 (local contrast approx)
    lutIntensity: number; // 0..1 for LUT strength (AI + film emulation ready)
    sharpen: number;      // 0..2
    vignette: number;     // -1..1
    // Extra non-numeric fields for LUT system (stored here for simplicity in this iteration)
    lutPreset?: string;
    customLutUrl?: string;
  };

  /** How the adjustments are scoped (core of masked corrections). */
  adjustmentScope: {
    useActiveMask: boolean; // when true + activeSegment exists → corrections are masked
    invert: boolean;        // invert the mask (apply to background instead of subject)
  };

  /** Brush tool state for mask refinement (Apple-style corrections). */
  brush: {
    active: boolean;
    size: number;      // px radius (screen space, will be scaled)
    hardness: number;  // 0..1 (softness of falloff)
    mode: "add" | "subtract";
  };

  /** Whether we're currently receiving live preview from a local tethered device (camera, etc.) */
  isTethered: boolean;

  /** Parsed EXIF for the current image (works for file loads + tethered frames that include it) */
  exif: ExifData | null;

  /** Tether metadata (what camera the companion is talking to) */
  tetherCamera: string | null;

  /** Live bake tree (tree-sitter style + vwall ladder integration). */
  bakeWalker: BakeTreeWalker;
  currentBakeHead: string | null; // id of the tip of the live bake tree
  bakeHistory: BakeNode[]; // flattened recent commits for UI rails

  /** Reference boards for commercial work (like Krea realtime refs) */
  references: Reference[];
  activeReferenceIds: string[]; // which refs are currently "active" for Grok / generation

  /** UI controls */
  showInspector: boolean;           // right panel (tether + exif + references) collapsed state
  sliderAutoAnimation: boolean;     // whether AI signals drive the before/after slider animation

  setSources(b: string, a: string, bMeta?: ImageMeta | null, aMeta?: ImageMeta | null): void;
  loadImage(target: "before" | "after" | "both", img: LoadedImage): void;
  setSlider(v: number): void;
  setSliderDragging(d: boolean): void;
  setChannel(c: AppState["channel"]): void;
  setAi(patch: Partial<AiSignals>): void;

  setSegmentTool(t: SegmentTool): void;
  setSegmentBackend(b: SegmentBackend): void;
  setSamReady(v: boolean): void;
  setSegmentBusy(v: boolean): void;
  setShowStickers(v: boolean): void;
  addSegment(m: SegmentMask): void;
  setSegments(masks: SegmentMask[]): void;
  selectSegment(id: string | null): void;
  removeSegment(id: string): void;
  clearSegments(): void;

  addBatchFiles(files: FileList | File[]): void;
  removeBatchItem(id: string): void;
  updateBatchItem(id: string, patch: Partial<BatchItem>): void;
  setBatchRunning(v: boolean): void;

  setAdjustment<K extends keyof AppState["adjustments"]>(key: K, value: number): void;
  resetAdjustments(): void;

  setIsTethered(v: boolean): void;
  setExif(exif: ExifData | null): void;
  setTetherCamera(model: string | null): void;

  // Reference Board actions (Krea-style realtime refs for commercial)
  addReference(ref: Omit<Reference, 'id'>): string;
  removeReference(id: string): void;
  toggleActiveReference(id: string): void;
  clearReferences(): void;
  setActiveReferences(ids: string[]): void;

  setAdjustmentScope(patch: Partial<AppState["adjustmentScope"]>): void;

  setBrush(patch: Partial<AppState["brush"]>): void;
  toggleBrush(): void;

  appendBakeNode(node: import("@/lib/bake-tree").BakeNode): void;
  createBakeCommit(label?: string): void;

  addLayer<K extends EffectKind>(kind: K, side?: EffectSide): string;
  removeLayer(id: string): void;
  toggleLayer(id: string): void;
  updateLayer<K extends EffectKind>(
    id: string,
    patch: Partial<EffectPropsByKind[K]>,
  ): void;
  setLayerSide(id: string, side: EffectSide): void;
}

let idCounter = 0;
const nextId = () => `layer-${++idCounter}`;
let batchId = 0;
const nextBatchId = () => `batch-${++batchId}`;

export const useApp = create<AppState>((set) => ({
  before:
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1600&q=80&auto=format",
  after:
    "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1600&q=80&auto=format",
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
  exif: null,
  tetherCamera: null,
  references: [],
  activeReferenceIds: [],
  showInspector: true,
  sliderAutoAnimation: true,
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
      const clearSegs = { segments: [], activeSegmentId: null as string | null };
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
        slider: 0.5,
        ai: {
          progress: 0,
          confidence: 0,
          tilesReady: 0,
          focus: { x: 0.5, y: 0.5 },
          busy: false,
          status: "idle",
        },
        // Reset pixel effect and other layers to neutral for the new image
        layers: [
          {
            id: nextId(),
            kind: "sampling",
            side: "after",
            enabled: true,
            props: { ...DEFAULTS.sampling, pixel: 1 },
          },
        ],
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
  addSegment: (m) =>
    set((s) => ({
      segments: [...s.segments.map((x) => ({ ...x, selected: false })), m],
      activeSegmentId: m.id,
      ai: { ...s.ai, focus: m.centroid, confidence: m.score },
    })),
  setSegments: (masks) =>
    set((s) => ({
      segments: masks,
      activeSegmentId: masks[0]?.id ?? null,
      ai: masks[0]
        ? { ...s.ai, focus: masks[0].centroid, confidence: masks[0].score }
        : s.ai,
    })),
  selectSegment: (id) =>
    set((s) => {
      const seg = s.segments.find((m) => m.id === id);
      return {
        activeSegmentId: id,
        segments: s.segments.map((m) => ({ ...m, selected: m.id === id })),
        ai: seg
          ? { ...s.ai, focus: seg.centroid, confidence: seg.score }
          : s.ai,
      };
    }),
  removeSegment: (id) =>
    set((s) => ({
      segments: s.segments.filter((m) => m.id !== id),
      activeSegmentId: s.activeSegmentId === id ? null : s.activeSegmentId,
    })),
  clearSegments: () => set({ segments: [], activeSegmentId: null }),

  addBatchFiles: (files) => {
    const list = Array.from(files as File[]);
    const items: BatchItem[] = list.map((f) => ({
      id: nextBatchId(),
      name: f.name,
      before: URL.createObjectURL(f),
      status: "queued",
      segments: [],
      progress: 0,
    }));
    set((s) => ({ batch: [...s.batch, ...items] }));
  },
  removeBatchItem: (id) =>
    set((s) => ({ batch: s.batch.filter((b) => b.id !== id) })),
  updateBatchItem: (id, patch) =>
    set((s) => ({
      batch: s.batch.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    })),
  setBatchRunning: (v) => set({ batchRunning: v }),

  addLayer: (kind, side = "after") => {
    const id = nextId();
    const props = { ...DEFAULTS[kind] } as ActiveLayer["props"];
    set((s) => ({
      layers: [...s.layers, { id, kind, side, enabled: true, props }],
    }));
    return id;
  },
  removeLayer: (id) =>
    set((s) => ({ layers: s.layers.filter((l) => l.id !== id) })),
  toggleLayer: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, enabled: !l.enabled } : l,
      ),
    })),
  updateLayer: (id, patch) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id
          ? ({ ...l, props: { ...l.props, ...patch } } as ActiveLayer)
          : l,
      ),
    })),
  setLayerSide: (id, side) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, side } : l)),
    })),

  setAdjustment: (key, value) =>
    set((s) => ({
      adjustments: { ...s.adjustments, [key]: value },
    })),
  resetAdjustments: () =>
    set({
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

  setAdjustmentScope: (patch) =>
    set((s) => ({
      adjustmentScope: { ...s.adjustmentScope, ...patch },
    })),

  setBrush: (patch) =>
    set((s) => ({
      brush: { ...s.brush, ...patch },
    })),
  toggleBrush: () =>
    set((s) => ({
      brush: { ...s.brush, active: !s.brush.active },
    })),

  setIsTethered: (v: boolean) => set({ isTethered: v }),
  setExif: (exif) => set({ exif }),
  setTetherCamera: (model) => set({ tetherCamera: model }),

  // Reference Board implementation
  addReference: (ref) => {
    const id = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newRef: Reference = { ...ref, id };
    set((s) => ({
      references: [...s.references, newRef],
      activeReferenceIds: [...s.activeReferenceIds, id]
    }));
    return id;
  },
  removeReference: (id) => set((s) => ({
    references: s.references.filter(r => r.id !== id),
    activeReferenceIds: s.activeReferenceIds.filter(rid => rid !== id)
  })),
  toggleActiveReference: (id) => set((s) => ({
    activeReferenceIds: s.activeReferenceIds.includes(id)
      ? s.activeReferenceIds.filter(rid => rid !== id)
      : [...s.activeReferenceIds, id]
  })),
  clearReferences: () => set({ references: [], activeReferenceIds: [] }),
  setActiveReferences: (ids) => set({ activeReferenceIds: ids }),

  // Live bake tree actions (tree-sitter walker + vwall ladder ready)
  appendBakeNode: (node: BakeNode) =>
    set((s) => {
      s.bakeWalker.addNode(node);
      return {
        currentBakeHead: node.id,
        bakeHistory: [...s.bakeHistory, node].slice(-50), // keep recent for rails
      };
    }),
  createBakeCommit: (label?: string) =>
    set((s) => {
      if (!s.currentBakeHead) return {};
      const commit = s.bakeWalker.createCommit(s.currentBakeHead, label);
      return {
        currentBakeHead: commit.id,
        bakeHistory: [...s.bakeHistory, commit].slice(-50),
      };
    }),
}));

export const _internal = { nextId, nextBatchId };
