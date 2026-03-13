/**
 * GitHub auth helpers.
 * Provides token resolution with `gh` fallback and auth-recovery commands.
 */

import { execa } from "execa";
import type { GitHubConfig } from "../config/settings.js";
import {
    GitHubAPIError,
    GitHubAuthError,
    GitHubClient,
    RateLimitError,
} from "./client.js";

export type GitHubTokenSource = "config" | "env" | "gh";
export type GitHubErrorKind = "auth" | "repo" | "rate_limit" | "network" | "unknown";

export interface ResolvedGitHubToken {
    token: string;
    source: GitHubTokenSource;
}

export interface GhLoginOptions {
    host?: string;
    scopes?: string[];
}

export const DEFAULT_GH_LOGIN_SCOPES = ["repo", "read:org", "workflow", "gist"];
export const GITHUB_CLI_AUTH_DOCS = "https://cli.github.com/manual/gh_auth_login";
export const GITHUB_PAT_DOCS = "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens";
export const MYGIT_GITHUB_CONFIG_DOCS = "https://github.com/sorourf/MyGit/blob/main/docs/configuration.md#github";

function deviceLoginUrlForHost(host: string): string {
    if (host === "github.com") return "https://github.com/login/device";
    return `https://${host}/login/device`;
}

async function openBrowserUrl(url: string): Promise<void> {
    const platform = process.platform;
    if (platform === "darwin") {
        await execa("open", [url], { reject: false, stdout: "ignore", stderr: "ignore" });
        return;
    }
    if (platform === "win32") {
        await execa("cmd", ["/c", "start", "", url], { reject: false, stdout: "ignore", stderr: "ignore" });
        return;
    }
    await execa("xdg-open", [url], { reject: false, stdout: "ignore", stderr: "ignore" });
}

export function hostFromApiUrl(apiUrl: string): string {
    try {
        const url = new URL(apiUrl);
        if (url.hostname === "api.github.com") return "github.com";
        return url.hostname;
    } catch {
        return "github.com";
    }
}

export async function isGhAvailable(): Promise<boolean> {
    try {
        const res = await execa("gh", ["--version"], { reject: false });
        return res.exitCode === 0;
    } catch {
        return false;
    }
}

export async function isGhAuthenticated(host = "github.com"): Promise<boolean> {
    try {
        const res = await execa("gh", ["auth", "status", "--hostname", host], { reject: false });
        return res.exitCode === 0;
    } catch {
        return false;
    }
}

async function tokenFromGh(host: string): Promise<string> {
    try {
        const args = ["auth", "token", "--hostname", host];
        const res = await execa("gh", args, { reject: false });
        if (res.exitCode !== 0) return "";
        return res.stdout.trim();
    } catch {
        return "";
    }
}

export async function resolveGitHubToken(config: GitHubConfig): Promise<ResolvedGitHubToken> {
    const configToken = config.token?.trim();
    if (configToken) {
        return { token: configToken, source: "config" };
    }

    const envToken = (process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "");
    if (envToken) {
        return { token: envToken, source: "env" };
    }

    const host = hostFromApiUrl(config.apiUrl);
    const ghToken = await tokenFromGh(host);
    if (ghToken) {
        return { token: ghToken, source: "gh" };
    }

    throw new GitHubAuthError();
}

export async function createGitHubClient(config: GitHubConfig): Promise<GitHubClient> {
    const { token } = await resolveGitHubToken(config);
    return new GitHubClient(config, token);
}

export async function runGhWebLogin(opts: GhLoginOptions = {}): Promise<{ ok: boolean; message: string }> {
    const host = opts.host ?? "github.com";
    const scopes = (opts.scopes && opts.scopes.length > 0) ? opts.scopes : DEFAULT_GH_LOGIN_SCOPES;
    const deviceUrl = deviceLoginUrlForHost(host);
    const args = [
        "auth",
        "login",
        "--web",
        "--clipboard",
        "--hostname",
        host,
        "--git-protocol",
        "https",
        "--skip-ssh-key",
        "--scopes",
        scopes.join(","),
    ];

    let res: Awaited<ReturnType<typeof execa>>;
    try {
        // Best effort: open the device login page immediately so user doesn't need to cmd/ctrl-click links.
        await openBrowserUrl(deviceUrl);

        res = await execa("gh", args, {
            reject: false,
            stdio: ["pipe", "inherit", "inherit"],
            // Auto-confirm initial prompt that opens browser in some terminals.
            input: "\n",
        });
    } catch {
        return { ok: false, message: "GitHub CLI (`gh`) is not available in this shell." };
    }

    if (res.exitCode === 0) {
        return { ok: true, message: "GitHub CLI authentication completed." };
    }
    return { ok: false, message: "GitHub CLI authentication did not complete successfully." };
}

export function classifyGitHubError(err: unknown): GitHubErrorKind {
    if (err instanceof GitHubAuthError) return "auth";
    if (err instanceof RateLimitError) return "rate_limit";
    if (err instanceof GitHubAPIError) {
        if (err.status === 401 || err.status === 403) return "auth";
        if (err.status === 404) return "repo";
        return "unknown";
    }

    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (msg.includes("could not detect git remote") || msg.includes("unrecognized remote")) return "repo";
    if (msg.includes("network") || msg.includes("fetch failed") || msg.includes("enotfound")) return "network";
    return "unknown";
}
