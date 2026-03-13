import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
    loadImplementationPlan,
    normalizeImplementationPlanSteps,
    parseImplementationPlanResponse,
    saveImplementationPlan,
    type SavedImplementationPlanV1,
} from "../tui/thoughtMap/implementation.js";
import { formatSupportedSlashCommands, parseSlashCommand } from "../tui/thoughtMap/slashCommands.js";

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(
        tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
});

async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mygit-thoughtmap-test-"));
    tempDirs.push(dir);
    return dir;
}

function sampleBundle(intent = "Implement auth flow"): SavedImplementationPlanV1 {
    return {
        version: 1,
        savedAt: new Date("2026-02-26T00:00:00.000Z").toISOString(),
        source: {
            type: "thought_map",
            thoughtMapId: "map_1",
            intent,
            scope: "whole_map",
            selectedNodeId: null,
        },
        plan: {
            id: "plan_1",
            intent,
            safetyLevel: "high",
            createdAt: 1,
            steps: [
                {
                    index: 0,
                    description: "Check status",
                    command: "status",
                    isGit: true,
                    isReversible: true,
                    requiresApproval: false,
                },
            ],
        },
        executionDefaults: {
            mode: "interactive",
        },
    };
}

describe("thought map slash commands", () => {
    it("parses menu fallback and implementation commands", () => {
        expect(parseSlashCommand("/")).toEqual({ kind: "menu" });
        expect(parseSlashCommand("/branch")).toEqual({
            kind: "command",
            id: "branch",
            args: [],
            rawArgs: "",
        });
        expect(parseSlashCommand("/branch auth flow")).toEqual({
            kind: "command",
            id: "branch",
            args: ["auth", "flow"],
            rawArgs: "auth flow",
        });
        expect(parseSlashCommand("/commit")).toEqual({
            kind: "command",
            id: "commit",
            args: [],
            rawArgs: "",
        });
        expect(parseSlashCommand("/summary")).toEqual({
            kind: "command",
            id: "commit",
            args: [],
            rawArgs: "",
        });
        expect(parseSlashCommand("/commit push")).toEqual({
            kind: "command",
            id: "commit",
            args: ["push"],
            rawArgs: "push",
        });
        expect(parseSlashCommand("/fetch")).toEqual({
            kind: "command",
            id: "fetch",
            args: [],
            rawArgs: "",
        });
        expect(parseSlashCommand("/fetch-all")).toEqual({
            kind: "command",
            id: "fetch-all",
            args: [],
            rawArgs: "",
        });
        expect(parseSlashCommand("/implement")).toEqual({ kind: "implement" });
        expect(parseSlashCommand("/save-implementation")).toEqual({ kind: "save_implementation" });
        expect(parseSlashCommand("/run-implementation")).toEqual({ kind: "run_implementation" });
        expect(parseSlashCommand("/run-implementation latest-auth")).toEqual({
            kind: "run_implementation",
            ref: "latest-auth",
        });
    });

    it("reports unknown commands and formats help text", () => {
        expect(parseSlashCommand("/wat")).toEqual({ kind: "unknown", command: "wat" });
        expect(formatSupportedSlashCommands()).toContain("/implement");
    });
});

describe("saved implementation plan persistence", () => {
    it("saves JSON plan and loads latest roundtrip", async () => {
        const dir = await makeTempDir();
        const bundle = sampleBundle();
        const saved = await saveImplementationPlan(bundle, { baseDir: dir });

        expect(path.basename(saved.filePath)).toMatch(/^implementation-\d+-implement-auth-flow\.json$/);
        expect(path.basename(saved.latestPath)).toBe("latest-implementation.json");

        const loaded = await loadImplementationPlan(undefined, { baseDir: dir });
        expect(loaded).toEqual(bundle);
    });

    it("loads by stem and errors on ambiguous matches", async () => {
        const dir = await makeTempDir();
        await saveImplementationPlan(sampleBundle("Auth flow one"), { baseDir: dir });
        await saveImplementationPlan(sampleBundle("Auth flow two"), { baseDir: dir });

        const entries = await fs.readdir(dir);
        const one = entries.find((n) => n.includes("auth-flow-one"));
        expect(one).toBeTruthy();
        const stem = one!.replace(/\.json$/, "");

        const loaded = await loadImplementationPlan(stem, { baseDir: dir });
        expect(loaded.source.intent).toBe("Auth flow one");

        await expect(loadImplementationPlan("implementation-", { baseDir: dir }))
            .rejects.toThrow(/Ambiguous saved implementation plan/);
    });

    it("rejects invalid JSON and unsupported versions", async () => {
        const dir = await makeTempDir();
        await fs.writeFile(path.join(dir, "latest-implementation.json"), "{bad", "utf-8");
        await expect(loadImplementationPlan(undefined, { baseDir: dir }))
            .rejects.toThrow(/Invalid saved implementation plan JSON/);

        await fs.writeFile(
            path.join(dir, "latest-implementation.json"),
            JSON.stringify({ version: 99, plan: { steps: [] } }),
            "utf-8",
        );
        await expect(loadImplementationPlan(undefined, { baseDir: dir }))
            .rejects.toThrow(/Unsupported saved implementation plan version/);
    });
});

describe("implementation plan parsing and normalization", () => {
    it("extracts JSON from wrapped text", () => {
        const parsed = parseImplementationPlanResponse("```json\n{\"steps\":[{\"description\":\"x\",\"command\":\"git status\"}]}\n```");
        expect(parsed.steps?.[0]?.command).toBe("git status");
    });

    it("normalizes git-prefixed and dangerous steps", () => {
        const steps = normalizeImplementationPlanSteps([
            { description: "Check", command: "git status" },
            { description: "Danger", command: "git reset --hard" },
            { description: "Empty", command: "   " },
        ]);

        expect(steps).toHaveLength(2);
        expect(steps[0]).toMatchObject({
            isGit: true,
            command: "status",
            requiresApproval: false,
        });
        expect(steps[1]).toMatchObject({
            isGit: true,
            command: "reset --hard",
            requiresApproval: true,
            isReversible: false,
        });
    });
});
