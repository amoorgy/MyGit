import { Command } from "commander";
import { captureContext } from "../memory/capture.js";
import {
    buildPortableMemoryPack,
    createSessionCheckpoint,
    loadProjectMemory,
} from "../memory/sessionMemory.js";
import { loadConfig } from "../config/settings.js";
import { execa } from "execa";
import { queueIncrementalIndexRefresh } from "../context/autoIndex.js";

export function brainCommand(): Command {
    const brain = new Command("brain")
        .description("Context Manager for capturing and restoring mental models");

    brain
        .command("save")
        .description("Capture the current development state and summarize intent")
        .argument("[note]", "Optional note about your current intent or state")
        .action(async (noteStr) => {
            console.log("🧠 Capturing mental snapshot...");
            try {
                const context = await captureContext();
                const config = await loadConfig();
                const { getModel } = await import("../llm/providers.js");
                const model = await getModel(config);
                console.log("🤖 Writing latest project memory...");

                const checkpoint = await createSessionCheckpoint({
                    model,
                    userNote: noteStr,
                    persist: true,
                    extraContext: [
                        `Git diff:\n${context.gitDiff.slice(0, 5000) || "(none)"}`,
                        `Active files:\n${context.activeFiles.join("\n") || "(none)"}`,
                        `Recent terminal history:\n${context.terminalHistory || "(none)"}`,
                    ],
                });
                if (checkpoint.persisted) {
                    queueIncrementalIndexRefresh({
                        repoRoot: process.cwd(),
                        model,
                        contextConfig: config.context,
                        relativePaths: checkpoint.refreshFiles,
                    });
                }
                const status = checkpoint.persisted ? "✅ State saved successfully." : "⚠️ Summary generated, but save failed.";
                console.log(status);
                console.log(`\n${checkpoint.summary}`);
            } catch (err: any) {
                console.error("❌ Failed to save context:", err.message);
            }
        });

    brain
        .command("resume")
        .description("Restore the last saved mental model")
        .action(async () => {
            const memory = await loadProjectMemory();
            if (!memory.last && !memory.next && memory.recentSessions.length === 0) {
                console.log("No saved state found.");
                return;
            }

            console.log("\nWelcome back to mygit! 🧠\n");
            console.log(`Last: \x1b[36m${memory.last || "No recent session memory recorded."}\x1b[0m`);
            console.log(`Next: \x1b[32m${memory.next || "Resume from the current git status."}\x1b[0m`);
            if (memory.recentSessions.length > 0) {
                console.log("\nRecent sessions:");
                for (const line of memory.recentSessions.slice(0, 3)) {
                    console.log(line);
                }
            }
            console.log("");
        });

    brain
        .command("pack")
        .description("Pack the current state into markdown suitable for an LLM prompt")
        .action(async () => {
            try {
                const packStr = await buildPortableMemoryPack();
                if (!packStr) {
                    console.log("No saved state found to pack. Run `mygit brain save` first.");
                    return;
                }

                // Attempt to copy to clipboard on macOS
                if (process.platform === 'darwin') {
                    try {
                        const child = execa("pbcopy");
                        child.stdin?.write(packStr);
                        child.stdin?.end();
                        await child;
                        console.log("✅ Packed context copied to clipboard!");
                    } catch (e) {
                        console.log("Context packed:\n\n" + packStr);
                    }
                } else {
                    console.log("Context packed:\n\n" + packStr);
                }
            } catch (err: any) {
                console.error("❌ Failed to pack context:", err.message);
            }
        });

    return brain;
}
