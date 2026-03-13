/**
 * GitHub REST API client.
 * Uses Bun's built-in fetch — no external dependencies.
 */

import { execa } from "execa";
import type { GitHubConfig } from "../config/settings.js";
import type {
    GitHubRepo,
    GitHubRepoDetail,
    GitHubPR,
    GitHubPRFile,
    GitHubPRCommit,
    GitHubReviewSubmission,
    GitHubReviewResponse,
} from "./types.js";

// ── Error Types ────────────────────────────────────────────────────────

export class GitHubAPIError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(`GitHub API error ${status}: ${message}`);
        this.name = "GitHubAPIError";
    }
}

export class RateLimitError extends Error {
    constructor(public readonly resetAt: number) {
        const resetTime = new Date(resetAt * 1000).toISOString();
        super(`GitHub rate limit exceeded. Resets at ${resetTime}`);
        this.name = "RateLimitError";
    }
}

export class GitHubAuthError extends Error {
    constructor() {
        super("GitHub token not configured. Run `gh auth login --web` or set GITHUB_TOKEN/github.token.");
        this.name = "GitHubAuthError";
    }
}

// ── Client ─────────────────────────────────────────────────────────────

export class GitHubClient {
    private readonly token: string;
    private readonly apiUrl: string;

    constructor(config: GitHubConfig, tokenOverride?: string) {
        const token = tokenOverride ?? config.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
        if (!token) {
            throw new GitHubAuthError();
        }
        this.token = token;
        this.apiUrl = config.apiUrl.replace(/\/$/, "");
    }

    private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.apiUrl}${path}`;
        const res = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "mygit-cli",
                ...(options.headers ?? {}),
            },
        });

        const remaining = res.headers.get("X-RateLimit-Remaining");
        if (remaining !== null && parseInt(remaining, 10) === 0) {
            const reset = res.headers.get("X-RateLimit-Reset");
            throw new RateLimitError(reset ? parseInt(reset, 10) : 0);
        }

        if (res.status === 401) {
            throw new GitHubAuthError();
        }

        if (!res.ok) {
            let message: string;
            try {
                const body = await res.json() as {
                    message?: string;
                    errors?: Array<string | { message?: string; code?: string; field?: string }>;
                };
                const details = Array.isArray(body.errors)
                    ? body.errors
                        .map((entry) => {
                            if (typeof entry === "string") return entry;
                            return [entry.field, entry.code, entry.message].filter(Boolean).join(" ");
                        })
                        .filter(Boolean)
                    : [];
                message = [body.message ?? res.statusText, ...details].join(": ");
            } catch {
                message = res.statusText;
            }
            throw new GitHubAPIError(res.status, message);
        }

        return res.json() as Promise<T>;
    }

    // ── Repo Detection ───────────────────────────────────────────────

    /**
     * Parse owner/repo from git remote origin URL.
     * Handles both HTTPS (https://github.com/owner/repo.git)
     * and SSH (git@github.com:owner/repo.git) formats.
     */
    async detectRepoInfo(): Promise<{ owner: string; repo: string }> {
        const result = await execa("git", ["remote", "get-url", "origin"], {
            reject: false,
            cwd: process.cwd(),
        });

        if (result.exitCode !== 0 || !result.stdout) {
            throw new Error("Could not detect git remote origin. Is this a git repository with a remote?");
        }

        const url = result.stdout.trim();

        // SSH: git@github.com:owner/repo.git
        const sshMatch = url.match(/git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
        if (sshMatch) {
            return { owner: sshMatch[1], repo: sshMatch[2] };
        }

        // HTTPS: https://github.com/owner/repo.git
        const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
        if (httpsMatch) {
            return { owner: httpsMatch[1], repo: httpsMatch[2] };
        }

        throw new Error(`Unrecognized remote URL format: ${url}`);
    }

    // ── PR Operations ────────────────────────────────────────────────

    async listPRs(
        owner: string,
        repo: string,
        state: "open" | "closed" | "all" = "open",
        perPage = 20,
        page = 1,
    ): Promise<GitHubPR[]> {
        return this.request<GitHubPR[]>(
            `/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}&page=${page}&sort=updated&direction=desc`,
        );
    }

    async listAccessibleRepos(page = 1, perPage = 100): Promise<GitHubRepo[]> {
        return this.request<GitHubRepo[]>(
            `/user/repos?per_page=${perPage}&page=${page}&sort=updated&direction=desc`,
        );
    }

    async getPR(owner: string, repo: string, number: number): Promise<GitHubPR> {
        return this.request<GitHubPR>(`/repos/${owner}/${repo}/pulls/${number}`);
    }

    async getPRFiles(owner: string, repo: string, number: number): Promise<GitHubPRFile[]> {
        return this.request<GitHubPRFile[]>(
            `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`,
        );
    }

    async getPRCommits(owner: string, repo: string, number: number): Promise<GitHubPRCommit[]> {
        return this.request<GitHubPRCommit[]>(
            `/repos/${owner}/${repo}/pulls/${number}/commits?per_page=100`,
        );
    }

    /**
     * Fetch the raw unified diff for the entire PR.
     */
    async getPRDiff(owner: string, repo: string, number: number): Promise<string> {
        const url = `${this.apiUrl}/repos/${owner}/${repo}/pulls/${number}`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: "application/vnd.github.diff",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "mygit-cli",
            },
        });

        if (!res.ok) {
            throw new GitHubAPIError(res.status, res.statusText);
        }
        return res.text();
    }

    async postReview(
        owner: string,
        repo: string,
        number: number,
        review: GitHubReviewSubmission,
    ): Promise<GitHubReviewResponse> {
        return this.request<GitHubReviewResponse>(
            `/repos/${owner}/${repo}/pulls/${number}/reviews`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(review),
            },
        );
    }

    // ── Repo Info ─────────────────────────────────────────────────────

    async getRepo(owner: string, repo: string): Promise<GitHubRepoDetail> {
        return this.request<GitHubRepoDetail>(`/repos/${owner}/${repo}`);
    }

    // ── Auth Check ───────────────────────────────────────────────────

    async checkAuth(): Promise<{ login: string; scopes: string[] }> {
        const url = `${this.apiUrl}/user`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "mygit-cli",
            },
        });

        if (!res.ok) {
            throw new GitHubAuthError();
        }

        const scopes = res.headers.get("X-OAuth-Scopes") ?? "";
        const user = await res.json() as { login: string };
        return {
            login: user.login,
            scopes: scopes.split(",").map(s => s.trim()).filter(Boolean),
        };
    }
}
