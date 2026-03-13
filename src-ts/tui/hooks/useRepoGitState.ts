import { useCallback, useEffect, useState } from "react";
import { loadRepoGitState, type RepoGitState } from "../git/repoState.js";

export function useRepoGitState() {
    const [state, setState] = useState<RepoGitState | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        try {
            const next = await loadRepoGitState();
            setState(next);
            setError(null);
            return next;
        } catch (err: any) {
            const message = err?.message ?? String(err);
            setError(message);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return {
        state,
        isLoading,
        error,
        refresh,
    };
}
