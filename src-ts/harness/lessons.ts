/**
 * Failure Feedback Loops — .mygit/LESSONS.md
 *
 * Captures cross-session lessons from agent failures so future sessions
 * don't repeat the same mistakes. Implements the core harness engineering
 * insight: when the agent fails, the environment should get smarter.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { Observation } from "../agent/context.js";

const LESSONS_FILE = "LESSONS.md";
const MAX_FILE_CHARS = 2000;

export interface FailureState {
    request: string;
    done: boolean;
    iteration: number;
    maxIterations: number;
    parseFailures: number;
    repeatCount: number;
    lastActionSignature: string;
    observations: Observation[];
}

function lessonsPath(repoRoot: string): string {
    return path.join(repoRoot, ".mygit", LESSONS_FILE);
}

function timestamp(): string {
    return new Date().toISOString().slice(0, 10);
}

function requestPrefix(request: string): string {
    const trimmed = request.trim().replace(/\n/g, " ");
    return trimmed.length > 80 ? trimmed.slice(0, 77) + "..." : trimmed;
}

function detectFailures(state: FailureState): string[] {
    const lessons: string[] = [];

    // Signal 1: Iteration limit exhaustion
    if (!state.done && state.iteration >= state.maxIterations) {
        lessons.push(
            `Agent exhausted iteration limit (${state.maxIterations}) without completing the task. ` +
            `The request may be too broad or the context insufficient.`,
        );
    }

    // Signal 2: Repeated loop guard kills (3+ repeats of same action)
    if (state.repeatCount >= 3) {
        const action = state.lastActionSignature || "unknown action";
        lessons.push(
            `Loop guard killed repeated action: "${action}". ` +
            `The agent could not make progress — consider restructuring the task or adding a targeted knowledge shard.`,
        );
    }

    // Signal 3: Parse failure exhaustion
    if (state.parseFailures >= 3) {
        lessons.push(
            `Agent hit parse failure limit (${state.parseFailures}). ` +
            `LLM output was repeatedly unparseable — may indicate a prompt formatting issue.`,
        );
    }

    // Signal 4: Consecutive execution failures (3+ with same action type)
    const obs = state.observations;
    if (obs.length >= 3) {
        let consecutiveFails = 0;
        let failActionType = "";
        for (let i = obs.length - 1; i >= 0; i--) {
            if (!obs[i].success) {
                consecutiveFails++;
                if (!failActionType) {
                    failActionType = obs[i].action.split(" ")[0] || "unknown";
                }
            } else {
                break;
            }
        }
        if (consecutiveFails >= 3) {
            lessons.push(
                `${consecutiveFails} consecutive "${failActionType}" failures at end of session. ` +
                `The agent was stuck on a failing action pattern.`,
            );
        }
    }

    return lessons;
}

function formatLesson(request: string, lesson: string): string {
    return `- **${timestamp()}** [${requestPrefix(request)}]: ${lesson}`;
}

function capFileContent(existing: string, newEntries: string[]): string {
    const allLines = existing.trim()
        ? [...existing.trim().split("\n"), ...newEntries]
        : ["# Lessons", "", ...newEntries];

    let result = allLines.join("\n");

    // Drop oldest entries (after header) to stay within budget
    while (result.length > MAX_FILE_CHARS && allLines.length > 3) {
        // Remove the first entry after the header
        allLines.splice(2, 1);
        result = allLines.join("\n");
    }

    return result + "\n";
}

export async function captureFailureLessons(
    state: FailureState,
    repoRoot: string,
): Promise<void> {
    const failures = detectFailures(state);
    if (failures.length === 0) return;

    const filePath = lessonsPath(repoRoot);
    let existing = "";
    try {
        existing = await fs.readFile(filePath, "utf-8");
    } catch {
        // File doesn't exist yet — will create
    }

    const newEntries = failures.map((f) => formatLesson(state.request, f));
    const content = capFileContent(existing, newEntries);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
}

export async function loadLessons(repoRoot: string): Promise<string | undefined> {
    try {
        const content = await fs.readFile(lessonsPath(repoRoot), "utf-8");
        const trimmed = content.trim();
        return trimmed || undefined;
    } catch {
        return undefined;
    }
}
