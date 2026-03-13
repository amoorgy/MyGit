/**
 * useAgent — React hook for managing the agent graph lifecycle.
 *
 * Connects the LangGraph agent to the Ink TUI via the EventBus.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, ChatRichRow, ToolData } from "../components/ChatArea.js";
import { inferTaskMode, type AgentAction, type PlanStep } from "../../agent/protocol.js";
import type { PermissionResponse } from "../../agent/permissions.js";
import { AgentEventBus, type AgentEvent } from "../../agent/events.js";
import { PermissionManager } from "../../agent/permissions.js";
import { runAgent } from "../../agent/graph.js";
import { createChatModel, type ProviderConfig } from "../../llm/providers.js";
import { openProjectDatabase } from "../../storage/database.js";
import type { Config } from "../../config/settings.js";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { compactConversationForRequest } from "./conversationCompaction.js";

function resolveContextWindow(providerConfig: ProviderConfig): number {
    if (providerConfig.contextWindow) return providerConfig.contextWindow;
    switch (providerConfig.provider) {
        case "api":
            // Anthropic Claude: 200k; OpenAI-compat services: treat as 128k conservatively
            return providerConfig.apiService === "anthropic" ? 200000 : 128000;
        case "google":
            return 128000;
        default:
            return 32000;
    }
}
import { formatExecutionResultText } from "./toolOutput.js";
import {
    createSessionCheckpoint,
    type SessionTranscriptEntry,
} from "../../memory/sessionMemory.js";
import { queueIncrementalIndexRefresh } from "../../context/autoIndex.js";

const DIRECT_QA_MAX_TURNS = 3;
const EXECUTION_MAX_TURNS = 10;

function messagesToSessionTranscript(messages: ChatMessage[]): SessionTranscriptEntry[] {
    return messages
        .filter((message) => message.role !== "thinking")
        .map((message) => ({
            role: message.role,
            content: message.content,
            toolType: message.toolData?.toolType,
            toolLabel: message.toolData?.label,
            success: message.toolData?.success,
        }));
}

// ============================================================================
// HOOK STATE
// ============================================================================

export interface PendingConfirm {
    action: AgentAction;
    reasoning: string;
    consequences: string[];
    resolve: (response: PermissionResponse) => void;
}

export interface PendingPlan {
    steps: PlanStep[];
    resolve: (approved: boolean) => void;
}

export interface TokenUsage {
    used: number;
    limit: number;
}

export interface PendingMergeConflicts {
    files: string[];
    resolve: (outcome: "resolved" | "cancelled") => void;
}

export interface UseAgentReturn {
    messages: ChatMessage[];
    isProcessing: boolean;
    isThinking: boolean;
    pendingConfirm: PendingConfirm | null;
    pendingPlan: PendingPlan | null;
    pendingClarify: { question: string; resolve: (answer: string) => void } | null;
    pendingMergeConflicts: PendingMergeConflicts | null;
    iteration: { current: number; max: number } | null;
    tokenUsage: TokenUsage;
    addSystemMessage: (content: string) => void;
    addChatMessage: (
        role: ChatMessage["role"],
        content: string,
        options?: { toolData?: ToolData; richRows?: ChatRichRow[] },
    ) => void;
    sendRequest: (request: string) => void;
    cancelAgent: () => void;
    respondToConfirm: (response: PermissionResponse) => void;
    respondToPlan: (approved: boolean) => void;
    respondToClarify: (answer: string) => void;
    respondToMergeConflicts: (outcome: "resolved" | "cancelled") => void;
    clearMessages: () => Promise<void>;
    compactMessages: (saveToFile: boolean) => Promise<void>;
}

// ============================================================================
// HOOK
// ============================================================================

export function useAgent(providerConfig: ProviderConfig, config?: Config): UseAgentReturn {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
    const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
    const [pendingClarify, setPendingClarify] = useState<{ question: string; resolve: (answer: string) => void } | null>(null);
    const [pendingMergeConflicts, setPendingMergeConflicts] = useState<PendingMergeConflicts | null>(null);
    const [iteration, setIteration] = useState<{ current: number; max: number } | null>(null);
    const [tokenUsage, setTokenUsage] = useState<TokenUsage>({ used: 0, limit: 32000 });

    const eventBusRef = useRef(new AgentEventBus());
    const permissionsRef = useRef(
        config ? PermissionManager.fromConfig(config) : PermissionManager.default(),
    );
    const abortControllerRef = useRef<AbortController | null>(null);
    const conversationSummaryRef = useRef<string | null>(null);
    const conversationHistoryRef = useRef<BaseMessage[]>([]);
    const currentRequestRef = useRef<string>("");
    const lastAgentResponseRef = useRef<string>("");

    // Always use the canonical project DB path (.mygit/mygit.db).
    const dbRef = useRef<ReturnType<typeof openProjectDatabase> | null>(null);
    if (dbRef.current === null) {
        dbRef.current = openProjectDatabase();
    }

    const addMessage = useCallback((
        role: ChatMessage["role"],
        content: string,
        toolData?: ToolData,
        richRows?: ChatRichRow[],
    ) => {
        setMessages((prev) => [...prev, { role, content, timestamp: Date.now(), toolData, richRows }]);
    }, []);
    const addSystemMessage = useCallback((content: string) => {
        addMessage("system", content);
    }, [addMessage]);
    const addChatMessage = useCallback((
        role: ChatMessage["role"],
        content: string,
        options?: { toolData?: ToolData; richRows?: ChatRichRow[] },
    ) => {
        addMessage(role, content, options?.toolData, options?.richRows);
    }, [addMessage]);

    // Wire up event handling
    useEffect(() => {
        const bus = eventBusRef.current;
        const unsubscribe = bus.on((event: AgentEvent) => {
            switch (event.type) {
                case "thinking":
                    setIsThinking(true);
                    if (event.isReasoning && event.content.trim().length > 0) {
                        addMessage("thinking", event.content);
                    }
                    break;
                case "message":
                    addMessage("agent", event.content);
                    break;
                case "task_complete":
                    addMessage("system", `[done] ${event.summary}`);
                    lastAgentResponseRef.current = event.summary;
                    break;
                case "response":
                    addMessage("agent", event.answer);
                    lastAgentResponseRef.current = event.answer;
                    break;
                case "action": {
                    const act = event.action;
                    const label =
                        act.type === "read_file" || act.type === "write_file"
                            ? act.path
                            : act.type === "git" || act.type === "shell"
                                ? act.command
                                : undefined;
                    addMessage("tool", act.type, {
                        toolType: act.type,
                        label,
                        reasoning: event.reasoning,
                        output: null,
                        success: null,
                    });
                    break;
                }
                case "execution_result":
                    {
                        const truncated = formatExecutionResultText(
                            event.success,
                            event.output,
                            event.error,
                        );

                        setMessages((prev) => {
                            // Find the last pending tool message (output === null)
                            for (let i = prev.length - 1; i >= 0; i--) {
                                if (prev[i].role === "tool" && prev[i].toolData?.output === null) {
                                    const updated = [...prev];
                                    updated[i] = {
                                        ...updated[i],
                                        toolData: {
                                            ...updated[i].toolData!,
                                            output: truncated,
                                            success: event.success,
                                        },
                                    };
                                    return updated;
                                }
                            }
                            // No pending tool message — fall back to system message
                            if (truncated.length > 0) {
                                const prefix = event.success ? "[tool]" : "[tool-error]";
                                return [...prev, { role: "system", content: `${prefix} ${truncated}`, timestamp: Date.now() }];
                            }
                            return prev;
                        });
                    }
                    break;
                case "clarify_request":
                    setPendingClarify({
                        question: event.question,
                        resolve: event.resolve,
                    });
                    break;
                case "action_request":
                    setPendingConfirm({
                        action: event.action,
                        reasoning: event.reasoning,
                        consequences: event.consequences,
                        resolve: event.resolve,
                    });
                    break;
                case "plan_proposal":
                    setPendingPlan({
                        steps: event.steps,
                        resolve: event.resolve,
                    });
                    break;
                case "merge_conflicts":
                    setPendingMergeConflicts({
                        files: event.files,
                        resolve: event.resolve,
                    });
                    addMessage("system", `Merge conflicts detected in ${event.files.length} file(s): ${event.files.join(", ")}`);
                    break;
                case "iteration":
                    setIteration({ current: event.current, max: event.max });
                    break;
                case "context_fetch":
                    // Silent — no UI noise for context fetches
                    break;
                case "token_usage":
                    setTokenUsage({ used: event.used, limit: event.limit });
                    // Auto-compact when approaching token limit
                    if (event.used / event.limit > 0.85) {
                        setMessages((prev) => {
                            if (prev.length > 16) {
                                const compacted = prev.slice(-16);
                                compacted.unshift({
                                    role: "system",
                                    content: "[Earlier messages compacted to save context]",
                                    timestamp: Date.now(),
                                });
                                return compacted;
                            }
                            return prev;
                        });
                    }
                    break;
                case "done":
                    if (lastAgentResponseRef.current && currentRequestRef.current) {
                        const mode = inferTaskMode(currentRequestRef.current);
                        const maxTurns = mode === "direct_qa" ? DIRECT_QA_MAX_TURNS : EXECUTION_MAX_TURNS;
                        conversationHistoryRef.current = [
                            ...conversationHistoryRef.current,
                            new HumanMessage(currentRequestRef.current),
                            new AIMessage(lastAgentResponseRef.current),
                        ].slice(-(maxTurns * 2));
                        lastAgentResponseRef.current = "";
                    }
                    setIsProcessing(false);
                    setIsThinking(false);
                    setIteration(null);
                    setPendingClarify(null);
                    setPendingConfirm(null);
                    setPendingPlan(null);
                    setPendingMergeConflicts(null);
                    break;
                case "cancelled":
                    setIsProcessing(false);
                    setIsThinking(false);
                    addMessage("system", "Cancelled.");
                    break;
                case "error":
                    addMessage("system", `[err] ${event.message}`);
                    break;
            }
        });

        return unsubscribe;
    }, [addMessage]);

    const sendRequest = useCallback(
        (request: string) => {
            if (isProcessing) return;

            currentRequestRef.current = request;
            lastAgentResponseRef.current = "";
            addMessage("user", request);
            setIsProcessing(true);
            setIsThinking(true);

            // clear stale pending states
            setPendingClarify(null);
            setPendingConfirm(null);
            setPendingPlan(null);

            let model;
            try {
                model = createChatModel(providerConfig);
            } catch (err: any) {
                addSystemMessage(`[err] ${err.message ?? "Failed to load configured model"}`);
                setIsProcessing(false);
                setIsThinking(false);
                return;
            }
            const controller = new AbortController();
            abortControllerRef.current = controller;

            const compactedConversation = compactConversationForRequest(
                conversationHistoryRef.current,
                conversationSummaryRef.current,
                request,
            );
            conversationHistoryRef.current = compactedConversation.history;
            conversationSummaryRef.current = compactedConversation.summary;

            // Run agent in background (non-blocking)
            runAgent(request, {
                model,
                permissions: permissionsRef.current,
                eventBus: eventBusRef.current,
                db: dbRef.current!,
                maxIterations: config?.agent?.maxIterations ?? 15,
                signal: controller.signal,
                learning: config?.learning,
                contextConfig: config?.context,
                contextWindow: config?.provider === "ollama"
                    ? config.ollama.contextWindow
                    : resolveContextWindow(providerConfig),
                conversationSummary: conversationSummaryRef.current ?? undefined,
                conversationHistory: conversationHistoryRef.current.length > 0
                    ? conversationHistoryRef.current
                    : undefined,
            }).catch((err) => {
                addMessage("system", `[err] Agent error: ${err.message}`);
                setIsProcessing(false);
                setIsThinking(false);
            });
        },
        [isProcessing, providerConfig, addMessage, addSystemMessage, config],
    );

    const clearMessages = useCallback(async () => {
        const transcript = messagesToSessionTranscript(messages);
        let model;
        try {
            model = createChatModel(providerConfig);
        } catch {
            model = undefined;
        }

        let checkpoint = null;
        try {
            checkpoint = await createSessionCheckpoint({
                model,
                transcript,
                persist: true,
            });
        } catch {
            checkpoint = null;
        }

        if (model && checkpoint) {
            queueIncrementalIndexRefresh({
                repoRoot: process.cwd(),
                model,
                contextConfig: config?.context,
                relativePaths: checkpoint.refreshFiles,
            });
        }

        conversationSummaryRef.current = null;
        conversationHistoryRef.current = [];
        currentRequestRef.current = "";
        const clearMessage = checkpoint?.persisted
            ? "Context cleared. Session saved to .mygit/MYGIT.md."
            : "Context cleared.";
        setMessages([{ role: "system", content: clearMessage, timestamp: Date.now() }]);
        setTokenUsage((prev) => ({ ...prev, used: 0 }));
    }, [messages, providerConfig, config?.context]);

    const compactMessages = useCallback(async (saveToFile: boolean): Promise<void> => {
        const snapshot = messages.filter((m) => m.role !== "thinking");
        if (snapshot.length === 0) {
            addSystemMessage("[compact] Nothing to compact.");
            return;
        }

        addSystemMessage("[compact] Summarizing conversation…");

        let model;
        try {
            model = createChatModel(providerConfig);
        } catch {
            model = undefined;
        }

        try {
            const checkpoint = await createSessionCheckpoint({
                model,
                transcript: messagesToSessionTranscript(snapshot),
                persist: saveToFile,
            });

            if (model && saveToFile) {
                queueIncrementalIndexRefresh({
                    repoRoot: process.cwd(),
                    model,
                    contextConfig: config?.context,
                    relativePaths: checkpoint.refreshFiles,
                });
            }

            conversationSummaryRef.current = checkpoint.summary;
            conversationHistoryRef.current = [];
            setMessages([{
                role: "system",
                content: checkpoint.persisted || !saveToFile
                    ? `[Compacted]\n${checkpoint.summary}`
                    : `[Compacted]\n${checkpoint.summary}\n[save failed] Unable to persist to .mygit/MYGIT.md.`,
                timestamp: Date.now(),
            }]);
            setTokenUsage((prev) => ({ ...prev, used: 0 }));
        } catch (err: any) {
            addSystemMessage(`[err] Compact failed: ${err.message ?? "unknown error"}`);
        }
    }, [messages, providerConfig, addSystemMessage, config?.context]);

    const cancelAgent = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    }, []);

    const respondToConfirm = useCallback(
        (response: PermissionResponse) => {
            if (pendingConfirm) {
                pendingConfirm.resolve(response);
                setPendingConfirm(null);
            }
        },
        [pendingConfirm],
    );

    const respondToPlan = useCallback(
        (approved: boolean) => {
            if (pendingPlan) {
                pendingPlan.resolve(approved);
                setPendingPlan(null);
            }
        },
        [pendingPlan],
    );

    const respondToClarify = useCallback(
        (answer: string) => {
            if (pendingClarify) {
                // Ensure answer is added to user messages visually
                addMessage("user", answer);
                pendingClarify.resolve(answer);
                setPendingClarify(null);
            }
        },
        [pendingClarify, addMessage],
    );

    const respondToMergeConflicts = useCallback(
        (outcome: "resolved" | "cancelled") => {
            if (pendingMergeConflicts) {
                pendingMergeConflicts.resolve(outcome);
                setPendingMergeConflicts(null);
            }
        },
        [pendingMergeConflicts],
    );

    return {
        messages,
        isProcessing,
        isThinking,
        pendingConfirm,
        pendingPlan,
        pendingClarify,
        pendingMergeConflicts,
        iteration,
        tokenUsage,
        addSystemMessage,
        addChatMessage,
        sendRequest,
        cancelAgent,
        respondToConfirm,
        respondToPlan,
        respondToClarify,
        respondToMergeConflicts,
        clearMessages,
        compactMessages,
    };
}
