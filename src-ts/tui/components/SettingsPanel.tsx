/**
 * SettingsPanel — interactive configuration editor
 *
 * Allows users to view and edit global/repo configuration.
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import {
    type Config,
    type LLMProvider,
    type AutomationLevel,
    type PlanningMode,
    type UiThemePreset,
    saveConfig,
    repoConfigPath,
    defaultConfig,
} from "../../config/settings.js";

// ── Props ──────────────────────────────────────────────────────────────

interface SettingsPanelProps {
    config: Config;
    onSave: (newConfig: Config) => void;
    onCancel: () => void;
    accentColor?: string;
}

// ── Sections ───────────────────────────────────────────────────────────

type Section = "provider" | "agent" | "ui" | "permissions";

const SECTIONS: { label: string; value: Section }[] = [
    { label: "LLM Provider", value: "provider" },
    { label: "Agent Behavior", value: "agent" },
    { label: "User Interface", value: "ui" },
    { label: "Permissions", value: "permissions" },
];

// ── Field Types ────────────────────────────────────────────────────────

interface TextField {
    key: string;
    label: string;
    type: "text";
    value: string;
    masked?: boolean;
    onChange: (v: string) => void;
}

interface SelectField {
    key: string;
    label: string;
    type: "select";
    options: { label: string; value: string }[];
    value: string;
    onChange: (v: string) => void;
}

type Field = TextField | SelectField;

// ── Components ─────────────────────────────────────────────────────────

export function SettingsPanel({
    config: initialConfig,
    onSave,
    onCancel,
    accentColor = "#8b5cf6",
}: SettingsPanelProps): React.ReactElement {
    const [config, setConfig] = useState<Config>(initialConfig);
    const [activeSection, setActiveSection] = useState<Section>("provider");
    const [activeField, setActiveField] = useState<number>(0);
    const [editing, setEditing] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    // Filter fields based on active section
    const getFields = (): Field[] => {
        switch (activeSection) {
            case "provider":
                return [
                    {
                        key: "provider",
                        label: "Active Provider",
                        type: "select",
                        options: [
                            { label: "Ollama (Local)", value: "ollama" },
                            { label: "Google Gemini", value: "google" },
                        ],
                        value: config.provider,
                        onChange: (v: string) => setConfig({ ...config, provider: v as LLMProvider }),
                    },
                    ...(config.provider === "ollama"
                        ? ([
                            {
                                key: "ollama.url",
                                label: "Ollama URL",
                                type: "text",
                                value: config.ollama.url,
                                onChange: (v: string) =>
                                    setConfig({
                                        ...config,
                                        ollama: { ...config.ollama, url: v },
                                    }),
                            },
                            {
                                key: "ollama.model",
                                label: "Ollama Model",
                                type: "text",
                                value: config.ollama.model,
                                onChange: (v: string) =>
                                    setConfig({
                                        ...config,
                                        ollama: { ...config.ollama, model: v },
                                    }),
                            },
                        ] as Field[])
                        : []),
                    ...(config.provider === "google"
                        ? ([
                            {
                                key: "google.apiKey",
                                label: "API Key",
                                type: "text",
                                value: config.google.apiKey,
                                masked: true,
                                onChange: (v: string) =>
                                    setConfig({
                                        ...config,
                                        google: { ...config.google, apiKey: v },
                                    }),
                            },
                            {
                                key: "google.model",
                                label: "Model",
                                type: "text",
                                value: config.google.model,
                                onChange: (v: string) =>
                                    setConfig({
                                        ...config,
                                        google: { ...config.google, model: v },
                                    }),
                            },
                        ] as Field[])
                        : []),
                ];
            case "agent":
                return [
                    {
                        key: "automationLevel",
                        label: "Automation Level",
                        type: "select",
                        options: [
                            { label: "Safe (Ask always)", value: "safe" },
                            { label: "Semi-Autonomous", value: "semi_autonomous" },
                            { label: "Extreme (YOLO)", value: "extreme" },
                        ],
                        value: config.agent.automationLevel,
                        onChange: (v: string) =>
                            setConfig({
                                ...config,
                                agent: { ...config.agent, automationLevel: v as AutomationLevel },
                            }),
                    },
                    {
                        key: "planningMode",
                        label: "Planning Mode",
                        type: "select",
                        options: [
                            { label: "Show & Approve", value: "show_and_approve" },
                            { label: "Show & Execute", value: "show_and_execute" },
                            { label: "Just Execute", value: "just_execute" },
                        ],
                        value: config.agent.planningMode,
                        onChange: (v: string) =>
                            setConfig({
                                ...config,
                                agent: { ...config.agent, planningMode: v as PlanningMode },
                            }),
                    },
                    {
                        key: "showThinking",
                        label: "Show Thinking",
                        type: "select",
                        options: [
                            { label: "Yes", value: "true" },
                            { label: "No", value: "false" },
                        ],
                        value: config.agent.showThinking ? "true" : "false",
                        onChange: (v: string) =>
                            setConfig({
                                ...config,
                                agent: { ...config.agent, showThinking: v === "true" },
                            }),
                    },
                ];
            case "ui":
                return [
                    {
                        key: "theme",
                        label: "Theme",
                        type: "select",
                        options: [
                            { label: "Nebula Pulse", value: "nebula_pulse" },
                            { label: "Graphite Mist", value: "graphite_mist" },
                            { label: "Ghost Glass", value: "ghost_glass" },
                        ],
                        value: config.ui.theme,
                        onChange: (v: string) =>
                            setConfig({
                                ...config,
                                ui: { ...config.ui, theme: v as UiThemePreset },
                            }),
                    },
                ];
            case "permissions":
                return [
                    {
                        key: "shellCommands",
                        label: "Shell Commands",
                        type: "select",
                        options: [
                            { label: "Ask", value: "ask" },
                            { label: "Allowed", value: "allowed" },
                            { label: "Denied", value: "denied" },
                        ],
                        value: config.agent.permissions.shellCommands,
                        onChange: (v: string) =>
                            setConfig({
                                ...config,
                                agent: {
                                    ...config.agent,
                                    permissions: { ...config.agent.permissions, shellCommands: v as any },
                                },
                            }),
                    },
                    {
                        key: "fileWrites",
                        label: "File Writes",
                        type: "select",
                        options: [
                            { label: "Ask", value: "ask" },
                            { label: "Allowed", value: "allowed" },
                            { label: "Denied", value: "denied" },
                        ],
                        value: config.agent.permissions.fileWrites,
                        onChange: (v: string) =>
                            setConfig({
                                ...config,
                                agent: {
                                    ...config.agent,
                                    permissions: { ...config.agent.permissions, fileWrites: v as any },
                                },
                            }),
                    },
                    {
                        key: "destructiveGit",
                        label: "Destructive Git",
                        type: "select",
                        options: [
                            { label: "Ask", value: "ask" },
                            { label: "Allowed", value: "allowed" },
                            { label: "Denied", value: "denied" },
                        ],
                        value: config.agent.permissions.destructiveGit,
                        onChange: (v: string) =>
                            setConfig({
                                ...config,
                                agent: {
                                    ...config.agent,
                                    permissions: { ...config.agent.permissions, destructiveGit: v as any },
                                },
                            }),
                    },
                ];
        }
    };

    const fields = getFields();

    useInput(async (input, key) => {
        if (editing) {
            if (key.return) {
                setEditing(false);
            } else if (key.escape) {
                setEditing(false);
            }
            return;
        }

        if (key.upArrow) {
            if (activeField > 0) setActiveField(activeField - 1);
        } else if (key.downArrow) {
            if (activeField < fields.length - 1) setActiveField(activeField + 1);
        } else if (key.leftArrow) {
            // Switch section
            const idx = SECTIONS.findIndex((s) => s.value === activeSection);
            const next = SECTIONS[(idx - 1 + SECTIONS.length) % SECTIONS.length];
            setActiveSection(next.value);
            setActiveField(0);
        } else if (key.rightArrow) {
            // Switch section
            const idx = SECTIONS.findIndex((s) => s.value === activeSection);
            const next = SECTIONS[(idx + 1) % SECTIONS.length];
            setActiveSection(next.value);
            setActiveField(0);
        } else if (key.return) {
            const field = fields[activeField];
            if (field.type === "text") {
                setEditing(true);
            }
        } else if (key.escape) {
            onCancel();
        } else if (input === "s" && (key.meta || key.ctrl)) {
            // Save
            try {
                const path = repoConfigPath();
                await saveConfig(config, path);
                onSave(config);
                setMessage("Saved!");
            } catch (err) {
                setMessage("Failed to save");
            }
        }
    });

    return (
        <Box flexDirection="column" padding={1} borderStyle="single" borderColor={accentColor}>
            <Box justifyContent="space-between" marginBottom={1}>
                <Text bold color={accentColor}>
                    Configuration
                </Text>
                <Text color="gray">Ctx+S to Save • Esc to Cancel</Text>
            </Box>

            {/* Tabs */}
            <Box marginBottom={1} gap={2}>
                {SECTIONS.map((section) => (
                    <Text
                        key={section.value}
                        color={activeSection === section.value ? accentColor : "gray"}
                        underline={activeSection === section.value}
                        bold={activeSection === section.value}
                    >
                        {section.label}
                    </Text>
                ))}
            </Box>

            {/* Fields */}
            <Box flexDirection="column" gap={1}>
                {fields.map((field, idx) => {
                    const isActive = idx === activeField;
                    return (
                        <Box key={field.key} flexDirection="column">
                            <Text color={isActive ? accentColor : "white"}>
                                {isActive ? "› " : "  "}
                                {field.label}
                            </Text>

                            <Box paddingLeft={2}>
                                {field.type === "text" ? (
                                    isActive && editing ? (
                                        <TextInput
                                            value={field.value}
                                            onChange={field.onChange}
                                            onSubmit={() => setEditing(false)}
                                            mask={(field as TextField).masked ? "*" : undefined}
                                        />
                                    ) : (
                                        <Text dimColor>
                                            {(field as TextField).masked
                                                ? "*".repeat(Math.min(20, (field as TextField).value.length)) ||
                                                "(empty)"
                                                : (field as TextField).value}
                                        </Text>
                                    )
                                ) : (
                                    <SelectInput
                                        items={field.options}
                                        onSelect={(item) => field.onChange(item.value)}
                                        itemComponent={(props) => (
                                            <Text
                                                color={
                                                    props.isSelected && isActive
                                                        ? accentColor
                                                        : "gray"
                                                }
                                            >
                                                {props.isSelected ? "◉ " : "○ "}
                                                {props.label}
                                            </Text>
                                        )}
                                        // Only control select input when active and not text editing
                                        isFocused={isActive && !editing}
                                    />
                                )}
                            </Box>
                        </Box>
                    );
                })}
            </Box>

            {message && (
                <Box marginTop={1}>
                    <Text color="green">{message}</Text>
                </Box>
            )}
        </Box>
    );
}
