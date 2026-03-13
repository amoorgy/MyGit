import * as fs from "fs/promises";
import { writeFileSync, accessSync } from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================================
// TYPES
// ============================================================================

export interface InstallResult {
    binPath: string;
    binDir: string;
    alreadyInPath: boolean;
}

// ============================================================================
// ALIAS INSTALLATION
// ============================================================================

/** Install a `mygit` wrapper script to binDir (default: ~/.local/bin). */
export async function installAliasBin(entryPoint: string, binDir?: string): Promise<InstallResult> {
    const dir = binDir ?? path.join(os.homedir(), ".local", "bin");
    const binPath = path.join(dir, "mygit");

    await fs.mkdir(dir, { recursive: true });

    try {
        await fs.unlink(binPath);
    } catch (err: any) {
        if (err.code !== "ENOENT") throw err;
    }

    const wrapper = `#!/usr/bin/env bash\nexec bun run "${entryPoint}" "$@"\n`;
    writeFileSync(binPath, wrapper, { mode: 0o755 });

    return { binPath, binDir: dir, alreadyInPath: isBinDirInPath(dir) };
}

/** Install a Windows `.cmd` wrapper to %APPDATA%\mygit\. */
export async function installAliasWindows(entryPoint: string): Promise<InstallResult> {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    const dir = path.join(appdata, "mygit");
    const binPath = path.join(dir, "mygit.cmd");

    await fs.mkdir(dir, { recursive: true });
    writeFileSync(binPath, `@echo off\nbun run "${entryPoint}" %*\n`);

    return { binPath, binDir: dir, alreadyInPath: isBinDirInPath(dir) };
}

/** Get the entry point (src-ts/index.tsx) from the calling module's directory. */
export function getEntryPoint(): string {
    const cliDir = import.meta.dir ?? path.join(process.cwd(), "cli");
    const srcTsDir = path.resolve(cliDir, "..", "..");
    return path.join(srcTsDir, "index.tsx");
}

// ============================================================================
// PATH / SHELL PROFILE HELPERS
// ============================================================================

/** True if binDir is already listed in the current PATH. */
export function isBinDirInPath(binDir: string): boolean {
    return (process.env.PATH ?? "").split(path.delimiter).includes(binDir);
}

/**
 * Detect the most likely shell profile to edit.
 * Returns an absolute path, or null if we cannot determine one.
 */
export function detectShellProfile(): string | null {
    const shell = process.env.SHELL ?? "";
    const home = os.homedir();

    if (shell.includes("zsh")) {
        return path.join(home, ".zshrc");
    }

    if (shell.includes("bash")) {
        if (process.platform === "darwin") {
            const bp = path.join(home, ".bash_profile");
            try {
                accessSync(bp);
                return bp;
            } catch {
                // fall through to .bashrc
            }
        }
        return path.join(home, ".bashrc");
    }

    if (shell.includes("fish")) {
        return path.join(home, ".config", "fish", "config.fish");
    }

    return path.join(home, ".profile");
}

/** Append a PATH export line to the given shell profile. */
export async function appendPathExport(profilePath: string, binDir: string): Promise<void> {
    const shell = process.env.SHELL ?? "";
    const exportLine = shell.includes("fish")
        ? `\nfish_add_path ${binDir}\n`
        : `\nexport PATH="${binDir}:$PATH"\n`;

    await fs.appendFile(profilePath, exportLine, "utf-8");
}
