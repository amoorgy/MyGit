/**
 * Merge conflict parser — ported from Rust src/merge/parser.rs
 *
 * Parses <<<<<<< / ======= / >>>>>>> markers from file content.
 * Supports standard and diff3 (|||||||) formats.
 */

import { readFile } from "fs/promises";
import type { ConflictFile, ConflictHunk } from "./types.js";

const MARKER_LEN = 7; // <<<<<<<, =======, >>>>>>>, |||||||

// ── State Machine ──────────────────────────────────────────────────────

enum State {
    Normal,
    InOurs,
    InBase,
    InTheirs,
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Parse a file on disk for merge conflicts.
 */
export async function parseConflictFile(path: string): Promise<ConflictFile> {
    const content = await readFile(path, "utf-8");
    const hunks = parseConflicts(content);
    return {
        path,
        hunks,
        totalLines: content.split("\n").length,
    };
}

/**
 * Parse conflict markers from a string.
 * Returns empty array if no conflicts found.
 */
export function parseConflicts(content: string): ConflictHunk[] {
    const lines = content.split("\n");
    const hunks: ConflictHunk[] = [];
    let state = State.Normal;
    let hunkId = 0;

    // Accumulation state
    let lineStart = 0;
    let oursLabel: string | null = null;
    let ours: string[] = [];
    let base: string[] | null = null;
    let theirs: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1; // 1-based

        switch (state) {
            case State.Normal:
                if (isOursMarker(line)) {
                    state = State.InOurs;
                    lineStart = lineNum;
                    oursLabel = extractLabel(line, MARKER_LEN);
                    ours = [];
                    base = null;
                    theirs = [];
                }
                break;

            case State.InOurs:
                if (isBaseMarker(line)) {
                    state = State.InBase;
                    base = [];
                } else if (isSeparator(line)) {
                    state = State.InTheirs;
                } else {
                    ours.push(line);
                }
                break;

            case State.InBase:
                if (isSeparator(line)) {
                    state = State.InTheirs;
                } else {
                    base!.push(line);
                }
                break;

            case State.InTheirs:
                if (isTheirsMarker(line)) {
                    const theirsLabel = extractLabel(line, MARKER_LEN);
                    hunks.push({
                        id: hunkId,
                        lineStart,
                        lineEnd: lineNum,
                        ours: [...ours],
                        oursLabel,
                        base: base ? [...base] : null,
                        theirs: [...theirs],
                        theirsLabel,
                        resolution: null,
                    });
                    hunkId++;
                    state = State.Normal;
                    ours = [];
                    theirs = [];
                    oursLabel = null;
                } else {
                    theirs.push(line);
                }
                break;
        }
    }

    return hunks;
}

// ── Marker Detection ───────────────────────────────────────────────────

function isOursMarker(line: string): boolean {
    return (
        line.startsWith("<<<<<<<") &&
        (line.length === MARKER_LEN || line[MARKER_LEN] === " ")
    );
}

function isTheirsMarker(line: string): boolean {
    return (
        line.startsWith(">>>>>>>") &&
        (line.length === MARKER_LEN || line[MARKER_LEN] === " ")
    );
}

function isSeparator(line: string): boolean {
    return line === "=======";
}

function isBaseMarker(line: string): boolean {
    return (
        line.startsWith("|||||||") &&
        (line.length === MARKER_LEN || line[MARKER_LEN] === " ")
    );
}

function extractLabel(line: string, prefixLen: number): string | null {
    const rest = line.slice(prefixLen).trim();
    return rest.length > 0 ? rest : null;
}
