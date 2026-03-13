/**
 * usePrReview — manages PR review fetch/analyze/cache/post lifecycle for TUI.
 */

import { useState, useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { GitHubConfig } from "../../config/settings.js";
import type { ProviderConfig } from "../../llm/providers.js";
import { createGitHubClient } from "../../github/auth.js";
import { GitHubAPIError } from "../../github/client.js";
import { PRReviewCache } from "../../pr/cache.js";
import { analyzePR } from "../../pr/analyzer.js";
import type { PRData, PRFile, PRCommit, PRReview } from "../../pr/types.js";
import { openProjectDatabase } from "../../storage/database.js";
import { createChatModel } from "../../llm/providers.js";
import type { GitHubPR, GitHubPRFile, GitHubPRCommit } from "../../github/types.js";
import {
    buildSummaryOnlySubmission,
    prepareInlineCapableSubmission,
    shouldDowngradeRequestChangesForGitHub,
} from "../../pr/posting.js";
import { fingerprintGitHubReviewConfig, fingerprintProviderConfig } from "./prReviewHelpers.js";
export { buildInlineReviewComments, shouldPostSeverity } from "../../pr/posting.js";
export { fingerprintGitHubReviewConfig, fingerprintProviderConfig } from "./prReviewHelpers.js";

export type PrReviewPhase =
    | "idle"
    | "fetching_pr"
    | "fetching_files"
    | "analyzing"
    | "synthesizing"
    | "done"
    | "posting"
    | "error";

export type PrReviewPostMode = "inline" | "summary_only";

export interface UsePrReviewReturn {
    review: PRReview | null;
    phase: PrReviewPhase;
    progressMessage: string;
    error: string | null;
    postResult: "success" | "error" | null;
    postMode: PrReviewPostMode | null;
    postDetail: string | null;
    postUrl: string | null;
    postedCommentCount: number;
    filePatches: Record<string, string>;
    postReview: () => Promise<void>;
    reload: () => void;
}

export interface UsePrReviewOptions {
    owner?: string;
    repo?: string;
    autoPost?: boolean;
    postMinSeverity?: GitHubConfig["reviewPostMinSeverity"];
}

type ReviewSource = "fresh" | "cache" | null;

function mapGitHubData(
    pr: GitHubPR,
    files: GitHubPRFile[],
    commits: GitHubPRCommit[],
): PRData {
    return {
        number: pr.number,
        title: pr.title,
        description: pr.body ?? "",
        author: pr.user.login,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        headSha: pr.head.sha,
        baseSha: pr.base.sha,
        state: pr.merged ? "merged" : (pr.state as "open" | "closed"),
        isDraft: pr.draft,
        totalAdditions: pr.additions,
        totalDeletions: pr.deletions,
        changedFiles: pr.changed_files,
        htmlUrl: pr.html_url,
        files: files.map((f): PRFile => ({
            path: f.filename,
            previousPath: f.previous_filename,
            status: (f.status === "removed" ? "removed" :
                     f.status === "added" ? "added" :
                     f.status === "renamed" ? "renamed" : "modified") as PRFile["status"],
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? "",
        })),
        commits: commits.map((c): PRCommit => ({
            sha: c.sha,
            message: c.commit.message,
            author: c.commit.author.name,
            date: c.commit.author.date,
        })),
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
    };
}

function isActiveRun(runIdRef: MutableRefObject<number>, runId: number): boolean {
    return runIdRef.current === runId;
}

function buildPostErrorMessage(primary: unknown, fallback?: unknown): string {
    const primaryMessage = primary instanceof Error ? primary.message : String(primary);
    if (!fallback) return primaryMessage;
    const fallbackMessage = fallback instanceof Error ? fallback.message : String(fallback);
    return `${primaryMessage}; summary-only retry failed: ${fallbackMessage}`;
}

function dedupePostDetail(errorMessage: string, detail: string | null): string | null {
    if (!detail) return null;
    const normalizedError = errorMessage.replace(/^Failed to post:\s*/i, "").trim();
    const normalizedDetail = detail.trim();
    return normalizedError === normalizedDetail ? null : detail;
}

export function usePrReview(
    prNumber: number | null,
    githubConfig: GitHubConfig,
    providerConfig: ProviderConfig,
    options?: UsePrReviewOptions,
): UsePrReviewReturn {
    const explicitOwner = options?.owner?.trim() || "";
    const explicitRepo = options?.repo?.trim() || "";
    const autoPost = options?.autoPost ?? githubConfig.reviewAutoPost;
    const postMinSeverity = options?.postMinSeverity ?? githubConfig.reviewPostMinSeverity;
    const providerFingerprint = useMemo(
        () => fingerprintProviderConfig(providerConfig),
        [providerConfig],
    );
    const githubReviewFingerprint = useMemo(
        () => fingerprintGitHubReviewConfig(githubConfig),
        [githubConfig],
    );

    const [review, setReview] = useState<PRReview | null>(null);
    const [reviewSource, setReviewSource] = useState<ReviewSource>(null);
    const [phase, setPhase] = useState<PrReviewPhase>("idle");
    const [progressMessage, setProgressMessage] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [postResult, setPostResult] = useState<"success" | "error" | null>(null);
    const [postMode, setPostMode] = useState<PrReviewPostMode | null>(null);
    const [postDetail, setPostDetail] = useState<string | null>(null);
    const [postUrl, setPostUrl] = useState<string | null>(null);
    const [postedCommentCount, setPostedCommentCount] = useState(0);
    const [filePatches, setFilePatches] = useState<Record<string, string>>({});
    const [runKey, setRunKey] = useState(0);

    const activeRunIdRef = useRef(0);
    const lastAutoPostedReviewIdRef = useRef<string | null>(null);
    const latestPatchMapRef = useRef<Record<string, string>>({});

    const clearPostState = useCallback(() => {
        setPostResult(null);
        setPostMode(null);
        setPostDetail(null);
        setPostUrl(null);
        setPostedCommentCount(0);
    }, []);

    const reload = useCallback(() => {
        activeRunIdRef.current += 1;
        lastAutoPostedReviewIdRef.current = null;
        latestPatchMapRef.current = {};
        setReview(null);
        setReviewSource(null);
        setError(null);
        setFilePatches({});
        clearPostState();
        setRunKey((k) => k + 1);
    }, [clearPostState]);

    const postReviewWith = useCallback(async (
        reviewToPost: PRReview,
        prNum: number,
        minSeverity: GitHubConfig["reviewPostMinSeverity"],
        patches: Record<string, string> = latestPatchMapRef.current,
    ) => {
        setPhase("posting");
        setProgressMessage("Posting review to GitHub...");
        setError(null);
        clearPostState();

        try {
            const client = await createGitHubClient(githubConfig);
            let prepared = prepareInlineCapableSubmission(reviewToPost, minSeverity, patches);
            let result;
            let finalMode: PrReviewPostMode = prepared.inlineComments.length > 0 ? "inline" : "summary_only";
            let commentCount = prepared.inlineComments.length;
            let detail: string | null = null;

            try {
                result = await client.postReview(
                    reviewToPost.repoOwner,
                    reviewToPost.repoName,
                    prNum,
                    prepared.submission,
                );
            } catch (inlineErr: unknown) {
                if (!(inlineErr instanceof GitHubAPIError) || inlineErr.status !== 422) {
                    throw inlineErr;
                }

                const shouldDowngrade = shouldDowngradeRequestChangesForGitHub(inlineErr);
                if (shouldDowngrade) {
                    prepared = prepareInlineCapableSubmission(
                        reviewToPost,
                        minSeverity,
                        patches,
                        { event: "COMMENT" },
                    );
                    detail = "GitHub does not allow requesting changes on your own pull request. Posted as a comment instead.";
                    try {
                        result = await client.postReview(
                            reviewToPost.repoOwner,
                            reviewToPost.repoName,
                            prNum,
                            prepared.submission,
                        );
                        finalMode = prepared.inlineComments.length > 0 ? "inline" : "summary_only";
                        commentCount = prepared.inlineComments.length;
                    } catch (downgradedErr: unknown) {
                        if (!(downgradedErr instanceof GitHubAPIError) || downgradedErr.status !== 422) {
                            throw downgradedErr;
                        }
                        try {
                            result = await client.postReview(
                                reviewToPost.repoOwner,
                                reviewToPost.repoName,
                                prNum,
                                buildSummaryOnlySubmission(reviewToPost, minSeverity, { event: "COMMENT" }),
                            );
                            finalMode = "summary_only";
                            commentCount = 0;
                        } catch (summaryErr: unknown) {
                            throw new Error(buildPostErrorMessage(downgradedErr, summaryErr));
                        }
                    }
                } else {
                    try {
                        result = await client.postReview(
                            reviewToPost.repoOwner,
                            reviewToPost.repoName,
                            prNum,
                            buildSummaryOnlySubmission(reviewToPost, minSeverity),
                        );
                        finalMode = "summary_only";
                        commentCount = 0;
                    } catch (summaryErr: unknown) {
                        throw new Error(buildPostErrorMessage(inlineErr, summaryErr));
                    }
                }
            }

            const db = openProjectDatabase();
            const cache = new PRReviewCache(db);
            cache.markPosted(reviewToPost.id, prNum, reviewToPost.repoOwner, reviewToPost.repoName, result.id);
            db.close();

            setPhase("done");
            setPostResult("success");
            setPostMode(finalMode);
            setPostDetail(detail);
            setPostUrl(result.html_url);
            setPostedCommentCount(commentCount);
            setProgressMessage(
                finalMode === "summary_only"
                    ? "Review posted to GitHub (summary only)"
                    : `Review posted to GitHub (${commentCount} inline comments)`,
            );
        } catch (e: unknown) {
            const message = buildPostErrorMessage(e);
            const fullError = `Failed to post: ${message}`;
            setError(fullError);
            setPostResult("error");
            setPostMode(null);
            setPostDetail(dedupePostDetail(fullError, message));
            setPhase("error");
        }
    }, [clearPostState, githubConfig]);

    useEffect(() => {
        if (prNumber === null) return;
        const prNum = prNumber;

        const runId = activeRunIdRef.current + 1;
        activeRunIdRef.current = runId;

        async function run() {
            setPhase("fetching_pr");
            setReview(null);
            setReviewSource(null);
            setError(null);
            setProgressMessage("Connecting to GitHub...");
            clearPostState();

            let client: Awaited<ReturnType<typeof createGitHubClient>>;
            try {
                client = await createGitHubClient(githubConfig);
            } catch (e: any) {
                if (isActiveRun(activeRunIdRef, runId)) {
                    setError(e.message);
                    setPhase("error");
                }
                return;
            }

            let owner = explicitOwner || githubConfig.defaultOwner;
            let repo = explicitRepo || githubConfig.defaultRepo;

            if (!owner || !repo) {
                try {
                    ({ owner, repo } = await client.detectRepoInfo());
                } catch (e: any) {
                    if (isActiveRun(activeRunIdRef, runId)) {
                        setError(`Could not detect repo: ${e.message}`);
                        setPhase("error");
                    }
                    return;
                }
            }

            if (!isActiveRun(activeRunIdRef, runId)) return;
            setProgressMessage(`Fetching PR #${prNum}...`);

            let prData: PRData;
            let patchMap: Record<string, string>;
            try {
                setPhase("fetching_files");
                const [ghPR, ghFiles, ghCommits] = await Promise.all([
                    client.getPR(owner, repo, prNum),
                    client.getPRFiles(owner, repo, prNum),
                    client.getPRCommits(owner, repo, prNum),
                ]);
                prData = mapGitHubData(ghPR, ghFiles, ghCommits);
                patchMap = Object.fromEntries(prData.files.map((f) => [f.path, f.patch]));
            } catch (e: any) {
                if (isActiveRun(activeRunIdRef, runId)) {
                    setError(`Failed to fetch PR: ${e.message}`);
                    setPhase("error");
                }
                return;
            }

            if (!isActiveRun(activeRunIdRef, runId)) return;
            latestPatchMapRef.current = patchMap;
            setFilePatches(patchMap);

            const db = openProjectDatabase();
            const cache = new PRReviewCache(db);
            const cached = cache.get(prNum, owner, repo, prData.headSha);

            if (cached) {
                db.close();
                if (isActiveRun(activeRunIdRef, runId)) {
                    setReview(cached);
                    setReviewSource("cache");
                    setPhase("done");
                    setProgressMessage("Loaded from cache");
                }
                return;
            }

            if (!isActiveRun(activeRunIdRef, runId)) {
                db.close();
                return;
            }

            setPhase("analyzing");
            setProgressMessage("Starting analysis...");

            const llm = createChatModel(providerConfig);
            const modelName = (llm as any).modelName ?? providerConfig.provider ?? "unknown";
            const conventions = db.loadConventions().slice(0, 10).map((c) => c.pattern);

            let result: PRReview;
            try {
                result = await analyzePR(prData, conventions, llm, modelName, (msg) => {
                    if (!isActiveRun(activeRunIdRef, runId)) return;
                    if (msg.includes("Synthesizing")) setPhase("synthesizing");
                    setProgressMessage(msg);
                });
            } catch (e: any) {
                db.close();
                if (isActiveRun(activeRunIdRef, runId)) {
                    setError(`Analysis failed: ${e.message}`);
                    setPhase("error");
                }
                return;
            }

            if (!isActiveRun(activeRunIdRef, runId)) {
                db.close();
                return;
            }

            result = { ...result, repoOwner: owner, repoName: repo };
            cache.save(result);
            db.close();

            setReview(result);
            setReviewSource("fresh");
            setPhase("done");
            setProgressMessage("Review complete");
        }

        void run();
    }, [
        prNumber,
        explicitOwner,
        explicitRepo,
        providerFingerprint,
        githubReviewFingerprint,
        runKey,
        clearPostState,
    ]);

    useEffect(() => {
        if (!autoPost || !review || !prNumber || reviewSource !== "fresh") return;

        const key = `${review.id}:${review.headSha}:${prNumber}`;
        if (lastAutoPostedReviewIdRef.current === key) return;
        lastAutoPostedReviewIdRef.current = key;
        void postReviewWith(review, prNumber, postMinSeverity, latestPatchMapRef.current);
    }, [autoPost, review, prNumber, reviewSource, postMinSeverity, postReviewWith]);

    const postReview = useCallback(async () => {
        if (!review || !prNumber) return;
        await postReviewWith(review, prNumber, postMinSeverity, latestPatchMapRef.current);
    }, [review, prNumber, postMinSeverity, postReviewWith]);

    return {
        review,
        phase,
        progressMessage,
        error,
        postResult,
        postMode,
        postDetail,
        postUrl,
        postedCommentCount,
        filePatches,
        postReview,
        reload,
    };
}
