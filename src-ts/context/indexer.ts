/**
 * Project Indexer — Walks repo files, chunks them, generates LLM summaries,
 * and populates the BM25 inverted index in SQLite.
 *
 * Supports incremental indexing via git hash change detection.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { execa } from "execa";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import type { MyGitDatabase } from "../storage/database.js";
import { termFrequencies, docLength, termsToKeywords } from "./tokenizer.js";
import {
    type IndexResult,
    type IndexStats,
    type IndexOptions,
    DEFAULT_SOURCE_EXTENSIONS,
    DEFAULT_SKIP_DIRS,
} from "./types.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Estimated chars per token for budget calculations */
const CHARS_PER_TOKEN = 4;

/** Max chars per chunk (~2000 tokens) */
const MAX_CHUNK_CHARS = 8000;

/** Max file size to index (500KB) */
const MAX_FILE_SIZE = 512_000;

const SUMMARY_SYSTEM_PROMPT = `You are a code summarizer. Given a source file or code section, produce a concise summary in 2-3 sentences.
Focus on: what it does, key exports/functions/classes, dependencies it imports, and patterns used.
Keep under 100 words. Output ONLY the summary text, no markdown formatting.`;

// ============================================================================
// GITIGNORE PARSING
// ============================================================================

interface GitignorePatterns {
    exact: Set<string>;
    wildcards: RegExp[];
}

/**
 * Parse a .gitignore file and extract directory-level skip patterns.
 * Handles exact names and simple `*` wildcards. Ignores negations and path anchors.
 */
function parseGitignore(content: string): GitignorePatterns {
    const exact = new Set<string>();
    const wildcards: RegExp[] = [];

    for (const raw of content.split("\n")) {
        const line = raw.trim();
        // skip comments, empty lines, negations, and path-anchored patterns
        if (!line || line.startsWith("#") || line.startsWith("!") || line.includes("/")) continue;

        const name = line.replace(/\/+$/, ""); // strip trailing slashes
        if (!name) continue;

        if (name.includes("*")) {
            // convert simple glob to regex: *.egg-info → /^.*\.egg-info$/
            const escaped = name.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
            wildcards.push(new RegExp(`^${escaped}$`));
        } else {
            exact.add(name);
        }
    }
    return { exact, wildcards };
}

// ============================================================================
// PROJECT INDEXER
// ============================================================================

export class ProjectIndexer {
    constructor(
        private db: MyGitDatabase,
        private model: BaseChatModel,
    ) {}

    /**
     * Index a project, generating summaries for all source files.
     * Only re-indexes files whose git hash has changed.
     */
    async index(
        repoRoot: string,
        options: IndexOptions = {},
        onProgress?: (result: IndexResult) => void,
    ): Promise<IndexResult[]> {
        const {
            batchSize = 100,
            extensions = DEFAULT_SOURCE_EXTENSIONS,
            skipDirs = DEFAULT_SKIP_DIRS,
            maxFileSize = MAX_FILE_SIZE,
            useGitignore = true,
        } = options;

        // Walk the file tree
        const files = await this.walkFiles(repoRoot, extensions, skipDirs, maxFileSize, useGitignore);
        const results: IndexResult[] = [];
        let indexed = 0;

        for (const filePath of files) {
            if (indexed >= batchSize) break;

            const relativePath = path.relative(repoRoot, filePath);
            const result = await this.indexFile(repoRoot, relativePath, filePath);
            results.push(result);
            onProgress?.(result);

            if (result.status === "indexed") indexed++;
        }

        // Update corpus stats after indexing
        this.updateCorpusStats();

        // Generate directory summaries
        await this.generateDirSummaries(repoRoot);

        return results;
    }

    /**
     * Refresh a targeted set of relative file paths without walking the full repo.
     * Used by session checkpoint auto-indexing to keep the index warm cheaply.
     */
    async refreshFiles(
        repoRoot: string,
        relativePaths: string[],
        options: IndexOptions = {},
        onProgress?: (result: IndexResult) => void,
    ): Promise<IndexResult[]> {
        const {
            extensions = DEFAULT_SOURCE_EXTENSIONS,
            maxFileSize = MAX_FILE_SIZE,
        } = options;

        const extSet = new Set(extensions.map((ext) => ext.toLowerCase()));
        const results: IndexResult[] = [];
        const seen = new Set<string>();

        for (const relativePath of relativePaths) {
            const normalized = relativePath.replace(/\\/g, "/");
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);

            const absolutePath = path.join(repoRoot, normalized);
            let result: IndexResult;

            try {
                const stat = await fs.stat(absolutePath);
                if (!stat.isFile()) {
                    result = { filePath: normalized, chunks: 0, status: "skipped" };
                } else if (!this.isIndexablePath(normalized, extSet)) {
                    this.db.deleteContextChunk(normalized);
                    result = { filePath: normalized, chunks: 0, status: "skipped" };
                } else if (stat.size > maxFileSize) {
                    result = { filePath: normalized, chunks: 0, status: "skipped" };
                } else {
                    result = await this.indexFile(repoRoot, normalized, absolutePath);
                }
            } catch {
                this.db.deleteContextChunk(normalized);
                result = { filePath: normalized, chunks: 0, status: "skipped" };
            }

            results.push(result);
            onProgress?.(result);
        }

        this.updateCorpusStats();
        await this.generateDirSummaries(repoRoot);
        return results;
    }

    /**
     * Index a single file. Skips if git hash hasn't changed.
     */
    private async indexFile(
        repoRoot: string,
        relativePath: string,
        absolutePath: string,
    ): Promise<IndexResult> {
        try {
            // Get current git hash
            const gitHash = await this.getGitHash(absolutePath, repoRoot);

            // Check if already indexed with same hash
            const existing = this.db.getContextChunk(relativePath);
            if (existing && existing.git_hash === gitHash) {
                return { filePath: relativePath, chunks: 0, status: "skipped" };
            }

            // Read file content
            const content = await fs.readFile(absolutePath, "utf-8");
            if (!content.trim()) {
                return { filePath: relativePath, chunks: 0, status: "skipped" };
            }

            // Chunk the file
            const chunks = this.chunkFile(content, relativePath);
            const language = this.detectLanguage(relativePath);

            // Generate summary and index each chunk
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const summary = await this.generateSummary(relativePath, chunk);
                const freqs = termFrequencies(summary + " " + relativePath);
                const keywords = termsToKeywords(freqs);
                const tokenCount = Math.ceil(chunk.length / CHARS_PER_TOKEN);

                // Upsert the chunk
                this.db.upsertContextChunk({
                    file_path: relativePath,
                    chunk_index: i,
                    language,
                    summary,
                    keywords,
                    token_count: tokenCount,
                    git_hash: gitHash,
                });

                // Get the chunk ID for term indexing
                const stored = this.db.getContextChunk(relativePath, i);
                if (stored?.id) {
                    this.db.upsertTerms(stored.id, freqs);
                }
            }

            return { filePath: relativePath, chunks: chunks.length, status: "indexed" };
        } catch (err: any) {
            return { filePath: relativePath, chunks: 0, status: "error", error: err.message };
        }
    }

    /**
     * Generate an LLM summary for a code chunk.
     */
    private async generateSummary(filePath: string, content: string): Promise<string> {
        try {
            const userPrompt = `File: ${filePath}\n\n${content.substring(0, MAX_CHUNK_CHARS)}`;
            const response = await this.model.invoke([
                new SystemMessage(SUMMARY_SYSTEM_PROMPT),
                new HumanMessage(userPrompt),
            ]);

            const text = typeof response.content === "string"
                ? response.content
                : JSON.stringify(response.content);

            return text.trim().substring(0, 500);
        } catch {
            // Fallback: extract first comment block or first few lines
            return this.heuristicSummary(filePath, content);
        }
    }

    /**
     * Fallback summary when LLM is unavailable.
     */
    private heuristicSummary(filePath: string, content: string): string {
        const lines = content.split("\n").slice(0, 20);
        const parts: string[] = [`File: ${path.basename(filePath)}.`];

        // Extract imports
        const imports = lines.filter(l =>
            l.match(/^(import |from |require\(|use |#include)/)
        );
        if (imports.length > 0) {
            parts.push(`Imports: ${imports.length} dependencies.`);
        }

        // Extract exports/functions
        const exports = content.match(/export\s+(function|class|const|interface|type)\s+(\w+)/g);
        if (exports && exports.length > 0) {
            const names = exports.slice(0, 5).map(e => {
                const match = e.match(/\s+(\w+)$/);
                return match?.[1] ?? "";
            }).filter(Boolean);
            parts.push(`Exports: ${names.join(", ")}.`);
        }

        // First doc comment
        const docMatch = content.match(/\/\*\*[\s\S]*?\*\//);
        if (docMatch) {
            const cleaned = docMatch[0]
                .replace(/\/\*\*|\*\/|\n\s*\*/g, " ")
                .trim()
                .substring(0, 150);
            parts.push(cleaned);
        }

        return parts.join(" ").substring(0, 500);
    }

    /**
     * Split a file into chunks. Files under MAX_CHUNK_CHARS are a single chunk.
     * Larger files are split at top-level function/class boundaries.
     */
    private chunkFile(content: string, filePath: string): string[] {
        if (content.length <= MAX_CHUNK_CHARS) {
            return [content];
        }

        // Split at top-level declarations
        const boundaries = this.findChunkBoundaries(content);
        if (boundaries.length <= 1) {
            // No good boundaries found — split by line count
            return this.splitByLines(content, MAX_CHUNK_CHARS);
        }

        const chunks: string[] = [];
        for (let i = 0; i < boundaries.length; i++) {
            const start = boundaries[i];
            const end = i + 1 < boundaries.length ? boundaries[i + 1] : content.length;
            const chunk = content.substring(start, end);
            if (chunk.trim()) chunks.push(chunk);
        }

        return chunks;
    }

    /**
     * Find byte offsets of top-level declarations for chunking.
     */
    private findChunkBoundaries(content: string): number[] {
        const boundaries: number[] = [0];
        const patterns = [
            /^(?:export\s+)?(?:async\s+)?function\s+/m,
            /^(?:export\s+)?class\s+/m,
            /^(?:export\s+)?(?:const|let)\s+\w+\s*=/m,
            /^(?:export\s+)?interface\s+/m,
            /^(?:export\s+)?type\s+\w+\s*=/m,
            /^def\s+/m,              // Python
            /^class\s+/m,            // Python
            /^(?:pub\s+)?fn\s+/m,    // Rust
            /^(?:pub\s+)?struct\s+/m, // Rust/Go
            /^func\s+/m,             // Go
        ];

        const lines = content.split("\n");
        let offset = 0;
        for (const line of lines) {
            if (offset > 0 && patterns.some(p => p.test(line))) {
                // Only add if at least MAX_CHUNK_CHARS/2 from last boundary
                const lastBoundary = boundaries[boundaries.length - 1];
                if (offset - lastBoundary >= MAX_CHUNK_CHARS / 2) {
                    boundaries.push(offset);
                }
            }
            offset += line.length + 1; // +1 for newline
        }

        return boundaries;
    }

    /**
     * Split content by approximate character count per chunk.
     */
    private splitByLines(content: string, maxChars: number): string[] {
        const lines = content.split("\n");
        const chunks: string[] = [];
        let current: string[] = [];
        let currentLen = 0;

        for (const line of lines) {
            if (currentLen + line.length > maxChars && current.length > 0) {
                chunks.push(current.join("\n"));
                current = [];
                currentLen = 0;
            }
            current.push(line);
            currentLen += line.length + 1;
        }

        if (current.length > 0) {
            chunks.push(current.join("\n"));
        }

        return chunks;
    }

    /**
     * Detect language from file extension.
     */
    private detectLanguage(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const langMap: Record<string, string> = {
            ".ts": "typescript", ".tsx": "typescript",
            ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
            ".py": "python", ".rs": "rust", ".go": "go",
            ".java": "java", ".kt": "kotlin",
            ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
            ".rb": "ruby", ".php": "php", ".swift": "swift", ".cs": "csharp",
            ".vue": "vue", ".svelte": "svelte",
            ".json": "json", ".toml": "toml", ".yaml": "yaml", ".yml": "yaml",
            ".md": "markdown", ".sql": "sql", ".graphql": "graphql",
            ".sh": "shell", ".bash": "shell", ".zsh": "shell",
            ".css": "css", ".scss": "scss", ".html": "html",
        };
        return langMap[ext] ?? "unknown";
    }

    private isIndexablePath(filePath: string, extensions: Set<string>): boolean {
        if (filePath === "AGENTS.md") return false;
        if (filePath === ".mygit/MYGIT.md") return false;
        if (filePath === ".mygit/FOCUS.md") return false;
        if (filePath.startsWith(".mygit/knowledge/")) return false;
        const parts = filePath.split(/[\\/]+/);
        if (parts.some((part) => DEFAULT_SKIP_DIRS.includes(part))) return false;
        return extensions.has(path.extname(filePath).toLowerCase());
    }

    /**
     * Get git hash of a file for change detection.
     */
    private async getGitHash(filePath: string, cwd: string): Promise<string> {
        try {
            const result = await execa("git", ["hash-object", filePath], { cwd, reject: false });
            return result.stdout?.trim() ?? "";
        } catch {
            return "";
        }
    }

    /**
     * Walk the file tree and collect indexable files.
     */
    private async walkFiles(
        root: string,
        extensions: string[],
        skipDirs: string[],
        maxFileSize: number,
        useGitignore: boolean,
    ): Promise<string[]> {
        const files: string[] = [];
        const extSet = new Set(extensions);
        const skipSet = new Set(skipDirs);

        let gitignore: GitignorePatterns = { exact: new Set(), wildcards: [] };
        if (useGitignore) {
            try {
                const raw = await fs.readFile(path.join(root, ".gitignore"), "utf-8");
                gitignore = parseGitignore(raw);
            } catch {
                // no .gitignore — proceed with defaults
            }
        }

        await this.collectFiles(root, root, files, extSet, skipSet, gitignore, maxFileSize, 0, 5);
        return files;
    }

    private async collectFiles(
        root: string,
        dir: string,
        files: string[],
        extensions: Set<string>,
        skipDirs: Set<string>,
        gitignore: GitignorePatterns,
        maxFileSize: number,
        depth: number,
        maxDepth: number,
    ): Promise<void> {
        if (depth >= maxDepth) return;

        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const skip =
                entry.name.startsWith(".") ||
                skipDirs.has(entry.name) ||
                gitignore.exact.has(entry.name) ||
                gitignore.wildcards.some(r => r.test(entry.name));
            if (skip) continue;

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                await this.collectFiles(root, fullPath, files, extensions, skipDirs, gitignore, maxFileSize, depth + 1, maxDepth);
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (!extensions.has(ext)) continue;

                const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
                if (!this.isIndexablePath(relativePath, extensions)) continue;

                try {
                    const stat = await fs.stat(fullPath);
                    if (stat.size > maxFileSize) continue;
                } catch {
                    continue;
                }

                files.push(fullPath);
            }
        }
    }

    /**
     * Update BM25 corpus statistics after indexing.
     */
    private updateCorpusStats() {
        const stats = this.db.getContextIndexStats();
        if (stats.totalChunks === 0) return;

        // Calculate average document length from all chunks
        const allChunks = this.db.getAllContextChunks();
        let totalTerms = 0;
        for (const chunk of allChunks) {
            const freqs = termFrequencies(chunk.summary + " " + chunk.file_path);
            totalTerms += docLength(freqs);
        }

        const avgDocLength = totalTerms / allChunks.length;
        this.db.updateCorpusStats(allChunks.length, avgDocLength);
    }

    /**
     * Generate directory summaries by aggregating child file summaries.
     */
    private async generateDirSummaries(repoRoot: string) {
        const allChunks = this.db.getAllContextChunks();
        this.db.clearDirSummaries();

        // Group by directory
        const dirFiles = new Map<string, string[]>();
        for (const chunk of allChunks) {
            const dir = path.dirname(chunk.file_path);
            if (!dirFiles.has(dir)) dirFiles.set(dir, []);
            dirFiles.get(dir)!.push(chunk.summary);
        }

        // Create summary for each directory
        for (const [dir, summaries] of dirFiles) {
            const combined = summaries.slice(0, 10).join(" ");
            const dirSummary = combined.length > 300
                ? combined.substring(0, 297) + "..."
                : combined;
            this.db.upsertDirSummary(dir, dirSummary, summaries.length);
        }
    }

    /**
     * Get index statistics.
     */
    getStats(): IndexStats {
        const raw = this.db.getContextIndexStats();
        return {
            totalFiles: raw.totalFiles,
            indexedFiles: raw.totalFiles,
            staleFiles: 0, // TODO: compute stale count
            totalChunks: raw.totalChunks,
            lastIndexed: raw.lastIndexed ? new Date(raw.lastIndexed).getTime() : null,
        };
    }

    /**
     * Find files whose git hash has changed since last index.
     */
    async findStaleFiles(repoRoot: string): Promise<string[]> {
        const allChunks = this.db.getAllContextChunks();
        const stale: string[] = [];

        // Deduplicate by file path
        const seen = new Set<string>();
        for (const chunk of allChunks) {
            if (seen.has(chunk.file_path)) continue;
            seen.add(chunk.file_path);

            const absPath = path.join(repoRoot, chunk.file_path);
            const currentHash = await this.getGitHash(absPath, repoRoot);
            if (currentHash && currentHash !== chunk.git_hash) {
                stale.push(chunk.file_path);
            }
        }

        return stale;
    }
}
