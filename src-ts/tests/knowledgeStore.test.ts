import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { compileKnowledgeStore } from "../knowledge/compiler.js";
import {
    GENERATED_AGENT_MAP_NAME,
    loadKnowledgeManifest,
    rootAgentMapPath,
    writeKnowledgeStore,
} from "../knowledge/store.js";

async function makeTempRepo(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), "mygit-knowledge-"));
}

function fakeDb() {
    return {
        getAllContextChunks() {
            return [
                {
                    file_path: "src-ts/agent/graph.ts",
                    chunk_index: 0,
                    language: "typescript",
                    summary: "Builds the agent graph and loads prompt context.",
                    keywords: "",
                    token_count: 40,
                    git_hash: "abc",
                    last_indexed: "2026-03-07T00:00:00.000Z",
                },
                {
                    file_path: "src-ts/context/indexer.ts",
                    chunk_index: 0,
                    language: "typescript",
                    summary: "Indexes the repository into BM25 and directory summaries.",
                    keywords: "",
                    token_count: 40,
                    git_hash: "def",
                    last_indexed: "2026-03-07T00:00:00.000Z",
                },
            ];
        },
        getAllDirSummaries() {
            return [
                {
                    dir_path: "src-ts/agent",
                    summary: "Agent loop, prompt assembly, and runtime control.",
                    child_count: 4,
                    last_indexed: "2026-03-07T00:00:00.000Z",
                },
            ];
        },
    };
}

describe("knowledge store", () => {
    it("compiles and writes the managed AGENTS map and shard manifest", async () => {
        const repoRoot = await makeTempRepo();
        await fs.writeFile(path.join(repoRoot, "README.md"), "# MyGit\n\nAI-powered git workflow tool.\n", "utf-8");
        await fs.writeFile(
            path.join(repoRoot, "package.json"),
            JSON.stringify({
                scripts: { test: "vitest run", build: "bun build index.tsx" },
                dependencies: { "@langchain/core": "^1.0.0", openai: "^4.0.0" },
            }, null, 2),
            "utf-8",
        );
        await fs.mkdir(path.join(repoRoot, "docs"), { recursive: true });
        await fs.writeFile(path.join(repoRoot, "docs", "architecture.md"), "# Architecture\n\nAgent graph lives in src-ts.\n", "utf-8");

        const compiled = await compileKnowledgeStore({ repoRoot, db: fakeDb() as any });
        const result = await writeKnowledgeStore(repoRoot, compiled);
        const manifest = await loadKnowledgeManifest(repoRoot);
        const rootAgents = await fs.readFile(rootAgentMapPath(repoRoot), "utf-8");

        expect(result.agentsManaged).toBe(true);
        expect(manifest?.shards.some((shard) => shard.id === "project-overview")).toBe(true);
        expect(rootAgents).toContain("Managed by mygit");
        expect(rootAgents).toContain(".mygit/knowledge/project-overview.md");
    });

    it("preserves a custom root AGENTS.md and writes a generated fallback", async () => {
        const repoRoot = await makeTempRepo();
        await fs.writeFile(path.join(repoRoot, "README.md"), "# Repo\n\nCustom agent instructions.\n", "utf-8");
        await fs.writeFile(path.join(repoRoot, "AGENTS.md"), "# AGENTS.md\nCustom content\n", "utf-8");

        const compiled = await compileKnowledgeStore({ repoRoot, db: fakeDb() as any });
        const result = await writeKnowledgeStore(repoRoot, compiled);
        const rootAgents = await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf-8");
        const generated = await fs.readFile(path.join(repoRoot, ".mygit", "knowledge", GENERATED_AGENT_MAP_NAME), "utf-8");

        expect(result.agentsManaged).toBe(false);
        expect(result.warning).toContain("not mygit-managed");
        expect(rootAgents).toBe("# AGENTS.md\nCustom content\n");
        expect(generated).toContain("Managed by mygit");
    });
});
