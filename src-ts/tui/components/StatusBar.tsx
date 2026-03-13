/**
 * StatusBar — branch, model, mode, and context usage info.
 * Bottom status line with provider/model on right and context bar.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { UiPalette } from "../theme.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const THINKING_WORDS = ["thinking", "analyzing", "reasoning", "planning", "computing", "exploring"];

interface StatusBarProps {
    branch: string;
    model: string;
    provider: string;
    thinking: boolean;
    palette: UiPalette;
    tokenUsage?: { used: number; limit: number };
}

export function StatusBar({
    branch,
    model,
    provider,
    thinking,
    palette,
    tokenUsage,
}: StatusBarProps) {
    const [spinnerIdx, setSpinnerIdx] = useState(0);
    const [wordIdx, setWordIdx] = useState(0);

    useEffect(() => {
        if (!thinking) {
            setSpinnerIdx(0);
            return;
        }
        const id = setInterval(() => {
            setSpinnerIdx((i) => (i + 1) % SPINNER_FRAMES.length);
        }, 100);
        return () => clearInterval(id);
    }, [thinking]);

    useEffect(() => {
        if (!thinking) {
            setWordIdx(0);
            return;
        }
        const id = setInterval(() => {
            setWordIdx((i) => (i + 1) % THINKING_WORDS.length);
        }, 1200);
        return () => clearInterval(id);
    }, [thinking]);

    // Context bar calculation
    let contextBar: React.ReactNode = null;
    if (tokenUsage && tokenUsage.limit > 0) {
        const pct = Math.round((tokenUsage.used / tokenUsage.limit) * 100);
        const barWidth = 10;
        const filled = Math.min(barWidth, Math.round((pct / 100) * barWidth));
        const empty = barWidth - filled;

        const barColor =
            pct >= 100
                ? palette.danger
                : pct >= 80
                    ? palette.warning
                    : palette.fgDim;

        const hint = pct >= 100 ? " FULL" : pct >= 90 ? " NEAR" : "";

        contextBar = (
            <Box>
                <Text color={palette.fgMuted}>{" CTX "}</Text>
                <Text color={barColor}>
                    {"["}
                    {"\u2588".repeat(filled)}
                    {" ".repeat(empty)}
                    {"]"}
                </Text>
                <Text color={barColor}>{` ${pct}%`}</Text>
                {hint && <Text color={barColor} bold>{hint}</Text>}
            </Box>
        );
    }

    return (
        <Box paddingX={1} justifyContent="space-between">
            {/* Left side: branch + status */}
            <Box>
                <Text color={palette.success}>{"\u238B"} </Text>
                <Text color={palette.statusFg}>{branch || "no branch"}</Text>

                {thinking ? (
                    <>
                        <Text color={palette.fgMuted}> | </Text>
                        <Text color={palette.warning}>{SPINNER_FRAMES[spinnerIdx]} {THINKING_WORDS[wordIdx]}</Text>
                    </>
                ) : (
                    <>
                        <Text color={palette.fgMuted}> | </Text>
                        <Text color={palette.fgMuted}>Tip: Cmd+E to expand tools & reasoning</Text>
                    </>
                )}
            </Box>

            {/* Right side: provider / model + context bar */}
            <Box>
                <Text color={palette.fgMuted}>{provider}</Text>
                <Text color={palette.fgMuted}> / </Text>
                <Text color={palette.info}>{model}</Text>
                {contextBar}
            </Box>
        </Box>
    );
}
