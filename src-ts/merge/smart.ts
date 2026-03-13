/**
 * Smart merge resolution — ported from Rust src/merge/smart.rs
 *
 * Uses LLM to generate merge conflict resolution suggestions,
 * then evaluates them with the algorithmic scorer.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type {
    SmartSolutionPlan,
    SmartSolutionRequest,
    SmartMergeDecision,
    ConflictHunk,
} from "./types.js";

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Generate a single smart resolution recommendation for a conflict hunk.
 * Returns one plan with step-by-step reasoning for the user to approve/deny.
 */
export async function generateSmartSolution(
    request: SmartSolutionRequest,
    llm: BaseChatModel,
): Promise<SmartSolutionPlan | null> {
    const prompt = buildSmartMergePrompt(request);

    const response = await llm.invoke([
        new SystemMessage(SMART_MERGE_SYSTEM_PROMPT),
        new HumanMessage(prompt),
    ]);

    const responseText = typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    return parseSmartResponse(responseText);
}

/**
 * Re-generate a smart resolution with custom user instructions.
 * Used when user selects "Other" and provides specific guidance.
 */
export async function regenerateWithInstructions(
    request: SmartSolutionRequest,
    userInstruction: string,
    llm: BaseChatModel,
): Promise<SmartSolutionPlan | null> {
    const prompt = buildSmartMergePrompt(request) +
        `\n\nUser instruction: ${userInstruction}\nFollow the user's guidance for how to resolve this conflict.`;

    const response = await llm.invoke([
        new SystemMessage(SMART_MERGE_SYSTEM_PROMPT),
        new HumanMessage(prompt),
    ]);

    const responseText = typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    return parseSmartResponse(responseText);
}

/**
 * @deprecated Use generateSmartSolution() instead. Kept for backward compat.
 */
export async function generateSmartSolutions(
    request: SmartSolutionRequest,
    llm: BaseChatModel,
): Promise<SmartSolutionPlan[]> {
    const plan = await generateSmartSolution(request, llm);
    return plan ? [plan] : [];
}

/**
 * Build a SmartSolutionRequest from a ConflictHunk and surrounding context.
 */
export function buildSmartRequest(
    hunk: ConflictHunk,
    filePath: string,
    contextBefore: string[],
    contextAfter: string[],
    conventions: string[] = [],
): SmartSolutionRequest {
    return {
        hunkId: hunk.id,
        ours: hunk.ours,
        theirs: hunk.theirs,
        base: hunk.base,
        contextBefore,
        contextAfter,
        filePath,
        conventions,
        userMergePrefs: {
            defaultStyle: null,
            preferOursPatterns: [],
            preferTheirsPatterns: [],
        },
    };
}

/**
 * Extract JSON object from potentially markdown-wrapped LLM response.
 */
export function extractJson(response: string): string {
    const trimmed = response.trim();

    // Direct JSON
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return trimmed;
    }

    // JSON inside ```json ... ``` fences
    const jsonFenceMatch = trimmed.match(/```json\s*\n?([\s\S]*?)```/);
    if (jsonFenceMatch) {
        return jsonFenceMatch[1].trim();
    }

    // JSON inside ``` ... ``` fences
    const fenceMatch = trimmed.match(/```\s*\n?([\s\S]*?)```/);
    if (fenceMatch) {
        const candidate = fenceMatch[1].trim();
        if (candidate.startsWith("{") || candidate.startsWith("[")) {
            return candidate;
        }
    }

    // Find JSON object anywhere in text
    const braceStart = trimmed.indexOf("{");
    const braceEnd = trimmed.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
        return trimmed.slice(braceStart, braceEnd + 1);
    }

    throw new Error("Could not find JSON in LLM response");
}

// ── Prompt Construction ────────────────────────────────────────────────

const SMART_MERGE_SYSTEM_PROMPT = `You are a merge conflict resolution expert. Review the conflict and decide the single best resolution.

Respond with a single JSON object:
{
  "strategy_name": "descriptive name for the approach",
  "decision": "accept_ours" | "accept_theirs" | "hybrid",
  "resolved_lines": ["line1", "line2", ...],
  "reasoning_steps": [
    "Step 1: describe what you observed...",
    "Step 2: describe your analysis...",
    "Step 3: explain why this resolution is best..."
  ],
  "explanation": "one-sentence summary of why this is the best approach"
}

Rules:
- "accept_ours": keep the current branch code as-is
- "accept_theirs": keep the incoming branch code as-is
- "hybrid": combine elements from both sides into a merged result
- reasoning_steps must explain your thought process clearly so the developer can evaluate your decision
- Consider semantic meaning, whether changes are complementary or contradictory, code style, and surrounding context`;

function buildSmartMergePrompt(request: SmartSolutionRequest): string {
    const parts: string[] = [];

    parts.push(`File: ${request.filePath}`);
    parts.push(`Hunk #${request.hunkId}`);

    if (request.contextBefore.length > 0) {
        parts.push(`\nContext before:\n${request.contextBefore.join("\n")}`);
    }

    parts.push(`\nOurs (current branch):\n${request.ours.join("\n")}`);

    if (request.base) {
        parts.push(`\nBase (common ancestor):\n${request.base.join("\n")}`);
    }

    parts.push(`\nTheirs (incoming branch):\n${request.theirs.join("\n")}`);

    if (request.contextAfter.length > 0) {
        parts.push(`\nContext after:\n${request.contextAfter.join("\n")}`);
    }

    if (request.conventions.length > 0) {
        parts.push(`\nProject conventions:\n${request.conventions.join("\n")}`);
    }

    return parts.join("\n");
}

// ── Response Parsing ───────────────────────────────────────────────────

interface RawSmartResponse {
    strategy_name?: string;
    decision?: string;
    resolved_lines?: string[];
    reasoning_steps?: string[];
    explanation?: string;
}

const VALID_DECISIONS = new Set(["accept_ours", "accept_theirs", "hybrid"]);

function parseSmartResponse(responseText: string): SmartSolutionPlan | null {
    try {
        const json = extractJson(responseText);
        const parsed = JSON.parse(json) as RawSmartResponse;

        // If LLM returns an array, take the first
        const obj: RawSmartResponse | undefined = Array.isArray(parsed) ? (parsed as RawSmartResponse[])[0] : parsed;
        if (!obj) return null;

        if (
            typeof obj.strategy_name !== "string" ||
            !Array.isArray(obj.resolved_lines) ||
            typeof obj.explanation !== "string"
        ) {
            return null;
        }

        const decision = VALID_DECISIONS.has(obj.decision ?? "")
            ? (obj.decision as SmartMergeDecision)
            : "hybrid";

        return {
            id: 0,
            strategyName: obj.strategy_name,
            resolvedLines: obj.resolved_lines,
            explanation: obj.explanation,
            decision,
            reasoningSteps: Array.isArray(obj.reasoning_steps)
                ? obj.reasoning_steps.filter((s): s is string => typeof s === "string")
                : [],
        };
    } catch {
        return null;
    }
}
