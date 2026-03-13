/**
 * Merge conflict evaluator — DEPRECATED
 *
 * The confidence scoring pipeline has been replaced by AI reasoning
 * with user approval/denial. This module is kept as a stub for
 * backward compatibility but no longer scores plans.
 *
 * Previously scored plans using algorithmic heuristics:
 *   - LLM confidence, pattern alignment, syntax heuristics
 *   - Convention adherence, simplicity
 */

import type {
    SmartSolutionPlan,
    SmartSolutionRequest,
    ScoringWeights,
    UserMergePrefs,
} from "./types.js";

export type TrustLevel = "high" | "medium" | "low";

// ── Public API (deprecated stubs) ────────────────────────────────────

/**
 * @deprecated Scoring pipeline removed. Plans now use AI reasoning + user approval.
 * This function is a no-op.
 */
export function evaluateAlgorithmic(
    _plans: SmartSolutionPlan[],
    _request: SmartSolutionRequest,
    _weights: ScoringWeights,
): void {
    // No-op — scoring pipeline removed in favor of user-driven approval
}

/**
 * @deprecated Trust levels no longer used.
 */
export function trustLevelFromScore(score: number): TrustLevel {
    if (score >= 0.75) return "high";
    if (score >= 0.45) return "medium";
    return "low";
}
