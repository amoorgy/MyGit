/**
 * Convention Discovery Engine
 *
 * Aggregates analyzers and bridges to DB storage.
 */

import { analyzeCommits } from "./commits.js";
import { analyzeBranches } from "./branches.js";
import { analyzeMerges } from "./merges.js";
import type { Convention } from "./types.js";
import type { MyGitDatabase, StoredConvention } from "../storage/database.js";

// ── Public API ─────────────────────────────────────────────────────────

export async function discoverConventions(repoPath: string): Promise<Convention[]> {
    const results = await Promise.all([
        analyzeCommits(repoPath),
        analyzeBranches(repoPath),
        analyzeMerges(repoPath),
    ]);

    return results.flat();
}

/**
 * Save discovered conventions to the database.
 */
export function saveConventions(db: MyGitDatabase, conventions: Convention[]) {
    db.clearConventions();
    for (const conv of conventions) {
        db.saveConvention({
            type: conv.type,
            pattern: conv.pattern,
            confidence: conv.confidence,
            last_updated: new Date().toISOString(),
        });
    }
}

/**
 * Load conventions from the database.
 */
export function loadConventions(db: MyGitDatabase): Convention[] {
    const stored = db.loadConventions();
    return stored.map((s) => ({
        type: s.type as any,
        pattern: s.pattern,
        confidence: s.confidence,
        description: getDescription(s.type, s.pattern),
    }));
}

function getDescription(type: string, pattern: string): string {
    switch (type) {
        case "CommitFormat":
            return "Conventional Commits";
        case "BranchNaming":
            return `Must match ${pattern}`;
        case "MergeStrategy":
            return pattern;
        case "IssueReference":
            return "Must include issue reference";
        default:
            return pattern;
    }
}
