import React from "react";
import { Box, Text } from "ink";
import type { UiPalette } from "../theme.js";

export const MAX_SLASH_VISIBLE = 7;

/** Compute the total terminal lines this panel will occupy. */
export function computeSlashMenuHeight(itemCount: number, level: 0 | 1): number {
    const rows = Math.min(itemCount, MAX_SLASH_VISIBLE);
    // 2 border lines + visible item rows + 1 hint line + 1 back-hint line (level 1 only)
    return 2 + rows + 1 + (level === 1 ? 1 : 0);
}

export interface SlashMenuItem {
    id: string;
    label: string;
    description: string;
}

interface SlashMenuPanelProps {
    items: SlashMenuItem[];
    highlight: number;
    level: 0 | 1;
    parentLabel?: string;
    palette: UiPalette;
}

export function SlashMenuPanel({ items, highlight, level, parentLabel, palette }: SlashMenuPanelProps) {
    const safeHighlight = Math.min(highlight, Math.max(0, items.length - 1));

    // Compute the scroll window so the selected item is always visible
    const windowStart = Math.max(
        0,
        Math.min(safeHighlight - MAX_SLASH_VISIBLE + 1, items.length - MAX_SLASH_VISIBLE),
    );
    const visible = items.slice(windowStart, windowStart + MAX_SLASH_VISIBLE + 1);
    const hasMore = items.length > MAX_SLASH_VISIBLE;

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={palette.borderActive}
            paddingX={1}
            width="100%"
        >
            {/* Back hint when in sub-menu */}
            {level === 1 && parentLabel && (
                <Text color={palette.fgMuted} italic>{"← " + parentLabel}</Text>
            )}

            {/* Command items */}
            {items.length === 0 ? (
                <Text color={palette.fgMuted}>No commands match</Text>
            ) : (
                visible.map((item, vi) => {
                    const realIdx = windowStart + vi;
                    const isSelected = realIdx === safeHighlight;
                    return (
                        <Box key={item.id}>
                            <Text color={isSelected ? palette.accent : palette.fg} bold={isSelected}>
                                {isSelected ? "▸ " : "  "}
                                {item.label}
                            </Text>
                            <Text color={palette.fgMuted}>{"  " + item.description}</Text>
                        </Box>
                    );
                })
            )}

            {/* Navigation hint (with scroll indicator if list is longer than window) */}
            <Text color={palette.fgMuted} italic>
                {(hasMore ? `${safeHighlight + 1}/${items.length}  ` : "") +
                    "↑↓ navigate · Enter select" +
                    (level === 1 ? " · Esc back" : " · Esc close")}
            </Text>
        </Box>
    );
}
