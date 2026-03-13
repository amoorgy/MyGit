/**
 * Menu — slash-command overlay.
 * Mirrors Rust's `render_menu()` and MENU_ITEMS.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { UiPalette } from "../theme.js";

// ============================================================================
// MENU ITEMS
// ============================================================================

export const MENU_ITEMS = [
    { label: "Config", description: "Edit settings" },
    { label: "Provider", description: "Manage LLM providers" },
    { label: "Model", description: "Select AI model" },
    { label: "PR Commits", description: "Show PR commit diff" },
    { label: "Clear Context", description: "Reset conversation" },
    { label: "Worktrees", description: "Manage worktrees" },
    { label: "Conflicts", description: "View merge conflicts" },
    { label: "Exit", description: "Quit mygit" },
] as const;

export type MenuAction = (typeof MENU_ITEMS)[number]["label"];

// ============================================================================
// COMPONENT
// ============================================================================

interface MenuProps {
    onSelect: (action: MenuAction) => void;
    onClose: () => void;
    palette: UiPalette;
}

export function Menu({ onSelect, onClose, palette }: MenuProps) {
    const [selected, setSelected] = useState(0);

    useInput((input, key) => {
        if (key.upArrow) {
            setSelected((s) => Math.max(0, s - 1));
        } else if (key.downArrow) {
            setSelected((s) => Math.min(MENU_ITEMS.length - 1, s + 1));
        } else if (key.return) {
            onSelect(MENU_ITEMS[selected].label);
        } else if (key.escape || input === "q") {
            onClose();
        }
    });

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={palette.borderActive}
            paddingX={1}
        >
            <Text color={palette.accent} bold>
                Command Menu
            </Text>
            <Box marginTop={1} flexDirection="column">
                {MENU_ITEMS.map((item, i) => (
                    <Box key={item.label}>
                        <Text
                            color={i === selected ? palette.accent : palette.fgDim}
                            bold={i === selected}
                        >
                            {i === selected ? "▸ " : "  "}
                            {item.label}
                        </Text>
                        <Text color={palette.fgMuted}> — {item.description}</Text>
                    </Box>
                ))}
            </Box>
            <Box marginTop={1}>
                <Text color={palette.fgMuted} italic>
                    ↑↓ navigate · Enter select · Esc close
                </Text>
            </Box>
        </Box>
    );
}
