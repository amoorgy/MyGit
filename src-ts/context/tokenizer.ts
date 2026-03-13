/**
 * BM25 Tokenizer — Simple text tokenization for BM25 retrieval
 *
 * Handles both natural language (summaries) and code identifiers
 * (camelCase, snake_case). Produces a term frequency map for indexing.
 */

// ============================================================================
// STOP WORDS
// ============================================================================

const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "has", "have", "he", "in", "is", "it", "its", "of", "on", "or",
    "she", "that", "the", "to", "was", "were", "will", "with",
    "this", "but", "they", "not", "no", "so", "if", "do", "does",
    "did", "can", "could", "would", "should", "may", "might",
    "been", "being", "had", "having", "which", "what", "when",
    "where", "who", "whom", "how", "than", "then", "there",
    "these", "those", "each", "every", "all", "any", "both",
    "few", "more", "most", "other", "some", "such", "only",
    "own", "same", "too", "very", "just", "about", "above",
    "after", "again", "also", "because", "before", "between",
    "through", "during", "into", "over", "under", "until",
    // Common code words that are too generic
    "const", "let", "var", "function", "return", "import", "export",
    "default", "class", "new", "null", "undefined", "true", "false",
    "type", "interface", "void", "string", "number", "boolean",
]);

// ============================================================================
// TOKENIZATION
// ============================================================================

/**
 * Tokenize text into a list of normalized terms.
 * Handles camelCase splitting, snake_case splitting, and standard word boundaries.
 */
export function tokenize(text: string): string[] {
    // Split camelCase: "camelCase" → "camel Case" → ["camel", "case"]
    const expanded = text.replace(/([a-z])([A-Z])/g, "$1 $2");

    // Split on non-alphanumeric characters (underscores, hyphens, punctuation, whitespace)
    const rawTokens = expanded.split(/[^a-zA-Z0-9]+/);

    const tokens: string[] = [];
    for (const raw of rawTokens) {
        const lower = raw.toLowerCase();
        // Skip empty, short (1 char), stop words, and pure numbers
        if (lower.length <= 1) continue;
        if (STOP_WORDS.has(lower)) continue;
        if (/^\d+$/.test(lower)) continue;
        tokens.push(lower);
    }

    return tokens;
}

/**
 * Build a term frequency map from text.
 * Returns Map<term, count>.
 */
export function termFrequencies(text: string): Map<string, number> {
    const tokens = tokenize(text);
    const freqs = new Map<string, number>();
    for (const token of tokens) {
        freqs.set(token, (freqs.get(token) ?? 0) + 1);
    }
    return freqs;
}

/**
 * Get the total number of terms in the frequency map (document length for BM25).
 */
export function docLength(freqs: Map<string, number>): number {
    let total = 0;
    for (const count of freqs.values()) {
        total += count;
    }
    return total;
}

/**
 * Convert a term frequency map to a space-separated keyword string for storage.
 */
export function termsToKeywords(freqs: Map<string, number>): string {
    return Array.from(freqs.keys()).join(" ");
}
