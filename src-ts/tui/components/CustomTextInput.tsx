/**
 * CustomTextInput — reliable text input with cursor support.
 * Replaces ink-text-input which has backspace issues under Bun.
 *
 * Supports: cursor movement, backspace, delete, home/end, printable chars.
 */

import React, { useState, useEffect } from "react";
import { Text, useInput } from "ink";

interface CustomTextInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    placeholder?: string;
    focus?: boolean;
    /** If set, each character is rendered as this character (e.g. "*" for passwords). */
    mask?: string;
}

export function CustomTextInput({
    value,
    onChange,
    onSubmit,
    placeholder = "",
    focus = true,
    mask,
}: CustomTextInputProps) {
    const [cursorPos, setCursorPos] = useState(value.length);

    // Keep cursor within bounds when value changes externally
    useEffect(() => {
        setCursorPos((prev) => Math.min(prev, value.length));
    }, [value]);

    useInput(
        (input, key) => {
            if (!focus) return;

            // Submit
            if (key.return) {
                onSubmit(value);
                return;
            }

            // Backspace
            if (key.backspace || key.delete) {
                if (cursorPos > 0) {
                    const next = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
                    setCursorPos(cursorPos - 1);
                    onChange(next);
                }
                return;
            }

            // Left arrow
            if (key.leftArrow) {
                setCursorPos(Math.max(0, cursorPos - 1));
                return;
            }

            // Right arrow
            if (key.rightArrow) {
                setCursorPos(Math.min(value.length, cursorPos + 1));
                return;
            }

            // Home (Ctrl+A)
            if (key.ctrl && input === "a") {
                setCursorPos(0);
                return;
            }

            // End (Ctrl+E)
            if (key.ctrl && input === "e") {
                setCursorPos(value.length);
                return;
            }

            // Kill to end (Ctrl+K)
            if (key.ctrl && input === "k") {
                onChange(value.slice(0, cursorPos));
                return;
            }

            // Kill to start (Ctrl+U)
            if (key.ctrl && input === "u") {
                onChange(value.slice(cursorPos));
                setCursorPos(0);
                return;
            }

            // Delete forward (Ctrl+D)
            if (key.ctrl && input === "d") {
                if (cursorPos < value.length) {
                    const next = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
                    onChange(next);
                }
                return;
            }

            // Skip non-printable / control sequences
            if (key.ctrl || key.meta || key.escape || key.upArrow || key.downArrow || key.tab) {
                return;
            }

            // Printable character — reject any control/escape bytes that
            // leaked through the stdin filter as a safety net.
            if (input && input.length > 0) {
                if (/[\x00-\x08\x0e-\x1f\x7f\x80-\x9f]/.test(input)) {
                    return;
                }
                const next = value.slice(0, cursorPos) + input + value.slice(cursorPos);
                setCursorPos(cursorPos + input.length);
                onChange(next);
            }
        },
        { isActive: focus },
    );

    // Render text with cursor
    if (value.length === 0) {
        return (
            <Text>
                <Text inverse> </Text>
                <Text dimColor>{placeholder}</Text>
            </Text>
        );
    }

    const display = mask ? mask.repeat(value.length) : value;
    const beforeCursor = display.slice(0, cursorPos);
    const cursorChar = cursorPos < display.length ? display[cursorPos] : " ";
    const afterCursor = cursorPos < display.length ? display.slice(cursorPos + 1) : "";

    return (
        <Text>
            {beforeCursor}
            <Text inverse>{cursorChar}</Text>
            {afterCursor}
        </Text>
    );
}
