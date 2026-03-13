import { execa } from "execa";
import * as path from "path";
import { MyGitDatabase } from "../../storage/database.js";
import { WorktreeManager } from "../../worktree/manager.js";

export const RECENT_BRANCHES_PREFERENCE_KEY = "branch_recent_v1";
const MAX_RECENT_BRANCHES = 8;

export interface WorktreeOccupancy {
    branch: string;
    path: string;
    isCurrent: boolean;
}

export interface RepoBranchEntry {
    name: string;
    fullRefName: string;
    kind: "local" | "remote";
    lastCommitSha: string;
    lastCommitSubject: string;
    lastCommitAt: string;
    occupiedByWorktree: string | null;
}

export interface RepoGitState {
    repoRoot: string;
    currentBranch: string;
    currentWorktreePath: string;
    upstream: string | null;
    dirty: boolean;
    localBranches: RepoBranchEntry[];
    remoteBranches: RepoBranchEntry[];
    worktrees: WorktreeOccupancy[];
    recentBranches: string[];
    indexed: boolean;
}

interface RefRecord {
    shortName: string;
    sha: string;
    committedAt: string;
    subject: string;
}

async function gitOutput(args: string[], cwd: string): Promise<string> {
    const result = await execa("git", args, {
        cwd,
        reject: false,
    });
    return result.exitCode === 0 ? result.stdout.trim() : "";
}

async function getRepoRoot(cwd: string): Promise<string> {
    const repoRoot = await gitOutput(["rev-parse", "--show-toplevel"], cwd);
    return repoRoot || cwd;
}

async function getCurrentBranch(repoRoot: string): Promise<string> {
    const branch = await gitOutput(["branch", "--show-current"], repoRoot);
    if (branch) return branch;
    const shortHash = await gitOutput(["rev-parse", "--short", "HEAD"], repoRoot);
    return shortHash ? `detached@${shortHash}` : "unknown";
}

async function getUpstream(repoRoot: string): Promise<string | null> {
    const upstream = await gitOutput(
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        repoRoot,
    );
    return upstream || null;
}

async function listRefs(repoRoot: string, scope: string): Promise<RefRecord[]> {
    const format = "%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)%00%(contents:subject)";
    const stdout = await gitOutput(["for-each-ref", scope, `--format=${format}`], repoRoot);
    if (!stdout) return [];

    return stdout
        .split("\n")
        .map((line) => line.split("\u0000"))
        .filter((parts) => parts.length >= 4)
        .map(([shortName, sha, committedAt, subject]) => ({
            shortName,
            sha,
            committedAt,
            subject,
        }));
}

function getDatabase(repoRoot: string): MyGitDatabase {
    return new MyGitDatabase(path.join(repoRoot, ".mygit", "mygit.db"));
}

export function loadRecentBranches(repoRoot: string): string[] {
    const db = getDatabase(repoRoot);
    try {
        const raw = db.getPreference(RECENT_BRANCHES_PREFERENCE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            : [];
    } catch {
        return [];
    } finally {
        db.close();
    }
}

export function saveRecentBranch(repoRoot: string, branchName: string): string[] {
    const normalized = branchName.trim();
    if (!normalized) return loadRecentBranches(repoRoot);

    const next = [normalized, ...loadRecentBranches(repoRoot).filter((name) => name !== normalized)]
        .slice(0, MAX_RECENT_BRANCHES);

    const db = getDatabase(repoRoot);
    try {
        db.setPreference(RECENT_BRANCHES_PREFERENCE_KEY, JSON.stringify(next));
    } finally {
        db.close();
    }
    return next;
}

export async function loadRepoGitState(cwd: string = process.cwd()): Promise<RepoGitState> {
    const repoRoot = await getRepoRoot(cwd);
    const currentBranch = await getCurrentBranch(repoRoot);
    const upstream = await getUpstream(repoRoot);
    const status = await gitOutput(["status", "--porcelain"], repoRoot);
    const dirty = status.length > 0;

    const manager = new WorktreeManager();
    const worktreesRaw = await manager.list(repoRoot);
    const worktrees: WorktreeOccupancy[] = worktreesRaw
        .filter((worktree) => worktree.branch && worktree.branch !== "bare" && worktree.branch !== "unknown")
        .map((worktree) => ({
            branch: worktree.branch,
            path: worktree.path,
            isCurrent: worktree.path === repoRoot,
        }));

    const currentWorktreePath = worktrees.find((worktree) => worktree.isCurrent)?.path ?? repoRoot;
    const occupiedByBranch = new Map<string, string>();
    for (const worktree of worktrees) {
        occupiedByBranch.set(worktree.branch, worktree.path);
    }

    const [localRefs, remoteRefs] = await Promise.all([
        listRefs(repoRoot, "refs/heads"),
        listRefs(repoRoot, "refs/remotes/origin"),
    ]);

    const localBranches = localRefs
        .map((record) => ({
            name: record.shortName,
            fullRefName: record.shortName,
            kind: "local" as const,
            lastCommitSha: record.sha,
            lastCommitSubject: record.subject,
            lastCommitAt: record.committedAt,
            occupiedByWorktree: occupiedByBranch.get(record.shortName) ?? null,
        }))
        .sort((a, b) => b.lastCommitAt.localeCompare(a.lastCommitAt));

    const remoteBranches = remoteRefs
        .filter((record) => record.shortName !== "origin/HEAD")
        .map((record) => ({
            name: record.shortName.replace(/^origin\//, ""),
            fullRefName: record.shortName,
            kind: "remote" as const,
            lastCommitSha: record.sha,
            lastCommitSubject: record.subject,
            lastCommitAt: record.committedAt,
            occupiedByWorktree: null,
        }))
        .sort((a, b) => b.lastCommitAt.localeCompare(a.lastCommitAt));

    const db = getDatabase(repoRoot);
    let indexed = false;
    try {
        indexed = db.getContextIndexStats().totalChunks > 0;
    } finally {
        db.close();
    }

    return {
        repoRoot,
        currentBranch,
        currentWorktreePath,
        upstream,
        dirty,
        localBranches,
        remoteBranches,
        worktrees,
        recentBranches: loadRecentBranches(repoRoot),
        indexed,
    };
}
