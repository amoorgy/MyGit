import { describe, expect, it, vi } from "vitest";
import { buildFetchSummaryRows, type FetchSummary } from "../tui/git/fetchFlow.js";

vi.mock("bun:sqlite", () => {
    class FakeDatabase {
        run() {}
        query() {
            return {
                run() {},
                all() {
                    return [];
                },
                get() {
                    return null;
                },
            };
        }
        close() {}
    }

    return { Database: FakeDatabase };
});

describe("fetch summary rows", () => {
    it("renders changed files as segmented rows", () => {
        const summary: FetchSummary = {
            command: "fetch",
            repoRoot: "/repo",
            generatedAt: "2026-03-06T12:00:00Z",
            notePath: "/repo/.mygit/updates/test-fetch.md",
            updates: [{
                branch: "main",
                status: "fast_forwarded",
                source: "current",
                beforeSha: "aaa",
                afterSha: "bbb",
                commits: ["abc update"],
                files: [{ path: "src/main.ts", additions: 8, deletions: 3 }],
            }],
            skipped: [],
        };

        const rows = buildFetchSummaryRows(summary);
        expect(rows[0]?.text).toContain("test-fetch.md");
        expect(rows[2]?.segments).toEqual([
            { text: "src/main.ts ", tone: "normal" },
            { text: "+8 ", tone: "accent" },
            { text: "-3", tone: "error" },
        ]);
    });
});
