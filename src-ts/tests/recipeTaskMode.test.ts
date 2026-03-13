import { describe, it, expect } from "vitest";
import { inferTaskMode } from "../agent/protocol.js";

describe("inferTaskMode — git workflow classification", () => {
    it("classifies 'fetch branch from fork' as execution", () => {
        expect(inferTaskMode("fetch the feature branch from my fork")).toBe("execution");
    });

    it("classifies 'sync my fork' as execution", () => {
        expect(inferTaskMode("sync my fork with upstream")).toBe("execution");
    });

    it("classifies 'which branch has feature' as execution (not direct_qa)", () => {
        // This was previously misclassified as direct_qa due to "which" keyword
        expect(inferTaskMode("which branch has the login feature")).toBe("execution");
    });

    it("classifies 'undo file to date' as execution", () => {
        expect(inferTaskMode("undo changes to src/main.ts back to March 13th")).toBe("execution");
    });

    it("classifies 'cherry-pick from upstream' as execution", () => {
        expect(inferTaskMode("cherry-pick commit abc123 from upstream")).toBe("execution");
    });

    it("classifies 'bisect' as execution", () => {
        expect(inferTaskMode("use bisect to find which commit broke the tests")).toBe("execution");
    });

    it("classifies 'squash commits' as execution", () => {
        expect(inferTaskMode("squash the last 5 commits")).toBe("execution");
    });

    it("classifies 'restore deleted file' as execution", () => {
        expect(inferTaskMode("restore the deleted file utils/helpers.ts")).toBe("execution");
    });

    it("still classifies plain questions as direct_qa", () => {
        expect(inferTaskMode("what does the auth middleware do?")).toBe("direct_qa");
        expect(inferTaskMode("show me the contents of README.md")).toBe("direct_qa");
    });

    it("still classifies code editing as execution", () => {
        expect(inferTaskMode("refactor the database module")).toBe("execution");
    });
});
