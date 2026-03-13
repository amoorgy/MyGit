/**
 * Worktree Manager — ported from Rust src/worktree/manager.rs
 *
 * Wraps `git worktree` commands.
 */

import { execa } from "execa";
import * as fs from "fs/promises";
import * as path from "path";
import type { Worktree, WorktreeOptions } from "./types.js";

export class WorktreeManager {
    /**
     * List all worktrees.
     */
    async list(cwd: string): Promise<Worktree[]> {
        try {
            const { stdout } = await execa("git", ["worktree", "list", "--porcelain"], { cwd });
            return this.parsePorcelain(stdout);
        } catch (error) {
            console.error("Failed to list worktrees:", error);
            return [];
        }
    }

    /**
     * Add a new worktree.
     */
    async add(cwd: string, opts: WorktreeOptions): Promise<void> {
        const args = ["worktree", "add"];
        if (opts.force) args.push("--force");
        if (opts.detach) args.push("--detach");
        if (opts.branch) args.push("-b", opts.branch);

        args.push(opts.path);

        if (opts.base) args.push(opts.base);

        await execa("git", args, { cwd });
    }

    /**
     * Remove a worktree.
     */
    async remove(cwd: string, worktreePath: string, force = false): Promise<void> {
        const args = ["worktree", "remove"];
        if (force) args.push("--force");
        args.push(worktreePath);

        await execa("git", args, { cwd });
    }

    /**
     * Prune stale worktree information.
     */
    async prune(cwd: string): Promise<void> {
        await execa("git", ["worktree", "prune"], { cwd });
    }

    // ── Parser ─────────────────────────────────────────────────────────────

    private parsePorcelain(output: string): Worktree[] {
        const worktrees: Worktree[] = [];
        let current: Partial<Worktree> = {};

        const lines = output.split("\n");

        for (const line of lines) {
            if (!line.trim()) {
                // Empty line separates entries (sometimes)
                if (current.path && current.head) {
                    worktrees.push(this.finalize(current));
                    current = {};
                }
                continue;
            }

            const [key, ...rest] = line.split(" ");
            const value = rest.join(" ");

            if (key === "worktree") {
                // New entry starts with 'worktree'
                if (current.path) {
                    worktrees.push(this.finalize(current));
                }
                current = { path: value };
            } else if (key === "HEAD") {
                current.head = value;
            } else if (key === "branch") {
                current.branch = value.replace("refs/heads/", "");
            } else if (key === "bare") {
                current.isBare = true;
            } else if (key === "detached") {
                current.isDetached = true;
            } else if (key === "locked") {
                current.isLocked = true;
            } else if (key === "prunable") {
                current.prunable = true;
            }
        }

        if (current.path) {
            worktrees.push(this.finalize(current));
        }

        return worktrees;
    }

    private finalize(partial: Partial<Worktree>): Worktree {
        return {
            path: partial.path || "",
            head: partial.head || "",
            branch: partial.branch || (partial.isDetached ? "detached" : (partial.isBare ? "bare" : "unknown")),
            isBare: !!partial.isBare,
            isDetached: !!partial.isDetached,
            isLocked: !!partial.isLocked,
            prunable: !!partial.prunable,
        };
    }
}
