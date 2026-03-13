/**
 * Context Retriever — BM25-based search over indexed project summaries.
 *
 * Uses an inverted index stored in SQLite to rank file summaries
 * by relevance to a query. No embeddings or external services needed.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { MyGitDatabase } from "../storage/database.js";
import { tokenize } from "./tokenizer.js";
import type { ContextResult } from "./types.js";

// ============================================================================
// BM25 PARAMETERS
// ============================================================================

/** Term frequency saturation parameter */
const K1 = 1.2;

/** Document length normalization parameter */
const B = 0.75;

// ============================================================================
// CONTEXT RETRIEVER
// ============================================================================

export class ContextRetriever {
    constructor(private db: MyGitDatabase) {}

    /**
     * Search indexed project files using BM25 ranking.
     * Returns top-K results sorted by relevance score.
     */
    search(query: string, topK = 5): ContextResult[] {
        const queryTerms = tokenize(query);
        if (queryTerms.length === 0) return [];

        const { totalDocs, avgDocLength } = this.db.getCorpusStats();
        if (totalDocs === 0 || avgDocLength === 0) return [];

        // Accumulate BM25 scores per document
        const scores = new Map<number, number>();

        for (const term of queryTerms) {
            const docs = this.db.getTermDocs(term);
            if (docs.length === 0) continue;

            // IDF: log((N - n + 0.5) / (n + 0.5) + 1)
            const n = docs.length;
            const idf = Math.log((totalDocs - n + 0.5) / (n + 0.5) + 1);

            for (const { doc_id, term_freq } of docs) {
                // Get document length (approximate from stored term count)
                const chunk = this.db.getContextChunkById(doc_id);
                if (!chunk) continue;

                // Estimate doc length from keywords field
                const dl = chunk.keywords.split(" ").length;

                // BM25 score for this term-document pair
                const tf = term_freq;
                const numerator = tf * (K1 + 1);
                const denominator = tf + K1 * (1 - B + B * (dl / avgDocLength));
                const termScore = idf * (numerator / denominator);

                scores.set(doc_id, (scores.get(doc_id) ?? 0) + termScore);
            }
        }

        // Sort by score, take top-K
        const ranked = Array.from(scores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, topK);

        // Build results
        const results: ContextResult[] = [];
        for (const [docId, score] of ranked) {
            const chunk = this.db.getContextChunkById(docId);
            if (!chunk) continue;

            results.push({
                filePath: chunk.file_path,
                summary: chunk.summary,
                score,
                chunkIndex: chunk.chunk_index,
                language: chunk.language,
            });
        }

        return results;
    }

    /**
     * Search with query enhancement: enriches the query with
     * additional terms from git status, branch name, etc.
     */
    searchEnhanced(
        query: string,
        enhancementTerms: string[],
        topK = 5,
    ): ContextResult[] {
        const enhancedQuery = [query, ...enhancementTerms].join(" ");
        return this.search(enhancedQuery, topK);
    }

    /**
     * Get the directory summary for a given path.
     */
    getDirectorySummary(dirPath: string): string | null {
        const dir = this.db.getDirSummary(dirPath);
        return dir?.summary ?? null;
    }

    /**
     * Get all directory summaries (for top-level overview).
     */
    getAllDirectorySummaries(): Array<{ dirPath: string; summary: string; childCount: number }> {
        return this.db.getAllDirSummaries().map(d => ({
            dirPath: d.dir_path,
            summary: d.summary,
            childCount: d.child_count,
        }));
    }

    /**
     * Get the summary for a specific file.
     */
    getFileSummary(filePath: string): string | null {
        const chunks = this.db.getContextChunksForFile(filePath, 3);
        if (chunks.length === 0) return null;
        if (chunks.length === 1) return chunks[0].summary;

        const lines = [`Aggregated summary from ${chunks.length} indexed chunks:`];
        for (const chunk of chunks) {
            lines.push(`- chunk ${chunk.chunk_index + 1}: ${chunk.summary}`);
        }
        return lines.join("\n");
    }

    /**
     * Read full file content from the filesystem.
     * Respects the 50KB truncation limit.
     */
    async getFullContent(filePath: string, repoRoot: string): Promise<string> {
        const MAX_SIZE = 50_000;
        const absPath = path.join(repoRoot, filePath);

        try {
            const content = await fs.readFile(absPath, "utf-8");
            if (content.length > MAX_SIZE) {
                return content.substring(0, MAX_SIZE) + "\n... (file truncated at 50KB)";
            }
            return content;
        } catch (err: any) {
            return `Error reading ${filePath}: ${err.message}`;
        }
    }

    /**
     * Check whether the index has any data.
     */
    isIndexed(): boolean {
        const stats = this.db.getContextIndexStats();
        return stats.totalChunks > 0;
    }

    /**
     * Format search results into a context string for the agent prompt.
     */
    formatResults(results: ContextResult[]): string {
        if (results.length === 0) return "";

        const lines: string[] = ["## Relevant Project Context"];
        for (const r of results) {
            lines.push(`\n**${r.filePath}** (${r.language})`);
            lines.push(r.summary);
        }
        return lines.join("\n");
    }

    /**
     * Format directory summaries for initial context.
     */
    formatDirectoryOverview(maxDirs = 10): string {
        const dirs = this.getAllDirectorySummaries();
        if (dirs.length === 0) return "";

        const lines: string[] = ["## Project Structure"];
        const topDirs = dirs.slice(0, maxDirs);
        for (const d of topDirs) {
            lines.push(`- **${d.dirPath}/** (${d.childCount} files): ${d.summary.substring(0, 150)}`);
        }
        if (dirs.length > maxDirs) {
            lines.push(`... and ${dirs.length - maxDirs} more directories`);
        }
        return lines.join("\n");
    }
}
