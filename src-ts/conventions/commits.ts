/**
 * Commit Convention Analyzer — ported from Rust src/conventions/commits.rs
 *
 * Analyzes git log to detect commit message patterns (e.g. Conventional Commits).
 */

import { execa } from "execa";
import type { Convention } from "./types.js";

// ── Public API ─────────────────────────────────────────────────────────

export async function analyzeCommits(repoPath: string): Promise<Convention[]> {
    const commits = await getRecentCommits(repoPath);
    if (commits.length < 5) return [];

    const conventions: Convention[] = [];

    // 1. Conventional Commits (feat:, fix:, chore:, etc.)
    const ccScore = scoreConventionalCommits(commits);
    if (ccScore > 0.7) {
        conventions.push({
            type: "CommitFormat",
            pattern: "^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\\(.+\\))?: .+$",
            confidence: ccScore,
            description: "Conventional Commits (type(scope): message)",
        });
    }

    // 2. Issue References (#123, JIRA-456)
    const issuePattern = detectIssuePattern(commits);
    if (issuePattern) {
        conventions.push({
            type: "IssueReference",
            pattern: issuePattern.regex,
            confidence: issuePattern.confidence,
            description: `Issue references (${issuePattern.example})`,
        });
    }

    return conventions;
}

// ── Helpers ────────────────────────────────────────────────────────────

async function getRecentCommits(cwd: string): Promise<string[]> {
    try {
        const { stdout } = await execa("git", ["log", "--format=%s", "-n", "50"], { cwd });
        return stdout.split("\n").filter((l) => l.trim().length > 0);
    } catch {
        return [];
    }
}

function scoreConventionalCommits(messages: string[]): number {
    const ccRegex = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?: .+/;
    const matches = messages.filter((msg) => ccRegex.test(msg)).length;
    return matches / messages.length;
}

function detectIssuePattern(messages: string[]): { regex: string; confidence: number; example: string } | null {
    const patterns = [
        { regex: /#\d+/, name: "GitHub Style (#123)" },
        { regex: /[A-Z]+-\d+/, name: "JIRA Style (PROJ-123)" },
    ];

    for (const p of patterns) {
        const matches = messages.filter((msg) => p.regex.test(msg)).length;
        const confidence = matches / messages.length;
        if (confidence > 0.3) {
            return {
                regex: p.regex.source,
                confidence,
                example: p.name,
            };
        }
    }

    return null;
}
