/**
 * Convention Types — ported from Rust src/conventions/mod.rs
 */

export interface Convention {
    type: ConventionType;
    pattern: string;
    confidence: number;
    description: string;
}

export type ConventionType =
    | "CommitFormat"
    | "BranchNaming"
    | "MergeStrategy"
    | "IssueReference";

export interface ConventionAnalysis {
    commits: Convention[];
    branches: Convention[];
    merges: Convention[];
}
