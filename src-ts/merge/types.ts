/**
 * Merge conflict types — ported from Rust src/merge/mod.rs + smart.rs
 */

// ── Conflict Structures ────────────────────────────────────────────────

export interface ConflictFile {
    path: string;
    hunks: ConflictHunk[];
    totalLines: number;
}

export interface ConflictHunk {
    id: number;
    lineStart: number; // 1-based line where <<<<<<< appears
    lineEnd: number; // 1-based line where >>>>>>> appears
    ours: string[];
    oursLabel: string | null;
    base: string[] | null; // diff3 only
    theirs: string[];
    theirsLabel: string | null;
    resolution: Resolution | null;
}

// ── Resolution ─────────────────────────────────────────────────────────

export type Resolution =
    | { type: "accept_ours" }
    | { type: "accept_theirs" }
    | { type: "accept_both"; oursFirst: boolean }
    | { type: "custom"; lines: string[] }
    | { type: "smart"; resolution: SmartResolution };

export interface SmartResolution {
    lines: string[];
    strategyName: string;
    explanation: string;
    decision: SmartMergeDecision;
    reasoningSteps: string[];
}

// ── Smart Solution Plan ────────────────────────────────────────────────

export type SmartMergeDecision = "accept_ours" | "accept_theirs" | "hybrid";

export interface SmartSolutionPlan {
    id: number;
    strategyName: string;
    resolvedLines: string[];
    explanation: string;
    decision: SmartMergeDecision;
    reasoningSteps: string[];
}

export interface SmartSolutionRequest {
    hunkId: number;
    ours: string[];
    theirs: string[];
    base: string[] | null;
    contextBefore: string[];
    contextAfter: string[];
    filePath: string;
    conventions: string[];
    userMergePrefs: UserMergePrefs;
}

export interface UserMergePrefs {
    defaultStyle: string | null;
    preferOursPatterns: string[];
    preferTheirsPatterns: string[];
}

// ── Diff Types ─────────────────────────────────────────────────────────

export type DiffTag = "equal" | "added" | "removed";

export interface DiffSpan {
    text: string;
    tag: DiffTag;
}

export interface HunkDiff {
    linePairs: LineDiff[];
}

export type LineDiff =
    | { type: "equal"; text: string }
    | { type: "changed"; oldSpans: DiffSpan[]; newSpans: DiffSpan[] }
    | { type: "only_old"; text: string }
    | { type: "only_new"; text: string };

// ── Scoring Weights (deprecated — kept for backward compat) ───────────

export interface ScoringWeights {
    llmConfidence: number;
    patternAlignment: number;
    syntaxHeuristic: number;
    conventionMatch: number;
    simplicity: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
    llmConfidence: 0.3,
    patternAlignment: 0.2,
    syntaxHeuristic: 0.2,
    conventionMatch: 0.15,
    simplicity: 0.15,
};
