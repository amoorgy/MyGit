/**
 * Branch Convention Analyzer — ported from Rust src/conventions/branches.rs
 *
 * Analyzes git branch names to detect naming patterns (feature/, user/, kebab-case).
 */

import { execa } from "execa";
import type { Convention } from "./types.js";

// ── Public API ─────────────────────────────────────────────────────────

export async function analyzeBranches(repoPath: string): Promise<Convention[]> {
    const branches = await getRemoteBranches(repoPath);
    if (branches.length < 3) return [];

    const conventions: Convention[] = [];

    // 1. Grouped Prefixes (feature/, bugfix/, hotfix/, release/)
    const prefixScore = scoreGroupedPrefixes(branches);
    if (prefixScore > 0.6) {
        conventions.push({
            type: "BranchNaming",
            pattern: "^(feature|bugfix|hotfix|release|chore)/.+",
            confidence: prefixScore,
            description: "Grouped prefixes (feature/..., bugfix/...)",
        });
    }

    // 2. User Prefixes (user/...)
    const userScore = scoreUserPrefixes(branches);
    if (userScore > 0.4 && userScore > prefixScore) {
        conventions.push({
            type: "BranchNaming",
            pattern: "^[a-z0-9]+/.+",
            confidence: userScore,
            description: "User prefixes (username/...)",
        });
    }

    return conventions;
}

// ── Helpers ────────────────────────────────────────────────────────────

async function getRemoteBranches(cwd: string): Promise<string[]> {
    try {
        const { stdout } = await execa("git", ["branch", "-r"], { cwd });
        return stdout
            .split("\n")
            .map((l) => l.trim().replace("origin/", ""))
            .filter((l) => l.length > 0 && l !== "HEAD");
    } catch {
        return [];
    }
}

function scoreGroupedPrefixes(branches: string[]): number {
    const regex = /^(feature|bugfix|hotfix|release|chore)\//;
    const matches = branches.filter((b) => regex.test(b)).length;
    return matches / branches.length;
}

function scoreUserPrefixes(branches: string[]): number {
    const regex = /^[a-z0-9]+\//;
    const matches = branches.filter((b) => regex.test(b)).length;
    return matches / branches.length;
}
