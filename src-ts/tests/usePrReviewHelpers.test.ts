import { describe, expect, it } from "vitest";
import { fingerprintGitHubReviewConfig, fingerprintProviderConfig } from "../tui/hooks/prReviewHelpers.js";
import type { ProviderConfig } from "../llm/providers.js";
import type { GitHubConfig } from "../config/settings.js";

describe("usePrReview helpers", () => {
    it("produces the same fingerprint for equivalent provider configs", () => {
        const a: ProviderConfig = {
            provider: "api",
            apiService: "openai",
            apiKey: "k1",
            apiModel: "gpt-4.1",
            temperature: 0.4,
        };
        const b: ProviderConfig = {
            provider: "api",
            apiService: "openai",
            apiKey: "k1",
            apiModel: "gpt-4.1",
            temperature: 0.4,
        };

        expect(fingerprintProviderConfig(a)).toBe(fingerprintProviderConfig(b));
    });

    it("changes the fingerprint when effective model settings change", () => {
        const base: ProviderConfig = {
            provider: "ollama",
            ollamaUrl: "http://localhost:11434",
            ollamaModel: "qwen2.5-coder:7b",
            temperature: 0.4,
        };

        expect(
            fingerprintProviderConfig(base),
        ).not.toBe(
            fingerprintProviderConfig({ ...base, ollamaModel: "qwen2.5-coder:14b" }),
        );
    });

    it("keeps github review fingerprints stable across equivalent objects", () => {
        const a: GitHubConfig = {
            token: "t1",
            apiUrl: "https://api.github.com",
            defaultOwner: "acme",
            defaultRepo: "repo",
            reviewAutoPost: false,
            reviewPostMinSeverity: "major",
            prInboxDefaultState: "all",
        };
        const b: GitHubConfig = { ...a };

        expect(fingerprintGitHubReviewConfig(a)).toBe(fingerprintGitHubReviewConfig(b));
    });
});
