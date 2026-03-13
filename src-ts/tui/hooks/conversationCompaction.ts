import type { BaseMessage } from "@langchain/core/messages";
import { inferTaskMode } from "../../agent/protocol.js";

const CHARS_PER_TOKEN_ESTIMATE = 4;
const DIRECT_QA_HISTORY_TOKEN_CAP = 700;
const EXECUTION_HISTORY_TOKEN_CAP = 2200;
const DIRECT_QA_MAX_TURNS = 3;
const EXECUTION_MAX_TURNS = 10;
const SUMMARY_MAX_CHARS = 2800;
const SUMMARY_LINE_LIMIT = 10;
const SUMMARY_LINE_MAX_CHARS = 220;

function messageText(message: BaseMessage): string {
    const content = (message as any).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part: unknown) => (typeof part === "string" ? part : JSON.stringify(part)))
            .join("\n");
    }
    return JSON.stringify(content);
}

function messageRoleLabel(message: BaseMessage): string {
    const type = (message as any)._getType?.();
    if (type === "human") return "user";
    if (type === "ai") return "agent";
    if (type === "system") return "system";
    return "message";
}

export function estimateMessageTokens(message: BaseMessage): number {
    return Math.ceil(messageText(message).length / CHARS_PER_TOKEN_ESTIMATE);
}

function estimateHistoryTokens(history: BaseMessage[]): number {
    return history.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

function summarizeDroppedHistory(existingSummary: string | null, dropped: BaseMessage[]): string | null {
    if (dropped.length === 0) return existingSummary;

    const lines: string[] = [];
    for (const msg of dropped) {
        if (lines.length >= SUMMARY_LINE_LIMIT) break;
        const flattened = messageText(msg).replace(/\s+/g, " ").trim();
        if (!flattened) continue;
        const clipped = flattened.length > SUMMARY_LINE_MAX_CHARS
            ? `${flattened.slice(0, SUMMARY_LINE_MAX_CHARS)}...`
            : flattened;
        lines.push(`- ${messageRoleLabel(msg)}: ${clipped}`);
    }

    const compactedBlock = [
        `Compacted ${dropped.length} earlier message(s):`,
        ...lines,
    ].join("\n");

    const combined = existingSummary?.trim()
        ? `${existingSummary.trim()}\n\n${compactedBlock}`
        : compactedBlock;

    if (combined.length <= SUMMARY_MAX_CHARS) return combined;
    const tail = combined.slice(-SUMMARY_MAX_CHARS);
    return `[Earlier summary omitted]\n${tail}`;
}

export function compactConversationForRequest(
    history: BaseMessage[],
    existingSummary: string | null,
    request: string,
): { history: BaseMessage[]; summary: string | null } {
    if (history.length === 0) {
        return { history, summary: existingSummary };
    }

    const mode = inferTaskMode(request);
    const maxTurns = mode === "direct_qa" ? DIRECT_QA_MAX_TURNS : EXECUTION_MAX_TURNS;
    const tokenCap = mode === "direct_qa" ? DIRECT_QA_HISTORY_TOKEN_CAP : EXECUTION_HISTORY_TOKEN_CAP;

    let kept = history.slice(-(maxTurns * 2));
    while (kept.length > 2 && estimateHistoryTokens(kept) > tokenCap) {
        kept = kept.slice(2);
    }

    const droppedCount = Math.max(0, history.length - kept.length);
    const dropped = history.slice(0, droppedCount);
    const summary = summarizeDroppedHistory(existingSummary, dropped);

    return { history: kept, summary };
}

