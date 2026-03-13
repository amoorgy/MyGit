/**
 * Storage Layer — ported from Rust src/storage/database.rs
 *
 * Uses bun:sqlite for persistent storage of:
 * - Workflows (learned patterns)
 * - User Preferences
 * - Operations History (agent episodes)
 * - Conventions (auto-discovered)
 */

import { Database } from "bun:sqlite";
import * as path from "path";
import { mkdirSync } from "fs";
import { homedir } from "os";
import type { PRReview } from "../pr/types.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface StoredWorkflow {
    id?: number;
    intent: string;
    prompt: string;
    usage_count: number;
    last_used: string; // ISO date string
}

export interface StoredPreference {
    key: string;
    value: string;
}

export interface StoredConvention {
    type: string;
    pattern: string;
    confidence: number;
    last_updated: string;
}

export interface StoredOperation {
    id?: number;
    request: string;
    phase: string;
    action_type: string;
    success: boolean;
    timestamp: string;
}

export interface StoredContextChunk {
    id?: number;
    file_path: string;
    chunk_index: number;
    language: string;
    summary: string;
    keywords: string;
    token_count: number;
    git_hash: string;
    last_indexed: string;
}

export interface StoredDirSummary {
    id?: number;
    dir_path: string;
    summary: string;
    child_count: number;
    last_indexed: string;
}

// ── Database Class ─────────────────────────────────────────────────────

export class MyGitDatabase {
    private db: Database;

    constructor(dbPath: string) {
        // Ensure directory exists
        const dir = path.dirname(dbPath);
        mkdirSync(dir, { recursive: true });

        this.db = new Database(dbPath, { create: true });
        this.initSchema();
    }

    private initSchema() {
        // Workflows
        this.db.run(`
            CREATE TABLE IF NOT EXISTS workflows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                intent TEXT NOT NULL UNIQUE,
                prompt TEXT NOT NULL,
                usage_count INTEGER DEFAULT 0,
                last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Preferences
        this.db.run(`
            CREATE TABLE IF NOT EXISTS preferences (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        // Operations History
        this.db.run(`
            CREATE TABLE IF NOT EXISTS operations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request TEXT NOT NULL,
                phase TEXT NOT NULL,
                action_type TEXT NOT NULL,
                success BOOLEAN NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Conventions
        this.db.run(`
            CREATE TABLE IF NOT EXISTS conventions (
                type TEXT NOT NULL,
                pattern TEXT NOT NULL,
                confidence REAL NOT NULL,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (type, pattern)
            )
        `);

        // RAG: File-level index entries
        this.db.run(`
            CREATE TABLE IF NOT EXISTS context_index (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                chunk_index INTEGER NOT NULL DEFAULT 0,
                language TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL,
                keywords TEXT NOT NULL DEFAULT '',
                token_count INTEGER NOT NULL DEFAULT 0,
                git_hash TEXT NOT NULL DEFAULT '',
                last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(file_path, chunk_index)
            )
        `);

        // RAG: Directory-level summaries
        this.db.run(`
            CREATE TABLE IF NOT EXISTS context_dir_index (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dir_path TEXT NOT NULL UNIQUE,
                summary TEXT NOT NULL,
                child_count INTEGER NOT NULL DEFAULT 0,
                last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // RAG: BM25 inverted index
        this.db.run(`
            CREATE TABLE IF NOT EXISTS context_terms (
                term TEXT NOT NULL,
                doc_id INTEGER NOT NULL,
                term_freq INTEGER NOT NULL,
                PRIMARY KEY (term, doc_id),
                FOREIGN KEY (doc_id) REFERENCES context_index(id) ON DELETE CASCADE
            )
        `);

        // RAG: Corpus statistics for BM25
        this.db.run(`
            CREATE TABLE IF NOT EXISTS context_stats (
                key TEXT PRIMARY KEY,
                value REAL NOT NULL
            )
        `);

        // PR review cache (keyed by pr_number + head_sha to invalidate on new commits)
        this.db.run(`
            CREATE TABLE IF NOT EXISTS pr_reviews (
                id TEXT PRIMARY KEY,
                pr_number INTEGER NOT NULL,
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                pr_title TEXT NOT NULL,
                head_sha TEXT NOT NULL DEFAULT '',
                overall_summary TEXT NOT NULL,
                overall_decision TEXT NOT NULL,
                risk_score REAL NOT NULL,
                comments_json TEXT NOT NULL,
                file_summaries_json TEXT NOT NULL,
                generated_at TEXT NOT NULL,
                model_used TEXT NOT NULL,
                tokens_used INTEGER NOT NULL DEFAULT 0,
                UNIQUE(pr_number, repo_owner, repo_name, head_sha)
            )
        `);

        // Record of reviews posted back to GitHub
        this.db.run(`
            CREATE TABLE IF NOT EXISTS pr_posted_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pr_number INTEGER NOT NULL,
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                review_id TEXT NOT NULL,
                posted_at TEXT NOT NULL,
                github_review_id INTEGER
            )
        `);
    }

    close() {
        this.db.close();
    }

    // ── Workflows ──────────────────────────────────────────────────────

    insertWorkflow(intent: string, prompt: string) {
        const query = this.db.query(`
            INSERT INTO workflows (intent, prompt, usage_count, last_used)
            VALUES ($intent, $prompt, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(intent) DO UPDATE SET
                usage_count = usage_count + 1,
                last_used = CURRENT_TIMESTAMP
        `);
        query.run({ $intent: intent, $prompt: prompt });
    }

    findWorkflows(intentSubstring: string): StoredWorkflow[] {
        const query = this.db.query(
            "SELECT * FROM workflows WHERE intent LIKE $pattern ORDER BY usage_count DESC LIMIT 5",
        );
        return query.all({ $pattern: `%${intentSubstring}%` }) as StoredWorkflow[];
    }

    // ── Preferences ────────────────────────────────────────────────────

    setPreference(key: string, value: string) {
        const query = this.db.query(`
            INSERT OR REPLACE INTO preferences (key, value) VALUES ($key, $value)
        `);
        query.run({ $key: key, $value: value });
    }

    getPreference(key: string): string | null {
        const query = this.db.query("SELECT value FROM preferences WHERE key = $key");
        const res = query.get({ $key: key }) as { value: string } | null;
        return res ? res.value : null;
    }

    // ── Operations ─────────────────────────────────────────────────────

    recordOperation(op: Omit<StoredOperation, "id" | "timestamp">) {
        const query = this.db.query(`
            INSERT INTO operations (request, phase, action_type, success)
            VALUES ($request, $phase, $action_type, $success)
        `);
        query.run({
            $request: op.request,
            $phase: op.phase,
            $action_type: op.action_type,
            $success: op.success,
        });
    }

    getRecentOperations(limit = 10): StoredOperation[] {
        const query = this.db.query(
            "SELECT * FROM operations ORDER BY timestamp DESC LIMIT $limit",
        );
        return query.all({ $limit: limit }) as StoredOperation[];
    }

    // ── Conventions ────────────────────────────────────────────────────

    saveConvention(conv: StoredConvention) {
        const query = this.db.query(`
            INSERT OR REPLACE INTO conventions (type, pattern, confidence, last_updated)
            VALUES ($type, $pattern, $confidence, CURRENT_TIMESTAMP)
        `);
        query.run({
            $type: conv.type,
            $pattern: conv.pattern,
            $confidence: conv.confidence,
        });
    }

    loadConventions(): StoredConvention[] {
        return this.db.query("SELECT * FROM conventions").all() as StoredConvention[];
    }

    clearConventions() {
        this.db.run("DELETE FROM conventions");
    }

    // ── Context Index (RAG) ──────────────────────────────────────────

    upsertContextChunk(chunk: Omit<StoredContextChunk, "id" | "last_indexed">) {
        const q = this.db.query(`
            INSERT INTO context_index (file_path, chunk_index, language, summary, keywords, token_count, git_hash)
            VALUES ($file_path, $chunk_index, $language, $summary, $keywords, $token_count, $git_hash)
            ON CONFLICT(file_path, chunk_index) DO UPDATE SET
                language = $language, summary = $summary, keywords = $keywords,
                token_count = $token_count, git_hash = $git_hash,
                last_indexed = CURRENT_TIMESTAMP
        `);
        q.run({
            $file_path: chunk.file_path,
            $chunk_index: chunk.chunk_index,
            $language: chunk.language,
            $summary: chunk.summary,
            $keywords: chunk.keywords,
            $token_count: chunk.token_count,
            $git_hash: chunk.git_hash,
        });
    }

    getContextChunk(filePath: string, chunkIndex = 0): StoredContextChunk | null {
        const q = this.db.query(
            "SELECT * FROM context_index WHERE file_path = $fp AND chunk_index = $ci"
        );
        return (q.get({ $fp: filePath, $ci: chunkIndex }) as StoredContextChunk | null) ?? null;
    }

    getContextChunksForFile(filePath: string, limit = 50): StoredContextChunk[] {
        const q = this.db.query(
            "SELECT * FROM context_index WHERE file_path = $fp ORDER BY chunk_index ASC LIMIT $limit"
        );
        return q.all({ $fp: filePath, $limit: limit }) as StoredContextChunk[];
    }

    getAllContextChunks(): StoredContextChunk[] {
        return this.db.query("SELECT * FROM context_index ORDER BY file_path, chunk_index").all() as StoredContextChunk[];
    }

    getContextChunkById(id: number): StoredContextChunk | null {
        const q = this.db.query("SELECT * FROM context_index WHERE id = $id");
        return (q.get({ $id: id }) as StoredContextChunk | null) ?? null;
    }

    deleteContextChunk(filePath: string) {
        const ids = this.db.query(
            "SELECT id FROM context_index WHERE file_path = $fp",
        ).all({ $fp: filePath }) as Array<{ id: number }>;
        for (const row of ids) {
            this.db.query("DELETE FROM context_terms WHERE doc_id = $id").run({ $id: row.id });
        }
        this.db.query("DELETE FROM context_index WHERE file_path = $fp").run({ $fp: filePath });
    }

    clearContextIndex() {
        this.db.run("DELETE FROM context_index");
        this.db.run("DELETE FROM context_terms");
        this.db.run("DELETE FROM context_stats");
        this.db.run("DELETE FROM context_dir_index");
    }

    getContextIndexStats(): { totalFiles: number; totalChunks: number; lastIndexed: string | null } {
        const chunks = this.db.query("SELECT COUNT(*) as cnt FROM context_index").get() as { cnt: number };
        const files = this.db.query("SELECT COUNT(DISTINCT file_path) as cnt FROM context_index").get() as { cnt: number };
        const last = this.db.query("SELECT MAX(last_indexed) as ts FROM context_index").get() as { ts: string | null };
        return { totalFiles: files.cnt, totalChunks: chunks.cnt, lastIndexed: last.ts };
    }

    // ── BM25 Terms ───────────────────────────────────────────────────

    upsertTerms(docId: number, terms: Map<string, number>) {
        // Clear old terms for this doc
        this.db.query("DELETE FROM context_terms WHERE doc_id = $id").run({ $id: docId });

        const insert = this.db.query(
            "INSERT INTO context_terms (term, doc_id, term_freq) VALUES ($term, $doc_id, $tf)"
        );
        for (const [term, freq] of terms) {
            insert.run({ $term: term, $doc_id: docId, $tf: freq });
        }
    }

    getTermDocs(term: string): Array<{ doc_id: number; term_freq: number }> {
        return this.db.query(
            "SELECT doc_id, term_freq FROM context_terms WHERE term = $term"
        ).all({ $term: term }) as Array<{ doc_id: number; term_freq: number }>;
    }

    updateCorpusStats(totalDocs: number, avgDocLength: number) {
        const upsert = this.db.query(
            "INSERT OR REPLACE INTO context_stats (key, value) VALUES ($key, $value)"
        );
        upsert.run({ $key: "total_docs", $value: totalDocs });
        upsert.run({ $key: "avg_doc_length", $value: avgDocLength });
    }

    getCorpusStats(): { totalDocs: number; avgDocLength: number } {
        const get = (key: string): number => {
            const row = this.db.query("SELECT value FROM context_stats WHERE key = $key").get({ $key: key }) as { value: number } | null;
            return row?.value ?? 0;
        };
        return { totalDocs: get("total_docs"), avgDocLength: get("avg_doc_length") };
    }

    // ── Directory Summaries ──────────────────────────────────────────

    upsertDirSummary(dirPath: string, summary: string, childCount: number) {
        const q = this.db.query(`
            INSERT INTO context_dir_index (dir_path, summary, child_count)
            VALUES ($dir_path, $summary, $child_count)
            ON CONFLICT(dir_path) DO UPDATE SET
                summary = $summary, child_count = $child_count,
                last_indexed = CURRENT_TIMESTAMP
        `);
        q.run({ $dir_path: dirPath, $summary: summary, $child_count: childCount });
    }

    getDirSummary(dirPath: string): StoredDirSummary | null {
        const q = this.db.query("SELECT * FROM context_dir_index WHERE dir_path = $dp");
        return (q.get({ $dp: dirPath }) as StoredDirSummary | null) ?? null;
    }

    getAllDirSummaries(): StoredDirSummary[] {
        return this.db.query("SELECT * FROM context_dir_index ORDER BY dir_path").all() as StoredDirSummary[];
    }

    clearDirSummaries() {
        this.db.run("DELETE FROM context_dir_index");
    }

    // ── PR Reviews ──────────────────────────────────────────────────

    savePRReview(review: PRReview): void {
        const q = this.db.query(`
            INSERT INTO pr_reviews (
                id, pr_number, repo_owner, repo_name, pr_title, head_sha,
                overall_summary, overall_decision, risk_score,
                comments_json, file_summaries_json, generated_at, model_used, tokens_used
            ) VALUES (
                $id, $pr_number, $repo_owner, $repo_name, $pr_title, $head_sha,
                $overall_summary, $overall_decision, $risk_score,
                $comments_json, $file_summaries_json, $generated_at, $model_used, $tokens_used
            )
            ON CONFLICT(pr_number, repo_owner, repo_name, head_sha) DO UPDATE SET
                id = $id, pr_title = $pr_title,
                overall_summary = $overall_summary, overall_decision = $overall_decision,
                risk_score = $risk_score, comments_json = $comments_json,
                file_summaries_json = $file_summaries_json, generated_at = $generated_at,
                model_used = $model_used, tokens_used = $tokens_used
        `);
        q.run({
            $id: review.id,
            $pr_number: review.prNumber,
            $repo_owner: review.repoOwner,
            $repo_name: review.repoName,
            $pr_title: review.prTitle,
            $head_sha: review.headSha,
            $overall_summary: review.overallSummary,
            $overall_decision: review.overallDecision,
            $risk_score: review.riskScore,
            $comments_json: JSON.stringify(review.comments),
            $file_summaries_json: JSON.stringify(review.fileSummaries),
            $generated_at: review.generatedAt,
            $model_used: review.modelUsed,
            $tokens_used: review.tokensUsed,
        });
    }

    getCachedPRReview(
        prNumber: number,
        owner: string,
        repo: string,
        headSha: string,
    ): PRReview | null {
        const q = this.db.query(`
            SELECT * FROM pr_reviews
            WHERE pr_number = $pr_number AND repo_owner = $owner
              AND repo_name = $repo AND head_sha = $head_sha
        `);
        const row = q.get({ $pr_number: prNumber, $owner: owner, $repo: repo, $head_sha: headSha }) as any;
        if (!row) return null;

        return {
            id: row.id,
            prNumber: row.pr_number,
            repoOwner: row.repo_owner,
            repoName: row.repo_name,
            prTitle: row.pr_title,
            headSha: row.head_sha,
            overallSummary: row.overall_summary,
            overallDecision: row.overall_decision,
            riskScore: row.risk_score,
            comments: JSON.parse(row.comments_json),
            fileSummaries: JSON.parse(row.file_summaries_json),
            generatedAt: row.generated_at,
            modelUsed: row.model_used,
            tokensUsed: row.tokens_used,
        };
    }

    listCachedPRReviews(owner: string, repo: string, limit = 20): Array<{
        prNumber: number; prTitle: string; overallDecision: string; riskScore: number; generatedAt: string;
    }> {
        const q = this.db.query(`
            SELECT pr_number, pr_title, overall_decision, risk_score, generated_at
            FROM pr_reviews
            WHERE repo_owner = $owner AND repo_name = $repo
            ORDER BY generated_at DESC LIMIT $limit
        `);
        const rows = q.all({ $owner: owner, $repo: repo, $limit: limit }) as any[];
        return rows.map(r => ({
            prNumber: r.pr_number,
            prTitle: r.pr_title,
            overallDecision: r.overall_decision,
            riskScore: r.risk_score,
            generatedAt: r.generated_at,
        }));
    }

    markPRReviewPosted(reviewId: string, prNumber: number, owner: string, repo: string, githubReviewId: number): void {
        const q = this.db.query(`
            INSERT INTO pr_posted_reviews (pr_number, repo_owner, repo_name, review_id, posted_at, github_review_id)
            VALUES ($pr_number, $owner, $repo, $review_id, $posted_at, $github_review_id)
        `);
        q.run({
            $pr_number: prNumber,
            $owner: owner,
            $repo: repo,
            $review_id: reviewId,
            $posted_at: new Date().toISOString(),
            $github_review_id: githubReviewId,
        });
    }
}

// ── Factories ──────────────────────────────────────────────────────────

export function openUserDatabase(): MyGitDatabase {
    const dbPath = path.join(
        homedir(),
        process.platform === "darwin"
            ? "Library/Application Support/mygit/mygit.db"
            : ".config/mygit/mygit.db",
    );
    return new MyGitDatabase(dbPath);
}

export function openProjectDatabase(): MyGitDatabase {
    return openProjectDatabaseAt(process.cwd());
}

export function openProjectDatabaseAt(repoRoot: string): MyGitDatabase {
    const dbPath = path.join(repoRoot, ".mygit", "mygit.db");
    return new MyGitDatabase(dbPath);
}
