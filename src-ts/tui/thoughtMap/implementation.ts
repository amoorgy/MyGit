import * as fs from "fs/promises";
import * as path from "path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ThoughtMap } from "./types.js";
import type { Plan, Step, ExecutionMode } from "../../plan/types.js";
import { createPlan, isStepDangerous } from "../../plan/types.js";
import { repoConfigPath } from "../../config/settings.js";

export interface ThoughtMapImplementationSource {
    type: "thought_map";
    thoughtMapId: string;
    intent: string;
    scope: "whole_map";
    selectedNodeId: null;
}

export interface SavedImplementationPlanV1 {
    version: 1;
    savedAt: string;
    source: ThoughtMapImplementationSource;
    plan: Plan;
    executionDefaults: {
        mode: ExecutionMode;
    };
}

interface PlanResponseShape {
    steps?: Array<Partial<Step> & { command?: string; description?: string }>;
}

const IMPLEMENTATION_PLAN_SYSTEM_PROMPT = `You convert a thought map into an executable implementation plan for a coding assistant.

Return ONLY valid JSON with this schema:
{
  "steps": [
    {
      "index": 0,
      "description": "Human-readable step",
      "command": "shell command or git subcommand",
      "isGit": false,
      "isReversible": true,
      "requiresApproval": false,
      "expectedOutcome": "What should happen"
    }
  ]
}

Rules:
- Scope is the WHOLE thought map.
- Use dependencies in the thought map to order steps.
- Prefer concrete commands already present on nodes when available.
- Include validation/read-only steps before mutating steps when useful.
- For git steps, set isGit=true and OMIT the leading "git ".
- Mark destructive operations (force push, reset --hard, rm -rf) with requiresApproval=true.
- Keep plans minimal, practical, and executable in a local repo shell.
- Do not include markdown fences or commentary.`;

export async function generateImplementationPlanFromThoughtMap(
    map: ThoughtMap,
    model: BaseChatModel,
): Promise<Plan> {
    const historySummary = map.refinementHistory.length === 0
        ? "(none)"
        : map.refinementHistory
            .slice(-20)
            .map((entry) => `- ${entry.nodeId}: ${entry.prompt}`)
            .join("\n");

    const prompt = [
        `Thought Map Intent: ${map.intent}`,
        "",
        "Scope: whole_map",
        "",
        "Thought Map JSON:",
        JSON.stringify(map, null, 2),
        "",
        "Refinement history (recent):",
        historySummary,
        "",
        "Generate the executable implementation plan now.",
    ].join("\n");

    const response = await model.invoke([
        new SystemMessage(IMPLEMENTATION_PLAN_SYSTEM_PROMPT),
        new HumanMessage(prompt),
    ]);

    const rawText =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

    const parsed = parseImplementationPlanResponse(rawText);
    const steps = normalizeImplementationPlanSteps(parsed.steps ?? []);
    return createPlan(map.intent, steps);
}

export function buildSavedImplementationPlan(
    map: ThoughtMap,
    plan: Plan,
): SavedImplementationPlanV1 {
    return {
        version: 1,
        savedAt: new Date().toISOString(),
        source: {
            type: "thought_map",
            thoughtMapId: map.id,
            intent: map.intent,
            scope: "whole_map",
            selectedNodeId: null,
        },
        plan,
        executionDefaults: {
            mode: "interactive",
        },
    };
}

export async function saveImplementationPlan(
    bundle: SavedImplementationPlanV1,
    opts?: { baseDir?: string },
): Promise<{ filePath: string; latestPath: string }> {
    const dir = opts?.baseDir ?? implementationPlansDir();
    await fs.mkdir(dir, { recursive: true });

    const slug = slugify(bundle.source.intent || "implementation");
    const timestamp = Date.now();
    const fileName = `implementation-${timestamp}-${slug}.json`;
    const filePath = path.join(dir, fileName);
    const latestPath = path.join(dir, "latest-implementation.json");
    const content = JSON.stringify(bundle, null, 2);

    await fs.writeFile(filePath, content, "utf-8");
    await fs.writeFile(latestPath, content, "utf-8");

    return { filePath, latestPath };
}

export async function loadImplementationPlan(
    ref?: string,
    opts?: { baseDir?: string },
): Promise<SavedImplementationPlanV1> {
    const dir = opts?.baseDir ?? implementationPlansDir();
    const targetPath = await resolveImplementationPlanPath(dir, ref);
    const raw = await fs.readFile(targetPath, "utf-8");

    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`Invalid saved implementation plan JSON: ${path.basename(targetPath)}`);
    }

    if (parsed?.version !== 1) {
        throw new Error(`Unsupported saved implementation plan version: ${String(parsed?.version)}`);
    }
    if (!parsed?.plan || !Array.isArray(parsed.plan.steps)) {
        throw new Error(`Saved implementation plan is missing a valid plan payload: ${path.basename(targetPath)}`);
    }

    return parsed as SavedImplementationPlanV1;
}

export async function resolveImplementationPlanPath(
    dir: string,
    ref?: string,
): Promise<string> {
    if (!ref || !ref.trim()) {
        return path.join(dir, "latest-implementation.json");
    }

    const wanted = ref.trim();
    const directPath = path.isAbsolute(wanted) ? wanted : path.join(dir, wanted);

    try {
        const stat = await fs.stat(directPath);
        if (stat.isFile()) return directPath;
    } catch {
        // fall through to stem match
    }

    const entries = await fs.readdir(dir);
    const candidates = entries
        .filter((name) => name.endsWith(".json"))
        .filter((name) => name !== "latest-implementation.json")
        .filter((name) => {
            const stem = name.replace(/\.json$/i, "");
            return stem === wanted || stem.startsWith(wanted) || name.startsWith(wanted);
        });

    if (candidates.length === 0) {
        throw new Error(`No saved implementation plan found for "${wanted}"`);
    }
    if (candidates.length > 1) {
        throw new Error(
            `Ambiguous saved implementation plan "${wanted}". Matches: ${candidates.join(", ")}`,
        );
    }

    return path.join(dir, candidates[0]);
}

export function implementationPlansDir(): string {
    return path.join(path.dirname(repoConfigPath()), "plans");
}

export function parseImplementationPlanResponse(rawText: string): PlanResponseShape {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error("Implementation plan generation failed: model returned no JSON");
    }

    let parsed: any;
    try {
        parsed = JSON.parse(jsonMatch[0]);
    } catch (err: any) {
        throw new Error(`Implementation plan generation failed: invalid JSON (${err.message})`);
    }

    return parsed as PlanResponseShape;
}

export function normalizeImplementationPlanSteps(
    rawSteps: Array<Partial<Step> & { command?: string; description?: string }>,
): Step[] {
    return rawSteps
        .map((raw, i) => normalizeStep(raw, i))
        .filter((step): step is Step => Boolean(step.command?.trim()));
}

function normalizeStep(raw: Partial<Step> & { command?: string; description?: string }, index: number): Step {
    const rawCommand = String(raw.command ?? "").trim();
    const gitPrefixed = rawCommand.toLowerCase().startsWith("git ");
    const isGit = typeof raw.isGit === "boolean" ? raw.isGit : gitPrefixed;
    const command = gitPrefixed ? rawCommand.slice(4).trim() : rawCommand;

    const base: Step = {
        index: typeof raw.index === "number" ? raw.index : index,
        description: String(raw.description ?? `Step ${index + 1}`),
        command,
        isGit,
        isReversible: typeof raw.isReversible === "boolean" ? raw.isReversible : true,
        requiresApproval: Boolean(raw.requiresApproval),
        expectedOutcome: typeof raw.expectedOutcome === "string" ? raw.expectedOutcome : undefined,
    };

    if (isStepDangerous(base)) {
        base.requiresApproval = true;
        if (typeof raw.isReversible !== "boolean") {
            base.isReversible = false;
        }
    }

    const lowerCommand = command.toLowerCase();
    if (base.isGit && lowerCommand.startsWith("push")) {
        base.isReversible = false;
    }

    return base;
}

function slugify(value: string): string {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return slug || "implementation";
}
