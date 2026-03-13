import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { captureFailureLessons, loadLessons, type FailureState } from "./lessons.js";

function makeState(overrides: Partial<FailureState> = {}): FailureState {
    return {
        request: "refactor the auth module",
        done: true,
        iteration: 3,
        maxIterations: 15,
        parseFailures: 0,
        repeatCount: 0,
        lastActionSignature: "",
        observations: [],
        ...overrides,
    };
}

function makeObs(action: string, success: boolean) {
    return { action, output: "", success, timestamp: Date.now() };
}

describe("lessons", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mygit-lessons-"));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe("captureFailureLessons", () => {
        it("does nothing when task completed successfully", async () => {
            await captureFailureLessons(makeState({ done: true }), tmpDir);
            const result = await loadLessons(tmpDir);
            expect(result).toBeUndefined();
        });

        it("captures iteration limit exhaustion", async () => {
            await captureFailureLessons(
                makeState({ done: false, iteration: 15, maxIterations: 15 }),
                tmpDir,
            );
            const result = await loadLessons(tmpDir);
            expect(result).toContain("exhausted iteration limit");
            expect(result).toContain("15");
        });

        it("captures loop guard repeat kills", async () => {
            await captureFailureLessons(
                makeState({ repeatCount: 3, lastActionSignature: "read_file src/foo.ts" }),
                tmpDir,
            );
            const result = await loadLessons(tmpDir);
            expect(result).toContain("Loop guard");
            expect(result).toContain("read_file src/foo.ts");
        });

        it("captures parse failure exhaustion", async () => {
            await captureFailureLessons(
                makeState({ parseFailures: 3 }),
                tmpDir,
            );
            const result = await loadLessons(tmpDir);
            expect(result).toContain("parse failure limit");
        });

        it("captures consecutive execution failures", async () => {
            const observations = [
                makeObs("shell echo ok", true),
                makeObs("shell npm test", false),
                makeObs("shell npm test", false),
                makeObs("shell npm test", false),
            ];
            await captureFailureLessons(
                makeState({ observations }),
                tmpDir,
            );
            const result = await loadLessons(tmpDir);
            expect(result).toContain('consecutive "shell" failures');
        });

        it("does not trigger on fewer than 3 consecutive failures", async () => {
            const observations = [
                makeObs("shell npm test", false),
                makeObs("shell npm test", false),
            ];
            await captureFailureLessons(
                makeState({ observations }),
                tmpDir,
            );
            const result = await loadLessons(tmpDir);
            expect(result).toBeUndefined();
        });

        it("creates .mygit directory if it doesn't exist", async () => {
            await captureFailureLessons(
                makeState({ done: false, iteration: 15, maxIterations: 15 }),
                tmpDir,
            );
            const stat = await fs.stat(path.join(tmpDir, ".mygit"));
            expect(stat.isDirectory()).toBe(true);
        });

        it("appends to existing lessons file", async () => {
            // First failure
            await captureFailureLessons(
                makeState({ done: false, iteration: 15, maxIterations: 15 }),
                tmpDir,
            );
            // Second failure
            await captureFailureLessons(
                makeState({ parseFailures: 4, request: "fix the build" }),
                tmpDir,
            );
            const result = await loadLessons(tmpDir);
            expect(result).toContain("exhausted iteration limit");
            expect(result).toContain("parse failure limit");
            expect(result).toContain("fix the build");
        });

        it("truncates long request prefixes to 80 chars", async () => {
            const longRequest = "a".repeat(200);
            await captureFailureLessons(
                makeState({ done: false, iteration: 15, maxIterations: 15, request: longRequest }),
                tmpDir,
            );
            const result = (await loadLessons(tmpDir))!;
            // Should end with "..." and not contain the full 200-char string
            expect(result).toContain("...");
            expect(result).not.toContain("a".repeat(200));
        });

        it("caps file content at 2000 chars by dropping oldest entries", async () => {
            // Write many failures to exceed the 2000 char budget
            for (let i = 0; i < 30; i++) {
                await captureFailureLessons(
                    makeState({
                        done: false,
                        iteration: 15,
                        maxIterations: 15,
                        request: `task number ${i} with some padding text to make it longer`,
                    }),
                    tmpDir,
                );
            }
            const filePath = path.join(tmpDir, ".mygit", "LESSONS.md");
            const raw = await fs.readFile(filePath, "utf-8");
            expect(raw.length).toBeLessThanOrEqual(2100); // small margin for final newline
            // Should still have the header
            expect(raw).toContain("# Lessons");
            // Later entries should survive, early ones may be dropped
            expect(raw).toContain("task number 29");
        });

        it("captures multiple failure signals in one call", async () => {
            await captureFailureLessons(
                makeState({
                    done: false,
                    iteration: 15,
                    maxIterations: 15,
                    parseFailures: 5,
                    repeatCount: 4,
                    lastActionSignature: "fetch_context",
                }),
                tmpDir,
            );
            const result = (await loadLessons(tmpDir))!;
            expect(result).toContain("exhausted iteration limit");
            expect(result).toContain("parse failure limit");
            expect(result).toContain("Loop guard");
        });
    });

    describe("loadLessons", () => {
        it("returns undefined when no lessons file exists", async () => {
            const result = await loadLessons(tmpDir);
            expect(result).toBeUndefined();
        });

        it("returns undefined for empty file", async () => {
            await fs.mkdir(path.join(tmpDir, ".mygit"), { recursive: true });
            await fs.writeFile(path.join(tmpDir, ".mygit", "LESSONS.md"), "", "utf-8");
            const result = await loadLessons(tmpDir);
            expect(result).toBeUndefined();
        });

        it("returns content for existing file", async () => {
            await fs.mkdir(path.join(tmpDir, ".mygit"), { recursive: true });
            await fs.writeFile(
                path.join(tmpDir, ".mygit", "LESSONS.md"),
                "# Lessons\n\n- some lesson here",
                "utf-8",
            );
            const result = await loadLessons(tmpDir);
            expect(result).toContain("some lesson here");
        });
    });
});
