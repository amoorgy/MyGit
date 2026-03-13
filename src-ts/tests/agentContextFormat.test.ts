import { describe, it, expect } from "vitest";
import { formatContextForPrompt, type AgentContextState } from "../agent/context.js";

describe("formatContextForPrompt", () => {
    it("adds Latest Read Context with a larger truncation budget", () => {
        const ctx: AgentContextState = {
            repoRoot: "/repo",
            branch: "main",
            status: "",
            recentCommits: "",
            diffSummary: "",
            stagedSummary: "",
            fileTree: ["src-ts/agent/protocol.ts"],
            observations: [
                {
                    action: "Read src-ts/agent/protocol.ts",
                    output: "A".repeat(200),
                    success: true,
                    timestamp: Date.now(),
                },
                {
                    action: "$ echo hi",
                    output: "B".repeat(120),
                    success: true,
                    timestamp: Date.now() + 1,
                },
            ],
            planSteps: [],
            request: "",
            activeWorktree: null,
            promptMemory: { recentSessions: [] },
        };

        const text = formatContextForPrompt(ctx, {
            outputTruncation: 20,
            readOutputTruncation: 80,
            windowSize: 5,
        });

        expect(text).toContain("Latest Read Context:");
        expect(text).toContain("Read src-ts/agent/protocol.ts");
        expect(text).toContain(`${"A".repeat(80)}...`);
        // Recent Actions remains compact.
        expect(text).toContain(`[✓] $ echo hi: ${"B".repeat(20)}...`);
    });

    it("uses lighter defaults for direct_qa mode", () => {
        const ctx: AgentContextState = {
            repoRoot: "/repo",
            branch: "main",
            status: " M src/app.ts",
            recentCommits: "abc123 feat: add app",
            diffSummary: " src/app.ts | 2 +-",
            stagedSummary: " src/app.ts | 1 +",
            fileTree: Array.from({ length: 60 }, (_, i) => `src/file-${i}.ts`),
            observations: [],
            planSteps: [{ description: "step", status: "pending" }],
            request: "",
            activeWorktree: null,
            promptMemory: {
                latest: "Last: investigate auth flow\nNext: patch the login screen",
                recentSessions: [
                    "- 2026-03-07T10:00:00Z [main] inspected auth middleware",
                    "- 2026-03-06T10:00:00Z [main] reviewed login tests",
                ],
                conversationSummary: "Conversation summary that should remain available in direct QA mode.",
                conventions: "long memory block",
                workflows: "workflow block",
            },
        };

        const text = formatContextForPrompt(ctx, { mode: "direct_qa", includeMemoryContext: true });

        expect(text).not.toContain("Recent Commits");
        expect(text).not.toContain("Unstaged Changes");
        expect(text).not.toContain("Staged Changes");
        expect(text).not.toContain("Plan Progress");
        expect(text).toContain("## Project Memory");
        expect(text).toContain("Last: investigate auth flow");
        expect(text).toContain("Conversation Summary");
        expect(text).not.toContain("Project Conventions");
        expect(text).not.toContain("Known Workflows");
        expect(text).toContain("... and 40 more");
    });

    it("orders prompt memory sections and truncates project memory budget", () => {
        const ctx: AgentContextState = {
            repoRoot: "/repo",
            branch: "main",
            status: "",
            recentCommits: "",
            diffSummary: "",
            stagedSummary: "",
            fileTree: [],
            observations: [],
            planSteps: [],
            request: "",
            activeWorktree: null,
            promptMemory: {
                focus: "Ship the auth persistence rewrite first.",
                latest: `Last: ${"A".repeat(600)}`,
                recentSessions: [
                    `- 2026-03-07T10:00:00Z [main] ${"B".repeat(250)}`,
                    "- 2026-03-06T10:00:00Z [main] reviewed edge cases",
                ],
                agentMap: "AGENTS.md map content that should appear before shard details.",
                knowledgeShards: [
                    {
                        path: ".mygit/knowledge/project-overview.md",
                        title: "Project Overview",
                        content: "Overview shard content that should remain ahead of the conversation summary.",
                    },
                ],
                conversationSummary: "Conversation summary stays after project memory.",
                conventions: "Use explicit result objects.",
                workflows: "When fixing auth bugs, inspect middleware then UI.",
            },
        };

        const text = formatContextForPrompt(ctx, { mode: "execution", includeMemoryContext: true });

        expect(text.indexOf("## Focus Instructions")).toBeLessThan(text.indexOf("## Project Memory"));
        expect(text.indexOf("## Project Memory")).toBeLessThan(text.indexOf("## Agent Map"));
        expect(text.indexOf("## Agent Map")).toBeLessThan(text.indexOf("## Knowledge Shards"));
        expect(text.indexOf("## Knowledge Shards")).toBeLessThan(text.indexOf("## Conversation Summary"));
        expect(text.indexOf("## Conversation Summary")).toBeLessThan(text.indexOf("## Project Conventions"));
        expect(text).toContain("## Known Workflows");
        expect(text).toContain("...");
    });
});
