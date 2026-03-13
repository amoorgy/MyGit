export const KNOWLEDGE_MANIFEST_VERSION = 1 as const;

export type KnowledgeShardPriority = "default" | "topic" | "optional";
export type KnowledgeCommandProfile =
    | "default"
    | "architecture"
    | "repo"
    | "workflow"
    | "product"
    | "integration";

export interface KnowledgeShard {
    id: string;
    path: string;
    title: string;
    summary: string;
    tags: string[];
    commandProfiles: KnowledgeCommandProfile[];
    sourcePaths: string[];
    fingerprint: string;
    priority: KnowledgeShardPriority;
}

export interface KnowledgeManifest {
    version: typeof KNOWLEDGE_MANIFEST_VERSION;
    generatedAt: string;
    agentsManaged: boolean;
    shards: KnowledgeShard[];
}

export interface CompiledKnowledgeShard {
    shard: KnowledgeShard;
    content: string;
}

export interface CompiledKnowledgeStore {
    manifest: KnowledgeManifest;
    shards: CompiledKnowledgeShard[];
    agentMap: string;
}

export interface KnowledgeStatus {
    present: boolean;
    generatedAt: string | null;
    shardCount: number;
    agentsManaged: boolean;
}

