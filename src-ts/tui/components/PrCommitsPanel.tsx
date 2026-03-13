/**
 * PrCommitsPanel — viewer for commits separating current branch from a base branch.
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { UiPalette } from "../theme.js";
import { execa } from "execa";

const VIEWPORT_CHROME = 6; // border + header + footer + padding

interface PrCommitsPanelProps {
    onClose: () => void;
    palette: UiPalette;
}

export function PrCommitsPanel({ onClose, palette }: PrCommitsPanelProps) {
    const { stdout } = useStdout();
    const termHeight = stdout?.rows ?? 24;
    const viewportHeight = Math.max(5, termHeight - VIEWPORT_CHROME);

    const [commits, setCommits] = useState<string[]>([]);
    const [baseBranch, setBaseBranch] = useState("main");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);

    // Keep selection visible within viewport
    useEffect(() => {
        if (selectedIndex < scrollTop) {
            setScrollTop(selectedIndex);
        } else if (selectedIndex >= scrollTop + viewportHeight) {
            setScrollTop(selectedIndex - viewportHeight + 1);
        }
    }, [selectedIndex, scrollTop, viewportHeight]);

    const visibleCommits = useMemo(
        () => commits.slice(scrollTop, scrollTop + viewportHeight),
        [commits, scrollTop, viewportHeight],
    );

    const loadCommits = async () => {
        setLoading(true);
        setError(null);
        try {
            // Determine base branch
            let base = "main";
            try {
                const { stdout: headRef } = await execa("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
                if (headRef) base = headRef;
            } catch (e) {
                // Fallback to checking common base branches
                const candidates = ["main", "origin/main", "master", "origin/master", "develop", "origin/develop"];
                for (const candidate of candidates) {
                    try {
                        await execa("git", ["rev-parse", "--verify", "--quiet", candidate]);
                        base = candidate;
                        break;
                    } catch (e2) {
                        // Ignore
                    }
                }
            }

            setBaseBranch(base);

            // Get commits
            const range = `${base}..HEAD`;
            const { stdout } = await execa("git", ["log", "--oneline", "--no-decorate", range]);
            const commitList = stdout.trim() ? stdout.split("\n") : [];
            setCommits(commitList);
            setSelectedIndex(0);
        } catch (e: any) {
            setError(e.message || "Failed to load PR commits");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadCommits();
    }, []);

    useInput((input, key) => {
        if (key.escape || key.return) {
            onClose();
        } else if (input === "r" || input === "R") {
            loadCommits();
        } else if (key.upArrow) {
            setSelectedIndex((s) => Math.max(0, s - 1));
        } else if (key.downArrow) {
            setSelectedIndex((s) => Math.min(commits.length - 1, s + 1));
        }
    });

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={palette.accent}
            paddingX={1}
            flexGrow={1}
        >
            <Box borderBottom={false} marginBottom={1}>
                <Text color={palette.accent} bold>
                    PR Commits (Base: {baseBranch})
                </Text>
            </Box>

            <Box flexDirection="column" flexGrow={1}>
                {loading ? (
                    <Text color={palette.info}>Loading commits...</Text>
                ) : error ? (
                    <Text color={palette.warning}>Error: {error}</Text>
                ) : commits.length === 0 ? (
                    <Text color={palette.fgDim}>No commits difference found against {baseBranch}.</Text>
                ) : (
                    <>
                        {scrollTop > 0 && (
                            <Text color={palette.fgMuted}>  ↑ {scrollTop} more</Text>
                        )}
                        {visibleCommits.map((commit, vi) => {
                            const i = scrollTop + vi;
                            const isSelected = i === selectedIndex;
                            return (
                                <Box key={i}>
                                    <Text color={isSelected ? palette.accent : palette.fgDim}>
                                        {isSelected ? "▸ " : "  "}
                                    </Text>
                                    <Text color={isSelected ? palette.fg : palette.fgDim}>
                                        {commit}
                                    </Text>
                                </Box>
                            );
                        })}
                        {scrollTop + viewportHeight < commits.length && (
                            <Text color={palette.fgMuted}>  ↓ {commits.length - scrollTop - viewportHeight} more</Text>
                        )}
                    </>
                )}
            </Box>

            <Box marginTop={1}>
                <Text color={palette.fgDim}>
                    [↑/↓] Navigate   [Esc/Enter] Close   [R] Reload
                </Text>
            </Box>
        </Box>
    );
}
