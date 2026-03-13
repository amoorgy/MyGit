/**
 * Agent Context — mirrors Rust `src/agent/context.rs`
 *
 * Gathers git repository state, tracks observations, formats context
 * for LLM prompts.
 */

import { execa } from "execa";
import * as fs from "fs/promises";
import * as path from "path";
import type { EnhancedGitContext } from "../recipes/types.js";

// ============================================================================
// TYPES
// ============================================================================

export interface Observation {
    action: string;
    output: string;
    success: boolean;
    timestamp: number;
}

export interface TrackedPlanStep {
    description: string;
    command?: string;
    status: "pending" | "completed" | "failed";
}

export interface PromptMemoryState {
    focus?: string;
    latest?: string;
    recentSessions?: string[];
    agentMap?: string;
    knowledgeShards?: Array<{
        path: string;
        title: string;
        content: string;
    }>;
    conversationSummary?: string;
    conventions?: string;
    workflows?: string;
    lessons?: string;
    stalenessNote?: string;
}

export interface AgentContextState {
    repoRoot: string;
    branch: string;
    status: string;
    recentCommits: string;
    diffSummary: string;
    stagedSummary: string;
    fileTree: string[];
    observations: Observation[];
    planSteps: TrackedPlanStep[];
    request: string;
    activeWorktree: string | null;
    promptMemory?: PromptMemoryState;
    /** RAG summaries injected by the retriever on iteration 0 */
    ragSummaries?: string;
    /** Directory overview from the index */
    directoryOverview?: string;
    /** Recipe guidance injected into system prompt for git workflows */
    recipeGuidance?: string;
    /** Enhanced git context (remotes, forks, tracking) for git workflows */
    enhancedGitContext?: EnhancedGitContext;
}

// ============================================================================
// CONTEXT GATHERING
// ============================================================================

/**
 * Run a git command and return stdout, or empty string on failure.
 */
async function gitOutput(args: string[], cwd?: string): Promise<string> {
    try {
        const result = await execa("git", args, { cwd, reject: false });
        return result.stdout?.trim() ?? "";
    } catch {
        return "";
    }
}

/**
 * Gather a fresh repository context snapshot.
 */
export async function gatherContext(cwd?: string): Promise<AgentContextState> {
    const workDir = cwd ?? process.cwd();

    const [repoRoot, branchRaw, status, recentCommits, diffSummary, stagedSummary, fileTreeRaw] = await Promise.all([
        gitOutput(["rev-parse", "--show-toplevel"], workDir),
        gitOutput(["branch", "--show-current"], workDir),
        gitOutput(["status", "--porcelain"], workDir),
        gitOutput(["log", "--oneline", "-10", "--no-decorate"], workDir),
        gitOutput(["diff", "--stat"], workDir),
        gitOutput(["diff", "--cached", "--stat"], workDir),
        getFileTree(workDir, 3),
    ]);

    // Detached HEAD fallback: show short hash when not on a branch
    let branch = branchRaw;
    if (!branch) {
        const shortHash = await gitOutput(["rev-parse", "--short", "HEAD"], workDir);
        branch = shortHash ? `detached@${shortHash}` : "unknown";
    }

    return {
        repoRoot: repoRoot || workDir,
        branch,
        status,
        recentCommits,
        diffSummary,
        stagedSummary,
        fileTree: fileTreeRaw,
        observations: [],
        planSteps: [],
        request: "",
        activeWorktree: null,
        promptMemory: { recentSessions: [] },
    };
}

// ============================================================================
// PROGRESSIVE CONTEXT GATHERING
// ============================================================================

export interface ContextItem {
    label: string;
    value: string;
    status: "pending" | "done";
}

const CONTEXT_LABELS = [
    "Repository root",
    "Branch",
    "Git status",
    "Recent commits",
    "Diff summary",
    "File tree",
] as const;

/**
 * Gather context incrementally, calling onProgress after each item.
 * Returns the full AgentContextState once all items are gathered.
 */
export async function gatherContextWithProgress(
    onProgress: (label: string, value: string) => void,
    cwd?: string,
): Promise<AgentContextState> {
    const workDir = cwd ?? process.cwd();

    const repoRoot = await gitOutput(["rev-parse", "--show-toplevel"], workDir);
    onProgress("Repository root", repoRoot || workDir);

    let branch = await gitOutput(["branch", "--show-current"], workDir);
    if (!branch) {
        const shortHash = await gitOutput(["rev-parse", "--short", "HEAD"], workDir);
        branch = shortHash ? `detached@${shortHash}` : "unknown";
    }
    onProgress("Branch", branch);

    const status = await gitOutput(["status", "--porcelain"], workDir);
    onProgress("Git status", status || "(clean)");

    const recentCommits = await gitOutput(["log", "--oneline", "-10", "--no-decorate"], workDir);
    onProgress("Recent commits", recentCommits || "(none)");

    const diffSummary = await gitOutput(["diff", "--stat"], workDir);
    const stagedSummary = await gitOutput(["diff", "--cached", "--stat"], workDir);
    onProgress("Diff summary", diffSummary || "(no unstaged changes)");

    const fileTree = await getFileTree(workDir, 3);
    onProgress("File tree", `${fileTree.length} entries`);

    return {
        repoRoot: repoRoot || workDir,
        branch,
        status,
        recentCommits,
        diffSummary,
        stagedSummary,
        fileTree,
        observations: [],
        planSteps: [],
        request: "",
        activeWorktree: null,
        promptMemory: { recentSessions: [] },
    };
}

/**
 * Refresh mutable parts of context (status, branch).
 */
export async function refreshContext(ctx: AgentContextState): Promise<AgentContextState> {
    const [branchRaw, status, recentCommits, diffSummary, stagedSummary] = await Promise.all([
        gitOutput(["branch", "--show-current"], ctx.repoRoot),
        gitOutput(["status", "--porcelain"], ctx.repoRoot),
        gitOutput(["log", "--oneline", "-10", "--no-decorate"], ctx.repoRoot),
        gitOutput(["diff", "--stat"], ctx.repoRoot),
        gitOutput(["diff", "--cached", "--stat"], ctx.repoRoot),
    ]);

    let branch = branchRaw;
    if (!branch) {
        const shortHash = await gitOutput(["rev-parse", "--short", "HEAD"], ctx.repoRoot);
        branch = shortHash ? `detached@${shortHash}` : ctx.branch;
    }

    return {
        ...ctx,
        branch,
        status,
        recentCommits,
        diffSummary,
        stagedSummary,
    };
}

// ============================================================================
// FILE TREE
// ============================================================================

/**
 * Get a list of file paths in the repository up to maxDepth.
 */
async function getFileTree(root: string, maxDepth: number): Promise<string[]> {
    const files: string[] = [];
    await collectFiles(root, 0, maxDepth, files, root);
    return files;
}

async function collectFiles(
    dir: string,
    depth: number,
    maxDepth: number,
    files: string[],
    root: string,
): Promise<void> {
    if (depth >= maxDepth || files.length >= 200) return;

    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target") {
            continue;
        }

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(root, fullPath);

        if (entry.isDirectory()) {
            files.push(relativePath + "/");
            await collectFiles(fullPath, depth + 1, maxDepth, files, root);
        } else {
            files.push(relativePath);
        }
    }
}

// ============================================================================
// OBSERVATION MANAGEMENT
// ============================================================================

export function addObservation(ctx: AgentContextState, obs: Observation): AgentContextState {
    return {
        ...ctx,
        observations: [...ctx.observations, obs],
    };
}

export function setActivePlan(
    ctx: AgentContextState,
    steps: { description: string; command?: string }[],
): AgentContextState {
    // Preserve status of existing steps that match
    const existingMap = new Map(ctx.planSteps.map((s) => [s.description, s.status]));

    const tracked: TrackedPlanStep[] = steps.map((s) => ({
        description: s.description,
        command: s.command,
        status: existingMap.get(s.description) ?? "pending",
    }));

    return { ...ctx, planSteps: tracked };
}

// ============================================================================
// PROMPT FORMATTING
// ============================================================================

export interface FormatContextOptions {
    /** Prompt profile mode */
    mode?: "direct_qa" | "execution";
    /** Observation window size (default: 10) */
    windowSize?: number;
    /** Max chars per observation output (default: 200) */
    outputTruncation?: number;
    /** Max chars for the dedicated latest read/fetch context block (default: 1200) */
    readOutputTruncation?: number;
    /** Whether RAG context is available (suppresses file tree) */
    useRag?: boolean;
    /** Max number of file tree entries to include (default: mode-dependent) */
    fileTreeLimit?: number;
    /** Whether to include recent commits block (default: mode-dependent) */
    includeRecentCommits?: boolean;
    /** Whether to include unstaged/staged diff summaries (default: mode-dependent) */
    includeDiffs?: boolean;
    /** Whether to include plan progress (default: mode-dependent) */
    includePlanProgress?: boolean;
    /** Whether to include latest read/fetch context block */
    includeLatestReadContext?: boolean;
    /** Whether to include long-term memory context (default: mode-dependent) */
    includeMemoryContext?: boolean;
}

function truncateText(text: string, maxChars: number): string {
    const cleaned = text.replace(/\s+\n/g, "\n").trim();
    if (cleaned.length <= maxChars) return cleaned;
    return cleaned.substring(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}

function formatPromptMemoryBlock(
    promptMemory: PromptMemoryState | undefined,
    mode: "direct_qa" | "execution",
): string {
    if (!promptMemory) return "";

    const sections: string[] = [];
    const latestHistoryBudget = mode === "direct_qa" ? 450 : 900;
    const agentMapBudget = mode === "direct_qa" ? 900 : 1000;
    const shardBudget = mode === "direct_qa" ? 1500 : 3600;

    if (promptMemory.focus) {
        sections.push(`## Focus Instructions\n${truncateText(promptMemory.focus, mode === "direct_qa" ? 180 : 320)}`);
    }

    if (promptMemory.lessons) {
        sections.push(`## Lessons\n${truncateText(promptMemory.lessons, 300)}`);
    }

    const projectMemoryLines: string[] = [];
    if (promptMemory.latest) {
        projectMemoryLines.push(promptMemory.latest.trim());
    }
    const recentSessions = (promptMemory.recentSessions ?? []).slice(0, mode === "direct_qa" ? 2 : 3);
    if (recentSessions.length > 0) {
        projectMemoryLines.push("Recent Sessions:");
        projectMemoryLines.push(...recentSessions);
    }
    if (projectMemoryLines.length > 0) {
        sections.push(`## Project Memory\n${truncateText(projectMemoryLines.join("\n"), latestHistoryBudget)}`);
    }

    if (promptMemory.agentMap) {
        sections.push(`## Agent Map\n${truncateText(promptMemory.agentMap, agentMapBudget)}`);
    }

    if ((promptMemory.knowledgeShards?.length ?? 0) > 0) {
        const shardDocs = (promptMemory.knowledgeShards ?? [])
            .slice(0, mode === "direct_qa" ? 1 : 2)
            .map((shard) => `### ${shard.title}\nPath: ${shard.path}\n${shard.content.trim()}`);
        sections.push(`## Knowledge Shards\n${truncateText(shardDocs.join("\n\n"), shardBudget)}`);
    }

    if (promptMemory.stalenessNote) {
        sections.push(promptMemory.stalenessNote);
    }

    if (promptMemory.conversationSummary) {
        sections.push(
            `## Conversation Summary\n${truncateText(promptMemory.conversationSummary, mode === "direct_qa" ? 260 : 500)}`,
        );
    }

    if (mode === "execution" && promptMemory.conventions) {
        sections.push(`## Project Conventions\n${truncateText(promptMemory.conventions, 360)}`);
    }

    if (mode === "execution" && promptMemory.workflows) {
        sections.push(`## Known Workflows\n${truncateText(promptMemory.workflows, 360)}`);
    }

    return sections.join("\n\n");
}

/**
 * Format the context into a string for the LLM prompt.
 *
 * When RAG summaries are available, the full file tree is replaced with
 * targeted summaries to minimize token usage.
 */
export function formatContextForPrompt(
    ctx: AgentContextState,
    opts: FormatContextOptions = {},
): string {
    const mode = opts.mode ?? "execution";
    const {
        windowSize = 10,
        outputTruncation = 200,
        readOutputTruncation = 1200,
        useRag = false,
        fileTreeLimit = mode === "direct_qa" ? 20 : 50,
        includeRecentCommits = mode !== "direct_qa",
        includeDiffs = mode !== "direct_qa",
        includePlanProgress = mode !== "direct_qa",
        includeLatestReadContext = true,
        includeMemoryContext = mode !== "direct_qa",
    } = opts;

    const lines: string[] = [];

    // Inject memory context at the top if available
    if (includeMemoryContext) {
        const memoryBlock = formatPromptMemoryBlock(ctx.promptMemory, mode);
        if (memoryBlock) {
            lines.push(memoryBlock);
            lines.push("---");
        }
    }

    lines.push(`Repository: ${ctx.repoRoot}`);
    lines.push(`Branch: ${ctx.branch}`);

    // Enhanced git context: remotes, tracking, fork info (when available)
    if (ctx.enhancedGitContext) {
        const egc = ctx.enhancedGitContext;
        if (egc.remotes.length > 0) {
            lines.push("\nRemotes:");
            for (const r of egc.remotes) {
                const gh = r.github ? ` (${r.github.owner}/${r.github.repo})` : "";
                lines.push(`  ${r.name}: ${r.fetchUrl}${gh}`);
            }
        }
        if (egc.forkInfo?.isFork) {
            lines.push(`Fork: yes (parent: ${egc.forkInfo.parentRepo ?? "unknown"})`);
            if (egc.forkInfo.parentCloneUrl) {
                lines.push(`  Parent clone URL: ${egc.forkInfo.parentCloneUrl}`);
            }
        }
        if (egc.tracking.length > 0) {
            lines.push("Tracking:");
            for (const t of egc.tracking) {
                lines.push(`  ${t.local} → ${t.remote} (ahead ${t.ahead}, behind ${t.behind})`);
            }
        }
    }

    // Recent commits — gives the agent immediate history context
    if (includeRecentCommits && ctx.recentCommits) {
        lines.push(`\nRecent Commits (latest first):\n${ctx.recentCommits}`);
    }

    // RAG summaries before git status/diffs for KV-cache-friendly ordering:
    // RAG is computed once on iteration 0 and stays stable, while status/diffs
    // change after every action. Stable content first extends the cached prefix.
    if (useRag && (ctx.ragSummaries || ctx.directoryOverview)) {
        if (ctx.directoryOverview) {
            lines.push(`\n${ctx.directoryOverview}`);
        }
        if (ctx.ragSummaries) {
            lines.push(`\n${ctx.ragSummaries}`);
        }
    } else if (ctx.fileTree.length > 0) {
        // Fallback: full file tree (original behavior)
        const treeSample = ctx.fileTree.slice(0, fileTreeLimit);
        lines.push(`\nFile Tree (${ctx.fileTree.length} entries):`);
        lines.push(treeSample.join("\n"));
        if (ctx.fileTree.length > fileTreeLimit) {
            lines.push(`... and ${ctx.fileTree.length - fileTreeLimit} more`);
        }
    }

    // Volatile git state — placed after stable RAG context
    if (ctx.status) {
        lines.push(`\nGit Status:\n${ctx.status}`);
    } else {
        lines.push("\nGit Status: clean");
    }

    // Unstaged diff summary
    if (includeDiffs && ctx.diffSummary) {
        lines.push(`\nUnstaged Changes:\n${ctx.diffSummary}`);
    }

    // Staged diff summary
    if (includeDiffs && ctx.stagedSummary) {
        lines.push(`\nStaged Changes:\n${ctx.stagedSummary}`);
    }

    // Plan progress
    if (includePlanProgress && ctx.planSteps.length > 0) {
        lines.push("\nPlan Progress:");
        for (const step of ctx.planSteps) {
            const icon =
                step.status === "completed" ? "✅" : step.status === "failed" ? "❌" : "⏳";
            lines.push(`  ${icon} ${step.description}`);
        }
    }

    // Dedicated detailed block for the latest successful read/context fetch.
    // This preserves critical inspection output while keeping Recent Actions compact.
    const latestRead = [...ctx.observations].reverse().find(
        (obs) =>
            obs.success &&
            (obs.action.startsWith("Read ") || obs.action.startsWith("Fetch context:")),
    );
    if (includeLatestReadContext && latestRead) {
        const preview = latestRead.output.length > readOutputTruncation
            ? latestRead.output.substring(0, readOutputTruncation) + "..."
            : latestRead.output;
        lines.push(`\nLatest Read Context:\n${latestRead.action}\n${preview}`);
    }

    // Recent observations (sliding window)
    if (ctx.observations.length > 0) {
        const recent = ctx.observations.slice(-windowSize);
        lines.push(`\nRecent Actions (${recent.length}/${ctx.observations.length}):`);
        for (const obs of recent) {
            const status = obs.success ? "✓" : "✗";
            const outputPreview = obs.output.length > outputTruncation
                ? obs.output.substring(0, outputTruncation) + "..."
                : obs.output;
            lines.push(`  [${status}] ${obs.action}: ${outputPreview}`);
        }
    }

    return lines.join("\n");
}

/**
 * Build a summary of the current state.
 */
export function summarizeStatus(ctx: AgentContextState): string {
    const parts: string[] = [];
    parts.push(`Branch: ${ctx.branch}`);

    const statusLines = ctx.status.split("\n").filter(Boolean);
    if (statusLines.length > 0) {
        parts.push(`Changes: ${statusLines.length} files`);
    } else {
        parts.push("Working tree: clean");
    }

    if (ctx.planSteps.length > 0) {
        const completed = ctx.planSteps.filter((s) => s.status === "completed").length;
        parts.push(`Plan: ${completed}/${ctx.planSteps.length} steps done`);
    }

    return parts.join(" | ");
}
