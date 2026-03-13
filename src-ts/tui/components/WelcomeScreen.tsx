/**
 * WelcomeScreen — renders the ASCII logo and starter tips.
 * Responsive: picks logo variant based on terminal width and theme preference.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { UiPalette } from "../theme.js";
import { blendColors } from "../theme.js";
import { selectLogo } from "../logos.js";

const STARTER_TIPS = [
    { key: "commit changes", desc: "Generate a context-aware commit message" },
    { key: "explain HEAD", desc: "Explain the latest commit" },
    { key: "what branch am I on?", desc: "Quick repo status check" },
    { key: "/pr", desc: "Open PR inbox for review + GitHub posting" },
    { key: "/", desc: "Open the command menu" },
    { key: "Cmd+E", desc: "Toggle expand tools & reasoning" },
];

interface WelcomeScreenProps {
    palette: UiPalette;
    width: number;
    height: number;
}

export function WelcomeScreen({ palette, width, height }: WelcomeScreenProps) {
    const logo = selectLogo(width - 4, palette.logoFont);
    const showTips = height >= 15;

    const [phase, setPhase] = useState(0);

    useEffect(() => {
        const id = setInterval(() => {
            setPhase((p) => (p + 0.03) % 1.0);
        }, 80);
        return () => clearInterval(id);
    }, []);

    return (
        <Box flexDirection="column" alignItems="center" paddingY={1}>
            {/* Logo with animated shimmer gradient */}
            {logo.map((line, i) => {
                if (line === "") return <Text key={i}>{" "}</Text>;
                const baseT = i / Math.max(logo.length - 1, 1);
                const t = (baseT + phase) % 1.0;
                let color: string;
                if (t < 0.5) {
                    color = blendColors(palette.logoTop, palette.logoMid, t * 2);
                } else {
                    color = blendColors(palette.logoMid, palette.logoBottom, (t - 0.5) * 2);
                }
                return (
                    <Text key={i} color={color} bold>
                        {line}
                    </Text>
                );
            })}

            {/* Starter tips — hidden if terminal is too short */}
            {showTips && (
                <Box
                    flexDirection="column"
                    marginTop={2}
                    paddingX={2}
                    borderStyle="round"
                    borderColor={palette.border}
                >
                    <Text color={palette.accent} bold>
                        Tips for getting started
                    </Text>
                    <Box marginTop={1} flexDirection="column">
                        {STARTER_TIPS.map((tip) => (
                            <Box key={tip.key} marginBottom={0}>
                                <Text color={palette.info} bold>
                                    {"  "}
                                    {tip.key}
                                </Text>
                                <Text color={palette.fgDim}> — {tip.desc}</Text>
                            </Box>
                        ))}
                    </Box>
                </Box>
            )}
        </Box>
    );
}
