import { execa } from "execa";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ExecutionResult } from "../../executor/index.js";
import { shellQuote } from "./shell.js";

export interface CommitDraft {
    branch: string;
    upstream: string | null;
    changeSummary: string;
    commitMessage: string;
    statusLines: string[];
    generatedAt: string;
}

export type PrepareCommitDraftResult =
    | { kind: "empty" }
    | { kind: "draft"; draft: CommitDraft };

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

function parseJsonObject(raw: string): Record<string, unknown> | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function fallbackCommitMessage(statusLines: string[]): string {
    const firstPath = statusLines[0]?.slice(3).trim();
    if (!firstPath) return "Update project changes";
    return `Update ${firstPath}`;
}

function fallbackSummary(statusLines: string[], diffStat: string, aheadSummary: string): string {
    const bullets: string[] = [];
    if (statusLines.length > 0) {
        bullets.push(`- ${statusLines.length} changed path(s) in the working tree`);
    }
    if (diffStat) {
        bullets.push(`- Diff stat: ${diffStat.split("\n")[0]}`);
    }
    if (aheadSummary) {
        bullets.push(`- Branch delta: ${aheadSummary.split("\n")[0]}`);
    }
    return bullets.length > 0 ? bullets.join("\n") : "- Local changes are ready to commit";
}

async function summarizeDraft(
    model: BaseChatModel,
    branch: string,
    upstream: string | null,
    statusLines: string[],
    unstagedStat: string,
    stagedStat: string,
    numstat: string,
    aheadSummary: string,
): Promise<{ summary: string; commitMessage: string }> {
    const prompt = [
        `Branch: ${branch}`,
        `Upstream: ${upstream ?? "(none)"}`,
        "",
        "Git status:",
        statusLines.join("\n") || "(clean)",
        "",
        "Unstaged diff stat:",
        unstagedStat || "(none)",
        "",
        "Staged diff stat:",
        stagedStat || "(none)",
        "",
        "Combined numstat:",
        numstat || "(none)",
        "",
        "Commits ahead of upstream:",
        aheadSummary || "(none)",
        "",
        "Return JSON only with this shape:",
        '{"summary":"2-4 short bullet lines separated by \\n","commitMessage":"imperative single-line subject under 72 chars"}',
    ].join("\n");

    const response = await model.invoke([
        new SystemMessage("You are an expert git assistant. Produce concise, practical commit drafts."),
        new HumanMessage(prompt),
    ]);

    const rawText =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

    const parsed = parseJsonObject(rawText);
    const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
    const commitMessage = typeof parsed?.commitMessage === "string" ? parsed.commitMessage.trim() : "";

    return {
        summary,
        commitMessage,
    };
}

export async function prepareCommitDraft(
    repoRoot: string,
    model: BaseChatModel,
): Promise<PrepareCommitDraftResult> {
    const [branch, upstream, status, unstagedStat, stagedStat, numstat] = await Promise.all([
        gitOutput(["branch", "--show-current"], repoRoot),
        gitOutput(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repoRoot),
        gitOutput(["status", "--short"], repoRoot),
        gitOutput(["diff", "--stat"], repoRoot),
        gitOutput(["diff", "--cached", "--stat"], repoRoot),
        gitOutput(["diff", "--cached", "--numstat"], repoRoot).then(async (stagedNumstat) => {
            const unstagedNumstat = await gitOutput(["diff", "--numstat"], repoRoot);
            return [stagedNumstat, unstagedNumstat].filter(Boolean).join("\n");
        }),
    ]);

    const statusLines = status ? status.split("\n").filter(Boolean) : [];
    if (statusLines.length === 0) {
        return { kind: "empty" };
    }

    const aheadSummary = upstream
        ? await gitOutput(["log", "--oneline", `${upstream}..HEAD`], repoRoot)
        : "";

    let summary = "";
    let commitMessage = "";
    try {
        const aiDraft = await summarizeDraft(
            model,
            branch || "unknown",
            upstream || null,
            statusLines,
            unstagedStat,
            stagedStat,
            numstat,
            aheadSummary,
        );
        summary = aiDraft.summary;
        commitMessage = aiDraft.commitMessage;
    } catch {
        // Fall back to deterministic text below.
    }

    return {
        kind: "draft",
        draft: {
            branch: branch || "unknown",
            upstream: upstream || null,
            changeSummary: summary || fallbackSummary(statusLines, unstagedStat || stagedStat, aheadSummary),
            commitMessage: commitMessage || fallbackCommitMessage(statusLines),
            statusLines,
            generatedAt: new Date().toISOString(),
        },
    };
}

export async function reviseCommitDraft(
    draft: CommitDraft,
    instruction: string,
    model: BaseChatModel,
): Promise<CommitDraft> {
    const response = await model.invoke([
        new SystemMessage("You revise commit drafts. Keep the summary concise and the commit message to one imperative sentence."),
        new HumanMessage([
            `Current branch: ${draft.branch}`,
            `Current commit message: ${draft.commitMessage}`,
            "",
            "Current change summary:",
            draft.changeSummary,
            "",
            "Changed paths:",
            draft.statusLines.join("\n") || "(none)",
            "",
            `User instruction: ${instruction}`,
            "",
            'Return JSON only: {"summary":"updated summary","commitMessage":"updated message"}',
        ].join("\n")),
    ]);

    const rawText =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);
    const parsed = parseJsonObject(rawText);

    return {
        ...draft,
        changeSummary: typeof parsed?.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim()
            : draft.changeSummary,
        commitMessage: typeof parsed?.commitMessage === "string" && parsed.commitMessage.trim()
            ? parsed.commitMessage.trim()
            : draft.commitMessage,
        generatedAt: new Date().toISOString(),
    };
}

export async function executeCommitDraft(
    draft: CommitDraft,
    runGitCommand: PermissionedGitRunner,
    mode: "commit" | "push",
): Promise<ExecutionResult> {
    const stageResult = await runGitCommand("add -A", "Stage all current changes for the commit draft.");
    if (!stageResult.success) return stageResult;

    const commitResult = await runGitCommand(
        `commit -m ${shellQuote(draft.commitMessage)}`,
        `Create a commit on ${draft.branch} using the approved draft message.`,
    );
    if (!commitResult.success || mode === "commit") {
        return commitResult;
    }

    const pushCommand = draft.upstream
        ? "push"
        : `push -u origin ${shellQuote(draft.branch)}`;

    return runGitCommand(
        pushCommand,
        `Push ${draft.branch} to its remote after committing the approved draft.`,
    );
}
