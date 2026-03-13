/**
 * Agent Protocol — mirrors Rust `src/agent/protocol.rs`
 *
 * Defines the AgentAction discriminated union (Zod), safety tiers,
 * permission categories, and the system prompt builder.
 */

import { z } from "zod";

// ============================================================================
// AGENT ACTION SCHEMAS
// ============================================================================

export const PlanStepSchema = z.object({
    description: z.string(),
    command: z.string().optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const FetchContextScopeSchema = z.enum(["search", "file", "directory"]);

export const AgentActionSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("git"), command: z.string() }),
    z.object({ type: z.literal("shell"), command: z.string() }),
    z.object({ type: z.literal("read_file"), path: z.string() }),
    z.object({
        type: z.literal("write_file"),
        path: z.string(),
        content: z.string(),
    }),
    z.object({
        type: z.literal("fetch_context"),
        query: z.string(),
        scope: FetchContextScopeSchema.default("search"),
    }),
    z.object({ type: z.literal("message"), content: z.string() }),
    z.object({ type: z.literal("done"), summary: z.string() }),
    z.object({ type: z.literal("respond"), answer: z.string() }),
    z.object({ type: z.literal("clarify"), question: z.string() }),
    z.object({ type: z.literal("plan"), steps: z.array(PlanStepSchema) }),
]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

// ============================================================================
// AGENT RESPONSE SCHEMA (full LLM response envelope)
// ============================================================================

export const ProgressSchema = z.object({
    completed: z.number().optional(),
    total: z.number().optional(),
    message: z.string().optional(),
});

export const AgentResponseSchema = z.object({
    reasoning: z.string(),
    action: AgentActionSchema,
    progress: ProgressSchema.optional(),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

// ============================================================================
// SAFETY TIERS
// ============================================================================

export type SafetyTier = "safe" | "standard" | "dangerous";

/**
 * Classify a git command by its safety tier.
 */
export function classifyGitCommand(cmd: string): SafetyTier {
    const trimmed = cmd.trim().toLowerCase();
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0] ?? "";

    // Safe: read-only operations
    const safeCommands = [
        "status",
        "log",
        "diff",
        "show",
        "branch",
        "remote",
        "tag",
        "rev-parse",
        "ls-files",
        "ls-tree",
        "cat-file",
        "describe",
        "shortlog",
        "stash",
        "reflog",
        "config",
        "blame",
    ];
    if (safeCommands.includes(subcommand)) return "safe";

    // Dangerous: destructive operations
    const dangerousPatterns = [
        "push --force",
        "push -f",
        "reset --hard",
        "clean -f",
        "branch -D",
        "branch -d",
        "rebase",
        "filter-branch",
    ];
    if (dangerousPatterns.some((p) => trimmed.startsWith(p))) return "dangerous";

    return "standard";
}

/**
 * Classify a shell command by its safety tier.
 */
export function classifyShellCommand(cmd: string): SafetyTier {
    const trimmed = cmd.trim().toLowerCase();
    const dangerousPatterns = [
        "rm ",
        "rm -",
        "rmdir",
        "mv ",
        "chmod",
        "chown",
        "sudo",
        "curl",
        "wget",
        "eval",
    ];
    if (dangerousPatterns.some((p) => trimmed.startsWith(p))) return "dangerous";

    const safePatterns = ["echo", "cat ", "head ", "tail ", "wc ", "ls ", "pwd", "which", "env"];
    if (safePatterns.some((p) => trimmed.startsWith(p))) return "safe";

    return "standard";
}

/**
 * Classify a file write by path.
 */
export function classifyFileWrite(path: string): SafetyTier {
    if (path.includes(".git/")) return "dangerous";
    if (path.endsWith(".lock")) return "dangerous";
    return "standard";
}

/**
 * Get the safety tier for an action.
 */
export function actionSafetyTier(action: AgentAction): SafetyTier {
    switch (action.type) {
        case "git":
            return classifyGitCommand(action.command);
        case "shell":
            return classifyShellCommand(action.command);
        case "read_file":
        case "fetch_context":
            return "safe";
        case "write_file":
            return classifyFileWrite(action.path);
        case "message":
        case "done":
        case "respond":
        case "clarify":
        case "plan":
            return "safe";
    }
}

// ============================================================================
// PERMISSION CATEGORIES
// ============================================================================

export type PermissionCategory = "shell_commands" | "file_writes" | "destructive_git";

/**
 * Get the permission category for an action, if any.
 */
export function actionPermissionCategory(action: AgentAction): PermissionCategory | null {
    switch (action.type) {
        case "shell":
            return "shell_commands";
        case "write_file":
            return "file_writes";
        case "git": {
            const tier = classifyGitCommand(action.command);
            if (tier === "dangerous") return "destructive_git";
            if (tier === "standard") return "shell_commands"; // standard git uses shell bucket
            return null;
        }
        default:
            return null;
    }
}

// ============================================================================
// ACTION HELPERS
// ============================================================================

/**
 * Get a human-readable description of an action.
 */
export function describeAction(action: AgentAction): string {
    switch (action.type) {
        case "git":
            return `git ${action.command}`;
        case "shell":
            return `$ ${action.command}`;
        case "read_file":
            return `Read ${action.path}`;
        case "fetch_context":
            return `Fetch context: ${action.query} (${action.scope})`;
        case "write_file":
            return `Write ${action.path}`;
        case "message":
            return action.content;
        case "done":
            return `Done: ${action.summary}`;
        case "respond":
            return action.answer;
        case "clarify":
            return `Question: ${action.question}`;
        case "plan":
            return `Plan with ${action.steps.length} steps`;
    }
}

/**
 * Whether this action requires side-effect execution.
 */
export function actionRequiresExecution(action: AgentAction): boolean {
    return ["git", "shell", "read_file", "write_file"].includes(action.type);
}

/**
 * Whether this action is a context fetch (handled by fetchContext node, not executor).
 */
export function actionIsFetchContext(action: AgentAction): boolean {
    return action.type === "fetch_context";
}

/**
 * Get potential consequences of an action.
 */
export function actionConsequences(action: AgentAction): string[] {
    switch (action.type) {
        case "git":
            return gitConsequences(action.command);
        case "shell":
            return [`Runs command: ${action.command}`];
        case "write_file":
            return [`Modifies file: ${action.path}`];
        case "fetch_context":
            return []; // Read-only, no consequences
        default:
            return [];
    }
}

function gitConsequences(cmd: string): string[] {
    const parts = cmd.trim().split(/\s+/);
    const sub = parts[0] ?? "";
    const consequences: string[] = [];

    if (sub === "commit") consequences.push("Creates a new commit");
    if (sub === "push") consequences.push("Pushes commits to remote");
    if (sub === "merge") consequences.push("Merges branches");
    if (sub === "checkout" || sub === "switch") consequences.push("Changes current branch");
    if (sub === "reset") consequences.push("Modifies HEAD / staging area");
    if (cmd.includes("--force") || cmd.includes("-f"))
        consequences.push("Uses force — may overwrite history");

    if (consequences.length === 0) consequences.push(`Executes: git ${cmd}`);
    return consequences;
}

// ============================================================================
// TASK MODE INFERENCE
// ============================================================================

export type TaskMode = "direct_qa" | "execution";
export type ExecutionInitPolicy = "full" | "light";

/**
 * Infer whether a request is a direct question-answer task or an execution task.
 * Direct Q&A is optimized for minimal steps and targeted file reads.
 */
export function inferTaskMode(request: string): TaskMode {
    const text = request.trim();
    const lower = text.toLowerCase();

    // Git workflow keywords always require execution mode — prevents
    // misclassification of requests like "find which branch has the login feature"
    const hasGitWorkflowIntent =
        /\b(fetch|sync|fork|upstream|cherry[\s-]?pick|bisect|undo|squash|restore\s+deleted)\b/i.test(lower) ||
        /\bbranch\b.*\b(has|contains|from)\b/i.test(lower);
    if (hasGitWorkflowIntent) return "execution";

    const hasFilePath =
        /(?:^|\s)(?:\.{0,2}\/)?[a-z0-9._-]+(?:\/[a-z0-9._-]+)+\.[a-z0-9]+(?:[:#][a-z0-9]+)?/i.test(text);

    const hasQuestionIntent =
        text.includes("?") ||
        /\b(read|show|tell|what|which|list|explain|summarize|summarise|find|where|how many|why|describe)\b/i.test(
            lower,
        );

    const hasInspectionIntent =
        /\b(read|show|list|display|print|open|inspect|summarize|summarise|explain|find)\b/i.test(lower);

    const hasMutatingIntent =
        /\b(edit|modify|change|refactor|implement|add|create|delete|remove|rename|fix|update|write|patch|commit|stage|merge|rebase|checkout|push|format|lint|install)\b/i.test(
            lower,
        );

    const hasImplementationQuestion =
        /\b(how|help)\b[\s\S]{0,40}\b(implement|build|add|fix|refactor|update|migrate)\b/i.test(lower) ||
        /\b(implement|build|add|fix|refactor|update|migrate)\b[\s\S]{0,40}\?/i.test(lower);

    if (hasMutatingIntent || hasImplementationQuestion) {
        return "execution";
    }

    if (hasQuestionIntent) {
        return "direct_qa";
    }

    if (hasFilePath && hasInspectionIntent) {
        return "direct_qa";
    }

    return "execution";
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export function inferExecutionInitPolicy(request: string): ExecutionInitPolicy {
    const text = request.trim();
    const lower = text.toLowerCase();

    const filePathMatches =
        text.match(/(?:^|\s)(?:\.{0,2}\/)?[a-z0-9._-]+(?:\/[a-z0-9._-]+)+\.[a-z0-9]+(?:[:#][a-z0-9]+)?/gi) ?? [];
    const hasMultipleFileTargets = filePathMatches.length >= 2;

    const hasComplexityIntent =
        /\b(refactor|redesign|rewrite|re-?architect|migrate|overhaul|comprehensive|end-to-end|across|entire|whole project|full stack)\b/i.test(
            lower,
        );

    const hasBroadScope =
        /\b(all files|whole repo|entire repo|repository-wide|repo-wide|cross-cutting|multiple modules)\b/i.test(
            lower,
        );

    const hasPlanHeavyIntent =
        /\b(plan|roadmap|strategy|phased|multi-step|step by step)\b/i.test(lower) &&
        /\b(implement|build|change|refactor|migrate)\b/i.test(lower);

    if (hasMultipleFileTargets || hasComplexityIntent || hasBroadScope || hasPlanHeavyIntent) {
        return "full";
    }

    return "light";
}

const OUTPUT_FORMAT_BLOCK = `FORMAT=json_only·no_fences·no_commentary
REQUIRED:{reasoning:≤2_sentences,action:{type:str,...}}
OPTIONAL:progress:{completed:n,total:n,message:str}`;

const ACTION_SCHEMA_BLOCK = `## ACTION SCHEMAS
{"type":"git","command":"status"}
{"type":"shell","command":"ls -la src/"}
{"type":"read_file","path":"src/main.rs"}
{"type":"write_file","path":"config.toml","content":"..."}
{"type":"fetch_context","query":"authentication middleware","scope":"search|file|directory"}
{"type":"message","content":"..."}
{"type":"respond","answer":"..."}
{"type":"clarify","question":"..."}
{"type":"plan","steps":[{"description":"...","command":"optional"}]}
{"type":"done","summary":"..."}`;

const PROJECT_GROUNDING_BLOCK = `## MYGIT PROJECT FACTS
IDENTITY:mygit is an AI-powered Git CLI agent with an interactive terminal UI for developer workflows.
ACTIVE_CODEBASE:The active implementation is TypeScript+Bun in src-ts/; src/ is legacy Rust and not the current development target.
PRIMARY_INTERFACES:default TUI via mygit; one-shot agent via mygit agent; focused CLI subcommands for git, PRs, conflicts, conventions, worktrees, config, setup, install, and context memory.
CORE_CAPABILITIES:chat-driven git operations; BM25+SQLite smart context retrieval; plan/thought-map workflows; merge conflict assistance; GitHub PR review/posting; convention discovery; worktree management; session/project memory; multi-provider LLM support.
LLM_PROVIDERS:Ollama, Anthropic, OpenAI, Google Gemini, DeepSeek, Groq, Cerebras, OpenRouter, and Moonshot.
SAFETY_MODEL:actions are permission-gated with safe, standard, and dangerous tiers.
KNOWLEDGE_MODEL:Root AGENTS.md is a short repo map. Detailed deterministic shard docs live in .mygit/knowledge/. Treat AGENTS.md as the table of contents, not an encyclopedia.
INIT_COMMAND:mygit init initializes or refreshes the repo-local smart-context index and the generated knowledge map. It creates or reuses .mygit/mygit.db, compiles .mygit/knowledge/*.md plus manifest.json, and updates a managed root AGENTS.md when mygit owns it. It does not scaffold source files or add product features.
INDEX_FLAGS:mygit init supports --status, --clear, and --batch <n>.
TUI_SLASH_COMMANDS:/init,/config,/provider,/model,/conflicts,/worktrees,/pr,/pr-commits,/clear,/compact,/exit.
AUTHORITY_RULE:Use these facts as the default truth for product/capability questions unless the runtime context or user-provided files explicitly contradict them.`;

const CAPABILITY_QA_BLOCK = `## CAPABILITY QA POLICY
QUESTION_TYPES:capabilities, supported commands, whether a feature exists, what a slash command does, what the project is, what subsystem owns a feature, what init/index creates.
DEFAULT_BEHAVIOR:prefer {"type":"respond"} for simple product questions and short yes/no/explainer answers.
ANSWER_STYLE:lead with yes/no when applicable, then give a 1-3 sentence explanation with the relevant command or subsystem.
WHEN_TO_INSPECT:only use fetch_context/read_file when the user asks for implementation details, exact locations, or the project facts above are insufficient.
ANTI_PATTERN:do not start broad repository exploration for straightforward built-in capability questions.`;

function buildDirectQaSystemPrompt(): string {
    return `AGENT=mygit;LOOP=emit→observe→decide;MODE=direct_qa

${OUTPUT_FORMAT_BLOCK}

${ACTION_SCHEMA_BLOCK}

${PROJECT_GROUNDING_BLOCK}

${CAPABILITY_QA_BLOCK}

QA_RULES:min_steps·use_preloaded_memory+agents_map+context_first·respond_directly_for_builtin_capability_questions·inspect_only_if_needed·no_planning_unless_asked·no_repeat_recent·one_clarify_if_blocked`;
}

function buildExecutionSystemPrompt(initPolicy: ExecutionInitPolicy): string {
    const initGuidance = initPolicy === "full"
        ? `INIT_FULL:preload_focus+memory+agents_map+selected_shards+rAG_overview·inspect_first·max_1_fetch_context_then_max_1_read_file_if_needed`
        : `INIT_LIGHT:preload_focus+memory+agents_map+selected_shards·inspect_first·max_1_fetch_context_then_max_1_read_file_if_needed`;

    return `AGENT=mygit;LOOP=emit→observe→decide;MODE=execution;INIT=${initPolicy}

${OUTPUT_FORMAT_BLOCK}

${ACTION_SCHEMA_BLOCK}

${PROJECT_GROUNDING_BLOCK}

${CAPABILITY_QA_BLOCK}

${initGuidance}
EXEC_RULES:one_action·inspect_first·use_preloaded_memory+agents_map+selected_shards+rAG_before_new_reads·prefer_single_fetch_context·read_file_only_if_still_blocked·no_repeat_recent·concrete>planning(≤1_plan)·done_when_complete·reasoning≤2s`;
}

export function buildAgentSystemPrompt(
    taskMode: TaskMode = "execution",
    initPolicy: ExecutionInitPolicy = "full",
    recipeGuidance?: string,
): string {
    const base = taskMode === "direct_qa"
        ? buildDirectQaSystemPrompt()
        : buildExecutionSystemPrompt(initPolicy);

    if (recipeGuidance) {
        return `${base}\n\n${recipeGuidance}`;
    }

    return base;
}

export function buildAgentPrompt(context: string, request: string, runtimeContext: string): string {
    const parts: string[] = [];

    parts.push(context);

    if (runtimeContext) {
        parts.push(`\n## Runtime State\n${runtimeContext}`);
    }

    parts.push(`\n## User Request\n${request}`);

    parts.push(
        `\nReturn one JSON object with "reasoning" and "action" (optional "progress"). Check Recent Actions before choosing your next step. Do not repeat prior successful actions.`,
    );

    return parts.join("\n");
}
