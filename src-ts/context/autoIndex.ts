import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ContextConfig } from "../config/settings.js";
import { ProjectIndexer } from "./indexer.js";
import { openProjectDatabaseAt } from "../storage/database.js";
import { compileKnowledgeStore } from "../knowledge/compiler.js";
import { loadKnowledgeManifest, writeKnowledgeStore } from "../knowledge/store.js";

export interface IncrementalRefreshOptions {
    repoRoot: string;
    model: BaseChatModel;
    contextConfig?: Pick<ContextConfig, "enabled" | "autoIndex">;
    relativePaths: string[];
}

export interface IncrementalRefreshResult {
    attempted: number;
    refreshed: number;
    skipped: boolean;
    reason?: "disabled" | "auto_index_off" | "index_missing" | "no_files";
}

function uniqueRefreshPaths(relativePaths: string[]): string[] {
    return Array.from(
        new Set(
            relativePaths
                .map((file) => file.trim().replace(/\\/g, "/"))
                .filter(Boolean)
                .filter((file) => file !== ".mygit/MYGIT.md")
                .filter((file) => file !== ".mygit/FOCUS.md")
                .filter((file) => file !== "AGENTS.md")
                .filter((file) => !file.startsWith(".mygit/knowledge/")),
        ),
    );
}

export async function refreshIndexedFiles(
    options: IncrementalRefreshOptions,
): Promise<IncrementalRefreshResult> {
    if (options.contextConfig?.enabled === false) {
        return { attempted: 0, refreshed: 0, skipped: true, reason: "disabled" };
    }
    if (options.contextConfig?.autoIndex === false) {
        return { attempted: 0, refreshed: 0, skipped: true, reason: "auto_index_off" };
    }

    const relativePaths = uniqueRefreshPaths(options.relativePaths);
    if (relativePaths.length === 0) {
        return { attempted: 0, refreshed: 0, skipped: true, reason: "no_files" };
    }

    const db = openProjectDatabaseAt(options.repoRoot);
    try {
        const stats = db.getContextIndexStats();
        if (stats.totalChunks === 0) {
            return { attempted: 0, refreshed: 0, skipped: true, reason: "index_missing" };
        }

        const indexer = new ProjectIndexer(db, options.model);
        const results = await indexer.refreshFiles(options.repoRoot, relativePaths);
        const refreshed = results.filter((result) => result.status === "indexed").length;

        const knowledgeManifest = await loadKnowledgeManifest(options.repoRoot);
        if (knowledgeManifest) {
            const compiled = await compileKnowledgeStore({
                repoRoot: options.repoRoot,
                db,
            });
            await writeKnowledgeStore(options.repoRoot, compiled);
        }

        return {
            attempted: relativePaths.length,
            refreshed,
            skipped: false,
        };
    } finally {
        db.close();
    }
}

export function queueIncrementalIndexRefresh(options: IncrementalRefreshOptions): void {
    void refreshIndexedFiles(options).catch(() => {
        // Best-effort background refresh; never block the caller.
    });
}
