/**
 * Merge Strategy Analyzer — ported from Rust src/conventions/merges.rs
 *
 * Analyzes merge history to detect strategies (Merge Commit vs Squash vs Rebase).
 */

import { execa } from "execa";
import type { Convention } from "./types.js";

// ── Public API ─────────────────────────────────────────────────────────

export async function analyzeMerges(repoPath: string): Promise<Convention[]> {
    const conventions: Convention[] = [];

    // Check for merge commits
    const mergeCommits = await countMergeCommits(repoPath);
    const totalCommits = await countTotalCommits(repoPath);

    if (totalCommits < 10) return [];

    const mergeRatio = mergeCommits / totalCommits;

    if (mergeRatio > 0.1) {
        conventions.push({
            type: "MergeStrategy",
            pattern: "Merge Commit",
            confidence: Math.min(mergeRatio * 5, 1.0), // 20% merges = 100% confidence
            description: "Detailed merge history (Merge Commits)",
        });
    } else {
        conventions.push({
            type: "MergeStrategy",
            pattern: "Squash / Rebase",
            confidence: 0.8,
            description: "Linear history (Squash or Rebase)",
        });
    }

    return conventions;
}

// ── Helpers ────────────────────────────────────────────────────────────

async function countMergeCommits(cwd: string): Promise<number> {
    try {
        const { stdout } = await execa("git", ["rev-list", "--count", "--merges", "HEAD"], { cwd });
        return parseInt(stdout.trim(), 10) || 0;
    } catch {
        return 0;
    }
}

async function countTotalCommits(cwd: string): Promise<number> {
    try {
        const { stdout } = await execa("git", ["rev-list", "--count", "HEAD"], { cwd });
        return parseInt(stdout.trim(), 10) || 0;
    } catch {
        return 0;
    }
}
