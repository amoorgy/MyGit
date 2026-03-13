/**
 * MergeView — interactive merge conflict resolution panel
 *
 * Displays conflict hunks with diff coloring, supports navigation
 * between hunks, and offers resolution options via keyboard shortcuts.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { DiffView } from "./DiffRenderer.js";
import { SmartMergeReview, SmartMergeLoading, type SmartMergeOutcome } from "./SmartMergeReview.js";
import { diffHunks } from "../../merge/differ.js";
import type {
    ConflictFile,
    Resolution,
    SmartSolutionPlan,
} from "../../merge/types.js";

// ── Props ──────────────────────────────────────────────────────────────

interface MergeViewProps {
    file: ConflictFile;
    /** Single plan per hunk (keyed by hunk id) */
    smartSolutions?: Map<number, SmartSolutionPlan>;
    onResolveHunk: (hunkId: number, resolution: Resolution) => void;
    onDone: () => void;
    onRequestSmartMerge?: (hunkId: number) => void;
    isSmartLoading?: boolean;
    accentColor?: string;
}

// ── Main Component ─────────────────────────────────────────────────────

export function MergeView({
    file,
    smartSolutions,
    onResolveHunk,
    onDone,
    onRequestSmartMerge,
    isSmartLoading,
    accentColor = "#8b5cf6",
}: MergeViewProps): React.ReactElement {
    const [currentHunk, setCurrentHunk] = useState(0);
    const [showSmart, setShowSmart] = useState(false);

    const hunk = file.hunks[currentHunk];
    const totalHunks = file.hunks.length;
    const resolvedCount = file.hunks.filter((h) => h.resolution !== null).length;

    const currentPlan = smartSolutions?.get(hunk?.id ?? -1) ?? null;

    const handleResolve = useCallback(
        (resolution: Resolution) => {
            if (!hunk) return;
            onResolveHunk(hunk.id, resolution);

            const nextUnresolved = file.hunks.findIndex(
                (h, i) => i > currentHunk && h.resolution === null,
            );
            if (nextUnresolved !== -1) {
                setCurrentHunk(nextUnresolved);
            } else if (resolvedCount + 1 >= totalHunks) {
                onDone();
            }
            setShowSmart(false);
        },
        [hunk, currentHunk, file.hunks, resolvedCount, totalHunks, onResolveHunk, onDone],
    );

    const handleSmartOutcome = useCallback(
        (outcome: SmartMergeOutcome) => {
            if (outcome.type === "accept") {
                handleResolve({
                    type: "smart",
                    resolution: {
                        lines: outcome.plan.resolvedLines,
                        strategyName: outcome.plan.strategyName,
                        explanation: outcome.plan.explanation,
                        decision: outcome.plan.decision,
                        reasoningSteps: outcome.plan.reasoningSteps,
                    },
                });
            } else if (outcome.type === "deny") {
                setShowSmart(false);
            }
        },
        [handleResolve],
    );

    useInput((input, key) => {
        if (showSmart) return;

        if (key.upArrow || input === "k") {
            setCurrentHunk(Math.max(0, currentHunk - 1));
        } else if (key.downArrow || input === "j") {
            setCurrentHunk(Math.min(totalHunks - 1, currentHunk + 1));
        } else if (input === "o") {
            handleResolve({ type: "accept_ours" });
        } else if (input === "t") {
            handleResolve({ type: "accept_theirs" });
        } else if (input === "b") {
            handleResolve({ type: "accept_both", oursFirst: true });
        } else if (input === "s") {
            if (currentPlan) {
                setShowSmart(true);
            } else if (onRequestSmartMerge && hunk) {
                onRequestSmartMerge(hunk.id);
            }
        } else if (input === "q" || key.escape) {
            onDone();
        }
    });

    if (!hunk) {
        return (
            <Box flexDirection="column" paddingX={1}>
                <Text color={accentColor} bold>
                    No conflicts found in {file.path}
                </Text>
            </Box>
        );
    }

    // Compute diff for display
    const hunkDiff = diffHunks(hunk.ours, hunk.theirs);

    return (
        <Box flexDirection="column" paddingX={1}>
            {/* Header */}
            <Box justifyContent="space-between">
                <Text color={accentColor} bold>
                    ╭─ Merge: {file.path}
                </Text>
                <Text color="#888">
                    Hunk {currentHunk + 1}/{totalHunks} ({resolvedCount} resolved)
                </Text>
            </Box>

            {/* Labels */}
            <Box gap={2} marginTop={1}>
                <Text color="#e06060" bold>
                    ◀ OURS: {hunk.oursLabel ?? "current"}
                </Text>
                <Text color="#6060e0" bold>
                    ▶ THEIRS: {hunk.theirsLabel ?? "incoming"}
                </Text>
            </Box>

            {/* Diff view */}
            <Box
                flexDirection="column"
                marginTop={1}
                borderStyle="single"
                borderColor="#333"
                paddingX={1}
            >
                <DiffView hunkDiff={hunkDiff} startLine={hunk.lineStart} />
            </Box>

            {/* Smart merge review or loading */}
            {showSmart && isSmartLoading && (
                <Box marginTop={1}>
                    <SmartMergeLoading accentColor={accentColor} />
                </Box>
            )}
            {showSmart && currentPlan && !isSmartLoading && (
                <Box marginTop={1}>
                    <SmartMergeReview
                        plan={currentPlan}
                        accentColor={accentColor}
                        onOutcome={handleSmartOutcome}
                        onCancel={() => setShowSmart(false)}
                    />
                </Box>
            )}

            {/* Resolution status */}
            {hunk.resolution && (
                <Box marginTop={1}>
                    <Text color="#40c040">
                        ✓ Resolved: {hunk.resolution.type.replace("_", " ")}
                    </Text>
                </Box>
            )}

            {/* Keyboard shortcuts */}
            <Box marginTop={1} gap={2}>
                <Text color="#888">
                    <Text color="#e0a040" bold>o</Text> ours{" "}
                    <Text color="#e0a040" bold>t</Text> theirs{" "}
                    <Text color="#e0a040" bold>b</Text> both{" "}
                    <Text color="#e0a040" bold>s</Text> smart{" "}
                    <Text color="#e0a040" bold>j/k</Text> navigate{" "}
                    <Text color="#e0a040" bold>q</Text> done
                </Text>
            </Box>
        </Box>
    );
}
