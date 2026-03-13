/**
 * LLM Provider Factory — creates LangChain chat models from config.
 *
 * Supports: Ollama (local), Google Gemini, Anthropic, OpenAI,
 * and OpenAI-compatible services (DeepSeek, Moonshot/Kimi, Groq, Cerebras, OpenRouter).
 */

import { ChatOllama } from "@langchain/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
    type ApiService,
    type LLMProvider,
    API_SERVICE_BASE_URLS,
    API_SERVICE_ENV_KEYS,
} from "../config/settings.js";

// ============================================================================
// LOCAL HuggingFACE MODEL (via local Python inference server)
// ============================================================================

/**
 * Create a ChatOpenAI instance pointed at a local OpenAI-compatible inference
 * server (vllm, text-generation-inference, LM Studio, etc.).
 *
 * Start the server with, e.g.:
 *   vllm serve ByteDance/Ouro-2.6B --trust-remote-code --port 8080
 *   # or
 *   python -m transformers.pipelines.server --model ByteDance/Ouro-2.6B
 *
 * Then select "HuggingFace (Local)" in the model picker.
 */
function createLocalHfModel(fields: {
    modelId: string;
    serverUrl: string;
    temperature: number;
}): BaseChatModel {
    return new ChatOpenAI({
        openAIApiKey: "local",
        modelName: fields.modelId,
        temperature: fields.temperature,
        configuration: { baseURL: `${fields.serverUrl}/v1` },
    });
}

// ============================================================================
// TYPES
// ============================================================================

export type ProviderType = "ollama" | "google" | "api" | "transformer";

export interface ModelInfo {
    name: string;
    displayName: string;
    provider: ProviderType;
    apiService?: ApiService;
    binarySizeBytes?: number;
    parameterSize?: string;
    description?: string;
}

export interface ProviderConfig {
    provider: ProviderType;

    // Ollama
    ollamaUrl?: string;
    ollamaModel?: string;

    // Google
    googleApiKey?: string;
    googleModel?: string;

    // API (service-based)
    apiService?: ApiService;
    apiKey?: string;
    apiBaseUrl?: string;
    apiModel?: string;

    // Transformer (local Python inference server)
    transformerModel?: string;
    transformerServerUrl?: string;

    // Common
    temperature?: number;
    contextWindow?: number;
}

// ============================================================================
// STATIC MODEL CATALOG
// ============================================================================

export const API_MODEL_CATALOG: Record<string, ModelInfo[]> = {
    anthropic: [
        // Fast tier
        { name: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", provider: "api", apiService: "anthropic", description: "Fastest, ideal for CLI agents" },
        // Balanced tier
        { name: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", provider: "api", apiService: "anthropic", description: "Best daily driver — Opus-level intelligence at Sonnet cost" },
        { name: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5", provider: "api", apiService: "anthropic", description: "Strong coding & agent performance" },
        // SOTA
        { name: "claude-opus-4-6", displayName: "Claude Opus 4.6", provider: "api", apiService: "anthropic", description: "Most capable, 1M context, agent teams" },
        { name: "claude-opus-4-5", displayName: "Claude Opus 4.5", provider: "api", apiService: "anthropic", description: "Previous flagship — frontier coding & reasoning" },
    ],
    openai: [
        // Fast tier
        { name: "gpt-4.1-mini", displayName: "GPT-4.1 Mini", provider: "api", apiService: "openai", description: "Fast, affordable — replaces gpt-4o-mini" },
        { name: "gpt-4.1-nano", displayName: "GPT-4.1 Nano", provider: "api", apiService: "openai", description: "Lightest, cheapest OpenAI model" },
        // Balanced / flagship
        { name: "gpt-4.1", displayName: "GPT-4.1", provider: "api", apiService: "openai", description: "Strong coding & instruction following, 1M context" },
        { name: "gpt-5", displayName: "GPT-5", provider: "api", apiService: "openai", description: "Flagship model — unified reasoning + chat" },
        // Latest SOTA
        { name: "gpt-5.2", displayName: "GPT-5.2", provider: "api", apiService: "openai", description: "Latest flagship — top coding & agentic tasks" },
        // Reasoning
        { name: "o4-mini", displayName: "o4 Mini", provider: "api", apiService: "openai", description: "Fast, cost-efficient reasoning model" },
        { name: "o3", displayName: "o3", provider: "api", apiService: "openai", description: "Deep reasoning, SOTA on hard problems" },
    ],
    gemini: [
        // Fast tier — keep 2.5 flash as the budget workhorse
        { name: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", provider: "api", apiService: "gemini", description: "Fast, capable — best value in Gemini lineup" },
        { name: "gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash Lite", provider: "api", apiService: "gemini", description: "Lightest, cheapest current option" },
        // Flash with reasoning
        { name: "gemini-3-flash-preview", displayName: "Gemini 3 Flash", provider: "api", apiService: "gemini", description: "Gen 3 fast model — free tier available" },
        // SOTA
        { name: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", provider: "api", apiService: "gemini", description: "Stable flagship, long context, production-ready" },
        { name: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro (Preview)", provider: "api", apiService: "gemini", description: "Latest & most capable Gemini — state of the art reasoning" },
    ],
    deepseek: [
        // API strings unchanged — backend now serves V3.2
        { name: "deepseek-chat", displayName: "DeepSeek V3.2", provider: "api", apiService: "deepseek", description: "Flagship chat (V3.2), exceptional value" },
        { name: "deepseek-reasoner", displayName: "DeepSeek V3.2 Reasoner", provider: "api", apiService: "deepseek", description: "Thinking mode of V3.2 — GPT-5 class reasoning" },
    ],
    moonshot: [
        { name: "moonshot-v1-8k", displayName: "Kimi 8K", provider: "api", apiService: "moonshot", description: "Fast, 8K context" },
        { name: "moonshot-v1-32k", displayName: "Kimi 32K", provider: "api", apiService: "moonshot", description: "Extended context" },
        { name: "moonshot-v1-128k", displayName: "Kimi 128K", provider: "api", apiService: "moonshot", description: "Long context coding" },
    ],
    groq: [
        // Ultra-fast via Groq
        { name: "llama-3.1-8b-instant", displayName: "Llama 3.1 8B Instant", provider: "api", apiService: "groq", description: "Ultra-fast, near-instant responses" },
        { name: "llama-3.3-70b-versatile", displayName: "Llama 3.3 70B", provider: "api", apiService: "groq", description: "Versatile, high quality" },
        { name: "qwen-qwq-32b", displayName: "Qwen QwQ 32B", provider: "api", apiService: "groq", description: "Strong reasoning, 32B params" },
        { name: "mixtral-8x7b-32768", displayName: "Mixtral 8x7B", provider: "api", apiService: "groq", description: "MoE, 32K context" },
    ],
    cerebras: [
        { name: "llama-3.1-8b", displayName: "Llama 3.1 8B", provider: "api", apiService: "cerebras", description: "Wafer-scale speed, lightweight" },
        { name: "llama-3.3-70b", displayName: "Llama 3.3 70B", provider: "api", apiService: "cerebras", description: "Wafer-scale, high quality" },
        { name: "qwen-2.5-72b", displayName: "Qwen 2.5 72B", provider: "api", apiService: "cerebras", description: "Strong multilingual model" },
    ],
    openrouter: [
        // Budget options
        { name: "google/gemini-2.5-flash", displayName: "Gemini 2.5 Flash (OR)", provider: "api", apiService: "openrouter", description: "Best value Gemini via OpenRouter" },
        { name: "openai/gpt-4.1-mini", displayName: "GPT-4.1 Mini (OR)", provider: "api", apiService: "openrouter", description: "Affordable OpenAI via OpenRouter" },
        { name: "deepseek/deepseek-chat", displayName: "DeepSeek V3.2 (OR)", provider: "api", apiService: "openrouter", description: "Exceptional value chat model" },
        { name: "meta-llama/llama-3.3-70b-instruct", displayName: "Llama 3.3 70B (OR)", provider: "api", apiService: "openrouter", description: "Meta's open model via OpenRouter" },
        // SOTA via OpenRouter
        { name: "anthropic/claude-haiku-4-5", displayName: "Claude Haiku 4.5 (OR)", provider: "api", apiService: "openrouter", description: "Fast Anthropic via OpenRouter" },
        { name: "anthropic/claude-sonnet-4-6", displayName: "Claude Sonnet 4.6 (OR)", provider: "api", apiService: "openrouter", description: "Latest balanced Anthropic via OpenRouter" },
        { name: "openai/gpt-5.2", displayName: "GPT-5.2 (OR)", provider: "api", apiService: "openrouter", description: "Latest OpenAI flagship via OpenRouter" },
        { name: "google/gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro (OR)", provider: "api", apiService: "openrouter", description: "Latest Gemini via OpenRouter" },
    ],
    transformer: [
        { name: "ByteDance/Ouro-2.6B", displayName: "Ouro 2.6B", provider: "transformer", parameterSize: "2.6B", description: "Local recurrent LM — requires a running vllm/TGI server (default: localhost:8080)" },
    ],
    ouro: [
        { name: "mlx-community/Ouro-2.6B-4bit", displayName: "Ouro 2.6B 4-bit (MLX)", provider: "api", apiService: "ouro", parameterSize: "2.6B", description: "Local Apple Silicon model — requires ouro-server.ts running on localhost:8080" },
    ],
    lmstudio: [
        { name: "local-model", displayName: "LM Studio (active model)", provider: "api", apiService: "lmstudio", description: "Currently loaded model in LM Studio — fetched dynamically when server is running" },
    ],
};


/** Human-readable service names */
export const API_SERVICE_LABELS: Record<ApiService, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    deepseek: "DeepSeek",
    moonshot: "Moonshot (Kimi)",
    groq: "Groq",
    cerebras: "Cerebras",
    openrouter: "OpenRouter",
    gemini: "Google Gemini",
    transformer: "HuggingFace (Local Server)",
    ouro: "Ouro 2.6B (Local MLX)",
    lmstudio: "LM Studio",
};

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a LangChain chat model from provider config.
 */
export function createChatModel(config: ProviderConfig): BaseChatModel {
    switch (config.provider) {
        case "ollama":
            return new ChatOllama({
                baseUrl: config.ollamaUrl ?? "http://localhost:11434",
                model: config.ollamaModel ?? "qwen2.5-coder:7b",
                temperature: config.temperature ?? 0.4,
            });

        case "google":
            if (!config.googleApiKey) {
                throw new Error(
                    "Google API key is required. Set GOOGLE_API_KEY env var or configure in settings.",
                );
            }
            return new ChatGoogleGenerativeAI({
                apiKey: config.googleApiKey,
                model: config.googleModel ?? "gemini-2.0-flash",
                temperature: config.temperature ?? 0.4,
            });

        case "api":
            return createApiServiceModel(config);

        case "transformer":
            return createLocalHfModel({
                modelId: config.transformerModel ?? "ByteDance/Ouro-2.6B",
                serverUrl: config.transformerServerUrl ?? "http://localhost:8080",
                temperature: config.temperature ?? 0.4,
            });

        default:
            throw new Error(`Unknown provider: ${config.provider}`);
    }
}

/**
 * Create a chat model for an API service (Anthropic, OpenAI, DeepSeek, etc.).
 * Most services use OpenAI-compatible endpoints via ChatOpenAI.
 */
function createApiServiceModel(config: ProviderConfig): BaseChatModel {
    const service = config.apiService ?? "openai";
    const apiKey = config.apiKey;
    const model = config.apiModel;

    // Local services don't need a real API key
    const localServices: ApiService[] = ["ouro", "transformer", "lmstudio"];
    if (!apiKey && !localServices.includes(service)) {
        throw new Error(
            `API key required for ${service}. Set ${API_SERVICE_ENV_KEYS[service]} env var or configure in settings.`,
        );
    }

    // Anthropic has its own LangChain package — try dynamic import fallback to OpenAI-compat
    // For now, use ChatOpenAI for all services since Anthropic also supports OpenAI-compat
    // Users who want native Anthropic can install @langchain/anthropic

    const baseUrl = config.apiBaseUrl ?? API_SERVICE_BASE_URLS[service];
    const opts: Record<string, any> = {
        openAIApiKey: apiKey ?? "local",
        modelName: model ?? "gpt-4o",
        temperature: config.temperature ?? 0.4,
    };

    if (baseUrl) {
        opts.configuration = { baseURL: baseUrl };
    }

    return new ChatOpenAI(opts);
}

/**
 * Get the configured LLM model based on application settings.
 */
export async function getModel(appConfig: any): Promise<BaseChatModel> {
    const provider = appConfig.provider as ProviderType;
    let providerConfig: ProviderConfig = { provider };

    if (provider === "ollama") {
        providerConfig = {
            ...providerConfig,
            ollamaUrl: appConfig.ollama.url,
            ollamaModel: appConfig.ollama.model,
            temperature: appConfig.ollama.temperature,
            contextWindow: appConfig.ollama.contextWindow,
        };
    } else if (provider === "google") {
        providerConfig = {
            ...providerConfig,
            googleApiKey: appConfig.google.apiKey,
            googleModel: appConfig.google.model,
        };
    } else if (provider === "api") {
        const service = appConfig.api?.activeService ?? "openai";
        providerConfig = {
            ...providerConfig,
            apiService: service,
            apiKey: appConfig.api?.apiKeys?.[service],
            apiModel: appConfig.api?.models?.[service],
        };
    } else if (provider === "transformer") {
        providerConfig = {
            ...providerConfig,
            transformerModel: appConfig.transformer?.model ?? "ByteDance/Ouro-2.6B",
            transformerServerUrl: appConfig.transformer?.serverUrl ?? "http://localhost:8080",
            temperature: appConfig.transformer?.temperature ?? 0.4,
        };
    }

    return createChatModel(providerConfig);
}

// ============================================================================
// PROVIDER DETECTION
// ============================================================================

export interface ProviderStatus {
    provider: ProviderType;
    service?: ApiService;
    available: boolean;
    error?: string;
    label: string;
}

/**
 * Detect all available LLM providers and services.
 */
export async function detectAllProviders(): Promise<ProviderStatus[]> {
    const results: ProviderStatus[] = [];

    // Check Ollama
    try {
        const res = await fetch("http://localhost:11434/api/tags", {
            signal: AbortSignal.timeout(3000),
        });
        results.push({ provider: "ollama", available: res.ok, label: "Ollama (Local)" });
    } catch {
        results.push({ provider: "ollama", available: false, error: "Ollama not running", label: "Ollama (Local)" });
    }

    // Check each API service
    const services: ApiService[] = ["anthropic", "openai", "gemini", "deepseek", "moonshot", "groq", "cerebras", "openrouter"];
    for (const service of services) {
        const envKey = API_SERVICE_ENV_KEYS[service];
        const key = process.env[envKey];
        results.push({
            provider: "api",
            service,
            available: !!key,
            error: key ? undefined : `${envKey} not set`,
            label: API_SERVICE_LABELS[service],
        });
    }

    // Check Ouro local server (reachability, not an API key)
    try {
        const res = await fetch(`${API_SERVICE_BASE_URLS.ouro!.replace("/v1", "")}/health`, {
            signal: AbortSignal.timeout(2000),
        });
        results.push({ provider: "api", service: "ouro", available: res.ok, label: API_SERVICE_LABELS.ouro });
    } catch {
        results.push({ provider: "api", service: "ouro", available: false, error: "ouro-server.ts not running", label: API_SERVICE_LABELS.ouro });
    }

    // Check LM Studio local server (reachability, not an API key)
    try {
        const res = await fetch(API_SERVICE_BASE_URLS.lmstudio! + "/models", {
            signal: AbortSignal.timeout(2000),
        });
        results.push({ provider: "api", service: "lmstudio", available: res.ok, label: API_SERVICE_LABELS.lmstudio });
    } catch {
        results.push({ provider: "api", service: "lmstudio", available: false, error: "LM Studio not running", label: API_SERVICE_LABELS.lmstudio });
    }

    // Transformer (local) — always available if @xenova/transformers is installed
    results.push({
        provider: "transformer",
        service: "transformer",
        available: true,
        label: "Transformers.js (Local ONNX)",
    });

    return results;
}

/**
 * Fetch available models from Ollama.
 */
export async function fetchOllamaModels(url?: string): Promise<ModelInfo[]> {
    try {
        const res = await fetch(`${url ?? "http://localhost:11434"}/api/tags`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { models?: { name: string; size?: number; details?: { parameter_size?: string } }[] };
        return (data.models ?? []).map((m) => ({
            name: m.name,
            displayName: m.name,
            provider: "ollama" as const,
            binarySizeBytes: m.size,
            parameterSize: m.details?.parameter_size,
        }));
    } catch {
        return [];
    }
}

/**
 * Fetch available models from LM Studio (OpenAI /v1/models endpoint).
 */
export async function fetchLmStudioModels(): Promise<ModelInfo[]> {
    try {
        const res = await fetch(`${API_SERVICE_BASE_URLS.lmstudio!}/models`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { data?: { id: string }[] };
        return (data.data ?? []).map((m) => ({
            name: m.id,
            displayName: m.id,
            provider: "api" as const,
            apiService: "lmstudio" as ApiService,
            description: "LM Studio local model",
        }));
    } catch {
        return [];
    }
}

/**
 * Get all available models for a given service (static catalog + dynamic for Ollama/LM Studio).
 */
export async function getModelsForService(service: ApiService | "ollama", ollamaUrl?: string): Promise<ModelInfo[]> {
    if (service === "ollama") {
        return fetchOllamaModels(ollamaUrl);
    }
    if (service === "lmstudio") {
        const dynamic = await fetchLmStudioModels();
        return dynamic.length > 0 ? dynamic : (API_MODEL_CATALOG.lmstudio ?? []);
    }
    return API_MODEL_CATALOG[service] ?? [];
}

/**
 * Format byte size for display.
 */
export function formatByteSize(bytes: number): string {
    const KB = 1_000;
    const MB = 1_000_000;
    const GB = 1_000_000_000;

    if (bytes >= GB) return `${(bytes / GB).toFixed(2)}GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(1)}MB`;
    if (bytes >= KB) return `${(bytes / KB).toFixed(0)}KB`;
    return `${bytes}B`;
}
