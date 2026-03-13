/**
 * Knowledge Staleness Detection
 *
 * Detects when knowledge shards and AGENTS.md have drifted from the
 * actual codebase, so users and the agent are warned about stale context.
 */

import { execa } from "execa";
import * as fs from "fs/promises";
import * as path from "path";
import type { KnowledgeManifest } from "../knowledge/types.js";

export interface ShardStalenessReport {
    id: string;
    missingSourcePaths: string[];
}

export interface StalenessReport {
    overall: "fresh" | "aging" | "stale";
    commitsSinceCompile: number;
    daysSinceCompile: number;
    shardReports: ShardStalenessReport[];
    recommendation: string;
}

async function countCommitsSince(repoRoot: string, sinceDate: string): Promise<number> {
    try {
        const { stdout } = await execa("git", [
            "rev-list", "--count", `--since=${sinceDate}`, "HEAD",
        ], { cwd: repoRoot });
        return parseInt(stdout.trim(), 10) || 0;
    } catch {
        return 0;
    }
}

function daysSince(isoDate: string): number {
    const then = new Date(isoDate).getTime();
    const now = Date.now();
    return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

async function checkSourcePaths(
    repoRoot: string,
    sourcePaths: string[],
): Promise<string[]> {
    const missing: string[] = [];
    for (const p of sourcePaths) {
        try {
            await fs.access(path.join(repoRoot, p));
        } catch {
            missing.push(p);
        }
    }
    return missing;
}

function classifyOverall(commits: number, days: number, missingRatio: number): "fresh" | "aging" | "stale" {
    if (commits > 30 || days > 14 || missingRatio > 0.3) return "stale";
    if (commits > 10 || days > 7 || missingRatio > 0.1) return "aging";
    return "fresh";
}

/**
 * Full staleness check — inspects commit count, age, and source path validity.
 * Used by `mygit init --status` and `mygit init --check`.
 */
export async function checkKnowledgeStaleness(
    repoRoot: string,
    manifest: KnowledgeManifest,
): Promise<StalenessReport> {
    const commits = await countCommitsSince(repoRoot, manifest.generatedAt);
    const days = daysSince(manifest.generatedAt);

    const shardReports: ShardStalenessReport[] = [];
    let totalPaths = 0;
    let totalMissing = 0;

    for (const shard of manifest.shards) {
        const missing = await checkSourcePaths(repoRoot, shard.sourcePaths);
        totalPaths += shard.sourcePaths.length;
        totalMissing += missing.length;
        if (missing.length > 0) {
            shardReports.push({ id: shard.id, missingSourcePaths: missing });
        }
    }

    const missingRatio = totalPaths > 0 ? totalMissing / totalPaths : 0;
    const overall = classifyOverall(commits, days, missingRatio);

    let recommendation: string;
    switch (overall) {
        case "fresh":
            recommendation = "Knowledge is up to date.";
            break;
        case "aging":
            recommendation = `Knowledge is ${days}d old with ${commits} new commits. Consider running \`mygit init\` to refresh.`;
            break;
        case "stale":
            recommendation = `Knowledge is stale (${days}d, ${commits} commits behind${totalMissing > 0 ? `, ${totalMissing} missing source paths` : ""}). Run \`mygit init\` to refresh.`;
            break;
    }

    return { overall, commitsSinceCompile: commits, daysSinceCompile: days, shardReports, recommendation };
}

/**
 * Lightweight staleness check — just commit count via a single git command.
 * Used in `gatherContextNode` on iteration 0 to inject a one-line warning.
 */
export async function quickStalenessCheck(
    repoRoot: string,
    manifest: KnowledgeManifest,
): Promise<{ stale: boolean; note?: string }> {
    const commits = await countCommitsSince(repoRoot, manifest.generatedAt);
    if (commits > 20) {
        return {
            stale: true,
            note: `[Note: Knowledge shards are ~${commits} commits behind. Consider running \`mygit init\` to refresh.]`,
        };
    }
    return { stale: false };
}
