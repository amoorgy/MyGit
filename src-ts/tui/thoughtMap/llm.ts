/**
 * Thought Map LLM integration — generation and refinement.
 *
 * Uses direct model.invoke() calls (same pattern as plan/engine.ts),
 * NOT the agent loop. This keeps thought map generation fast and
 * isolated from agent permission checks.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { gatherContext, formatContextForPrompt, type AgentContextState } from "../../agent/context.js";
import type {
    ThoughtMap,
    ThoughtMapNode,
    ThoughtNodeStatus,
    RefinementEntry,
} from "./types.js";
import { findNodeById } from "./types.js";

// ============================================================================
// GENERATION
// ============================================================================

const GENERATION_SYSTEM_PROMPT = `You are a strategic planning assistant. When given a goal and repository context, generate a thought map: a structured tree of reasoning nodes showing how to approach the problem.

This is NOT an execution plan with shell commands. You are mapping out the conceptual territory — each node captures a distinct concern, sub-problem, or decision point.

Return ONLY valid JSON matching this schema:
{
  "nodes": [
    {
      "id": "node_0",
      "title": "Short 1-line label (under 50 chars)",
      "description": "Multi-sentence explanation of this concern or step",
      "reasoning": "Why this matters and what to consider",
      "dependencies": [],
      "children": [],
      "status": "draft",
      "depth": 0,
      "safetyNote": null,
      "command": null
    }
  ]
}

Rules:
- Generate 3-7 root nodes. Not too few (shallow), not too many (overwhelming).
- Keep titles under 50 chars.
- Make dependencies explicit: if node_2 must happen after node_0, put "node_0" in node_2's dependencies array.
- Use status "draft" for all nodes in initial generation.
- Children should be empty initially — they get populated by user-driven refinement.
- safetyNote and command are optional (use null if not applicable).
- command is for when a concrete git/shell command is obvious for that step.`;

export async function generateThoughtMap(
    intent: string,
    model: BaseChatModel,
): Promise<ThoughtMap> {
    const ctx = await gatherContext();
    const contextStr = formatContextForPrompt(ctx);

    const userPrompt = `Repository Context:\n${contextStr}\n\nGoal: ${intent}\n\nGenerate a thought map:`;

    const response = await model.invoke([
        new SystemMessage(GENERATION_SYSTEM_PROMPT),
        new HumanMessage(userPrompt),
    ]);

    const rawText =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

    return parseThoughtMapResponse(rawText, intent);
}

/**
 * Generate a thought map using pre-gathered context (for the two-step flow).
 */
export async function generateThoughtMapWithContext(
    intent: string,
    model: BaseChatModel,
    ctx: AgentContextState,
): Promise<ThoughtMap> {
    const contextStr = formatContextForPrompt(ctx);
    const userPrompt = `Repository Context:\n${contextStr}\n\nGoal: ${intent}\n\nGenerate a thought map:`;

    const response = await model.invoke([
        new SystemMessage(GENERATION_SYSTEM_PROMPT),
        new HumanMessage(userPrompt),
    ]);

    const rawText =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

    return parseThoughtMapResponse(rawText, intent);
}

// ============================================================================
// REFINEMENT
// ============================================================================

export async function refineThoughtMapNode(
    map: ThoughtMap,
    nodeId: string,
    refinementPrompt: string,
    model: BaseChatModel,
): Promise<ThoughtMap> {
    const targetNode = findNodeById(map.nodes, nodeId);
    if (!targetNode) {
        throw new Error(`Node "${nodeId}" not found in thought map`);
    }

    const historyStr = map.refinementHistory.length > 0
        ? map.refinementHistory
            .map((r) => `  - Node "${r.nodeId}": "${r.prompt}"`)
            .join("\n")
        : "  (none)";

    const systemPrompt = `You are refining a specific node in an existing thought map. The user has selected a node and asked to develop it further. You may:
1. Expand the node's description and reasoning (more depth)
2. Add child nodes that break the concern into sub-concerns
3. Update the node's status from "draft" to "maturing" or "mature"
4. Add a safetyNote if you identify a risk

Return the COMPLETE updated thought map JSON (same schema), with the targeted node modified. Do NOT change other nodes.

Current thought map:
${JSON.stringify({ nodes: map.nodes }, null, 2)}

Refinement history:
${historyStr}

The user selected node: "${nodeId}" ("${targetNode.title}")
User instruction: "${refinementPrompt}"

Return ONLY valid JSON with the updated "nodes" array.`;

    const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(refinementPrompt),
    ]);

    const rawText =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

    const updated = parseThoughtMapResponse(rawText, map.intent);

    // Merge: use updated nodes but preserve any the LLM accidentally dropped
    const mergedNodes = mergeNodes(map.nodes, updated.nodes);

    const entry: RefinementEntry = {
        nodeId,
        prompt: refinementPrompt,
        previousDescription: targetNode.description,
        timestamp: Date.now(),
    };

    return {
        ...map,
        nodes: mergedNodes,
        lastRefinedAt: Date.now(),
        refinementHistory: [...map.refinementHistory, entry],
    };
}

// ============================================================================
// PARSING
// ============================================================================

function parseThoughtMapResponse(raw: string, intent: string): ThoughtMap {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error("LLM response contained no JSON");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const nodes = (parsed.nodes ?? []).map((n: any, i: number) =>
        normalizeNode(n, i, 0),
    );

    return {
        id: `map_${Date.now()}`,
        intent,
        nodes,
        createdAt: Date.now(),
        lastRefinedAt: Date.now(),
        refinementHistory: [],
    };
}

function normalizeNode(raw: any, index: number, depth: number): ThoughtMapNode {
    const status: ThoughtNodeStatus =
        raw.status === "maturing" || raw.status === "mature" || raw.status === "blocked"
            ? raw.status
            : "draft";

    return {
        id: raw.id ?? `node_${index}`,
        title: (raw.title ?? raw.description ?? `Step ${index + 1}`).slice(0, 80),
        description: raw.description ?? "",
        reasoning: raw.reasoning ?? "",
        dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
        children: Array.isArray(raw.children)
            ? raw.children.map((c: any, j: number) =>
                normalizeNode(c, j, depth + 1),
            )
            : [],
        status,
        depth,
        safetyNote: raw.safetyNote ?? undefined,
        command: raw.command ?? undefined,
    };
}

/**
 * Merge updated nodes from LLM with the original nodes.
 * If a node ID exists in both, use the updated version.
 * If a node ID only exists in the original, preserve it.
 */
function mergeNodes(
    original: ThoughtMapNode[],
    updated: ThoughtMapNode[],
): ThoughtMapNode[] {
    const updatedMap = new Map<string, ThoughtMapNode>();
    for (const node of updated) {
        updatedMap.set(node.id, node);
    }

    const result: ThoughtMapNode[] = [];

    // Start with updated nodes in their order
    for (const node of updated) {
        result.push(node);
    }

    // Add any original nodes that were dropped
    for (const node of original) {
        if (!updatedMap.has(node.id)) {
            result.push(node);
        }
    }

    return result;
}
