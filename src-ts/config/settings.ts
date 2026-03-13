/**
 * Config Settings — mirrors Rust `src/config/settings.rs`
 *
 * TOML-based configuration with global and repo-level overrides.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import TOML from "@iarna/toml";

// ============================================================================
// TYPES
// ============================================================================

export type AutomationLevel = "safe" | "semi_autonomous" | "extreme";
export type PlanningMode = "show_and_approve" | "show_and_execute" | "just_execute";
export type LLMProvider = "ollama" | "google" | "api" | "transformer";
export type UiThemePreset = "nebula_pulse" | "graphite_mist" | "ghost_glass";
export type ApiService =
    | "anthropic"
    | "openai"
    | "deepseek"
    | "moonshot"
    | "groq"
    | "cerebras"
    | "openrouter"
    | "gemini"
    | "transformer"
    | "ouro"
    | "lmstudio";

/** Environment variable names for API keys per service */
export const API_SERVICE_ENV_KEYS: Record<ApiService, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    moonshot: "MOONSHOT_API_KEY",
    groq: "GROQ_API_KEY",
    cerebras: "CEREBRAS_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    gemini: "GEMINI_API_KEY",
    transformer: "TRANSFORMER_API_KEY",
    ouro: "OURO_API_KEY",
    lmstudio: "LM_STUDIO_API_KEY",
};

/** Base URLs for OpenAI-compatible services */
export const API_SERVICE_BASE_URLS: Partial<Record<ApiService, string>> = {
    deepseek: "https://api.deepseek.com/v1",
    moonshot: "https://api.moonshot.cn/v1",
    groq: "https://api.groq.com/openai/v1",
    cerebras: "https://api.cerebras.ai/v1",
    openrouter: "https://openrouter.ai/api/v1",
    transformer: "https://api.transformer.com/v1",
    ouro: "http://localhost:8080/v1",
    lmstudio: "http://localhost:1234/v1",
};

export interface AgentConfig {
    automationLevel: AutomationLevel;
    maxIterations: number;
    showThinking: boolean;
    planningMode: PlanningMode;
    permissions: {
        shellCommands: "allowed" | "denied" | "ask";
        fileWrites: "allowed" | "denied" | "ask";
        destructiveGit: "allowed" | "denied" | "ask";
    };
    confirmation: {
        autoApproveSafe: boolean;
        requireDoubleConfirm: boolean;
    };
    shell: {
        allowlist: string[];
    };
}

export interface OllamaConfig {
    url: string;
    model: string;
    temperature: number;
    contextWindow: number;
}

export interface GoogleConfig {
    apiKey: string;
    model: string;
}

export interface UiConfig {
    theme: UiThemePreset;
    mouseEnabled: boolean;
}

export interface LearningConfig {
    enabled: boolean;
    minFrequency: number;
    confidenceThreshold: number;
    memoryScope: "repo" | "global";
}

export interface ContextConfig {
    enabled: boolean;
    autoIndex: boolean;
    retrievalTopK: number;
    contextBudgetRatio: number;
}

export interface SmartMergeConfig {
    enabled: boolean;
}

export interface GitHubConfig {
    token: string;
    apiUrl: string;
    defaultOwner: string;
    defaultRepo: string;
    reviewAutoPost: boolean;
    reviewPostMinSeverity: "critical" | "major" | "minor" | "suggestion";
    prInboxDefaultState: "open" | "closed" | "merged" | "all";
}

export interface ApiProviderConfig {
    activeService: ApiService;
    apiKeys: Partial<Record<ApiService, string>>;
    models: Partial<Record<ApiService, string>>;
}

export interface TransformerConfig {
    model: string;
    serverUrl: string;
    temperature: number;
}

export interface Config {
    provider: LLMProvider;
    agent: AgentConfig;
    ollama: OllamaConfig;
    google: GoogleConfig;
    api: ApiProviderConfig;
    transformer: TransformerConfig;
    ui: UiConfig;
    learning: LearningConfig;
    smartMerge: SmartMergeConfig;
    context: ContextConfig;
    github: GitHubConfig;
}

// ============================================================================
// DEFAULTS
// ============================================================================

export function defaultConfig(): Config {
    return {
        provider: "ollama",
        agent: {
            automationLevel: "safe",
            maxIterations: 15,
            showThinking: false,
            planningMode: "show_and_approve",
            permissions: {
                shellCommands: "ask",
                fileWrites: "ask",
                destructiveGit: "ask",
            },
            confirmation: {
                autoApproveSafe: true,
                requireDoubleConfirm: false,
            },
            shell: {
                allowlist: [],
            },
        },
        ollama: {
            url: "http://localhost:11434",
            model: "qwen2.5-coder:7b",
            temperature: 0.4,
            contextWindow: 16384,
        },
        google: {
            apiKey: process.env.GOOGLE_API_KEY ?? "",
            model: "gemini-2.0-flash",
        },
        api: {
            activeService: "openai",
            apiKeys: {},
            models: {
                anthropic: "claude-sonnet-4-20250514",
                openai: "gpt-4o",
                deepseek: "deepseek-chat",
                moonshot: "moonshot-v1-128k",
                groq: "llama-3.3-70b-versatile",
                cerebras: "llama-3.3-70b",
                openrouter: "anthropic/claude-sonnet-4",
                gemini: "gemini-2.0-flash",
                ouro: "mlx-community/Ouro-2.6B-4bit",
                lmstudio: "local-model",
            },
        },
        transformer: {
            model: "ByteDance/Ouro-2.6B",
            serverUrl: "http://localhost:8080",
            temperature: 0.4,
        },
        ui: {
            theme: "nebula_pulse",
            mouseEnabled: true,
        },
        learning: {
            enabled: true,
            minFrequency: 3,
            confidenceThreshold: 0.6,
            memoryScope: "repo",
        },
        smartMerge: {
            enabled: true,
        },
        context: {
            enabled: true,
            autoIndex: true,
            retrievalTopK: 5,
            contextBudgetRatio: 0.25,
        },
        github: {
            token: process.env.GITHUB_TOKEN ?? "",
            apiUrl: "https://api.github.com",
            defaultOwner: "",
            defaultRepo: "",
            reviewAutoPost: false,
            reviewPostMinSeverity: "major",
            prInboxDefaultState: "all",
        },
    };
}

// ============================================================================
// CONFIG PATHS
// ============================================================================

function globalConfigDir(): string {
    const home = os.homedir();
    if (process.platform === "darwin") {
        return path.join(home, "Library", "Application Support", "mygit");
    }
    return path.join(home, ".config", "mygit");
}

export function globalConfigPath(): string {
    return path.join(globalConfigDir(), "config.toml");
}

export function repoConfigPath(): string {
    return path.join(process.cwd(), ".mygit", "config.toml");
}

// ============================================================================
// LOADING
// ============================================================================

async function loadToml(filePath: string): Promise<Record<string, any> | null> {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        return TOML.parse(content) as Record<string, any>;
    } catch {
        return null;
    }
}

function deepMerge(target: any, source: any): any {
    for (const key of Object.keys(source)) {
        if (
            source[key] &&
            typeof source[key] === "object" &&
            !Array.isArray(source[key]) &&
            target[key] &&
            typeof target[key] === "object"
        ) {
            target[key] = deepMerge({ ...target[key] }, source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

/**
 * Load config from global + repo paths, with defaults.
 */
export async function loadConfig(): Promise<Config> {
    const config = defaultConfig();

    const globalToml = await loadToml(globalConfigPath());
    if (globalToml) {
        deepMerge(config, globalToml);
    }

    const repoToml = await loadToml(repoConfigPath());
    if (repoToml) {
        deepMerge(config, repoToml);
    }

    // Environment variable overrides
    if (process.env.GOOGLE_API_KEY && !config.google.apiKey) {
        config.google.apiKey = process.env.GOOGLE_API_KEY;
    }

    // Auto-detect API keys from environment
    for (const [service, envKey] of Object.entries(API_SERVICE_ENV_KEYS)) {
        const key = process.env[envKey];
        if (key && !config.api.apiKeys[service as ApiService]) {
            config.api.apiKeys[service as ApiService] = key;
        }
    }

    if (process.env.GITHUB_TOKEN && !config.github.token) {
        config.github.token = process.env.GITHUB_TOKEN;
    }

    return config;
}

/**
 * Save config to the specified path.
 */
export async function saveConfig(config: Config, filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const content = TOML.stringify(config as any);
    await fs.writeFile(filePath, content, "utf-8");
}
