/**
 * DiffRenderer — inline diff display component
 *
 * Renders LineDiff entries with character-level color spans.
 */

import React from "react";
import { Text, Box } from "ink";
import chalk from "chalk";
import type { LineDiff, DiffSpan, HunkDiff } from "../../merge/types.js";

// ── Palette ────────────────────────────────────────────────────────────

interface DiffColors {
    added: string;
    removed: string;
    equal: string;
    lineNumOld: string;
    lineNumNew: string;
    gutterAdd: string;
    gutterRemove: string;
}

const DEFAULT_COLORS: DiffColors = {
    added: "#a8e6a3",
    removed: "#e6a3a3",
    equal: "#cccccc",
    lineNumOld: "#e06060",
    lineNumNew: "#60c060",
    gutterAdd: "#40a040",
    gutterRemove: "#a04040",
};

// ── Span Rendering ─────────────────────────────────────────────────────

function renderSpans(spans: DiffSpan[], side: "old" | "new"): string {
    return spans
        .map((span) => {
            switch (span.tag) {
                case "equal":
                    return span.text;
                case "added":
                    return chalk.bgHex("#1a3a1a").hex("#a8e6a3")(span.text);
                case "removed":
                    return chalk.bgHex("#3a1a1a").hex("#e6a3a3")(span.text);
            }
        })
        .join("");
}

// ── DiffLine Component ─────────────────────────────────────────────────

interface DiffLineProps {
    diff: LineDiff;
    lineNum: number;
    colors?: DiffColors;
}

export function DiffLine({ diff, lineNum, colors = DEFAULT_COLORS }: DiffLineProps): React.ReactElement {
    switch (diff.type) {
        case "equal":
            return (
                <Box>
                    <Text color={colors.equal} dimColor>
                        {"  "}{String(lineNum).padStart(4)} │ {diff.text}
                    </Text>
                </Box>
            );

        case "changed":
            return (
                <Box flexDirection="column">
                    <Box>
                        <Text color={colors.gutterRemove}>{"- "}</Text>
                        <Text color={colors.lineNumOld} dimColor>
                            {String(lineNum).padStart(4)}
                        </Text>
                        <Text> │ </Text>
                        <Text>{renderSpans(diff.oldSpans, "old")}</Text>
                    </Box>
                    <Box>
                        <Text color={colors.gutterAdd}>{"+ "}</Text>
                        <Text color={colors.lineNumNew} dimColor>
                            {String(lineNum).padStart(4)}
                        </Text>
                        <Text> │ </Text>
                        <Text>{renderSpans(diff.newSpans, "new")}</Text>
                    </Box>
                </Box>
            );

        case "only_old":
            return (
                <Box>
                    <Text color={colors.gutterRemove}>{"- "}</Text>
                    <Text color={colors.lineNumOld} dimColor>
                        {String(lineNum).padStart(4)}
                    </Text>
                    <Text> │ </Text>
                    <Text color={colors.removed}>{diff.text}</Text>
                </Box>
            );

        case "only_new":
            return (
                <Box>
                    <Text color={colors.gutterAdd}>{"+ "}</Text>
                    <Text color={colors.lineNumNew} dimColor>
                        {String(lineNum).padStart(4)}
                    </Text>
                    <Text> │ </Text>
                    <Text color={colors.added}>{diff.text}</Text>
                </Box>
            );
    }
}

// ── DiffView Component ─────────────────────────────────────────────────

interface DiffViewProps {
    hunkDiff: HunkDiff;
    startLine?: number;
    colors?: DiffColors;
}

/**
 * Renders a full HunkDiff as a vertical list of diff lines.
 */
export function DiffView({
    hunkDiff,
    startLine = 1,
    colors = DEFAULT_COLORS,
}: DiffViewProps): React.ReactElement {
    return (
        <Box flexDirection="column">
            {hunkDiff.linePairs.map((pair, i) => (
                <DiffLine
                    key={i}
                    diff={pair}
                    lineNum={startLine + i}
                    colors={colors}
                />
            ))}
        </Box>
    );
}
