import { describe, expect, it } from "vitest";
import {
    formatExecutionResultText,
    MAX_TOOL_OUTPUT_CHARS,
    truncateToolOutput,
} from "../tui/hooks/toolOutput.js";

describe("useAgent tool output formatting", () => {
    it("leaves short output unchanged", () => {
        expect(truncateToolOutput("ok")).toBe("ok");
    });

    it("truncates long output to 5000 characters plus ellipsis", () => {
        const long = "a".repeat(MAX_TOOL_OUTPUT_CHARS + 25);
        const truncated = truncateToolOutput(long);

        expect(truncated.length).toBe(MAX_TOOL_OUTPUT_CHARS + 1);
        expect(truncated.endsWith("…")).toBe(true);
        expect(truncated.slice(0, MAX_TOOL_OUTPUT_CHARS)).toBe("a".repeat(MAX_TOOL_OUTPUT_CHARS));
    });

    it("uses the same truncation for success and error execution results", () => {
        const successText = "b".repeat(MAX_TOOL_OUTPUT_CHARS + 10);
        const errorText = "c".repeat(MAX_TOOL_OUTPUT_CHARS + 10);

        const successFormatted = formatExecutionResultText(true, successText, "ignored");
        const errorFormatted = formatExecutionResultText(false, "ignored", errorText);

        expect(successFormatted).toBe(truncateToolOutput(successText));
        expect(errorFormatted).toBe(truncateToolOutput(errorText));
    });
});
