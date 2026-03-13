import { describe, it, expect } from "vitest";
import { formatContextForPrompt, type AgentContextState } from "../agent/context.js";
import type { EnhancedGitContext } from "../recipes/types.js";

function makeContext(overrides: Partial<AgentContextState> = {}): AgentContextState {
    return {
        repoRoot: "/tmp/repo",
        branch: "main",
        status: "",
        recentCommits: "",
        diffSummary: "",
        stagedSummary: "",
        fileTree: [],
        observations: [],
        planSteps: [],
        request: "sync my fork",
        activeWorktree: null,
        ...overrides,
    };
}

describe("formatContextForPrompt — enhanced git context", () => {
    it("renders remotes when enhancedGitContext is present", () => {
        const ctx = makeContext({
            enhancedGitContext: {
                remotes: [
                    { name: "origin", fetchUrl: "git@github.com:user/repo.git", pushUrl: "git@github.com:user/repo.git", github: { owner: "user", repo: "repo" } },
                    { name: "upstream", fetchUrl: "git@github.com:org/repo.git", pushUrl: "git@github.com:org/repo.git", github: { owner: "org", repo: "repo" } },
                ],
                tracking: [],
                allBranches: [],
            },
        });

        const output = formatContextForPrompt(ctx, { mode: "execution" });
        expect(output).toContain("Remotes:");
        expect(output).toContain("origin: git@github.com:user/repo.git (user/repo)");
        expect(output).toContain("upstream: git@github.com:org/repo.git (org/repo)");
    });

    it("renders fork info when present", () => {
        const ctx = makeContext({
            enhancedGitContext: {
                remotes: [{ name: "origin", fetchUrl: "url", pushUrl: "url" }],
                tracking: [],
                allBranches: [],
                forkInfo: {
                    isFork: true,
                    parentRepo: "org/repo",
                    parentCloneUrl: "https://github.com/org/repo.git",
                },
            },
        });

        const output = formatContextForPrompt(ctx, { mode: "execution" });
        expect(output).toContain("Fork: yes (parent: org/repo)");
        expect(output).toContain("Parent clone URL: https://github.com/org/repo.git");
    });

    it("renders tracking info", () => {
        const ctx = makeContext({
            enhancedGitContext: {
                remotes: [],
                tracking: [
                    { local: "main", remote: "origin/main", ahead: 2, behind: 5 },
                    { local: "dev", remote: "origin/dev", ahead: 0, behind: 0 },
                ],
                allBranches: [],
            },
        });

        const output = formatContextForPrompt(ctx, { mode: "execution" });
        expect(output).toContain("Tracking:");
        expect(output).toContain("main → origin/main (ahead 2, behind 5)");
        expect(output).toContain("dev → origin/dev (ahead 0, behind 0)");
    });

    it("does not render enhanced context when absent", () => {
        const ctx = makeContext();

        const output = formatContextForPrompt(ctx, { mode: "execution" });
        expect(output).not.toContain("Remotes:");
        expect(output).not.toContain("Fork:");
        expect(output).not.toContain("Tracking:");
    });

    it("skips empty sections gracefully", () => {
        const ctx = makeContext({
            enhancedGitContext: {
                remotes: [],
                tracking: [],
                allBranches: [],
                forkInfo: { isFork: false },
            },
        });

        const output = formatContextForPrompt(ctx, { mode: "execution" });
        // No remotes, no fork, no tracking — none of these headers should appear
        expect(output).not.toContain("Remotes:");
        expect(output).not.toContain("Fork:");
        expect(output).not.toContain("Tracking:");
    });
});
