/**
 * Agent Graph — replaces Rust `src/agent/loop.rs`
 *
 * Uses LangGraph StateGraph to define the agent loop as an explicit
 * graph with nodes for context gathering, LLM calls, parsing,
 * permission checks, execution, and observation recording.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { Annotation, StateGraph, END, START } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import {
    type AgentAction,
    type AgentResponse,
    AgentResponseSchema,
    actionRequiresExecution,
    actionIsFetchContext,
    actionConsequences,
    actionSafetyTier,
    buildAgentSystemPrompt,
    buildAgentPrompt,
    describeAction,
    inferTaskMode,
    inferExecutionInitPolicy,
} from "./protocol.js";
import {
    type AgentContextState,
    type Observation,
    gatherContext,
    refreshContext,
    formatContextForPrompt,
    addObservation,
    setActivePlan,
} from "./context.js";
import { PermissionManager, type PermissionResponse } from "./permissions.js";
import { type AgentEvent, AgentEventBus } from "./events.js";
import { executeAction, dryRun, isLikelyExternalFetchShellCommand, hasMergeConflictMarkers } from "../executor/index.js";
import { listConflictedFiles } from "../merge/resolver.js";
import { MyGitDatabase } from "../storage/database.js";
import { AgentMemory } from "../learning/memory.js";
import type { LearningConfig, ContextConfig } from "../config/settings.js";
import { computeAgentRecursionLimit, normalizeAgentRuntimeErrorMessage } from "./runtime.js";
import { buildTracingConfig } from "./tracing.js";
import { ContextRetriever } from "../context/retriever.js";
import { loadProjectMemory } from "../memory/sessionMemory.js";
import { captureFailureLessons, loadLessons } from "../harness/lessons.js";
import { quickStalenessCheck } from "../harness/staleness.js";
import { loadAgentMap, loadKnowledgeManifest, loadKnowledgeShard } from "../knowledge/store.js";
import { selectKnowledgeShards, type ShardContextHints } from "../knowledge/selector.js";
import { matchRecipe, formatRecipeForPrompt, isGitWorkflowRequest } from "../recipes/matcher.js";
import { gatherEnhancedGitContext } from "../recipes/context.js";
import {
    calculateBudget,
    fitToBudget,
    estimateTokens,
    adaptiveWindowSize,
    adaptiveOutputTruncation,
    adaptiveReadOutputTruncation,
} from "../context/budget.js";

// ============================================================================
// STATE DEFINITION
// ============================================================================

/**
 * The graph state channels, annotated for LangGraph.
 */
const AgentGraphState = Annotation.Root({
    // Inputs
    request: Annotation<string>,
    maxIterations: Annotation<number>,
    dryRun: Annotation<boolean>,
    showThinking: Annotation<boolean>,

    // Evolving state
    context: Annotation<AgentContextState>,
    iteration: Annotation<number>,
    parseFailures: Annotation<number>,
    done: Annotation<boolean>,

    // Current step
    currentAction: Annotation<AgentAction | null>,
    currentReasoning: Annotation<string>,
    llmRawResponse: Annotation<string>,

    // Permission
    permissionDecision: Annotation<"allowed" | "denied" | "need_prompt">,

    // Loop guard
    lastActionSignature: Annotation<string>,
    repeatCount: Annotation<number>,

    // RAG fetch counter (max 5 free fetches per iteration cycle)
    fetchCount: Annotation<number>,
});

type GraphState = typeof AgentGraphState.State;

function messageContentText(message: BaseMessage): string {
    const content = (message as AIMessage | HumanMessage | SystemMessage).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part: any) => (typeof part === "string" ? part : JSON.stringify(part)))
            .join("\n");
    }
    return JSON.stringify(content);
}

function estimateConversationHistoryTokens(history?: BaseMessage[]): number {
    if (!history || history.length === 0) return 0;
    return history.reduce((sum, msg) => sum + estimateTokens(messageContentText(msg)), 0);
}

// ============================================================================
// GRAPH BUILDER
// ============================================================================

export interface AgentGraphOptions {
    model: BaseChatModel;
    permissions: PermissionManager;
    eventBus: AgentEventBus;
    db: MyGitDatabase;
    maxIterations?: number;
    dryRun?: boolean;
    showThinking?: boolean;
    signal?: AbortSignal;
    learning?: LearningConfig;
    contextConfig?: ContextConfig;
    conversationSummary?: string;
    /** Prior conversation turns to inject for multi-turn memory */
    conversationHistory?: BaseMessage[];
    /** Context window size in tokens (used for budget calculation) */
    contextWindow?: number;
}

/**
 * Build the agent LangGraph StateGraph.
 */
export function buildAgentGraph(options: AgentGraphOptions) {
    const {
        model,
        permissions,
        eventBus,
        db,
    } = options;

    const memory = new AgentMemory(
        db,
        options.learning?.minFrequency ?? 1,
        options.learning?.confidenceThreshold ?? 0,
    );

    const contextRetriever = new ContextRetriever(db);
    const ragEnabled = options.contextConfig?.enabled ?? true;
    const retrievalTopK = options.contextConfig?.retrievalTopK ?? 5;
    const contextWindow = options.contextWindow ?? 32000;
    const budgetRatio = options.contextConfig?.contextBudgetRatio ?? 0.25;
    const conversationHistoryTokens = estimateConversationHistoryTokens(options.conversationHistory);

    function systemPromptReserveForRequest(request: string): number {
        const taskMode = inferTaskMode(request);
        const initPolicy = inferExecutionInitPolicy(request);
        return estimateTokens(buildAgentSystemPrompt(taskMode, initPolicy));
    }

    // ---- Node: gatherContext ----
    async function gatherContextNode(state: GraphState): Promise<Partial<GraphState>> {
        if (options.signal?.aborted) {
            eventBus.emit({ type: "cancelled" });
            return { done: true };
        }

        let ctx: AgentContextState;
        if (state.iteration === 0) {
            ctx = await gatherContext();
            ctx = { ...ctx, request: state.request };
            ctx.promptMemory = ctx.promptMemory ?? { recentSessions: [] };
            const taskMode = inferTaskMode(state.request);

            // Load memory context
            try {
                await memory.loadContext(ctx.repoRoot);
                ctx.promptMemory.conventions = memory.getConventionContext() || undefined;
                ctx.promptMemory.workflows = memory.retriever.formatContext(state.request) || undefined;
            } catch (err) {
                // Ignore memory errors, proceed without it
            }

            // Inject prior conversation summary if available (takes priority)
            if (options.conversationSummary) {
                ctx.promptMemory.conversationSummary = options.conversationSummary;
            }

            // Inject user-defined focus instructions from .mygit/FOCUS.md (highest priority)
            try {
                const focusPath = path.join(ctx.repoRoot, ".mygit", "FOCUS.md");
                const raw = await fs.readFile(focusPath, "utf-8");
                const trimmed = raw.trim().slice(0, 500);
                if (trimmed) {
                    ctx.promptMemory.focus = trimmed;
                }
            } catch {
                // FOCUS.md absent — skip silently
            }

            // Inject cross-session failure lessons from .mygit/LESSONS.md
            try {
                const lessons = await loadLessons(ctx.repoRoot);
                if (lessons) {
                    ctx.promptMemory.lessons = lessons;
                }
            } catch {
                // LESSONS.md absent — skip silently
            }

            // Inject persistent project memory from .mygit/MYGIT.md
            try {
                const memoryState = await loadProjectMemory(ctx.repoRoot);
                if (memoryState.last || memoryState.next) {
                    ctx.promptMemory.latest = `Last: ${memoryState.last}\nNext: ${memoryState.next}`;
                }
                if (memoryState.recentSessions.length > 0) {
                    ctx.promptMemory.recentSessions = memoryState.recentSessions.slice(0, 3);
                }
            } catch {
                // MYGIT.md doesn't exist yet — skip silently
            }

            // Inject managed AGENTS map and targeted knowledge shards
            try {
                const manifest = await loadKnowledgeManifest(ctx.repoRoot);
                const agentMap = await loadAgentMap(ctx.repoRoot, manifest);
                if (agentMap?.content.trim()) {
                    ctx.promptMemory.agentMap = agentMap.content.trim();
                }

                if (manifest && manifest.shards.length > 0) {
                    const shardHints: ShardContextHints = {};
                    if (ctx.status) {
                        shardHints.changedPaths = ctx.status
                            .split("\n")
                            .map((line) => line.slice(3).trim())
                            .filter(Boolean);
                    }
                    const selectedShards = selectKnowledgeShards(
                        manifest,
                        state.request,
                        taskMode,
                        taskMode === "direct_qa" ? 1 : 2,
                        shardHints,
                    );
                    const loadedShards = await Promise.all(
                        selectedShards.map(async (shard) => {
                            const content = await loadKnowledgeShard(ctx.repoRoot, shard.path);
                            if (!content?.trim()) return null;
                            return {
                                path: `.mygit/knowledge/${shard.path}`,
                                title: shard.title,
                                content: content.trim(),
                            };
                        }),
                    );
                    ctx.promptMemory.knowledgeShards = loadedShards.filter((shard): shard is {
                        path: string;
                        title: string;
                        content: string;
                    } => Boolean(shard));
                }
                // Quick staleness check — warn if knowledge is outdated
                if (manifest) {
                    try {
                        const staleness = await quickStalenessCheck(ctx.repoRoot, manifest);
                        if (staleness.stale && staleness.note) {
                            ctx.promptMemory.stalenessNote = staleness.note;
                        }
                    } catch {
                        // Staleness check failure is non-fatal
                    }
                }
            } catch {
                // Knowledge store absent or invalid — skip silently
            }

            // RAG: Inject relevant summaries if index exists
            if (ragEnabled && contextRetriever.isIndexed()) {
                try {
                    // Enhance query with git status terms
                    const statusTerms = ctx.status
                        .split("\n")
                        .map(l => l.substring(3).trim()) // strip status prefix
                        .filter(Boolean);
                    const results = contextRetriever.searchEnhanced(
                        state.request,
                        statusTerms,
                        retrievalTopK,
                    );

                    // Scale RAG budget by task mode: execution needs more RAG,
                    // direct_qa needs less (relies on preloaded knowledge shards)
                    const modeRagRatio = Math.min(
                        0.4,
                        budgetRatio * (taskMode === "direct_qa" ? 0.6 : 1.2),
                    );
                    const budget = calculateBudget(contextWindow, modeRagRatio, 0, {
                        systemPromptReserve: systemPromptReserveForRequest(state.request),
                        historyReserve: conversationHistoryTokens,
                    });
                    const fitted = fitToBudget(results, budget.ragBudget);

                    ctx.ragSummaries = contextRetriever.formatResults(fitted);
                    ctx.directoryOverview = contextRetriever.formatDirectoryOverview(8);
                } catch {
                    // RAG failure is non-fatal — fall back to file tree
                }
            }

            // Git Recipes: gather enhanced context + match recipes for git workflows
            if (isGitWorkflowRequest(state.request)) {
                try {
                    const enhancedCtx = await gatherEnhancedGitContext(ctx.repoRoot);
                    ctx.enhancedGitContext = enhancedCtx;

                    const recipeMatch = matchRecipe(state.request);
                    if (recipeMatch) {
                        ctx.recipeGuidance = formatRecipeForPrompt(recipeMatch, enhancedCtx);
                    }
                } catch {
                    // Recipe/enhanced context failure is non-fatal
                }
            }
        } else {
            ctx = await refreshContext(state.context);
        }

        eventBus.emit({
            type: "iteration",
            current: state.iteration + 1,
            max: state.maxIterations,
        });

        return { context: ctx, iteration: state.iteration + 1 };
    }

    // ---- Node: callLLM ----
    async function callLLMNode(state: GraphState): Promise<Partial<GraphState>> {
        if (options.signal?.aborted) {
            eventBus.emit({ type: "cancelled" });
            return { done: true };
        }

        const useRag = ragEnabled && contextRetriever.isIndexed();
        const taskMode = inferTaskMode(state.request);
        const initPolicy = inferExecutionInitPolicy(state.request);
        const systemPrompt = buildAgentSystemPrompt(taskMode, initPolicy, state.context.recipeGuidance);
        const systemPromptReserve = estimateTokens(systemPrompt);
        const budget = calculateBudget(contextWindow, budgetRatio, state.context.observations.length, {
            systemPromptReserve,
            historyReserve: conversationHistoryTokens,
        });
        const contextStr = formatContextForPrompt(state.context, {
            mode: taskMode,
            windowSize: taskMode === "direct_qa" ? Math.min(5, adaptiveWindowSize(budget)) : adaptiveWindowSize(budget),
            outputTruncation: taskMode === "direct_qa"
                ? Math.min(140, adaptiveOutputTruncation(budget))
                : adaptiveOutputTruncation(budget),
            readOutputTruncation: taskMode === "direct_qa"
                ? Math.min(600, adaptiveReadOutputTruncation(budget))
                : adaptiveReadOutputTruncation(budget),
            fileTreeLimit: taskMode === "direct_qa" ? 20 : 50,
            includeRecentCommits: taskMode !== "direct_qa",
            includeDiffs: taskMode !== "direct_qa",
            includePlanProgress: taskMode !== "direct_qa",
            includeMemoryContext: true,
            useRag,
        });
        const runtimeStateLines = [`Task Mode: ${taskMode}`];
        if (taskMode === "execution") {
            runtimeStateLines.push(`Execution Init Policy: ${initPolicy}`);
        }
        const runtimeState = runtimeStateLines.join("\n");
        const userPrompt = buildAgentPrompt(contextStr, state.request, runtimeState);

        if (state.showThinking) {
            eventBus.emit({ type: "thinking", content: "Thinking..." });
        }

        const llmMessages: BaseMessage[] = [new SystemMessage(systemPrompt)];
        if (options.conversationHistory && options.conversationHistory.length > 0) {
            llmMessages.push(...options.conversationHistory);
        }
        llmMessages.push(new HumanMessage(userPrompt));

        let response;
        try {
            response = await model.invoke(llmMessages);
        } catch (err: any) {
            // Retry once after 2s delay
            eventBus.emit({ type: "thinking", content: "Retrying LLM connection..." });
            await new Promise((r) => setTimeout(r, 2000));
            response = await model.invoke(llmMessages);
        }

        const rawText = typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

        // Extract and emit reasoning content from thinking models (<think> / <thinking> tags)
        const thinkMatch = rawText.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
        if (thinkMatch && thinkMatch[1].trim().length > 0) {
            eventBus.emit({ type: "thinking", content: thinkMatch[1].trim(), isReasoning: true });
        }

        // Estimate token usage (chars / 4 heuristic)
        const promptTokens = systemPromptReserve + conversationHistoryTokens + estimateTokens(userPrompt);
        const responseTokens = estimateTokens(rawText);
        const estimatedTokens = promptTokens + responseTokens;
        eventBus.emit({ type: "token_usage", used: estimatedTokens, limit: contextWindow });

        return { llmRawResponse: rawText };
    }

    // ---- Node: parseAction ----
    async function parseActionNode(state: GraphState): Promise<Partial<GraphState>> {
        // Strip think/thinking tags before JSON extraction so reasoning preamble
        // doesn't interfere with JSON parsing on thinking models
        const raw = state.llmRawResponse
            .replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, "")
            .trim();

        // Try to extract JSON from the response
        let jsonStr = raw;
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }

        try {
            const parsed = JSON.parse(jsonStr);
            const validated = AgentResponseSchema.parse(parsed);

            return {
                currentAction: validated.action,
                currentReasoning: validated.reasoning,
                parseFailures: 0,
                fetchCount: validated.action.type === "fetch_context" ? state.fetchCount : 0,
            };
        } catch (err: any) {
            const failures = state.parseFailures + 1;
            eventBus.emit({
                type: "error",
                message: `Parse failure #${failures}: ${err.message}`,
            });

            // Add feedback to context so LLM can retry.
            // On the second+ failure, escalate: tell the LLM to change its approach
            // entirely rather than attempting the same response again. The most common
            // cause is raw file content / special characters being embedded unescaped
            // into JSON string values.
            const feedbackMessage =
                failures === 1
                    ? `Your previous response was not valid JSON. Error: ${err.message}. Please respond with valid JSON matching the schema.`
                    : `Your response has failed JSON parsing ${failures} times. Change your approach completely. Do NOT embed raw file contents, code snippets, or unescaped quotes/backslashes inside JSON string values — they break encoding. If you just read a file, summarise your findings in plain text using: {"type": "respond", "answer": "short plain-text summary"} with no backticks, no code blocks, and no direct quotes from the file.`;

            const feedbackObs: Observation = {
                action: "parse_error",
                output: feedbackMessage,
                success: false,
                timestamp: Date.now(),
            };
            const updatedContext = addObservation(state.context, feedbackObs);

            return {
                currentAction: null,
                currentReasoning: "",
                parseFailures: failures,
                context: updatedContext,
            };
        }
    }

    // ---- Node: loopGuard ----
    async function loopGuardNode(state: GraphState): Promise<Partial<GraphState>> {
        if (!state.currentAction) return {};

        if (state.currentAction.type === "fetch_context" && state.fetchCount >= 5) {
            const feedbackObs: Observation = {
                action: "loop_guard",
                output: "Reached fetch_context cap for this cycle. Proceed using existing context or switch to a concrete read_file/action.",
                success: false,
                timestamp: Date.now(),
            };
            return {
                currentAction: null,
                context: addObservation(state.context, feedbackObs),
            };
        }

        const sig = describeAction(state.currentAction);
        if (sig === state.lastActionSignature) {
            const newRepeat = state.repeatCount + 1;

            // For read_file repeats: skip re-execution entirely and inject feedback.
            // Re-reading the same path always returns identical (possibly truncated)
            // content — there is no new information to be gained.
            if (state.currentAction.type === "read_file") {
                const feedbackObs: Observation = {
                    action: "loop_guard",
                    output: `Already read "${state.currentAction.path}". Re-reading returns the same content. Use what is already in Recent Actions and proceed with your analysis.`,
                    success: false,
                    timestamp: Date.now(),
                };
                return {
                    currentAction: null,
                    repeatCount: 0,
                    context: addObservation(state.context, feedbackObs),
                };
            }

            // For fetch_context repeats: skip re-execution and force strategy change.
            if (state.currentAction.type === "fetch_context") {
                const feedbackObs: Observation = {
                    action: "loop_guard",
                    output: `Already fetched context for "${state.currentAction.query}" (${state.currentAction.scope}). Avoid repeating identical fetch_context requests; use the returned context or switch to a targeted read_file once.`,
                    success: false,
                    timestamp: Date.now(),
                };
                return {
                    currentAction: null,
                    repeatCount: 0,
                    context: addObservation(state.context, feedbackObs),
                };
            }

            if (newRepeat >= 3) {
                eventBus.emit({
                    type: "error",
                    message: "Detected repeated action — stopping to prevent infinite loop.",
                });
                return { done: true, repeatCount: newRepeat };
            }
            return { repeatCount: newRepeat, lastActionSignature: sig };
        }

        return { repeatCount: 0, lastActionSignature: sig };
    }

    // ---- Node: checkPermission ----
    async function checkPermissionNode(state: GraphState): Promise<Partial<GraphState>> {
        if (!state.currentAction || !actionRequiresExecution(state.currentAction)) {
            return { permissionDecision: "allowed" };
        }

        const decision = permissions.check(state.currentAction);

        if (decision === "need_prompt") {
            // Emit event to TUI and wait for user response
            const response = await new Promise<PermissionResponse>((resolve) => {
                eventBus.emit({
                    type: "action_request",
                    action: state.currentAction!,
                    reasoning: state.currentReasoning,
                    consequences: actionConsequences(state.currentAction!),
                    resolve,
                });
            });

            const allowed = permissions.applyResponse(state.currentAction!, response);
            return { permissionDecision: allowed ? "allowed" : "denied" };
        }

        return { permissionDecision: decision };
    }

    // ---- Helper: silent context actions ----
    function isSilentContextAction(action: AgentAction): boolean {
        if (action.type !== "git") return false;
        const cmd = action.command.trim().toLowerCase();
        const silentPrefixes = ["status", "log", "diff", "show", "rev-parse", "branch"];
        return silentPrefixes.some(p => cmd.startsWith(p));
    }

    // ---- Node: execute ----
    async function executeNode(state: GraphState): Promise<Partial<GraphState>> {
        if (options.signal?.aborted) {
            eventBus.emit({ type: "cancelled" });
            return { done: true };
        }
        if (!state.currentAction) return {};

        eventBus.emit({
            type: "action",
            action: state.currentAction,
            reasoning: state.currentReasoning,
        });

        let result;
        if (state.dryRun && actionRequiresExecution(state.currentAction)) {
            const description = dryRun(state.currentAction);
            result = { success: true, output: description };
        } else {
            result = await executeAction(state.currentAction);
        }

        // ── Push rejection → auto-pull → merge conflict handoff ──────
        if (
            !state.dryRun &&
            state.currentAction.type === "git" &&
            result.kind === "push_rejected"
        ) {
            // Notify TUI of the push failure
            eventBus.emit({
                type: "execution_result",
                success: false,
                error: result.error ?? "Push rejected",
                kind: "push_rejected",
            });

            // Auto-pull to surface merge conflicts
            const pullResult = await executeAction({ type: "git", command: "pull --no-rebase" });

            if (!pullResult.success && hasMergeConflictMarkers(pullResult.error ?? "")) {
                // Conflicts detected — hand off to TUI
                const conflictedFiles = await listConflictedFiles();

                if (conflictedFiles.length > 0) {
                    eventBus.emit({
                        type: "execution_result",
                        success: false,
                        error: `Merge conflicts in ${conflictedFiles.length} file(s): ${conflictedFiles.join(", ")}`,
                        kind: "merge_conflict",
                    });

                    const outcome = await new Promise<"resolved" | "cancelled">((resolve) => {
                        eventBus.emit({
                            type: "merge_conflicts",
                            files: conflictedFiles,
                            resolve,
                        });
                    });

                    if (outcome === "resolved") {
                        const obs: Observation = {
                            action: "merge_conflict_resolution",
                            output: `Resolved merge conflicts in ${conflictedFiles.length} file(s): ${conflictedFiles.join(", ")}. Stage the resolved files and push.`,
                            success: true,
                            timestamp: Date.now(),
                        };
                        return { context: addObservation(state.context, obs) };
                    } else {
                        const obs: Observation = {
                            action: "merge_conflict_resolution",
                            output: "User cancelled merge conflict resolution.",
                            success: false,
                            timestamp: Date.now(),
                        };
                        return { context: addObservation(state.context, obs), done: true };
                    }
                }
            }

            // Pull succeeded (fast-forward) or no conflicts — record and continue
            const obs: Observation = {
                action: "git push (rejected) → git pull",
                output: pullResult.success
                    ? "Pull succeeded. Retry push."
                    : (pullResult.error ?? "Pull failed"),
                success: pullResult.success,
                timestamp: Date.now(),
            };
            return { context: addObservation(state.context, obs) };
        }

        if (!isSilentContextAction(state.currentAction)) {
            eventBus.emit({
                type: "execution_result",
                success: result.success,
                output: result.success ? result.output : undefined,
                error: result.success ? undefined : (result.error ?? "Command failed"),
                kind: result.kind,
            });
        }

        const obs: Observation = {
            action: describeAction(state.currentAction),
            output: result.error ?? result.output,
            success: result.success,
            timestamp: Date.now(),
        };
        const updatedContext = addObservation(state.context, obs);

        return { context: updatedContext };
    }

    // ---- Node: recordDenied ----
    async function recordDeniedNode(state: GraphState): Promise<Partial<GraphState>> {
        const deniedAction = state.currentAction;
        const deniedExternalFetch =
            deniedAction?.type === "shell" &&
            isLikelyExternalFetchShellCommand(deniedAction.command);

        if (deniedExternalFetch) {
            eventBus.emit({
                type: "execution_result",
                success: false,
                error: "External fetch/network command was denied. Continuing offline with local repository inspection only.",
                kind: "offline",
            });
        }

        const obs: Observation = {
            action: deniedAction ? describeAction(deniedAction) : "unknown",
            output: deniedExternalFetch
                ? "Permission denied for external fetch/network command. Continue offline using local repository inspection only."
                : "Permission denied by user",
            success: false,
            timestamp: Date.now(),
        };
        const updatedContext = addObservation(state.context, obs);

        return { context: updatedContext };
    }

    // ---- Node: handleTerminal ----
    async function handleTerminalNode(state: GraphState): Promise<Partial<GraphState>> {
        if (!state.currentAction) return {};
        const action = state.currentAction;

        if (action.type === "message") {
            eventBus.emit({ type: "message", content: action.content });
        } else if (action.type === "done") {
            eventBus.emit({ type: "task_complete", summary: action.summary });
            return { done: true };
        } else if (action.type === "respond") {
            eventBus.emit({ type: "response", answer: action.answer });
            return { done: true };
        } else if (action.type === "clarify") {
            const answer = await new Promise<string>((resolve) => {
                eventBus.emit({ type: "clarify_request", question: action.question, resolve });
            });
            const obs: Observation = {
                action: "clarify",
                output: `User answered: ${answer}`,
                success: true,
                timestamp: Date.now(),
            };
            return { context: addObservation(state.context, obs) };
        } else if (action.type === "plan") {
            const approved = await new Promise<boolean>((resolve) => {
                eventBus.emit({ type: "plan_proposal", steps: action.steps, resolve });
            });
            const ctx = setActivePlan(state.context, action.steps);
            if (!approved) {
                const obs: Observation = {
                    action: "plan_rejected",
                    output: "User rejected the proposed plan. Adjust approach.",
                    success: false,
                    timestamp: Date.now(),
                };
                return { context: addObservation(ctx, obs) };
            }
            return { context: ctx };
        }

        return {};
    }

    // ---- Node: fetchContext (RAG retrieval — free, no iteration cost) ----
    async function fetchContextNode(state: GraphState): Promise<Partial<GraphState>> {
        if (!state.currentAction || state.currentAction.type !== "fetch_context") return {};

        const { query, scope } = state.currentAction;
        let output: string;
        let success = true;

        if (!contextRetriever.isIndexed()) {
            output = "Project not indexed. Run `mygit init` to enable smart context retrieval. Falling back to read_file.";
            success = false;
            eventBus.emit({ type: "context_fetch", query, resultCount: 0 });
        } else if (scope === "search") {
            const results = contextRetriever.search(query, retrievalTopK);
            if (results.length === 0) {
                output = `No indexed files match "${query}". Try a different query or use read_file directly.`;
                success = false;
            } else {
                output = results
                    .map(r => `**${r.filePath}** (${r.language}, score: ${r.score.toFixed(2)})\n${r.summary}`)
                    .join("\n\n");
            }
            eventBus.emit({ type: "context_fetch", query, resultCount: results.length });
        } else if (scope === "file") {
            const summary = contextRetriever.getFileSummary(query);
            output = summary
                ? `**${query}**\n${summary}`
                : `No index entry for "${query}". Use read_file to get the full content.`;
            success = Boolean(summary);
            eventBus.emit({ type: "context_fetch", query, resultCount: summary ? 1 : 0 });
        } else {
            // directory scope
            const dirSummary = contextRetriever.getDirectorySummary(query);
            output = dirSummary
                ? `**${query}/**\n${dirSummary}`
                : `No index entry for directory "${query}".`;
            success = Boolean(dirSummary);
            eventBus.emit({ type: "context_fetch", query, resultCount: dirSummary ? 1 : 0 });
        }

        const obs: Observation = {
            action: describeAction(state.currentAction),
            output,
            success,
            timestamp: Date.now(),
        };

        return {
            context: addObservation(state.context, obs),
            fetchCount: state.fetchCount + 1,
        };
    }

    // ============================================================================
    // GRAPH CONSTRUCTION
    // ============================================================================

    const graph = new StateGraph(AgentGraphState)
        .addNode("gatherContext", gatherContextNode)
        .addNode("callLLM", callLLMNode)
        .addNode("parseAction", parseActionNode)
        .addNode("loopGuard", loopGuardNode)
        .addNode("fetchContext", fetchContextNode)
        .addNode("checkPermission", checkPermissionNode)
        .addNode("execute", executeNode)
        .addNode("recordDenied", recordDeniedNode)
        .addNode("handleTerminal", handleTerminalNode);

    // Edges
    graph.addEdge(START, "gatherContext");
    graph.addEdge("gatherContext", "callLLM");
    graph.addEdge("callLLM", "parseAction");

    // After parse: check if parse failed → retry callLLM, or proceed
    graph.addConditionalEdges("parseAction", (state: GraphState) => {
        if (state.currentAction === null) {
            // Parse failure
            if (state.parseFailures >= 3) return "__end__";
            return "callLLM"; // retry
        }
        return "loopGuard";
    });

    graph.addConditionalEdges("loopGuard", (state: GraphState) => {
        if (state.done) return "__end__";
        if (!state.currentAction) return "handleTerminal";

        // Route fetch_context to its own node (free — no iteration cost)
        if (actionIsFetchContext(state.currentAction)) {
            // Cap at 5 free fetches per cycle to prevent infinite loops
            if (state.fetchCount >= 5) {
                return "handleTerminal"; // treat as no-op, force LLM to act
            }
            return "fetchContext";
        }

        // Route based on whether action requires execution
        if (!actionRequiresExecution(state.currentAction)) {
            return "handleTerminal";
        }
        return "checkPermission";
    });

    // After fetchContext, go back to callLLM WITHOUT incrementing iteration
    graph.addEdge("fetchContext", "callLLM");

    graph.addConditionalEdges("checkPermission", (state: GraphState) => {
        if (state.permissionDecision === "denied") return "recordDenied";
        return "execute";
    });

    // After execute or denied, check if we should continue
    graph.addConditionalEdges("execute", (state: GraphState) => {
        if (state.iteration >= state.maxIterations) return "__end__";
        return "gatherContext";
    });

    graph.addConditionalEdges("recordDenied", (state: GraphState) => {
        if (state.iteration >= state.maxIterations) return "__end__";
        return "gatherContext";
    });

    graph.addConditionalEdges("handleTerminal", (state: GraphState) => {
        if (state.done) return "__end__";
        if (state.iteration >= state.maxIterations) return "__end__";
        return "gatherContext";
    });

    return graph.compile();
}

// ============================================================================
// CONVENIENCE RUNNER
// ============================================================================

/**
 * Run the agent graph for a user request.
 */
export async function runAgent(
    request: string,
    options: AgentGraphOptions,
): Promise<void> {
    const graph = buildAgentGraph(options);

    const initialState: Partial<GraphState> = {
        request,
        maxIterations: options.maxIterations ?? 15,
        dryRun: options.dryRun ?? false,
        showThinking: options.showThinking ?? false,
        context: {
            repoRoot: process.cwd(),
            branch: "",
            status: "",
            recentCommits: "",
            diffSummary: "",
            stagedSummary: "",
            fileTree: [],
            observations: [],
            planSteps: [],
            request: "",
            activeWorktree: null,
            promptMemory: { recentSessions: [] },
        },
        iteration: 0,
        parseFailures: 0,
        done: false,
        currentAction: null,
        currentReasoning: "",
        llmRawResponse: "",
        permissionDecision: "allowed",
        lastActionSignature: "",
        repeatCount: 0,
        fetchCount: 0,
    };

    try {
        const recursionLimit = computeAgentRecursionLimit(options.maxIterations ?? 15);
        const tracingConfig = buildTracingConfig({
            request,
            modelName: (options.model as any).modelName ?? (options.model as any).model,
            maxIterations: options.maxIterations ?? 15,
        });
        const finalState = await graph.invoke(initialState, {
            recursionLimit,
            ...tracingConfig,
        } as any) as GraphState;

        if (!finalState.done && finalState.iteration >= finalState.maxIterations) {
            options.eventBus.emit({
                type: "error",
                message: `Stopped after reaching the iteration limit (${finalState.maxIterations}). I was unable to complete the task in the current budget.`,
            });
        }

        // Capture cross-session failure lessons (fire-and-forget)
        captureFailureLessons(
            {
                request,
                done: finalState.done,
                iteration: finalState.iteration,
                maxIterations: finalState.maxIterations,
                parseFailures: finalState.parseFailures,
                repeatCount: finalState.repeatCount,
                lastActionSignature: finalState.lastActionSignature,
                observations: finalState.context.observations,
            },
            finalState.context.repoRoot,
        ).catch(() => {});

        options.eventBus.emit({ type: "done" });
    } catch (err: any) {
        options.eventBus.emit({
            type: "error",
            message: normalizeAgentRuntimeErrorMessage(err),
        });
    }
}
