import { describe, expect, it } from "vitest";
import type { KnowledgeManifest } from "../knowledge/types.js";
import { selectKnowledgeShards } from "../knowledge/selector.js";

const manifest: KnowledgeManifest = {
    version: 1,
    generatedAt: "2026-03-07T00:00:00.000Z",
    agentsManaged: true,
    shards: [
        {
            id: "project-overview",
            path: "project-overview.md",
            title: "Project Overview",
            summary: "Repo purpose and layout.",
            tags: ["overview", "repo"],
            commandProfiles: ["default"],
            sourcePaths: ["README.md"],
            fingerprint: "a",
            priority: "default",
        },
        {
            id: "repo-map",
            path: "repo-map.md",
            title: "Repo Map",
            summary: "Key paths and hotspots.",
            tags: ["repo", "paths"],
            commandProfiles: ["repo"],
            sourcePaths: ["src-ts"],
            fingerprint: "b",
            priority: "default",
        },
        {
            id: "workflow-map",
            path: "workflow-map.md",
            title: "Workflow Map",
            summary: "Build and test flows.",
            tags: ["workflow", "test", "build"],
            commandProfiles: ["workflow"],
            sourcePaths: ["package.json"],
            fingerprint: "c",
            priority: "topic",
        },
    ],
};

describe("knowledge shard selection", () => {
    it("falls back to project overview for direct_qa", () => {
        const selected = selectKnowledgeShards(manifest, "what does this repo do?", "direct_qa", 1);
        expect(selected).toHaveLength(1);
        expect(selected[0].id).toBe("project-overview");
    });

    it("prefers workflow shards for command-oriented requests", () => {
        const selected = selectKnowledgeShards(manifest, "how do I run the tests and build this project?", "execution", 2);
        expect(selected[0].id).toBe("workflow-map");
    });
});

