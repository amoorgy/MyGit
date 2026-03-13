export const MAX_TOOL_OUTPUT_CHARS = 5000;

export function truncateToolOutput(rawText: string, maxChars: number = MAX_TOOL_OUTPUT_CHARS): string {
    if (maxChars <= 0) return "";
    if (rawText.length <= maxChars) return rawText;
    return `${rawText.slice(0, maxChars)}…`;
}

export function formatExecutionResultText(
    success: boolean,
    output: string | null | undefined,
    error: string | null | undefined,
): string {
    const rawText = success ? (output ?? "") : (error ?? "");
    return truncateToolOutput(rawText);
}
