// ── Command palette data ──────────────────────────────────────────────────────

export interface SlashCommandDef {
    id: string;
    label: string;
    description: string;
    hasSubmenu: boolean;
    aliases?: string[];
}

export interface SlashSubcommandDef {
    id: string;
    label: string;
    description: string;
}

export const TOP_SLASH_COMMANDS: SlashCommandDef[] = [
    { id: "init",      label: "/init",      description: "Index project + rebuild AGENTS map", hasSubmenu: false },
    { id: "branch",    label: "/branch",    description: "Branch panel + feature locator",  hasSubmenu: false },
    { id: "commit",    label: "/commit",    description: "Draft, review, and commit changes", hasSubmenu: false, aliases: ["summary"] },
    { id: "fetch",     label: "/fetch",     description: "Fetch + ff-only update current branch", hasSubmenu: false },
    { id: "fetch-all", label: "/fetch-all", description: "Fetch + safe fast-forward all branches", hasSubmenu: false },
    { id: "config",    label: "/config",    description: "Edit settings",               hasSubmenu: false },
    { id: "provider",  label: "/provider",  description: "Manage LLM providers",        hasSubmenu: false },
    { id: "model",     label: "/model",     description: "Select AI model",             hasSubmenu: false },
    { id: "conflicts", label: "/conflicts", description: "View merge conflicts",        hasSubmenu: false },
    { id: "worktrees", label: "/worktrees", description: "Manage worktrees",            hasSubmenu: false },
    { id: "pr",        label: "/pr",        description: "Open PR inbox",               hasSubmenu: false },
    { id: "pr-commits", label: "/pr-commits", description: "Show PR commit diff",       hasSubmenu: false },
    { id: "clear",     label: "/clear",     description: "Clear context · start fresh", hasSubmenu: false },
    { id: "compact",   label: "/compact",   description: "Summarize conversation",      hasSubmenu: true  },
    { id: "exit",      label: "/exit",      description: "Quit mygit",                 hasSubmenu: false },
];

export const COMPACT_SUBCOMMANDS: SlashSubcommandDef[] = [
    { id: "compact-memory", label: "In-memory",    description: "Compact · restart with summary as context"    },
    { id: "compact-save",   label: "Save to file", description: "Compact · persist latest memory to .mygit/MYGIT.md" },
];

export function formatSupportedSlashCommands(): string {
    const runtime = TOP_SLASH_COMMANDS.flatMap((c) => [`/${c.id}`, ...(c.aliases ?? []).map((alias) => `/${alias}`)]);
    const legacy = ["/implement", "/save-implementation", "/run-implementation"];
    return "Supported: " + Array.from(new Set([...runtime, ...legacy])).join(", ");
}

// ── Legacy CLI parser (kept for non-TUI callers & tests) ─────────────────────

export type SlashCommandParseResult =
    | { kind: "menu" }
    | { kind: "command"; id: string; args: string[]; rawArgs: string }
    | { kind: "implement" }
    | { kind: "save_implementation" }
    | { kind: "run_implementation"; ref?: string }
    | { kind: "unknown"; command: string };

export function resolveSlashCommand(name: string): SlashCommandDef | undefined {
    const normalized = name.trim().toLowerCase();
    return TOP_SLASH_COMMANDS.find((command) =>
        command.id === normalized || (command.aliases ?? []).includes(normalized),
    );
}

export function parseSlashCommand(input: string): SlashCommandParseResult {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return { kind: "unknown", command: trimmed };
    if (trimmed === "/") return { kind: "menu" };
    const parts = trimmed.slice(1).trim().split(/\s+/).filter(Boolean);
    const command = parts[0]?.toLowerCase() ?? "";
    if (command === "implement") return { kind: "implement" };
    if (command === "save-implementation") return { kind: "save_implementation" };
    if (command === "run-implementation") {
        return parts[1] ? { kind: "run_implementation", ref: parts[1] } : { kind: "run_implementation" };
    }
    const runtime = resolveSlashCommand(command);
    if (runtime) {
        return {
            kind: "command",
            id: runtime.id,
            args: parts.slice(1),
            rawArgs: parts.slice(1).join(" "),
        };
    }
    return { kind: "unknown", command };
}
