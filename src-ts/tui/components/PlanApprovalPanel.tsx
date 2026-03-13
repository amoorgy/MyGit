/**
 * PlanApprovalPanel — overlay for when the agent proposes a plan for approval.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { UiPalette } from "../theme.js";
import type { PlanStep } from "../../agent/protocol.js";

interface PlanApprovalPanelProps {
    steps: PlanStep[];
    onRespond: (approved: boolean) => void;
    palette: UiPalette;
}

const APPROVAL_OPTIONS = [
    { label: "Approve", key: "y", approved: true },
    { label: "Reject", key: "n", approved: false },
];

export function PlanApprovalPanel({ steps, onRespond, palette }: PlanApprovalPanelProps) {
    const [selected, setSelected] = useState(0);

    useInput((input, key) => {
        if (key.upArrow || key.leftArrow) {
            setSelected((s) => Math.max(0, s - 1));
        } else if (key.downArrow || key.rightArrow) {
            setSelected((s) => Math.min(APPROVAL_OPTIONS.length - 1, s + 1));
        } else if (key.return) {
            onRespond(APPROVAL_OPTIONS[selected].approved);
        } else {
            // Check shortcut keys
            const opt = APPROVAL_OPTIONS.find((o) => o.key === input.toLowerCase());
            if (opt) onRespond(opt.approved);
        }
    });

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={palette.accent}
            paddingX={2}
            paddingY={1}
        >
            <Text color={palette.accent} bold>
                Proposed Plan for Approval
            </Text>

            <Box marginTop={1} flexDirection="column">
                {steps.map((step, i) => (
                    <Box key={i} flexDirection="column" marginBottom={0}>
                        <Box>
                            <Text color={palette.info}>{i + 1}. </Text>
                            <Text color={palette.fg} wrap="wrap">
                                {step.description}
                            </Text>
                        </Box>
                        {step.command && (
                            <Box marginLeft={3}>
                                <Text color={palette.fgDim}>$ {step.command}</Text>
                            </Box>
                        )}
                    </Box>
                ))}
            </Box>

            <Box marginTop={1} flexDirection="row" gap={2}>
                {APPROVAL_OPTIONS.map((opt, i) => (
                    <Text key={opt.key} color={i === selected ? palette.accent : palette.fgDim}>
                        {i === selected ? "▸ " : "  "}
                        [{opt.key}] {opt.label}
                    </Text>
                ))}
            </Box>
        </Box>
    );
}
