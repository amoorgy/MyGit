/**
 * Merge conflict resolver — ported from Rust src/merge/resolver.rs
 *
 * Applies resolutions to conflict hunks and writes resolved content.
 */

import { readFile, writeFile } from "fs/promises";
import { execa } from "execa";
import type { ConflictFile, ConflictHunk, Resolution } from "./types.js";

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Resolve a single hunk by applying the given resolution.
 * Returns the resolved lines.
 */
export function resolveHunk(hunk: ConflictHunk, resolution: Resolution): string[] {
    switch (resolution.type) {
        case "accept_ours":
            return [...hunk.ours];
        case "accept_theirs":
            return [...hunk.theirs];
        case "accept_both":
            return resolution.oursFirst
                ? [...hunk.ours, ...hunk.theirs]
                : [...hunk.theirs, ...hunk.ours];
        case "custom":
            return [...resolution.lines];
        case "smart":
            return [...resolution.resolution.lines];
    }
}

/**
 * Apply all resolutions in a ConflictFile and return the resolved file content.
 * Hunks without a resolution are left as conflict markers.
 */
export function applyResolution(originalContent: string, file: ConflictFile): string {
    const lines = originalContent.split("\n");
    const result: string[] = [];
    let skipUntil: number | null = null;

    // Build lookup: lineStart (1-based) → hunk index
    const hunkMap = new Map<number, number>();
    for (let idx = 0; idx < file.hunks.length; idx++) {
        hunkMap.set(file.hunks[idx].lineStart, idx);
    }

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1; // 1-based

        // If we're skipping lines inside a resolved conflict block
        if (skipUntil !== null) {
            if (lineNum <= skipUntil) {
                continue;
            } else {
                skipUntil = null;
            }
        }

        const hunkIdx = hunkMap.get(lineNum);
        if (hunkIdx !== undefined) {
            const hunk = file.hunks[hunkIdx];
            if (hunk.resolution) {
                // Replace entire conflict block with resolved lines
                const resolved = resolveHunk(hunk, hunk.resolution);
                result.push(...resolved);
                skipUntil = hunk.lineEnd;
            } else {
                // No resolution — keep original conflict markers
                result.push(lines[i]);
            }
        } else {
            result.push(lines[i]);
        }
    }

    // Preserve trailing newline if original had one
    let output = result.join("\n");
    if (originalContent.endsWith("\n") && !output.endsWith("\n")) {
        output += "\n";
    }
    return output;
}

/**
 * Write the resolved content back to disk.
 */
export async function resolveFile(file: ConflictFile): Promise<void> {
    const original = await readFile(file.path, "utf-8");
    const resolved = applyResolution(original, file);
    await writeFile(file.path, resolved, "utf-8");
}

/**
 * Find all files with unresolved conflicts in the current git repo.
 */
export async function listConflictedFiles(cwd?: string): Promise<string[]> {
    try {
        const { stdout } = await execa("git", ["diff", "--name-only", "--diff-filter=U"], {
            cwd: cwd ?? process.cwd(),
        });
        return stdout
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
    } catch {
        return [];
    }
}

/**
 * Resolve all conflicts in a file accepting one side.
 */
export async function resolveAllWith(
    path: string,
    acceptOurs: boolean,
): Promise<void> {
    const { parseConflictFile } = await import("./parser.js");
    const file = await parseConflictFile(path);
    const resolution: Resolution = acceptOurs
        ? { type: "accept_ours" }
        : { type: "accept_theirs" };

    for (const hunk of file.hunks) {
        hunk.resolution = resolution;
    }

    await resolveFile(file);
}
