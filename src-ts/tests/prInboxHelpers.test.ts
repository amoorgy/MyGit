import { describe, expect, it } from "vitest";
import { filterPRsByState } from "../tui/hooks/usePrInbox.js";
import type { GitHubPR } from "../github/types.js";

function mkPR(partial: Partial<GitHubPR> & { number: number }): GitHubPR {
    return {
        number: partial.number,
        title: partial.title ?? `PR ${partial.number}`,
        body: partial.body ?? null,
        state: partial.state ?? "open",
        draft: partial.draft ?? false,
        merged: partial.merged ?? false,
        mergeable: partial.mergeable ?? null,
        user: partial.user ?? { login: "dev", id: 1, avatar_url: "", html_url: "" },
        head: partial.head ?? { ref: "feature", sha: "h", repo: null },
        base: partial.base ?? { ref: "main", sha: "b", repo: null },
        additions: partial.additions ?? 1,
        deletions: partial.deletions ?? 1,
        changed_files: partial.changed_files ?? 1,
        commits: partial.commits ?? 1,
        html_url: partial.html_url ?? "",
        created_at: partial.created_at ?? "2026-01-01T00:00:00Z",
        updated_at: partial.updated_at ?? "2026-01-01T00:00:00Z",
        merged_at: partial.merged_at ?? null,
    };
}

describe("PR inbox state filtering", () => {
    const prs: GitHubPR[] = [
        mkPR({ number: 1, state: "open", merged: false, merged_at: null }),
        mkPR({ number: 2, state: "closed", merged: false, merged_at: null }),
        mkPR({ number: 3, state: "closed", merged: true, merged_at: "2026-02-01T00:00:00Z" }),
    ];

    it("keeps all PRs for all state", () => {
        expect(filterPRsByState(prs, "all").map((p) => p.number)).toEqual([1, 2, 3]);
    });

    it("filters open PRs", () => {
        expect(filterPRsByState(prs, "open").map((p) => p.number)).toEqual([1]);
    });

    it("filters closed non-merged PRs", () => {
        expect(filterPRsByState(prs, "closed").map((p) => p.number)).toEqual([2]);
    });

    it("filters merged PRs", () => {
        expect(filterPRsByState(prs, "merged").map((p) => p.number)).toEqual([3]);
    });
});

