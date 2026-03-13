/**
 * Thought Map types — interactive plan-first TUI data model.
 *
 * A ThoughtMap is a tree of reasoning nodes that the user and LLM
 * co-author. Unlike the flat Step[] in plan/types.ts, these nodes
 * have dependencies, children (sub-nodes), and per-node reasoning.
 */

// ============================================================================
// NODE & MAP TYPES
// ============================================================================

export type ThoughtNodeStatus = "draft" | "maturing" | "mature" | "blocked";

export interface ThoughtMapNode {
    id: string;
    title: string;
    description: string;
    reasoning: string;
    dependencies: string[];
    children: ThoughtMapNode[];
    status: ThoughtNodeStatus;
    depth: number;
    safetyNote?: string;
    command?: string;
}

export interface ThoughtMap {
    id: string;
    intent: string;
    nodes: ThoughtMapNode[];
    createdAt: number;
    lastRefinedAt: number;
    refinementHistory: RefinementEntry[];
}

export interface RefinementEntry {
    nodeId: string;
    prompt: string;
    previousDescription: string;
    timestamp: number;
}

// ============================================================================
// FLAT NODE (for rendering)
// ============================================================================

export interface FlatNode {
    node: ThoughtMapNode;
    indent: number;
    displayPath: string;
    isLast: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

export function findNodeById(
    nodes: ThoughtMapNode[],
    id: string,
): ThoughtMapNode | null {
    for (const node of nodes) {
        if (node.id === id) return node;
        const found = findNodeById(node.children, id);
        if (found) return found;
    }
    return null;
}

export function updateNodeById(
    nodes: ThoughtMapNode[],
    id: string,
    updater: (node: ThoughtMapNode) => ThoughtMapNode,
): ThoughtMapNode[] {
    return nodes.map((node) => {
        if (node.id === id) return updater(node);
        return {
            ...node,
            children: updateNodeById(node.children, id, updater),
        };
    });
}

export function flattenNodes(
    nodes: ThoughtMapNode[],
    indent = 0,
    parentPath = "",
): FlatNode[] {
    const result: FlatNode[] = [];
    nodes.forEach((node, i) => {
        const path = parentPath ? `${parentPath}.${i + 1}` : `${i + 1}`;
        const isLast = i === nodes.length - 1;
        result.push({ node, indent, displayPath: path, isLast });
        if (node.children.length > 0) {
            result.push(
                ...flattenNodes(node.children, indent + 1, path),
            );
        }
    });
    return result;
}

export const STATUS_BADGE: Record<ThoughtNodeStatus, string> = {
    draft: "d",
    maturing: "*",
    mature: "m",
    blocked: "!",
};
