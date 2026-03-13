/**
 * MergeConflictPanel — two-pane merge conflict resolution view.
 *
 * Left pane: file list with per-file resolution progress.
 * Right pane: MergeView for the selected file (hunk diff + resolution).
 *
 * Follows the ThoughtMapPanel two-pane layout pattern.
 * Auto-opens IDE diff windows when navigating files (if IDE detected).
 */

import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { MergeView } from "./MergeView.js";
import { SmartMergeLoading } from "./SmartMergeReview.js";
import type { UiPalette } from "../theme.js";
import type {
    ConflictFile,
    Resolution,
    SmartSolutionPlan,
} from "../../merge/types.js";
import { resolveFile } from "../../merge/resolver.js";
import { type IDEEnvironment, isIDEAvailable, openIDEDiff } from "../ide.js";
import type { ProviderConfig } from "../../llm/providers.js";
import { createChatModel } from "../../llm/providers.js";
import { generateSmartSolution, buildSmartRequest } from "../../merge/smart.js";

// ── Props ──────────────────────────────────────────────────────────────

interface MergeConflictPanelProps {
    files: ConflictFile[];
    onDone: (outcome: "resolved" | "cancelled") => void;
    providerConfig: ProviderConfig;
    palette: UiPalette;
    height: number;
    width: number;
    ide: IDEEnvironment;
}

// ── Main Component ─────────────────────────────────────────────────────

export function MergeConflictPanel({
    files,
    onDone,
    providerConfig,
    palette,
    height,
    width,
    ide,
}: MergeConflictPanelProps): React.ReactElement {
    const [selectedFileIdx, setSelectedFileIdx] = useState(0);
    const [smartPlans, setSmartPlans] = useState<Map<string, Map<number, SmartSolutionPlan>>>(new Map());
    const [isSmartLoading, setIsSmartLoading] = useState(false);
    const [fileStates, setFileStates] = useState<ConflictFile[]>([...files]);

    const currentFile = fileStates[selectedFileIdx];
    const totalFiles = fileStates.length;

    // Open IDE diff when file selection changes
    useEffect(() => {
        if (isIDEAvailable(ide) && currentFile) {
            void openIDEDiff(currentFile.path, ide);
        }
    }, [selectedFileIdx, ide, currentFile]);

    // Count resolved hunks per file
    const fileProgress = useCallback((file: ConflictFile) => {
        const resolved = file.hunks.filter(h => h.resolution !== null).length;
        return { resolved, total: file.hunks.length };
    }, []);

    const allResolved = fileStates.every(f =>
        f.hunks.every(h => h.resolution !== null),
    );

    // Handle hunk resolution
    const handleResolveHunk = useCallback((hunkId: number, resolution: Resolution) => {
        setFileStates(prev => {
            const updated = [...prev];
            const file = { ...updated[selectedFileIdx] };
            file.hunks = file.hunks.map(h =>
                h.id === hunkId ? { ...h, resolution } : h,
            );
            updated[selectedFileIdx] = file;
            return updated;
        });
    }, [selectedFileIdx]);

    // Handle file done (all hunks resolved for current file)
    const handleFileDone = useCallback(async () => {
        const file = fileStates[selectedFileIdx];
        const allHunksResolved = file.hunks.every(h => h.resolution !== null);

        if (allHunksResolved) {
            // Write resolved content to disk
            try {
                await resolveFile(file);
            } catch {
                // Resolution write failed — user can retry
            }
        }

        // Move to next unresolved file or finish
        const nextUnresolved = fileStates.findIndex(
            (f, i) => i > selectedFileIdx && f.hunks.some(h => h.resolution === null),
        );
        if (nextUnresolved !== -1) {
            setSelectedFileIdx(nextUnresolved);
        }
    }, [fileStates, selectedFileIdx]);

    // Smart merge request
    const handleRequestSmartMerge = useCallback(async (hunkId: number) => {
        if (!currentFile || isSmartLoading) return;

        const hunk = currentFile.hunks.find(h => h.id === hunkId);
        if (!hunk) return;

        setIsSmartLoading(true);
        try {
            const model = createChatModel(providerConfig);
            const request = buildSmartRequest(hunk, currentFile.path, [], []);
            const plan = await generateSmartSolution(request, model);

            if (plan) {
                setSmartPlans(prev => {
                    const next = new Map(prev);
                    const fileMap = new Map(next.get(currentFile.path) ?? []);
                    fileMap.set(hunkId, plan);
                    next.set(currentFile.path, fileMap);
                    return next;
                });
            }
        } catch {
            // Smart merge failed — user can still resolve manually
        }
        setIsSmartLoading(false);
    }, [currentFile, isSmartLoading, providerConfig]);

    // File-level navigation (Tab switches files)
    useInput((input, key) => {
        if (key.tab) {
            setSelectedFileIdx(prev => (prev + 1) % totalFiles);
        } else if (key.return && allResolved) {
            onDone("resolved");
        } else if (key.escape) {
            onDone("cancelled");
        }
    });

    if (!currentFile) {
        return (
            <Box flexDirection="column" paddingX={1}>
                <Text color={palette.error}>No conflicted files to resolve.</Text>
            </Box>
        );
    }

    const leftWidth = Math.max(30, Math.floor(width * 0.35));
    const rightWidth = width - leftWidth - 3; // borders
    const contentHeight = Math.max(10, height - 4);

    const currentSmartPlans = smartPlans.get(currentFile.path);

    return (
        <Box flexDirection="column" height={height}>
            {/* Title bar */}
            <Box justifyContent="space-between" paddingX={1}>
                <Text color={palette.accent} bold>
                    Merge Conflicts ({totalFiles} file{totalFiles !== 1 ? "s" : ""})
                </Text>
                <Text color={allResolved ? palette.success : palette.fgDim}>
                    {allResolved ? "All resolved — Enter to finish" : "Resolve all hunks to continue"}
                </Text>
            </Box>

            {/* Two-pane layout */}
            <Box flexDirection="row" flexGrow={1}>
                {/* Left pane: file list */}
                <Box
                    flexDirection="column"
                    width={leftWidth}
                    borderStyle="single"
                    borderColor={palette.border}
                    paddingX={1}
                >
                    <Text color={palette.fgDim} bold>Files</Text>
                    {fileStates.map((file, i) => {
                        const { resolved, total } = fileProgress(file);
                        const isSelected = i === selectedFileIdx;
                        const isDone = resolved === total;
                        const shortPath = file.path.length > leftWidth - 16
                            ? "..." + file.path.slice(-(leftWidth - 19))
                            : file.path;

                        return (
                            <Box key={file.path}>
                                <Text color={isSelected ? palette.accent : palette.fg}>
                                    {isSelected ? "▸ " : "  "}
                                </Text>
                                <Text
                                    color={isDone ? palette.success : isSelected ? "#fff" : palette.fg}
                                    bold={isSelected}
                                >
                                    {shortPath}
                                </Text>
                                <Text color={isDone ? palette.success : palette.fgDim}>
                                    {" "}[{isDone ? "done" : `${resolved}/${total}`}]
                                </Text>
                            </Box>
                        );
                    })}

                    {/* File nav hint */}
                    <Box marginTop={1}>
                        <Text color={palette.fgDim}>
                            Tab: next file
                        </Text>
                    </Box>
                    {isIDEAvailable(ide) && (
                        <Text color={palette.fgDim}>
                            IDE diff: auto
                        </Text>
                    )}
                </Box>

                {/* Right pane: merge view for selected file */}
                <Box
                    flexDirection="column"
                    width={rightWidth}
                    borderStyle="single"
                    borderColor={palette.border}
                >
                    <MergeView
                        file={currentFile}
                        smartSolutions={currentSmartPlans}
                        onResolveHunk={handleResolveHunk}
                        onDone={handleFileDone}
                        onRequestSmartMerge={handleRequestSmartMerge}
                        isSmartLoading={isSmartLoading}
                        accentColor={palette.accent}
                    />
                </Box>
            </Box>

            {/* Bottom status bar */}
            <Box paddingX={1} justifyContent="space-between">
                <Text color={palette.fgDim}>
                    <Text color={palette.accent} bold>Tab</Text> switch file{" "}
                    <Text color={palette.accent} bold>o</Text> ours{" "}
                    <Text color={palette.accent} bold>t</Text> theirs{" "}
                    <Text color={palette.accent} bold>s</Text> smart{" "}
                    <Text color={palette.accent} bold>j/k</Text> hunks{" "}
                    {allResolved && <><Text color={palette.success} bold>Enter</Text> finish{" "}</>}
                    <Text color={palette.accent} bold>Esc</Text> cancel
                </Text>
            </Box>
        </Box>
    );
}
