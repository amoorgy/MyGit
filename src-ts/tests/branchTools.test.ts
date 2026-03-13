import { describe, expect, it, vi } from "vitest";
import {
    buildBranchPanelDataFromState,
    planBranchSelection,
    type BranchPanelTarget,
} from "../tui/git/branchTools.js";
import type { RepoBranchEntry, RepoGitState } from "../tui/git/repoState.js";

vi.mock("bun:sqlite", () => {
    class FakeDatabase {
        run() {}
        query() {
            return {
                run() {},
                all() {
                    return [];
                },
                get() {
                    return null;
                },
            };
        }
        close() {}
    }

    return { Database: FakeDatabase };
});

function makeTarget(name: string, source: "local" | "remote", overrides: Partial<BranchPanelTarget> = {}): BranchPanelTarget {
    return {
        name,
        displayName: name,
        source,
        fullRefName: source === "remote" ? `origin/${name}` : name,
        lastCommitSha: "abc123456789",
        lastCommitSubject: `${name} subject`,
        lastCommitAt: "2026-03-06T10:00:00Z",
        occupiedByWorktree: null,
        ...overrides,
    };
}

function makeEntry(name: string, kind: "local" | "remote", overrides: Partial<RepoBranchEntry> = {}): RepoBranchEntry {
    return {
        name,
        fullRefName: kind === "remote" ? `origin/${name}` : name,
        kind,
        lastCommitSha: "abc123456789",
        lastCommitSubject: `${name} subject`,
        lastCommitAt: "2026-03-06T10:00:00Z",
        occupiedByWorktree: null,
        ...overrides,
    };
}

function makeState(): RepoGitState {
    return {
        repoRoot: "/repo",
        currentBranch: "main",
        currentWorktreePath: "/repo",
        upstream: "origin/main",
        dirty: false,
        localBranches: [
            makeEntry("main", "local"),
            makeEntry("recent-local", "local"),
        ],
        remoteBranches: [
            makeEntry("main", "remote", { fullRefName: "origin/main" }),
            makeEntry("recent-local", "remote", { fullRefName: "origin/recent-local" }),
            makeEntry("remote-only", "remote", { fullRefName: "origin/remote-only", lastCommitAt: "2026-03-07T10:00:00Z" }),
        ],
        worktrees: [{ branch: "main", path: "/repo", isCurrent: true }],
        recentBranches: ["recent-local"],
        indexed: true,
    };
}

describe("branch panel data", () => {
    it("categorizes current, recent, and other branches", () => {
        const data = buildBranchPanelDataFromState(makeState());
        expect(data.currentBranch?.name).toBe("main");
        expect(data.recentBranches.map((branch) => branch.name)).toEqual(["recent-local"]);
        expect(data.otherBranches.map((branch) => branch.name)).toEqual(["remote-only"]);
    });
});

describe("branch selection planning", () => {
    it("returns noop for the current branch", () => {
        const state = makeState();
        const plan = planBranchSelection(makeTarget("main", "local"), state);
        expect(plan.kind).toBe("noop");
    });

    it("switches clean local branches directly", () => {
        const state = makeState();
        const plan = planBranchSelection(makeTarget("recent-local", "local"), state);
        expect(plan.kind).toBe("switch_local");
        expect(plan.switchCommand).toBe("switch recent-local");
    });

    it("prompts when the worktree is dirty", () => {
        const state = { ...makeState(), dirty: true };
        const plan = planBranchSelection(makeTarget("recent-local", "local"), state);
        expect(plan.kind).toBe("prompt_dirty");
    });

    it("prompts when the target branch is occupied elsewhere", () => {
        const state = {
            ...makeState(),
            localBranches: [
                makeEntry("main", "local", { occupiedByWorktree: "/repo" }),
                makeEntry("feature-x", "local", { occupiedByWorktree: "/repo-feature-x" }),
            ],
            worktrees: [
                { branch: "main", path: "/repo", isCurrent: true },
                { branch: "feature-x", path: "/repo-feature-x", isCurrent: false },
            ],
        };
        const plan = planBranchSelection(makeTarget("feature-x", "local", { occupiedByWorktree: "/repo-feature-x" }), state);
        expect(plan.kind).toBe("prompt_occupied");
        expect(plan.occupiedPath).toBe("/repo-feature-x");
    });
});
