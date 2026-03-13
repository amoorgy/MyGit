/**
 * ModelSelector — full-screen overlay for choosing LLM provider and model.
 *
 * Features:
 * - Provider tabs at top (Local, Anthropic, OpenAI, etc.)
 * - Search/filter row
 * - Scrollable model list with descriptions
 * - Dynamic Ollama model fetching
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { UiPalette } from "../theme.js";
import type { ApiService } from "../../config/settings.js";
import { API_SERVICE_ENV_KEYS } from "../../config/settings.js";
import {
    type ModelInfo,
    API_MODEL_CATALOG,
    API_SERVICE_LABELS,
    fetchOllamaModels,
    fetchLmStudioModels,
    formatByteSize,
} from "../../llm/providers.js";
import { CustomTextInput } from "./CustomTextInput.js";

// ============================================================================
// TYPES
// ============================================================================

type TabId = "ollama" | "transformer" | ApiService;

interface Tab {
    id: TabId;
    label: string;
    available: boolean;
}

interface ModelSelectorProps {
    onSelect: (provider: "ollama" | "api" | "transformer", service: ApiService | null, modelName: string) => void;
    onClose: () => void;
    palette: UiPalette;
    ollamaUrl?: string;
    apiKeys: Partial<Record<ApiService, string>>;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ModelSelector({
    onSelect,
    onClose,
    palette,
    ollamaUrl,
    apiKeys,
}: ModelSelectorProps) {
    const [activeTab, setActiveTab] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [ollamaModels, setOllamaModels] = useState<ModelInfo[]>([]);
    const [lmStudioModels, setLmStudioModels] = useState<ModelInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLmStudioLoading, setIsLmStudioLoading] = useState(true);

    // Services that are local (no API key required)
    const LOCAL_TAB_IDS = new Set(["ollama", "transformer", "lmstudio"]);

    // Build tabs
    const tabs: Tab[] = useMemo(() => {
        const result: Tab[] = [
            { id: "ollama", label: "Local (Ollama)", available: true },
            { id: "lmstudio", label: API_SERVICE_LABELS.lmstudio, available: true },
            { id: "transformer", label: "HuggingFace (Local)", available: true },
        ];

        const services: ApiService[] = [
            "anthropic", "openai", "gemini", "deepseek",
            "moonshot", "groq", "cerebras", "openrouter",
        ];

        for (const service of services) {
            const envKey = API_SERVICE_ENV_KEYS[service];
            const hasKey = !!(apiKeys[service] || process.env[envKey]);
            result.push({
                id: service,
                label: API_SERVICE_LABELS[service],
                available: hasKey,
            });
        }

        return result;
    }, [apiKeys]);

    // Fetch Ollama models on mount
    useEffect(() => {
        (async () => {
            setIsLoading(true);
            const models = await fetchOllamaModels(ollamaUrl);
            setOllamaModels(models);
            setIsLoading(false);
        })();
    }, [ollamaUrl]);

    // Fetch LM Studio models on mount
    useEffect(() => {
        (async () => {
            setIsLmStudioLoading(true);
            const models = await fetchLmStudioModels();
            setLmStudioModels(models);
            setIsLmStudioLoading(false);
        })();
    }, []);

    // Get models for current tab
    const currentModels = useMemo(() => {
        const tab = tabs[activeTab];
        if (!tab) return [];

        let models: ModelInfo[];
        if (tab.id === "ollama") {
            models = ollamaModels;
        } else if (tab.id === "lmstudio") {
            models = lmStudioModels.length > 0 ? lmStudioModels : (API_MODEL_CATALOG.lmstudio ?? []);
        } else if (tab.id === "transformer") {
            models = API_MODEL_CATALOG.transformer ?? [];
        } else {
            models = API_MODEL_CATALOG[tab.id] ?? [];
        }

        // Apply search filter
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            models = models.filter(
                (m) =>
                    m.name.toLowerCase().includes(q) ||
                    m.displayName.toLowerCase().includes(q) ||
                    (m.description?.toLowerCase().includes(q) ?? false),
            );
        }

        return models;
    }, [activeTab, tabs, ollamaModels, searchQuery]);

    // Clamp selection when models change
    useEffect(() => {
        setSelectedIndex(0);
    }, [activeTab, searchQuery]);

    useInput(
        (input, key) => {
            if (isSearching) {
                if (key.escape) {
                    setIsSearching(false);
                    setSearchQuery("");
                } else if (key.return) {
                    setIsSearching(false);
                }
                return;
            }

            if (key.escape || input === "q") {
                onClose();
                return;
            }

            // Tab navigation
            if (key.leftArrow) {
                setActiveTab((t) => Math.max(0, t - 1));
                return;
            }
            if (key.rightArrow) {
                setActiveTab((t) => Math.min(tabs.length - 1, t + 1));
                return;
            }

            // Model list navigation
            if (key.upArrow) {
                setSelectedIndex((s) => Math.max(0, s - 1));
                return;
            }
            if (key.downArrow) {
                setSelectedIndex((s) => Math.min(currentModels.length - 1, s + 1));
                return;
            }

            // Select model
            if (key.return && currentModels.length > 0) {
                const model = currentModels[selectedIndex];
                if (model) {
                    const tab = tabs[activeTab];
                    if (tab.id === "ollama") {
                        onSelect("ollama", null, model.name);
                    } else if (tab.id === "transformer") {
                        onSelect("transformer", null, model.name);
                    } else {
                        onSelect("api", tab.id as ApiService, model.name);
                    }
                }
                return;
            }

            // Search
            if (input === "/") {
                setIsSearching(true);
                return;
            }
        },
        { isActive: !isSearching },
    );

    const currentTab = tabs[activeTab];

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={palette.borderActive}
            paddingX={1}
            paddingY={0}
        >
            {/* Header */}
            <Text color={palette.accent} bold>
                Select Model
            </Text>

            {/* Tabs */}
            <Box marginTop={1} flexWrap="wrap">
                {tabs.map((tab, i) => {
                    const isActive = i === activeTab;
                    const color = !tab.available
                        ? palette.fgMuted
                        : isActive
                            ? palette.accent
                            : palette.fgDim;
                    return (
                        <Text key={tab.id} color={color} bold={isActive} underline={isActive}>
                            {" "}
                            {tab.label}
                            {tab.id === "lmstudio" && !isLmStudioLoading && lmStudioModels.length === 0
                                ? " (not running)"
                                : !tab.available && !LOCAL_TAB_IDS.has(tab.id)
                                    ? " (no key)"
                                    : ""}
                            {" "}
                        </Text>
                    );
                })}
            </Box>

            {/* Search */}
            <Box marginTop={1}>
                {isSearching ? (
                    <Box>
                        <Text color={palette.accent}>/ </Text>
                        <CustomTextInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            onSubmit={() => setIsSearching(false)}
                            placeholder="Filter models..."
                        />
                    </Box>
                ) : searchQuery ? (
                    <Text color={palette.fgMuted}>
                        Filter: {searchQuery} (press / to search, Esc to clear)
                    </Text>
                ) : (
                    <Text color={palette.fgMuted}>
                        Press / to search
                    </Text>
                )}
            </Box>

            {/* Model List */}
            <Box flexDirection="column" marginTop={1}>
                {(isLoading && currentTab?.id === "ollama") || (isLmStudioLoading && currentTab?.id === "lmstudio") ? (
                    <Text color={palette.warning}>
                        {currentTab?.id === "lmstudio" ? "Connecting to LM Studio..." : "Loading Ollama models..."}
                    </Text>
                ) : currentModels.length === 0 ? (
                    <Text color={palette.fgMuted} italic>
                        {currentTab?.id === "lmstudio"
                            ? "LM Studio not running or no models loaded. Start LM Studio and load a model."
                            : !currentTab?.available && !LOCAL_TAB_IDS.has(currentTab?.id ?? "")
                                ? `No API key configured. Set ${API_SERVICE_ENV_KEYS[currentTab.id as ApiService] ?? ""} env var.`
                                : "No models found."}
                    </Text>
                ) : (
                    currentModels.slice(
                        Math.max(0, selectedIndex - 8),
                        Math.max(0, selectedIndex - 8) + 12,
                    ).map((model, i) => {
                        const actualIndex = Math.max(0, selectedIndex - 8) + i;
                        const isSelected = actualIndex === selectedIndex;
                        return (
                            <Box key={model.name}>
                                <Text
                                    color={isSelected ? palette.accent : palette.fg}
                                    bold={isSelected}
                                >
                                    {isSelected ? "▸ " : "  "}
                                    {model.displayName}
                                </Text>
                                {model.binarySizeBytes && (
                                    <Text color={palette.fgMuted}>
                                        {" "}({formatByteSize(model.binarySizeBytes)})
                                    </Text>
                                )}
                                {model.parameterSize && (
                                    <Text color={palette.fgMuted}>
                                        {" "}[{model.parameterSize}]
                                    </Text>
                                )}
                                {model.description && (
                                    <Text color={palette.fgMuted}>
                                        {" — "}{model.description}
                                    </Text>
                                )}
                            </Box>
                        );
                    })
                )}
            </Box>

            {/* Help bar */}
            <Box marginTop={1}>
                <Text color={palette.fgMuted} italic>
                    ←→ provider · ↑↓ select · Enter confirm · / search · Esc close
                </Text>
            </Box>
        </Box>
    );
}
