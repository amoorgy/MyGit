/**
 * ConfirmPanel — action approval overlay with consequences.
 * Mirrors Rust's `render_confirmation_panel()`.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { UiPalette } from "../theme.js";
import type { AgentAction } from "../../agent/protocol.js";
import { describeAction } from "../../agent/protocol.js";
import type { PermissionResponse } from "../../agent/permissions.js";

// ============================================================================
// COMPONENT
// ============================================================================

interface ConfirmPanelProps {
    action: AgentAction;
    reasoning: string;
    consequences: string[];
    onRespond: (response: PermissionResponse) => void;
    palette: UiPalette;
}

const CONFIRM_OPTIONS: { label: string; key: string; response: PermissionResponse }[] = [
    { label: "Allow Once", key: "y", response: "allow_once" },
    { label: "Allow Similar (Session)", key: "s", response: "allow_session" },
    { label: "Deny Once", key: "n", response: "deny_once" },
    { label: "Deny Similar (Session)", key: "d", response: "deny_session" },
];

export function ConfirmPanel({
    action,
    reasoning,
    consequences,
    onRespond,
    palette,
}: ConfirmPanelProps) {
    const [selected, setSelected] = useState(0);

    useInput((input, key) => {
        if (key.upArrow) {
            setSelected((s) => Math.max(0, s - 1));
        } else if (key.downArrow) {
            setSelected((s) => Math.min(CONFIRM_OPTIONS.length - 1, s + 1));
        } else if (key.return) {
            onRespond(CONFIRM_OPTIONS[selected].response);
        } else {
            // Check shortcut keys
            const opt = CONFIRM_OPTIONS.find((o) => o.key === input.toLowerCase());
            if (opt) onRespond(opt.response);
        }
    });

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={palette.warning}
            paddingX={2}
            paddingY={1}
        >
            <Text color={palette.warning} bold>
                ⚠ Permission Required
            </Text>

            <Box marginTop={1} flexDirection="column">
                <Text color={palette.fg} bold>
                    Action:{" "}
                </Text>
                <Text color={palette.info}>{describeAction(action)}</Text>
            </Box>

            {reasoning && (
                <Box marginTop={1} flexDirection="column">
                    <Text color={palette.fg} bold>
                        Reasoning:{" "}
                    </Text>
                    <Text color={palette.fgDim} wrap="wrap">
                        {reasoning}
                    </Text>
                </Box>
            )}

            {consequences.length > 0 && (
                <Box marginTop={1} flexDirection="column">
                    <Text color={palette.fg} bold>
                        Consequences:
                    </Text>
                    {consequences.map((c, i) => (
                        <Text key={i} color={palette.warning}>
                            {"  • "}
                            {c}
                        </Text>
                    ))}
                </Box>
            )}

            <Box marginTop={1} flexDirection="column">
                {CONFIRM_OPTIONS.map((opt, i) => (
                    <Box key={opt.key}>
                        <Text color={i === selected ? palette.accent : palette.fgDim}>
                            {i === selected ? "▸ " : "  "}
                            [{opt.key}] {opt.label}
                        </Text>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}
