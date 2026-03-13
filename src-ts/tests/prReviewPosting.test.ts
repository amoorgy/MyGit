import { describe, expect, it } from "vitest";
import {
    buildSummaryOnlySubmission,
    buildInlineReviewComments,
    collectCommentableRightSideLines,
    prepareReviewSubmission,
    prepareInlineCapableSubmission,
    shouldDowngradeRequestChangesForGitHub,
    shouldPostSeverity,
} from "../pr/posting.js";
import type { PRReview } from "../pr/types.js";

const REVIEW: PRReview = {
    id: "r-1",
    prNumber: 42,
    repoOwner: "acme",
    repoName: "repo",
    prTitle: "Improve auth flow",
    headSha: "abc123",
    overallSummary: "Summary",
    overallDecision: "comment",
    riskScore: 5,
    comments: [
        {
            id: "c1",
            filePath: "src/auth.ts",
            line: 12,
            severity: "critical",
            category: "security",
            title: "Critical issue",
            body: "Do not allow bypass.",
            reasoningSteps: [],
        },
        {
            id: "c2",
            filePath: "src/auth.ts",
            line: 18,
            severity: "major",
            category: "logic",
            title: "Major issue",
            body: "Fix branch logic.",
            reasoningSteps: [],
        },
        {
            id: "c3",
            filePath: "src/auth.ts",
            line: 22,
            severity: "minor",
            category: "style",
            title: "Minor issue",
            body: "Rename variable.",
            reasoningSteps: [],
        },
        {
            id: "c4",
            filePath: "src/auth.ts",
            severity: "critical",
            category: "bug",
            title: "No line",
            body: "Cannot post inline without line.",
            reasoningSteps: [],
        },
        {
            id: "c5",
            filePath: "src/auth.ts",
            line: 27,
            severity: "praise",
            category: "praise",
            title: "Nice work",
            body: "Looks great.",
            reasoningSteps: [],
        },
    ],
    fileSummaries: [],
    generatedAt: "2026-03-01T00:00:00Z",
    modelUsed: "test-model",
    tokensUsed: 0,
};

describe("PR review posting filters", () => {
    it("uses severity threshold ordering", () => {
        expect(shouldPostSeverity("critical", "major")).toBe(true);
        expect(shouldPostSeverity("major", "major")).toBe(true);
        expect(shouldPostSeverity("minor", "major")).toBe(false);
        expect(shouldPostSeverity("suggestion", "minor")).toBe(false);
    });

    it("builds inline comments using threshold and line requirements", () => {
        const comments = buildInlineReviewComments(REVIEW, "major", {
            "src/auth.ts": [
                "@@ -10,3 +12,2 @@",
                " old",
                "+new",
                "@@ -20,2 +18,2 @@",
                " stay",
                "+tail",
            ].join("\n"),
        });
        expect(comments.length).toBe(2);
        expect(comments.map((c) => `${c.path}:${c.line}`)).toEqual([
            "src/auth.ts:12",
            "src/auth.ts:18",
        ]);
    });

    it("extracts valid right-side lines from patches", () => {
        const lines = collectCommentableRightSideLines([
            "@@ -2,2 +10,4 @@",
            " context",
            "-old",
            "+new",
            " keep",
            "\\ No newline at end of file",
        ].join("\n"));

        expect([...lines]).toEqual([10, 11, 12]);
    });

    it("moves invalid inline findings into the summary body", () => {
        const prepared = prepareReviewSubmission(REVIEW, "major", {
            "src/auth.ts": [
                "@@ -10,2 +12,2 @@",
                " a",
                "+b",
            ].join("\n"),
        });

        expect(prepared.inlineComments.map((c) => c.line)).toEqual([12]);
        expect(prepared.overflowComments.map((c) => c.title)).toEqual([
            "Major issue",
            "No line",
        ]);
        expect(prepared.submission.body).toContain("### Additional Findings (2)");
        expect(prepared.submission.body).toContain("Major issue");
        expect(prepared.submission.body).toContain("No line");
    });

    it("builds summary-only submissions without commit id metadata", () => {
        const submission = buildSummaryOnlySubmission(REVIEW, "major");

        expect(submission.comments).toBeUndefined();
        expect(submission.commit_id).toBeUndefined();
        expect(submission.body).toContain("Critical issue");
        expect(submission.body).toContain("Major issue");
    });

    it("supports overriding the review event for self-review fallback", () => {
        const submission = prepareInlineCapableSubmission(
            { ...REVIEW, overallDecision: "request_changes" },
            "major",
            {
                "src/auth.ts": [
                    "@@ -10,3 +12,2 @@",
                    " old",
                    "+new",
                ].join("\n"),
            },
            { event: "COMMENT" },
        );

        expect(submission.submission.event).toBe("COMMENT");
    });

    it("detects self-review request-changes rejections from GitHub", () => {
        expect(
            shouldDowngradeRequestChangesForGitHub(
                new Error("GitHub API error 422: Unprocessable Entity: Review Can not request changes on your own pull request"),
            ),
        ).toBe(true);
        expect(
            shouldDowngradeRequestChangesForGitHub(
                new Error("GitHub API error 422: Unprocessable Entity: Some other validation failure"),
            ),
        ).toBe(false);
    });
});
