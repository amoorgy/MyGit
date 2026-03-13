/**
 * PR Review domain types.
 * These are app-level types distinct from the raw GitHub API shapes in github/types.ts.
 * Pattern mirrors merge/types.ts: ConflictFile → PRData, SmartResolution → ReviewComment.
 */

// ── PR Data ────────────────────────────────────────────────────────────

export interface PRFile {
    path: string;
    previousPath?: string;
    status: "added" | "removed" | "modified" | "renamed";
    additions: number;
    deletions: number;
    patch: string;
}

export interface PRCommit {
    sha: string;
    message: string;
    author: string;
    date: string;
}

export interface PRData {
    number: number;
    title: string;
    description: string;
    author: string;
    headBranch: string;
    baseBranch: string;
    headSha: string;
    baseSha: string;
    state: "open" | "closed" | "merged";
    isDraft: boolean;
    totalAdditions: number;
    totalDeletions: number;
    changedFiles: number;
    htmlUrl: string;
    files: PRFile[];
    commits: PRCommit[];
    createdAt: string;
    updatedAt: string;
}

// ── Review Types ───────────────────────────────────────────────────────

export type ReviewCommentSeverity = "critical" | "major" | "minor" | "suggestion" | "praise";
export type ReviewCommentCategory =
    | "bug"
    | "security"
    | "performance"
    | "style"
    | "logic"
    | "docs"
    | "test"
    | "praise";

export interface ReviewComment {
    id: string;
    filePath: string;
    line?: number;
    severity: ReviewCommentSeverity;
    category: ReviewCommentCategory;
    title: string;
    body: string;
    suggestion?: string;
    reasoningSteps: string[];
}

export interface FileSummary {
    filePath: string;
    riskLevel: "high" | "medium" | "low";
    summary: string;
    commentCount: number;
}

export interface PRReview {
    id: string;
    prNumber: number;
    repoOwner: string;
    repoName: string;
    prTitle: string;
    headSha: string;
    overallSummary: string;
    overallDecision: "approve" | "request_changes" | "comment";
    riskScore: number;
    comments: ReviewComment[];
    fileSummaries: FileSummary[];
    generatedAt: string;
    modelUsed: string;
    tokensUsed: number;
}

// ── Analysis Request ───────────────────────────────────────────────────

export interface PRFileAnalysisContext {
    title: string;
    description: string;
    author: string;
    headBranch: string;
    baseBranch: string;
    conventions: string[];
}

// ── Severity Colors (for TUI rendering) ───────────────────────────────

export const SEVERITY_COLORS: Record<ReviewCommentSeverity, string> = {
    critical: "#e06060",   // red — same as "OURS" in merge view
    major: "#e0a040",      // orange — same as "HYBRID" in merge view
    minor: "#e0e040",      // yellow
    suggestion: "#6060e0", // blue — same as "THEIRS" in merge view
    praise: "#40c040",     // green
};

export const SEVERITY_LABELS: Record<ReviewCommentSeverity, string> = {
    critical: "CRITICAL",
    major: "MAJOR",
    minor: "MINOR",
    suggestion: "SUGGEST",
    praise: "PRAISE",
};
