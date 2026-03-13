/**
 * Raw GitHub REST API shapes.
 * These mirror the GitHub API v3 response structures exactly.
 */

export interface GitHubUser {
    login: string;
    id: number;
    avatar_url: string;
    html_url: string;
}

export interface GitHubRepoOwner {
    login: string;
}

export interface GitHubRepo {
    name: string;
    full_name: string;
    owner: GitHubRepoOwner;
    private: boolean;
    updated_at: string;
    html_url: string;
}

/** Extended repo info returned by GET /repos/{owner}/{repo} — includes fork relationship. */
export interface GitHubRepoDetail extends GitHubRepo {
    fork: boolean;
    clone_url: string;
    parent?: { full_name: string; html_url: string; clone_url: string };
    source?: { full_name: string; html_url: string; clone_url: string };
}

export interface GitHubBranch {
    ref: string;
    sha: string;
    repo: {
        name: string;
        full_name: string;
        private: boolean;
        html_url: string;
    } | null;
}

export interface GitHubPR {
    number: number;
    title: string;
    body: string | null;
    state: "open" | "closed";
    draft: boolean;
    merged: boolean;
    mergeable: boolean | null;
    user: GitHubUser;
    head: GitHubBranch;
    base: GitHubBranch;
    additions: number;
    deletions: number;
    changed_files: number;
    commits: number;
    html_url: string;
    created_at: string;
    updated_at: string;
    merged_at: string | null;
}

export interface GitHubPRFile {
    filename: string;
    status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
    blob_url: string;
    raw_url: string;
    previous_filename?: string;
}

export interface GitHubPRCommit {
    sha: string;
    commit: {
        message: string;
        author: {
            name: string;
            email: string;
            date: string;
        };
    };
    author: GitHubUser | null;
}

export interface GitHubReviewComment {
    path: string;
    line?: number;
    side?: "LEFT" | "RIGHT";
    body: string;
}

export interface GitHubReviewSubmission {
    body: string;
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    comments?: GitHubReviewComment[];
    commit_id?: string;
}

export interface GitHubReviewResponse {
    id: number;
    body: string;
    state: string;
    html_url: string;
    submitted_at: string;
}
