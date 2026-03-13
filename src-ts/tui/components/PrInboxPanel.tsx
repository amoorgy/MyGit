/**
 * PrInboxPanel — GitHub PR inbox with auth recovery and repo picker.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { UiPalette } from "../theme.js";
import type { GitHubConfig } from "../../config/settings.js";
import { usePrInbox } from "../hooks/usePrInbox.js";
import type { GitHubPR } from "../../github/types.js";

interface PrInboxPanelProps {
    githubConfig: GitHubConfig;
    palette: UiPalette;
    height: number;
    width: number;
    onClose: () => void;
    onOpenReview: (target: { owner: string; repo: string; prNumber: number }) => void;
}

const PR_STATE_CYCLE: GitHubConfig["prInboxDefaultState"][] = ["all", "open", "closed", "merged"];

function stateColor(pr: GitHubPR, palette: UiPalette): string {
    if (pr.merged || pr.merged_at) return palette.success;
    if (pr.state === "open") return palette.accent;
    return palette.fgDim;
}

function stateLabel(pr: GitHubPR): string {
    if (pr.merged || pr.merged_at) return "merged";
    return pr.state;
}

function ageLabel(iso: string): string {
    if (!iso) return "n/a";
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
    return `${days}d`;
}

function windowAroundSelection<T>(
    items: T[],
    selectedIdx: number,
    maxVisible: number,
): { start: number; visible: T[] } {
    if (items.length === 0) return { start: 0, visible: [] };
    const safeVisible = Math.max(1, maxVisible);
    if (items.length <= safeVisible) return { start: 0, visible: items };
    const half = Math.floor(safeVisible / 2);
    const start = Math.max(0, Math.min(selectedIdx - half, items.length - safeVisible));
    return { start, visible: items.slice(start, start + safeVisible) };
}

export function PrInboxPanel({
    githubConfig,
    palette,
    height,
    width,
    onClose,
    onOpenReview,
}: PrInboxPanelProps): React.ReactElement {
    const {
        phase,
        error,
        progressMessage,
        selectedRepo,
        repos,
        prs,
        stateFilter,
        hasMoreRepos,
        isLoadingMoreRepos,
        authCommand,
        docsLinks,
        setStateFilter,
        selectRepo,
        openRepoPicker,
        loadMoreRepos,
        refresh,
        startAuthFlow,
    } = usePrInbox(githubConfig);

    const [selectedRepoIdx, setSelectedRepoIdx] = useState(0);
    const [selectedPrIdx, setSelectedPrIdx] = useState(0);
    const [searchMode, setSearchMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const triggerAuth = async () => {
        const success = await startAuthFlow();
        if (success) onClose();
    };

    const filteredRepos = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return repos;
        return repos.filter((r) => r.fullName.toLowerCase().includes(q));
    }, [repos, searchQuery]);

    useEffect(() => {
        if (selectedRepoIdx >= filteredRepos.length) {
            setSelectedRepoIdx(Math.max(0, filteredRepos.length - 1));
        }
    }, [filteredRepos.length, selectedRepoIdx]);

    useEffect(() => {
        if (selectedPrIdx >= prs.length) {
            setSelectedPrIdx(Math.max(0, prs.length - 1));
        }
    }, [prs.length, selectedPrIdx]);

    useInput((input, key) => {
        if (searchMode) {
            if (key.escape || key.return) {
                setSearchMode(false);
                return;
            }
            if (key.backspace || key.delete) {
                setSearchQuery((q) => q.slice(0, -1));
                return;
            }
            if (input && !key.ctrl && !key.meta) {
                setSearchQuery((q) => q + input);
            }
            return;
        }

        if (key.escape) {
            onClose();
            return;
        }

        if (phase === "auth_required") {
            if (key.return || input === "a") void triggerAuth();
            else if (input === "r") refresh();
            return;
        }

        if (phase === "repo_picker") {
            if (key.upArrow || input === "k") {
                setSelectedRepoIdx((idx) => Math.max(0, idx - 1));
                return;
            }
            if (key.downArrow || input === "j") {
                setSelectedRepoIdx((idx) => Math.min(filteredRepos.length - 1, idx + 1));
                return;
            }
            if (key.return) {
                const repo = filteredRepos[selectedRepoIdx];
                if (repo) void selectRepo(repo);
                return;
            }
            if (input === "/") {
                setSearchMode(true);
                return;
            }
            if (input === "n") {
                void loadMoreRepos();
                return;
            }
            if (input === "r") {
                refresh();
            }
            return;
        }

        if (phase === "ready") {
            if (key.upArrow || input === "k") {
                setSelectedPrIdx((idx) => Math.max(0, idx - 1));
                return;
            }
            if (key.downArrow || input === "j") {
                setSelectedPrIdx((idx) => Math.min(prs.length - 1, idx + 1));
                return;
            }
            if (key.return || input === "r") {
                const pr = prs[selectedPrIdx];
                if (pr && selectedRepo) {
                    onOpenReview({ owner: selectedRepo.owner, repo: selectedRepo.repo, prNumber: pr.number });
                }
                return;
            }
            if (input === "f") {
                const idx = PR_STATE_CYCLE.indexOf(stateFilter);
                const next = PR_STATE_CYCLE[(idx + 1) % PR_STATE_CYCLE.length];
                void setStateFilter(next);
                return;
            }
            if (input === "s") {
                void openRepoPicker();
                return;
            }
            if (input === "g") {
                refresh();
            }
        }
    }, { isActive: phase !== "authorizing" });

    const leftWidth = Math.max(36, Math.floor(width * 0.5));
    const rightWidth = Math.max(36, width - leftWidth - 3);
    const selectedPR = prs[selectedPrIdx];

    const repoWindowSize = Math.max(1, height - 9);
    const repoWindow = windowAroundSelection(filteredRepos, selectedRepoIdx, repoWindowSize);

    const prWindowSize = Math.max(1, height - 10);
    const prWindow = windowAroundSelection(prs, selectedPrIdx, prWindowSize);

    if (phase === "loading") {
        return (
            <Box flexDirection="column" height={height} paddingX={1}>
                <Text color={palette.accent} bold>PR Inbox</Text>
                <Box marginTop={1}>
                    <Text color={palette.info}>⟳ {progressMessage}</Text>
                </Box>
                {error && (
                    <Box marginTop={1}>
                        <Text color={palette.warning}>{error}</Text>
                    </Box>
                )}
                <Box marginTop={1}>
                    <Text color={palette.fgDim}>[Esc] back</Text>
                </Box>
            </Box>
        );
    }

    if (phase === "authorizing") {
        return (
            <Box flexDirection="column" height={height} paddingX={1}>
                <Text color={palette.accent} bold>PR Inbox</Text>
                <Box marginTop={1} flexDirection="column">
                    <Text color={palette.info}>⟳ {progressMessage}</Text>
                    <Text color={palette.fgDim}>Complete GitHub CLI prompts in the terminal/browser.</Text>
                    <Text color={palette.fgDim}>Auth is checked every 5 seconds and closes automatically on success.</Text>
                </Box>
            </Box>
        );
    }

    if (phase === "auth_required") {
        return (
            <Box flexDirection="column" height={height} paddingX={1}>
                <Text color={palette.accent} bold>PR Inbox · GitHub Authentication Required</Text>
                <Box marginTop={1} flexDirection="column">
                    <Text color={palette.warning}>{error ?? "GitHub authentication is missing."}</Text>
                    <Text color={palette.fgDim}>Run auth: {authCommand}</Text>
                </Box>
                <Box marginTop={1} flexDirection="column">
                    <Text color={palette.fgDim}>Docs:</Text>
                    <Text color={palette.info}>- GH auth: {docsLinks.ghAuth}</Text>
                    <Text color={palette.info}>- PAT setup: {docsLinks.pat}</Text>
                    <Text color={palette.info}>- mygit config: {docsLinks.config}</Text>
                </Box>
                <Box marginTop={1}>
                    <Text color={palette.fgDim}>
                        <Text color={palette.accent} bold>Enter/a</Text> authenticate{" "}
                        <Text color={palette.accent} bold>r</Text> retry{" "}
                        <Text color={palette.accent} bold>Esc</Text> back
                    </Text>
                </Box>
            </Box>
        );
    }

    if (phase === "repo_picker") {
        return (
            <Box flexDirection="column" height={height}>
                <Box justifyContent="space-between" paddingX={1}>
                    <Text color={palette.accent} bold>PR Inbox · Select Repository</Text>
                    <Text color={palette.fgDim}>
                        Search: {searchMode ? <Text color={palette.accent}>{searchQuery || "…"}</Text> : (searchQuery || "-")}
                    </Text>
                </Box>

                <Box
                    marginTop={1}
                    borderStyle="single"
                    borderColor={palette.border}
                    paddingX={1}
                    flexDirection="column"
                    height={Math.max(5, height - 5)}
                >
                    {filteredRepos.length === 0 ? (
                        <Text color={palette.fgDim}>No repositories found.</Text>
                    ) : (
                        repoWindow.visible.map((repo, i) => {
                            const absoluteIdx = repoWindow.start + i;
                            const isSelected = absoluteIdx === selectedRepoIdx;
                            return (
                            <Box key={repo.fullName}>
                                <Text color={isSelected ? palette.accent : palette.fg}>
                                    {isSelected ? "▸ " : "  "}
                                </Text>
                                <Text bold={isSelected} color={isSelected ? palette.fg : palette.fgDim}>
                                    {repo.fullName}
                                </Text>
                                <Text color={palette.fgMuted}> · {repo.private ? "private" : "public"} · updated {ageLabel(repo.updatedAt)}</Text>
                            </Box>
                        );
                        })
                    )}
                    {filteredRepos.length > repoWindow.visible.length && (
                        <Text color={palette.fgMuted}>
                            showing {repoWindow.start + 1}-{repoWindow.start + repoWindow.visible.length} of {filteredRepos.length}
                        </Text>
                    )}
                    {isLoadingMoreRepos && <Text color={palette.info}>Loading more repositories...</Text>}
                </Box>

                <Box paddingX={1}>
                    <Text color={palette.fgDim}>
                        <Text color={palette.accent} bold>↑/↓</Text> navigate{" "}
                        <Text color={palette.accent} bold>Enter</Text> select{" "}
                        <Text color={palette.accent} bold>/</Text> search{" "}
                        <Text color={palette.accent} bold>n</Text> next page{" "}
                        <Text color={palette.accent} bold>r</Text> refresh{" "}
                        <Text color={palette.accent} bold>Esc</Text> back
                    </Text>
                </Box>
                {!hasMoreRepos && (
                    <Box paddingX={1}>
                        <Text color={palette.fgMuted}>End of repository list.</Text>
                    </Box>
                )}
            </Box>
        );
    }

    if (phase === "error") {
        return (
            <Box flexDirection="column" height={height} paddingX={1}>
                <Text color={palette.accent} bold>PR Inbox</Text>
                <Box marginTop={1}>
                    <Text color={palette.error}>{error ?? "Unknown error."}</Text>
                </Box>
                <Box marginTop={1}>
                    <Text color={palette.fgDim}>[r] retry  [Esc] back</Text>
                </Box>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" height={height}>
            <Box justifyContent="space-between" paddingX={1}>
                <Text color={palette.accent} bold>
                    PR Inbox{selectedRepo ? ` · ${selectedRepo.fullName}` : ""}
                </Text>
                <Text color={palette.fgDim}>filter:{stateFilter}</Text>
            </Box>

            <Box flexDirection="row" flexGrow={1}>
                <Box
                    width={leftWidth}
                    borderStyle="single"
                    borderColor={palette.border}
                    paddingX={1}
                    flexDirection="column"
                >
                    <Text color={palette.fgDim} bold>Pull Requests ({prs.length})</Text>
                    {prs.length === 0 ? (
                        <Box marginTop={1}>
                            <Text color={palette.fgDim}>No pull requests in this filter.</Text>
                        </Box>
                    ) : (
                        prWindow.visible.map((pr, i) => {
                            const absoluteIdx = prWindow.start + i;
                            const isSelected = absoluteIdx === selectedPrIdx;
                            return (
                            <Box key={pr.number}>
                                <Text color={isSelected ? palette.accent : palette.fg}>
                                    {isSelected ? "▸ " : "  "}
                                </Text>
                                <Text bold={isSelected} color={isSelected ? palette.fg : palette.fgDim}>
                                    #{pr.number} {pr.title}
                                </Text>
                                <Text color={stateColor(pr, palette)}> [{stateLabel(pr)}]</Text>
                            </Box>
                        );
                        })
                    )}
                    {prs.length > prWindow.visible.length && (
                        <Text color={palette.fgMuted}>
                            showing {prWindow.start + 1}-{prWindow.start + prWindow.visible.length} of {prs.length}
                        </Text>
                    )}
                </Box>

                <Box
                    width={rightWidth}
                    borderStyle="single"
                    borderColor={palette.border}
                    paddingX={1}
                    flexDirection="column"
                >
                    {selectedPR ? (
                        <>
                            <Text color={palette.accent} bold>#{selectedPR.number} · {selectedPR.title}</Text>
                            <Text color={palette.fgDim}>
                                by @{selectedPR.user.login} · {selectedPR.head.ref} → {selectedPR.base.ref}
                            </Text>
                            <Text color={palette.fgDim}>
                                +{selectedPR.additions} / -{selectedPR.deletions} · {selectedPR.changed_files} files · updated {ageLabel(selectedPR.updated_at)}
                            </Text>
                            <Box marginTop={1}>
                                <Text color={palette.fg} wrap="wrap">{selectedPR.body?.trim() || "(No PR description)"}</Text>
                            </Box>
                            <Box marginTop={1}>
                                <Text color={palette.info}>{selectedPR.html_url}</Text>
                            </Box>
                        </>
                    ) : (
                        <Text color={palette.fgDim}>Select a pull request.</Text>
                    )}
                </Box>
            </Box>

            <Box paddingX={1} justifyContent="space-between">
                <Text color={palette.fgDim}>
                    <Text color={palette.accent} bold>↑/↓</Text> navigate{" "}
                    <Text color={palette.accent} bold>Enter/r</Text> review{" "}
                    <Text color={palette.accent} bold>f</Text> filter{" "}
                    <Text color={palette.accent} bold>s</Text> switch repo{" "}
                    <Text color={palette.accent} bold>g</Text> refresh{" "}
                    <Text color={palette.accent} bold>Esc</Text> back
                </Text>
                <Text color={palette.fgDim}>
                    {error ? <Text color={palette.warning}>{error}</Text> : null}
                </Text>
            </Box>
        </Box>
    );
}
