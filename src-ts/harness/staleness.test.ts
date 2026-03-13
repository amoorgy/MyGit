import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeManifest } from "../knowledge/types.js";

// Mock execa and fs before importing the module
vi.mock("execa", () => ({
    execa: vi.fn(),
}));

vi.mock("fs/promises", () => ({
    access: vi.fn(),
}));

import { checkKnowledgeStaleness, quickStalenessCheck } from "./staleness.js";
import { execa } from "execa";
import * as fs from "fs/promises";

const mockedExeca = vi.mocked(execa);
const mockedAccess = vi.mocked(fs.access);

function makeManifest(overrides: Partial<KnowledgeManifest> = {}): KnowledgeManifest {
    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        agentsManaged: true,
        shards: [
            {
                id: "core-agent",
                path: ".mygit/knowledge/core-agent.md",
                title: "Core Agent",
                summary: "Agent loop",
                tags: ["agent"],
                commandProfiles: ["architecture"],
                sourcePaths: ["src-ts/agent/graph.ts", "src-ts/agent/context.ts"],
                fingerprint: "abc123",
                priority: "default",
            },
        ],
        ...overrides,
    };
}

describe("staleness", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe("checkKnowledgeStaleness", () => {
        it("reports fresh when few commits and all paths exist", async () => {
            mockedExeca.mockResolvedValue({ stdout: "3" } as any);
            mockedAccess.mockResolvedValue(undefined);

            const manifest = makeManifest({
                generatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
            });

            const report = await checkKnowledgeStaleness("/repo", manifest);

            expect(report.overall).toBe("fresh");
            expect(report.commitsSinceCompile).toBe(3);
            expect(report.daysSinceCompile).toBe(2);
            expect(report.shardReports).toHaveLength(0);
            expect(report.recommendation).toContain("up to date");
        });

        it("reports aging when moderate commits", async () => {
            mockedExeca.mockResolvedValue({ stdout: "15" } as any);
            mockedAccess.mockResolvedValue(undefined);

            const manifest = makeManifest({
                generatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days ago
            });

            const report = await checkKnowledgeStaleness("/repo", manifest);

            expect(report.overall).toBe("aging");
            expect(report.recommendation).toContain("Consider running");
        });

        it("reports stale when many commits", async () => {
            mockedExeca.mockResolvedValue({ stdout: "45" } as any);
            mockedAccess.mockResolvedValue(undefined);

            const manifest = makeManifest({
                generatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
            });

            const report = await checkKnowledgeStaleness("/repo", manifest);

            expect(report.overall).toBe("stale");
            expect(report.recommendation).toContain("stale");
            expect(report.recommendation).toContain("mygit init");
        });

        it("reports stale when high missing source path ratio", async () => {
            mockedExeca.mockResolvedValue({ stdout: "2" } as any);
            // Both source paths are missing
            mockedAccess.mockRejectedValue(new Error("ENOENT"));

            const manifest = makeManifest({
                generatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            });

            const report = await checkKnowledgeStaleness("/repo", manifest);

            expect(report.overall).toBe("stale"); // 100% missing > 0.3 threshold
            expect(report.shardReports).toHaveLength(1);
            expect(report.shardReports[0].id).toBe("core-agent");
            expect(report.shardReports[0].missingSourcePaths).toHaveLength(2);
            expect(report.recommendation).toContain("missing source paths");
        });

        it("handles manifest with no shards", async () => {
            mockedExeca.mockResolvedValue({ stdout: "5" } as any);

            const manifest = makeManifest({
                shards: [],
                generatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            });

            const report = await checkKnowledgeStaleness("/repo", manifest);

            expect(report.overall).toBe("fresh");
            expect(report.shardReports).toHaveLength(0);
        });

        it("handles git command failure gracefully", async () => {
            mockedExeca.mockRejectedValue(new Error("git not found"));
            mockedAccess.mockResolvedValue(undefined);

            const manifest = makeManifest({
                generatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            });

            const report = await checkKnowledgeStaleness("/repo", manifest);

            // Should default to 0 commits when git fails
            expect(report.commitsSinceCompile).toBe(0);
            expect(report.overall).toBe("fresh");
        });

        it("partially missing paths still counted correctly", async () => {
            mockedExeca.mockResolvedValue({ stdout: "5" } as any);
            // First path exists, second doesn't
            mockedAccess
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error("ENOENT"));

            const manifest = makeManifest({
                generatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            });

            const report = await checkKnowledgeStaleness("/repo", manifest);

            expect(report.shardReports).toHaveLength(1);
            expect(report.shardReports[0].missingSourcePaths).toHaveLength(1);
            expect(report.shardReports[0].missingSourcePaths[0]).toBe("src-ts/agent/context.ts");
        });
    });

    describe("quickStalenessCheck", () => {
        it("returns not stale when under 20 commits", async () => {
            mockedExeca.mockResolvedValue({ stdout: "10" } as any);
            const manifest = makeManifest();

            const result = await quickStalenessCheck("/repo", manifest);

            expect(result.stale).toBe(false);
            expect(result.note).toBeUndefined();
        });

        it("returns stale when over 20 commits", async () => {
            mockedExeca.mockResolvedValue({ stdout: "25" } as any);
            const manifest = makeManifest();

            const result = await quickStalenessCheck("/repo", manifest);

            expect(result.stale).toBe(true);
            expect(result.note).toContain("~25 commits behind");
            expect(result.note).toContain("mygit init");
        });

        it("returns not stale when exactly 20 commits", async () => {
            mockedExeca.mockResolvedValue({ stdout: "20" } as any);
            const manifest = makeManifest();

            const result = await quickStalenessCheck("/repo", manifest);

            expect(result.stale).toBe(false);
        });

        it("handles git failure gracefully", async () => {
            mockedExeca.mockRejectedValue(new Error("not a git repo"));
            const manifest = makeManifest();

            const result = await quickStalenessCheck("/repo", manifest);

            expect(result.stale).toBe(false);
        });
    });
});
