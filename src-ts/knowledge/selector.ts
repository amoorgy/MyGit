import type {
    KnowledgeCommandProfile,
    KnowledgeManifest,
    KnowledgeShard,
} from "./types.js";

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9_./-]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2);
}

function inferProfiles(request: string): KnowledgeCommandProfile[] {
    const lower = request.toLowerCase();
    const profiles = new Set<KnowledgeCommandProfile>();

    if (/\b(architecture|runtime|graph|agent|prompt|context|rag|index|memory|database|sqlite)\b/.test(lower)) {
        profiles.add("architecture");
    }
    if (/\b(path|file|folder|directory|where|layout|tree|module)\b/.test(lower)) {
        profiles.add("repo");
    }
    if (/\b(command|script|workflow|build|test|run|dev|setup|install|deploy|release|init)\b/.test(lower)) {
        profiles.add("workflow");
    }
    if (/\b(product|feature|behavior|experience|screen|ux|ui|user|onboarding)\b/.test(lower)) {
        profiles.add("product");
    }
    if (/\b(api|integration|provider|github|auth|webhook|openai|anthropic|gemini|ollama|database)\b/.test(lower)) {
        profiles.add("integration");
    }

    return Array.from(profiles);
}

function keywordScore(request: string, shard: KnowledgeShard): number {
    const requestTerms = new Set(tokenize(request));
    if (requestTerms.size === 0) return 0;

    const shardTerms = new Set(tokenize([
        shard.id,
        shard.title,
        shard.summary,
        shard.path,
        ...shard.tags,
        ...shard.sourcePaths,
    ].join(" ")));

    let score = 0;
    for (const term of requestTerms) {
        if (shardTerms.has(term)) score += 8;
    }
    return score;
}

function profileScore(shard: KnowledgeShard, requestProfiles: KnowledgeCommandProfile[]): number {
    let score = 0;
    for (const profile of requestProfiles) {
        if (shard.commandProfiles.includes(profile)) score += 100;
    }
    return score;
}

function priorityScore(shard: KnowledgeShard): number {
    switch (shard.priority) {
        case "default":
            return 20;
        case "topic":
            return 10;
        case "optional":
            return 0;
    }
}

export interface ShardContextHints {
    changedPaths?: string[];
}

function contextPathScore(shard: KnowledgeShard, hints?: ShardContextHints): number {
    if (!hints?.changedPaths?.length) return 0;
    const changedSet = new Set(hints.changedPaths.map((p) => p.toLowerCase()));
    let score = 0;
    for (const sourcePath of shard.sourcePaths) {
        const lower = sourcePath.toLowerCase();
        for (const changed of changedSet) {
            if (changed.startsWith(lower) || lower.startsWith(changed)) {
                score += 50;
                break;
            }
        }
    }
    return score;
}

function fallbackShardIds(mode: "direct_qa" | "execution"): string[] {
    return mode === "direct_qa"
        ? ["project-overview"]
        : ["project-overview", "repo-map"];
}

export function selectKnowledgeShards(
    manifest: KnowledgeManifest,
    request: string,
    mode: "direct_qa" | "execution",
    limit = mode === "direct_qa" ? 1 : 2,
    hints?: ShardContextHints,
): KnowledgeShard[] {
    const requestProfiles = inferProfiles(request);

    const ranked = manifest.shards
        .map((shard) => ({
            shard,
            score: profileScore(shard, requestProfiles)
                + keywordScore(request, shard)
                + priorityScore(shard)
                + contextPathScore(shard, hints),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.shard.path.localeCompare(b.shard.path);
        })
        .map((entry) => entry.shard);

    const selected = ranked.slice(0, limit);
    if (selected.length > 0) return selected;

    const fallbackIds = fallbackShardIds(mode);
    const fallback = fallbackIds
        .map((id) => manifest.shards.find((shard) => shard.id === id))
        .filter((shard): shard is KnowledgeShard => Boolean(shard))
        .slice(0, limit);
    if (fallback.length > 0) return fallback;

    return manifest.shards.slice(0, limit);
}
