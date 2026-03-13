import { describe, expect, it } from "vitest";
import type { BaseMessage } from "@langchain/core/messages";
import { AgentEventBus } from "../agent/events.js";
import { buildAgentGraph } from "../agent/graph.js";
import { PermissionManager } from "../agent/permissions.js";

class CapturingModel {
    public calls: BaseMessage[][] = [];

    async invoke(messages: BaseMessage[]): Promise<{ content: string }> {
        this.calls.push(messages);
        return {
            content: JSON.stringify({
                reasoning: "Enough context to answer",
                action: { type: "respond", answer: "ok" },
            }),
        };
    }
}

function makeFakeDb() {
    return {
        loadConventions: () => [],
        findWorkflows: () => [],
        getContextIndexStats: () => ({ totalFiles: 0, totalChunks: 0, lastIndexed: null }),
        getCorpusStats: () => ({ totalDocs: 0, avgDocLength: 0 }),
        getTermDocs: () => [],
        getContextChunkById: () => null,
        getDirSummary: () => null,
        getAllDirSummaries: () => [],
        getContextChunk: () => null,
        getContextChunksForFile: () => [],
    };
}

function initialState(request: string) {
    return {
        request,
        maxIterations: 4,
        dryRun: false,
        showThinking: false,
        context: {
            repoRoot: process.cwd(),
            branch: "",
            status: "",
            recentCommits: "",
            diffSummary: "",
            stagedSummary: "",
            fileTree: [],
            observations: [],
            planSteps: [],
            request: "",
            activeWorktree: null,
            promptMemory: { recentSessions: [] },
        },
        iteration: 0,
        parseFailures: 0,
        done: false,
        currentAction: null,
        currentReasoning: "",
        llmRawResponse: "",
        permissionDecision: "allowed" as const,
        lastActionSignature: "",
        repeatCount: 0,
        fetchCount: 0,
    };
}

describe("agent graph prompt/budget behavior", () => {
    it("reports token usage against configured context window", async () => {
        const model = new CapturingModel();
        const bus = new AgentEventBus();
        const tokenEvents: Array<{ used: number; limit: number }> = [];
        bus.on((event) => {
            if (event.type === "token_usage") tokenEvents.push({ used: event.used, limit: event.limit });
        });

        const graph = buildAgentGraph({
            model: model as any,
            permissions: PermissionManager.default(),
            eventBus: bus,
            db: makeFakeDb() as any,
            maxIterations: 4,
            contextWindow: 4096,
            contextConfig: { enabled: true, autoIndex: false, retrievalTopK: 5, contextBudgetRatio: 0.25 },
        });

        await graph.invoke(initialState("what is the main entry point of the typescript project"), {
            recursionLimit: 128,
        });

        expect(tokenEvents.length).toBeGreaterThan(0);
        expect(tokenEvents[0]?.limit).toBe(4096);
    });

    it("injects task mode and execution init policy into runtime state", async () => {
        const model = new CapturingModel();
        const graph = buildAgentGraph({
            model: model as any,
            permissions: PermissionManager.default(),
            eventBus: new AgentEventBus(),
            db: makeFakeDb() as any,
            maxIterations: 4,
            contextConfig: { enabled: true, autoIndex: false, retrievalTopK: 5, contextBudgetRatio: 0.25 },
        });

        await graph.invoke(initialState("Implement cache in src/a.ts and src/b.ts across the repo"), {
            recursionLimit: 128,
        });

        const firstCall = model.calls[0] ?? [];
        const humanPrompt = firstCall.find((m: any) => m._getType?.() === "human") as any;
        const content = typeof humanPrompt?.content === "string"
            ? humanPrompt.content
            : JSON.stringify(humanPrompt?.content);

        expect(content).toContain("Task Mode: execution");
        expect(content).toContain("Execution Init Policy: full");
    });
});
