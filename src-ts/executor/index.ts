/**
 * Executor — mirrors Rust `src/executor/`
 *
 * Dispatches action execution to git, shell, and file system handlers.
 */

import { execa } from "execa";
import * as fs from "fs/promises";
import * as path from "path";
import type { AgentAction } from "../agent/protocol.js";

// ============================================================================
// EXECUTION RESULT
// ============================================================================

export interface ExecutionResult {
    success: boolean;
    output: string;
    error?: string;
    kind?: "offline" | "network_fail" | "command_fail" | "push_rejected" | "merge_conflict";
}

function success(output: string): ExecutionResult {
    return { success: true, output };
}

function failure(
    error: string,
    kind: ExecutionResult["kind"] = "command_fail",
): ExecutionResult {
    return { success: false, output: "", error, kind };
}

// ============================================================================
// ACTION DISPATCHER
// ============================================================================

/**
 * Execute an agent action and return the result.
 */
export async function executeAction(action: AgentAction): Promise<ExecutionResult> {
    switch (action.type) {
        case "git":
            return executeGit(action.command);
        case "shell":
            return executeShell(action.command);
        case "read_file":
            return readFileContents(action.path);
        case "write_file":
            return writeFileContents(action.path, action.content);
        case "message":
            return success(action.content);
        case "done":
            return success(action.summary);
        case "respond":
            return success(action.answer);
        case "clarify":
            return success(`Clarifying: ${action.question}`);
        case "plan":
            return success(`Plan with ${action.steps.length} steps`);
        case "fetch_context":
            return success(`Context query: ${action.query}`);
    }
}

/**
 * Dry-run description of what an action would do.
 */
export function dryRun(action: AgentAction): string {
    switch (action.type) {
        case "git":
            return `Would execute: git ${action.command}`;
        case "shell":
            return `Would execute: $ ${action.command}`;
        case "read_file":
            return `Would read: ${action.path}`;
        case "write_file":
            return `Would write: ${action.path}`;
        case "message":
            return `Would output: ${action.content}`;
        case "done":
            return `Would complete: ${action.summary}`;
        case "respond":
            return `Would respond: ${action.answer}`;
        case "clarify":
            return `Would ask: ${action.question}`;
        case "plan":
            return `Would plan ${action.steps.length} steps`;
        case "fetch_context":
            return `Would fetch context: ${action.query}`;
    }
}

// ============================================================================
// GIT EXECUTOR
// ============================================================================

async function executeGit(command: string): Promise<ExecutionResult> {
    try {
        const result = await execa(`git ${command.trim()}`, {
            shell: true,
            reject: false,
            timeout: 30_000,
        });

        if (result.exitCode === 0) {
            return success(result.stdout || "(no output)");
        }

        const stderr = result.stderr || `Exit code: ${result.exitCode}`;
        const trimmedCmd = command.trim().toLowerCase();

        if (trimmedCmd.startsWith("push") && isPushRejected(stderr)) {
            return failure(stderr, "push_rejected");
        }

        if (hasMergeConflictMarkers(stderr)) {
            return failure(stderr, "merge_conflict");
        }

        return failure(stderr);
    } catch (err: any) {
        return failure(err.message ?? "Git command failed");
    }
}

export function isPushRejected(stderr: string): boolean {
    const lower = stderr.toLowerCase();
    return (
        lower.includes("non-fast-forward") ||
        lower.includes("fetch first") ||
        lower.includes("updates were rejected") ||
        lower.includes("failed to push some refs") ||
        lower.includes("[rejected]") ||
        lower.includes("[remote rejected]")
    );
}

export function hasMergeConflictMarkers(output: string): boolean {
    const lower = output.toLowerCase();
    return (
        lower.includes("automatic merge failed") ||
        lower.includes("fix conflicts and then commit") ||
        lower.includes("merge conflict in") ||
        lower.includes("conflict (content)")
    );
}

// ============================================================================
// SHELL EXECUTOR
// ============================================================================

async function executeShell(command: string): Promise<ExecutionResult> {
    try {
        const result = await execa(command, {
            shell: true,
            reject: false,
            timeout: 60_000,
        });

        if (result.exitCode === 0) {
            return success(result.stdout || "(no output)");
        } else {
            return normalizeShellFailure(
                command,
                result.stderr || `Exit code: ${result.exitCode}`,
            );
        }
    } catch (err: any) {
        return normalizeShellFailure(command, err.message ?? "Shell command failed");
    }
}

export function isLikelyExternalFetchShellCommand(command: string): boolean {
    const trimmed = command.trim().toLowerCase();
    return (
        trimmed.startsWith("curl ") ||
        trimmed === "curl" ||
        trimmed.startsWith("wget ") ||
        trimmed === "wget" ||
        trimmed.includes("http://") ||
        trimmed.includes("https://")
    );
}

export function normalizeShellFailure(command: string, rawError: string): ExecutionResult {
    if (!isLikelyExternalFetchShellCommand(command)) {
        return failure(rawError, "command_fail");
    }

    const text = rawError || "External fetch command failed";
    const lower = text.toLowerCase();

    const isOfflineLike =
        lower.includes("could not resolve host") ||
        lower.includes("failed to connect") ||
        lower.includes("connection refused") ||
        lower.includes("timed out") ||
        lower.includes("network is unreachable") ||
        lower.includes("enotfound") ||
        lower.includes("eai_again");

    const isPageUnavailable =
        lower.includes("404") ||
        lower.includes("403") ||
        lower.includes("not found") ||
        lower.includes("forbidden");

    const summary = isOfflineLike
        ? "External fetch unavailable (network/offline)."
        : isPageUnavailable
            ? "External page fetch failed (page unavailable or blocked)."
            : "External fetch failed.";

    const hint = "Continue with local repo inspection and best-effort analysis.";

    return failure(`${summary} ${hint}${text ? `\n${text}` : ""}`, isOfflineLike ? "offline" : "network_fail");
}

// ============================================================================
// FILE SYSTEM EXECUTOR
// ============================================================================

const MAX_FILE_SIZE = 50_000;

async function readFileContents(filePath: string): Promise<ExecutionResult> {
    try {
        let content = await fs.readFile(filePath, "utf-8");
        if (content.length > MAX_FILE_SIZE) {
            content = content.substring(0, MAX_FILE_SIZE) + "\n... (file truncated, showing first 50KB)";
        }
        return success(content);
    } catch (err: any) {
        return failure(`Failed to read ${filePath}: ${err.message}`);
    }
}

async function writeFileContents(filePath: string, content: string): Promise<ExecutionResult> {
    try {
        // Ensure parent directory exists
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");
        return success(`Wrote to ${filePath}`);
    } catch (err: any) {
        return failure(`Failed to write ${filePath}: ${err.message}`);
    }
}
