
import { Command } from "commander";
import { loadConfig } from "../config/settings.js";
import { MyGitDatabase } from "../storage/database.js";
import { runAgent } from "../agent/graph.js"; // Correct import
import { PermissionManager } from "../agent/permissions.js";
import { AgentEventBus } from "../agent/events.js";
import { getModel } from "../llm/providers.js"; // Correct import
import path from "path";

export function agentCommand(): Command {
    const agent = new Command("agent")
        .description("[testing only, not functional] Run the agent non-interactively")
        .argument("<task>", "The task to perform")
        .action(async (task) => {
            const config = await loadConfig();

            // Fix DB path
            const dbPath = path.join(process.cwd(), ".mygit", "mygit.db");
            const db = new MyGitDatabase(dbPath);

            const model = await getModel(config);
            const permissions = PermissionManager.fromConfig(config);
            const eventBus = new AgentEventBus();

            // Log events to console
            eventBus.on((event) => {
                if (event.type === "thinking") {
                    console.log(`[thinking] ${event.content}`);
                } else if (event.type === "action") {
                    console.log(`[action] ${event.action.type}: ${JSON.stringify(event.action)}`);
                } else if (event.type === "response") {
                    console.log(`[response] ${event.answer}`);
                } else if (event.type === "error") {
                    console.error(`[error] ${event.message}`);
                }
            });

            console.log(`[agent] starting...`);
            await runAgent(task, {
                model,
                permissions,
                eventBus,
                db
            });
        });

    return agent;
}
