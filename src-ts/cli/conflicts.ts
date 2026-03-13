/**
 * CLI commands for merge conflict management.
 *
 * Subcommands:
 *   list          — List all files with unresolved conflicts
 *   show <file>   — Show conflict hunks with colored ours/theirs sides
 *   accept-ours   — Resolve all conflicts in all files by accepting "ours"
 *   accept-theirs — Resolve all conflicts in all files by accepting "theirs"
 */

import { Command } from "commander";
import { listConflictedFiles, resolveAllWith } from "../merge/resolver.js";
import { parseConflictFile } from "../merge/parser.js";

// ── ANSI helpers ──────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

// ── Public API ────────────────────────────────────────────────────────

export function conflictsCommand(): Command {
    const conflicts = new Command("conflicts")
        .description("Manage merge conflicts");

    // ── list ───────────────────────────────────────────────────────────

    conflicts
        .command("list")
        .description("List all files with unresolved merge conflicts")
        .action(async () => {
            const files = await listConflictedFiles();
            if (files.length === 0) {
                console.log(`${GREEN}No conflicted files found.${RESET}`);
                return;
            }

            console.log(`\n${BOLD}Conflicted files (${files.length}):${RESET}\n`);
            for (const file of files) {
                console.log(`  ${RED}U${RESET}  ${file}`);
            }
            console.log();
        });

    // ── show <file> ───────────────────────────────────────────────────

    conflicts
        .command("show <file>")
        .description("Show conflict hunks in a file with colored ours/theirs sides")
        .action(async (file: string) => {
            try {
                const conflictFile = await parseConflictFile(file);

                if (conflictFile.hunks.length === 0) {
                    console.log(`${GREEN}No conflict hunks found in ${file}.${RESET}`);
                    return;
                }

                console.log(
                    `\n${BOLD}${CYAN}${file}${RESET}  ${DIM}(${conflictFile.hunks.length} conflict${conflictFile.hunks.length === 1 ? "" : "s"}, ${conflictFile.totalLines} lines)${RESET}\n`,
                );

                for (const hunk of conflictFile.hunks) {
                    const hunkHeader = `Hunk #${hunk.id} (lines ${hunk.lineStart}-${hunk.lineEnd})`;
                    console.log(`${BOLD}${YELLOW}--- ${hunkHeader} ---${RESET}`);

                    // Ours side
                    const oursLabel = hunk.oursLabel ? ` (${hunk.oursLabel})` : "";
                    console.log(`${GREEN}${BOLD}<<<<<<< OURS${oursLabel}${RESET}`);
                    for (const line of hunk.ours) {
                        console.log(`${GREEN}+ ${line}${RESET}`);
                    }

                    // Base (diff3) if present
                    if (hunk.base !== null) {
                        console.log(`${MAGENTA}${BOLD}||||||| BASE${RESET}`);
                        for (const line of hunk.base) {
                            console.log(`${MAGENTA}  ${line}${RESET}`);
                        }
                    }

                    // Separator
                    console.log(`${DIM}=======${RESET}`);

                    // Theirs side
                    const theirsLabel = hunk.theirsLabel ? ` (${hunk.theirsLabel})` : "";
                    console.log(`${RED}${BOLD}>>>>>>> THEIRS${theirsLabel}${RESET}`);
                    for (const line of hunk.theirs) {
                        console.log(`${RED}- ${line}${RESET}`);
                    }

                    console.log(); // blank line between hunks
                }
            } catch (err: any) {
                console.error(`${RED}Error reading ${file}: ${err.message}${RESET}`);
                process.exitCode = 1;
            }
        });

    // ── accept-ours ───────────────────────────────────────────────────

    conflicts
        .command("accept-ours")
        .description("Resolve all conflicts in all files by accepting the 'ours' side")
        .action(async () => {
            const files = await listConflictedFiles();
            if (files.length === 0) {
                console.log(`${GREEN}No conflicted files to resolve.${RESET}`);
                return;
            }

            console.log(`\n${BOLD}Resolving ${files.length} file(s) with accept-ours...${RESET}\n`);

            for (const file of files) {
                try {
                    await resolveAllWith(file, true);
                    console.log(`  ${GREEN}Resolved${RESET}  ${file}`);
                } catch (err: any) {
                    console.error(`  ${RED}Failed${RESET}   ${file}: ${err.message}`);
                    process.exitCode = 1;
                }
            }

            console.log(`\n${GREEN}Done.${RESET} Run ${DIM}git add${RESET} and ${DIM}git commit${RESET} to finalize.\n`);
        });

    // ── accept-theirs ─────────────────────────────────────────────────

    conflicts
        .command("accept-theirs")
        .description("Resolve all conflicts in all files by accepting the 'theirs' side")
        .action(async () => {
            const files = await listConflictedFiles();
            if (files.length === 0) {
                console.log(`${GREEN}No conflicted files to resolve.${RESET}`);
                return;
            }

            console.log(`\n${BOLD}Resolving ${files.length} file(s) with accept-theirs...${RESET}\n`);

            for (const file of files) {
                try {
                    await resolveAllWith(file, false);
                    console.log(`  ${GREEN}Resolved${RESET}  ${file}`);
                } catch (err: any) {
                    console.error(`  ${RED}Failed${RESET}   ${file}: ${err.message}`);
                    process.exitCode = 1;
                }
            }

            console.log(`\n${GREEN}Done.${RESET} Run ${DIM}git add${RESET} and ${DIM}git commit${RESET} to finalize.\n`);
        });

    return conflicts;
}
