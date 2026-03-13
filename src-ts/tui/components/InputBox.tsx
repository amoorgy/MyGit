/**
 * InputBox — text input with prompt indicator.
 * Uses CustomTextInput for reliable key handling under Bun.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { CustomTextInput } from "./CustomTextInput.js";
import type { UiPalette } from "../theme.js";

const PROC_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface InputBoxProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    isProcessing: boolean;
    isThoughtMode?: boolean;
    palette: UiPalette;
    placeholder?: string;
}

export function InputBox({
    value,
    onChange,
    onSubmit,
    isProcessing,
    isThoughtMode,
    palette,
    placeholder,
}: InputBoxProps) {
    const [frameIdx, setFrameIdx] = useState(0);

    useEffect(() => {
        if (!isProcessing) {
            setFrameIdx(0);
            return;
        }
        const id = setInterval(() => {
            setFrameIdx((i) => (i + 1) % PROC_FRAMES.length);
        }, 100);
        return () => clearInterval(id);
    }, [isProcessing]);

    const borderColor = isProcessing
        ? palette.warning
        : isThoughtMode
            ? palette.info
            : palette.borderActive;

    const promptColor = isThoughtMode ? palette.info : palette.accent;

    const defaultPlaceholder = isThoughtMode
        ? "Describe what you want to think through..."
        : "Ask me anything...";

    return (
        <Box
            width="100%"
            borderStyle="round"
            borderColor={borderColor}
            paddingX={1}
        >
            {isThoughtMode && (
                <Text color={palette.info} bold>{"[PLAN] "}</Text>
            )}
            <Text color={promptColor} bold>
                {"❯ "}
            </Text>
            {isProcessing ? (
                <Text color={palette.warning}>
                    {PROC_FRAMES[frameIdx]}{" processing"}
                </Text>
            ) : (
                <CustomTextInput
                    value={value}
                    onChange={onChange}
                    onSubmit={onSubmit}
                    placeholder={placeholder ?? defaultPlaceholder}
                />
            )}
        </Box>
    );
}
