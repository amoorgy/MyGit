/**
 * ThoughtMapPanel — interactive two-pane thought map display.
 *
 * Left pane: navigable tree of nodes with status badges.
 * Right pane: selected node detail (title, description, reasoning, deps).
 *
 * The main InputBox remains visible below — typing + Enter refines
 * the currently selected node.
 */

import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { UiPalette } from "../theme.js";
import type { ThoughtMap, FlatNode } from "../thoughtMap/types.js";
import { flattenNodes, STATUS_BADGE } from "../thoughtMap/types.js";
import { renderAsciiInlineBox, renderAsciiNodeCard, shouldUseAsciiCards } from "../thoughtMap/render.js";

// ============================================================================
// PROPS
// ============================================================================

interface ThoughtMapPanelProps {
    map: ThoughtMap;
    selectedNodeId: string | null;
    onSelectNode: (nodeId: string) => void;
    isRefining: boolean;
    palette: UiPalette;
    height: number;
    width: number;
    onClose: () => void;
    renderStyle?: "classic" | "ascii_cards";
}

// ============================================================================
// STATUS COLORS
// ============================================================================

function statusColor(status: string, palette: UiPalette): string {
    switch (status) {
        case "mature":
            return palette.success;
        case "maturing":
            return palette.warning;
        case "blocked":
            return palette.error;
        default:
            return palette.fgDim;
    }
}

// ============================================================================
// TREE CONNECTOR CHARS
// ============================================================================

function treePrefix(flat: FlatNode, indent: number): string {
    if (indent === 0) return "";
    const connector = flat.isLast ? "╰─ " : "├─ ";
    const padding = "  ".repeat(indent - 1);
    return padding + connector;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ThoughtMapPanel({
    map,
    selectedNodeId,
    onSelectNode,
    isRefining,
    palette,
    height,
    width,
    renderStyle = "ascii_cards",
}: ThoughtMapPanelProps) {
    const flatNodes = useMemo(() => flattenNodes(map.nodes), [map.nodes]);

    const selectedIdx = flatNodes.findIndex(
        (f) => f.node.id === selectedNodeId,
    );
    const selected = selectedIdx >= 0 ? flatNodes[selectedIdx] : null;

    useInput((input, key) => {
        if (key.upArrow && flatNodes.length > 0) {
            const newIdx = Math.max(0, selectedIdx - 1);
            onSelectNode(flatNodes[newIdx].node.id);
        } else if (key.downArrow && flatNodes.length > 0) {
            const newIdx = Math.min(flatNodes.length - 1, selectedIdx + 1);
            onSelectNode(flatNodes[newIdx].node.id);
        }
    });

    const leftWidth = Math.max(20, Math.floor(width * 0.4));
    const rightWidth = Math.max(20, width - leftWidth - 3); // 3 for divider + padding
    const contentHeight = Math.max(1, height - 4); // header + footer
    const useAsciiCards = renderStyle === "ascii_cards" && shouldUseAsciiCards(leftWidth);
    const rowsPerNode = useAsciiCards ? 3 : 1;

    // Scrolling for the left pane
    const maxVisible = Math.max(1, Math.floor(contentHeight / rowsPerNode));
    let scrollStart = 0;
    if (selectedIdx >= 0 && flatNodes.length > maxVisible) {
        scrollStart = Math.max(
            0,
            Math.min(selectedIdx - Math.floor(maxVisible / 2), flatNodes.length - maxVisible),
        );
    }
    const visibleNodes = flatNodes.slice(scrollStart, scrollStart + maxVisible);

    return (
        <Box
            flexDirection="column"
            borderStyle="single"
            borderColor={palette.accent}
            paddingX={1}
            height={height}
        >
            {/* Header */}
            <Box justifyContent="space-between" marginBottom={1}>
                <Text bold color={palette.accent}>
                    THOUGHT MAP
                </Text>
                <Box gap={1}>
                    {isRefining && (
                        <Text color={palette.warning}>refining...</Text>
                    )}
                    <Text color={palette.fgDim}>
                        ↑↓ navigate • type to refine • Esc back
                    </Text>
                </Box>
            </Box>

            {/* Two-pane content */}
            <Box flexDirection="row" flexGrow={1}>
                {/* Left pane: node tree */}
                <Box
                    flexDirection="column"
                    width={leftWidth}
                    borderStyle="single"
                    borderColor={palette.border}
                    paddingX={1}
                >
                    {flatNodes.length === 0 ? (
                        <Text color={palette.fgMuted} italic>
                            No nodes yet
                        </Text>
                    ) : (
                        visibleNodes.map((flat) => {
                            const isSelected = flat.node.id === selectedNodeId;
                            const prefix = treePrefix(flat, flat.indent);
                            const badge = STATUS_BADGE[flat.node.status];
                            const badgeColor = statusColor(flat.node.status, palette);

                            if (!useAsciiCards) {
                                return (
                                    <Text key={flat.node.id} wrap="truncate">
                                        <Text color={isSelected ? palette.accent : palette.fg}>
                                            {isSelected ? "▸ " : "  "}
                                        </Text>
                                        <Text color={palette.fgDim}>{prefix}</Text>
                                        <Text
                                            color={isSelected ? palette.accent : palette.fg}
                                            bold={isSelected}
                                        >
                                            {flat.displayPath}. {flat.node.title}
                                        </Text>
                                        <Text color={badgeColor}>{" "}[{badge}]</Text>
                                    </Text>
                                );
                            }

                            const lines = renderAsciiNodeCard({
                                width: Math.max(12, leftWidth - 2),
                                indent: flat.indent,
                                path: flat.displayPath,
                                title: flat.node.title,
                                badge,
                                isSelected,
                            });

                            return (
                                <Box key={flat.node.id} flexDirection="column">
                                    <Text color={isSelected ? palette.accent : palette.border} wrap="truncate-end">
                                        {lines[0]}
                                    </Text>
                                    <Text color={isSelected ? palette.accent : palette.fgDim} wrap="truncate-end">
                                        {lines[1]}
                                    </Text>
                                    <Text color={isSelected ? palette.accent : palette.border} wrap="truncate-end">
                                        {lines[2]}
                                    </Text>
                                </Box>
                            );
                        })
                    )}
                    {flatNodes.length > maxVisible && (
                        <Text color={palette.fgMuted} dimColor>
                            {scrollStart > 0 ? "↑ " : "  "}
                            {scrollStart + maxVisible < flatNodes.length ? " ↓" : ""}
                        </Text>
                    )}
                </Box>

                {/* Right pane: node detail */}
                <Box
                    flexDirection="column"
                    flexGrow={1}
                    paddingX={2}
                >
                    {selected ? (
                        <NodeDetail
                            node={selected.node}
                            path={selected.displayPath}
                            palette={palette}
                            width={rightWidth}
                        />
                    ) : (
                        <Text color={palette.fgMuted} italic>
                            Select a node to view details
                        </Text>
                    )}
                </Box>
            </Box>

            {/* Footer: intent */}
            <Box marginTop={1}>
                <Text color={palette.fgMuted}>
                    Intent: {map.intent}
                </Text>
                {map.refinementHistory.length > 0 && (
                    <Text color={palette.fgDim}>
                        {"  "}({map.refinementHistory.length} refinement{map.refinementHistory.length !== 1 ? "s" : ""})
                    </Text>
                )}
            </Box>
        </Box>
    );
}

// ============================================================================
// NODE DETAIL SUB-COMPONENT
// ============================================================================

import type { ThoughtMapNode } from "../thoughtMap/types.js";

function NodeDetail({
    node,
    path,
    palette,
    width,
}: {
    node: ThoughtMapNode;
    path: string;
    palette: UiPalette;
    width: number;
}) {
    const badgeColor = statusColor(node.status, palette);
    const headerBox = renderAsciiInlineBox(`${path}. ${node.title} [${node.status}]`, Math.max(18, width - 2));

    return (
        <Box flexDirection="column" gap={1}>
            {/* Title */}
            <Box flexDirection="column">
                <Text color={palette.accent}>{headerBox[0]}</Text>
                <Text color={palette.accent} bold>{headerBox[1]}</Text>
                <Text color={palette.accent}>{headerBox[2]}</Text>
                <Text color={badgeColor}>status: {node.status}</Text>
            </Box>

            {/* Description */}
            {node.description && (
                <Box flexDirection="column">
                    <Text color={palette.fgDim} bold>DESCRIPTION</Text>
                    <Text color={palette.fg} wrap="wrap">
                        {node.description}
                    </Text>
                </Box>
            )}

            {/* Reasoning */}
            {node.reasoning && (
                <Box flexDirection="column">
                    <Text color={palette.fgDim} bold>REASONING</Text>
                    <Text color={palette.fgMuted} italic wrap="wrap">
                        {node.reasoning}
                    </Text>
                </Box>
            )}

            {/* Dependencies */}
            {node.dependencies.length > 0 && (
                <Box>
                    <Text color={palette.fgDim} bold>DEPENDS ON: </Text>
                    <Text color={palette.info}>
                        {node.dependencies.join(", ")}
                    </Text>
                </Box>
            )}

            {/* Command */}
            {node.command && (
                <Box flexDirection="column">
                    <Text color={palette.fgDim} bold>COMMAND</Text>
                    {(() => {
                        const cmdBox = renderAsciiInlineBox(node.command, Math.max(18, width - 2));
                        return (
                            <Box flexDirection="column">
                                <Text color={palette.border}>{cmdBox[0]}</Text>
                                <Text color={palette.fg}>{cmdBox[1]}</Text>
                                <Text color={palette.border}>{cmdBox[2]}</Text>
                            </Box>
                        );
                    })()}
                </Box>
            )}

            {/* Safety note */}
            {node.safetyNote && (
                <Box>
                    <Text color={palette.warning} bold>⚠ </Text>
                    <Text color={palette.warning}>{node.safetyNote}</Text>
                </Box>
            )}

            {/* Children count */}
            {node.children.length > 0 && (
                <Text color={palette.fgDim}>
                    {node.children.length} sub-node{node.children.length !== 1 ? "s" : ""}
                </Text>
            )}
        </Box>
    );
}
