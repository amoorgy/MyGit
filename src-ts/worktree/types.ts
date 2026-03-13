/**
 * Worktree Types — ported from Rust src/worktree/mod.rs
 */

export interface Worktree {
    path: string;
    head: string; // SHA
    branch: string; // branch name or "detached"
    isBare: boolean;
    isDetached: boolean;
    isLocked: boolean;
    prunable: boolean;
}

export interface WorktreeOptions {
    path: string;
    branch?: string; // Create new branch if specified
    base?: string; // Base commit/branch
    force?: boolean;
    detach?: boolean;
}
