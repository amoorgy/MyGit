/**
 * usePrInbox — PR inbox state machine (auth, repo pick, PR listing).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, repoConfigPath, saveConfig, type GitHubConfig } from "../../config/settings.js";
import type { GitHubPR, GitHubRepo } from "../../github/types.js";
import {
    GITHUB_CLI_AUTH_DOCS,
    GITHUB_PAT_DOCS,
    MYGIT_GITHUB_CONFIG_DOCS,
    classifyGitHubError,
    createGitHubClient,
    hostFromApiUrl,
    isGhAuthenticated,
    isGhAvailable,
    resolveGitHubToken,
    runGhWebLogin,
} from "../../github/auth.js";
import type { GitHubClient } from "../../github/client.js";

export type PrInboxPhase =
    | "loading"
    | "auth_required"
    | "repo_picker"
    | "ready"
    | "error"
    | "authorizing";

export interface InboxRepo {
    owner: string;
    repo: string;
    fullName: string;
    private: boolean;
    updatedAt: string;
    htmlUrl: string;
}

export interface UsePrInboxReturn {
    phase: PrInboxPhase;
    error: string | null;
    progressMessage: string;
    selectedRepo: InboxRepo | null;
    repos: InboxRepo[];
    prs: GitHubPR[];
    stateFilter: GitHubConfig["prInboxDefaultState"];
    hasMoreRepos: boolean;
    isLoadingMoreRepos: boolean;
    authCommand: string;
    docsLinks: {
        ghAuth: string;
        pat: string;
        config: string;
    };
    setStateFilter: (next: GitHubConfig["prInboxDefaultState"]) => Promise<void>;
    selectRepo: (repo: InboxRepo) => Promise<void>;
    openRepoPicker: () => Promise<void>;
    loadMoreRepos: () => Promise<void>;
    refresh: () => void;
    startAuthFlow: () => Promise<boolean>;
}

export function filterPRsByState(
    prs: GitHubPR[],
    state: GitHubConfig["prInboxDefaultState"],
): GitHubPR[] {
    if (state === "all") return prs;
    if (state === "open") return prs.filter((pr) => pr.state === "open");
    if (state === "closed") return prs.filter((pr) => pr.state === "closed" && !pr.merged);
    return prs.filter((pr) => pr.merged || pr.merged_at !== null);
}

function mapRepo(r: GitHubRepo): InboxRepo {
    return {
        owner: r.owner.login,
        repo: r.name,
        fullName: r.full_name,
        private: r.private,
        updatedAt: r.updated_at,
        htmlUrl: r.html_url,
    };
}

function normalizeStateFilter(
    state: GitHubConfig["prInboxDefaultState"],
): GitHubConfig["prInboxDefaultState"] {
    if (state === "open" || state === "closed" || state === "merged" || state === "all") {
        return state;
    }
    return "all";
}

export function usePrInbox(githubConfig: GitHubConfig): UsePrInboxReturn {
    const [phase, setPhase] = useState<PrInboxPhase>("loading");
    const [error, setError] = useState<string | null>(null);
    const [progressMessage, setProgressMessage] = useState("Connecting to GitHub...");
    const [selectedRepo, setSelectedRepo] = useState<InboxRepo | null>(null);
    const [repos, setRepos] = useState<InboxRepo[]>([]);
    const [prs, setPrs] = useState<GitHubPR[]>([]);
    const [stateFilter, setStateFilterValue] = useState<GitHubConfig["prInboxDefaultState"]>(
        normalizeStateFilter(githubConfig.prInboxDefaultState),
    );
    const [repoPage, setRepoPage] = useState(0);
    const [hasMoreRepos, setHasMoreRepos] = useState(true);
    const [isLoadingMoreRepos, setIsLoadingMoreRepos] = useState(false);
    const [runKey, setRunKey] = useState(0);

    const clientRef = useRef<GitHubClient | null>(null);
    const stateFilterRef = useRef<GitHubConfig["prInboxDefaultState"]>(stateFilter);

    useEffect(() => {
        stateFilterRef.current = stateFilter;
    }, [stateFilter]);

    const authCommand = `gh auth login --web --hostname ${hostFromApiUrl(githubConfig.apiUrl)} --git-protocol https --skip-ssh-key --scopes repo,read:org,workflow,gist`;

    const docsLinks = {
        ghAuth: GITHUB_CLI_AUTH_DOCS,
        pat: GITHUB_PAT_DOCS,
        config: MYGIT_GITHUB_CONFIG_DOCS,
    };

    const sleep = useCallback(async (ms: number) => {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
    }, []);

    const verifyAuth = useCallback(async (): Promise<boolean> => {
        try {
            const client = await createGitHubClient(githubConfig);
            await client.checkAuth();
            return true;
        } catch {
            return false;
        }
    }, [githubConfig]);

    const persistResolvedToken = useCallback(async (): Promise<void> => {
        try {
            const { token } = await resolveGitHubToken(githubConfig);
            if (!token) return;

            const config = await loadConfig();
            if (config.github.token === token) return;
            config.github.token = token;
            await saveConfig(config, repoConfigPath());
        } catch {
            // Best effort only; auth can still work via env/gh fallback.
        }
    }, [githubConfig]);

    const loadRepoPage = useCallback(async (page: number) => {
        const client = clientRef.current;
        if (!client) return;

        setIsLoadingMoreRepos(true);
        try {
            const pageRepos = await client.listAccessibleRepos(page, 100);
            const mapped = pageRepos.map(mapRepo);
            setRepos((prev) => {
                const seen = new Set(prev.map((r) => r.fullName));
                const next = [...prev];
                for (const repo of mapped) {
                    if (seen.has(repo.fullName)) continue;
                    seen.add(repo.fullName);
                    next.push(repo);
                }
                return next;
            });
            setRepoPage(page);
            setHasMoreRepos(mapped.length === 100);
        } catch (e: any) {
            const kind = classifyGitHubError(e);
            if (kind === "auth") {
                setPhase("auth_required");
                setError("GitHub authentication required. Authenticate and retry.");
            } else {
                setPhase("error");
                setError(`Failed to load repositories: ${e?.message ?? String(e)}`);
            }
        } finally {
            setIsLoadingMoreRepos(false);
        }
    }, []);

    const loadPRs = useCallback(async (
        repo: InboxRepo,
        nextState: GitHubConfig["prInboxDefaultState"],
    ) => {
        const client = clientRef.current;
        if (!client) return;

        setProgressMessage(`Loading pull requests for ${repo.fullName}...`);
        setError(null);
        setPhase("loading");

        try {
            const apiState: "open" | "closed" | "all" =
                nextState === "open" ? "open" :
                nextState === "closed" ? "closed" :
                "all";
            const fetched = await client.listPRs(repo.owner, repo.repo, apiState, 100, 1);
            setPrs(filterPRsByState(fetched, nextState));
            setSelectedRepo(repo);
            setPhase("ready");
            setProgressMessage(`Loaded ${repo.fullName}`);
        } catch (e: any) {
            const kind = classifyGitHubError(e);
            if (kind === "auth") {
                setPhase("auth_required");
                setError("GitHub authentication required. Authenticate and retry.");
                return;
            }
            if (kind === "repo") {
                setPhase("repo_picker");
                setError("Could not access pull requests for that repository. Select another repo.");
                return;
            }
            setPhase("error");
            setError(`Failed to load pull requests: ${e?.message ?? String(e)}`);
        }
    }, []);

    const bootstrap = useCallback(async () => {
        setPhase("loading");
        setError(null);
        setProgressMessage("Connecting to GitHub...");
        setPrs([]);
        setRepos([]);
        setRepoPage(0);
        setHasMoreRepos(true);
        clientRef.current = null;

        let client: GitHubClient;
        try {
            client = await createGitHubClient(githubConfig);
            clientRef.current = client;
        } catch (e: any) {
            setPhase("auth_required");
            setError(e?.message ?? "GitHub authentication required.");
            return;
        }

        try {
            const { owner, repo } = await client.detectRepoInfo();
            await loadPRs({
                owner,
                repo,
                fullName: `${owner}/${repo}`,
                private: false,
                updatedAt: "",
                htmlUrl: `https://github.com/${owner}/${repo}`,
            }, stateFilterRef.current);
            return;
        } catch {
            // Fallback to picker
        }

        setProgressMessage("Select a repository to continue...");
        setPhase("repo_picker");
        await loadRepoPage(1);
    }, [githubConfig, loadPRs, loadRepoPage]);

    useEffect(() => {
        void bootstrap();
    }, [bootstrap, runKey]);

    const refresh = useCallback(() => {
        setRunKey((k) => k + 1);
    }, []);

    const selectRepo = useCallback(async (repo: InboxRepo) => {
        await loadPRs(repo, stateFilter);
    }, [loadPRs, stateFilter]);

    const openRepoPicker = useCallback(async () => {
        setPhase("repo_picker");
        setError(null);
        if (repos.length === 0) {
            await loadRepoPage(1);
        }
    }, [repos.length, loadRepoPage]);

    const loadMoreRepos = useCallback(async () => {
        if (isLoadingMoreRepos || !hasMoreRepos) return;
        await loadRepoPage(repoPage + 1);
    }, [hasMoreRepos, isLoadingMoreRepos, loadRepoPage, repoPage]);

    const setStateFilter = useCallback(async (next: GitHubConfig["prInboxDefaultState"]) => {
        setStateFilterValue(next);
        if (selectedRepo) {
            await loadPRs(selectedRepo, next);
        }
    }, [loadPRs, selectedRepo]);

    const startAuthFlow = useCallback(async (): Promise<boolean> => {
        setPhase("authorizing");
        setError(null);
        setProgressMessage("Launching GitHub web authentication. Follow prompts below...");

        const hasGh = await isGhAvailable();
        if (!hasGh) {
            setPhase("auth_required");
            setError("GitHub CLI (`gh`) is not installed. Use PAT fallback via docs.");
            return false;
        }

        const host = hostFromApiUrl(githubConfig.apiUrl);
        const loginPromise = runGhWebLogin({ host });
        const tickMs = 5000;

        while (true) {
            const next = await Promise.race([
                loginPromise.then((result) => ({ kind: "login" as const, result })),
                sleep(tickMs).then(() => ({ kind: "tick" as const })),
            ]);

            if (next.kind === "tick") {
                const authenticated = (await isGhAuthenticated(host)) || (await verifyAuth());
                if (authenticated) {
                    await persistResolvedToken();
                    setProgressMessage("Authentication detected. Reloading inbox...");
                    refresh();
                    return true;
                }
                continue;
            }

            if (!next.result.ok) {
                setPhase("auth_required");
                setError(`${next.result.message} Run: ${authCommand}`);
                return false;
            }
            break;
        }

        // Post-login buffer: poll every 5s and auto-recover when token becomes usable.
        setProgressMessage("Checking authentication status...");
        for (let i = 0; i < 6; i += 1) {
            const authenticated = (await isGhAuthenticated(host)) || (await verifyAuth());
            if (authenticated) {
                await persistResolvedToken();
                setProgressMessage("Authentication successful. Reloading inbox...");
                refresh();
                return true;
            }
            await sleep(tickMs);
        }

        setPhase("auth_required");
        setError("Authentication completed but token was not detected yet. Press retry.");
        return false;
    }, [authCommand, githubConfig.apiUrl, persistResolvedToken, refresh, sleep, verifyAuth]);

    return {
        phase,
        error,
        progressMessage,
        selectedRepo,
        repos,
        prs,
        stateFilter,
        hasMoreRepos,
        isLoadingMoreRepos,
        authCommand,
        docsLinks,
        setStateFilter,
        selectRepo,
        openRepoPicker,
        loadMoreRepos,
        refresh,
        startAuthFlow,
    };
}
