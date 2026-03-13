/**
 * LangSmith tracing helpers.
 *
 * LangChain auto-activates tracing when these env vars are set (in .env):
 *   LANGSMITH_TRACING=true
 *   LANGSMITH_API_KEY=<your-langsmith-api-key>
 *   LANGSMITH_PROJECT=mygit
 *   LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com  (EU region)
 *
 * No code changes are needed to enable basic tracing — just set the env vars.
 * Call buildTracingConfig() to attach per-run metadata that appears in the
 * LangSmith UI (run name, tags, model used, etc.).
 */

import type { RunnableConfig } from "@langchain/core/runnables";

export interface TracingMeta {
    request: string;
    modelName?: string;
    maxIterations?: number;
}

export function isTracingEnabled(): boolean {
    return process.env.LANGSMITH_TRACING === "true"
        || process.env.LANGCHAIN_TRACING_V2 === "true";
}

export function buildTracingConfig(meta: TracingMeta): Partial<RunnableConfig> {
    return {
        runName: `mygit-agent: ${meta.request.slice(0, 60)}`,
        tags: ["mygit", "agent"],
        metadata: {
            request: meta.request,
            modelName: meta.modelName ?? "unknown",
            maxIterations: meta.maxIterations ?? 15,
            timestamp: new Date().toISOString(),
        },
    };
}
