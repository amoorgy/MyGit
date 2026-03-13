import { describe, it, expect } from "vitest";
import { inferExecutionInitPolicy, inferTaskMode } from "../agent/protocol.js";

describe("inferTaskMode", () => {
    it("classifies direct file question prompts as direct_qa", () => {
        const mode = inferTaskMode(
            "Read the file src-ts/agent/protocol.ts and tell me what action types the agent supports",
        );
        expect(mode).toBe("direct_qa");
    });

    it("classifies implementation prompts as execution", () => {
        const mode = inferTaskMode(
            "Implement caching in src/api/cache.ts and update tests.",
        );
        expect(mode).toBe("execution");
    });

    it("classifies generic informational questions as direct_qa", () => {
        const mode = inferTaskMode(
            "what is the main entry point of the typescript project",
        );
        expect(mode).toBe("direct_qa");
    });

    it("keeps implementation how-to questions in execution mode", () => {
        const mode = inferTaskMode(
            "How should I implement caching for the API layer?",
        );
        expect(mode).toBe("execution");
    });
});

describe("inferExecutionInitPolicy", () => {
    it("uses light policy for focused requests", () => {
        const policy = inferExecutionInitPolicy("Fix a typo in README.md");
        expect(policy).toBe("light");
    });

    it("uses full policy for multi-file or broad refactors", () => {
        const policy = inferExecutionInitPolicy(
            "Refactor src/api/cache.ts and src/api/client.ts across the whole repo",
        );
        expect(policy).toBe("full");
    });
});
