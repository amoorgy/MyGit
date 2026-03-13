import type { ThoughtMapNode } from "./types.js";
import { STATUS_BADGE } from "./types.js";

export const ASCII_CARD_MIN_WIDTH = 34;

export interface AsciiNodeCardInput {
    width: number;
    indent: number;
    path: string;
    title: string;
    badge: string;
    isSelected: boolean;
}

export function shouldUseAsciiCards(width: number): boolean {
    return width >= ASCII_CARD_MIN_WIDTH;
}

export function renderAsciiNodeCard(input: AsciiNodeCardInput): [string, string, string] {
    const treePad = "  ".repeat(Math.max(0, input.indent));
    const marker = input.isSelected ? ">" : " ";
    const linePrefixTop = `${marker}${treePad}`;
    const linePrefixBody = ` ${treePad}`;

    // width is the pane width; reserve prefix space and the box side chars
    const boxInnerWidth = Math.max(8, input.width - Math.max(linePrefixTop.length, linePrefixBody.length) - 2);
    const label = `${input.path}. ${input.title} [${input.badge}]`;
    const content = truncateText(label, boxInnerWidth);

    return [
        `${linePrefixTop}+${"-".repeat(boxInnerWidth)}+`,
        `${linePrefixBody}|${content.padEnd(boxInnerWidth, " ")}|`,
        `${linePrefixBody}+${"-".repeat(boxInnerWidth)}+`,
    ];
}

export function renderAsciiInlineBox(text: string, width: number): [string, string, string] {
    const boxInnerWidth = Math.max(8, width - 2);
    const content = truncateText(text, boxInnerWidth);
    return [
        `+${"-".repeat(boxInnerWidth)}+`,
        `|${content.padEnd(boxInnerWidth, " ")}|`,
        `+${"-".repeat(boxInnerWidth)}+`,
    ];
}

function truncateText(value: string, width: number): string {
    if (value.length <= width) return value;
    if (width <= 1) return value.slice(0, width);
    return value.slice(0, Math.max(0, width - 1)) + "…";
}

// ============================================================================
// DAG LAYOUT ENGINE
// ============================================================================

/**
 * Flatten all nodes (including nested children) into a single list.
 * Children without explicit dependencies are implicitly dependent on parent.
 */
export function flattenAllNodes(nodes: ThoughtMapNode[]): ThoughtMapNode[] {
    const result: ThoughtMapNode[] = [];
    function walk(list: ThoughtMapNode[], parentId?: string) {
        for (const node of list) {
            const flattened: ThoughtMapNode = {
                ...node,
                children: [], // flatten removes nesting
                dependencies:
                    node.dependencies.length === 0 && parentId
                        ? [parentId]
                        : [...node.dependencies],
            };
            result.push(flattened);
            if (node.children.length > 0) {
                walk(node.children, node.id);
            }
        }
    }
    walk(nodes);
    return result;
}

/**
 * Topological sort: returns layers of node IDs.
 * Layer 0 = nodes with no dependencies, layer 1 = deps all in layer 0, etc.
 */
export function topologicalSort(nodes: ThoughtMapNode[]): string[][] {
    const allIds = new Set(nodes.map((n) => n.id));
    const layers: string[][] = [];
    const assigned = new Set<string>();

    for (let safety = 0; safety < nodes.length + 1; safety++) {
        const layer: string[] = [];
        for (const node of nodes) {
            if (assigned.has(node.id)) continue;
            // All deps must be assigned (or not in our node set)
            const depsResolved = node.dependencies.every(
                (d) => assigned.has(d) || !allIds.has(d),
            );
            if (depsResolved) layer.push(node.id);
        }
        if (layer.length === 0) break;
        layers.push(layer);
        for (const id of layer) assigned.add(id);
    }

    // Add any unassigned (cyclic) nodes to a final layer
    const remaining = nodes.filter((n) => !assigned.has(n.id)).map((n) => n.id);
    if (remaining.length > 0) layers.push(remaining);

    return layers;
}

/**
 * Navigation order: flatten layers left-to-right, top-to-bottom.
 */
export function dagNavigationOrder(layers: string[][]): string[] {
    return layers.flat();
}

// ============================================================================
// DAG ASCII RENDERER
// ============================================================================

export interface DagRenderResult {
    lines: string[];
    /** Maps node ID → the line index of the node's label row */
    nodeLineMap: Map<string, number>;
}

interface NodeLayout {
    id: string;
    label: string;
    col: number;      // center column position
    boxStart: number;  // left edge of box
    boxEnd: number;    // right edge of box (exclusive)
}

/**
 * Render a DAG as ASCII text lines with box-drawing arrows.
 */
export function renderDagAscii(
    allNodes: ThoughtMapNode[],
    layers: string[][],
    width: number,
    selectedId: string | null,
): DagRenderResult {
    if (layers.length === 0 || allNodes.length === 0) {
        return { lines: ["  (empty)"], nodeLineMap: new Map() };
    }

    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
    const maxBoxWidth = Math.max(12, Math.min(30, Math.floor(width * 0.8)));
    const lines: string[] = [];
    const nodeLineMap = new Map<string, number>();

    // Lay out each layer
    const layerLayouts: NodeLayout[][] = [];

    for (const layerIds of layers) {
        const layouts: NodeLayout[] = [];
        const count = layerIds.length;
        const slotWidth = Math.max(maxBoxWidth + 2, Math.floor(width / Math.max(1, count)));

        for (let i = 0; i < count; i++) {
            const id = layerIds[i];
            const node = nodeMap.get(id);
            const badge = node ? STATUS_BADGE[node.status] : "?";
            const sel = id === selectedId ? ">" : " ";
            const rawTitle = node?.title ?? id;
            const maxLabel = Math.max(6, slotWidth - 6);
            const title = truncateText(rawTitle, maxLabel);
            const label = `${sel}[${title}] [${badge}]`;

            const center = Math.floor(slotWidth * i + slotWidth / 2);
            const halfLen = Math.floor(label.length / 2);
            const boxStart = Math.max(0, center - halfLen);
            const boxEnd = boxStart + label.length;

            layouts.push({ id, label, col: center, boxStart, boxEnd });
        }
        layerLayouts.push(layouts);
    }

    // Render layers with connectors between them
    for (let li = 0; li < layerLayouts.length; li++) {
        const layout = layerLayouts[li];

        // Render node labels for this layer
        const labelLine = buildLine(width, layout.map((l) => ({ start: l.boxStart, text: l.label })));
        nodeLineMap.set(layout[0].id, lines.length);
        for (const l of layout) {
            nodeLineMap.set(l.id, lines.length);
        }
        lines.push(labelLine);

        // Draw connectors to next layer
        if (li < layerLayouts.length - 1) {
            const nextLayout = layerLayouts[li + 1];
            const nextIds = new Set(nextLayout.map((l) => l.id));

            // Collect edges: from this layer to next layer
            const edges: { fromCol: number; toCol: number }[] = [];
            for (const nextL of nextLayout) {
                const nextNode = nodeMap.get(nextL.id);
                if (!nextNode) continue;
                for (const depId of nextNode.dependencies) {
                    const fromL = layout.find((l) => l.id === depId);
                    if (fromL) {
                        edges.push({ fromCol: fromL.col, toCol: nextL.col });
                    }
                }
                // If no edges found for this node (deps in earlier layers or none),
                // check if any dep is in a previous layer — draw straight down from
                // the closest ancestor in this layer, or skip
                if (!nextNode.dependencies.some((d) => layout.some((l) => l.id === d))) {
                    // No direct parent in this layer — just draw a straight line down
                    edges.push({ fromCol: nextL.col, toCol: nextL.col });
                }
            }

            if (edges.length > 0) {
                renderConnectors(lines, edges, width);
            }
        }
    }

    return { lines, nodeLineMap };
}

/**
 * Build a line of text by placing text fragments at specific positions.
 */
function buildLine(width: number, fragments: { start: number; text: string }[]): string {
    const chars = new Array(width).fill(" ");
    for (const frag of fragments) {
        for (let i = 0; i < frag.text.length && frag.start + i < width; i++) {
            chars[frag.start + i] = frag.text[i];
        }
    }
    return chars.join("");
}

/**
 * Render connector lines between two layers of nodes.
 */
function renderConnectors(
    lines: string[],
    edges: { fromCol: number; toCol: number }[],
    width: number,
): void {
    // Line 1: vertical pipes down from sources
    const sourceCols = new Set(edges.map((e) => e.fromCol));
    const pipe1 = new Array(width).fill(" ");
    for (const col of sourceCols) {
        if (col >= 0 && col < width) pipe1[col] = "│";
    }
    lines.push(pipe1.join(""));

    // Check if we need horizontal routing (fan-out or fan-in)
    const needsRouting = edges.some((e) => e.fromCol !== e.toCol);

    if (needsRouting) {
        // Line 2: horizontal routing with connectors
        const routeLine = new Array(width).fill(" ");

        for (const edge of edges) {
            const minCol = Math.min(edge.fromCol, edge.toCol);
            const maxCol = Math.max(edge.fromCol, edge.toCol);

            // Draw horizontal line
            for (let c = minCol; c <= maxCol && c < width; c++) {
                if (routeLine[c] === " ") {
                    routeLine[c] = "─";
                } else if (routeLine[c] === "│") {
                    routeLine[c] = "┼";
                }
            }
        }

        // Place proper junction characters at source and target positions
        for (const edge of edges) {
            if (edge.fromCol >= 0 && edge.fromCol < width) {
                const cur = routeLine[edge.fromCol];
                if (cur === "─" || cur === "┼") {
                    // Determine if this is a left or right junction
                    const hasLeft = edges.some(
                        (e) => Math.min(e.fromCol, e.toCol) < edge.fromCol &&
                               Math.max(e.fromCol, e.toCol) >= edge.fromCol,
                    );
                    const hasRight = edges.some(
                        (e) => Math.max(e.fromCol, e.toCol) > edge.fromCol &&
                               Math.min(e.fromCol, e.toCol) <= edge.fromCol,
                    );
                    if (hasLeft && hasRight) routeLine[edge.fromCol] = "┴";
                    else if (hasLeft) routeLine[edge.fromCol] = "┘";
                    else if (hasRight) routeLine[edge.fromCol] = "└";
                    else routeLine[edge.fromCol] = "│";
                }
            }
        }

        // Place junction chars at target positions
        const targetCols = new Set(edges.map((e) => e.toCol));
        for (const col of targetCols) {
            if (col >= 0 && col < width) {
                const edgesToHere = edges.filter((e) => e.toCol === col);
                const hasLeft = edgesToHere.some((e) => e.fromCol < col);
                const hasRight = edgesToHere.some((e) => e.fromCol > col);
                const hasStraight = edgesToHere.some((e) => e.fromCol === col);

                if (hasLeft && hasRight) routeLine[col] = "┬";
                else if (hasLeft && hasStraight) routeLine[col] = "┬";
                else if (hasRight && hasStraight) routeLine[col] = "┬";
                else if (hasLeft) routeLine[col] = "┐";
                else if (hasRight) routeLine[col] = "┌";
                else routeLine[col] = "│";
            }
        }

        lines.push(routeLine.join(""));
    }

    // Final line: arrow heads at target positions
    const targetCols = new Set(edges.map((e) => e.toCol));
    const arrowLine = new Array(width).fill(" ");
    for (const col of targetCols) {
        if (col >= 0 && col < width) arrowLine[col] = "▼";
    }
    lines.push(arrowLine.join(""));
}
