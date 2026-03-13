/**
 * Context Budget — Token budget management for dynamic context loading.
 *
 * Calculates how many tokens to allocate to each section of the agent's
 * context, ensuring we stay within the model's context window.
 */

import type { ContextBudget } from "./types.js";

// ============================================================================
// BUDGET DEFAULTS
// ============================================================================

/** Default reserve for system prompt */
const DEFAULT_SYSTEM_PROMPT_RESERVE = 2000;

/** Default reserve for prior conversation history */
const DEFAULT_HISTORY_RESERVE = 600;

/** Reserve for LLM response generation */
const DEFAULT_RESPONSE_RESERVE = 1500;

/** Minimum tokens for observation history */
const MIN_OBSERVATION_RESERVE = 800;

/** Maximum tokens for observation history */
const MAX_OBSERVATION_RESERVE = 3000;

export interface BudgetReserveOptions {
    /** Estimated tokens for system prompt */
    systemPromptReserve?: number;
    /** Estimated tokens for conversation history */
    historyReserve?: number;
    /** Desired reserve for model response tokens */
    responseReserve?: number;
    /** Override minimum observation reserve */
    minObservationReserve?: number;
    /** Override maximum observation reserve */
    maxObservationReserve?: number;
}

// ============================================================================
// BUDGET CALCULATOR
// ============================================================================

/**
 * Calculate the token budget for context formatting.
 *
 * @param contextWindow - Total context window size in tokens
 * @param ragRatio - Fraction of available context for RAG summaries (0-1)
 * @param observationCount - Number of observations to estimate reserve
 */
export function calculateBudget(
    contextWindow: number,
    ragRatio = 0.25,
    observationCount = 0,
    reserves: BudgetReserveOptions = {},
): ContextBudget {
    const minObservationReserve = reserves.minObservationReserve ?? MIN_OBSERVATION_RESERVE;
    const maxObservationReserve = reserves.maxObservationReserve ?? MAX_OBSERVATION_RESERVE;
    const systemPromptReserve = Math.max(0, Math.floor(
        reserves.systemPromptReserve ?? DEFAULT_SYSTEM_PROMPT_RESERVE,
    ));
    const historyReserve = Math.max(0, Math.floor(reserves.historyReserve ?? DEFAULT_HISTORY_RESERVE));
    const responseReserve = Math.max(0, Math.floor(reserves.responseReserve ?? DEFAULT_RESPONSE_RESERVE));

    // Observation reserve scales with count, clamped to min/max
    const observationReserve = Math.min(
        maxObservationReserve,
        Math.max(minObservationReserve, observationCount * 150),
    );

    const totalReserves = systemPromptReserve + historyReserve + responseReserve + observationReserve;
    const available = Math.max(0, contextWindow - totalReserves);

    // RAG gets its ratio of the available budget
    const ragBudget = Math.floor(available * ragRatio);
    const contextBudget = available;

    return {
        totalWindow: contextWindow,
        systemPromptReserve,
        historyReserve,
        responseReserve,
        observationReserve,
        ragBudget,
        contextBudget,
    };
}

/**
 * Estimate token count for a string (chars / 4 heuristic).
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Select results that fit within a token budget.
 * Returns the subset that fits, preserving ranking order.
 */
export function fitToBudget<T extends { summary: string }>(
    items: T[],
    budgetTokens: number,
): T[] {
    const result: T[] = [];
    let used = 0;

    for (const item of items) {
        const itemTokens = estimateTokens(item.summary);
        if (used + itemTokens > budgetTokens) break;
        result.push(item);
        used += itemTokens;
    }

    return result;
}

/**
 * Get the adaptive observation window size based on budget.
 * Shrinks from 10 to 5 when budget is tight.
 */
export function adaptiveWindowSize(budget: ContextBudget): number {
    if (budget.contextBudget < 4000) return 5;
    if (budget.contextBudget < 8000) return 7;
    return 10;
}

/**
 * Get the adaptive observation output truncation length.
 * Shortens from 200 to 100 chars when budget is tight.
 */
export function adaptiveOutputTruncation(budget: ContextBudget): number {
    if (budget.contextBudget < 4000) return 100;
    if (budget.contextBudget < 8000) return 150;
    return 200;
}

/**
 * Get the adaptive truncation for the dedicated latest read/fetch context block.
 * Keeps richer context than Recent Actions while still respecting tight budgets.
 */
export function adaptiveReadOutputTruncation(budget: ContextBudget): number {
    if (budget.contextBudget < 4000) return 400;
    if (budget.contextBudget < 8000) return 800;
    return 1200;
}
