/**
 * SetupWizard — colorful first-run setup TUI for mygit.
 *
 * Standalone Ink app (not an AppMode inside App.tsx).
 * Steps: welcome → provider → ollama_model | api_service → api_key → alias_install → done
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import Spinner from "ink-spinner";
import {
    defaultConfig,
    saveConfig,
    globalConfigPath,
    repoConfigPath,
    type LLMProvider,
    type ApiService,
    API_SERVICE_ENV_KEYS,
} from "../../config/settings.js";
import { fetchOllamaModels, type ModelInfo } from "../../llm/providers.js";
import { CustomTextInput } from "../components/CustomTextInput.js";
import {
    installAliasBin,
    installAliasWindows,
    detectShellProfile,
    isBinDirInPath,
    appendPathExport,
    getEntryPoint,
} from "./installUtils.js";
import * as path from "path";
import * as os from "os";

// ============================================================================
// TYPES
// ============================================================================

type WizardStep =
    | "welcome"
    | "provider_select"
    | "ollama_model"
    | "api_service_select"
    | "api_key_input"
    | "alias_install"
    | "done";

interface WizardProps {
    scope?: string;
}

const API_SERVICES: ApiService[] = [
    "anthropic", "openai", "deepseek", "groq",
    "cerebras", "openrouter", "gemini", "lmstudio",
];

const LOCAL_SERVICES = new Set<ApiService>(["lmstudio", "ouro", "transformer"]);

// ============================================================================
// HEADER
// ============================================================================

function Header({ step, total }: { step: number; total: number }) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text color="cyan" bold>  ╔═══════════════════════════╗  </Text>
            </Box>
            <Box>
                <Text color="cyan" bold>  ║  </Text>
                <Text color="white" bold>  mygit  </Text>
                <Text color="cyan">setup wizard  </Text>
                <Text color="cyan" bold>  ║  </Text>
            </Box>
            <Box>
                <Text color="cyan" bold>  ╚═══════════════════════════╝  </Text>
            </Box>
            <Box marginTop={1}>
                <Text dimColor>step {step} of {total}  </Text>
                {"█".repeat(step).split("").map((_, i) => (
                    <Text key={i} color="cyan">█</Text>
                ))}
                {"░".repeat(total - step).split("").map((_, i) => (
                    <Text key={i} dimColor>░</Text>
                ))}
            </Box>
        </Box>
    );
}

function Hint({ children }: { children: React.ReactNode }) {
    return <Text dimColor>  {children}</Text>;
}

// ============================================================================
// SELECTABLE LIST
// ============================================================================

interface ListItem {
    label: string;
    sublabel?: string;
}

function SelectList({
    items,
    selectedIdx,
}: {
    items: ListItem[];
    selectedIdx: number;
}) {
    return (
        <Box flexDirection="column">
            {items.map((item, i) => (
                <Box key={i}>
                    <Text color={i === selectedIdx ? "cyan" : undefined}>
                        {i === selectedIdx ? " ▸ " : "   "}
                        <Text bold={i === selectedIdx}>{item.label}</Text>
                        {item.sublabel ? (
                            <Text dimColor>  {item.sublabel}</Text>
                        ) : null}
                    </Text>
                </Box>
            ))}
        </Box>
    );
}

// ============================================================================
// STEP COMPONENTS
// ============================================================================

function WelcomeStep({ onNext }: { onNext: () => void }) {
    useInput((_, key) => {
        if (key.return) onNext();
    });

    return (
        <Box flexDirection="column" gap={1}>
            <Text color="green" bold>
                {"  Welcome to mygit! Let's get you set up."}
            </Text>
            <Box flexDirection="column">
                <Text>  This wizard will help you:</Text>
                <Text color="cyan">    • Configure your AI provider (Ollama or cloud API)</Text>
                <Text color="cyan">    • Install the </Text>
                <Text>  </Text>
                <Text color="yellow">mygit</Text>
                <Text color="cyan"> command system-wide</Text>
            </Box>
            <Hint>Press Enter to begin, or Ctrl+C to exit</Hint>
        </Box>
    );
}

function ProviderSelectStep({
    onSelect,
}: {
    onSelect: (choice: "ollama" | "api" | "skip") => void;
}) {
    const [idx, setIdx] = useState(0);
    const items: ListItem[] = [
        { label: "Ollama  (local, free)", sublabel: "runs models on your machine" },
        { label: "API Key (cloud)",       sublabel: "Anthropic, OpenAI, Groq, etc." },
        { label: "Skip for now",          sublabel: "configure later with mygit config" },
    ];
    const choices = ["ollama", "api", "skip"] as const;

    useInput((_, key) => {
        if (key.upArrow)  setIdx(i => Math.max(0, i - 1));
        if (key.downArrow) setIdx(i => Math.min(items.length - 1, i + 1));
        if (key.return)   onSelect(choices[idx]);
    });

    return (
        <Box flexDirection="column" gap={1}>
            <Text bold>  Choose your AI provider</Text>
            <SelectList items={items} selectedIdx={idx} />
            <Hint>↑↓ navigate  Enter select</Hint>
        </Box>
    );
}

function OllamaModelStep({
    ollamaUrl,
    onSelect,
    onSkip,
}: {
    ollamaUrl: string;
    onSelect: (model: string) => void;
    onSkip: () => void;
}) {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [offline, setOffline] = useState(false);
    const [idx, setIdx] = useState(0);

    const load = () => {
        setLoading(true);
        setOffline(false);
        fetchOllamaModels(ollamaUrl)
            .then(ms => {
                setModels(ms);
                setOffline(ms.length === 0);
                setLoading(false);
            })
            .catch(() => {
                setOffline(true);
                setLoading(false);
            });
    };

    useEffect(load, []);

    const visible = models.slice(Math.max(0, idx - 6), idx + 6);
    const visibleOffset = Math.max(0, idx - 6);

    useInput((input, key) => {
        if (loading) return;
        if (input === "r" || input === "R") { load(); return; }
        if (key.escape || input === "s") { onSkip(); return; }
        if (offline) return;
        if (key.upArrow)   setIdx(i => Math.max(0, i - 1));
        if (key.downArrow) setIdx(i => Math.min(models.length - 1, i + 1));
        if (key.return)    onSelect(models[idx].name);
    });

    if (loading) {
        return (
            <Box flexDirection="column" gap={1}>
                <Text bold>  Connecting to Ollama...</Text>
                <Box>
                    <Text color="cyan"><Spinner type="dots" /></Text>
                    <Text dimColor>  fetching models from {ollamaUrl}</Text>
                </Box>
            </Box>
        );
    }

    if (offline) {
        return (
            <Box flexDirection="column" gap={1}>
                <Text bold color="yellow">  Ollama not reachable</Text>
                <Text>  Could not connect to <Text color="cyan">{ollamaUrl}</Text></Text>
                <Box flexDirection="column" marginTop={1}>
                    <Text color="white">  To fix this:</Text>
                    <Text color="cyan">    1. Open a terminal and run: </Text>
                    <Text color="yellow">ollama serve</Text>
                    <Text dimColor>       (or open the Ollama desktop app)</Text>
                    <Text color="cyan">    2. Press </Text>
                    <Text color="green" bold>r</Text>
                    <Text color="cyan"> to refresh</Text>
                </Box>
                <Hint>r refresh  s skip provider setup</Hint>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" gap={1}>
            <Text bold>  Select Ollama model  <Text dimColor>({models.length} available)</Text></Text>
            <Box flexDirection="column">
                {visible.map((m, i) => {
                    const globalIdx = visibleOffset + i;
                    return (
                        <Box key={m.name}>
                            <Text color={globalIdx === idx ? "cyan" : undefined}>
                                {globalIdx === idx ? " ▸ " : "   "}
                                <Text bold={globalIdx === idx}>{m.displayName || m.name}</Text>
                            </Text>
                        </Box>
                    );
                })}
            </Box>
            <Hint>↑↓ navigate  Enter select  r refresh  s skip</Hint>
        </Box>
    );
}

function ApiServiceStep({
    selectedIdx,
    onSelect,
    onBack,
}: {
    selectedIdx: number;
    onSelect: (service: ApiService, idx: number) => void;
    onBack: () => void;
}) {
    const [idx, setIdx] = useState(selectedIdx);

    const items: ListItem[] = API_SERVICES.map(s => {
        const envKey = API_SERVICE_ENV_KEYS[s];
        const detected = !!process.env[envKey];
        return {
            label: s,
            sublabel: detected ? `✓ ${envKey} detected` : (LOCAL_SERVICES.has(s) ? "local, no key needed" : envKey),
        };
    });

    useInput((_, key) => {
        if (key.upArrow)   setIdx(i => Math.max(0, i - 1));
        if (key.downArrow) setIdx(i => Math.min(items.length - 1, i + 1));
        if (key.return)    onSelect(API_SERVICES[idx], idx);
        if (key.escape)    onBack();
    });

    return (
        <Box flexDirection="column" gap={1}>
            <Text bold>  Select API service</Text>
            <SelectList items={items} selectedIdx={idx} />
            <Hint>↑↓ navigate  Enter select  Esc back</Hint>
        </Box>
    );
}

function ApiKeyStep({
    service,
    onSubmit,
    onSkip,
}: {
    service: ApiService;
    onSubmit: (key: string) => void;
    onSkip: () => void;
}) {
    const [value, setValue] = useState(() => {
        const envKey = API_SERVICE_ENV_KEYS[service];
        return process.env[envKey] ?? "";
    });

    const envKey = API_SERVICE_ENV_KEYS[service];
    const isLocal = LOCAL_SERVICES.has(service);

    useInput((_input, key) => {
        if (isLocal) return;
        if (key.escape) onSkip();
        if (key.tab)    onSkip();
    });

    useEffect(() => {
        if (!isLocal) return;
        const t = setTimeout(() => onSubmit(""), 50);
        return () => clearTimeout(t);
    }, [isLocal]);

    if (isLocal) {
        return (
            <Box flexDirection="column" gap={1}>
                <Text bold>  {service}  <Text color="green">is local — no API key needed</Text></Text>
                <Hint>Continuing...</Hint>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" gap={1}>
            <Text bold>  Enter your <Text color="cyan">{service}</Text> API key</Text>
            <Text dimColor>  Env var: <Text color="yellow">{envKey}</Text></Text>
            <Box marginTop={1}>
                <Text dimColor>  Key: </Text>
                <CustomTextInput
                    value={value}
                    onChange={setValue}
                    onSubmit={onSubmit}
                    placeholder="paste key here..."
                    mask="*"
                />
            </Box>
            <Hint>Enter confirm  Esc skip</Hint>
        </Box>
    );
}

function AliasInstallStep({
    onDone,
}: {
    onDone: (installed: boolean) => void;
}) {
    const isWindows = process.platform === "win32";
    const binDir = isWindows
        ? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "mygit")
        : path.join(os.homedir(), ".local", "bin");

    const [phase, setPhase] = useState<"confirm" | "installing" | "path_prompt" | "done_msg">("confirm");
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [inPath, setInPath] = useState(false);
    const [shellProfile] = useState(() => detectShellProfile());
    const [pathAdded, setPathAdded] = useState(false);

    const doInstall = async () => {
        setPhase("installing");
        try {
            const ep = getEntryPoint();
            const r = isWindows
                ? await installAliasWindows(ep)
                : await installAliasBin(ep);
            setResult(r.binPath);
            setInPath(r.alreadyInPath);
            if (!r.alreadyInPath && shellProfile && !isWindows) {
                setPhase("path_prompt");
            } else {
                setPhase("done_msg");
            }
        } catch (e: any) {
            setError(e.message);
            setPhase("done_msg");
        }
    };

    useInput((input, key) => {
        if (phase === "confirm") {
            if (input === "y" || input === "Y" || key.return) { doInstall(); return; }
            if (input === "n" || input === "N" || input === "s" || key.escape) { onDone(false); }
        }
        if (phase === "path_prompt") {
            if (input === "y" || input === "Y" || key.return) {
                appendPathExport(shellProfile!, binDir)
                    .then(() => { setPathAdded(true); setPhase("done_msg"); })
                    .catch(() => setPhase("done_msg"));
                return;
            }
            if (input === "n" || input === "N" || key.escape) { setPhase("done_msg"); }
        }
        if (phase === "done_msg") {
            if (key.return || input === "q") onDone(!!result && !error);
        }
    });

    if (phase === "confirm") {
        return (
            <Box flexDirection="column" gap={1}>
                <Text bold>  Install <Text color="cyan">mygit</Text> system-wide?</Text>
                <Text>  Will create: <Text color="yellow">{path.join(binDir, isWindows ? "mygit.cmd" : "mygit")}</Text></Text>
                {!isBinDirInPath(binDir) && (
                    <Text color="yellow">  ⚠  {binDir} is not in your PATH yet</Text>
                )}
                <Hint>y/Enter install  n/s skip</Hint>
            </Box>
        );
    }

    if (phase === "installing") {
        return (
            <Box flexDirection="column" gap={1}>
                <Text bold>  Installing...</Text>
                <Box>
                    <Text color="cyan"><Spinner type="dots" /></Text>
                    <Text dimColor>  writing wrapper script</Text>
                </Box>
            </Box>
        );
    }

    if (phase === "path_prompt") {
        return (
            <Box flexDirection="column" gap={1}>
                <Text color="green" bold>  ✓ Installed to {result}</Text>
                <Text>  </Text>
                <Text color="yellow" bold>  {binDir}</Text>
                <Text> is not in your PATH.</Text>
                <Text>  Add it to <Text color="cyan">{shellProfile ?? "your shell profile"}</Text>?</Text>
                <Hint>y/Enter yes  n skip</Hint>
            </Box>
        );
    }

    // done_msg
    return (
        <Box flexDirection="column" gap={1}>
            {error ? (
                <Text color="red" bold>  ✗ Install failed: {error}</Text>
            ) : (
                <Text color="green" bold>  ✓ Installed to {result}</Text>
            )}
            {pathAdded && (
                <Text color="cyan">  ✓ PATH export added to {shellProfile}</Text>
            )}
            {!inPath && !pathAdded && !error && (
                <Box flexDirection="column">
                    <Text color="yellow">  Add this to your shell profile to use </Text>
                    <Text color="yellow">mygit</Text>
                    <Text color="yellow"> from anywhere:</Text>
                    <Text color="cyan">    export PATH="{binDir}:$PATH"</Text>
                </Box>
            )}
            <Hint>Enter continue</Hint>
        </Box>
    );
}

function DoneStep({ summary }: { summary: string[] }) {
    const { exit } = useApp();

    useInput((input, key) => {
        if (key.return || input === "q") exit();
    });

    return (
        <Box flexDirection="column" gap={1}>
            <Box borderStyle="round" borderColor="green" paddingX={2} flexDirection="column">
                <Text color="green" bold>  Setup complete!</Text>
                {summary.map((line, i) => (
                    <Text key={i} color="cyan">  ✓ {line}</Text>
                ))}
            </Box>
            <Text>  Run <Text color="cyan" bold>mygit</Text> to open the TUI.</Text>
            <Hint>Enter or q to exit</Hint>
        </Box>
    );
}

// ============================================================================
// WIZARD
// ============================================================================

export function SetupWizard({ scope = "global" }: WizardProps) {
    const [step, setStep] = useState<WizardStep>("welcome");
    const [config] = useState(defaultConfig);
    const [summary, setSummary] = useState<string[]>([]);

    const addSummary = (line: string) => setSummary(s => [...s, line]);

    const STEP_ORDER: WizardStep[] = [
        "welcome", "provider_select", "ollama_model", "alias_install", "done",
    ];
    const stepNum = Math.max(1, STEP_ORDER.indexOf(step) + 1);
    const TOTAL = 5;

    // ── Provider selection ────────────────────────────────────────────
    const handleProvider = (choice: "ollama" | "api" | "skip") => {
        if (choice === "ollama") {
            config.provider = "ollama" as LLMProvider;
            setStep("ollama_model");
        } else if (choice === "api") {
            config.provider = "api" as LLMProvider;
            setStep("api_service_select");
        } else {
            setStep("alias_install");
        }
    };

    // ── Ollama model ──────────────────────────────────────────────────
    const handleOllamaModel = (model: string) => {
        config.ollama.model = model;
        addSummary(`Ollama model: ${model}`);
        persist().then(() => setStep("alias_install"));
    };

    // ── API service + key ─────────────────────────────────────────────
    const [selectedService, setSelectedService] = useState<ApiService>("openai");

    const handleApiService = (service: ApiService) => {
        config.api.activeService = service;
        setSelectedService(service);
        setStep("api_key_input");
    };

    const handleApiKey = (key: string) => {
        if (key) {
            config.api.apiKeys[selectedService] = key;
            addSummary(`${selectedService} API key saved`);
        } else {
            addSummary(`${selectedService} (no key)`);
        }
        persist().then(() => setStep("alias_install"));
    };

    // ── Persist config ────────────────────────────────────────────────
    const persist = async () => {
        const targetPath = scope === "project" ? repoConfigPath() : globalConfigPath();
        await saveConfig(config, targetPath);
        addSummary(`Config saved to ${targetPath}`);
    };

    // ── Alias install ─────────────────────────────────────────────────
    const handleInstall = (installed: boolean) => {
        if (installed) addSummary("mygit alias installed");
        setStep("done");
    };

    // ── Render ────────────────────────────────────────────────────────
    return (
        <Box flexDirection="column" paddingY={1}>
            <Header step={stepNum} total={TOTAL} />

            {step === "welcome" && (
                <WelcomeStep onNext={() => setStep("provider_select")} />
            )}
            {step === "provider_select" && (
                <ProviderSelectStep onSelect={handleProvider} />
            )}
            {step === "ollama_model" && (
                <OllamaModelStep
                    ollamaUrl={config.ollama.url}
                    onSelect={handleOllamaModel}
                    onSkip={() => setStep("alias_install")}
                />
            )}
            {step === "api_service_select" && (
                <ApiServiceStep
                    selectedIdx={0}
                    onSelect={handleApiService}
                    onBack={() => setStep("provider_select")}
                />
            )}
            {step === "api_key_input" && (
                <ApiKeyStep
                    service={selectedService}
                    onSubmit={handleApiKey}
                    onSkip={() => setStep("alias_install")}
                />
            )}
            {step === "alias_install" && (
                <AliasInstallStep onDone={handleInstall} />
            )}
            {step === "done" && (
                <DoneStep summary={summary} />
            )}
        </Box>
    );
}
