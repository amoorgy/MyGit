import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubConfig } from "../config/settings.js";

const execaMock = vi.fn();

vi.mock("execa", () => ({
    execa: (...args: any[]) => execaMock(...args),
}));

import { classifyGitHubError, hostFromApiUrl, resolveGitHubToken, runGhWebLogin } from "../github/auth.js";
import { GitHubAPIError, GitHubAuthError } from "../github/client.js";

const BASE_CONFIG: GitHubConfig = {
    token: "",
    apiUrl: "https://api.github.com",
    defaultOwner: "",
    defaultRepo: "",
    reviewAutoPost: false,
    reviewPostMinSeverity: "major",
    prInboxDefaultState: "all",
};

describe("github auth helpers", () => {
    const prevGithubToken = process.env.GITHUB_TOKEN;
    const prevGhToken = process.env.GH_TOKEN;

    beforeEach(() => {
        execaMock.mockReset();
        delete process.env.GITHUB_TOKEN;
        delete process.env.GH_TOKEN;
    });

    afterEach(() => {
        if (prevGithubToken === undefined) delete process.env.GITHUB_TOKEN;
        else process.env.GITHUB_TOKEN = prevGithubToken;
        if (prevGhToken === undefined) delete process.env.GH_TOKEN;
        else process.env.GH_TOKEN = prevGhToken;
    });

    it("prefers config token over env and gh", async () => {
        process.env.GITHUB_TOKEN = "env-token";
        const resolved = await resolveGitHubToken({ ...BASE_CONFIG, token: "cfg-token" });
        expect(resolved).toEqual({ token: "cfg-token", source: "config" });
        expect(execaMock).not.toHaveBeenCalled();
    });

    it("uses GITHUB_TOKEN env when config token is missing", async () => {
        process.env.GITHUB_TOKEN = "env-token";
        const resolved = await resolveGitHubToken(BASE_CONFIG);
        expect(resolved).toEqual({ token: "env-token", source: "env" });
        expect(execaMock).not.toHaveBeenCalled();
    });

    it("falls back to gh auth token when config/env are missing", async () => {
        execaMock.mockResolvedValueOnce({ exitCode: 0, stdout: "gh-token\n" });

        const resolved = await resolveGitHubToken(BASE_CONFIG);
        expect(resolved).toEqual({ token: "gh-token", source: "gh" });
        expect(execaMock).toHaveBeenCalledWith(
            "gh",
            ["auth", "token", "--hostname", "github.com"],
            { reject: false },
        );
    });

    it("throws GitHubAuthError when no token source resolves", async () => {
        execaMock.mockResolvedValueOnce({ exitCode: 1, stdout: "" });
        await expect(resolveGitHubToken(BASE_CONFIG)).rejects.toBeInstanceOf(GitHubAuthError);
    });

    it("maps api.github.com to github.com host", () => {
        expect(hostFromApiUrl("https://api.github.com")).toBe("github.com");
        expect(hostFromApiUrl("https://ghe.example.com/api/v3")).toBe("ghe.example.com");
    });

    it("classifies auth and repo errors", () => {
        expect(classifyGitHubError(new GitHubAuthError())).toBe("auth");
        expect(classifyGitHubError(new GitHubAPIError(404, "Not Found"))).toBe("repo");
        expect(classifyGitHubError(new GitHubAPIError(401, "Bad credentials"))).toBe("auth");
    });

    it("runs gh web login with clipboard mode and auto-enter input", async () => {
        const openCmd = process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
                ? "cmd"
                : "xdg-open";
        execaMock
            .mockResolvedValueOnce({ exitCode: 0, stdout: "" })
            .mockResolvedValueOnce({ exitCode: 0, stdout: "" });

        const result = await runGhWebLogin({ host: "github.com" });

        expect(result.ok).toBe(true);
        expect(execaMock).toHaveBeenNthCalledWith(
            1,
            openCmd,
            expect.any(Array),
            expect.objectContaining({ reject: false }),
        );
        expect(execaMock).toHaveBeenNthCalledWith(
            2,
            "gh",
            expect.arrayContaining(["auth", "login", "--web", "--clipboard"]),
            expect.objectContaining({
                reject: false,
                stdio: ["pipe", "inherit", "inherit"],
                input: "\n",
            }),
        );
    });
});
