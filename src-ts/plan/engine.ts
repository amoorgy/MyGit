/**
 * Plan execution engine — ported from Rust plan mode.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { execa } from "execa";
import {
    type Plan,
    type Step,
    type PlanResult,
    type StepResult,
    type ExecutionMode,
    createPlan,
    formatPlan,
    isStepDangerous,
} from "./types.js";
import { gatherContext, formatContextForPrompt } from "../agent/context.js";

/**
 * Generate a plan from user intent using LLM.
 */
export async function generatePlan(
    intent: string,
    model: BaseChatModel,
): Promise<Plan> {
    const ctx = await gatherContext();
    const contextStr = formatContextForPrompt(ctx);

    const systemPrompt = `You are a Git operations planner. Given a user intent and repository context, generate a step-by-step plan of git and shell commands to accomplish the goal.

Respond with valid JSON matching this schema:
{
  "steps": [
    {
      "index": 0,
      "description": "Human-readable description",
      "command": "the command (for git commands, omit 'git ' prefix)",
      "isGit": true,
      "isReversible": true,
      "requiresApproval": false,
      "expectedOutcome": "What should happen"
    }
  ]
}

Rules:
- For git commands, set isGit=true and put only the git subcommand (e.g. "checkout main" not "git checkout main")
- For shell commands, set isGit=false and put the full command
- Mark destructive operations (force push, reset --hard, clean, branch -D) as requiresApproval=true and isReversible=false
- Mark push operations as isReversible=false
- Keep plans minimal — prefer fewer steps`;

    const userPrompt = `Repository Context:\n${contextStr}\n\nIntent: ${intent}\n\nGenerate a plan:`;

    const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
    ]);

    const rawText = typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Extract JSON
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error("LLM did not return valid JSON for plan generation");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const steps: Step[] = (parsed.steps ?? []).map((s: any, i: number) => ({
        index: s.index ?? i,
        description: s.description ?? `Step ${i + 1}`,
        command: s.command ?? "",
        isGit: s.isGit ?? true,
        isReversible: s.isReversible ?? true,
        requiresApproval: s.requiresApproval ?? false,
        expectedOutcome: s.expectedOutcome,
    }));

    return createPlan(intent, steps);
}

/**
 * Execute a plan step by step.
 */
export async function executePlan(
    plan: Plan,
    mode: ExecutionMode,
    confirmFn?: (step: Step) => Promise<boolean>,
    logFn?: (msg: string) => void,
): Promise<PlanResult> {
    const log = logFn ?? console.log;
    const stepResults: StepResult[] = [];
    let stepsCompleted = 0;

    for (const step of plan.steps) {
        // Check if we need user approval
        const needsApproval =
            mode === "step_by_step" ||
            (mode === "interactive" && (step.requiresApproval || isStepDangerous(step)));

        if (needsApproval && confirmFn) {
            const approved = await confirmFn(step);
            if (!approved) {
                log(`Skipped step ${step.index + 1}: ${step.description}`);
                stepResults.push({ index: step.index, success: false, output: "Skipped by user" });
                continue;
            }
        }

        // Execute
        const prefix = step.isGit ? "git " : "";
        const fullCommand = `${prefix}${step.command}`;
        log(`Executing: ${fullCommand}`);

        try {
            const result = await execa(fullCommand, {
                shell: true,
                reject: false,
                timeout: 30_000,
            });

            const success = result.exitCode === 0;
            const output = success ? (result.stdout || "(no output)") : (result.stderr || `Exit code: ${result.exitCode}`);

            stepResults.push({ index: step.index, success, output });

            if (success) {
                stepsCompleted++;
                log(`  OK: ${output.split("\n")[0]}`);
            } else {
                log(`  FAILED: ${output.split("\n")[0]}`);
                // Stop on failure in auto mode
                if (mode === "auto") break;
            }
        } catch (err: any) {
            stepResults.push({ index: step.index, success: false, output: err.message });
            log(`  ERROR: ${err.message}`);
            if (mode === "auto") break;
        }
    }

    return {
        success: stepsCompleted === plan.steps.length,
        stepsCompleted,
        totalSteps: plan.steps.length,
        stepResults,
    };
}
