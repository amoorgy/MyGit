import type { GitHubConfig } from "../../config/settings.js";
import type { ProviderConfig } from "../../llm/providers.js";

export function fingerprintProviderConfig(config: ProviderConfig): string {
    return JSON.stringify([
        config.provider ?? "",
        config.ollamaUrl ?? "",
        config.ollamaModel ?? "",
        config.googleApiKey ?? "",
        config.googleModel ?? "",
        config.apiService ?? "",
        config.apiKey ?? "",
        config.apiBaseUrl ?? "",
        config.apiModel ?? "",
        config.transformerModel ?? "",
        config.transformerServerUrl ?? "",
        config.temperature ?? "",
        config.contextWindow ?? "",
    ]);
}

export function fingerprintGitHubReviewConfig(config: GitHubConfig): string {
    return JSON.stringify([
        config.token ?? "",
        config.apiUrl ?? "",
        config.defaultOwner ?? "",
        config.defaultRepo ?? "",
        config.reviewAutoPost ?? false,
        config.reviewPostMinSeverity ?? "major",
    ]);
}
