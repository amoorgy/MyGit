import { beforeEach, describe, expect, it, vi } from "vitest";

const getContextIndexStatsMock = vi.fn();
const closeMock = vi.fn();
const refreshFilesMock = vi.fn();
const loadKnowledgeManifestMock = vi.fn();
const compileKnowledgeStoreMock = vi.fn();
const writeKnowledgeStoreMock = vi.fn();

vi.mock("../storage/database.js", () => ({
    openProjectDatabaseAt: vi.fn(() => ({
        getContextIndexStats: getContextIndexStatsMock,
        close: closeMock,
    })),
}));

vi.mock("../context/indexer.js", () => ({
    ProjectIndexer: class {
        async refreshFiles(repoRoot: string, relativePaths: string[]) {
            return await refreshFilesMock(repoRoot, relativePaths);
        }
    },
}));

vi.mock("../knowledge/store.js", () => ({
    loadKnowledgeManifest: (...args: any[]) => loadKnowledgeManifestMock(...args),
    writeKnowledgeStore: (...args: any[]) => writeKnowledgeStoreMock(...args),
}));

vi.mock("../knowledge/compiler.js", () => ({
    compileKnowledgeStore: (...args: any[]) => compileKnowledgeStoreMock(...args),
}));

import { refreshIndexedFiles } from "../context/autoIndex.js";

class CountingModel {
    public calls = 0;

    async invoke(): Promise<{ content: string }> {
        this.calls += 1;
        return { content: "Concise file summary." };
    }
}

describe("incremental auto index refresh", () => {
    beforeEach(() => {
        getContextIndexStatsMock.mockReset();
        closeMock.mockReset();
        refreshFilesMock.mockReset();
        loadKnowledgeManifestMock.mockReset();
        compileKnowledgeStoreMock.mockReset();
        writeKnowledgeStoreMock.mockReset();
    });

    it("skips refresh when no index exists yet", async () => {
        getContextIndexStatsMock.mockReturnValue({ totalChunks: 0 });

        const result = await refreshIndexedFiles({
            repoRoot: "/repo",
            model: new CountingModel() as any,
            contextConfig: { enabled: true, autoIndex: true },
            relativePaths: ["src/example.ts"],
        });

        expect(result.skipped).toBe(true);
        expect(result.reason).toBe("index_missing");
        expect(refreshFilesMock).not.toHaveBeenCalled();
        expect(closeMock).toHaveBeenCalledTimes(1);
    });

    it("refreshes only the provided touched files", async () => {
        getContextIndexStatsMock.mockReturnValue({ totalChunks: 2 });
        loadKnowledgeManifestMock.mockResolvedValue({
            version: 1,
            generatedAt: "2026-03-07T00:00:00.000Z",
            agentsManaged: true,
            shards: [],
        });
        refreshFilesMock.mockResolvedValue([
            { filePath: "src/a.ts", chunks: 1, status: "indexed" },
        ]);
        compileKnowledgeStoreMock.mockResolvedValue({ manifest: { shards: [] }, shards: [], agentMap: "" });
        writeKnowledgeStoreMock.mockResolvedValue({});

        const result = await refreshIndexedFiles({
            repoRoot: "/repo",
            model: new CountingModel() as any,
            contextConfig: { enabled: true, autoIndex: true },
            relativePaths: ["src/a.ts", ".mygit/MYGIT.md", "src/a.ts"],
        });

        expect(result.skipped).toBe(false);
        expect(result.attempted).toBe(1);
        expect(result.refreshed).toBe(1);
        expect(refreshFilesMock).toHaveBeenCalledWith("/repo", ["src/a.ts"]);
        expect(compileKnowledgeStoreMock).toHaveBeenCalled();
        expect(writeKnowledgeStoreMock).toHaveBeenCalled();
        expect(closeMock).toHaveBeenCalledTimes(1);
    });
});
