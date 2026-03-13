/**
 * Agent runtime helpers for loop limits and user-facing runtime errors.
 */

export function computeAgentRecursionLimit(maxIterations: number): number {
    const safeIterations = Math.max(1, maxIterations);
    // Roughly 6-8 graph nodes per loop iteration depending on branches.
    return Math.max(64, safeIterations * 8 + 24);
}

export function normalizeAgentRuntimeErrorMessage(errorLike: unknown): string {
    const raw =
        errorLike instanceof Error
            ? errorLike.message
            : typeof errorLike === "string"
                ? errorLike
                : "Agent runtime failed";

    if (
        raw.includes("GRAPH_RECURSION_LIMIT") ||
        raw.toLowerCase().includes("recursion limit")
    ) {
        return "Agent stopped after hitting the runtime recursion limit. Try a narrower request or increase max iterations.";
    }

    const withoutTroubleshooting = raw
        .split("Troubleshooting URL:")[0]
        .trim();

    return withoutTroubleshooting || "Agent runtime failed";
}

