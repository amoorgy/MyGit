/**
 * Git Recipes — enhanced git context gathering.
 *
 * Collects remote, fork, branch, and tracking information that the
 * standard agent context (branch, status, recent commits) doesn't provide.
 * This context enables the agent to reason about cross-repo operations.
 */

import { execa } from "execa";
import type { GitHubClient } from "../github/client.js";
import type {
    EnhancedGitContext,
    RemoteInfo,
    BranchTrackingInfo,
    BranchInfo,
    ForkInfo,
} from "./types.js";

// ============================================================================
// HELPERS
// ============================================================================

async function gitOutput(args: string[], cwd?: string): Promise<string> {
    try {
        const result = await execa("git", args, { cwd, reject: false });
        return result.stdout?.trim() ?? "";
    } catch {
        return "";
    }
}

/** Parse a GitHub URL (SSH or HTTPS) into owner/repo. */
function parseGitHubUrl(url: string): { owner: string; repo: string } | undefined {
    // SSH: git@github.com:owner/repo.git
    const ssh = url.match(/git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
    if (ssh) return { owner: ssh[1], repo: ssh[2] };

    // HTTPS: https://github.com/owner/repo.git
    const https = url.match(/https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (https) return { owner: https[1], repo: https[2] };

    return undefined;
}

// ============================================================================
// REMOTE GATHERING
// ============================================================================

async function gatherRemotes(repoRoot: string): Promise<RemoteInfo[]> {
    const raw = await gitOutput(["remote", "-v"], repoRoot);
    if (!raw) return [];

    const remotes = new Map<string, RemoteInfo>();

    for (const line of raw.split("\n")) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
        if (!match) continue;

        const [, name, url, type] = match;
        const existing = remotes.get(name);

        if (existing) {
            if (type === "fetch") existing.fetchUrl = url;
            else existing.pushUrl = url;
        } else {
            remotes.set(name, {
                name,
                fetchUrl: type === "fetch" ? url : "",
                pushUrl: type === "push" ? url : "",
                github: parseGitHubUrl(url),
            });
        }
    }

    return Array.from(remotes.values());
}

// ============================================================================
// BRANCH TRACKING
// ============================================================================

async function gatherTracking(repoRoot: string): Promise<BranchTrackingInfo[]> {
    const raw = await gitOutput(
        ["for-each-ref", "--format=%(refname:short) %(upstream:short) %(upstream:track)", "refs/heads/"],
        repoRoot,
    );
    if (!raw) return [];

    const result: BranchTrackingInfo[] = [];

    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Format: "main origin/main [ahead 1, behind 2]" or "main origin/main" or "main "
        const parts = trimmed.match(/^(\S+)\s+(\S*)\s*(.*)$/);
        if (!parts) continue;

        const [, local, remote] = parts;
        const trackInfo = parts[3] || "";

        if (!remote) continue;

        let ahead = 0;
        let behind = 0;
        const aheadMatch = trackInfo.match(/ahead\s+(\d+)/);
        const behindMatch = trackInfo.match(/behind\s+(\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
        if (behindMatch) behind = parseInt(behindMatch[1], 10);

        result.push({ local, remote, ahead, behind });
    }

    return result;
}

// ============================================================================
// ALL BRANCHES
// ============================================================================

const MAX_BRANCHES = 50;

async function gatherAllBranches(repoRoot: string): Promise<BranchInfo[]> {
    const raw = await gitOutput(
        ["branch", "-a", "--format=%(refname:short)\t%(creatordate:iso8601)"],
        repoRoot,
    );
    if (!raw) return [];

    const branches: BranchInfo[] = [];

    for (const line of raw.split("\n")) {
        if (branches.length >= MAX_BRANCHES) break;

        const trimmed = line.trim();
        if (!trimmed) continue;

        const [name, dateStr] = trimmed.split("\t");
        if (!name) continue;

        // Skip HEAD symbolic ref
        if (name === "origin/HEAD" || name.endsWith("/HEAD")) continue;

        branches.push({
            name,
            isRemote: name.includes("/"),
            lastCommitDate: dateStr || undefined,
        });
    }

    return branches;
}

// ============================================================================
// FORK INFO (via GitHub API)
// ============================================================================

async function gatherForkInfo(
    remotes: RemoteInfo[],
    githubClient: GitHubClient,
): Promise<ForkInfo | undefined> {
    // Find the origin remote's GitHub info
    const origin = remotes.find((r) => r.name === "origin");
    if (!origin?.github) return undefined;

    try {
        const repo = await githubClient.getRepo(origin.github.owner, origin.github.repo);

        if (repo.fork && repo.parent) {
            return {
                isFork: true,
                parentRepo: repo.parent.full_name,
                parentCloneUrl: repo.parent.clone_url,
                sourceRepo: repo.source?.full_name,
                sourceCloneUrl: repo.source?.clone_url,
            };
        }

        return { isFork: false };
    } catch {
        // GitHub API unavailable or token missing — graceful degradation
        return undefined;
    }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Gather enhanced git context for complex git workflows.
 * The `githubClient` is optional — fork detection is skipped without it.
 */
export async function gatherEnhancedGitContext(
    repoRoot: string,
    githubClient?: GitHubClient,
): Promise<EnhancedGitContext> {
    const [remotes, tracking, allBranches] = await Promise.all([
        gatherRemotes(repoRoot),
        gatherTracking(repoRoot),
        gatherAllBranches(repoRoot),
    ]);

    let forkInfo: ForkInfo | undefined;
    if (githubClient) {
        forkInfo = await gatherForkInfo(remotes, githubClient);
    }

    return { remotes, tracking, allBranches, forkInfo };
}
