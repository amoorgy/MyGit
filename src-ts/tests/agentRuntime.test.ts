import { describe, it, expect } from "vitest";
import {
    computeAgentRecursionLimit,
    normalizeAgentRuntimeErrorMessage,
} from "../agent/runtime.js";

describe("agent runtime helpers", () => {
    it("scales recursion limit with maxIterations and keeps a floor", () => {
        expect(computeAgentRecursionLimit(1)).toBeGreaterThanOrEqual(64);
        expect(computeAgentRecursionLimit(15)).toBeGreaterThan(computeAgentRecursionLimit(5));
    });

    it("normalizes recursion-limit runtime errors", () => {
        const msg = normalizeAgentRuntimeErrorMessage(
            new Error("GRAPH_RECURSION_LIMIT: hit limit\nTroubleshooting URL: https://example.com"),
        );
        expect(msg).toContain("runtime recursion limit");
        expect(msg).not.toContain("Troubleshooting URL");
    });

    it("strips troubleshooting URLs from generic runtime errors", () => {
        const msg = normalizeAgentRuntimeErrorMessage(
            "Some error happened\nTroubleshooting URL: https://example.com",
        );
        expect(msg).toBe("Some error happened");
    });
});

