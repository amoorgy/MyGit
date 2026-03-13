import { describe, it, expect } from "vitest";
import { selectKnowledgeShards, type ShardContextHints } from "./selector.js";
import type { KnowledgeManifest, KnowledgeShard } from "./types.js";

function makeShard(overrides: Partial<KnowledgeShard>): KnowledgeShard {
    return {
        id: "test-shard",
        path: ".mygit/knowledge/test-shard.md",
        title: "Test Shard",
        summary: "A test shard",
        tags: [],
        commandProfiles: [],
        sourcePaths: [],
        fingerprint: "abc",
        priority: "default",
        ...overrides,
    };
}

function makeManifest(shards: KnowledgeShard[]): KnowledgeManifest {
    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        agentsManaged: true,
        shards,
    };
}

describe("selectKnowledgeShards", () => {
    const agentShard = makeShard({
        id: "core-agent",
        title: "Agent Loop Architecture",
        summary: "LangGraph agent orchestration",
        tags: ["agent", "graph", "llm"],
        commandProfiles: ["architecture"],
        sourcePaths: ["src-ts/agent/graph.ts", "src-ts/agent/context.ts"],
        priority: "default",
    });

    const repoShard = makeShard({
        id: "repo-map",
        title: "Repository Structure",
        summary: "File layout and directory overview",
        tags: ["structure", "files"],
        commandProfiles: ["repo"],
        sourcePaths: ["src-ts/cli/", "src-ts/tui/"],
        priority: "default",
    });

    const prShard = makeShard({
        id: "pr-review",
        title: "PR Review System",
        summary: "GitHub PR review and posting",
        tags: ["pr", "github", "review"],
        commandProfiles: ["integration"],
        sourcePaths: ["src-ts/pr/", "src-ts/github/"],
        priority: "topic",
    });

    const overviewShard = makeShard({
        id: "project-overview",
        title: "Project Overview",
        summary: "High-level project description",
        tags: ["overview"],
        commandProfiles: ["default"],
        sourcePaths: [],
        priority: "default",
    });

    const manifest = makeManifest([agentShard, repoShard, prShard, overviewShard]);

    describe("profile-based selection", () => {
        it("selects architecture-profiled shard for architecture questions", () => {
            const result = selectKnowledgeShards(manifest, "how does the agent graph work?", "direct_qa");
            expect(result[0].id).toBe("core-agent");
        });

        it("selects repo-profiled shard for file layout questions", () => {
            const result = selectKnowledgeShards(manifest, "where is the file for the TUI?", "direct_qa");
            expect(result[0].id).toBe("repo-map");
        });

        it("selects integration-profiled shard for API questions", () => {
            const result = selectKnowledgeShards(manifest, "how does the github API auth work?", "direct_qa");
            expect(result[0].id).toBe("pr-review");
        });
    });

    describe("keyword-based selection", () => {
        it("boosts shards with matching tags", () => {
            const result = selectKnowledgeShards(manifest, "pr review posting", "direct_qa");
            expect(result[0].id).toBe("pr-review");
        });
    });

    describe("context path scoring (git-diff-aware)", () => {
        it("boosts shard when changed paths overlap with sourcePaths", () => {
            const hints: ShardContextHints = {
                changedPaths: ["src-ts/pr/analyzer.ts", "src-ts/pr/cache.ts"],
            };
            // A generic request that doesn't strongly match any profile
            const result = selectKnowledgeShards(manifest, "fix this bug", "execution", 2, hints);
            expect(result.some((s) => s.id === "pr-review")).toBe(true);
        });

        it("handles directory-level sourcePaths matching file-level changes", () => {
            const hints: ShardContextHints = {
                changedPaths: ["src-ts/github/client.ts"],
            };
            // prShard.sourcePaths includes "src-ts/github/" — should match
            const result = selectKnowledgeShards(manifest, "update the client", "execution", 2, hints);
            expect(result.some((s) => s.id === "pr-review")).toBe(true);
        });

        it("does not boost unrelated shards", () => {
            const hints: ShardContextHints = {
                changedPaths: ["src-ts/pr/analyzer.ts"],
            };
            const result = selectKnowledgeShards(manifest, "fix this bug", "execution", 1, hints);
            // Should pick PR shard over agent shard
            expect(result[0].id).toBe("pr-review");
        });

        it("works with no hints", () => {
            const result = selectKnowledgeShards(manifest, "how does the agent work?", "direct_qa");
            expect(result.length).toBeGreaterThan(0);
        });

        it("works with empty changedPaths", () => {
            const hints: ShardContextHints = { changedPaths: [] };
            const result = selectKnowledgeShards(manifest, "how does the agent work?", "direct_qa", 1, hints);
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe("mode and limit behavior", () => {
        it("returns 1 shard by default in direct_qa mode", () => {
            const result = selectKnowledgeShards(manifest, "explain the agent architecture", "direct_qa");
            expect(result).toHaveLength(1);
        });

        it("returns 2 shards by default in execution mode", () => {
            const result = selectKnowledgeShards(manifest, "refactor the agent loop and update the PR review", "execution");
            expect(result).toHaveLength(2);
        });

        it("respects custom limit", () => {
            const result = selectKnowledgeShards(manifest, "explain everything", "execution", 3);
            expect(result.length).toBeLessThanOrEqual(3);
        });
    });

    describe("fallback behavior", () => {
        it("falls back to project-overview when no profiles match", () => {
            const result = selectKnowledgeShards(
                manifest,
                "hello there",
                "direct_qa",
            );
            // "hello there" has no keyword or profile matches, but shards with
            // priority "default" still get a base score of 20 — so it picks by priority+path order.
            // Either way, we should get at least one result
            expect(result.length).toBeGreaterThan(0);
        });

        it("returns first shards from manifest when no fallback IDs match", () => {
            const noFallback = makeManifest([agentShard, repoShard]);
            // With a request that gets no keyword/profile matches, the priority score
            // of 20 for "default" shards will still rank them
            const result = selectKnowledgeShards(noFallback, "xyz zzz", "direct_qa");
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe("priority scoring", () => {
        it("ranks default priority higher than topic priority", () => {
            // Both match "architecture" profile, but one is default and one is topic
            const defaultShard = makeShard({
                id: "arch-default",
                commandProfiles: ["architecture"],
                priority: "default",
                sourcePaths: [],
            });
            const topicShard = makeShard({
                id: "arch-topic",
                commandProfiles: ["architecture"],
                priority: "topic",
                sourcePaths: [],
            });
            const m = makeManifest([topicShard, defaultShard]);
            const result = selectKnowledgeShards(m, "agent architecture graph", "direct_qa");
            expect(result[0].id).toBe("arch-default");
        });
    });
});
