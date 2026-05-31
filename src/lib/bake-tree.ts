/**
 * BakeTree — tree-sitter inspired structured edit history for live, incremental photo bakes.
 *
 * Each node represents an atomic operation in the correction pipeline.
 * A Walker can traverse subtrees to compute incremental composites.
 *
 * Designed to integrate with vwall MediaLadder / Session patterns for
 * efficient variant storage (LOD thumbs, reuse of common bake prefixes).
 *
 * This enables the "live bake path": as you brush/adjust, only deltas are
 * baked into new ladder entries instead of full re-exports every time.
 */

export type BakeNodeKind =
  | "root"
  | "adjustment"
  | "mask"
  | "brush-stroke"
  | "effect-layer"
  | "lut"
  | "commit"; // explicit bake checkpoint

export interface BakeNode {
  id: string;
  kind: BakeNodeKind;
  parentId: string | null;
  children: string[]; // ids for tree walking
  timestamp: number;

  // Operation payload (narrow per kind)
  payload: AdjustmentPayload | MaskPayload | BrushStrokePayload | EffectLayerPayload | LutPayload | CommitPayload | Record<string, unknown>;

  // Result of evaluating this subtree (populated by walker)
  // Uses vwall ladder shape for multi-res variants of the baked result
  bakeResult?: {
    ladder?: MediaLadderRef; // adapted from vwall
    fullUrl?: string;       // current full-res after this node
    thumbUrl?: string;
    meta?: {
      affectedRegion?: { x: number; y: number; w: number; h: number }; // bbox for incremental
      costMs?: number;
      confidence?: number;
    };
  };
}

export interface AdjustmentPayload {
  scope: "global" | "mask";
  maskId?: string;
  invert?: boolean;
  values: Record<string, number>; // exposure, contrast, etc.
}

export interface MaskPayload {
  maskId: string;
  source: "sam" | "brush" | "combined";
  dataUrl: string; // the mask at this point in history
}

export interface BrushStrokePayload {
  maskId: string;
  points: Array<{ x: number; y: number; pressure?: number }>;
  size: number;
  hardness: number;
  mode: "add" | "subtract";
  // raster delta can be computed on demand or stored as small patch
}

export interface EffectLayerPayload {
  layerId: string;
  kind: string;
  props: Record<string, unknown>;
}

export interface LutPayload {
  lutId: string;
  intensity: number;
}

export interface CommitPayload {
  label?: string;
  snapshotOf: string[]; // node ids included in this explicit bake
}

// Adapted minimal MediaLadder ref (full port lives in living-canvas pivot)
export interface MediaLadderRef {
  canonicalKey: string;
  tiers: Array<{
    id: string;
    role: "preview" | "full" | "derivative";
    url: string;
    maxEdge?: number | null;
  }>;
}

/** Simple tree walker for incremental evaluation */
export class BakeTreeWalker {
  private nodes = new Map<string, BakeNode>();

  constructor(root?: BakeNode) {
    if (root) this.nodes.set(root.id, root);
  }

  addNode(node: BakeNode) {
    this.nodes.set(node.id, node);
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent && !parent.children.includes(node.id)) {
        parent.children.push(node.id);
      }
    }
  }

  getNode(id: string) {
    return this.nodes.get(id);
  }

  /**
   * Walk from a node upward or downward, collecting operations.
   * Used for live incremental bake: only re-composite changed subtrees.
   */
  walkSubtree(rootId: string, visitor: (node: BakeNode, depth: number) => void) {
    const root = this.nodes.get(rootId);
    if (!root) return;

    const visit = (id: string, depth: number) => {
      const n = this.nodes.get(id);
      if (!n) return;
      visitor(n, depth);
      n.children.forEach((childId) => visit(childId, depth + 1));
    };
    visit(rootId, 0);
  }

  /**
   * Compute the "live" state at a given node by walking ancestors + subtree.
   * In real impl this would drive offscreen canvas / shader composites
   * using previous ladder entry + delta (brush patch or adjustment uniform).
   */
  evaluateToNode(targetId: string): { appliedNodes: BakeNode[]; effectiveMaskIds: string[] } {
    const applied: BakeNode[] = [];
    const maskIds = new Set<string>();

    // Simple upward walk for now (full tree eval later with vwall ladder reuse)
    let current: BakeNode | undefined = this.nodes.get(targetId);
    while (current) {
      applied.unshift(current);
      if (current.kind === "mask" || current.kind === "brush-stroke") {
        const p = current.payload as any;
        if (p.maskId) maskIds.add(p.maskId);
      }
      current = current.parentId ? this.nodes.get(current.parentId) : undefined;
    }

    return {
      appliedNodes: applied,
      effectiveMaskIds: Array.from(maskIds),
    };
  }

  /** Create a new explicit commit node (full bake checkpoint) */
  createCommit(parentId: string, label?: string): BakeNode {
    const id = `commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const node: BakeNode = {
      id,
      kind: "commit",
      parentId,
      children: [],
      timestamp: Date.now(),
      payload: { label, snapshotOf: this.collectAncestorIds(parentId) },
    };
    this.addNode(node);
    return node;
  }

  private collectAncestorIds(id: string): string[] {
    const ids: string[] = [];
    let cur = this.nodes.get(id);
    while (cur) {
      ids.unshift(cur.id);
      cur = cur.parentId ? this.nodes.get(cur.parentId) : undefined;
    }
    return ids;
  }
}

// Factory helpers for common nodes (used by brush, adjustments, etc.)
export function createBrushStrokeNode(
  parentId: string,
  maskId: string,
  stroke: Omit<BrushStrokePayload, "maskId">
): BakeNode {
  return {
    id: `brush-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "brush-stroke",
    parentId,
    children: [],
    timestamp: Date.now(),
    payload: { maskId, ...stroke },
  };
}

export function createAdjustmentNode(
  parentId: string,
  payload: AdjustmentPayload
): BakeNode {
  return {
    id: `adj-${Date.now()}`,
    kind: "adjustment",
    parentId,
    children: [],
    timestamp: Date.now(),
    payload,
  };
}
