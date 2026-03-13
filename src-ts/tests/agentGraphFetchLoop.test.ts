import { describe, it, expect } from "vitest";
import { AgentEventBus } from "../agent/events.js";
import { buildAgentGraph } from "../agent/graph.js";
import { PermissionManager } from "../agent/permissions.js";

class SequenceModel {
    private idx = 0;

    constructor(private readonly outputs: string[]) {}

    async invoke(): Promise<{ content: string }> {
        const current = this.outputs[Math.min(this.idx, this.outputs.length - 1)] ?? this.outputs[0] ?? "{}";
        this.idx += 1;
        return { content: current };
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

describe("agent fetch_context loop guard", () => {
    it("blocks immediate repeated fetch_context and marks not-indexed fetch as failed", async () => {
        const model = new SequenceModel([
            JSON.stringify({
                reasoning: "Need file context first",
                action: { type: "fetch_context", query: "src-ts/agent/protocol.ts", scope: "file" },
            }),
            JSON.stringify({
                reasoning: "Need file context first",
                action: { type: "fetch_context", query: "src-ts/agent/protocol.ts", scope: "file" },
            }),
            JSON.stringify({
                reasoning: "Enough context to answer",
                action: { type: "respond", answer: "done" },
            }),
        ]);

        const graph = buildAgentGraph({
            model: model as any,
            permissions: PermissionManager.default(),
            eventBus: new AgentEventBus(),
            db: makeFakeDb() as any,
            maxIterations: 6,
            contextConfig: { enabled: true, autoIndex: false, retrievalTopK: 5, contextBudgetRatio: 0.25 },
        });

        const finalState = await graph.invoke({
            request: "Read src-ts/agent/protocol.ts and list action types",
            maxIterations: 6,
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
            permissionDecision: "allowed",
            lastActionSignature: "",
            repeatCount: 0,
            fetchCount: 0,
        }, { recursionLimit: 128 }) as any;

        const fetchObservations = finalState.context.observations.filter((o: any) =>
            String(o.action).startsWith("Fetch context:"),
        );
        expect(fetchObservations.length).toBe(1);
        expect(fetchObservations[0].success).toBe(false);

        const loopGuardTriggered = finalState.context.observations.some((o: any) =>
            o.action === "loop_guard" && String(o.output).includes("Already fetched context"),
        );
        expect(loopGuardTriggered).toBe(true);
        expect(finalState.fetchCount).toBe(0);
    });
});
