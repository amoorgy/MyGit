/**
 * PR review cache — thin wrapper around MyGitDatabase.
 * Cache is keyed by (prNumber, owner, repo, headSha) so it auto-invalidates
 * when new commits are pushed to the PR branch.
 */

import type { MyGitDatabase } from "../storage/database.js";
import type { PRReview } from "./types.js";

export class PRReviewCache {
    constructor(private readonly db: MyGitDatabase) {}

    get(prNumber: number, owner: string, repo: string, headSha: string): PRReview | null {
        return this.db.getCachedPRReview(prNumber, owner, repo, headSha);
    }

    save(review: PRReview): void {
        this.db.savePRReview(review);
    }

    list(owner: string, repo: string, limit = 20) {
        return this.db.listCachedPRReviews(owner, repo, limit);
    }

    markPosted(reviewId: string, prNumber: number, owner: string, repo: string, githubReviewId: number): void {
        this.db.markPRReviewPosted(reviewId, prNumber, owner, repo, githubReviewId);
    }
}
