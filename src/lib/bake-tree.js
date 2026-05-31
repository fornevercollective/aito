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
/** Simple tree walker for incremental evaluation */
export class BakeTreeWalker {
    nodes = new Map();
    constructor(root) {
        if (root)
            this.nodes.set(root.id, root);
    }
    addNode(node) {
        this.nodes.set(node.id, node);
        if (node.parentId) {
            const parent = this.nodes.get(node.parentId);
            if (parent && !parent.children.includes(node.id)) {
                parent.children.push(node.id);
            }
        }
    }
    getNode(id) {
        return this.nodes.get(id);
    }
    /**
     * Walk from a node upward or downward, collecting operations.
     * Used for live incremental bake: only re-composite changed subtrees.
     */
    walkSubtree(rootId, visitor) {
        const root = this.nodes.get(rootId);
        if (!root)
            return;
        const visit = (id, depth) => {
            const n = this.nodes.get(id);
            if (!n)
                return;
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
    evaluateToNode(targetId) {
        const applied = [];
        const maskIds = new Set();
        // Simple upward walk for now (full tree eval later with vwall ladder reuse)
        let current = this.nodes.get(targetId);
        while (current) {
            applied.unshift(current);
            if (current.kind === "mask" || current.kind === "brush-stroke") {
                const p = current.payload;
                if (p.maskId)
                    maskIds.add(p.maskId);
            }
            current = current.parentId ? this.nodes.get(current.parentId) : undefined;
        }
        return {
            appliedNodes: applied,
            effectiveMaskIds: Array.from(maskIds),
        };
    }
    /** Create a new explicit commit node (full bake checkpoint) */
    createCommit(parentId, label) {
        const id = `commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const node = {
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
    collectAncestorIds(id) {
        const ids = [];
        let cur = this.nodes.get(id);
        while (cur) {
            ids.unshift(cur.id);
            cur = cur.parentId ? this.nodes.get(cur.parentId) : undefined;
        }
        return ids;
    }
}
// Factory helpers for common nodes (used by brush, adjustments, etc.)
export function createBrushStrokeNode(parentId, maskId, stroke) {
    return {
        id: `brush-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: "brush-stroke",
        parentId,
        children: [],
        timestamp: Date.now(),
        payload: { maskId, ...stroke },
    };
}
export function createAdjustmentNode(parentId, payload) {
    return {
        id: `adj-${Date.now()}`,
        kind: "adjustment",
        parentId,
        children: [],
        timestamp: Date.now(),
        payload,
    };
}
