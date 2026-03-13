import { execa } from "execa";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

export interface CapturedContext {
    branch: string;
    gitStatus: string;
    gitDiff: string;
    activeFiles: string[];
    terminalHistory: string;
}

export async function captureContext(): Promise<CapturedContext> {
    function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
        return Promise.race([
            p,
            new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
        ]);
    }

    const gitStatusP = withTimeout(getGitStatus(), 3000, "");
    const activeFilesP = gitStatusP.then(parseActiveFiles);
    const branchP = withTimeout(getGitBranch(), 2000, "unknown");
    const gitDiffP = withTimeout(getGitDiff(), 5000, "");
    const terminalP = withTimeout(getTerminalHistory(50), 2000, "No shell history available.");

    const [branch, gitStatus, gitDiff, terminalHistory, activeFiles] = await Promise.all([
        branchP,
        gitStatusP,
        gitDiffP,
        terminalP,
        activeFilesP,
    ]);

    return { branch, gitStatus, gitDiff, activeFiles, terminalHistory };
}

async function getGitBranch(): Promise<string> {
    try {
        const { stdout } = await execa("git", ["branch", "--show-current"]);
        return stdout.trim();
    } catch {
        return "unknown";
    }
}

async function getGitStatus(): Promise<string> {
    try {
        const { stdout } = await execa("git", ["status", "-s"]);
        return stdout;
    } catch {
        return "";
    }
}

async function getGitDiff(): Promise<string> {
    try {
        const { stdout } = await execa("git", ["diff", "HEAD"]);
        return stdout;
    } catch {
        try {
            // Fallback if no HEAD (new repo)
            const { stdout } = await execa("git", ["diff"]);
            return stdout;
        } catch {
            return "";
        }
    }
}

function parseActiveFiles(statusOutput: string): string[] {
    const lines = statusOutput.split('\n');
    const files: string[] = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        // git status -s format: " M path/to/file"
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
            files.push(parts.slice(1).join(' ')); // Handle spaces in filenames
        }
    }
    return files;
}

async function getTerminalHistory(linesCount: number): Promise<string> {
    const home = os.homedir();
    const shells = [
        path.join(home, ".zsh_history"),
        path.join(home, ".bash_history"),
    ];

    for (const shellHistoryPath of shells) {
        try {
            const content = await fs.readFile(shellHistoryPath, "utf-8");
            // Basic extraction: split by newline/semicolon for zsh/bash formats
            const lines = content.split('\n')
                .filter(l => l.trim().length > 0)
                .map(l => {
                    // Quick strip of zsh timestamps e.g., ": 1700000000:0;ls"
                    if (l.startsWith(':') && l.includes(';')) {
                        return l.split(';').slice(1).join(';');
                    }
                    return l;
                });
            return lines.slice(-linesCount).join('\n');
        } catch {
            continue; // Try next shell
        }
    }

    return "No shell history available.";
}
