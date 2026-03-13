/**
 * ClarifyPanel — overlay for when the agent needs clarification from the user.
 */

import React, { useState } from "react";
import { Box, Text } from "ink";
import type { UiPalette } from "../theme.js";
import { CustomTextInput } from "./CustomTextInput.js";

interface ClarifyPanelProps {
    question: string;
    onRespond: (answer: string) => void;
    palette: UiPalette;
}

export function ClarifyPanel({ question, onRespond, palette }: ClarifyPanelProps) {
    const [inputValue, setInputValue] = useState("");

    const handleSubmit = (value: string) => {
        const trimmed = value.trim();
        if (trimmed) {
            onRespond(trimmed);
        }
    };

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={palette.info}
            paddingX={2}
            paddingY={1}
        >
            <Text color={palette.info} bold>
                Agent needs clarification:
            </Text>

            <Box marginTop={1} marginBottom={1}>
                <Text color={palette.fg} wrap="wrap">
                    {question}
                </Text>
            </Box>

            <Box>
                <Text color={palette.fgDim}>Your answer: </Text>
                <CustomTextInput
                    value={inputValue}
                    onChange={setInputValue}
                    onSubmit={handleSubmit}
                    placeholder="Type your clarification here..."
                    focus={true}
                />
            </Box>

            <Box marginTop={1}>
                <Text color={palette.fgMuted}>[Enter] Submit</Text>
            </Box>
        </Box>
    );
}
