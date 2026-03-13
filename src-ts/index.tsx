
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { registerCommands } from "./cli/index.js";

// Load .env from CWD or nearest ancestor directory (handles compiled binary case).
// Walks up to 8 levels so it works regardless of where inside a repo you invoke mygit.
// Only sets vars not already present in the environment so explicit shell exports win.
(function loadDotEnv() {
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
        const envPath = path.join(dir, ".env");
        try {
            const content = fs.readFileSync(envPath, "utf-8");
            for (const line of content.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("#")) continue;
                const eq = trimmed.indexOf("=");
                if (eq === -1) continue;
                const key = trimmed.slice(0, eq).trim();
                let val = trimmed.slice(eq + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) ||
                    (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (key && !(key in process.env)) {
                    process.env[key] = val;
                }
            }
            break;
        } catch {
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
})();

// CLI

const program = new Command()
    .name("mygit")
    .version("0.1.0");


registerCommands(program);
program.parse(process.argv);