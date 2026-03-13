import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { globalConfigPath } from "../config/settings.js";

export function uninstallCommand(): Command {
    return new Command("uninstall")
        .description("Uninstall mygit and its configuration")
        .option("--clean", "Remove all global configurations and data (irreversible)")
        .action((opts) => {
            console.log("\nUninstalling MyGit...");

            if (opts.clean) {
                const configDir = path.dirname(globalConfigPath());
                if (fs.existsSync(configDir)) {
                    try {
                        fs.rmSync(configDir, { recursive: true, force: true });
                        console.log(`✔ Cleaned up global configurations at ${configDir}`);
                    } catch (e: any) {
                         console.error(`✖ Failed to remove global configuration at ${configDir}`, e.message);
                    }
                } else {
                    console.log(`- No global configuration found at ${configDir}`);
                }
            } else {
                console.log("Note: Run with --clean to delete your global configurations.");
            }

            console.log("\nTo completely remove the CLI from your system, depending on how you installed it, run:");
            console.log("\x1b[36m  npm uninstall -g @amoorgy/mygit\x1b[0m");
            console.log("\x1b[36m  bun remove -g @amoorgy/mygit\x1b[0m\n");
        });
}
