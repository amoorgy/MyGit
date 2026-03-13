/**
 * ChatArea — row-virtualized chat viewport with row-based scrolling.
 * Long tool/list output is represented as deterministic one-row lines.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { UiPalette } from "../theme.js";
import { useScrollEvents } from "../hooks/useScrollEvents.js";
import type { ScrollEvent } from "../stdinFilter.js";
import {
    applyScrollDelta,
    buildChatRows,
    clampOffset,
    computeResizePreservedOffset,
    computeScrollbarThumb,
    computeViewportWindow,
    getPageJump,
    type ChatRow,
    type ChatRowTone,
} from "./chatLayout.js";

// ============================================================================
// TYPES
// ============================================================================

export type MessageRole = "user" | "agent" | "system" | "action" | "thinking" | "tool";
export type ChatMessageTone = "normal" | "muted" | "dim" | "accent" | "error" | "info";

export interface ChatTextSegment {
    text: string;
    tone?: ChatMessageTone;
    bold?: boolean;
    italic?: boolean;
    dimColor?: boolean;
}

export interface ChatRichRow {
    text?: string;
    segments?: ChatTextSegment[];
    tone?: ChatMessageTone;
    bold?: boolean;
    italic?: boolean;
    dimColor?: boolean;
}

export interface ToolData {
    toolType: string;
    label?: string;
    reasoning: string;
    output: string | null;
    success: boolean | null;
}

export interface ChatMessage {
    role: MessageRole;
    content: string;
    timestamp: number;
    toolData?: ToolData;
    richRows?: ChatRichRow[];
}

// ============================================================================
// HELPERS
// ============================================================================

const ROLE_GUTTER_WIDTH = 3;
const SCROLLBAR_WIDTH = 1;
const WHEEL_STEP = 3;
const CHARS_PER_TICK = 5;
const TICK_INTERVAL_MS = 30;
const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function roleGutter(role: MessageRole, palette: UiPalette): { label: string; color: string } {
    switch (role) {
        case "user":
            return { label: "❯", color: palette.accent };
        case "agent":
            return { label: "◆", color: palette.info };
        case "system":
        case "action":
        case "tool":
            return { label: "·", color: palette.fgMuted };
        case "thinking":
            return { label: "", color: palette.fgMuted };
    }
}

function roleContentColor(role: MessageRole | "meta", palette: UiPalette): string {
    switch (role) {
        case "system":
            return palette.fgDim;
        case "thinking":
        case "meta":
            return palette.fgMuted;
        default:
            return palette.fg;
    }
}

function getScrambleChar(): string {
    return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

function toneToColor(tone: ChatRowTone | undefined, fallback: string, palette: UiPalette): string {
    switch (tone) {
        case "error":
            return palette.error;
        case "accent":
            return palette.accent;
        case "info":
            return palette.info;
        case "muted":
            return palette.fgMuted;
        case "dim":
            return palette.fgDim;
        case "normal":
        default:
            return fallback;
    }
}

interface ChatAreaProps {
    messages: ChatMessage[];
    palette: UiPalette;
    height: number;
    width: number;
    scrollOffset?: number; // row offset from bottom
    onScrollChange?: (offset: number) => void;
}

export function ChatArea({
    messages,
    palette,
    height,
    width,
    scrollOffset: externalOffset,
    onScrollChange,
}: ChatAreaProps) {
    const [internalOffset, setInternalOffset] = useState(0);
    const [thinkCollapsed, setThinkCollapsed] = useState<boolean>(true);
    const [toolsCollapsed, setToolsCollapsed] = useState<boolean>(true);
    const [animatingTimestamp, setAnimatingTimestamp] = useState<number | null>(null);
    // Seed with all message timestamps present at mount — those are "old" and must not animate
    const seenTimestampsRef = useRef<Set<number>>(
        new Set(messages.map((m) => m.timestamp)),
    );
    const [tick, setTick] = useState(0);

    const scrollOffset = externalOffset ?? internalOffset;
    const setScrollOffset = useCallback(
        (offset: number) => {
            if (onScrollChange) {
                onScrollChange(offset);
            } else {
                setInternalOffset(offset);
            }
        },
        [onScrollChange],
    );

    // Detect new agent messages and start typewriter animation
    useEffect(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "agent" && !msg.richRows) {
                if (!seenTimestampsRef.current.has(msg.timestamp)) {
                    seenTimestampsRef.current.add(msg.timestamp);
                    setAnimatingTimestamp(msg.timestamp);
                    setTick(0);
                }
                break;
            }
        }
    }, [messages]);

    // Advance tick to drive typewriter reveal
    useEffect(() => {
        if (animatingTimestamp === null) return;

        const msg = messages.find((m) => m.timestamp === animatingTimestamp);
        if (!msg) {
            setAnimatingTimestamp(null);
            return;
        }

        const totalTicks = Math.ceil(msg.content.length / CHARS_PER_TICK);
        if (tick >= totalTicks) {
            setAnimatingTimestamp(null);
            return;
        }

        const id = setTimeout(() => {
            setTick((t) => t + 1);
        }, TICK_INTERVAL_MS);

        return () => clearTimeout(id);
    }, [animatingTimestamp, tick, messages]);

    const viewportRows = Math.max(1, height);
    const contentColumnWidth = Math.max(1, width - SCROLLBAR_WIDTH);
    const gutterWidth = Math.min(ROLE_GUTTER_WIDTH, Math.max(0, contentColumnWidth - 1));
    const textWidth = Math.max(1, contentColumnWidth - gutterWidth);

    const displayMessages = useMemo((): ChatMessage[] => {
        if (animatingTimestamp === null) return messages;

        return messages.map((msg) => {
            if (msg.timestamp !== animatingTimestamp) return msg;

            const fullText = msg.content;
            const revealedCount = tick * CHARS_PER_TICK;
            if (revealedCount >= fullText.length) return msg;

            const animatedContent = fullText.slice(0, revealedCount) + getScrambleChar();
            return { ...msg, content: animatedContent };
        });
    }, [messages, animatingTimestamp, tick]);

    const rows = useMemo(
        () =>
            buildChatRows(displayMessages, {
                contentWidth: textWidth,
                thinkCollapsed,
                toolsCollapsed,
            }),
        [displayMessages, textWidth, thinkCollapsed, toolsCollapsed],
    );

    const windowState = useMemo(
        () => computeViewportWindow(rows.length, viewportRows, scrollOffset, 0),
        [rows.length, viewportRows, scrollOffset],
    );

    const visibleRows = useMemo(
        () => rows.slice(windowState.start, windowState.end),
        [rows, windowState.start, windowState.end],
    );

    const previousGeometryRef = useRef({ totalRows: rows.length, viewportRows });

    useEffect(() => {
        const clamped = clampOffset(scrollOffset, rows.length, viewportRows);
        if (clamped !== scrollOffset) {
            setScrollOffset(clamped);
        }
    }, [scrollOffset, rows.length, viewportRows, setScrollOffset]);

    useEffect(() => {
        const previous = previousGeometryRef.current;
        const geometryChanged =
            previous.totalRows !== rows.length || previous.viewportRows !== viewportRows;

        if (!geometryChanged) return;

        let nextOffset = 0;
        if (scrollOffset > 0) {
            nextOffset = computeResizePreservedOffset({
                previousTotalRows: previous.totalRows,
                nextTotalRows: rows.length,
                oldViewportRows: previous.viewportRows,
                newViewportRows: viewportRows,
                oldOffset: scrollOffset,
            });
        }

        previousGeometryRef.current = { totalRows: rows.length, viewportRows };

        if (nextOffset !== scrollOffset) {
            setScrollOffset(nextOffset);
        }
    }, [rows.length, viewportRows, scrollOffset, setScrollOffset]);

    const maxOffset = windowState.maxOffset;

    const scrollBy = useCallback(
        (delta: number) => {
            const nextOffset = applyScrollDelta(scrollOffset, delta, maxOffset);
            if (nextOffset !== scrollOffset) {
                setScrollOffset(nextOffset);
            }
        },
        [scrollOffset, maxOffset, setScrollOffset],
    );

    useInput((input, key) => {
        if (key.upArrow) {
            scrollBy(1);
            return;
        }
        if (key.downArrow) {
            scrollBy(-1);
            return;
        }
        if (key.pageUp) {
            scrollBy(getPageJump(viewportRows));
            return;
        }
        if (key.pageDown) {
            scrollBy(-getPageJump(viewportRows));
            return;
        }
        if (input.toLowerCase() === "e" && (key.meta || key.ctrl)) {
            const nextState = !(thinkCollapsed && toolsCollapsed);
            setThinkCollapsed(nextState);
            setToolsCollapsed(nextState);
            return;
        }
    });

    useScrollEvents({
        onScroll: useCallback((event: ScrollEvent) => {
            scrollBy(event.direction === "up" ? WHEEL_STEP : -WHEEL_STEP);
        }, [scrollBy]),
    });

    if (messages.length === 0 || rows.length === 0) {
        return (
            <Box flexDirection="column" height={height} width={Math.max(1, width)}>
                <Text color={palette.fgMuted} italic>
                    No messages yet. Type a request to get started.
                </Text>
            </Box>
        );
    }

    const fillerRowCount = Math.max(0, viewportRows - visibleRows.length);
    const thumb = computeScrollbarThumb(rows.length, viewportRows, windowState.offset, height);

    function renderRow(row: ChatRow): React.ReactNode {
        const gutter = row.gutterRole
            ? roleGutter(row.gutterRole, palette)
            : { label: "", color: palette.fgMuted };
        const gutterLabel = gutter.label.padEnd(Math.max(0, gutterWidth - 1), " ");
        const fallbackColor = roleContentColor(row.role, palette);
        const rowColor = toneToColor(row.tone, fallbackColor, palette);

        return (
            <Box key={row.id} flexDirection="row" width={contentColumnWidth}>
                <Box width={gutterWidth}>
                    <Text color={gutter.color} bold>
                        {gutterLabel}
                    </Text>
                </Box>
                <Box width={textWidth}>
                    {row.segments && row.segments.length > 0 ? (
                        <Box>
                            {row.segments.map((segment, index) => (
                                <Text
                                    key={`${row.id}-segment-${index}`}
                                    color={toneToColor(segment.tone, rowColor, palette)}
                                    bold={segment.bold}
                                    italic={segment.italic}
                                    dimColor={segment.dimColor}
                                >
                                    {segment.text}
                                </Text>
                            ))}
                        </Box>
                    ) : (
                        <Text
                            color={rowColor}
                            bold={row.bold}
                            italic={row.italic}
                            dimColor={row.dimColor}
                            wrap="truncate-end"
                        >
                            {row.text.length > 0 ? row.text : " "}
                        </Text>
                    )}
                </Box>
            </Box>
        );
    }

    const scrollbarRows = Array.from({ length: Math.max(1, height) }, (_, index) => {
        if (rows.length <= viewportRows) return " ";
        return index >= thumb.top && index < thumb.top + thumb.height ? "█" : "│";
    });

    return (
        <Box flexDirection="row" height={height} width={Math.max(1, width)} overflow="hidden">
            <Box
                flexDirection="column"
                width={contentColumnWidth}
                height={height}
                overflow="hidden"
            >
                {visibleRows.map((row) => renderRow(row))}
                {Array.from({ length: fillerRowCount }, (_, index) => (
                    <Box key={`filler-${index}`} flexDirection="row" width={contentColumnWidth}>
                        <Text> </Text>
                    </Box>
                ))}
            </Box>

            <Box width={SCROLLBAR_WIDTH} flexDirection="column" height={height}>
                {scrollbarRows.map((char, index) => (
                    <Text key={index} color={palette.fgMuted}>
                        {char}
                    </Text>
                ))}
            </Box>
        </Box>
    );
}
