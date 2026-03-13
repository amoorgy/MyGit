import { Command } from "commander";
import { execa } from "execa";
import { loadConfig } from "../config/settings.js";
import { MyGitDatabase } from "../storage/database.js";
import { HumanMessage } from "@langchain/core/messages";

export function gitCommand(): Command {
    const git = new Command("git")
        .description("Git command wrapper with AI superpowers (TODO: 'git commit' auto-generate not functional)")
        .argument("[args...]", "Git arguments")
        .allowUnknownOption()
        .action(async (args, cmd) => {
            // Special handling for `commit`
            if (args[0] === "commit") {
                // Check if message is provided
                const hasMessage = args.includes("-m") || args.includes("--message");

                if (!hasMessage) {
                    console.log("Generating commit message...");
                    const config = await loadConfig();
                    const db = new MyGitDatabase(process.cwd() + "/.mygit/mygit.db");

                    const { runAgent } = await import("../agent/graph.js");
                    const { PermissionManager } = await import("../agent/permissions.js");
                    const { AgentEventBus } = await import("../agent/events.js");
                    const { getModel } = await import("../llm/providers.js");
                    const model = await getModel(config);

                    const permissions = PermissionManager.fromConfig(config);
                    const eventBus = new AgentEventBus();

                    let commitMsg = "";
                    eventBus.on((event) => {
                        if (event.type === "response") {
                            commitMsg = event.answer;
                        }
                    });

                    await runAgent("Generate a commit message for the staged changes. Return ONLY the commit message.", {
                        model,
                        permissions,
                        eventBus,
                        db
                    });

                    if (!commitMsg) {
                        console.error("Failed to generate commit message.");
                        return;
                    }

                    commitMsg = commitMsg.trim().replace(/^"|"$/g, '');

                    console.log(`Commit message: ${commitMsg}`);

                    const otherFlags = args.slice(1);
                    try {
                        await execa("git", ["commit", "-m", commitMsg, ...otherFlags], { stdio: "inherit" });
                    } catch (e) {
                        // Git commit failed
                    }
                    return;
                }
            }

            // Handle `summary` subcommand
            if (args[0] === "summary") {
                await handleSummary(args.slice(1));
                return;
            }

            // Handle `explain` subcommand
            if (args[0] === "explain") {
                await handleExplain(args.slice(1));
                return;
            }

            // Pass-through for everything else
            try {
                await execa("git", args, { stdio: "inherit" });
            } catch (e) {
                // ignore, output inherited
            }
        });

    return git;
}

// ============================================================================
// summary subcommand: mygit git summary [-c <count>]
// ============================================================================

async function handleSummary(args: string[]): Promise<void> {
    // Parse -c <count> from args
    let count = 5;
    const cIdx = args.indexOf("-c");
    if (cIdx !== -1 && args[cIdx + 1]) {
        const parsed = parseInt(args[cIdx + 1], 10);
        if (!isNaN(parsed) && parsed > 0) {
            count = parsed;
        }
    }

    // Get last N commits
    let logOutput: string;
    try {
        const result = await execa("git", [
            "log",
            `--max-count=${count}`,
            "--pretty=format:%h %s (%an, %ar)",
        ]);
        logOutput = result.stdout;
    } catch (e: any) {
        console.error(`Failed to retrieve git log: ${e.message}`);
        return;
    }

    if (!logOutput.trim()) {
        console.log("No commits found.");
        return;
    }

    console.log(`Summarizing last ${count} commit(s)...\n`);

    const config = await loadConfig();
    const { getModel } = await import("../llm/providers.js");
    const model = await getModel(config);

    const prompt = `Summarize these git commits in 2-3 sentences:\n\n${logOutput}`;
    const result = await model.invoke([new HumanMessage(prompt)]);
    const text = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content);
    console.log(text);
}

// ============================================================================
// explain subcommand: mygit git explain <target>
// ============================================================================

async function handleExplain(args: string[]): Promise<void> {
    const target = args[0];
    if (!target) {
        console.error("Usage: mygit git explain <file-or-commit-hash>");
        return;
    }

    let content: string;
    let kind: "commit" | "file";

    // Heuristic: if it looks like a hex hash (7-40 chars), treat as commit
    if (/^[0-9a-f]{7,40}$/i.test(target)) {
        kind = "commit";
        try {
            const result = await execa("git", ["show", target]);
            content = result.stdout;
        } catch (e: any) {
            console.error(`Failed to show commit ${target}: ${e.message}`);
            return;
        }
    } else {
        kind = "file";
        try {
            const fs = await import("fs/promises");
            content = await fs.readFile(target, "utf-8");
        } catch (e: any) {
            console.error(`Failed to read file ${target}: ${e.message}`);
            return;
        }
    }

    // Truncate very large content to avoid exceeding context limits
    const MAX_CHARS = 30_000;
    if (content.length > MAX_CHARS) {
        content = content.slice(0, MAX_CHARS) + "\n\n... (truncated)";
    }

    const label = kind === "commit" ? "commit" : "code";
    console.log(`Explaining ${label}: ${target}\n`);

    const config = await loadConfig();
    const { getModel } = await import("../llm/providers.js");
    const model = await getModel(config);

    const prompt = kind === "commit"
        ? `Explain this git commit. Describe what changes were made and why:\n\n${content}`
        : `Explain this code. Describe what it does, its purpose, and any notable patterns:\n\n${content}`;

    const result = await model.invoke([new HumanMessage(prompt)]);
    const text = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content);
    console.log(text);
}
