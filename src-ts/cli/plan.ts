import { Command } from "commander";
import { loadConfig } from "../config/settings.js";
import { getModel } from "../llm/providers.js";
import { generatePlan, executePlan } from "../plan/engine.js";
import { formatPlan } from "../plan/types.js";
import type { Step } from "../plan/types.js";
import * as readline from "readline";

export function planCommand(): Command {
    const plan = new Command("plan")
        .description("Generate and execute a multi-step plan from a natural language intent")
        .argument("<intent>", "What you want to accomplish")
        .option("--dry-run", "Generate plan without executing")
        .option("--mode <mode>", "Execution mode: auto, step, interactive", "interactive")
        .action(async (intent: string, opts: { dryRun?: boolean; mode?: string }) => {
            try {
                const config = await loadConfig();
                const model = await getModel(config);

                console.log(`Planning: "${intent}"\n`);
                const generated = await generatePlan(intent, model);

                // Display the plan
                console.log(formatPlan(generated));
                console.log("");

                if (opts.dryRun) {
                    console.log("(dry-run mode — plan not executed)");
                    return;
                }

                // Ask for confirmation before executing
                const confirmed = await promptYesNo("Execute this plan?");
                if (!confirmed) {
                    console.log("Plan cancelled.");
                    return;
                }

                // Map mode string
                const modeMap: Record<string, "auto" | "step_by_step" | "interactive"> = {
                    auto: "auto",
                    step: "step_by_step",
                    interactive: "interactive",
                };
                const mode = modeMap[opts.mode ?? "interactive"] ?? "interactive";

                // Execute
                const result = await executePlan(
                    generated,
                    mode,
                    async (step: Step) => {
                        const prefix = step.isGit ? "git " : "$ ";
                        return promptYesNo(`  Execute step ${step.index + 1}: ${prefix}${step.command}?`);
                    },
                    (msg: string) => console.log(msg),
                );

                // Summary
                console.log("");
                if (result.success) {
                    console.log(`Plan completed: ${result.stepsCompleted}/${result.totalSteps} steps succeeded.`);
                } else {
                    console.log(`Plan partially completed: ${result.stepsCompleted}/${result.totalSteps} steps succeeded.`);
                    process.exitCode = 1;
                }
            } catch (err: any) {
                console.error(`Failed: ${err.message}`);
                process.exit(1);
            }
        });

    return plan;
}

function promptYesNo(question: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(`${question} [Y/n] `, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() !== "n");
        });
    });
}
