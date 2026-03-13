import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { UiPalette } from "../theme.js";
import type { BranchPanelData, BranchPanelTarget } from "../git/branchTools.js";

export interface BranchActionOption {
    id: "stash_switch" | "create_worktree" | "cancel";
    label: string;
    description: string;
}

export interface BranchActionPrompt {
    title: string;
    detail?: string;
    options: BranchActionOption[];
}

interface BranchPanelProps {
    data: BranchPanelData | null;
    actionPrompt: BranchActionPrompt | null;
    isLoading: boolean;
    error: string | null;
    palette: UiPalette;
    height: number;
    width: number;
    onSelectTarget: (target: BranchPanelTarget) => void;
    onResolveAction: (id: BranchActionOption["id"]) => void;
    onClose: () => void;
    onReload: () => void;
}

type PanelItem =
    | { kind: "target"; section: string; target: BranchPanelTarget; subtitle?: string }
    | { kind: "action"; option: BranchActionOption };

function formatShortSha(sha: string): string {
    return sha ? sha.slice(0, 8) : "--------";
}

export function BranchPanel({
    data,
    actionPrompt,
    isLoading,
    error,
    palette,
    height,
    width,
    onSelectTarget,
    onResolveAction,
    onClose,
    onReload,
}: BranchPanelProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const items = useMemo<PanelItem[]>(() => {
        if (actionPrompt) {
            return actionPrompt.options.map((option) => ({
                kind: "action",
                option,
            }));
        }

        if (!data) return [];

        if (data.query) {
            return data.locatorResults.map((result, index) => ({
                kind: "target",
                section: index === 0 ? "Best match" : "Other matches",
                target: result.target,
                subtitle: [result.reason, result.matchPath, result.matchSubject]
                    .filter(Boolean)
                    .join(" • "),
            }));
        }

        const next: PanelItem[] = [];
        if (data.currentBranch) {
            next.push({
                kind: "target",
                section: "Current branch",
                target: data.currentBranch,
                subtitle: data.currentBranch.lastCommitSubject,
            });
        }
        for (const branch of data.recentBranches) {
            next.push({
                kind: "target",
                section: "Recent branches",
                target: branch,
                subtitle: branch.lastCommitSubject,
            });
        }
        for (const branch of data.otherBranches) {
            next.push({
                kind: "target",
                section: "Other branches",
                target: branch,
                subtitle: branch.lastCommitSubject,
            });
        }
        return next;
    }, [actionPrompt, data]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [actionPrompt, data?.query, data?.currentBranch?.name, data?.recentBranches.length, data?.otherBranches.length]);

    useInput((input, key) => {
        if (key.escape) {
            onClose();
            return;
        }
        if (key.upArrow) {
            setSelectedIndex((index) => Math.max(0, index - 1));
            return;
        }
        if (key.downArrow) {
            setSelectedIndex((index) => Math.min(items.length - 1, index + 1));
            return;
        }
        if ((input === "r" || input === "R") && (key.ctrl || key.meta)) {
            onReload();
            return;
        }
        if (key.return && items[selectedIndex]) {
            const selected = items[selectedIndex];
            if (selected.kind === "target") {
                onSelectTarget(selected.target);
            } else {
                onResolveAction(selected.option.id);
            }
        }
    });

    const viewportHeight = Math.max(8, height);
    const visibleItems = items.slice(
        Math.max(0, selectedIndex - Math.floor((viewportHeight - 6) / 2)),
        Math.max(0, selectedIndex - Math.floor((viewportHeight - 6) / 2)) + Math.max(1, viewportHeight - 6),
    );

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={palette.accent}
            padding={1}
            height={Math.max(8, height)}
            width={Math.max(40, width)}
        >
            <Box justifyContent="space-between">
                <Text color={palette.accent} bold>
                    {actionPrompt ? "Branch action" : data?.query ? `/branch ${data.query}` : "/branch"}
                </Text>
                <Text color={palette.fgMuted}>
                    ↑↓ select • Enter confirm • Esc close
                </Text>
            </Box>

            {actionPrompt ? (
                <Box flexDirection="column" marginTop={1}>
                    <Text color={palette.info} bold>{actionPrompt.title}</Text>
                    {actionPrompt.detail && (
                        <Text color={palette.fgDim}>{actionPrompt.detail}</Text>
                    )}
                </Box>
            ) : data?.query ? (
                <Box marginTop={1}>
                    <Text color={palette.fgDim}>
                        Locator results across current indexed context, refs, and history
                    </Text>
                </Box>
            ) : (
                <Box marginTop={1}>
                    <Text color={palette.fgDim}>
                        Current branch, recent branches, and unused origin branches
                    </Text>
                </Box>
            )}

            <Box flexDirection="column" marginTop={1} flexGrow={1}>
                {isLoading ? (
                    <Text color={palette.warning}>Loading branch data…</Text>
                ) : error ? (
                    <Text color={palette.error}>{error}</Text>
                ) : items.length === 0 ? (
                    <Text color={palette.fgMuted}>
                        {data?.query ? "No branch matches found." : "No branches available."}
                    </Text>
                ) : (
                    visibleItems.map((item) => {
                        const actualIndex = items.indexOf(item);
                        const isSelected = actualIndex === selectedIndex;
                        const rowColor = isSelected ? palette.accent : palette.fg;
                        if (item.kind === "action") {
                            return (
                                <Box key={`action-${item.option.id}`} flexDirection="column" marginBottom={1}>
                                    <Text color={rowColor} bold={isSelected}>
                                        {isSelected ? "▸ " : "  "}
                                        {item.option.label}
                                    </Text>
                                    <Text color={palette.fgDim}>
                                        {item.option.description}
                                    </Text>
                                </Box>
                            );
                        }

                        return (
                            <Box key={`${item.section}-${item.target.source}-${item.target.name}`} flexDirection="column" marginBottom={1}>
                                <Text color={palette.fgMuted}>
                                    {item.section}
                                </Text>
                                <Text color={rowColor} bold={isSelected}>
                                    {isSelected ? "▸ " : "  "}
                                    {item.target.displayName}
                                    <Text color={palette.fgMuted}>
                                        {`  ${item.target.source}  ${formatShortSha(item.target.lastCommitSha)}`}
                                    </Text>
                                </Text>
                                <Text color={palette.fgDim}>
                                    {item.subtitle || item.target.lastCommitSubject || "(no commit subject)"}
                                </Text>
                                {item.target.occupiedByWorktree && (
                                    <Text color={palette.warning}>
                                        worktree: {item.target.occupiedByWorktree}
                                    </Text>
                                )}
                            </Box>
                        );
                    })
                )}
            </Box>
        </Box>
    );
}
