import * as fs from "fs/promises";
import * as path from "path";
import type {
    CompiledKnowledgeStore,
    KnowledgeManifest,
    KnowledgeStatus,
} from "./types.js";

export const KNOWLEDGE_DIR_NAME = "knowledge";
export const KNOWLEDGE_MANIFEST_NAME = "manifest.json";
export const GENERATED_AGENT_MAP_NAME = "AGENTS.generated.md";
export const ROOT_AGENT_MAP_NAME = "AGENTS.md";
export const MANAGED_AGENT_MARKER = "<!-- mygit:managed-agents -->";

function catalogSignature(manifest: Pick<KnowledgeManifest, "shards"> | null): string {
    if (!manifest) return "";
    return JSON.stringify(
        manifest.shards.map((shard) => ({
            id: shard.id,
            path: shard.path,
            title: shard.title,
            priority: shard.priority,
        })),
    );
}

export function knowledgeRootPath(repoRoot: string): string {
    return path.join(repoRoot, ".mygit", KNOWLEDGE_DIR_NAME);
}

export function knowledgeManifestPath(repoRoot: string): string {
    return path.join(knowledgeRootPath(repoRoot), KNOWLEDGE_MANIFEST_NAME);
}

export function knowledgeShardPath(repoRoot: string, relativePath: string): string {
    return path.join(knowledgeRootPath(repoRoot), relativePath);
}

export function generatedAgentMapPath(repoRoot: string): string {
    return path.join(knowledgeRootPath(repoRoot), GENERATED_AGENT_MAP_NAME);
}

export function rootAgentMapPath(repoRoot: string): string {
    return path.join(repoRoot, ROOT_AGENT_MAP_NAME);
}

export function isManagedAgentMap(content: string): boolean {
    return content.includes(MANAGED_AGENT_MARKER);
}

async function readUtf8(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch {
        return null;
    }
}

export async function loadKnowledgeManifest(repoRoot: string): Promise<KnowledgeManifest | null> {
    const raw = await readUtf8(knowledgeManifestPath(repoRoot));
    if (!raw) return null;

    try {
        return JSON.parse(raw) as KnowledgeManifest;
    } catch {
        return null;
    }
}

export async function loadKnowledgeShard(repoRoot: string, relativePath: string): Promise<string | null> {
    return await readUtf8(knowledgeShardPath(repoRoot, relativePath));
}

export async function loadAgentMap(
    repoRoot: string,
    manifest?: KnowledgeManifest | null,
): Promise<{ path: string; content: string } | null> {
    const preferredPath = manifest?.agentsManaged === false
        ? generatedAgentMapPath(repoRoot)
        : rootAgentMapPath(repoRoot);

    const preferred = await readUtf8(preferredPath);
    if (preferred) {
        return { path: path.relative(repoRoot, preferredPath).replace(/\\/g, "/"), content: preferred };
    }

    const fallbackPath = preferredPath === rootAgentMapPath(repoRoot)
        ? generatedAgentMapPath(repoRoot)
        : rootAgentMapPath(repoRoot);
    const fallback = await readUtf8(fallbackPath);
    if (!fallback) return null;

    return { path: path.relative(repoRoot, fallbackPath).replace(/\\/g, "/"), content: fallback };
}

export async function getKnowledgeStatus(repoRoot: string): Promise<KnowledgeStatus> {
    const manifest = await loadKnowledgeManifest(repoRoot);
    if (!manifest) {
        return {
            present: false,
            generatedAt: null,
            shardCount: 0,
            agentsManaged: false,
        };
    }

    return {
        present: true,
        generatedAt: manifest.generatedAt,
        shardCount: manifest.shards.length,
        agentsManaged: manifest.agentsManaged,
    };
}

function renderInitPlaceholder(): string {
    return [
        "# AGENTS.md",
        MANAGED_AGENT_MARKER,
        "Managed by mygit.",
        "",
        "Run `mygit init` to rebuild the repo knowledge map.",
        "",
    ].join("\n");
}

export interface WriteKnowledgeStoreResult {
    shardCount: number;
    manifestPath: string;
    agentsManaged: boolean;
    agentMapPath: string;
    warning?: string;
    catalogChanged: boolean;
}

export async function writeKnowledgeStore(
    repoRoot: string,
    compiled: CompiledKnowledgeStore,
): Promise<WriteKnowledgeStoreResult> {
    const knowledgeRoot = knowledgeRootPath(repoRoot);
    const manifestPath = knowledgeManifestPath(repoRoot);
    const existingManifest = await loadKnowledgeManifest(repoRoot);
    const currentRootAgentMap = await readUtf8(rootAgentMapPath(repoRoot));
    const rootAgentState =
        currentRootAgentMap === null
            ? "missing"
            : isManagedAgentMap(currentRootAgentMap)
                ? "managed"
                : "custom";
    const agentsManaged = rootAgentState !== "custom";

    const manifest: KnowledgeManifest = {
        ...compiled.manifest,
        agentsManaged,
    };

    await fs.mkdir(knowledgeRoot, { recursive: true });

    const previousShardPaths = new Set(existingManifest?.shards.map((shard) => shard.path) ?? []);
    const nextShardPaths = new Set(manifest.shards.map((shard) => shard.path));
    for (const stalePath of previousShardPaths) {
        if (nextShardPaths.has(stalePath)) continue;
        await fs.rm(knowledgeShardPath(repoRoot, stalePath), { force: true });
    }

    for (const shardDoc of compiled.shards) {
        await fs.writeFile(
            knowledgeShardPath(repoRoot, shardDoc.shard.path),
            shardDoc.content,
            "utf-8",
        );
    }

    const catalogChanged =
        catalogSignature(existingManifest) !== catalogSignature(manifest)
        || rootAgentState === "missing";

    let agentMapPath = rootAgentMapPath(repoRoot);
    let warning: string | undefined;
    if (agentsManaged) {
        if (catalogChanged || currentRootAgentMap === null) {
            await fs.writeFile(rootAgentMapPath(repoRoot), compiled.agentMap, "utf-8");
        }
        await fs.rm(generatedAgentMapPath(repoRoot), { force: true });
    } else {
        warning = "Existing root AGENTS.md is not mygit-managed. Wrote .mygit/knowledge/AGENTS.generated.md instead.";
        agentMapPath = generatedAgentMapPath(repoRoot);
        await fs.writeFile(agentMapPath, compiled.agentMap, "utf-8");
    }

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

    return {
        shardCount: manifest.shards.length,
        manifestPath,
        agentsManaged,
        agentMapPath,
        warning,
        catalogChanged,
    };
}

export async function clearKnowledgeStore(repoRoot: string): Promise<void> {
    const rootAgentsPath = rootAgentMapPath(repoRoot);
    const currentRootAgentMap = await readUtf8(rootAgentsPath);
    const managed = currentRootAgentMap !== null && isManagedAgentMap(currentRootAgentMap);

    await fs.rm(knowledgeRootPath(repoRoot), { recursive: true, force: true });

    if (managed) {
        await fs.writeFile(rootAgentsPath, renderInitPlaceholder(), "utf-8");
    }
}

export async function ensureRepoLocalStateIgnored(repoRoot: string): Promise<void> {
    const excludePath = path.join(repoRoot, ".git", "info", "exclude");
    const current = await readUtf8(excludePath) ?? "";
    if (current.includes(".mygit/")) return;

    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    const prefix = current.trim().length > 0 ? "\n" : "";
    const block = `${prefix}# mygit repo-local state\n.mygit/\n`;
    await fs.appendFile(excludePath, block, "utf-8");
}

