/**
 * App — root Ink component.
 * Mirrors the Rust TUI `run()` function in `src/tui/mod.rs`.
 *
 * Layout: StatusBar → ChatArea/WelcomeScreen → InputBox
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { WelcomeScreen } from "./components/WelcomeScreen.js";
import { ChatArea } from "./components/ChatArea.js";
import { InputBox } from "./components/InputBox.js";
import { StatusBar } from "./components/StatusBar.js";
import { ConfirmPanel } from "./components/ConfirmPanel.js";
import { ClarifyPanel } from "./components/ClarifyPanel.js";
import { PlanApprovalPanel } from "./components/PlanApprovalPanel.js";
import { PrCommitsPanel } from "./components/PrCommitsPanel.js";
import { PrReviewPanel } from "./components/PrReviewPanel.js";
import { PrInboxPanel } from "./components/PrInboxPanel.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { MergeView } from "./components/MergeView.js";
import { MergeConflictPanel } from "./components/MergeConflictPanel.js";
import { WorktreePanel } from "./components/WorktreePanel.js";
import { BranchPanel, type BranchActionPrompt } from "./components/BranchPanel.js";
import { detectIDE } from "./ide.js";
import { ModelSelector } from "./components/ModelSelector.js";
import { ThoughtMapPanel } from "./components/ThoughtMapPanel.js";
import { ThoughtMapActions, type ThoughtMapAction } from "./components/ThoughtMapActions.js";
import { ContextGatheringPanel } from "./components/ContextGatheringPanel.js";
import { useAgent } from "./hooks/useAgent.js";
import { useThoughtMap } from "./hooks/useThoughtMap.js";
import { useScrollEvents } from "./hooks/useScrollEvents.js";
import { getThemePalette } from "./theme.js";
import { type Config, saveConfig, repoConfigPath, type ApiService } from "../config/settings.js";
import { createChatModel, fetchOllamaModels, API_SERVICE_LABELS, type ProviderConfig } from "../llm/providers.js";
import { listConflictedFiles, resolveFile } from "../merge/resolver.js";
import { parseConflictFile } from "../merge/parser.js";
import type { ConflictFile } from "../merge/types.js";
import type { AgentAction, PlanStep as AgentPlanStep } from "../agent/protocol.js";
import { actionConsequences } from "../agent/protocol.js";
import { PermissionManager, type PermissionResponse } from "../agent/permissions.js";
import { executeAction, type ExecutionResult } from "../executor/index.js";
import { executePlan } from "../plan/engine.js";
import { isStepDangerous, type Plan, type Step } from "../plan/types.js";
import {
    buildSavedImplementationPlan,
    generateImplementationPlanFromThoughtMap,
    loadImplementationPlan,
    saveImplementationPlan,
} from "./thoughtMap/implementation.js";
import {
    TOP_SLASH_COMMANDS,
    COMPACT_SUBCOMMANDS,
    parseSlashCommand,
    type SlashCommandDef,
} from "./thoughtMap/slashCommands.js";
import { SlashMenuPanel, computeSlashMenuHeight } from "./components/SlashMenuPanel.js";
import { useRepoGitState } from "./hooks/useRepoGitState.js";
import {
    listBranchPanelData,
    planBranchSelection,
    type BranchPanelData,
    type BranchPanelTarget,
} from "./git/branchTools.js";
import { saveRecentBranch } from "./git/repoState.js";
import {
    executeCommitDraft,
    prepareCommitDraft,
    reviseCommitDraft,
    type CommitDraft,
} from "./git/commitFlow.js";
import {
    buildFetchSummaryRows,
    fetchAllBranches,
    fetchCurrentBranch,
} from "./git/fetchFlow.js";
import { shellQuote } from "./git/shell.js";

// ============================================================================
// APP MODE
// ============================================================================

type AppMode = "input" | "confirm" | "clarify" | "plan_approval" | "settings" | "model_select" | "merge" | "merge_conflicts" | "worktree" | "branch_panel" | "pr_inbox" | "pr_commits" | "pr_review" | "thought_map";

// ============================================================================
// PROPS
// ============================================================================

interface AppProps {
    config: Config;
}

interface ModelAvailabilityNotice {
    key: string;
    message: string;
}

async function getConfiguredModelAvailabilityNotice(config: Config): Promise<ModelAvailabilityNotice | null> {
    if (config.provider === "ollama") {
        const modelName = config.ollama.model?.trim();
        const url = config.ollama.url?.trim() || "http://localhost:11434";

        if (!modelName) {
            return {
                key: `ollama:${url}:missing-model`,
                message: "No Ollama model is configured. Open the model picker and select a model.",
            };
        }

        const models = await fetchOllamaModels(url);
        const exists = models.some((m) => m.name === modelName);
        if (!exists) {
            return {
                key: `ollama:${url}:${modelName}:unavailable`,
                message: `Configured Ollama model "${modelName}" is not available at ${url}. Ollama may be unreachable or the model was removed. Please select a model again.`,
            };
        }

        return null;
    }

    if (config.provider === "api") {
        const service = config.api.activeService;
        const serviceLabel = API_SERVICE_LABELS[service] ?? service;
        const modelName = config.api.models?.[service]?.trim();
        const apiKey = config.api.apiKeys?.[service]?.trim();

        // Local services don't require an API key
        const localApiServices = new Set(["ouro", "transformer", "lmstudio"]);
        if (!apiKey && !localApiServices.has(service)) {
            return {
                key: `api:${service}:missing-key`,
                message: `Configured ${serviceLabel} model${modelName ? ` "${modelName}"` : ""} cannot be used because no API key is configured. Set the API key, then reselect the model if needed.`,
            };
        }
        if (!modelName) {
            return {
                key: `api:${service}:missing-model`,
                message: `No model is configured for ${serviceLabel}. Open the model picker and select a model.`,
            };
        }
        return null;
    }

    if (config.provider === "google") {
        const modelName = config.google.model?.trim();
        if (!config.google.apiKey?.trim()) {
            return {
                key: "google:missing-key",
                message: `Configured Google model${modelName ? ` "${modelName}"` : ""} cannot be used because no Google API key is configured. Set the key and reselect the model if needed.`,
            };
        }
        if (!modelName) {
            return {
                key: "google:missing-model",
                message: "No Google model is configured. Open settings and set the model again.",
            };
        }
        return null;
    }

    return null;
}

function configToProviderConfig(config: Config): ProviderConfig {
    const base = {
        provider: config.provider,
        ollamaUrl: config.ollama.url,
        ollamaModel: config.ollama.model,
        googleApiKey: config.google.apiKey,
        googleModel: config.google.model,
        temperature: config.ollama.temperature,
    };

    if (config.provider === "api") {
        const service = config.api.activeService;
        return {
            ...base,
            apiService: service,
            apiKey: config.api.apiKeys[service],
            apiModel: config.api.models?.[service],
        };
    }

    return base;
}

type ThoughtMapPlanOrigin = "implement" | "save" | "run_saved";

interface PendingThoughtMapPlanApproval {
    plan: Plan;
    origin: ThoughtMapPlanOrigin;
    savedPath?: string;
}

interface PendingThoughtMapStepConfirm {
    step: Step;
    resolve: (ok: boolean) => void;
}

interface PendingLocalConfirm {
    action: AgentAction;
    reasoning: string;
    consequences: string[];
    resumeMode: AppMode;
    resolve: (response: PermissionResponse) => void;
}

function planToApprovalSteps(plan: Plan): AgentPlanStep[] {
    return plan.steps.map((step) => ({
        description: step.description,
        command: `${step.isGit ? "git " : ""}${step.command}`.trim(),
    }));
}

function stepToAgentAction(step: Step): AgentAction {
    return step.isGit
        ? { type: "git", command: step.command }
        : { type: "shell", command: step.command };
}

function stepConsequences(step: Step): string[] {
    const consequences: string[] = [];
    if (step.expectedOutcome) consequences.push(step.expectedOutcome);
    if (step.isGit) {
        const lower = step.command.toLowerCase();
        if (lower.startsWith("checkout") || lower.startsWith("switch")) {
            consequences.push("Changes current branch/worktree state");
        }
        if (lower.startsWith("commit")) consequences.push("Creates a commit");
        if (lower.startsWith("push")) consequences.push("Updates remote history");
    } else if (step.command.toLowerCase().includes("rm ")) {
        consequences.push("Removes files from the filesystem");
    }
    if (isStepDangerous(step)) consequences.push("Marked dangerous — review command before approving");
    if (consequences.length === 0) {
        consequences.push(`Executes ${step.isGit ? "git" : "shell"} command`);
    }
    return consequences;
}

// ============================================================================
// APP COMPONENT
// ============================================================================

export function App({ config: initialConfig }: AppProps) {
    const { exit } = useApp();
    const { stdout } = useStdout();

    // Reactive terminal dimensions
    const [termWidth, setTermWidth] = useState(stdout?.columns ?? 80);
    const [termHeight, setTermHeight] = useState(stdout?.rows ?? 24);

    useEffect(() => {
        const handler = () => {
            setTermWidth(stdout?.columns ?? 80);
            setTermHeight(stdout?.rows ?? 24);
        };
        stdout?.on("resize", handler);
        return () => { stdout?.off("resize", handler); };
    }, [stdout]);

    const [config, setConfig] = useState<Config>(initialConfig);
    const palette = getThemePalette(config.ui.theme);
    const providerConfig = useMemo(() => configToProviderConfig(config), [config]);

    const {
        messages,
        isProcessing,
        isThinking,
        pendingConfirm,
        pendingPlan,
        pendingClarify,
        pendingMergeConflicts,
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
    } = useAgent(providerConfig, config);
    const { state: repoState, error: repoStateError, refresh: refreshRepoState } = useRepoGitState();

    const [inputValue, setInputValue] = useState("");
    const [mode, setMode] = useState<AppMode>("input");
    const [inputIsThoughtMode, setInputIsThoughtMode] = useState(false);
    const lastModelNoticeKeyRef = useRef<string>("");
    const localPermissionsRef = useRef(PermissionManager.fromConfig(config));
    const [pendingLocalConfirm, setPendingLocalConfirm] = useState<PendingLocalConfirm | null>(null);
    const [branchPanelData, setBranchPanelData] = useState<BranchPanelData | null>(null);
    const [branchPanelQuery, setBranchPanelQuery] = useState<string | null>(null);
    const [branchPanelError, setBranchPanelError] = useState<string | null>(null);
    const [isBranchPanelLoading, setIsBranchPanelLoading] = useState(false);
    const [branchActionPrompt, setBranchActionPrompt] = useState<BranchActionPrompt | null>(null);
    const [branchActionTarget, setBranchActionTarget] = useState<BranchPanelTarget | null>(null);
    const [pendingCommitDraft, setPendingCommitDraft] = useState<CommitDraft | null>(null);
    const [isPreparingCommitDraft, setIsPreparingCommitDraft] = useState(false);
    const [isRevisingCommitDraft, setIsRevisingCommitDraft] = useState(false);
    const [isRunningLocalFlow, setIsRunningLocalFlow] = useState(false);

    // ── Slash command palette ──────────────────────────────────────────────────
    const [slashMenuHighlight, setSlashMenuHighlight] = useState(0);
    const [slashMenuLevel, setSlashMenuLevel] = useState<0 | 1>(0);
    const [slashMenuParentId, setSlashMenuParentId] = useState<string | null>(null);

    const {
        thoughtMap,
        isGatheringContext,
        contextItems,
        isGenerating: isGeneratingMap,
        isRefining: isRefiningMap,
        error: thoughtMapError,
        selectedNodeId,
        setSelectedNodeId,
        generateMap,
        refineNode,
        clearMap,
    } = useThoughtMap(providerConfig);

    const [prReviewTarget, setPrReviewTarget] = useState<{ prNumber: number; owner: string; repo: string } | null>(null);

    const [thoughtMapIntent, setThoughtMapIntent] = useState("");
    const [isPreparingThoughtMapImplementation, setIsPreparingThoughtMapImplementation] = useState(false);
    const [isExecutingThoughtMapPlan, setIsExecutingThoughtMapPlan] = useState(false);
    const [pendingThoughtMapPlanApproval, setPendingThoughtMapPlanApproval] =
        useState<PendingThoughtMapPlanApproval | null>(null);
    const [pendingThoughtMapStepConfirm, setPendingThoughtMapStepConfirm] =
        useState<PendingThoughtMapStepConfirm | null>(null);

    const handleInputChange = useCallback((value: string) => {
        setInputValue(value);
    }, []);

    useEffect(() => {
        localPermissionsRef.current = PermissionManager.fromConfig(config);
    }, [config]);

    // Merge State (legacy /conflicts flow)
    const [conflictedFiles, setConflictedFiles] = useState<string[]>([]);
    const [currentConflictFile, setCurrentConflictFile] = useState<ConflictFile | null>(null);

    // Merge Conflicts State (agent-driven push failure flow)
    const [parsedConflictFiles, setParsedConflictFiles] = useState<ConflictFile[]>([]);
    const currentIDE = detectIDE();

    const runLocalAction = useCallback(async (
        action: AgentAction,
        reasoning: string,
        resumeMode: AppMode = "input",
    ): Promise<ExecutionResult> => {
        const decision = localPermissionsRef.current.check(action);
        if (decision === "denied") {
            return {
                success: false,
                output: "",
                error: "Permission denied by current configuration.",
            };
        }

        if (decision === "need_prompt") {
            const response = await new Promise<PermissionResponse>((resolve) => {
                setPendingLocalConfirm({
                    action,
                    reasoning,
                    consequences: actionConsequences(action),
                    resumeMode,
                    resolve,
                });
            });

            const allowed = localPermissionsRef.current.applyResponse(action, response);
            if (!allowed) {
                return {
                    success: false,
                    output: "",
                    error: "Operation cancelled.",
                };
            }
        }

        return executeAction(action);
    }, []);

    const runLocalGitCommand = useCallback((
        command: string,
        reasoning: string,
        resumeMode: AppMode = "input",
    ) => runLocalAction({ type: "git", command }, reasoning, resumeMode), [runLocalAction]);

    const loadConflictFile = async (filePath: string) => {
        const file = await parseConflictFile(filePath);
        setCurrentConflictFile(file);
    };

    const startMergeFlow = useCallback(async () => {
        const files = await listConflictedFiles();
        if (files.length === 0) {
            setMode("input");
            return;
        }
        setConflictedFiles(files);
        loadConflictFile(files[0]);
        setMode("merge");
    }, []);

    // Chat scroll state (row offset from bottom)
    const [chatScrollOffset, setChatScrollOffset] = useState(0);

    // Subscribe to scroll/shiftTab events from the StdinFilter Transform stream.
    // Filtering happens at the stream level so mouse sequences never reach Ink.
    useScrollEvents({
        onShiftTab: useCallback(() => {
            if (mode !== "input" && mode !== "thought_map") return;
            setInputIsThoughtMode((prev) => {
                if (prev) setMode("input");
                return !prev;
            });
        }, [mode]),
    });

    useEffect(() => {
        if (messages.length === 0 && chatScrollOffset !== 0) {
            setChatScrollOffset(0);
        }
    }, [messages.length, chatScrollOffset]);

    // Compute model display name
    const modelName =
        config.provider === "ollama"
            ? config.ollama.model
            : config.provider === "google"
                ? config.google.model
                : config.provider === "api"
                    ? (config.api.models?.[config.api.activeService] ?? config.api.activeService)
                    : config.provider === "transformer"
                        ? config.transformer.model
                        : "unknown";

    // Provider label for status bar
    const providerLabel =
        config.provider === "api"
            ? config.api.activeService
            : config.provider === "transformer"
                ? "local/hf"
                : config.provider;

    // Handle global keyboard shortcuts
    useInput((input, key) => {
        if (key.ctrl && input === "c") {
            if (isProcessing) {
                cancelAgent();
            } else {
                exit();
            }
        }
        if (key.escape && mode === "thought_map") {
            setMode("input");
            setInputIsThoughtMode(true);
        }
    });

    const localPlanConfirmStep = useCallback((step: Step) => {
        return new Promise<boolean>((resolve) => {
            setPendingThoughtMapStepConfirm({ step, resolve });
        });
    }, []);

    const runLocalThoughtMapPlan = useCallback(async (plan: Plan, origin: ThoughtMapPlanOrigin, savedPath?: string) => {
        setIsExecutingThoughtMapPlan(true);
        setMode("input");
        addSystemMessage(
            `[plan] Running ${origin === "run_saved" ? "saved " : ""}implementation plan (${plan.steps.length} steps)` +
            (savedPath ? ` — ${savedPath}` : ""),
        );

        try {
            const result = await executePlan(
                plan,
                "interactive",
                localPlanConfirmStep,
                (msg) => addSystemMessage(`[impl] ${msg}`),
            );

            if (result.success) {
                addSystemMessage(`[plan] Implementation plan completed (${result.stepsCompleted}/${result.totalSteps})`);
            } else {
                addSystemMessage(`[plan] Implementation plan incomplete (${result.stepsCompleted}/${result.totalSteps})`);
            }
        } catch (err: any) {
            addSystemMessage(`[err] Failed to execute implementation plan: ${err?.message ?? String(err)}`);
        } finally {
            setIsExecutingThoughtMapPlan(false);
            setPendingThoughtMapStepConfirm(null);
        }
    }, [addSystemMessage, localPlanConfirmStep]);

    const handleImplementFromThoughtMap = useCallback(async ({ saveFirst }: { saveFirst: boolean }) => {
        if (isPreparingThoughtMapImplementation || isExecutingThoughtMapPlan || isGatheringContext || isGeneratingMap || isRefiningMap) {
            addSystemMessage("[plan] Thought map is busy. Wait for current operation to finish.");
            return;
        }
        if (!thoughtMap) {
            addSystemMessage("[err] No thought map available. Generate one first in [PLAN] mode.");
            return;
        }

        setIsPreparingThoughtMapImplementation(true);
        try {
            const model = createChatModel(providerConfig);
            const plan = await generateImplementationPlanFromThoughtMap(thoughtMap, model);

            let savedPath: string | undefined;
            if (saveFirst) {
                const bundle = buildSavedImplementationPlan(thoughtMap, plan);
                const saved = await saveImplementationPlan(bundle);
                savedPath = saved.filePath;
                addSystemMessage(`[plan] Saved implementation plan: ${saved.filePath}`);
            }

            setPendingThoughtMapPlanApproval({
                plan,
                origin: saveFirst ? "save" : "implement",
                savedPath,
            });
        } catch (err: any) {
            addSystemMessage(`[err] Failed to prepare implementation plan: ${err?.message ?? String(err)}`);
        } finally {
            setIsPreparingThoughtMapImplementation(false);
        }
    }, [
        addSystemMessage,
        thoughtMap,
        providerConfig,
        isPreparingThoughtMapImplementation,
        isExecutingThoughtMapPlan,
        isGeneratingMap,
        isRefiningMap,
    ]);

    const handleRunSavedImplementation = useCallback(async (ref?: string) => {
        if (isPreparingThoughtMapImplementation || isExecutingThoughtMapPlan || isGatheringContext || isGeneratingMap || isRefiningMap) {
            addSystemMessage("[plan] Wait for the current operation to finish.");
            return;
        }

        setIsPreparingThoughtMapImplementation(true);
        try {
            const saved = await loadImplementationPlan(ref);
            addSystemMessage(`[plan] Loaded saved implementation plan${ref ? ` (${ref})` : " (latest)"}`);
            setPendingThoughtMapPlanApproval({
                plan: saved.plan,
                origin: "run_saved",
            });
        } catch (err: any) {
            addSystemMessage(`[err] Failed to load saved implementation plan: ${err?.message ?? String(err)}`);
        } finally {
            setIsPreparingThoughtMapImplementation(false);
        }
    }, [
        addSystemMessage,
        isPreparingThoughtMapImplementation,
        isExecutingThoughtMapPlan,
        isGeneratingMap,
        isRefiningMap,
    ]);

    const loadBranchPanel = useCallback(async (query?: string) => {
        setIsBranchPanelLoading(true);
        setBranchPanelError(null);
        try {
            const latestState = await refreshRepoState();
            const data = await listBranchPanelData(query, latestState ?? undefined);
            setBranchPanelData(data);
        } catch (err: any) {
            setBranchPanelError(err?.message ?? String(err));
        } finally {
            setIsBranchPanelLoading(false);
        }
    }, [refreshRepoState]);

    const openBranchPanel = useCallback((query?: string) => {
        const normalized = query?.trim() || null;
        setBranchPanelQuery(normalized);
        setBranchActionPrompt(null);
        setBranchActionTarget(null);
        setMode("branch_panel");
        void loadBranchPanel(normalized ?? undefined);
    }, [loadBranchPanel]);

    const showCommitDraft = useCallback((draft: CommitDraft, prefix = "[commit] Draft ready.") => {
        addChatMessage("system", [
            prefix,
            "",
            draft.changeSummary,
            "",
            `Proposed message: \`${draft.commitMessage}\``,
            "",
            "Reply in chat to refine this draft, or run `/commit approve`, `/commit push`, or `/commit cancel`.",
        ].join("\n"));
    }, [addChatMessage]);

    const handleCommitCommand = useCallback(async (args: string[] = []) => {
        const subcommand = args[0]?.toLowerCase();

        if (subcommand === "cancel") {
            if (!pendingCommitDraft) {
                addSystemMessage("[commit] No draft is active.");
                return;
            }
            setPendingCommitDraft(null);
            addSystemMessage("[commit] Draft cancelled.");
            return;
        }

        if (subcommand === "approve" || subcommand === "push") {
            if (!pendingCommitDraft) {
                addSystemMessage("[commit] No draft is active.");
                return;
            }
            setIsRunningLocalFlow(true);
            const modeLabel = subcommand === "push" ? "commit and push" : "commit";
            addSystemMessage(`[commit] Running ${modeLabel}…`);
            try {
                const result = await executeCommitDraft(
                    pendingCommitDraft,
                    (command, reasoning) => runLocalGitCommand(command, reasoning),
                    subcommand === "push" ? "push" : "commit",
                );

                if (!result.success) {
                    addChatMessage("system", [
                        `[commit] ${modeLabel} failed.`,
                        "",
                        result.error ?? "Unknown error.",
                        "",
                        "The draft is still active. Reply in chat to revise it, or retry `/commit approve` or `/commit push`.",
                    ].join("\n"));
                    return;
                }

                setPendingCommitDraft(null);
                addChatMessage("system", `[commit] ${modeLabel === "commit" ? "Commit created." : "Commit and push completed."}`);
                await refreshRepoState();
            } finally {
                setIsRunningLocalFlow(false);
            }
            return;
        }

        if (pendingCommitDraft) {
            showCommitDraft(pendingCommitDraft, "[commit] Current draft.");
            return;
        }

        const repoRoot = repoState?.repoRoot ?? process.cwd();
        setIsPreparingCommitDraft(true);
        addSystemMessage("[commit] Preparing draft…");
        try {
            const model = createChatModel(providerConfig);
            const result = await prepareCommitDraft(repoRoot, model);
            if (result.kind === "empty") {
                addSystemMessage("[commit] No uncommitted changes to summarize.");
                return;
            }
            setPendingCommitDraft(result.draft);
            showCommitDraft(result.draft);
        } catch (err: any) {
            addSystemMessage(`[commit] Failed to prepare draft: ${err?.message ?? String(err)}`);
        } finally {
            setIsPreparingCommitDraft(false);
        }
    }, [
        addChatMessage,
        addSystemMessage,
        pendingCommitDraft,
        providerConfig,
        repoState?.repoRoot,
        refreshRepoState,
        runLocalGitCommand,
        showCommitDraft,
    ]);

    const handleCommitRevision = useCallback(async (instruction: string) => {
        if (!pendingCommitDraft) return;
        addChatMessage("user", instruction);
        setIsRevisingCommitDraft(true);
        try {
            const model = createChatModel(providerConfig);
            const nextDraft = await reviseCommitDraft(pendingCommitDraft, instruction, model);
            setPendingCommitDraft(nextDraft);
            showCommitDraft(nextDraft, "[commit] Draft updated.");
        } catch (err: any) {
            addSystemMessage(`[commit] Failed to revise draft: ${err?.message ?? String(err)}`);
        } finally {
            setIsRevisingCommitDraft(false);
        }
    }, [addChatMessage, addSystemMessage, pendingCommitDraft, providerConfig, showCommitDraft]);

    const handleFetchCommand = useCallback(async (scope: "fetch" | "fetch-all") => {
        const repoRoot = repoState?.repoRoot ?? process.cwd();
        setIsRunningLocalFlow(true);
        addSystemMessage(`[${scope}] Running /${scope}…`);
        try {
            const summary = scope === "fetch"
                ? await fetchCurrentBranch(repoRoot, (command, reasoning) => runLocalGitCommand(command, reasoning))
                : await fetchAllBranches(repoRoot, (command, reasoning) => runLocalGitCommand(command, reasoning));

            addChatMessage("system", "", {
                richRows: buildFetchSummaryRows(summary),
            });
            await refreshRepoState();
        } catch (err: any) {
            addSystemMessage(`[${scope}] Failed: ${err?.message ?? String(err)}`);
        } finally {
            setIsRunningLocalFlow(false);
        }
    }, [addChatMessage, addSystemMessage, repoState?.repoRoot, refreshRepoState, runLocalGitCommand]);

    const executeBranchSwitchPlan = useCallback(async (
        target: BranchPanelTarget,
        plan: ReturnType<typeof planBranchSelection>,
    ) => {
        if (plan.kind === "noop") {
            setMode("input");
            addSystemMessage(`[branch] Already on ${target.name}.`);
            return;
        }

        if (!plan.switchCommand) return;

        setIsRunningLocalFlow(true);
        try {
            const result = await runLocalGitCommand(
                plan.switchCommand,
                `Switch the current worktree to ${target.name}.`,
                "branch_panel",
            );

            if (!result.success) {
                addSystemMessage(`[branch] Failed to switch to ${target.name}: ${result.error ?? "unknown error"}`);
                return;
            }

            const latestState = await refreshRepoState();
            if (latestState) saveRecentBranch(latestState.repoRoot, target.name);
            setMode("input");
            setBranchActionPrompt(null);
            setBranchActionTarget(null);
            addSystemMessage(`[branch] Switched to ${target.name}.`);
        } finally {
            setIsRunningLocalFlow(false);
        }
    }, [addSystemMessage, refreshRepoState, runLocalGitCommand]);

    const handleBranchTargetSelect = useCallback(async (target: BranchPanelTarget) => {
        const latestState = await refreshRepoState();
        const state = latestState ?? repoState;
        if (!state) {
            addSystemMessage("[branch] Repository state is unavailable.");
            return;
        }

        const plan = planBranchSelection(target, state);
        if (plan.kind === "prompt_dirty") {
            setBranchActionTarget(target);
            setBranchActionPrompt({
                title: `Working tree is dirty before switching to ${target.name}.`,
                detail: "Choose whether to stash first, create a separate worktree, or cancel.",
                options: [
                    { id: "stash_switch", label: "stash + switch", description: "Stash tracked and untracked changes, then switch branches." },
                    { id: "create_worktree", label: "create worktree", description: `Create a separate worktree at ${plan.suggestedWorktreePath}.` },
                    { id: "cancel", label: "cancel", description: "Leave the current worktree unchanged." },
                ],
            });
            return;
        }

        if (plan.kind === "prompt_occupied") {
            setBranchActionTarget(target);
            setBranchActionPrompt({
                title: `${target.name} is already checked out elsewhere.`,
                detail: plan.occupiedPath
                    ? `Existing worktree: ${plan.occupiedPath}`
                    : "This branch is occupied by another worktree.",
                options: [
                    { id: "create_worktree", label: "create worktree", description: `Create another worktree at ${plan.suggestedWorktreePath}.` },
                    { id: "cancel", label: "cancel", description: "Keep the current TUI session in this worktree." },
                ],
            });
            return;
        }

        await executeBranchSwitchPlan(target, plan);
    }, [addSystemMessage, executeBranchSwitchPlan, refreshRepoState, repoState]);

    const handleBranchActionResolve = useCallback(async (actionId: "stash_switch" | "create_worktree" | "cancel") => {
        const target = branchActionTarget;
        const latestState = await refreshRepoState();
        const state = latestState ?? repoState;

        if (!target || !state) {
            setBranchActionPrompt(null);
            setBranchActionTarget(null);
            return;
        }

        if (actionId === "cancel") {
            setBranchActionPrompt(null);
            setBranchActionTarget(null);
            return;
        }

        const plan = planBranchSelection(target, state);
        const worktreePath = plan.suggestedWorktreePath ?? `${state.repoRoot}-${target.name}`;

        setIsRunningLocalFlow(true);
        try {
            if (actionId === "stash_switch") {
                const stashResult = await runLocalGitCommand(
                    `stash push -u -m ${shellQuote(`mygit: switch to ${target.name}`)}`,
                    `Stash local changes before switching to ${target.name}.`,
                    "branch_panel",
                );
                if (!stashResult.success) {
                    addSystemMessage(`[branch] Failed to stash changes: ${stashResult.error ?? "unknown error"}`);
                    return;
                }

                const latestPlan = planBranchSelection(target, await refreshRepoState() ?? state);
                await executeBranchSwitchPlan(target, latestPlan);
                return;
            }

            let worktreeCommand = "";
            if (target.source === "local") {
                const forceFlag = plan.kind === "prompt_occupied" ? " --force" : "";
                worktreeCommand = `worktree add${forceFlag} ${shellQuote(worktreePath)} ${shellQuote(target.name)}`;
            } else {
                worktreeCommand = `worktree add -b ${shellQuote(target.name)} ${shellQuote(worktreePath)} ${shellQuote(target.fullRefName)}`;
            }

            const worktreeResult = await runLocalGitCommand(
                worktreeCommand,
                `Create a worktree for ${target.name}.`,
                "branch_panel",
            );
            if (!worktreeResult.success) {
                addSystemMessage(`[branch] Failed to create worktree: ${worktreeResult.error ?? "unknown error"}`);
                return;
            }

            if (target.source === "remote") {
                const upstreamResult = await runLocalGitCommand(
                    `-C ${shellQuote(worktreePath)} branch --set-upstream-to=${shellQuote(target.fullRefName)} ${shellQuote(target.name)}`,
                    `Set ${target.name} to track ${target.fullRefName} inside the new worktree.`,
                    "branch_panel",
                );
                if (!upstreamResult.success) {
                    addSystemMessage(`[branch] Worktree created at ${worktreePath}, but upstream setup failed: ${upstreamResult.error ?? "unknown error"}`);
                }
            }

            const nextState = await refreshRepoState();
            if (nextState) saveRecentBranch(nextState.repoRoot, target.name);
            setBranchActionPrompt(null);
            setBranchActionTarget(null);
            setMode("input");
            addSystemMessage(`[branch] Created worktree for ${target.name}: ${worktreePath}`);
        } finally {
            setIsRunningLocalFlow(false);
        }
    }, [
        addSystemMessage,
        branchActionTarget,
        executeBranchSwitchPlan,
        refreshRepoState,
        repoState,
        runLocalGitCommand,
    ]);

    // Computed slash-palette values
    const localBusy =
        isPreparingCommitDraft ||
        isRevisingCommitDraft ||
        isRunningLocalFlow;
    const slashMenuVisible = mode === "input" && !isProcessing && !localBusy && inputValue.startsWith("/");
    const slashFilter = inputValue.slice(1).trimStart().split(/\s+/)[0]?.toLowerCase() ?? "";
    const slashMenuItems =
        slashMenuLevel === 0
            ? TOP_SLASH_COMMANDS.filter((c) =>
                c.id.startsWith(slashFilter) ||
                (c.aliases ?? []).some((alias) => alias.startsWith(slashFilter)),
            )
            : COMPACT_SUBCOMMANDS;

    // Reset palette selection when it closes
    useEffect(() => {
        if (!slashMenuVisible) {
            setSlashMenuHighlight(0);
            setSlashMenuLevel(0);
            setSlashMenuParentId(null);
        }
    }, [slashMenuVisible]);

    // Arrow / Escape navigation for the slash palette
    useInput((input, key) => {
        if (key.upArrow) setSlashMenuHighlight((h) => Math.max(0, h - 1));
        else if (key.downArrow) setSlashMenuHighlight((h) => Math.min(slashMenuItems.length - 1, h + 1));
        else if (key.escape) {
            if (slashMenuLevel === 1) {
                setSlashMenuLevel(0);
                setSlashMenuParentId(null);
                setSlashMenuHighlight(0);
            } else {
                setInputValue("");
            }
        }
    }, { isActive: slashMenuVisible });

    const executeSlashMenuItem = useCallback((item: { id: string; hasSubmenu?: boolean }) => {
        if (slashMenuLevel === 0 && (item as SlashCommandDef).hasSubmenu) {
            setSlashMenuLevel(1);
            setSlashMenuParentId(item.id);
            setSlashMenuHighlight(0);
            return;
        }
        // Close the palette before performing the action
        setSlashMenuLevel(0);
        setSlashMenuParentId(null);
        switch (item.id) {
            case "init": void (async () => {
                addSystemMessage("[init] Indexing project files…");
                try {
                    const { ProjectIndexer } = await import("../context/indexer.js");
                    const { openProjectDatabase } = await import("../storage/database.js");
                    const model = createChatModel(providerConfig);
                    const db = openProjectDatabase();
                    const indexer = new ProjectIndexer(db, model);
                    const results = await indexer.index(process.cwd(), { batchSize: 100 });
                    const indexed = results.filter(r => r.status === "indexed").length;
                    const skipped = results.filter(r => r.status === "skipped").length;
                    addSystemMessage(`[init] Done: ${indexed} indexed, ${skipped} unchanged.`);
                    db.close();
                } catch (err: any) {
                    addSystemMessage(`[init] Error: ${err?.message ?? String(err)}`);
                }
            })(); break;
            case "branch":         openBranchPanel(); break;
            case "commit":         void handleCommitCommand(); break;
            case "fetch":          void handleFetchCommand("fetch"); break;
            case "fetch-all":      void handleFetchCommand("fetch-all"); break;
            case "config":         setMode("settings"); break;
            case "provider":
            case "model":          setMode("model_select"); break;
            case "conflicts":      void startMergeFlow(); break;
            case "worktrees":      setMode("worktree"); break;
            case "pr":             setMode("pr_inbox"); break;
            case "pr-commits":     setMode("pr_commits"); break;
            case "clear":          clearMessages(); break;
            case "compact-memory": void compactMessages(false); break;
            case "compact-save":   void compactMessages(true); break;
            case "exit":           exit(); break;
        }
    }, [
        slashMenuLevel,
        clearMessages,
        compactMessages,
        startMergeFlow,
        exit,
        addSystemMessage,
        providerConfig,
        openBranchPanel,
        handleCommitCommand,
        handleFetchCommand,
    ]);

    // Handle thought map action bar selection
    const handleThoughtMapAction = useCallback(async (action: ThoughtMapAction) => {
        switch (action) {
            case "implement":
                await handleImplementFromThoughtMap({ saveFirst: false });
                break;
            case "save_and_run":
                await handleImplementFromThoughtMap({ saveFirst: true });
                break;
            case "run_saved":
                await handleRunSavedImplementation();
                break;
            case "adjust":
                clearMap();
                setInputValue("");
                break;
        }
    }, [handleImplementFromThoughtMap, handleRunSavedImplementation, clearMap]);

    // Handle input submission
    const handleSubmit = (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return;

        if (inputIsThoughtMode) {
            if (mode === "thought_map" && thoughtMap && selectedNodeId) {
                // Refine the selected node
                void refineNode(selectedNodeId, trimmed);
            } else {
                // Generate a new thought map
                setThoughtMapIntent(trimmed);
                void generateMap(trimmed);
                setMode("thought_map");
            }
            setInputValue("");
            return;
        }

        if (pendingCommitDraft && !trimmed.startsWith("/")) {
            void handleCommitRevision(trimmed);
            setInputValue("");
            return;
        }

        if (trimmed.startsWith("/")) {
            const parsed = parseSlashCommand(trimmed);

            if (parsed.kind === "command") {
                switch (parsed.id) {
                    case "branch":
                        openBranchPanel(parsed.rawArgs || undefined);
                        break;
                    case "commit":
                        void handleCommitCommand(parsed.args);
                        break;
                    case "fetch":
                        void handleFetchCommand("fetch");
                        break;
                    case "fetch-all":
                        void handleFetchCommand("fetch-all");
                        break;
                    default: {
                        const item = TOP_SLASH_COMMANDS.find((command) => command.id === parsed.id);
                        if (item) {
                            executeSlashMenuItem(item);
                        }
                        break;
                    }
                }
                setInputValue("");
                return;
            }

            if (parsed.kind === "implement") {
                void handleImplementFromThoughtMap({ saveFirst: false });
                setInputValue("");
                return;
            }
            if (parsed.kind === "save_implementation") {
                void handleImplementFromThoughtMap({ saveFirst: true });
                setInputValue("");
                return;
            }
            if (parsed.kind === "run_implementation") {
                void handleRunSavedImplementation(parsed.ref);
                setInputValue("");
                return;
            }

            // Slash palette: Enter selects the highlighted item
            if (slashMenuVisible && slashMenuItems.length > 0) {
                const idx = Math.min(slashMenuHighlight, slashMenuItems.length - 1);
                executeSlashMenuItem(slashMenuItems[idx]);
                setInputValue("");
                return;
            }
        }

        sendRequest(trimmed);
        setInputValue("");
    };


    // Handle model selection from ModelSelector
    const handleModelSelect = useCallback(
        (provider: "ollama" | "api" | "transformer", service: ApiService | null, modelName: string) => {
            let nextConfig: Config | null = null;

            if (provider === "ollama") {
                setConfig((prev) => {
                    nextConfig = {
                        ...prev,
                        provider: "ollama",
                        ollama: { ...prev.ollama, model: modelName },
                    };
                    return nextConfig;
                });
            } else if (provider === "transformer") {
                setConfig((prev) => {
                    nextConfig = {
                        ...prev,
                        provider: "transformer",
                        transformer: { ...prev.transformer, model: modelName },
                    };
                    return nextConfig;
                });
            } else if (service) {
                setConfig((prev) => {
                    nextConfig = {
                        ...prev,
                        provider: "api",
                        api: {
                            ...prev.api,
                            activeService: service,
                            models: { ...prev.api.models, [service]: modelName },
                        },
                    };
                    return nextConfig;
                });
            }

            if (nextConfig) {
                void saveConfig(nextConfig, repoConfigPath()).catch((err: any) => {
                    addSystemMessage(
                        `[err] Failed to save selected model: ${err?.message ?? String(err)}`,
                    );
                });
            }
            setMode("input");
        },
        [addSystemMessage],
    );

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            const notice = await getConfiguredModelAvailabilityNotice(config);
            if (cancelled) return;

            if (!notice) {
                lastModelNoticeKeyRef.current = "";
                return;
            }

            if (lastModelNoticeKeyRef.current === notice.key) {
                return;
            }

            lastModelNoticeKeyRef.current = notice.key;
            addSystemMessage(`[model] ${notice.message}`);
        })();

        return () => {
            cancelled = true;
        };
    }, [
        config.provider,
        config.ollama.url,
        config.ollama.model,
        config.api.activeService,
        config.api.apiKeys,
        config.api.models,
        config.google.apiKey,
        config.google.model,
        addSystemMessage,
    ]);

    useEffect(() => {
        if (!isProcessing) {
            void refreshRepoState();
        }
    }, [isProcessing, refreshRepoState]);

    // Determine content height (shrink chat when slash palette is open)
    const statusHeight = 1;
    const inputHeight = 3;
    const slashMenuHeight = slashMenuVisible
        ? computeSlashMenuHeight(slashMenuItems.length, slashMenuLevel)
        : 0;
    const chatHeight = Math.max(3, termHeight - statusHeight - inputHeight - slashMenuHeight - 2);
    const chatWidth = Math.max(1, termWidth - 2);

    // Show confirmation panel if pending
    useEffect(() => {
        if (pendingThoughtMapStepConfirm && mode !== "confirm") {
            setMode("confirm");
        } else if (pendingConfirm && mode !== "confirm") {
            setMode("confirm");
        } else if (pendingThoughtMapPlanApproval && mode !== "plan_approval") {
            setMode("plan_approval");
        } else if (pendingPlan && mode !== "plan_approval") {
            setMode("plan_approval");
        } else if (pendingLocalConfirm && mode !== "confirm") {
            setMode("confirm");
        } else if (pendingClarify && mode !== "clarify") {
            setMode("clarify");
        } else if (pendingMergeConflicts && mode !== "merge_conflicts") {
            // Parse conflict files and switch to merge_conflicts mode
            void (async () => {
                const parsed: ConflictFile[] = [];
                for (const filePath of pendingMergeConflicts.files) {
                    try {
                        const cf = await parseConflictFile(filePath);
                        parsed.push(cf);
                    } catch {
                        // Skip files that fail to parse
                    }
                }
                setParsedConflictFiles(parsed);
                setMode("merge_conflicts");
            })();
        }
    }, [
        pendingThoughtMapStepConfirm,
        pendingConfirm,
        pendingThoughtMapPlanApproval,
        pendingPlan,
        pendingLocalConfirm,
        pendingClarify,
        pendingMergeConflicts,
        mode,
    ]);

    return (
        <Box flexDirection="column" height={termHeight} width={termWidth}>
            {/* Status Bar */}
            <StatusBar
                branch={repoState?.currentBranch ?? ""}
                model={modelName}
                provider={providerLabel}
                thinking={isThinking || localBusy}
                palette={palette}
                tokenUsage={tokenUsage}
            />

            {/* Main content area */}
            <Box flexDirection="column" flexGrow={1}>
                {mode === "settings" ? (
                    <SettingsPanel
                        config={config}
                        onSave={(newConfig) => {
                            setConfig(newConfig);
                            setMode("input");
                        }}
                        onCancel={() => setMode("input")}
                        accentColor={palette.accent}
                    />
                ) : mode === "worktree" ? (
                    <WorktreePanel
                        onClose={() => setMode("input")}
                        palette={palette}
                    />
                ) : mode === "branch_panel" ? (
                    <BranchPanel
                        data={branchPanelData}
                        actionPrompt={branchActionPrompt}
                        isLoading={isBranchPanelLoading}
                        error={branchPanelError ?? repoStateError}
                        palette={palette}
                        height={chatHeight}
                        width={chatWidth}
                        onSelectTarget={handleBranchTargetSelect}
                        onResolveAction={handleBranchActionResolve}
                        onClose={() => {
                            setBranchActionPrompt(null);
                            setBranchActionTarget(null);
                            setMode("input");
                        }}
                        onReload={() => {
                            void loadBranchPanel(branchPanelQuery ?? undefined);
                        }}
                    />
                ) : mode === "merge_conflicts" && parsedConflictFiles.length > 0 ? (
                    <MergeConflictPanel
                        files={parsedConflictFiles}
                        onDone={(outcome) => {
                            respondToMergeConflicts(outcome);
                            setParsedConflictFiles([]);
                            setMode("input");
                        }}
                        providerConfig={providerConfig}
                        palette={palette}
                        height={chatHeight}
                        width={chatWidth}
                        ide={currentIDE}
                    />
                ) : mode === "merge" && currentConflictFile ? (
                    <MergeView
                        file={currentConflictFile}
                        onResolveHunk={(hunkId, resolution) => {
                            if (!currentConflictFile) return;
                            const hunk = currentConflictFile.hunks.find((h) => h.id === hunkId);
                            if (hunk) {
                                hunk.resolution = resolution;
                            }
                        }}
                        onDone={async () => {
                            if (!currentConflictFile) return;
                            await resolveFile(currentConflictFile);

                            const nextFiles = conflictedFiles.slice(1);
                            if (nextFiles.length > 0) {
                                setConflictedFiles(nextFiles);
                                await loadConflictFile(nextFiles[0]);
                            } else {
                                setMode("input");
                                setConflictedFiles([]);
                                setCurrentConflictFile(null);
                            }
                        }}
                        accentColor={palette.accent}
                    />
                ) : mode === "confirm" && pendingThoughtMapStepConfirm ? (
                    <ConfirmPanel
                        action={stepToAgentAction(pendingThoughtMapStepConfirm.step)}
                        reasoning={`Approve execution of plan step ${pendingThoughtMapStepConfirm.step.index + 1}: ${pendingThoughtMapStepConfirm.step.description}`}
                        consequences={stepConsequences(pendingThoughtMapStepConfirm.step)}
                        onRespond={(response: PermissionResponse) => {
                            const approved = response === "allow_once" || response === "allow_session";
                            pendingThoughtMapStepConfirm.resolve(approved);
                            setPendingThoughtMapStepConfirm(null);
                            if (thoughtMap) {
                                setMode("thought_map");
                                setInputIsThoughtMode(true);
                            } else {
                                setMode("input");
                            }
                        }}
                        palette={palette}
                    />
                ) : mode === "confirm" && pendingConfirm ? (
                    <ConfirmPanel
                        action={pendingConfirm.action}
                        reasoning={pendingConfirm.reasoning}
                        consequences={pendingConfirm.consequences}
                        onRespond={(response) => {
                            respondToConfirm(response);
                            setMode("input");
                        }}
                        palette={palette}
                    />
                ) : mode === "confirm" && pendingLocalConfirm ? (
                    <ConfirmPanel
                        action={pendingLocalConfirm.action}
                        reasoning={pendingLocalConfirm.reasoning}
                        consequences={pendingLocalConfirm.consequences}
                        onRespond={(response) => {
                            const pending = pendingLocalConfirm;
                            pending.resolve(response);
                            setPendingLocalConfirm(null);
                            setMode(pending.resumeMode);
                        }}
                        palette={palette}
                    />
                ) : mode === "clarify" && pendingClarify ? (
                    <ClarifyPanel
                        question={pendingClarify.question}
                        onRespond={(answer) => {
                            respondToClarify(answer);
                            setMode("input");
                        }}
                        palette={palette}
                    />
                ) : mode === "plan_approval" && pendingThoughtMapPlanApproval ? (
                    <PlanApprovalPanel
                        steps={planToApprovalSteps(pendingThoughtMapPlanApproval.plan)}
                        onRespond={(approved) => {
                            const pending = pendingThoughtMapPlanApproval;
                            setPendingThoughtMapPlanApproval(null);
                            if (!approved) {
                                addSystemMessage("[plan] Implementation plan rejected.");
                                if (thoughtMap) {
                                    setMode("thought_map");
                                    setInputIsThoughtMode(true);
                                } else {
                                    setMode("input");
                                }
                                return;
                            }

                            void runLocalThoughtMapPlan(pending.plan, pending.origin, pending.savedPath);
                        }}
                        palette={palette}
                    />
                ) : mode === "plan_approval" && pendingPlan ? (
                    <PlanApprovalPanel
                        steps={pendingPlan.steps}
                        onRespond={(approved) => {
                            respondToPlan(approved);
                            setMode("input");
                        }}
                        palette={palette}
                    />
                ) : mode === "pr_commits" ? (
                    <PrCommitsPanel
                        onClose={() => setMode("input")}
                        palette={palette}
                    />
                ) : mode === "pr_inbox" ? (
                    <PrInboxPanel
                        githubConfig={config.github}
                        palette={palette}
                        height={chatHeight}
                        width={termWidth}
                        onOpenReview={({ owner, repo, prNumber }) => {
                            setPrReviewTarget({ owner, repo, prNumber });
                            setMode("pr_review");
                        }}
                        onClose={() => setMode("input")}
                    />
                ) : mode === "pr_review" && prReviewTarget !== null ? (
                    <PrReviewPanel
                        prNumber={prReviewTarget.prNumber}
                        repoOwner={prReviewTarget.owner}
                        repoName={prReviewTarget.repo}
                        githubConfig={config.github}
                        providerConfig={providerConfig}
                        palette={palette}
                        height={chatHeight}
                        width={chatWidth}
                        onClose={() => setMode("pr_inbox")}
                    />
                ) : mode === "model_select" ? (
                    <ModelSelector
                        onSelect={handleModelSelect}
                        onClose={() => setMode("input")}
                        palette={palette}
                        ollamaUrl={config.ollama.url}
                        apiKeys={config.api.apiKeys}
                    />
                ) : mode === "thought_map" ? (
                    isGatheringContext ? (
                        <ContextGatheringPanel
                            items={contextItems}
                            intent={thoughtMapIntent}
                            palette={palette}
                            height={chatHeight}
                        />
                    ) : thoughtMap ? (
                        <Box flexDirection="column" flexGrow={1}>
                            <ThoughtMapPanel
                                map={thoughtMap}
                                selectedNodeId={selectedNodeId}
                                onSelectNode={setSelectedNodeId}
                                isRefining={isRefiningMap}
                                palette={palette}
                                height={chatHeight - 1}
                                width={Math.max(1, termWidth - 2)}
                                onClose={() => {
                                    setMode("input");
                                    setInputIsThoughtMode(true);
                                }}
                            />
                            <ThoughtMapActions
                                onSelect={handleThoughtMapAction}
                                palette={palette}
                            />
                        </Box>
                    ) : (
                        <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
                            {isGeneratingMap ? (
                                <Text color={palette.warning}>Generating thought map...</Text>
                            ) : thoughtMapError ? (
                                <Text color={palette.error}>{thoughtMapError}</Text>
                            ) : (
                                <Text color={palette.fgMuted}>Enter a prompt to generate a thought map</Text>
                            )}
                        </Box>
                    )
                ) : (
                    <Box flexDirection="column" flexGrow={1} paddingX={1}>
                        {messages.length === 0 ? (
                            <WelcomeScreen
                                palette={palette}
                                width={chatWidth}
                                height={chatHeight}
                            />
                        ) : (
                            <ChatArea
                                messages={messages}
                                palette={palette}
                                height={chatHeight}
                                width={chatWidth}
                                scrollOffset={chatScrollOffset}
                                onScrollChange={setChatScrollOffset}
                            />
                        )}
                    </Box>
                )}
            </Box>

            {/* Slash command palette — floats above input when "/" is typed */}
            {slashMenuVisible && (
                <Box paddingX={1} width="100%">
                    <SlashMenuPanel
                        items={slashMenuItems}
                        highlight={slashMenuHighlight}
                        level={slashMenuLevel}
                        parentLabel={slashMenuParentId ? `/${slashMenuParentId}` : undefined}
                        palette={palette}
                    />
                </Box>
            )}

            {/* Input Box - show in regular input mode and thought map mode */}
            {(mode === "input" || mode === "thought_map") && (
                <Box paddingX={1} width="100%">
                    <InputBox
                        value={inputValue}
                        onChange={handleInputChange}
                        onSubmit={handleSubmit}
                        isProcessing={
                            isThinking ||
                            isGatheringContext ||
                            isGeneratingMap ||
                            isRefiningMap ||
                            isPreparingThoughtMapImplementation ||
                            isExecutingThoughtMapPlan ||
                            isPreparingCommitDraft ||
                            isRevisingCommitDraft ||
                            isRunningLocalFlow
                        }
                        isThoughtMode={inputIsThoughtMode}
                        palette={palette}
                    />
                </Box>
            )}
        </Box>
    );
}
