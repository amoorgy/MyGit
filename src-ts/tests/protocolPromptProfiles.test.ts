import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "../agent/protocol.js";

describe("buildAgentSystemPrompt profiles", () => {
    it("builds a compact direct_qa prompt without execution init policy", () => {
        const prompt = buildAgentSystemPrompt("direct_qa", "full");
        expect(prompt).toContain("MODE=direct_qa");
        expect(prompt).not.toContain("INIT=");
        expect(prompt).toContain("QA_RULES:");
        expect(prompt).toContain("## MYGIT PROJECT FACTS");
        expect(prompt).toContain("KNOWLEDGE_MODEL:Root AGENTS.md is a short repo map.");
        expect(prompt).toContain("INIT_COMMAND:mygit init initializes or refreshes the repo-local smart-context index and the generated knowledge map");
        expect(prompt).toContain("DEFAULT_BEHAVIOR:prefer {\"type\":\"respond\"} for simple product questions");
        expect(prompt).toContain("use_preloaded_memory+agents_map+context_first");
    });

    it("builds execution prompt with explicit init policy guidance", () => {
        const prompt = buildAgentSystemPrompt("execution", "light");
        expect(prompt).toContain("MODE=execution;INIT=light");
        expect(prompt).toContain("INIT_LIGHT:");
        expect(prompt).toContain("EXEC_RULES:");
        expect(prompt).not.toContain("read[CLAUDE.md");
        expect(prompt).toContain("inspect_first");
        expect(prompt).toContain("agents_map+selected_shards");
        expect(prompt).toContain("TUI_SLASH_COMMANDS:/init,/config,/provider,/model,/conflicts,/worktrees,/pr,/pr-commits,/clear,/compact,/exit.");
    });
});
