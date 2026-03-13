import { Command } from "commander";
import { WorktreeManager } from "../worktree/manager.js";

export function worktreeCommand(): Command {
    const manager = new WorktreeManager();

    const worktree = new Command("worktree")
        .description("Git worktree management");

    // ── list ──────────────────────────────────────────────────────────────

    worktree
        .command("list")
        .description("List all worktrees")
        .action(async () => {
            const cwd = process.cwd();
            const worktrees = await manager.list(cwd);

            if (worktrees.length === 0) {
                console.log("No worktrees found.");
                return;
            }

            // Column widths
            const pathWidth = Math.max(4, ...worktrees.map((w) => w.path.length));
            const branchWidth = Math.max(6, ...worktrees.map((w) => w.branch.length));

            const header = [
                "PATH".padEnd(pathWidth),
                "BRANCH".padEnd(branchWidth),
                "STATUS",
            ].join("  ");

            console.log(header);
            console.log("-".repeat(header.length));

            for (const wt of worktrees) {
                const flags: string[] = [];
                if (wt.isBare) flags.push("bare");
                if (wt.isDetached) flags.push("detached");
                if (wt.isLocked) flags.push("locked");
                if (wt.prunable) flags.push("prunable");
                const status = flags.length > 0 ? flags.join(", ") : "clean";

                const row = [
                    wt.path.padEnd(pathWidth),
                    wt.branch.padEnd(branchWidth),
                    status,
                ].join("  ");

                console.log(row);
            }
        });

    // ── add ───────────────────────────────────────────────────────────────

    worktree
        .command("add <branch>")
        .description("Add a new worktree")
        .option("-p, --path <path>", "Worktree directory path (defaults to branch name)")
        .option("-b", "Create a new branch")
        .option("--base <base>", "Base commit or branch for the new worktree")
        .option("--force", "Force creation even if branch is checked out elsewhere")
        .option("--detach", "Create worktree in detached HEAD state")
        .action(async (branch: string, opts) => {
            const cwd = process.cwd();
            const worktreePath = opts.path || branch;
            const createNewBranch = !!opts.b;

            try {
                await manager.add(cwd, {
                    path: worktreePath,
                    // -b: create new branch with this name
                    branch: createNewBranch ? branch : undefined,
                    // Without -b: check out existing branch (passed as base positional arg)
                    // With -b: optional --base is the starting point for the new branch
                    base: createNewBranch ? opts.base : branch,
                    force: opts.force,
                    detach: opts.detach,
                });
                console.log(`Worktree added at '${worktreePath}'${createNewBranch ? ` on new branch '${branch}'` : ` tracking '${branch}'`}.`);
            } catch (error: any) {
                console.error(`Failed to add worktree: ${error.message || error}`);
                process.exitCode = 1;
            }
        });

    // ── remove ────────────────────────────────────────────────────────────

    worktree
        .command("remove <path>")
        .description("Remove a worktree")
        .option("--force", "Force removal even with uncommitted changes")
        .action(async (worktreePath: string, opts) => {
            const cwd = process.cwd();

            try {
                await manager.remove(cwd, worktreePath, opts.force);
                console.log(`Worktree at '${worktreePath}' removed.`);
            } catch (error: any) {
                console.error(`Failed to remove worktree: ${error.message || error}`);
                process.exitCode = 1;
            }
        });

    // ── prune ─────────────────────────────────────────────────────────────

    worktree
        .command("prune")
        .description("Prune stale worktree information")
        .action(async () => {
            const cwd = process.cwd();

            try {
                await manager.prune(cwd);
                console.log("Stale worktree information pruned.");
            } catch (error: any) {
                console.error(`Failed to prune worktrees: ${error.message || error}`);
                process.exitCode = 1;
            }
        });

    return worktree;
}
