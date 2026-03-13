import { Command } from "commander";
import { discoverConventions, saveConventions, loadConventions } from "../conventions/index.js";
import { openProjectDatabase } from "../storage/database.js";

export function conventionsCommand(): Command {
    const conventions = new Command("conventions")
        .description("Manage repository conventions (discover, show, clear)");

    conventions
        .command("discover")
        .description("Analyze the repo and discover conventions")
        .action(async () => {
            try {
                const repoPath = process.cwd();
                console.log("Scanning repository for conventions...\n");

                const discovered = await discoverConventions(repoPath);

                if (discovered.length === 0) {
                    console.log("No conventions detected in this repository.");
                    return;
                }

                // Save to database
                const db = openProjectDatabase();
                try {
                    saveConventions(db, discovered);
                } finally {
                    db.close();
                }

                // Print results
                console.log(`Discovered ${discovered.length} convention(s):\n`);
                printConventionsTable(discovered);

                console.log("\nConventions saved to .mygit/mygit.db");
            } catch (err: any) {
                console.error(`Failed to discover conventions: ${err.message}`);
                process.exit(1);
            }
        });

    conventions
        .command("show")
        .description("Show saved conventions")
        .action(async () => {
            try {
                const db = openProjectDatabase();
                let loaded: ReturnType<typeof loadConventions>;
                try {
                    loaded = loadConventions(db);
                } finally {
                    db.close();
                }

                if (loaded.length === 0) {
                    console.log("No conventions stored. Run `mygit conventions discover` first.");
                    return;
                }

                console.log(`Stored conventions (${loaded.length}):\n`);
                printConventionsTable(loaded);
            } catch (err: any) {
                console.error(`Failed to load conventions: ${err.message}`);
                process.exit(1);
            }
        });

    conventions
        .command("clear")
        .description("Clear all saved conventions")
        .action(async () => {
            try {
                const db = openProjectDatabase();
                try {
                    db.clearConventions();
                } finally {
                    db.close();
                }

                console.log("All conventions cleared.");
            } catch (err: any) {
                console.error(`Failed to clear conventions: ${err.message}`);
                process.exit(1);
            }
        });

    return conventions;
}

// ── Helpers ─────────────────────────────────────────────────────────────

interface PrintableConvention {
    type: string;
    pattern: string;
    confidence: number;
    description: string;
}

function printConventionsTable(conventions: PrintableConvention[]) {
    // Calculate column widths
    const typeW = Math.max("Type".length, ...conventions.map((c) => c.type.length));
    const patternW = Math.max("Pattern".length, ...conventions.map((c) => c.pattern.length));
    const confW = "Confidence".length;
    const descW = Math.max("Description".length, ...conventions.map((c) => c.description.length));

    const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
    const sep = `${"─".repeat(typeW)}──${"─".repeat(patternW)}──${"─".repeat(confW)}──${"─".repeat(descW)}`;

    console.log(`${pad("Type", typeW)}  ${pad("Pattern", patternW)}  ${pad("Confidence", confW)}  Description`);
    console.log(sep);

    for (const c of conventions) {
        const pct = `${(c.confidence * 100).toFixed(0)}%`;
        console.log(
            `${pad(c.type, typeW)}  ${pad(c.pattern, patternW)}  ${pad(pct, confW)}  ${c.description}`,
        );
    }
}
