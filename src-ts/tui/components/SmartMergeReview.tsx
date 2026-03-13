/**
 * SmartMergeReview — reusable AI merge resolution review panel.
 *
 * Displays the AI's recommended resolution with step-by-step reasoning.
 * User can Accept, Deny, or provide custom instructions ("Other").
 *
 * Used by both MergeView (standalone) and MergeConflictPanel (agent flow).
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SmartSolutionPlan, SmartMergeDecision } from "../../merge/types.js";

// ── Props ──────────────────────────────────────────────────────────────

export type SmartMergeOutcome =
    | { type: "accept"; plan: SmartSolutionPlan }
    | { type: "deny" }
    | { type: "other"; instruction: string };

interface SmartMergeReviewProps {
    plan: SmartSolutionPlan;
    isLoading?: boolean;
    accentColor?: string;
    onOutcome: (outcome: SmartMergeOutcome) => void;
    onCancel: () => void;
}

// ── Decision Badge ─────────────────────────────────────────────────────

function decisionBadge(decision: SmartMergeDecision): { label: string; color: string } {
    switch (decision) {
        case "accept_ours":
            return { label: "KEEP OURS", color: "#e06060" };
        case "accept_theirs":
            return { label: "KEEP THEIRS", color: "#6060e0" };
        case "hybrid":
            return { label: "HYBRID", color: "#e0a040" };
    }
}

// ── Main Component ─────────────────────────────────────────────────────

export function SmartMergeReview({
    plan,
    isLoading,
    accentColor = "#8b5cf6",
    onOutcome,
    onCancel,
}: SmartMergeReviewProps): React.ReactElement {
    const [selectedAction, setSelectedAction] = useState<0 | 1 | 2>(0);
    const actions = ["Accept", "Deny", "Other"] as const;

    useInput((input, key) => {
        if (isLoading) return;

        // Navigate actions
        if (key.leftArrow && selectedAction > 0) {
            setSelectedAction((selectedAction - 1) as 0 | 1 | 2);
        } else if (key.rightArrow && selectedAction < 2) {
            setSelectedAction((selectedAction + 1) as 0 | 1 | 2);
        }

        // Confirm selection
        else if (key.return) {
            if (selectedAction === 0) {
                onOutcome({ type: "accept", plan });
            } else if (selectedAction === 1) {
                onOutcome({ type: "deny" });
            } else {
                // "Other" — for now emit with placeholder; the parent collects the instruction
                onOutcome({ type: "other", instruction: "" });
            }
        }

        // Quick cancel
        else if (key.escape) {
            onCancel();
        }
    });

    if (isLoading) {
        return (
            <Box flexDirection="column" borderStyle="round" borderColor={accentColor} paddingX={1}>
                <Text color={accentColor}>AI is reviewing this conflict...</Text>
            </Box>
        );
    }

    const badge = decisionBadge(plan.decision);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor={accentColor} paddingX={1}>
            {/* Header */}
            <Box justifyContent="space-between">
                <Text color={accentColor} bold>
                    Smart Merge Recommendation
                </Text>
                <Text color={badge.color} bold>
                    [{badge.label}]
                </Text>
            </Box>

            {/* Strategy name */}
            <Box marginTop={1}>
                <Text color="#fff" bold>{plan.strategyName}</Text>
            </Box>

            {/* Reasoning steps */}
            {plan.reasoningSteps.length > 0 && (
                <Box flexDirection="column" marginTop={1} paddingLeft={1}>
                    <Text color="#888" bold>Reasoning:</Text>
                    {plan.reasoningSteps.map((step, i) => (
                        <Box key={i} paddingLeft={1}>
                            <Text color="#aaa">{step}</Text>
                        </Box>
                    ))}
                </Box>
            )}

            {/* Explanation */}
            <Box marginTop={1} paddingLeft={1}>
                <Text color="#888" italic>{plan.explanation}</Text>
            </Box>

            {/* Preview of resolved lines */}
            <Box flexDirection="column" marginTop={1} paddingLeft={1}>
                <Text color="#888" bold>Preview:</Text>
                <Box flexDirection="column" paddingLeft={1}>
                    {plan.resolvedLines.slice(0, 6).map((line, i) => (
                        <Text key={i} color="#6a6">{line}</Text>
                    ))}
                    {plan.resolvedLines.length > 6 && (
                        <Text color="#666">... ({plan.resolvedLines.length - 6} more lines)</Text>
                    )}
                </Box>
            </Box>

            {/* Action buttons */}
            <Box marginTop={1} gap={2}>
                {actions.map((action, i) => {
                    const isSelected = i === selectedAction;
                    const color = isSelected ? accentColor : "#666";
                    return (
                        <Text key={action} color={color} bold={isSelected}>
                            {isSelected ? `[${action}]` : ` ${action} `}
                        </Text>
                    );
                })}
            </Box>

            <Box marginTop={1}>
                <Text color="#555">←→ navigate • Enter confirm • Esc cancel</Text>
            </Box>
        </Box>
    );
}

// ── Loading Spinner ────────────────────────────────────────────────────

export function SmartMergeLoading({
    accentColor = "#8b5cf6",
}: {
    accentColor?: string;
}): React.ReactElement {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={accentColor} paddingX={1} paddingY={1}>
            <Text color={accentColor}>⟳ AI is reviewing this conflict...</Text>
            <Text color="#666">Analyzing both sides and surrounding context</Text>
        </Box>
    );
}
