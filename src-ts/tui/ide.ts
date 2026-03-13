/**
 * IDE Detection — detects the IDE environment and provides diff integration.
 *
 * Supports VS Code, Cursor, and Antigravity IDEs for opening
 * comparison/diff windows when resolving merge conflicts.
 */

import { execa } from "execa";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// ============================================================================
// TYPES
// ============================================================================

export type IDEEnvironment = "vscode" | "cursor" | "antigravity" | "terminal";

// ============================================================================
// DETECTION
// ============================================================================

export function detectIDE(): IDEEnvironment {
    const env = process.env;

    // Cursor sets its own env vars and TERM_PROGRAM
    if (env.CURSOR_TRACE_ID || env.TERM_PROGRAM === "cursor") return "cursor";

    // VS Code integrated terminal
    if (env.TERM_PROGRAM === "vscode" || env.VSCODE_PID || env.VSCODE_GIT_IPC_HANDLE) return "vscode";

    // Antigravity
    if (env.ANTIGRAVITY_EDITOR || env.TERM_PROGRAM === "antigravity") return "antigravity";

    return "terminal";
}

// ============================================================================
// IDE DIFF COMMANDS
// ============================================================================

function getDiffCLI(ide: IDEEnvironment): string | null {
    switch (ide) {
        case "vscode": return "code";
        case "cursor": return "cursor";
        case "antigravity": return "antigravity";
        default: return null;
    }
}

/**
 * Open a diff comparison window in the detected IDE.
 * Creates a temp file with "theirs" content and opens it alongside the conflicted file.
 */
export async function openIDEDiff(
    filePath: string,
    ide: IDEEnvironment,
): Promise<boolean> {
    const cli = getDiffCLI(ide);
    if (!cli) return false;

    try {
        // Open the conflicted file directly — the IDE's built-in merge editor
        // handles conflict markers (<<<<<<< ======= >>>>>>>)
        await execa(cli, ["--goto", filePath], {
            reject: false,
            timeout: 5_000,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Open the IDE's 3-way merge editor for a conflicted file.
 * Works with VS Code 1.69+ and Cursor which support merge editor natively.
 */
export async function openIDEMergeEditor(
    filePath: string,
    ide: IDEEnvironment,
): Promise<boolean> {
    const cli = getDiffCLI(ide);
    if (!cli) return false;

    try {
        // The --merge flag opens VS Code's built-in 3-way merge editor
        await execa(cli, ["--merge", filePath], {
            reject: false,
            timeout: 5_000,
        });
        return true;
    } catch {
        return false;
    }
}

export function isIDEAvailable(ide: IDEEnvironment): boolean {
    return ide !== "terminal";
}
