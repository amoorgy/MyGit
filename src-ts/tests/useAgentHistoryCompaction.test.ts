import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
    compactConversationForRequest,
    estimateMessageTokens,
} from "../tui/hooks/conversationCompaction.js";

function makeLongHistory(turns: number): Array<HumanMessage | AIMessage> {
    const history: Array<HumanMessage | AIMessage> = [];
    for (let i = 0; i < turns; i++) {
        history.push(new HumanMessage(`user turn ${i} ` + "x".repeat(220)));
        history.push(new AIMessage(`agent turn ${i} ` + "y".repeat(220)));
    }
    return history;
}

describe("useAgent history compaction", () => {
    it("estimates message tokens with non-zero value", () => {
        const tokens = estimateMessageTokens(new HumanMessage("hello world"));
        expect(tokens).toBeGreaterThan(0);
    });

    it("compacts direct_qa history more aggressively and updates summary", () => {
        const history = makeLongHistory(12);
        const compacted = compactConversationForRequest(
            history,
            null,
            "what is the main entry point of the typescript project",
        );

        expect(compacted.history.length).toBeLessThanOrEqual(6);
        expect(compacted.summary).toContain("Compacted");
    });

    it("keeps broader history window for execution requests", () => {
        const history = makeLongHistory(12);
        const direct = compactConversationForRequest(
            history,
            null,
            "what is the main entry point of the typescript project",
        );
        const execution = compactConversationForRequest(
            history,
            null,
            "Implement caching in src/api/cache.ts and update tests",
        );

        expect(execution.history.length).toBeGreaterThanOrEqual(direct.history.length);
    });

    it("folds newly dropped turns into existing summary", () => {
        const history = makeLongHistory(8);
        const compacted = compactConversationForRequest(
            history,
            "Previous summary line.",
            "what is the architecture here?",
        );

        expect(compacted.summary).toContain("Previous summary line.");
        expect(compacted.summary).toContain("Compacted");
    });
});
