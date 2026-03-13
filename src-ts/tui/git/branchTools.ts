import { execa } from "execa";
import * as path from "path";
import { ContextRetriever } from "../../context/retriever.js";
import { MyGitDatabase } from "../../storage/database.js";
import {
    loadRepoGitState,
    type RepoBranchEntry,
    type RepoGitState,
} from "./repoState.js";

export interface BranchPanelTarget {
    name: string;
    displayName: string;
    source: "local" | "remote";
    fullRefName: string;
    lastCommitSha: string;
    lastCommitSubject: string;
    lastCommitAt: string;
    occupiedByWorktree: string | null;
}

export interface BranchLocatorResult {
    target: BranchPanelTarget;
    reason: string;
    source: "indexed" | "tip" | "commit" | "branch_name";
    matchPath?: string;
    matchSha?: string;
    matchSubject?: string;
    score: number;
}

export interface BranchPanelData {
    query: string | null;
    currentBranch: BranchPanelTarget | null;
    recentBranches: BranchPanelTarget[];
    otherBranches: BranchPanelTarget[];
    locatorResults: BranchLocatorResult[];
}

export interface BranchSelectionPlan {
    kind: "noop" | "switch_local" | "switch_remote" | "prompt_dirty" | "prompt_occupied";
    target: BranchPanelTarget;
    switchCommand?: string;
    occupiedPath?: string;
    suggestedWorktreePath?: string;
}

type LocatorBucket = {
    target: BranchPanelTarget;
    score: number;
    reason: string;
    source: BranchLocatorResult["source"];
    matchPath?: string;
    matchSha?: string;
    matchSubject?: string;
};

async function gitOutput(args: string[], cwd: string): Promise<string> {
    const result = await execa("git", args, { cwd, reject: false });
    return result.exitCode === 0 ? result.stdout.trim() : "";
}

function entryToTarget(entry: RepoBranchEntry): BranchPanelTarget {
    return {
        name: entry.name,
        displayName: entry.name,
        source: entry.kind,
        fullRefName: entry.fullRefName,
        lastCommitSha: entry.lastCommitSha,
        lastCommitSubject: entry.lastCommitSubject,
        lastCommitAt: entry.lastCommitAt,
        occupiedByWorktree: entry.occupiedByWorktree,
    };
}

function normalizeBranchName(name: string): string {
    return name.replace(/^origin\//, "");
}

function buildWorktreePath(repoRoot: string, branchName: string): string {
    const parentDir = path.dirname(repoRoot);
    const repoName = path.basename(repoRoot);
    const slug = branchName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "branch";
    return path.join(parentDir, `${repoName}-${slug}`);
}

function upsertBucket(
    buckets: Map<string, LocatorBucket>,
    candidate: LocatorBucket,
) {
    const key = `${candidate.target.source}:${candidate.target.name}`;
    const existing = buckets.get(key);
    if (!existing || candidate.score > existing.score) {
        buckets.set(key, candidate);
    }
}

function tokenizeQuery(query: string): string[] {
    return Array.from(
        new Set(
            query
                .toLowerCase()
                .split(/[^a-z0-9]+/i)
                .map((part) => part.trim())
                .filter((part) => part.length >= 3),
        ),
    ).slice(0, 4);
}

function parseDecoratedBranchName(decoration: string): string | null {
    const refs = decoration
        .split(",")
        .map((part) => part.trim())
        .map((part) => part.replace(/^HEAD -> /, ""))
        .filter(Boolean);

    for (const ref of refs) {
        if (ref === "HEAD") continue;
        if (ref.startsWith("origin/")) return ref;
        if (!ref.includes("/")) return ref;
    }
    return null;
}

async function searchIndexedContext(
    repoRoot: string,
    state: RepoGitState,
    query: string,
    buckets: Map<string, LocatorBucket>,
) {
    if (!state.indexed || !state.currentBranch || !query.trim()) return;

    const db = new MyGitDatabase(path.join(repoRoot, ".mygit", "mygit.db"));
    try {
        const retriever = new ContextRetriever(db);
        const results = retriever.search(query, 5);
        if (results.length === 0) return;

        const current = state.localBranches.find((branch) => branch.name === state.currentBranch);
        if (!current) return;

        const target = entryToTarget(current);
        const primary = results[0];
        upsertBucket(buckets, {
            target,
            source: "indexed",
            score: 290 + results.length,
            reason: `Indexed context match in ${primary.filePath}`,
            matchPath: primary.filePath,
        });
    } finally {
        db.close();
    }
}

async function searchCommitHistory(
    repoRoot: string,
    branches: Map<string, BranchPanelTarget>,
    patterns: string[],
    buckets: Map<string, LocatorBucket>,
) {
    for (const pattern of patterns) {
        if (!pattern) continue;
        const format = "%H%x00%ad%x00%D%x00%s";
        const stdout = await gitOutput(
            ["log", "--all", "--date=iso-strict", `--pretty=format:${format}`, "--regexp-ignore-case", `--grep=${pattern}`, "-n", "20"],
            repoRoot,
        );
        if (!stdout) continue;

        for (const line of stdout.split("\n")) {
            const [sha, committedAt, decoration, subject] = line.split("\u0000");
            if (!sha || !decoration) continue;
            const branchName = parseDecoratedBranchName(decoration);
            if (!branchName) continue;
            const target = branches.get(normalizeBranchName(branchName)) ?? branches.get(branchName);
            if (!target) continue;

            upsertBucket(buckets, {
                target,
                source: "commit",
                score: 200 + Date.parse(committedAt || "1970-01-01T00:00:00Z") / 1_000_000_000,
                reason: `Commit message match: ${subject}`,
                matchSha: sha.slice(0, 12),
                matchSubject: subject,
            });
        }
    }
}

async function searchBranchTips(
    repoRoot: string,
    branches: BranchPanelTarget[],
    patterns: string[],
    buckets: Map<string, LocatorBucket>,
) {
    const candidates = branches
        .slice()
        .sort((a, b) => b.lastCommitAt.localeCompare(a.lastCommitAt))
        .slice(0, 12);

    for (const branch of candidates) {
        const args = ["grep", "-n", "-i", "-m", "5", "-F"];
        for (const pattern of patterns) {
            if (pattern) args.push("-e", pattern);
        }
        args.push(branch.fullRefName, "--");

        const result = await execa("git", args, {
            cwd: repoRoot,
            reject: false,
        });

        if (result.exitCode !== 0 || !result.stdout.trim()) {
            continue;
        }

        const firstHit = result.stdout.trim().split("\n")[0];
        const [ref, filePath, lineNo, ...snippetParts] = firstHit.split(":");
        const snippet = snippetParts.join(":").trim();
        upsertBucket(buckets, {
            target: branch,
            source: "tip",
            score: 300 + result.stdout.trim().split("\n").length,
            reason: `${ref}:${filePath}:${lineNo}`,
            matchPath: filePath,
            matchSubject: snippet,
        });
    }
}

function searchBranchNames(
    branches: BranchPanelTarget[],
    patterns: string[],
    buckets: Map<string, LocatorBucket>,
) {
    for (const branch of branches) {
        const haystack = `${branch.name} ${branch.fullRefName}`.toLowerCase();
        const matched = patterns.find((pattern) => haystack.includes(pattern.toLowerCase()));
        if (!matched) continue;

        upsertBucket(buckets, {
            target: branch,
            source: "branch_name",
            score: 100 + Date.parse(branch.lastCommitAt || "1970-01-01T00:00:00Z") / 1_000_000_000,
            reason: `Branch name matches "${matched}"`,
        });
    }
}

export async function locateFeatureAcrossRefs(
    query: string,
    state?: RepoGitState,
): Promise<BranchLocatorResult[]> {
    const repoState = state ?? await loadRepoGitState();
    const repoRoot = repoState.repoRoot;
    const patterns = Array.from(new Set([query.trim(), ...tokenizeQuery(query)])).filter(Boolean);
    if (patterns.length === 0) return [];

    const allBranches = [
        ...repoState.localBranches.map(entryToTarget),
        ...repoState.remoteBranches
            .filter((branch) => !repoState.localBranches.some((local) => local.name === branch.name))
            .map(entryToTarget),
    ];

    const branchIndex = new Map<string, BranchPanelTarget>();
    for (const branch of allBranches) {
        branchIndex.set(branch.name, branch);
        branchIndex.set(branch.fullRefName, branch);
    }

    const buckets = new Map<string, LocatorBucket>();
    await searchIndexedContext(repoRoot, repoState, query, buckets);
    await searchCommitHistory(repoRoot, branchIndex, patterns, buckets);
    await searchBranchTips(repoRoot, allBranches, patterns, buckets);
    searchBranchNames(allBranches, patterns, buckets);

    return Array.from(buckets.values())
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return b.target.lastCommitAt.localeCompare(a.target.lastCommitAt);
        })
        .map((bucket) => ({
            target: bucket.target,
            reason: bucket.reason,
            source: bucket.source,
            matchPath: bucket.matchPath,
            matchSha: bucket.matchSha,
            matchSubject: bucket.matchSubject,
            score: bucket.score,
        }));
}

export async function listBranchPanelData(query?: string, state?: RepoGitState): Promise<BranchPanelData> {
    const repoState = state ?? await loadRepoGitState();
    const locatorResults = query?.trim() ? await locateFeatureAcrossRefs(query, repoState) : [];
    return buildBranchPanelDataFromState(repoState, query, locatorResults);
}

export function buildBranchPanelDataFromState(
    repoState: RepoGitState,
    query?: string,
    locatorResults: BranchLocatorResult[] = [],
): BranchPanelData {
    const locals = repoState.localBranches.map(entryToTarget);
    const remotes = repoState.remoteBranches.map(entryToTarget);

    const currentBranch = locals.find((branch) => branch.name === repoState.currentBranch) ?? null;
    const recentBranches = repoState.recentBranches
        .filter((name) => name !== repoState.currentBranch)
        .map((name) =>
            locals.find((branch) => branch.name === name)
            ?? remotes.find((branch) => branch.name === name),
        )
        .filter((branch): branch is BranchPanelTarget => Boolean(branch));

    const otherBranches = remotes
        .filter((branch) => branch.name !== repoState.currentBranch)
        .filter((branch) => !recentBranches.some((recent) => recent.name === branch.name))
        .filter((branch) => !locals.some((local) => local.name === branch.name))
        .sort((a, b) => b.lastCommitAt.localeCompare(a.lastCommitAt));

    return {
        query: query?.trim() || null,
        currentBranch,
        recentBranches,
        otherBranches,
        locatorResults,
    };
}

export function planBranchSelection(
    target: BranchPanelTarget,
    state: RepoGitState,
): BranchSelectionPlan {
    const suggestedWorktreePath = buildWorktreePath(state.repoRoot, target.name);
    const occupiedPath = target.occupiedByWorktree;

    if (target.name === state.currentBranch) {
        return {
            kind: "noop",
            target,
            suggestedWorktreePath,
        };
    }

    if (occupiedPath && occupiedPath !== state.currentWorktreePath) {
        return {
            kind: "prompt_occupied",
            target,
            occupiedPath,
            suggestedWorktreePath,
        };
    }

    if (state.dirty) {
        return {
            kind: "prompt_dirty",
            target,
            suggestedWorktreePath,
        };
    }

    if (target.source === "local") {
        return {
            kind: "switch_local",
            target,
            switchCommand: `switch ${target.name}`,
            suggestedWorktreePath,
        };
    }

    return {
        kind: "switch_remote",
        target,
        switchCommand: `switch -c ${target.name} --track ${target.fullRefName}`,
        suggestedWorktreePath,
    };
}
