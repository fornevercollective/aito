/** A single segmented region (SAM mask or server-returned mask). */
export interface SegmentMask {
  id: string;
  label?: string;
  /** RGBA PNG data URL; alpha = mask. */
  dataUrl: string;
  /** Normalized bounding box in image UV space. */
  bbox: { x: number; y: number; w: number; h: number };
  centroid: { x: number; y: number };
  /** IoU / model confidence when available. */
  score: number;
  selected: boolean;
  /** Sticker lift: cutout preview with outline. */
  stickerUrl?: string;
}

export type SegmentBackend = "sam" | "mock" | "server";

export type SegmentTool = "slider" | "tap" | "auto";

export type BatchItemStatus =
  | "queued"
  | "segmenting"
  | "retouching"
  | "done"
  | "error";

export interface BatchItem {
  id: string;
  name: string;
  before: string;
  after?: string;
  status: BatchItemStatus;
  segments: SegmentMask[];
  progress: number;
  error?: string;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}
