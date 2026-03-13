import * as fs from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";
import type { MyGitDatabase, StoredContextChunk } from "../storage/database.js";
import {
    KNOWLEDGE_MANIFEST_VERSION,
    type CompiledKnowledgeShard,
    type CompiledKnowledgeStore,
    type KnowledgeCommandProfile,
    type KnowledgeManifest,
    type KnowledgeShard,
    type KnowledgeShardPriority,
} from "./types.js";
import { MANAGED_AGENT_MARKER } from "./store.js";

const SHARD_CHAR_LIMIT = 1500;
const AGENT_MAP_CHAR_LIMIT = 2000;
const ROOT_DOC_PATTERNS = [
    /^readme/i,
    /^architecture/i,
    /^design/i,
    /^project_summary/i,
];
const MANIFEST_FILES = [
    "package.json",
    "bunfig.toml",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "Makefile",
    "justfile",
];

interface SourceDocument {
    path: string;
    content: string;
}

interface TopLevelGroup {
    path: string;
    chunkCount: number;
    sampleFiles: string[];
    summary: string;
}

interface BuildShardInput {
    id: string;
    path: string;
    title: string;
    summary: string;
    tags: string[];
    commandProfiles: KnowledgeCommandProfile[];
    priority: KnowledgeShardPriority;
    why: string[];
    facts: string[];
    keyPaths: string[];
    sourceInputs: string[];
}

function clampLine(text: string, maxChars = 180): string {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    return cleaned.length > maxChars
        ? cleaned.slice(0, maxChars - 3).trimEnd() + "..."
        : cleaned;
}

function uniqueLines(lines: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const line of lines.map((line) => clampLine(line)).filter(Boolean)) {
        if (seen.has(line)) continue;
        seen.add(line);
        result.push(line);
    }
    return result;
}

function firstParagraph(content: string): string {
    const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, " ");
    const paragraphs = withoutCodeBlocks
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.replace(/^#+\s+/gm, "").trim())
        .filter(Boolean);
    return clampLine(paragraphs.find((paragraph) => paragraph.length >= 40) ?? "", 220);
}

function fileExists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true).catch(() => false);
}

async function collectRootDocs(repoRoot: string): Promise<SourceDocument[]> {
    const entries = await fs.readdir(repoRoot, { withFileTypes: true });
    const docs = entries
        .filter((entry) => entry.isFile())
        .filter((entry) => ROOT_DOC_PATTERNS.some((pattern) => pattern.test(entry.name)))
        .map((entry) => entry.name)
        .sort();

    const result: SourceDocument[] = [];
    for (const relativePath of docs) {
        try {
            const content = await fs.readFile(path.join(repoRoot, relativePath), "utf-8");
            result.push({ path: relativePath, content });
        } catch {
            // Ignore unreadable files.
        }
    }
    return result;
}

async function collectDocsTree(repoRoot: string): Promise<SourceDocument[]> {
    const docsRoot = path.join(repoRoot, "docs");
    if (!await fileExists(docsRoot)) return [];

    const result: SourceDocument[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
        if (depth > 3) return;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath, depth + 1);
                continue;
            }
            if (!entry.name.toLowerCase().endsWith(".md")) continue;

            try {
                const content = await fs.readFile(fullPath, "utf-8");
                result.push({
                    path: path.relative(repoRoot, fullPath).replace(/\\/g, "/"),
                    content,
                });
            } catch {
                // Ignore unreadable files.
            }
        }
    }

    await walk(docsRoot, 0);
    return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectManifestSources(repoRoot: string): Promise<SourceDocument[]> {
    const sources: SourceDocument[] = [];
    for (const fileName of MANIFEST_FILES) {
        const fullPath = path.join(repoRoot, fileName);
        if (!await fileExists(fullPath)) continue;
        try {
            sources.push({
                path: fileName,
                content: await fs.readFile(fullPath, "utf-8"),
            });
        } catch {
            // Ignore unreadable files.
        }
    }
    return sources;
}

async function collectTopLevelEntries(repoRoot: string): Promise<string[]> {
    const entries = await fs.readdir(repoRoot, { withFileTypes: true });
    return entries
        .filter((entry) => !entry.name.startsWith("."))
        .filter((entry) => entry.name !== "node_modules")
        .map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name)
        .sort();
}

function hashText(parts: string[]): string {
    const hash = createHash("sha1");
    for (const part of parts) {
        hash.update(part);
        hash.update("\n");
    }
    return hash.digest("hex");
}

function summarizeTopLevel(indexedChunks: StoredContextChunk[]): TopLevelGroup[] {
    const grouped = new Map<string, StoredContextChunk[]>();
    for (const chunk of indexedChunks) {
        const topLevel = chunk.file_path.split("/")[0] ?? chunk.file_path;
        if (!grouped.has(topLevel)) grouped.set(topLevel, []);
        grouped.get(topLevel)!.push(chunk);
    }

    return Array.from(grouped.entries())
        .map(([groupPath, chunks]) => ({
            path: groupPath,
            chunkCount: chunks.length,
            sampleFiles: Array.from(new Set(chunks.map((chunk) => chunk.file_path))).slice(0, 3),
            summary: clampLine(chunks.map((chunk) => chunk.summary).filter(Boolean).slice(0, 3).join(" "), 220),
        }))
        .sort((a, b) => b.chunkCount - a.chunkCount || a.path.localeCompare(b.path));
}

function deriveStackFacts(
    topLevelEntries: string[],
    manifests: SourceDocument[],
    indexedChunks: StoredContextChunk[],
): string[] {
    const facts: string[] = [];
    const manifestNames = new Set(manifests.map((manifest) => manifest.path));
    const allPaths = indexedChunks.map((chunk) => chunk.file_path).join(" ");

    if (manifestNames.has("package.json")) facts.push("Node.js project metadata is present via package.json.");
    if (manifestNames.has("bunfig.toml") || topLevelEntries.includes("bun.lock")) facts.push("Bun is part of the runtime or tooling stack.");
    if (manifestNames.has("Cargo.toml")) facts.push("Rust code or tooling is present.");
    if (manifestNames.has("pyproject.toml")) facts.push("Python tooling or application code is present.");
    if (manifestNames.has("go.mod")) facts.push("Go modules are configured.");
    if (/\.(ts|tsx)\b/.test(allPaths)) facts.push("TypeScript is a primary implementation language.");
    if (/\.(rs)\b/.test(allPaths)) facts.push("Rust sources are present in the repository.");
    if (/\.(py)\b/.test(allPaths)) facts.push("Python sources are present in the repository.");

    return uniqueLines(facts).slice(0, 4);
}

function parsePackageManifest(manifests: SourceDocument[]): {
    scripts: string[];
    dependencies: string[];
} {
    const pkg = manifests.find((manifest) => manifest.path === "package.json");
    if (!pkg) {
        return { scripts: [], dependencies: [] };
    }

    try {
        const parsed = JSON.parse(pkg.content) as {
            scripts?: Record<string, string>;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };

        const scripts = Object.entries(parsed.scripts ?? {})
            .map(([name, command]) => `${name}: ${command}`)
            .slice(0, 6);
        const dependencies = [
            ...Object.keys(parsed.dependencies ?? {}),
            ...Object.keys(parsed.devDependencies ?? {}),
        ];
        return {
            scripts,
            dependencies: Array.from(new Set(dependencies)).sort(),
        };
    } catch {
        return { scripts: [], dependencies: [] };
    }
}

function deriveIntegrations(dependencies: string[], topLevelEntries: string[]): string[] {
    const joined = dependencies.join(" ").toLowerCase();
    const facts: string[] = [];

    if (joined.includes("@langchain/")) facts.push("LangChain or LangGraph packages handle model orchestration.");
    if (joined.includes("openai")) facts.push("OpenAI-compatible providers are wired into the project.");
    if (joined.includes("google")) facts.push("Google Gemini integration is available.");
    if (joined.includes("anthropic")) facts.push("Anthropic model support is available.");
    if (topLevelEntries.includes("src-ts/") || topLevelEntries.includes("src/")) facts.push("Primary code lives in source directories rather than generated output.");
    if (topLevelEntries.includes("docs/")) facts.push("The repository maintains a dedicated docs directory.");

    return uniqueLines(facts).slice(0, 5);
}

function deriveWorkflowFacts(
    scripts: string[],
    docs: SourceDocument[],
    manifests: SourceDocument[],
): string[] {
    const facts = [...scripts];

    const commandMentions = docs
        .flatMap((doc) => doc.content.match(/`[^`]+`/g) ?? [])
        .map((match) => match.replace(/`/g, "").trim())
        .filter((command) => /\b(test|build|run|dev|mygit|bun|npm|pnpm|cargo|python)\b/.test(command))
        .slice(0, 6);
    facts.push(...commandMentions);

    if (manifests.some((manifest) => manifest.path === "Makefile")) {
        facts.push("Makefile targets are available for common workflows.");
    }
    if (manifests.some((manifest) => manifest.path === "justfile")) {
        facts.push("justfile commands are available for common workflows.");
    }

    return uniqueLines(facts).slice(0, 6);
}

function buildShard(input: BuildShardInput): CompiledKnowledgeShard {
    const sections = [
        `# ${input.title}`,
        "",
        "## Why This Exists",
        ...uniqueLines(input.why).slice(0, 3).map((line) => `- ${line}`),
        "",
        "## Key Facts",
        ...uniqueLines(input.facts).slice(0, 6).map((line) => `- ${line}`),
        "",
        "## Key Paths",
        ...uniqueLines(input.keyPaths).slice(0, 6).map((line) => `- ${line}`),
        "",
        "## Source Inputs",
        ...uniqueLines(input.sourceInputs).slice(0, 6).map((line) => `- ${line}`),
        "",
    ].join("\n");

    const content = sections.length > SHARD_CHAR_LIMIT
        ? sections.slice(0, SHARD_CHAR_LIMIT - 3).trimEnd() + "..."
        : sections;

    const sourcePaths = uniqueLines(input.sourceInputs);
    const shard: KnowledgeShard = {
        id: input.id,
        path: input.path,
        title: input.title,
        summary: clampLine(input.summary, 140),
        tags: uniqueLines(input.tags).map((tag) => tag.toLowerCase()).slice(0, 10),
        commandProfiles: input.commandProfiles,
        sourcePaths,
        fingerprint: hashText([input.id, content, ...sourcePaths]),
        priority: input.priority,
    };

    return { shard, content };
}

function renderAgentMap(manifest: KnowledgeManifest): string {
    const lines = [
        "# AGENTS.md",
        MANAGED_AGENT_MARKER,
        "Managed by mygit. Use this as the repo map, not the encyclopedia.",
        "",
        "## Read Order",
        "1. .mygit/FOCUS.md",
        "2. .mygit/MYGIT.md",
        "3. One or two shard docs below from .mygit/knowledge/",
        "4. Code or repo files only if still blocked",
        "",
        "## Knowledge Map",
    ];

    for (const shard of manifest.shards) {
        lines.push(`- .mygit/knowledge/${shard.path} — ${clampLine(shard.summary, 110)}`);
    }

    const content = lines.join("\n") + "\n";
    return content.length > AGENT_MAP_CHAR_LIMIT
        ? content.slice(0, AGENT_MAP_CHAR_LIMIT - 3).trimEnd() + "..."
        : content;
}

export async function compileKnowledgeStore(args: {
    repoRoot: string;
    db: Pick<MyGitDatabase, "getAllContextChunks" | "getAllDirSummaries">;
    now?: string;
}): Promise<CompiledKnowledgeStore> {
    const [rootDocs, docsTree, manifests, topLevelEntries] = await Promise.all([
        collectRootDocs(args.repoRoot),
        collectDocsTree(args.repoRoot),
        collectManifestSources(args.repoRoot),
        collectTopLevelEntries(args.repoRoot),
    ]);

    const docs = [...rootDocs, ...docsTree];
    const indexedChunks = args.db.getAllContextChunks();
    const topLevelGroups = summarizeTopLevel(indexedChunks);
    const dirSummaries = args.db.getAllDirSummaries();
    const packageInfo = parsePackageManifest(manifests);
    const stackFacts = deriveStackFacts(topLevelEntries, manifests, indexedChunks);
    const workflowFacts = deriveWorkflowFacts(packageInfo.scripts, docs, manifests);
    const integrations = deriveIntegrations(packageInfo.dependencies, topLevelEntries);

    const readmeLead = firstParagraph(rootDocs.find((doc) => /^readme/i.test(path.basename(doc.path)))?.content ?? "");
    const summaryLead = firstParagraph(rootDocs.find((doc) => /^project_summary/i.test(path.basename(doc.path)))?.content ?? "");
    const overviewLead = readmeLead || summaryLead || `This repository is ${path.basename(args.repoRoot)} with generated mygit project context.`;

    const topPathLines = topLevelGroups
        .slice(0, 4)
        .map((group) => `${group.path} — ${group.summary || `${group.chunkCount} indexed chunks`}`);
    const topDirInputs = topLevelGroups.slice(0, 4).map((group) => group.path);
    const architectureDocs = docs.filter((doc) => /architecture|design|agent-loop/i.test(doc.path));
    const workflowDocs = docs.filter((doc) => /readme|development|configuration/i.test(doc.path));

    const shards: CompiledKnowledgeShard[] = [];

    shards.push(buildShard({
        id: "project-overview",
        path: "project-overview.md",
        title: "Project Overview",
        summary: "Start here for repo purpose, stack, and top-level organization.",
        tags: ["overview", "purpose", "stack", "repository"],
        commandProfiles: ["default"],
        priority: "default",
        why: [overviewLead],
        facts: [
            ...stackFacts,
            `Top-level entries include: ${topLevelEntries.slice(0, 6).join(", ") || "(none detected)"}.`,
            dirSummaries.length > 0
                ? `Indexed directory summaries are available for ${dirSummaries.length} directories.`
                : "Directory summaries are not available yet; run `mygit init` after indexing code.",
        ],
        keyPaths: topPathLines.length > 0 ? topPathLines : topLevelEntries.slice(0, 6),
        sourceInputs: [
            ...rootDocs.map((doc) => doc.path),
            ...manifests.map((manifest) => manifest.path),
            ...topDirInputs,
        ],
    }));

    shards.push(buildShard({
        id: "architecture-map",
        path: "architecture-map.md",
        title: "Architecture Map",
        summary: "Read for runtime boundaries, major subsystems, and data flow hotspots.",
        tags: ["architecture", "runtime", "subsystems", "data-flow", "agent"],
        commandProfiles: ["architecture"],
        priority: "topic",
        why: [
            firstParagraph(architectureDocs[0]?.content ?? "") || "Use this shard to orient around the major implementation boundaries before deeper inspection.",
        ],
        facts: [
            ...topLevelGroups.slice(0, 4).map((group) => `${group.path} owns ${group.chunkCount} indexed chunks.`),
            ...dirSummaries.slice(0, 4).map((summary) => `${summary.dir_path}/ — ${clampLine(summary.summary, 140)}`),
        ],
        keyPaths: topLevelGroups.slice(0, 4).flatMap((group) => group.sampleFiles.slice(0, 2)),
        sourceInputs: [
            ...architectureDocs.map((doc) => doc.path),
            ...topLevelGroups.slice(0, 4).map((group) => group.path),
            ...topLevelGroups.slice(0, 4).flatMap((group) => group.sampleFiles.slice(0, 2)),
        ],
    }));

    shards.push(buildShard({
        id: "repo-map",
        path: "repo-map.md",
        title: "Repo Map",
        summary: "Use for key directories, hotspots, and where to inspect next.",
        tags: ["repo", "paths", "directories", "hotspots", "files"],
        commandProfiles: ["repo"],
        priority: "default",
        why: [
            "Use this shard when the task depends on finding the right directory or file quickly.",
        ],
        facts: topLevelGroups.slice(0, 6).map((group) =>
            `${group.path}: ${group.chunkCount} indexed chunks${group.summary ? ` — ${group.summary}` : ""}`,
        ),
        keyPaths: topLevelGroups.slice(0, 6).flatMap((group) => group.sampleFiles.slice(0, 2)),
        sourceInputs: [
            ...topLevelGroups.slice(0, 6).map((group) => group.path),
            ...topLevelGroups.slice(0, 6).flatMap((group) => group.sampleFiles.slice(0, 2)),
        ],
    }));

    shards.push(buildShard({
        id: "workflow-map",
        path: "workflow-map.md",
        title: "Workflow Map",
        summary: "Read for build, test, run, init, and developer workflow entrypoints.",
        tags: ["workflow", "commands", "build", "test", "run", "setup"],
        commandProfiles: ["workflow"],
        priority: "topic",
        why: [
            "Use this shard for command-oriented requests before inspecting scripts or CI files.",
        ],
        facts: workflowFacts.length > 0
            ? workflowFacts
            : ["No common workflow commands were detected from manifests or docs."],
        keyPaths: workflowDocs.slice(0, 4).map((doc) => doc.path),
        sourceInputs: [
            ...workflowDocs.slice(0, 4).map((doc) => doc.path),
            ...manifests.map((manifest) => manifest.path),
        ],
    }));

    if (docs.length > 0) {
        shards.push(buildShard({
            id: "product-context",
            path: "product-context.md",
            title: "Product Context",
            summary: "Read for user-facing goals, features, and behavior described in docs.",
            tags: ["product", "features", "behavior", "users", "docs"],
            commandProfiles: ["product"],
            priority: "optional",
            why: [
                summaryLead || readmeLead || "Use this shard when the request is about user-facing behavior or intended outcomes.",
            ],
            facts: docs.slice(0, 5).map((doc) => `${doc.path}: ${firstParagraph(doc.content) || "Documentation source."}`),
            keyPaths: docs.slice(0, 5).map((doc) => doc.path),
            sourceInputs: docs.slice(0, 5).map((doc) => doc.path),
        }));
    }

    if (integrations.length > 0 || packageInfo.dependencies.length > 0) {
        shards.push(buildShard({
            id: "integrations",
            path: "integrations.md",
            title: "Integrations",
            summary: "Read for external services, provider hooks, and integration surfaces.",
            tags: ["integration", "providers", "api", "services", "external"],
            commandProfiles: ["integration"],
            priority: "optional",
            why: [
                "Use this shard when the request touches third-party providers, APIs, auth, or external contracts.",
            ],
            facts: integrations.length > 0
                ? integrations
                : packageInfo.dependencies.slice(0, 6).map((dep) => `Dependency detected: ${dep}`),
            keyPaths: topLevelGroups
                .filter((group) => /github|llm|api|auth|storage/i.test(group.path))
                .flatMap((group) => group.sampleFiles.slice(0, 2))
                .slice(0, 6),
            sourceInputs: [
                ...manifests.map((manifest) => manifest.path),
                ...topLevelGroups
                    .filter((group) => /github|llm|api|auth|storage/i.test(group.path))
                    .map((group) => group.path),
            ],
        }));
    }

    const manifest: KnowledgeManifest = {
        version: KNOWLEDGE_MANIFEST_VERSION,
        generatedAt: args.now ?? new Date().toISOString(),
        agentsManaged: false,
        shards: shards.map((doc) => doc.shard),
    };

    return {
        manifest,
        shards,
        agentMap: renderAgentMap(manifest),
    };
}
