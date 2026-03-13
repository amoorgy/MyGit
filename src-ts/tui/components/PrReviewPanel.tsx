/**
 * PrReviewPanel — compact list-first AI PR review.
 *
 * Wide terminals render a split findings/detail view.
 * Narrow terminals stack findings above details.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { UiPalette } from "../theme.js";
import type { GitHubConfig } from "../../config/settings.js";
import type { ProviderConfig } from "../../llm/providers.js";
import type { PRReview, ReviewComment } from "../../pr/types.js";
import { SEVERITY_COLORS, SEVERITY_LABELS } from "../../pr/types.js";
import { usePrReview } from "../hooks/usePrReview.js";
import { computePrReviewLayout, truncateInline } from "./prReviewLayout.js";

interface PrReviewPanelProps {
    prNumber: number;
    repoOwner: string;
    repoName: string;
    githubConfig: GitHubConfig;
    providerConfig: ProviderConfig;
    palette: UiPalette;
    height: number;
    width: number;
    onClose: () => void;
}

const SEVERITY_ORDER: Record<ReviewComment["severity"], number> = {
    critical: 4,
    major: 3,
    minor: 2,
    suggestion: 1,
    praise: 0,
};

function DecisionBadge({ decision }: { decision: PRReview["overallDecision"] }): React.ReactElement {
    const color = decision === "approve" ? SEVERITY_COLORS.praise :
        decision === "request_changes" ? SEVERITY_COLORS.critical :
        SEVERITY_COLORS.suggestion;
    const label = decision === "approve" ? "APPROVE" :
        decision === "request_changes" ? "REQUEST CHANGES" :
        "COMMENT";
    return <Text color={color} bold>[{label}]</Text>;
}

function shortPath(path: string, max = 28): string {
    if (path.length <= max) return path;
    return "..." + path.slice(-(max - 3));
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

function extractPatchExcerpt(patch: string, targetLine?: number, radius = 3): string[] {
    if (!patch || patch.trim() === "") return [];
    const lines = patch.split("\n");
    if (targetLine === undefined) {
        return lines.slice(0, 12);
    }

    let currentNewLine = 0;
    const out: string[] = [];
    let collecting = false;

    for (const line of lines) {
        if (line.startsWith("@@")) {
            const match = line.match(/\+(\d+)(?:,\d+)?/);
            currentNewLine = match ? parseInt(match[1], 10) : currentNewLine;
            const hunkStart = currentNewLine;
            if (targetLine >= hunkStart - radius && targetLine <= hunkStart + 1000) {
                collecting = true;
                out.push(line);
            } else if (collecting) {
                break;
            }
            continue;
        }

        let lineNumber: number | null = null;
        if (line.startsWith("+") || line.startsWith(" ")) {
            lineNumber = currentNewLine;
            currentNewLine += 1;
        } else if (!line.startsWith("-")) {
            lineNumber = currentNewLine;
        }

        if (!collecting || lineNumber === null) continue;
        if (Math.abs(lineNumber - targetLine) <= radius) {
            out.push(`${String(lineNumber).padStart(4, " ")} ${line}`);
        }
    }

    if (out.length === 0) {
        return lines.slice(0, 12);
    }
    return out.slice(0, 14);
}

function formatPostStatus(
    postMode: "inline" | "summary_only" | null,
    postedCommentCount: number,
    postUrl: string | null,
    maxWidth: number,
): string {
    if (!postMode) return "";
    const prefix = postMode === "summary_only"
        ? "posted summary only"
        : `posted ${postedCommentCount} inline comments`;
    const suffix = postUrl ? ` · ${postUrl}` : "";
    return truncateInline(prefix + suffix, maxWidth);
}

function FindingsPane({
    comments,
    selectedCommentIdx,
    paneHeight,
    paneWidth,
    palette,
}: {
    comments: ReviewComment[];
    selectedCommentIdx: number;
    paneHeight: number;
    paneWidth: number;
    palette: UiPalette;
}): React.ReactElement {
    const criticalCount = comments.filter((c) => c.severity === "critical").length;
    const majorCount = comments.filter((c) => c.severity === "major").length;
    const minorCount = comments.filter((c) => c.severity === "minor").length;
    const suggestionCount = comments.filter((c) => c.severity === "suggestion").length;
    const commentWindow = windowAroundSelection(comments, selectedCommentIdx, Math.max(1, paneHeight - 4));

    return (
        <Box
            flexDirection="column"
            width={paneWidth}
            height={paneHeight}
            borderStyle="single"
            borderColor={palette.border}
            paddingX={1}
        >
            <Text color={palette.fgDim} bold>Findings ({comments.length})</Text>
            <Text color={palette.fgMuted} wrap="truncate-end">
                <Text color={SEVERITY_COLORS.critical}>{criticalCount} critical</Text>{" "}
                <Text color={SEVERITY_COLORS.major}>{majorCount} major</Text>{" "}
                <Text color={SEVERITY_COLORS.minor}>{minorCount} minor</Text>{" "}
                <Text color={SEVERITY_COLORS.suggestion}>{suggestionCount} suggestions</Text>
            </Text>

            {comments.length === 0 ? (
                <Box marginTop={1}>
                    <Text color={palette.success}>No findings</Text>
                </Box>
            ) : (
                commentWindow.visible.map((c, i) => {
                    const absoluteIdx = commentWindow.start + i;
                    const isSelected = absoluteIdx === selectedCommentIdx;
                    const itemLabel = `${shortPath(c.filePath, Math.max(12, paneWidth - 28))}${c.line !== undefined ? `:${c.line}` : ""} · ${c.title}`;
                    return (
                        <Box key={c.id}>
                            <Text color={isSelected ? palette.accent : palette.fg}>
                                {isSelected ? "▸ " : "  "}
                            </Text>
                            <Text color={SEVERITY_COLORS[c.severity]} bold>[{SEVERITY_LABELS[c.severity]}]</Text>
                            <Text color={isSelected ? palette.fg : palette.fgDim} bold={isSelected} wrap="truncate-end">
                                {" "}{itemLabel}
                            </Text>
                        </Box>
                    );
                })
            )}

            {comments.length > commentWindow.visible.length && (
                <Text color={palette.fgMuted} wrap="truncate-end">
                    showing {commentWindow.start + 1}-{commentWindow.start + commentWindow.visible.length} of {comments.length}
                </Text>
            )}
        </Box>
    );
}

function DetailsPane({
    selectedComment,
    patchExcerpt,
    paneHeight,
    paneWidth,
    palette,
}: {
    selectedComment: ReviewComment | null;
    patchExcerpt: string[];
    paneHeight: number;
    paneWidth: number;
    palette: UiPalette;
}): React.ReactElement {
    return (
        <Box
            flexDirection="column"
            width={paneWidth}
            height={paneHeight}
            borderStyle="single"
            borderColor={palette.border}
            paddingX={1}
        >
            {!selectedComment ? (
                <Text color={palette.fgDim}>Select a finding for details.</Text>
            ) : (
                <>
                    <Text color={SEVERITY_COLORS[selectedComment.severity]} bold wrap="truncate-end">
                        [{SEVERITY_LABELS[selectedComment.severity]}] {selectedComment.title}
                    </Text>
                    <Text color={palette.fgDim} wrap="truncate-end">
                        {truncateInline(
                            `${selectedComment.filePath}${selectedComment.line !== undefined ? `:${selectedComment.line}` : ""} · ${selectedComment.category}`,
                            Math.max(12, paneWidth - 4),
                        )}
                    </Text>

                    <Box marginTop={1}>
                        <Text color={palette.fg} wrap="wrap">{selectedComment.body}</Text>
                    </Box>

                    {selectedComment.suggestion && (
                        <Box marginTop={1} flexDirection="column">
                            <Text color={palette.fgDim} bold>SUGGESTION</Text>
                            <Text color={palette.success} wrap="wrap">{selectedComment.suggestion}</Text>
                        </Box>
                    )}

                    {selectedComment.reasoningSteps.length > 0 && (
                        <Box marginTop={1} flexDirection="column">
                            <Text color={palette.fgDim} bold>REASONING</Text>
                            {selectedComment.reasoningSteps.map((step, i) => (
                                <Text key={i} color={palette.fgMuted} wrap="wrap">• {step}</Text>
                            ))}
                        </Box>
                    )}

                    {patchExcerpt.length > 0 && (
                        <Box marginTop={1} flexDirection="column">
                            <Text color={palette.fgDim} bold>DIFF CONTEXT</Text>
                            {patchExcerpt.map((line, i) => (
                                <Text
                                    key={i}
                                    color={palette.fgMuted}
                                    wrap="truncate-end"
                                >
                                    {truncateInline(line, Math.max(8, paneWidth - 4))}
                                </Text>
                            ))}
                        </Box>
                    )}
                </>
            )}
        </Box>
    );
}

export function PrReviewPanel({
    prNumber,
    repoOwner,
    repoName,
    githubConfig,
    providerConfig,
    palette,
    height,
    width,
    onClose,
}: PrReviewPanelProps): React.ReactElement {
    const [selectedCommentIdx, setSelectedCommentIdx] = useState(0);
    const {
        review,
        phase,
        progressMessage,
        error,
        postResult,
        postMode,
        postDetail,
        postUrl,
        postedCommentCount,
        filePatches,
        postReview,
        reload,
    } = usePrReview(prNumber, githubConfig, providerConfig, {
        owner: repoOwner,
        repo: repoName,
    });

    const comments = useMemo(
        () => (review?.comments ?? [])
            .slice()
            .sort((a, b) =>
                SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
                a.filePath.localeCompare(b.filePath) ||
                (a.line ?? 0) - (b.line ?? 0),
            ),
        [review],
    );

    useEffect(() => {
        if (selectedCommentIdx >= comments.length) {
            setSelectedCommentIdx(Math.max(0, comments.length - 1));
        }
    }, [comments.length, selectedCommentIdx]);

    const isDone = phase === "done";
    const isLoading = !isDone && phase !== "error";
    const isPosting = phase === "posting";
    const selectedComment = comments[selectedCommentIdx] ?? null;
    const patchExcerpt = selectedComment
        ? extractPatchExcerpt(filePatches[selectedComment.filePath] ?? "", selectedComment.line)
        : [];
    const layout = computePrReviewLayout(width, height);
    const statusLine = formatPostStatus(postMode, postedCommentCount, postUrl, Math.max(10, layout.contentWidth - 24));

    useInput((input, key) => {
        if (key.escape) {
            onClose();
            return;
        }
        if (error && input === "r") {
            reload();
            return;
        }

        if (!isDone || !review) return;
        if (key.upArrow || input === "k") {
            setSelectedCommentIdx((i) => Math.max(0, i - 1));
        } else if (key.downArrow || input === "j") {
            setSelectedCommentIdx((i) => Math.min(comments.length - 1, i + 1));
        } else if (input === "p" && !isPosting) {
            void postReview();
        } else if (input === "r") {
            reload();
        }
    });

    if (error) {
        return (
            <Box flexDirection="column" height={height} paddingX={1}>
                <Text color={palette.accent} bold wrap="truncate-end">PR Review #{prNumber} · {repoOwner}/{repoName}</Text>
                <Box marginTop={1}>
                    <Text color={palette.error} wrap="wrap">Error: {error}</Text>
                </Box>
                {postDetail && (
                    <Box marginTop={1}>
                        <Text color={palette.fgMuted} wrap="wrap">{postDetail}</Text>
                    </Box>
                )}
                <Box marginTop={1}>
                    <Text color={palette.fgDim}>[r] retry  [Esc] back</Text>
                </Box>
            </Box>
        );
    }

    if (isLoading) {
        return (
            <Box flexDirection="column" height={height}>
                <Box justifyContent="space-between" paddingX={1}>
                    <Text color={palette.accent} bold wrap="truncate-end">PR Review #{prNumber} · {repoOwner}/{repoName}</Text>
                    <Text color={palette.fgDim}>phase:{phase}</Text>
                </Box>
                <Box flexGrow={1} paddingX={2} paddingY={1}>
                    <Text color={palette.info} bold wrap="wrap">⟳ {progressMessage || "Loading..."}</Text>
                </Box>
                <Box paddingX={1}>
                    <Text color={palette.fgDim}>[Esc] back</Text>
                </Box>
            </Box>
        );
    }

    if (!review) {
        return (
            <Box flexDirection="column" paddingX={1}>
                <Text color={palette.fgDim}>No review data.</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" height={height} width={layout.contentWidth}>
            <Box justifyContent="space-between" paddingX={1}>
                <Text color={palette.accent} bold wrap="truncate-end">
                    {layout.compactHeader
                        ? `PR #${prNumber} · ${truncateInline(review.prTitle, Math.max(12, layout.contentWidth - 24))}`
                        : `PR #${prNumber}: ${review.prTitle}`}
                </Text>
                <Box gap={1}>
                    <DecisionBadge decision={review.overallDecision} />
                    <Text color={palette.fgDim}>risk:{review.riskScore}/10</Text>
                </Box>
            </Box>

            <Box paddingX={1}>
                <Text color={palette.fgDim} wrap={layout.compactHeader ? "truncate-end" : "wrap"}>
                    {review.overallSummary}
                </Text>
            </Box>

            {layout.mode === "wide" ? (
                <Box flexDirection="row" flexGrow={1}>
                    <FindingsPane
                        comments={comments}
                        selectedCommentIdx={selectedCommentIdx}
                        paneHeight={layout.findingsHeight}
                        paneWidth={layout.leftWidth}
                        palette={palette}
                    />
                    <Box width={1} />
                    <DetailsPane
                        selectedComment={selectedComment}
                        patchExcerpt={patchExcerpt}
                        paneHeight={layout.detailsHeight}
                        paneWidth={layout.rightWidth}
                        palette={palette}
                    />
                </Box>
            ) : (
                <Box flexDirection="column" flexGrow={1}>
                    <FindingsPane
                        comments={comments}
                        selectedCommentIdx={selectedCommentIdx}
                        paneHeight={layout.findingsHeight}
                        paneWidth={layout.leftWidth}
                        palette={palette}
                    />
                    <Box height={1} />
                    <DetailsPane
                        selectedComment={selectedComment}
                        patchExcerpt={patchExcerpt}
                        paneHeight={layout.detailsHeight}
                        paneWidth={layout.rightWidth}
                        palette={palette}
                    />
                </Box>
            )}

            <Box paddingX={1} justifyContent="space-between">
                <Text color={palette.fgDim} wrap="truncate-end">
                    <Text color={palette.accent} bold>j/k</Text> navigate{" "}
                    {!isPosting && <><Text color={palette.accent} bold>p</Text> post{" "}</>}
                    {isPosting && <Text color={palette.warning}>posting... </Text>}
                    <Text color={palette.accent} bold>r</Text> reload{" "}
                    <Text color={palette.accent} bold>Esc</Text> back
                </Text>
                {!layout.compactFooter && postResult === "success" && statusLine ? (
                    <Text color={palette.success} wrap="truncate-end">{statusLine}</Text>
                ) : null}
            </Box>

            {layout.compactFooter && postResult === "success" && statusLine ? (
                <Box paddingX={1}>
                    <Text color={palette.success} wrap="truncate-end">{statusLine}</Text>
                </Box>
            ) : null}
        </Box>
    );
}
