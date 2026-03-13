/**
 * Worktree Panel — TUI for managing git worktrees.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { WorktreeManager } from "../../worktree/manager.js";
import type { Worktree } from "../../worktree/types.js";
import type { UiPalette } from "../theme.js";

// ============================================================================
// PROPS
// ============================================================================

interface WorktreePanelProps {
    onClose: () => void;
    palette: UiPalette;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function WorktreePanel({ onClose, palette }: WorktreePanelProps) {
    const [worktrees, setWorktrees] = useState<Worktree[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [message, setMessage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const manager = new WorktreeManager();

    const loadWorktrees = useCallback(async () => {
        setIsLoading(true);
        const list = await manager.list(process.cwd());
        setWorktrees(list);
        setSelectedIndex(0);
        setIsLoading(false);
    }, []);

    useEffect(() => {
        loadWorktrees();
    }, [loadWorktrees]);

    useInput(async (input, key) => {
        if (key.upArrow) {
            setSelectedIndex((i) => Math.max(0, i - 1));
        } else if (key.downArrow) {
            setSelectedIndex((i) => Math.min(worktrees.length - 1, i + 1));
        } else if (key.escape) {
            onClose();
        } else if (input === "r" && (key.meta || key.ctrl)) {
            // Reload
            await loadWorktrees();
            setMessage("Reloaded worktrees");
        } else if ((input === "x" || input === "d") && worktrees.length > 0) {
            // Delete / Remove
            const wt = worktrees[selectedIndex];
            if (wt.isLocked) {
                setMessage(`Cannot remove locked worktree: ${wt.path}`);
                return;
            }
            // Simple confirmation mechanism or just do it? 
            // For now, let's just try to remove.
            setMessage(`Removing ${wt.path}...`);
            try {
                await manager.remove(process.cwd(), wt.path);
                await loadWorktrees();
                setMessage(`Removed ${wt.path}`);
            } catch (err) {
                setMessage(`Failed to remove: ${err}`);
            }
        } else if (input === "p") {
            // Prune
            setMessage("Pruning stale worktrees...");
            try {
                await manager.prune(process.cwd());
                await loadWorktrees();
                setMessage("Pruned.");
            } catch (err) {
                setMessage(`Prune failed: ${err}`);
            }
        }
    });

    return (
        <Box flexDirection="column" padding={1} borderStyle="single" borderColor={palette.accent}>
            <Box justifyContent="space-between" marginBottom={1}>
                <Text bold color={palette.accent}>
                    Git Worktrees
                </Text>
                <Text color="gray">
                    ↑↓ select • x/d remove • p prune • Esc back
                </Text>
            </Box>

            {isLoading ? (
                <Text>Loading...</Text>
            ) : worktrees.length === 0 ? (
                <Text italic color="gray">No worktrees found (unexpected for a git repo)</Text>
            ) : (
                <Box flexDirection="column" gap={0}>
                    {worktrees.map((wt, idx) => {
                        const isSelected = idx === selectedIndex;
                        return (
                            <Box key={wt.path} flexDirection="row" gap={2}>
                                <Text color={isSelected ? palette.accent : "white"}>
                                    {isSelected ? "▸" : " "} {pathBasename(wt.path)}
                                </Text>

                                <Box flexGrow={1}>
                                    <Text color="gray" dimColor>
                                        {wt.path}
                                    </Text>
                                </Box>

                                <Box width={15}>
                                    <Text color={wt.isDetached ? "yellow" : "green"}>
                                        {wt.branch}
                                    </Text>
                                </Box>

                                <Box width={8} justifyContent="flex-end">
                                    <Text color="blue">
                                        {wt.head.substring(0, 7)}
                                    </Text>
                                </Box>

                                {wt.isLocked && <Text color={palette.warning}> [locked]</Text>}
                                {wt.prunable && <Text color="gray"> [prunable]</Text>}
                            </Box>
                        );
                    })}
                </Box>
            )}

            {message && (
                <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
                    <Text>{message}</Text>
                </Box>
            )}
        </Box>
    );
}

function pathBasename(p: string): string {
    return p.split(/[\\/]/).pop() || p;
}
