
import { Command } from "commander";
import { brainCommand } from "./brain.js";
import { conventionsCommand } from "./conventions.js";
import { worktreeCommand } from "./worktree.js";
import { prCommand } from "./pr.js";
import { setupCommand } from "./setup.js";
import { render } from "ink";
import React from "react";
import { App } from "../tui/App.js";
import { SetupWizard } from "../tui/setup/SetupWizard.js";
import { loadConfig, globalConfigPath } from "../config/settings.js";
import { initStdinFilter, cleanupStdinFilter } from "../tui/stdinFilter.js";
import { access } from "fs/promises";

async function runInitCommand(opts: { status?: boolean; clear?: boolean; check?: boolean; batch?: string }, deprecatedAlias = false) {
    if (deprecatedAlias) {
        console.warn("Warning: 'mygit index' is deprecated. Use 'mygit init' instead.");
    }

    const { openProjectDatabase } = await import("../storage/database.js");
    const { createChatModel } = await import("../llm/providers.js");
    const { ProjectIndexer } = await import("../context/indexer.js");
    const { compileKnowledgeStore } = await import("../knowledge/compiler.js");
    const {
        clearKnowledgeStore,
        ensureRepoLocalStateIgnored,
        getKnowledgeStatus,
        writeKnowledgeStore,
    } = await import("../knowledge/store.js");

    const repoRoot = process.cwd();
    const config = await loadConfig();
    const db = openProjectDatabase();

    try {
        if (opts.clear) {
            db.clearContextIndex();
            await clearKnowledgeStore(repoRoot);
            console.log("Index and knowledge store cleared.");
            return;
        }

        const model = createChatModel(config);
        const indexer = new ProjectIndexer(db, model);

        if (opts.status || opts.check) {
            const stats = indexer.getStats();
            const knowledge = await getKnowledgeStatus(repoRoot);
            console.log(`Indexed files: ${stats.totalFiles}`);
            console.log(`Total chunks:  ${stats.totalChunks}`);
            console.log(`Last indexed:  ${stats.lastIndexed ? new Date(stats.lastIndexed).toLocaleString() : "never"}`);
            console.log(`Knowledge store: ${knowledge.present ? "present" : "missing"}`);
            console.log(`Shard count:    ${knowledge.shardCount}`);
            console.log(`Last compiled:  ${knowledge.generatedAt ? new Date(knowledge.generatedAt).toLocaleString() : "never"}`);

            // Staleness report
            if (knowledge.present) {
                const { loadKnowledgeManifest } = await import("../knowledge/store.js");
                const { checkKnowledgeStaleness } = await import("../harness/staleness.js");
                const manifest = await loadKnowledgeManifest(repoRoot);
                if (manifest) {
                    const report = await checkKnowledgeStaleness(repoRoot, manifest);
                    const icon = report.overall === "fresh" ? "✅" : report.overall === "aging" ? "⚠️" : "❌";
                    console.log(`\nStaleness:  ${icon} ${report.overall} (${report.commitsSinceCompile} commits, ${report.daysSinceCompile}d since compile)`);
                    if (report.shardReports.length > 0) {
                        for (const sr of report.shardReports) {
                            console.log(`  ${sr.id}: ${sr.missingSourcePaths.length} missing source path(s)`);
                        }
                    }
                    console.log(report.recommendation);
                }
            }
            return;
        }

        console.log("Indexing project files...");
        const results = await indexer.index(repoRoot, {
            batchSize: parseInt(opts.batch ?? "100", 10) || 100,
        }, (result) => {
            const icon = result.status === "indexed" ? "+" : result.status === "skipped" ? "=" : "!";
            if (result.status !== "skipped") {
                console.log(`  [${icon}] ${result.filePath} (${result.chunks} chunks)`);
            }
        });

        const indexed = results.filter((result) => result.status === "indexed").length;
        const skipped = results.filter((result) => result.status === "skipped").length;
        const errors = results.filter((result) => result.status === "error").length;
        console.log(`\nDone: ${indexed} indexed, ${skipped} unchanged, ${errors} errors.`);

        const compiled = await compileKnowledgeStore({ repoRoot, db });
        const knowledgeResult = await writeKnowledgeStore(repoRoot, compiled);
        await ensureRepoLocalStateIgnored(repoRoot);

        const stats = indexer.getStats();
        console.log(`Total: ${stats.totalFiles} files, ${stats.totalChunks} chunks.`);
        console.log(`Knowledge: ${knowledgeResult.shardCount} shards compiled.`);
        if (knowledgeResult.warning) {
            console.warn(`Warning: ${knowledgeResult.warning}`);
        }
    } finally {
        db.close();
    }
}

export function registerCommands(program: Command) {
    // TUI (Default)
    program
        .command("tui", { isDefault: true })
        .description("Launch the interactive TUI")
        .option("-m, --model <model>", "Override the AI model")
        .action(async (opts) => {
            // Redirect to setup wizard if no global config exists yet
            const configExists = await access(globalConfigPath()).then(() => true).catch(() => false);
            if (!configExists) {
                const filter = initStdinFilter(process.stdin, process.stdout, false);
                const ink = render(React.createElement(SetupWizard, { scope: "global" }), {
                    stdin: filter as unknown as NodeJS.ReadStream,
                    exitOnCtrlC: true,
                });
                try {
                    await ink.waitUntilExit();
                } finally {
                    cleanupStdinFilter();
                }
                return;
            }

            const config = await loadConfig();
            if (opts.model) {
                if (config.provider === "ollama") {
                    config.ollama.model = opts.model;
                } else if (config.provider === "google") {
                    config.google.model = opts.model;
                }
            }

            const filter = initStdinFilter(
                process.stdin,
                process.stdout,
                config.ui.mouseEnabled,
            );

            const ink = render(React.createElement(App, { config }), {
                stdin: filter as unknown as NodeJS.ReadStream,
                exitOnCtrlC: true,
            });

            try {
                await ink.waitUntilExit();
            } finally {
                cleanupStdinFilter();
            }
        });

    // Brain (Context Manager)
    program.addCommand(brainCommand());

    // Conventions
    program.addCommand(conventionsCommand());

    // Worktree management
    program.addCommand(worktreeCommand());

    // PR review
    program.addCommand(prCommand());

    // Setup wizard
    program.addCommand(setupCommand());

    // Config (subcommands: show, init, edit)
    const configCmd = program
        .command("config")
        .description("Manage mygit configuration");

    configCmd
        .command("show")
        .description("Show current configuration as JSON")
        .action(async () => {
            const config = await loadConfig();
            console.log(JSON.stringify(config, null, 2));
        });

    configCmd
        .command("init")
        .description("Generate a default config file")
        .option("--local", "Write to repo-local .mygit/config.toml instead of global")
        .action(async (opts) => {
            const {
                defaultConfig,
                saveConfig,
                globalConfigPath,
                repoConfigPath,
            } = await import("../config/settings.js");

            const targetPath = opts.local ? repoConfigPath() : globalConfigPath();
            const config = defaultConfig();
            await saveConfig(config, targetPath);
            console.log(`Config written to ${targetPath}`);
        });

    configCmd
        .command("edit")
        .description("Open config file in $EDITOR")
        .option("--local", "Edit repo-local .mygit/config.toml instead of global")
        .action(async (opts) => {
            const { globalConfigPath, repoConfigPath } = await import(
                "../config/settings.js"
            );
            const { execa } = await import("execa");

            const targetPath = opts.local ? repoConfigPath() : globalConfigPath();
            const editor = process.env.EDITOR || "vi";

            try {
                await execa(editor, [targetPath], { stdio: "inherit" });
            } catch (e: any) {
                console.error(`Failed to open editor: ${e.message}`);
            }
        });

    // Init (RAG context indexing) — also registered as hidden "index" alias below
    program
        .command("init")
        .description("Initialize project index and AGENTS knowledge map")
        .option("--status", "Show index statistics and staleness report")
        .option("--check", "Check knowledge staleness without recompiling")
        .option("--clear", "Clear the project index")
        .option("--batch <n>", "Max files to index per run", "100")
        .action(async (opts) => {
            await runInitCommand(opts, false);
        });

    // Deprecated alias: "index" → "init"
    program
        .command("index", { hidden: true })
        .description("[deprecated] Use 'mygit init' instead")
        .option("--status", "Show index statistics")
        .option("--clear", "Clear the project index")
        .option("--batch <n>", "Max files to index per run", "100")
        .action(async (opts) => {
            await runInitCommand(opts, true);
        });

    // Check
    program
        .command("check")
        .description("Check LLM provider connection")
        .action(async () => {
            const { detectAllProviders } = await import("../llm/providers.js");
            const providers = await detectAllProviders();

            for (const p of providers) {
                const status = p.available ? "✅" : "❌";
                console.log(`${status} ${p.provider}${p.error ? ` (${p.error})` : ""}`);
            }

            // Check GitHub token
            const config = await loadConfig();
            const { createGitHubClient } = await import("../github/auth.js");
            try {
                const client = await createGitHubClient(config.github);
                const { login } = await client.checkAuth();
                console.log(`✅ github (authenticated as @${login})`);
            } catch (err: any) {
                if (String(err?.name) === "GitHubAuthError") {
                    console.log(`⚠️  github (not authenticated — run 'gh auth login --web' or set GITHUB_TOKEN)`);
                } else {
                    console.log(`❌ github (token invalid or no network)`);
                }
            }
        });
}
