/**
 * PR review CLI commands.
 * Usage:
 *   mygit pr list [--state open|closed|all] [--limit 20]
 *   mygit pr review <number> [--no-cache] [--post] [--model <model>]
 *   mygit pr post <number>
 */

import { Command } from "commander";
import { loadConfig } from "../config/settings.js";
import { openProjectDatabase } from "../storage/database.js";
import { GitHubAPIError, type GitHubClient } from "../github/client.js";
import { createGitHubClient } from "../github/auth.js";
import { PRReviewCache } from "../pr/cache.js";
import { analyzePR } from "../pr/analyzer.js";
import {
    buildSummaryOnlySubmission,
    prepareInlineCapableSubmission,
    shouldDowngradeRequestChangesForGitHub,
} from "../pr/posting.js";
import type { PRData, PRFile, PRCommit, PRReview } from "../pr/types.js";
import type { GitHubPR, GitHubPRFile, GitHubPRCommit } from "../github/types.js";

// ── Helpers ───────────────────────────────────────────────────────────

function mapGitHubPRData(
    pr: GitHubPR,
    files: GitHubPRFile[],
    commits: GitHubPRCommit[],
): PRData {
    const mappedFiles: PRFile[] = files.map(f => ({
        path: f.filename,
        previousPath: f.previous_filename,
        status: (f.status === "removed" ? "removed" :
                 f.status === "added" ? "added" :
                 f.status === "renamed" ? "renamed" : "modified") as PRFile["status"],
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? "",
    }));

    const mappedCommits: PRCommit[] = commits.map(c => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.commit.author.name,
        date: c.commit.author.date,
    }));

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
        files: mappedFiles,
        commits: mappedCommits,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
    };
}

function decisionIcon(decision: string): string {
    if (decision === "approve") return "✅";
    if (decision === "request_changes") return "❌";
    return "💬";
}

// ── Command ───────────────────────────────────────────────────────────

export function prCommand(): Command {
    const pr = new Command("pr").description("Pull request management with AI review");

    // ── pr list ───────────────────────────────────────────────────────
    pr
        .command("list")
        .description("List pull requests for the current repo")
        .option("--state <state>", "Filter by state: open, closed, all", "open")
        .option("--limit <n>", "Maximum PRs to show", "20")
        .action(async (opts) => {
            const config = await loadConfig();

            let client: GitHubClient;
            try {
                client = await createGitHubClient(config.github);
            } catch (e: any) {
                console.error(`GitHub auth error: ${e.message}`);
                process.exit(1);
            }

            let owner = config.github.defaultOwner;
            let repo = config.github.defaultRepo;

            if (!owner || !repo) {
                try {
                    ({ owner, repo } = await client.detectRepoInfo());
                } catch (e: any) {
                    console.error(`Could not detect repo: ${e.message}`);
                    process.exit(1);
                }
            }

            console.log(`Fetching PRs for ${owner}/${repo}...`);

            try {
                const prs = await client.listPRs(owner, repo, opts.state as "open" | "closed" | "all", parseInt(opts.limit, 10));

                if (prs.length === 0) {
                    console.log(`No ${opts.state} pull requests found.`);
                    return;
                }

                console.log(`\n${opts.state.toUpperCase()} PULL REQUESTS — ${owner}/${repo}\n`);
                for (const p of prs) {
                    const draft = p.draft ? " [DRAFT]" : "";
                    const age = Math.floor((Date.now() - new Date(p.updated_at).getTime()) / (1000 * 60 * 60 * 24));
                    console.log(`  #${p.number} ${p.title}${draft}`);
                    console.log(`         by @${p.user.login} · ${p.head.ref} → ${p.base.ref} · ${age}d ago`);
                    console.log(`         +${p.additions}/-${p.deletions} in ${p.changed_files} files`);
                    console.log();
                }
            } catch (e: any) {
                console.error(`Failed to list PRs: ${e.message}`);
                process.exit(1);
            }
        });

    // ── pr review ─────────────────────────────────────────────────────
    pr
        .command("review <number>")
        .description("Generate an AI code review for a pull request")
        .option("--no-cache", "Skip cache, regenerate review")
        .option("--post", "Post review to GitHub after generation")
        .option("--model <model>", "Override the AI model used for review")
        .action(async (numberStr, opts) => {
            const prNumber = parseInt(numberStr, 10);
            if (isNaN(prNumber)) {
                console.error("Invalid PR number.");
                process.exit(1);
            }

            const config = await loadConfig();
            const db = openProjectDatabase();
            const cache = new PRReviewCache(db);

            let client: GitHubClient;
            try {
                client = await createGitHubClient(config.github);
            } catch (e: any) {
                console.error(`GitHub auth error: ${e.message}`);
                db.close();
                process.exit(1);
            }

            let owner = config.github.defaultOwner;
            let repo = config.github.defaultRepo;

            if (!owner || !repo) {
                try {
                    ({ owner, repo } = await client.detectRepoInfo());
                } catch (e: any) {
                    console.error(`Could not detect repo: ${e.message}`);
                    db.close();
                    process.exit(1);
                }
            }

            console.log(`Fetching PR #${prNumber} from ${owner}/${repo}...`);

            let prData: PRData;
            try {
                const [ghPR, ghFiles, ghCommits] = await Promise.all([
                    client.getPR(owner, repo, prNumber),
                    client.getPRFiles(owner, repo, prNumber),
                    client.getPRCommits(owner, repo, prNumber),
                ]);
                prData = mapGitHubPRData(ghPR, ghFiles, ghCommits);
            } catch (e: any) {
                console.error(`Failed to fetch PR: ${e.message}`);
                db.close();
                process.exit(1);
            }

            console.log(`PR: ${prData.title}`);
            console.log(`    ${prData.headBranch} → ${prData.baseBranch}`);
            console.log(`    ${prData.changedFiles} files changed (+${prData.totalAdditions}/-${prData.totalDeletions})`);

            // Check cache first (unless --no-cache)
            if (opts.cache !== false) {
                const cached = cache.get(prNumber, owner, repo, prData.headSha);
                if (cached) {
                    console.log(`\n[Cached review from ${new Date(cached.generatedAt).toLocaleString()}]\n`);
                    printReviewSummary(cached);

                    if (opts.post) {
                        await postReviewToGitHub(client, owner, repo, prNumber, prData.headSha, cached, cache);
                    }
                    db.close();
                    return;
                }
            }

            // Load LLM
            const { getModel } = await import("../llm/providers.js");
            if (opts.model) {
                if (config.provider === "ollama") config.ollama.model = opts.model;
                else if (config.provider === "google") config.google.model = opts.model;
            }
            const llm = await getModel(config);
            const modelName = (llm as any).modelName ?? opts.model ?? config.provider;

            // Load conventions for better review context
            const conventions = db.loadConventions().slice(0, 10).map(c => c.pattern);

            console.log(`\nAnalyzing ${prData.files.filter(f => f.patch).length} files with ${modelName}...\n`);

            let review = await analyzePR(prData, conventions, llm, modelName, (msg) => {
                process.stdout.write(`\r${msg}                    `);
            });

            process.stdout.write("\n");

            // Attach owner/repo
            review = { ...review, repoOwner: owner, repoName: repo };

            // Cache the result
            cache.save(review);

            printReviewSummary(review);

            if (opts.post) {
                await postReviewToGitHub(client, owner, repo, prNumber, prData.headSha, review, cache);
            }

            db.close();
        });

    // ── pr post ───────────────────────────────────────────────────────
    pr
        .command("post <number>")
        .description("Post a cached AI review for a PR to GitHub")
        .action(async (numberStr) => {
            const prNumber = parseInt(numberStr, 10);
            if (isNaN(prNumber)) {
                console.error("Invalid PR number.");
                process.exit(1);
            }

            const config = await loadConfig();
            const db = openProjectDatabase();
            const cache = new PRReviewCache(db);

            let client: GitHubClient;
            try {
                client = await createGitHubClient(config.github);
            } catch (e: any) {
                console.error(`GitHub auth error: ${e.message}`);
                db.close();
                process.exit(1);
            }

            let owner = config.github.defaultOwner;
            let repo = config.github.defaultRepo;

            if (!owner || !repo) {
                try {
                    ({ owner, repo } = await client.detectRepoInfo());
                } catch (e: any) {
                    console.error(`Could not detect repo: ${e.message}`);
                    db.close();
                    process.exit(1);
                }
            }

            const reviews = cache.list(owner, repo, 5);
            const latest = reviews.find(r => r.prNumber === prNumber);

            if (!latest) {
                console.error(`No cached review found for PR #${prNumber}. Run 'mygit pr review ${prNumber}' first.`);
                db.close();
                process.exit(1);
            }

            // Fetch current head SHA to look up cached review
            let headSha: string;
            try {
                const ghPR = await client.getPR(owner, repo, prNumber);
                headSha = ghPR.head.sha;
            } catch (e: any) {
                console.error(`Failed to fetch PR: ${e.message}`);
                db.close();
                process.exit(1);
            }

            const review = cache.get(prNumber, owner, repo, headSha);
            if (!review) {
                console.error(`Cached review is stale (new commits pushed). Run 'mygit pr review ${prNumber}' to regenerate.`);
                db.close();
                process.exit(1);
            }

            await postReviewToGitHub(client, owner, repo, prNumber, headSha, review, cache);
            db.close();
        });

    return pr;
}

// ── Output Helpers ────────────────────────────────────────────────────

function printReviewSummary(review: PRReview) {
    const icon = decisionIcon(review.overallDecision);
    const decision = review.overallDecision.replace(/_/g, " ").toUpperCase();

    console.log(`\n${"─".repeat(60)}`);
    console.log(`${icon} ${decision}  |  Risk: ${review.riskScore}/10`);
    console.log(`${"─".repeat(60)}`);
    console.log(`\n${review.overallSummary}\n`);

    const critical = review.comments.filter(c => c.severity === "critical");
    const major = review.comments.filter(c => c.severity === "major");
    const minor = review.comments.filter(c => c.severity === "minor");
    const suggestions = review.comments.filter(c => c.severity === "suggestion");

    if (critical.length > 0) {
        console.log(`CRITICAL (${critical.length}):`);
        for (const c of critical) {
            console.log(`  [${c.category}] ${c.title} — ${c.filePath}${c.line ? `:${c.line}` : ""}`);
        }
        console.log();
    }

    if (major.length > 0) {
        console.log(`MAJOR (${major.length}):`);
        for (const c of major.slice(0, 5)) {
            console.log(`  [${c.category}] ${c.title} — ${c.filePath}${c.line ? `:${c.line}` : ""}`);
        }
        if (major.length > 5) console.log(`  ... and ${major.length - 5} more`);
        console.log();
    }

    if (minor.length + suggestions.length > 0) {
        console.log(`OTHER: ${minor.length} minor, ${suggestions.length} suggestions`);
    }

    console.log(`\nTotal: ${review.comments.length} comments across ${review.fileSummaries.length} files`);
    console.log(`Model: ${review.modelUsed}  |  Generated: ${new Date(review.generatedAt).toLocaleString()}`);
}

async function postReviewToGitHub(
    client: GitHubClient,
    owner: string,
    repo: string,
    prNumber: number,
    headSha: string,
    review: PRReview,
    cache: PRReviewCache,
): Promise<void> {
    console.log("\nPosting review to GitHub...");

    try {
        let prepared = prepareInlineCapableSubmission({ ...review, headSha }, "suggestion", {});
        let result;
        let mode: "inline" | "summary_only" = prepared.inlineComments.length > 0 ? "inline" : "summary_only";
        let downgradedSelfReview = false;
        try {
            result = await client.postReview(owner, repo, prNumber, prepared.submission);
        } catch (e: any) {
            if (!(e instanceof GitHubAPIError) || e.status !== 422) {
                throw e;
            }
            if (shouldDowngradeRequestChangesForGitHub(e)) {
                prepared = prepareInlineCapableSubmission(
                    { ...review, headSha },
                    "suggestion",
                    {},
                    { event: "COMMENT" },
                );
                downgradedSelfReview = true;
                try {
                    result = await client.postReview(owner, repo, prNumber, prepared.submission);
                    mode = prepared.inlineComments.length > 0 ? "inline" : "summary_only";
                } catch (downgradedErr: any) {
                    if (!(downgradedErr instanceof GitHubAPIError) || downgradedErr.status !== 422) {
                        throw downgradedErr;
                    }
                    try {
                        result = await client.postReview(
                            owner,
                            repo,
                            prNumber,
                            buildSummaryOnlySubmission({ ...review, headSha }, "suggestion", { event: "COMMENT" }),
                        );
                        mode = "summary_only";
                    } catch (fallbackErr: any) {
                        throw new Error(`${downgradedErr.message}; summary-only retry failed: ${fallbackErr.message}`);
                    }
                }
            } else {
                try {
                    result = await client.postReview(
                        owner,
                        repo,
                        prNumber,
                        buildSummaryOnlySubmission({ ...review, headSha }),
                    );
                    mode = "summary_only";
                } catch (fallbackErr: any) {
                    throw new Error(`${e.message}; summary-only retry failed: ${fallbackErr.message}`);
                }
            }
        }

        cache.markPosted(review.id, prNumber, owner, repo, result.id);
        if (downgradedSelfReview) {
            console.log("GitHub rejected REQUEST_CHANGES on your own pull request, so the review was posted as a comment.");
        }
        console.log(
            mode === "summary_only"
                ? `Review posted: ${result.html_url} (summary only)`
                : `Review posted: ${result.html_url} (${prepared.inlineComments.length} inline comments)`,
        );
    } catch (e: any) {
        console.error(`Failed to post review: ${e.message}`);
    }
}
