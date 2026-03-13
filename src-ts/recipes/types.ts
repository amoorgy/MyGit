/**
 * Git Recipes — type definitions for structured git workflow guidance.
 *
 * Recipes are optional prompt-injected templates that help the agent
 * navigate complex multi-step git operations (cross-repo, history, search).
 */

// ============================================================================
// RECIPE DEFINITIONS
// ============================================================================

export type RecipeCategory =
    | "cross_repo"
    | "history"
    | "search"
    | "branch"
    | "setup";

export interface RecipeStep {
    /** Human-readable description of what this step does */
    description: string;
    /** Git command template with {{placeholders}} */
    command: string;
    /** Whether this step's output determines subsequent steps */
    isProbe: boolean;
    /** Safety classification for permission gating */
    safety: "safe" | "standard" | "dangerous";
    /** Condition under which to skip this step */
    skipIf?: string;
}

export interface GitRecipe {
    id: string;
    category: RecipeCategory;
    /** Short display name */
    name: string;
    /** Regex patterns that match user requests to this recipe */
    triggers: RegExp[];
    /** What enhanced context this recipe needs */
    requiredContext: ("remotes" | "fork_info" | "all_branches" | "tracking")[];
    /** Ordered steps as guidance for the LLM */
    steps: RecipeStep[];
    /** Caveats to include in the prompt */
    warnings: string[];
    /** Suggested max iterations for this workflow */
    suggestedIterations: number;
}

// ============================================================================
// MATCHING
// ============================================================================

export interface RecipeMatch {
    recipe: GitRecipe;
    /** Confidence score 0–1 */
    confidence: number;
    /** Parameters extracted from the user request (branch, file, date, etc.) */
    params: Record<string, string>;
}

// ============================================================================
// ENHANCED GIT CONTEXT
// ============================================================================

export interface RemoteInfo {
    name: string;
    fetchUrl: string;
    pushUrl: string;
    /** Parsed GitHub owner/repo if the URL is a GitHub URL */
    github?: { owner: string; repo: string };
}

export interface BranchTrackingInfo {
    local: string;
    remote: string;
    ahead: number;
    behind: number;
}

export interface BranchInfo {
    name: string;
    isRemote: boolean;
    lastCommitDate?: string;
}

export interface ForkInfo {
    isFork: boolean;
    parentRepo?: string;
    parentCloneUrl?: string;
    sourceRepo?: string;
    sourceCloneUrl?: string;
}

export interface EnhancedGitContext {
    remotes: RemoteInfo[];
    tracking: BranchTrackingInfo[];
    allBranches: BranchInfo[];
    forkInfo?: ForkInfo;
}
