/**
 * ContextGatheringPanel — read-only display of context items as they're gathered.
 *
 * Shows during Phase 1 of the two-step plan mode, before the thought map
 * is generated.
 */

import React from "react";
import { Box, Text } from "ink";
import type { UiPalette } from "../theme.js";
import type { ContextItem } from "../../agent/context.js";

interface ContextGatheringPanelProps {
    items: ContextItem[];
    intent: string;
    palette: UiPalette;
    height: number;
}

export function ContextGatheringPanel({
    items,
    intent,
    palette,
    height,
}: ContextGatheringPanelProps) {
    const doneCount = items.filter((i) => i.status === "done").length;
    const allDone = doneCount === items.length;

    return (
        <Box
            flexDirection="column"
            borderStyle="single"
            borderColor={palette.accent}
            paddingX={2}
            paddingY={1}
            height={height}
        >
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold color={palette.accent}>
                    GATHERING CONTEXT
                </Text>
                <Text color={palette.fgDim}>
                    {"  "}({doneCount}/{items.length})
                </Text>
            </Box>

            {/* Intent */}
            <Box marginBottom={1}>
                <Text color={palette.fgDim}>Goal: </Text>
                <Text color={palette.fg} italic>
                    {intent}
                </Text>
            </Box>

            {/* Context items */}
            <Box flexDirection="column" gap={0}>
                {items.map((item) => {
                    const isDone = item.status === "done";
                    const marker = isDone ? "[x]" : "[ ]";
                    const markerColor = isDone ? palette.success : palette.fgDim;
                    const valueTruncated =
                        item.value.length > 60
                            ? item.value.slice(0, 57) + "..."
                            : item.value;

                    return (
                        <Box key={item.label}>
                            <Text color={markerColor}>{marker} </Text>
                            <Text color={isDone ? palette.fg : palette.fgMuted} bold={isDone}>
                                {item.label}
                            </Text>
                            {isDone && item.value && (
                                <Text color={palette.fgDim}>
                                    : {valueTruncated}
                                </Text>
                            )}
                            {!isDone && (
                                <Text color={palette.fgDim} italic>
                                    {" "}gathering...
                                </Text>
                            )}
                        </Box>
                    );
                })}
            </Box>

            {/* Status */}
            <Box marginTop={1}>
                {allDone ? (
                    <Text color={palette.success}>
                        Context gathered. Generating thought map...
                    </Text>
                ) : (
                    <Text color={palette.warning}>
                        Reading repository state...
                    </Text>
                )}
            </Box>
        </Box>
    );
}
