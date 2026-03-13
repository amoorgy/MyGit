/**
 * PR Review LLM analyzer.
 * Pattern mirrors merge/smart.ts: file-by-file analysis + final synthesis.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { extractJson } from "../merge/smart.js";
import type {
    PRFile,
    PRData,
    PRReview,
    ReviewComment,
    FileSummary,
    PRFileAnalysisContext,
    ReviewCommentSeverity,
    ReviewCommentCategory,
} from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────

const MAX_PATCH_CHARS = 8000;

// ── System Prompts ────────────────────────────────────────────────────

const FILE_REVIEW_SYSTEM_PROMPT = `You are a senior engineer performing a thorough code review.
Analyze the file diff from a pull request and return a JSON array of review comments.

Each comment must be a JSON object:
{
  "file_path": "path/to/file",
  "line": <integer or null>,
  "severity": "critical" | "major" | "minor" | "suggestion" | "praise",
  "category": "bug" | "security" | "performance" | "style" | "logic" | "docs" | "test" | "praise",
  "title": "short title (10 words max)",
  "body": "detailed explanation of the issue",
  "suggestion": "optional: proposed fix as a code snippet",
  "reasoning_steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."]
}

Severity rules:
- "critical": data loss, security vulnerability, crash, auth bypass
- "major": significant logic errors, missing error handling, broken functionality
- "minor": code smell, unclear naming, minor correctness issue
- "suggestion": improvement opportunity, not a problem
- "praise": explicitly note excellent, clean, or well-thought-out code

Rules:
- reasoning_steps must explain your analysis so the developer can evaluate it
- Return [] (empty array) if the file has no issues worth noting
- Only report genuine issues — avoid nitpicking style for its own sake
- Consider the PR context (title, description, branch names) when evaluating intent`;

const SYNTHESIS_SYSTEM_PROMPT = `You are a senior engineering lead synthesizing a code review.
Given per-file review findings, produce an overall PR assessment.

Return a single JSON object:
{
  "overall_summary": "2-3 sentence summary of code quality and main concerns",
  "overall_decision": "approve" | "request_changes" | "comment",
  "risk_score": <integer 0-10>,
  "file_summaries": [
    {
      "file_path": "path/to/file",
      "risk_level": "high" | "medium" | "low",
      "summary": "one sentence about this file's changes",
      "comment_count": <integer>
    }
  ]
}

Decision rules:
- "approve": code is good, only minor or no issues
- "request_changes": critical or major issues must be addressed before merge
- "comment": notable issues but author's call; no blockers

Risk score:
- 0-2: clean, minimal risk
- 3-5: minor issues, low risk
- 6-8: significant issues, needs attention
- 9-10: critical issues, do not merge`;

// ── File Analysis ─────────────────────────────────────────────────────

interface RawReviewComment {
    file_path?: string;
    line?: number | null;
    severity?: string;
    category?: string;
    title?: string;
    body?: string;
    suggestion?: string;
    reasoning_steps?: string[];
}

const VALID_SEVERITIES = new Set<string>(["critical", "major", "minor", "suggestion", "praise"]);
const VALID_CATEGORIES = new Set<string>(["bug", "security", "performance", "style", "logic", "docs", "test", "praise"]);

let _commentCounter = 0;
function nextId(): string {
    return `rc-${Date.now()}-${++_commentCounter}`;
}

function parseFileComments(responseText: string, filePath: string): ReviewComment[] {
    try {
        const json = extractJson(responseText);
        const parsed = JSON.parse(json);
        const arr: RawReviewComment[] = Array.isArray(parsed) ? parsed : [parsed];

        return arr
            .filter((r): r is RawReviewComment => typeof r === "object" && r !== null)
            .map((r): ReviewComment | null => {
                if (!r.title || !r.body) return null;

                const severity: ReviewCommentSeverity = VALID_SEVERITIES.has(r.severity ?? "")
                    ? (r.severity as ReviewCommentSeverity)
                    : "minor";
                const category: ReviewCommentCategory = VALID_CATEGORIES.has(r.category ?? "")
                    ? (r.category as ReviewCommentCategory)
                    : "style";

                return {
                    id: nextId(),
                    filePath: r.file_path ?? filePath,
                    line: typeof r.line === "number" ? r.line : undefined,
                    severity,
                    category,
                    title: String(r.title),
                    body: String(r.body),
                    suggestion: r.suggestion ? String(r.suggestion) : undefined,
                    reasoningSteps: Array.isArray(r.reasoning_steps)
                        ? r.reasoning_steps.filter((s): s is string => typeof s === "string")
                        : [],
                };
            })
            .filter((c): c is ReviewComment => c !== null);
    } catch {
        return [];
    }
}

/**
 * Analyze a single file diff and return review comments.
 * Skips binary files and files with no patch.
 */
export async function analyzeFile(
    file: PRFile,
    context: PRFileAnalysisContext,
    llm: BaseChatModel,
): Promise<ReviewComment[]> {
    if (!file.patch || file.patch.trim() === "") {
        return [];
    }

    const patch = file.patch.length > MAX_PATCH_CHARS
        ? file.patch.slice(0, MAX_PATCH_CHARS) + "\n... [diff truncated]"
        : file.patch;

    const parts: string[] = [
        `PR: ${context.title}`,
        `Description: ${context.description || "(none)"}`,
        `Branch: ${context.headBranch} → ${context.baseBranch}`,
        `Author: ${context.author}`,
        ``,
        `File: ${file.path} (${file.status})`,
        `+${file.additions} / -${file.deletions} lines`,
        ``,
        `Diff:`,
        patch,
    ];

    if (context.conventions.length > 0) {
        parts.push(`\nProject conventions:\n${context.conventions.slice(0, 5).join("\n")}`);
    }

    const prompt = parts.join("\n");

    const response = await llm.invoke([
        new SystemMessage(FILE_REVIEW_SYSTEM_PROMPT),
        new HumanMessage(prompt),
    ]);

    const responseText = typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    return parseFileComments(responseText, file.path);
}

// ── Synthesis ─────────────────────────────────────────────────────────

interface RawSynthesis {
    overall_summary?: string;
    overall_decision?: string;
    risk_score?: number;
    file_summaries?: Array<{
        file_path?: string;
        risk_level?: string;
        summary?: string;
        comment_count?: number;
    }>;
}

function parseSynthesis(responseText: string): {
    summary: string;
    decision: PRReview["overallDecision"];
    riskScore: number;
    fileSummaries: FileSummary[];
} {
    try {
        const json = extractJson(responseText);
        const parsed = JSON.parse(json) as RawSynthesis;

        const decision: PRReview["overallDecision"] =
            parsed.overall_decision === "approve" || parsed.overall_decision === "request_changes"
                ? parsed.overall_decision
                : "comment";

        const riskScore = typeof parsed.risk_score === "number"
            ? Math.max(0, Math.min(10, Math.round(parsed.risk_score)))
            : 5;

        const fileSummaries: FileSummary[] = (parsed.file_summaries ?? []).map(fs => ({
            filePath: fs.file_path ?? "",
            riskLevel: (fs.risk_level === "high" || fs.risk_level === "medium" || fs.risk_level === "low")
                ? fs.risk_level
                : "medium",
            summary: fs.summary ?? "",
            commentCount: fs.comment_count ?? 0,
        }));

        return {
            summary: parsed.overall_summary ?? "Review complete.",
            decision,
            riskScore,
            fileSummaries,
        };
    } catch {
        return {
            summary: "Review complete.",
            decision: "comment",
            riskScore: 5,
            fileSummaries: [],
        };
    }
}

/**
 * Synthesize per-file results into an overall PR review.
 * Makes one final LLM call on summaries (not raw diffs) to stay token-efficient.
 */
export async function synthesizeReview(
    allComments: ReviewComment[],
    prData: PRData,
    llm: BaseChatModel,
    modelName: string,
    onProgress?: (phase: string) => void,
): Promise<PRReview> {
    onProgress?.("Synthesizing review...");

    // Build per-file summary for the synthesis prompt
    const fileGroups = new Map<string, ReviewComment[]>();
    for (const comment of allComments) {
        const existing = fileGroups.get(comment.filePath) ?? [];
        existing.push(comment);
        fileGroups.set(comment.filePath, existing);
    }

    const fileSummaryLines: string[] = [];
    for (const [filePath, comments] of fileGroups) {
        const criticalCount = comments.filter(c => c.severity === "critical").length;
        const majorCount = comments.filter(c => c.severity === "major").length;
        const titles = comments.slice(0, 3).map(c => `  - [${c.severity.toUpperCase()}] ${c.title}`).join("\n");
        fileSummaryLines.push(`${filePath}: ${comments.length} comments (${criticalCount} critical, ${majorCount} major)\n${titles}`);
    }

    // Include files with no comments
    for (const file of prData.files) {
        if (!fileGroups.has(file.path)) {
            fileSummaryLines.push(`${file.path}: no issues found`);
        }
    }

    const prompt = [
        `PR #${prData.number}: ${prData.title}`,
        `Branch: ${prData.headBranch} → ${prData.baseBranch}`,
        `Author: ${prData.author}`,
        `Changed files: ${prData.changedFiles} (+${prData.totalAdditions}/-${prData.totalDeletions})`,
        ``,
        `Per-file findings:`,
        fileSummaryLines.join("\n\n"),
    ].join("\n");

    const response = await llm.invoke([
        new SystemMessage(SYNTHESIS_SYSTEM_PROMPT),
        new HumanMessage(prompt),
    ]);

    const responseText = typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const { summary, decision, riskScore, fileSummaries } = parseSynthesis(responseText);

    // Merge LLM file summaries with comment data
    const mergedFileSummaries: FileSummary[] = prData.files.map(file => {
        const llmSummary = fileSummaries.find(fs => fs.filePath === file.path);
        const fileComments = fileGroups.get(file.path) ?? [];
        return {
            filePath: file.path,
            riskLevel: llmSummary?.riskLevel ?? (fileComments.some(c => c.severity === "critical") ? "high" :
                fileComments.some(c => c.severity === "major") ? "medium" : "low"),
            summary: llmSummary?.summary ?? `${file.status} file (+${file.additions}/-${file.deletions})`,
            commentCount: fileComments.length,
        };
    });

    return {
        id: crypto.randomUUID(),
        prNumber: prData.number,
        repoOwner: "",
        repoName: "",
        prTitle: prData.title,
        headSha: prData.headSha,
        overallSummary: summary,
        overallDecision: decision,
        riskScore,
        comments: allComments,
        fileSummaries: mergedFileSummaries,
        generatedAt: new Date().toISOString(),
        modelUsed: modelName,
        tokensUsed: 0,
    };
}

/**
 * Full PR analysis: analyze each file then synthesize overall review.
 * Calls onProgress with status updates for TUI progress display.
 */
export async function analyzePR(
    prData: PRData,
    conventions: string[],
    llm: BaseChatModel,
    modelName: string,
    onProgress?: (message: string) => void,
): Promise<PRReview> {
    const context: PRFileAnalysisContext = {
        title: prData.title,
        description: prData.description,
        author: prData.author,
        headBranch: prData.headBranch,
        baseBranch: prData.baseBranch,
        conventions,
    };

    const allComments: ReviewComment[] = [];
    const analyzableFiles = prData.files.filter(f => f.patch && f.patch.trim() !== "");

    for (let i = 0; i < analyzableFiles.length; i++) {
        const file = analyzableFiles[i];
        onProgress?.(`Analyzing file ${i + 1}/${analyzableFiles.length}: ${file.path}`);

        try {
            const comments = await analyzeFile(file, context, llm);
            allComments.push(...comments);
        } catch (err) {
            // Non-fatal: continue with other files
            console.error(`Failed to analyze ${file.path}:`, err);
        }
    }

    const review = await synthesizeReview(allComments, prData, llm, modelName, onProgress);
    return review;
}
