import { execa } from "execa";
import * as fs from "fs/promises";
import * as path from "path";
import type { ExecutionResult } from "../../executor/index.js";
import { loadRepoGitState, type RepoGitState } from "./repoState.js";
import type { ChatRichRow } from "../components/ChatArea.js";
import { shellQuote } from "./shell.js";

export interface ChangedFileStat {
    path: string;
    additions: number;
    deletions: number;
}

export interface BranchFetchUpdate {
    branch: string;
    status:
        | "up_to_date"
        | "fast_forwarded"
        | "ahead_local"
        | "no_upstream"
        | "diverged"
        | "remote_updated"
        | "skipped_checked_out"
        | "skipped_dirty"
        | "error";
    source: "current" | "local" | "remote";
    beforeSha: string | null;
    afterSha: string | null;
    commits: string[];
    files: ChangedFileStat[];
    detail?: string;
}

export interface FetchSummary {
    command: "fetch" | "fetch-all";
    repoRoot: string;
    generatedAt: string;
    notePath: string;
    updates: BranchFetchUpdate[];
    skipped: BranchFetchUpdate[];
}

export type PermissionedGitRunner = (
    command: string,
    reasoning: string,
) => Promise<ExecutionResult>;

async function gitOutput(args: string[], cwd: string): Promise<string> {
    const result = await execa("git", args, {
        cwd,
        reject: false,
    });
    return result.exitCode === 0 ? result.stdout.trim() : "";
}

async function branchSha(repoRoot: string, ref: string | null): Promise<string | null> {
    if (!ref) return null;
    const value = await gitOutput(["rev-parse", ref], repoRoot);
    return value || null;
}

async function isAncestor(repoRoot: string, older: string | null, newer: string | null): Promise<boolean> {
    if (!older || !newer) return false;
    const result = await execa("git", ["merge-base", "--is-ancestor", older, newer], {
        cwd: repoRoot,
        reject: false,
    });
    return result.exitCode === 0;
}

async function collectCommits(repoRoot: string, from: string | null, to: string | null): Promise<string[]> {
    if (!from || !to || from === to) return [];
    const stdout = await gitOutput(["log", "--pretty=format:%h %s", `${from}..${to}`], repoRoot);
    return stdout ? stdout.split("\n").filter(Boolean) : [];
}

async function collectFileStats(repoRoot: string, from: string | null, to: string | null): Promise<ChangedFileStat[]> {
    if (!from || !to || from === to) return [];
    const stdout = await gitOutput(["diff", "--numstat", from, to], repoRoot);
    if (!stdout) return [];

    return stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            const [additions, deletions, filePath] = line.split("\t");
            return {
                path: filePath,
                additions: Number.parseInt(additions, 10) || 0,
                deletions: Number.parseInt(deletions, 10) || 0,
            };
        });
}

async function remoteRefMap(repoRoot: string): Promise<Map<string, string>> {
    const stdout = await gitOutput(
        ["for-each-ref", "refs/remotes/origin", "--format=%(refname:short)%00%(objectname)"],
        repoRoot,
    );
    const next = new Map<string, string>();
    if (!stdout) return next;

    for (const line of stdout.split("\n")) {
        const [ref, sha] = line.split("\u0000");
        if (!ref || !sha || ref === "origin/HEAD") continue;
        next.set(ref.replace(/^origin\//, ""), sha);
    }
    return next;
}

async function writeUpdateNote(summary: Omit<FetchSummary, "notePath">): Promise<string> {
    const safeStamp = summary.generatedAt.replace(/[:.]/g, "-");
    const updatesDir = path.join(summary.repoRoot, ".mygit", "updates");
    await fs.mkdir(updatesDir, { recursive: true });
    const notePath = path.join(updatesDir, `${safeStamp}-${summary.command}.md`);

    const lines = [
        `# ${summary.command} update`,
        "",
        `- Repository: ${summary.repoRoot}`,
        `- Timestamp: ${summary.generatedAt}`,
        `- Command: /${summary.command}`,
        "",
        "## Updated Branches",
    ];

    const allUpdates = [...summary.updates, ...summary.skipped];
    if (allUpdates.length === 0) {
        lines.push("- No branch updates detected.");
    } else {
        for (const update of allUpdates) {
            lines.push(`- ${update.branch} (${update.source}) — ${update.status}`);
            lines.push(`  before: ${update.beforeSha ?? "(none)"}`);
            lines.push(`  after: ${update.afterSha ?? "(none)"}`);
            if (update.detail) lines.push(`  detail: ${update.detail}`);
            if (update.commits.length > 0) {
                lines.push("  commits:");
                for (const commit of update.commits) {
                    lines.push(`  - ${commit}`);
                }
            }
            if (update.files.length > 0) {
                lines.push("  files:");
                for (const file of update.files) {
                    lines.push(`  - ${file.path} +${file.additions} -${file.deletions}`);
                }
            }
        }
    }

    await fs.writeFile(notePath, `${lines.join("\n")}\n`, "utf-8");
    return notePath;
}

async function analyzeCurrentBranchAfterFetch(
    state: RepoGitState,
    runGitCommand: PermissionedGitRunner,
): Promise<{ update: BranchFetchUpdate; state: RepoGitState }> {
    const repoRoot = state.repoRoot;
    const branch = state.currentBranch;
    const beforeHead = await branchSha(repoRoot, "HEAD");
    const upstreamRef = state.upstream;
    const afterUpstream = await branchSha(repoRoot, upstreamRef);

    if (!upstreamRef) {
        return {
            update: {
                branch,
                status: "no_upstream",
                source: "current",
                beforeSha: beforeHead,
                afterSha: beforeHead,
                commits: [],
                files: [],
                detail: "Current branch does not have an upstream configured.",
            },
            state,
        };
    }

    if (!afterUpstream) {
        return {
            update: {
                branch,
                status: "error",
                source: "current",
                beforeSha: beforeHead,
                afterSha: beforeHead,
                commits: [],
                files: [],
                detail: `Unable to resolve upstream ref ${upstreamRef}.`,
            },
            state,
        };
    }

    const sameHead = beforeHead === afterUpstream;
    if (sameHead) {
        return {
            update: {
                branch,
                status: "up_to_date",
                source: "current",
                beforeSha: beforeHead,
                afterSha: beforeHead,
                commits: [],
                files: [],
            },
            state,
        };
    }

    const localBehind = await isAncestor(repoRoot, beforeHead, afterUpstream);
    if (localBehind) {
        if (state.dirty) {
            return {
                update: {
                    branch,
                    status: "skipped_dirty",
                    source: "current",
                    beforeSha: beforeHead,
                    afterSha: beforeHead,
                    commits: [],
                    files: [],
                    detail: "Working tree is dirty, so ff-only pull was skipped.",
                },
                state,
            };
        }

        const pullResult = await runGitCommand(
            "pull --ff-only",
            `Fast-forward the current branch ${branch} after fetching new remote commits.`,
        );
        if (!pullResult.success) {
            return {
                update: {
                    branch,
                    status: "error",
                    source: "current",
                    beforeSha: beforeHead,
                    afterSha: beforeHead,
                    commits: [],
                    files: [],
                    detail: pullResult.error ?? "git pull --ff-only failed",
                },
                state,
            };
        }

        const nextState = await loadRepoGitState(repoRoot);
        const afterHead = await branchSha(repoRoot, "HEAD");
        return {
            update: {
                branch,
                status: "fast_forwarded",
                source: "current",
                beforeSha: beforeHead,
                afterSha: afterHead,
                commits: await collectCommits(repoRoot, beforeHead, afterHead),
                files: await collectFileStats(repoRoot, beforeHead, afterHead),
            },
            state: nextState,
        };
    }

    const localAhead = await isAncestor(repoRoot, afterUpstream, beforeHead);
    if (localAhead) {
        return {
            update: {
                branch,
                status: "ahead_local",
                source: "current",
                beforeSha: beforeHead,
                afterSha: beforeHead,
                commits: [],
                files: [],
                detail: "Local branch is already ahead of upstream.",
            },
            state,
        };
    }

    return {
        update: {
            branch,
            status: "diverged",
            source: "current",
            beforeSha: beforeHead,
            afterSha: beforeHead,
            commits: [],
            files: [],
            detail: "Local branch diverged from upstream. No merge or rebase was attempted.",
        },
        state,
    };
}

function buildRemoteUpdate(
    branch: string,
    beforeSha: string | null,
    afterSha: string | null,
    commits: string[],
    files: ChangedFileStat[],
): BranchFetchUpdate {
    return {
        branch,
        status: "remote_updated",
        source: "remote",
        beforeSha,
        afterSha,
        commits,
        files,
    };
}

export async function fetchCurrentBranch(
    repoRoot: string,
    runGitCommand: PermissionedGitRunner,
): Promise<FetchSummary> {
    const fetchResult = await runGitCommand(
        "fetch --prune origin",
        "Fetch the latest remote updates for the current branch.",
    );
    const baseState = await loadRepoGitState(repoRoot);

    const updates: BranchFetchUpdate[] = [];
    const skipped: BranchFetchUpdate[] = [];

    if (!fetchResult.success) {
        const summaryBase = {
            command: "fetch" as const,
            repoRoot,
            generatedAt: new Date().toISOString(),
            updates,
            skipped: [{
                branch: baseState.currentBranch,
                status: "error" as const,
                source: "current" as const,
                beforeSha: null,
                afterSha: null,
                commits: [],
                files: [],
                detail: fetchResult.error ?? "git fetch failed",
            }],
        };
        return {
            ...summaryBase,
            notePath: await writeUpdateNote(summaryBase),
        };
    }

    const analyzed = await analyzeCurrentBranchAfterFetch(baseState, runGitCommand);
    if (analyzed.update.status === "fast_forwarded") {
        updates.push(analyzed.update);
    } else {
        skipped.push(analyzed.update);
    }

    const summaryBase = {
        command: "fetch" as const,
        repoRoot,
        generatedAt: new Date().toISOString(),
        updates,
        skipped,
    };

    return {
        ...summaryBase,
        notePath: await writeUpdateNote(summaryBase),
    };
}

export async function fetchAllBranches(
    repoRoot: string,
    runGitCommand: PermissionedGitRunner,
): Promise<FetchSummary> {
    const beforeState = await loadRepoGitState(repoRoot);
    const beforeRemotes = await remoteRefMap(repoRoot);

    const updates: BranchFetchUpdate[] = [];
    const skipped: BranchFetchUpdate[] = [];

    const fetchResult = await runGitCommand(
        "fetch --all --prune",
        "Fetch all remotes and refresh branch refs before applying safe fast-forward updates.",
    );

    if (!fetchResult.success) {
        const summaryBase = {
            command: "fetch-all" as const,
            repoRoot,
            generatedAt: new Date().toISOString(),
            updates,
            skipped: [{
                branch: beforeState.currentBranch,
                status: "error" as const,
                source: "current" as const,
                beforeSha: null,
                afterSha: null,
                commits: [],
                files: [],
                detail: fetchResult.error ?? "git fetch --all failed",
            }],
        };
        return {
            ...summaryBase,
            notePath: await writeUpdateNote(summaryBase),
        };
    }

    let workingState = await loadRepoGitState(repoRoot);
    const currentAnalysis = await analyzeCurrentBranchAfterFetch(workingState, runGitCommand);
    workingState = currentAnalysis.state;
    if (currentAnalysis.update.status === "fast_forwarded") {
        updates.push(currentAnalysis.update);
    } else {
        skipped.push(currentAnalysis.update);
    }

    for (const branch of workingState.localBranches) {
        if (branch.name === workingState.currentBranch) continue;

        const beforeSha = await branchSha(repoRoot, branch.fullRefName);
        const upstreamRef = await gitOutput(
            ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch.name}@{upstream}`],
            repoRoot,
        );
        if (!upstreamRef) {
            skipped.push({
                branch: branch.name,
                status: "no_upstream",
                source: "local",
                beforeSha,
                afterSha: beforeSha,
                commits: [],
                files: [],
                detail: "Branch has no upstream configured.",
            });
            continue;
        }

        if (branch.occupiedByWorktree && branch.occupiedByWorktree !== workingState.currentWorktreePath) {
            skipped.push({
                branch: branch.name,
                status: "skipped_checked_out",
                source: "local",
                beforeSha,
                afterSha: beforeSha,
                commits: [],
                files: [],
                detail: `Branch is checked out at ${branch.occupiedByWorktree}.`,
            });
            continue;
        }

        const upstreamSha = await branchSha(repoRoot, upstreamRef);
        if (!upstreamSha || !beforeSha || beforeSha === upstreamSha) {
            skipped.push({
                branch: branch.name,
                status: "up_to_date",
                source: "local",
                beforeSha,
                afterSha: beforeSha,
                commits: [],
                files: [],
            });
            continue;
        }

        if (await isAncestor(repoRoot, beforeSha, upstreamSha)) {
            const updateResult = await runGitCommand(
                `update-ref ${shellQuote(`refs/heads/${branch.name}`)} ${shellQuote(upstreamSha)} ${shellQuote(beforeSha)}`,
                `Fast-forward local branch ${branch.name} to its fetched upstream ref without checking it out.`,
            );

            if (!updateResult.success) {
                skipped.push({
                    branch: branch.name,
                    status: "error",
                    source: "local",
                    beforeSha,
                    afterSha: beforeSha,
                    commits: [],
                    files: [],
                    detail: updateResult.error ?? "git update-ref failed",
                });
                continue;
            }

            updates.push({
                branch: branch.name,
                status: "fast_forwarded",
                source: "local",
                beforeSha,
                afterSha: upstreamSha,
                commits: await collectCommits(repoRoot, beforeSha, upstreamSha),
                files: await collectFileStats(repoRoot, beforeSha, upstreamSha),
            });
            continue;
        }

        if (await isAncestor(repoRoot, upstreamSha, beforeSha)) {
            skipped.push({
                branch: branch.name,
                status: "ahead_local",
                source: "local",
                beforeSha,
                afterSha: beforeSha,
                commits: [],
                files: [],
                detail: "Local branch is already ahead of upstream.",
            });
            continue;
        }

        skipped.push({
            branch: branch.name,
            status: "diverged",
            source: "local",
            beforeSha,
            afterSha: beforeSha,
            commits: [],
            files: [],
            detail: "Local branch diverged from upstream; fast-forward update skipped.",
        });
    }

    const afterRemotes = await remoteRefMap(repoRoot);
    for (const [branchName, afterSha] of afterRemotes.entries()) {
        if (workingState.localBranches.some((branch) => branch.name === branchName)) continue;
        const beforeSha = beforeRemotes.get(branchName) ?? null;
        if (!beforeSha || beforeSha === afterSha) continue;

        updates.push(buildRemoteUpdate(
            branchName,
            beforeSha,
            afterSha,
            await collectCommits(repoRoot, beforeSha, afterSha),
            await collectFileStats(repoRoot, beforeSha, afterSha),
        ));
    }

    const summaryBase = {
        command: "fetch-all" as const,
        repoRoot,
        generatedAt: new Date().toISOString(),
        updates,
        skipped,
    };

    return {
        ...summaryBase,
        notePath: await writeUpdateNote(summaryBase),
    };
}

export function buildFetchSummaryRows(summary: FetchSummary): ChatRichRow[] {
    const rows: ChatRichRow[] = [{
        text: `/${summary.command} complete • note: ${summary.notePath}`,
        tone: "dim",
    }];

    const renderUpdate = (update: BranchFetchUpdate) => {
        rows.push({
            text: `${update.branch} • ${update.status}${update.detail ? ` • ${update.detail}` : ""}`,
            tone: update.status === "fast_forwarded" || update.status === "remote_updated" ? "info" : "muted",
        });
        for (const file of update.files.slice(0, 20)) {
            rows.push({
                segments: [
                    { text: `${file.path} `, tone: "normal" },
                    { text: `+${file.additions} `, tone: "accent" },
                    { text: `-${file.deletions}`, tone: "error" },
                ],
            });
        }
    };

    for (const update of summary.updates) renderUpdate(update);
    for (const update of summary.skipped) renderUpdate(update);
    return rows;
}
