/**
 * Context RAG Types — Dynamic context retrieval system
 *
 * Defines interfaces for the project indexer, BM25 retriever,
 * and token budget management.
 */

// ============================================================================
// INDEX TYPES
// ============================================================================

/** A single indexed chunk of a source file */
export interface ContextChunk {
    id: number;
    filePath: string;
    chunkIndex: number;
    language: string;
    summary: string;
    keywords: string;       // space-separated BM25 tokens
    tokenCount: number;     // estimated tokens of original content
    gitHash: string;
    lastIndexed: number;
}

/** A directory-level summary aggregating its children */
export interface DirectorySummary {
    id: number;
    dirPath: string;
    summary: string;
    childCount: number;
    lastIndexed: number;
}

/** A term in the BM25 inverted index */
export interface TermEntry {
    term: string;
    docId: number;
    termFreq: number;
}

// ============================================================================
// RETRIEVAL TYPES
// ============================================================================

/** A ranked search result from BM25 retrieval */
export interface ContextResult {
    filePath: string;
    summary: string;
    score: number;
    chunkIndex: number;
    language: string;
}

/** Scope options for the fetch_context agent action */
export type FetchContextScope = "search" | "file" | "directory";

// ============================================================================
// BUDGET TYPES
// ============================================================================

/** Token budget allocation for context formatting */
export interface ContextBudget {
    totalWindow: number;
    systemPromptReserve: number;
    historyReserve: number;
    responseReserve: number;
    observationReserve: number;
    ragBudget: number;           // tokens available for RAG summaries
    contextBudget: number;       // total available for all context
}

// ============================================================================
// INDEXER TYPES
// ============================================================================

/** Result of indexing a single file */
export interface IndexResult {
    filePath: string;
    chunks: number;
    status: "indexed" | "skipped" | "error";
    error?: string;
}

/** Overall indexing statistics */
export interface IndexStats {
    totalFiles: number;
    indexedFiles: number;
    staleFiles: number;
    totalChunks: number;
    lastIndexed: number | null;
}

/** Options for the project indexer */
export interface IndexOptions {
    /** Max files to index per run (for incremental indexing) */
    batchSize?: number;
    /** File extensions to include (default: common source files) */
    extensions?: string[];
    /** Directories to skip */
    skipDirs?: string[];
    /** Max file size in bytes to index */
    maxFileSize?: number;
    /** Parse .gitignore and add directory patterns to skip set (default: true) */
    useGitignore?: boolean;
}

/** Default source file extensions to index */
export const DEFAULT_SOURCE_EXTENSIONS = [
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".rs", ".go", ".java", ".kt", ".kts",
    ".c", ".cpp", ".h", ".hpp",
    ".rb", ".php", ".swift", ".cs",
    ".vue", ".svelte",
    ".json", ".toml", ".yaml", ".yml",
    ".md", ".txt",
    ".sql", ".graphql",
    ".sh", ".bash", ".zsh",
    ".css", ".scss", ".less",
    ".html", ".xml",
];

/** Directories to always skip during indexing — language-agnostic artifact list */
export const DEFAULT_SKIP_DIRS = [
    // JS/TS
    "node_modules", "dist", "build", ".next", ".nuxt", ".output", ".vercel",
    "out", ".cache", ".parcel-cache", ".turbo", ".svelte-kit", ".docusaurus",
    // Python
    "__pycache__", ".venv", "venv", "env", ".tox", ".pytest_cache",
    ".mypy_cache", "htmlcov", ".nox",
    // Rust
    "target",
    // Go
    "vendor", "bin",
    // Java/Kotlin/Android
    ".gradle", "release", "debug",
    // C/C++
    "obj", "cmake-build-debug", "cmake-build-release",
    // Ruby
    ".bundle",
    // .NET
    "packages", ".vs", "Debug", "Release",
    // iOS/macOS
    "DerivedData", "Pods",
    // Terraform
    ".terraform",
    // Version control
    ".git", ".svn", ".hg",
    // IDE
    ".idea", ".vscode", ".eclipse",
    // Coverage/reports
    "coverage", ".nyc_output", "lcov-report",
    // Misc temp/cache
    "tmp", "temp", ".tmp",
];
