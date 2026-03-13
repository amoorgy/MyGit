/**
 * ThoughtMapActions — horizontal action bar shown below the thought map.
 * Offers: Implement, Save & Run, Run Saved, Adjust.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { UiPalette } from "../theme.js";

export type ThoughtMapAction = "implement" | "save_and_run" | "run_saved" | "adjust";

const ACTIONS: { key: ThoughtMapAction; label: string }[] = [
    { key: "implement", label: "Implement" },
    { key: "save_and_run", label: "Save & Run" },
    { key: "run_saved", label: "Run Saved" },
    { key: "adjust", label: "Adjust" },
];

interface ThoughtMapActionsProps {
    onSelect: (action: ThoughtMapAction) => void;
    palette: UiPalette;
}

export function ThoughtMapActions({ onSelect, palette }: ThoughtMapActionsProps) {
    const [selected, setSelected] = useState(0);

    useInput((input, key) => {
        if (key.leftArrow) {
            setSelected((s) => Math.max(0, s - 1));
        } else if (key.rightArrow) {
            setSelected((s) => Math.min(ACTIONS.length - 1, s + 1));
        } else if (key.return) {
            onSelect(ACTIONS[selected].key);
        }
    });

    return (
        <Box paddingX={1} gap={1}>
            {ACTIONS.map((action, i) => {
                const isSel = i === selected;
                return (
                    <Box key={action.key}>
                        <Text
                            color={isSel ? palette.accent : palette.fgDim}
                            bold={isSel}
                            inverse={isSel}
                        >
                            {` ${action.label} `}
                        </Text>
                    </Box>
                );
            })}
            <Text color={palette.fgMuted}> ←→ select · Enter confirm</Text>
        </Box>
    );
}
