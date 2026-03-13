/**
 * Plan types — ported from Rust src/plan/types.ts
 */

export interface Step {
    index: number;
    description: string;
    command: string;
    isGit: boolean;
    isReversible: boolean;
    requiresApproval: boolean;
    expectedOutcome?: string;
}

export type SafetyLevel = "high" | "medium" | "low";
export type ExecutionMode = "auto" | "step_by_step" | "interactive";

export interface Plan {
    id: string;
    intent: string;
    steps: Step[];
    safetyLevel: SafetyLevel;
    createdAt: number;
}

export interface PlanResult {
    success: boolean;
    stepsCompleted: number;
    totalSteps: number;
    stepResults: StepResult[];
}

export interface StepResult {
    index: number;
    success: boolean;
    output: string;
}

const DESTRUCTIVE_GIT_PREFIXES = [
    "push --force", "push -f",
    "reset --hard",
    "clean -f", "clean -fd", "clean -fx",
    "branch -D",
    "checkout -- .",
];

export function isStepDangerous(step: Step): boolean {
    if (!step.isGit) {
        const lower = step.command.toLowerCase();
        return lower.includes("rm -rf") || lower.includes("rm -fr");
    }
    const lower = step.command.toLowerCase();
    return DESTRUCTIVE_GIT_PREFIXES.some(p => lower.startsWith(p));
}

export function classifySafety(steps: Step[]): SafetyLevel {
    const hasDangerous = steps.some(s => isStepDangerous(s));
    if (hasDangerous) return "low";
    const allReversible = steps.every(s => s.isReversible);
    return allReversible ? "high" : "medium";
}

export function createPlan(intent: string, steps: Step[]): Plan {
    return {
        id: `plan_${Date.now()}`,
        intent,
        steps,
        safetyLevel: classifySafety(steps),
        createdAt: Date.now(),
    };
}

export function formatPlan(plan: Plan): string {
    const lines: string[] = [];
    lines.push(`Plan: ${plan.intent}`);
    lines.push(`Safety: ${plan.safetyLevel.toUpperCase()}  Steps: ${plan.steps.length}`);
    lines.push("");
    for (const step of plan.steps) {
        const tag = isStepDangerous(step) ? "[!]" : step.requiresApproval ? "[?]" : "[.]";
        const prefix = step.isGit ? "git " : "$ ";
        lines.push(`  ${step.index + 1}. ${tag} ${step.description}`);
        lines.push(`     ${prefix}${step.command}`);
    }
    return lines.join("\n");
}
