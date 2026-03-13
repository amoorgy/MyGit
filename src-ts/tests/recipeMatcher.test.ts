import { describe, it, expect } from "vitest";
import { matchRecipe, extractRecipeParams, formatRecipeForPrompt, isGitWorkflowRequest } from "../recipes/matcher.js";
import { RECIPE_CATALOG } from "../recipes/catalog.js";
import type { EnhancedGitContext } from "../recipes/types.js";

// ============================================================================
// matchRecipe
// ============================================================================

describe("matchRecipe", () => {
    it("matches 'fetch branch from fork' to fetch-remote-branch", () => {
        const match = matchRecipe("fetch the feature-login branch from my fork");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("fetch-remote-branch");
        expect(match!.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("matches 'sync my fork' to sync-fork", () => {
        const match = matchRecipe("sync my fork with upstream");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("sync-fork");
    });

    it("matches 'undo file to date' to undo-file-to-date", () => {
        const match = matchRecipe("undo changes to src/main.ts back to March 13th");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("undo-file-to-date");
    });

    it("matches 'which branch has feature' to find-branch-with-feature", () => {
        const match = matchRecipe("which branch has the login feature");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("find-branch-with-feature");
    });

    it("matches 'squash last 5 commits' to squash-commits", () => {
        const match = matchRecipe("squash the last 5 commits into one");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("squash-commits");
    });

    it("matches 'restore deleted file' to restore-deleted-file", () => {
        const match = matchRecipe("restore the deleted file utils/helpers.ts");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("restore-deleted-file");
    });

    it("matches 'add upstream' to setup-upstream", () => {
        const match = matchRecipe("add upstream remote for this fork");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("setup-upstream");
    });

    it("matches 'cherry-pick from upstream' to cherry-pick-cross-remote", () => {
        const match = matchRecipe("cherry-pick commit abc1234 from upstream");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("cherry-pick-cross-remote");
    });

    it("matches 'push to my fork' to push-to-fork", () => {
        const match = matchRecipe("push this branch to my fork");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("push-to-fork");
    });

    it("matches 'find deleted code' to find-deleted-code", () => {
        const match = matchRecipe("find the deleted function parseConfig");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("find-deleted-code");
    });

    it("matches 'bisect' to bisect-bug", () => {
        const match = matchRecipe("use git bisect to find which commit broke the tests");
        expect(match).not.toBeNull();
        expect(match!.recipe.id).toBe("bisect-bug");
    });

    it("returns null for unrelated requests", () => {
        const match = matchRecipe("explain the authentication middleware");
        expect(match).toBeNull();
    });

    it("returns null for simple git commands without workflow intent", () => {
        const match = matchRecipe("show me the git log");
        expect(match).toBeNull();
    });

    it("returns null for code editing requests", () => {
        const match = matchRecipe("refactor the database module to use async/await");
        expect(match).toBeNull();
    });
});

// ============================================================================
// extractRecipeParams
// ============================================================================

describe("extractRecipeParams", () => {
    const dummyRecipe = RECIPE_CATALOG[0]; // any recipe, params are recipe-agnostic

    it("extracts branch name from 'branch feature-login'", () => {
        const params = extractRecipeParams("fetch branch feature-login from my fork", dummyRecipe);
        expect(params.branch).toBe("feature-login");
    });

    it("extracts quoted branch name", () => {
        const params = extractRecipeParams('get branch "my-feature" from remote', dummyRecipe);
        expect(params.branch).toBe("my-feature");
    });

    it("extracts file path", () => {
        const params = extractRecipeParams("undo changes to src/utils/helpers.ts back to March", dummyRecipe);
        expect(params.file).toBe("src/utils/helpers.ts");
    });

    it("extracts ISO date", () => {
        const params = extractRecipeParams("revert file to 2026-03-13", dummyRecipe);
        expect(params.date).toBe("2026-03-13");
    });

    it("extracts natural date with month name", () => {
        const params = extractRecipeParams("undo file back to 13th of March", dummyRecipe);
        expect(params.date).toMatch(/13th\s+of\s+March/i);
    });

    it("extracts commit SHA", () => {
        const params = extractRecipeParams("cherry-pick commit abc1234f from upstream", dummyRecipe);
        expect(params.commit_sha).toBe("abc1234f");
    });

    it("extracts numeric count for squash", () => {
        const params = extractRecipeParams("squash the last 5 commits", dummyRecipe);
        expect(params.count).toBe("5");
    });

    it("extracts quoted search term", () => {
        const params = extractRecipeParams("find deleted code for 'parseConfig'", dummyRecipe);
        expect(params.search_term).toBe("parseConfig");
    });

    it("returns empty params for vague requests", () => {
        const params = extractRecipeParams("sync my fork", dummyRecipe);
        // No specific branch, file, date, etc.
        expect(params.branch).toBeUndefined();
        expect(params.file).toBeUndefined();
        expect(params.date).toBeUndefined();
    });
});

// ============================================================================
// formatRecipeForPrompt
// ============================================================================

describe("formatRecipeForPrompt", () => {
    it("produces a prompt block with recipe name and steps", () => {
        const match = matchRecipe("sync my fork with upstream");
        expect(match).not.toBeNull();

        const output = formatRecipeForPrompt(match!);
        expect(output).toContain("## GIT WORKFLOW RECIPE");
        expect(output).toContain("Sync Fork with Upstream");
        expect(output).toContain("Steps:");
        expect(output).toContain("git remote -v");
        expect(output).toContain("Warnings:");
    });

    it("substitutes extracted params into commands", () => {
        const match = matchRecipe("squash the last 3 commits");
        expect(match).not.toBeNull();

        const output = formatRecipeForPrompt(match!);
        expect(output).toContain("Detected params:");
        expect(output).toContain("count=3");
        // The command template should have 3 substituted in
        expect(output).toContain("git log --oneline -3");
    });

    it("includes enhanced git context when provided", () => {
        const match = matchRecipe("sync my fork with upstream");
        expect(match).not.toBeNull();

        const enhancedCtx: EnhancedGitContext = {
            remotes: [
                { name: "origin", fetchUrl: "git@github.com:user/repo.git", pushUrl: "git@github.com:user/repo.git", github: { owner: "user", repo: "repo" } },
                { name: "upstream", fetchUrl: "git@github.com:org/repo.git", pushUrl: "git@github.com:org/repo.git", github: { owner: "org", repo: "repo" } },
            ],
            tracking: [
                { local: "main", remote: "origin/main", ahead: 0, behind: 3 },
            ],
            allBranches: [
                { name: "main", isRemote: false },
                { name: "origin/main", isRemote: true },
            ],
            forkInfo: {
                isFork: true,
                parentRepo: "org/repo",
                parentCloneUrl: "https://github.com/org/repo.git",
            },
        };

        const output = formatRecipeForPrompt(match!, enhancedCtx);
        expect(output).toContain("Remotes:");
        expect(output).toContain("origin: git@github.com:user/repo.git");
        expect(output).toContain("Fork: yes (parent: org/repo)");
        expect(output).toContain("Tracking:");
        expect(output).toContain("main → origin/main (ahead 0, behind 3)");
        expect(output).toContain("Branches: 1 local, 1 remote");
    });

    it("includes missing-params notice", () => {
        const match = matchRecipe("sync my fork");
        expect(match).not.toBeNull();

        const output = formatRecipeForPrompt(match!);
        expect(output).toContain("optional guidance");
    });
});

// ============================================================================
// isGitWorkflowRequest
// ============================================================================

describe("isGitWorkflowRequest", () => {
    it("detects fork-related requests", () => {
        expect(isGitWorkflowRequest("sync my fork with upstream")).toBe(true);
        expect(isGitWorkflowRequest("fetch branch from fork")).toBe(true);
    });

    it("detects history-related requests", () => {
        expect(isGitWorkflowRequest("undo changes to file")).toBe(true);
        expect(isGitWorkflowRequest("revert this commit")).toBe(true);
        expect(isGitWorkflowRequest("bisect to find the bug")).toBe(true);
    });

    it("detects branch manipulation requests", () => {
        expect(isGitWorkflowRequest("squash last 5 commits")).toBe(true);
        expect(isGitWorkflowRequest("cherry-pick from another branch")).toBe(true);
        expect(isGitWorkflowRequest("rebase onto main")).toBe(true);
    });

    it("returns false for unrelated requests", () => {
        expect(isGitWorkflowRequest("explain the auth middleware")).toBe(false);
        expect(isGitWorkflowRequest("add a new API endpoint")).toBe(false);
        expect(isGitWorkflowRequest("what does this function do")).toBe(false);
    });
});
