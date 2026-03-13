import { describe, it, expect } from "vitest";
import { ContextRetriever } from "../context/retriever.js";

describe("ContextRetriever.getFileSummary", () => {
    it("aggregates up to three chunks for file-scoped summaries", () => {
        const fakeDb = {
            getContextChunksForFile: (_filePath: string, limit: number) =>
                [
                    { chunk_index: 0, summary: "first chunk", file_path: "a.ts" },
                    { chunk_index: 1, summary: "second chunk", file_path: "a.ts" },
                    { chunk_index: 2, summary: "third chunk", file_path: "a.ts" },
                    { chunk_index: 3, summary: "fourth chunk", file_path: "a.ts" },
                ].slice(0, limit),
        };

        const retriever = new ContextRetriever(fakeDb as any);
        const summary = retriever.getFileSummary("a.ts");

        expect(summary).toContain("Aggregated summary from 3 indexed chunks");
        expect(summary).toContain("chunk 1: first chunk");
        expect(summary).toContain("chunk 2: second chunk");
        expect(summary).toContain("chunk 3: third chunk");
        expect(summary).not.toContain("fourth chunk");
    });
});
