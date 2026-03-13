/**
 * Permission Manager — mirrors Rust `src/agent/permissions.rs`
 *
 * Manages permission states across global, repo, and session scopes.
 */

import {
    type AgentAction,
    type PermissionCategory,
    type SafetyTier,
    actionPermissionCategory,
    actionSafetyTier,
} from "./protocol.js";
import type { Config } from "../config/settings.js";

// ============================================================================
// TYPES
// ============================================================================

export type PermissionState = "allowed" | "denied" | "ask";
export type PermissionDecision = "allowed" | "denied" | "need_prompt";

export type PermissionResponse =
    | "allow_once"
    | "allow_session"
    | "allow_permanent"
    | "deny_once"
    | "deny_session"
    | "deny_permanent";

export interface FileWriteScope {
    repoOnly: boolean;
    excludePatterns: string[];
}

// ============================================================================
// PERMISSION MANAGER
// ============================================================================

export class PermissionManager {
    private globalPermissions: Map<PermissionCategory, PermissionState>;
    private repoPermissions: Map<PermissionCategory, PermissionState>;
    private sessionAllowed: Set<PermissionCategory>;
    private sessionDenied: Set<PermissionCategory>;
    private shellAllowlist: string[];

    constructor(
        global: Map<PermissionCategory, PermissionState>,
        repo: Map<PermissionCategory, PermissionState>,
        shellAllowlist: string[],
        _fileWriteScope: FileWriteScope,
        _requireDoubleConfirm: boolean,
    ) {
        this.globalPermissions = global;
        this.repoPermissions = repo;
        this.sessionAllowed = new Set();
        this.sessionDenied = new Set();
        this.shellAllowlist = shellAllowlist;
    }

    /**
     * Create a default PermissionManager.
     */
    static default(): PermissionManager {
        return new PermissionManager(
            new Map(),
            new Map(),
            [],
            { repoOnly: true, excludePatterns: [".git/"] },
            false,
        );
    }

    /**
     * Create a PermissionManager from the loaded Config.
     */
    static fromConfig(config: Config): PermissionManager {
        const global = new Map<PermissionCategory, PermissionState>();
        const perms = config.agent.permissions;
        if (perms.shellCommands) global.set("shell_commands", perms.shellCommands as PermissionState);
        if (perms.fileWrites) global.set("file_writes", perms.fileWrites as PermissionState);
        if (perms.destructiveGit) global.set("destructive_git", perms.destructiveGit as PermissionState);

        return new PermissionManager(
            global,
            new Map(), // repo permissions loaded separately
            config.agent.shell?.allowlist ?? [],
            { repoOnly: true, excludePatterns: [".git/"] },
            config.agent.confirmation?.requireDoubleConfirm ?? false,
        );
    }

    /**
     * Check whether an action is allowed, denied, or needs a user prompt.
     */
    check(action: AgentAction): PermissionDecision {
        // Safe-tier actions are always allowed
        if (actionSafetyTier(action) === "safe") {
            return "allowed";
        }

        // Shell allowlist bypass
        if (action.type === "shell" && this.isInShellAllowlist(action.command)) {
            return "allowed";
        }

        const category = actionPermissionCategory(action);
        if (!category) return "need_prompt";

        // Session overrides
        if (this.sessionAllowed.has(category)) return "allowed";
        if (this.sessionDenied.has(category)) return "denied";

        // Repo overrides global
        const state =
            this.repoPermissions.get(category) ??
            this.globalPermissions.get(category) ??
            "ask";

        switch (state) {
            case "allowed":
                return "allowed";
            case "denied":
                return "denied";
            case "ask":
            default:
                return "need_prompt";
        }
    }

    /**
     * Apply a user's permission response. Returns true if the action should proceed.
     */
    applyResponse(action: AgentAction, response: PermissionResponse): boolean {
        const category = actionPermissionCategory(action);

        switch (response) {
            case "allow_once":
                return true;

            case "allow_session":
                if (category) this.sessionAllowed.add(category);
                return true;

            case "allow_permanent":
                if (category) this.repoPermissions.set(category, "allowed");
                return true;

            case "deny_once":
                return false;

            case "deny_session":
                if (category) this.sessionDenied.add(category);
                return false;

            case "deny_permanent":
                if (category) this.repoPermissions.set(category, "denied");
                return false;
        }
    }

    /**
     * Check if a shell command is in the allowlist.
     */
    private isInShellAllowlist(command: string): boolean {
        return this.shellAllowlist.some(
            (allowed) => command === allowed || command.startsWith(`${allowed} `),
        );
    }
}
