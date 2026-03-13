/**
 * Merge conflict differ — ported from Rust src/merge/differ.rs
 *
 * Computes line-level diffs between ours/theirs with character-level spans
 * for changed lines. Uses the `diff` npm package (replacing Rust's `similar` crate).
 */

import { diffLines, diffChars } from "diff";
import type { HunkDiff, LineDiff, DiffSpan } from "./types.js";

/**
 * Compute a line-level diff between ours and theirs,
 * with character-level detail for changed lines.
 */
export function diffHunks(ours: string[], theirs: string[]): HunkDiff {
    const oldText = ours.join("\n");
    const newText = theirs.join("\n");

    const changes = diffLines(oldText, newText);
    const linePairs: LineDiff[] = [];

    let i = 0;
    while (i < changes.length) {
        const change = changes[i];

        if (!change.added && !change.removed) {
            // Equal lines
            const eqLines = splitIntoNonEmpty(change.value);
            for (const line of eqLines) {
                linePairs.push({ type: "equal", text: line });
            }
            i++;
        } else if (change.removed) {
            // Look ahead for a paired addition (changed line)
            const next = changes[i + 1];
            if (next && next.added) {
                // Pair deletions with additions line-by-line
                const oldLines = splitIntoNonEmpty(change.value);
                const newLines = splitIntoNonEmpty(next.value);
                const maxLen = Math.max(oldLines.length, newLines.length);

                for (let j = 0; j < maxLen; j++) {
                    const oldLine = oldLines[j];
                    const newLine = newLines[j];

                    if (oldLine !== undefined && newLine !== undefined) {
                        const [oldSpans, newSpans] = diffLinesCharLevel(oldLine, newLine);
                        linePairs.push({ type: "changed", oldSpans, newSpans });
                    } else if (oldLine !== undefined) {
                        linePairs.push({ type: "only_old", text: oldLine });
                    } else if (newLine !== undefined) {
                        linePairs.push({ type: "only_new", text: newLine });
                    }
                }
                i += 2;
            } else {
                // Pure deletion
                for (const line of splitIntoNonEmpty(change.value)) {
                    linePairs.push({ type: "only_old", text: line });
                }
                i++;
            }
        } else {
            // Pure addition
            for (const line of splitIntoNonEmpty(change.value)) {
                linePairs.push({ type: "only_new", text: line });
            }
            i++;
        }
    }

    return { linePairs };
}

/**
 * Compute character-level diff between two lines.
 * Returns [oldSpans, newSpans].
 */
export function diffLinesCharLevel(
    oldLine: string,
    newLine: string,
): [DiffSpan[], DiffSpan[]] {
    const changes = diffChars(oldLine, newLine);

    const oldSpans: DiffSpan[] = [];
    const newSpans: DiffSpan[] = [];

    for (const change of changes) {
        if (!change.added && !change.removed) {
            oldSpans.push({ text: change.value, tag: "equal" });
            newSpans.push({ text: change.value, tag: "equal" });
        } else if (change.removed) {
            oldSpans.push({ text: change.value, tag: "removed" });
        } else {
            newSpans.push({ text: change.value, tag: "added" });
        }
    }

    return [oldSpans, newSpans];
}

// ── Helpers ────────────────────────────────────────────────────────────

function splitIntoNonEmpty(text: string): string[] {
    // Split on newlines but handle trailing newline
    const raw = text.replace(/\n$/, "").split("\n");
    return raw;
}
