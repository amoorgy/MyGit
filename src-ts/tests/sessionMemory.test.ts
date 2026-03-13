import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
    buildPortableMemoryPack,
    createSessionCheckpoint,
    loadProjectMemory,
} from "../memory/sessionMemory.js";

class StaticSummaryModel {
    constructor(private readonly output: string) {}

    async invoke(): Promise<{ content: string }> {
        return { content: this.output };
    }
}

async function makeTempRepo(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), "mygit-memory-"));
}

describe("session memory", () => {
    it("writes canonical MYGIT.md latest and recent session entries", async () => {
        const repoRoot = await makeTempRepo();

        const result = await createSessionCheckpoint({
            repoRoot,
            model: new StaticSummaryModel("Last: Investigated auth persistence\nNext: Patch the session refresh tests") as any,
            transcript: [
                { role: "user", content: "fix auth persistence" },
                { role: "agent", content: "I updated the session code" },
                { role: "tool", content: "write_file", toolType: "write_file", toolLabel: "src/auth.ts", success: true },
            ],
            persist: true,
        });

        const raw = await fs.readFile(path.join(repoRoot, ".mygit", "MYGIT.md"), "utf-8");
        expect(result.persisted).toBe(true);
        expect(raw).toContain("# mygit Project Memory");
        expect(raw).toContain("## Latest");
        expect(raw).toContain("Last: Investigated auth persistence");
        expect(raw).toContain("Next: Patch the session refresh tests");
        expect(raw).toContain("## Recent Sessions");
        expect(raw).toContain("[unknown]");
    });

    it("imports legacy brain.json when canonical memory does not exist", async () => {
        const repoRoot = await makeTempRepo();
        await fs.mkdir(path.join(repoRoot, ".mygit"), { recursive: true });
        await fs.writeFile(
            path.join(repoRoot, ".mygit", "brain.json"),
            JSON.stringify({
                timestamp: "2026-03-07T10:00:00Z",
                branch: "feature/auth",
                summary: "Worked on auth middleware",
                next_steps: "Finish the login redirect",
            }),
            "utf-8",
        );

        const memory = await loadProjectMemory(repoRoot);
        const canonical = await fs.readFile(path.join(repoRoot, ".mygit", "MYGIT.md"), "utf-8");

        expect(memory.importedLegacy).toBe(true);
        expect(memory.last).toBe("Worked on auth middleware");
        expect(memory.next).toBe("Finish the login redirect");
        expect(canonical).toContain("[feature/auth]");
    });

    it("builds a portable markdown pack from canonical memory", async () => {
        const repoRoot = await makeTempRepo();
        await createSessionCheckpoint({
            repoRoot,
            model: new StaticSummaryModel("Last: Reviewed branch cleanup\nNext: Re-run the fetch flow") as any,
            persist: true,
        });

        const packed = await buildPortableMemoryPack(repoRoot);
        expect(packed).toContain("# Development Context:");
        expect(packed).toContain("Last: Reviewed branch cleanup");
        expect(packed).toContain("Next: Re-run the fetch flow");
        expect(packed).toContain("## Working Tree Status");
    });
});
