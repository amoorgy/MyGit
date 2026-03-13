/**
 * Git Recipes — matcher and prompt formatter.
 *
 * Scores user requests against the recipe catalog, extracts parameters,
 * and formats matched recipes into compact prompt blocks.
 */

import { RECIPE_CATALOG } from "./catalog.js";
import type { GitRecipe, RecipeMatch, EnhancedGitContext } from "./types.js";

// ============================================================================
// MATCHING
// ============================================================================

const CONFIDENCE_THRESHOLD = 0.4;

/**
 * Score a single recipe against the user request.
 * Returns 0–1 confidence. Any single trigger match gives a base score of 0.5,
 * with additional matches boosting toward 1.0. More trigger patterns means
 * more flexibility, not more dilution.
 */
function scoreRecipe(request: string, recipe: GitRecipe): number {
    let matchCount = 0;
    let bestSpecificity = 0;

    for (const trigger of recipe.triggers) {
        if (trigger.test(request)) {
            matchCount++;
            bestSpecificity = Math.max(bestSpecificity, trigger.source.length);
        }
    }

    if (matchCount === 0) return 0;

    // Base: any single match → 0.5. Each additional match adds up to 0.3 more.
    const base = 0.5;
    const additionalMatchBonus = Math.min(0.3, (matchCount - 1) * 0.15);
    // Specificity tiebreaker: longer best-match pattern → small bonus (0–0.2)
    const specificityBonus = Math.min(0.2, bestSpecificity / 200);

    return Math.min(1.0, base + additionalMatchBonus + specificityBonus);
}

/**
 * Match the user request against all recipes.
 * Returns the best match above the confidence threshold, or null.
 */
export function matchRecipe(request: string): RecipeMatch | null {
    let bestMatch: RecipeMatch | null = null;

    for (const recipe of RECIPE_CATALOG) {
        const confidence = scoreRecipe(request, recipe);
        if (confidence >= CONFIDENCE_THRESHOLD && (bestMatch === null || confidence > bestMatch.confidence)) {
            bestMatch = {
                recipe,
                confidence,
                params: extractRecipeParams(request, recipe),
            };
        }
    }

    return bestMatch;
}

// ============================================================================
// PARAMETER EXTRACTION
// ============================================================================

/**
 * Extract parameters (branch, file, date, remote, commit, search term) from
 * the user request. These are best-effort — the agent can ask for clarification.
 */
export function extractRecipeParams(request: string, _recipe: GitRecipe): Record<string, string> {
    const params: Record<string, string> = {};

    // Branch name: look for quoted strings or common branch name patterns
    const branchQuoted = request.match(/["']([^"']+)["']/);
    const branchNamed = request.match(/\bbranch\s+(?:called\s+|named\s+)?([a-zA-Z0-9_/.@-]+)/i);
    if (branchQuoted) {
        params.branch = branchQuoted[1];
    } else if (branchNamed) {
        params.branch = branchNamed[1];
    }

    // File path: look for path-like strings
    const filePath = request.match(/(?:^|\s)((?:\.{0,2}\/)?[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+\.?[a-zA-Z0-9]*)/);
    if (filePath) {
        params.file = filePath[1];
    }

    // Date: various formats
    const dateISO = request.match(/(\d{4}-\d{1,2}-\d{1,2})/);
    const dateSlash = request.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const dateNatural = request.match(
        /(\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?)/i,
    );
    const dateNatural2 = request.match(
        /((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?)/i,
    );
    if (dateISO) {
        params.date = dateISO[1];
    } else if (dateSlash) {
        params.date = dateSlash[1];
    } else if (dateNatural) {
        params.date = dateNatural[1];
    } else if (dateNatural2) {
        params.date = dateNatural2[1];
    }

    // Remote name
    const remoteName = request.match(/\b(?:from|to|on)\s+(?:the\s+)?(?:remote\s+)?["']?([a-zA-Z0-9_-]+)["']?\s+(?:remote|fork)/i);
    const remoteSimple = request.match(/\b(?:remote|fork)\s+(?:called\s+|named\s+)?["']?([a-zA-Z0-9_-]+)["']?/i);
    if (remoteName) {
        params.remote = remoteName[1];
    } else if (remoteSimple && !["my", "the", "a", "from", "this"].includes(remoteSimple[1].toLowerCase())) {
        params.remote = remoteSimple[1];
    }

    // Commit SHA
    const commitSha = request.match(/\b([0-9a-f]{7,40})\b/);
    if (commitSha) {
        params.commit_sha = commitSha[1];
    }

    // Numeric count (for squash, etc.)
    const count = request.match(/\b(last\s+)?(\d+)\s+commits?\b/i);
    if (count) {
        params.count = count[2];
    }

    // Search term: quoted strings that aren't branch names
    const searchQuoted = request.match(/(?:for|find|search|grep|looking\s+for)\s+["']([^"']+)["']/i);
    if (searchQuoted) {
        params.search_term = searchQuoted[1];
    }

    return params;
}

// ============================================================================
// PROMPT FORMATTING
// ============================================================================

/**
 * Format a recipe match + enhanced context into a compact prompt block
 * for injection into the agent's system prompt.
 */
export function formatRecipeForPrompt(match: RecipeMatch, enhancedCtx?: EnhancedGitContext): string {
    const { recipe, params } = match;
    const lines: string[] = [];

    lines.push("## GIT WORKFLOW RECIPE");
    lines.push("This is optional guidance for a known git workflow. Follow these steps in order, adapting commands based on actual output. If the steps don't match the user's actual intent, ignore them and proceed normally.");
    lines.push("");
    lines.push(`Recipe: ${recipe.name}`);

    // Show extracted params
    const paramEntries = Object.entries(params);
    if (paramEntries.length > 0) {
        const paramStr = paramEntries.map(([k, v]) => `${k}=${v}`).join(", ");
        lines.push(`Detected params: ${paramStr}`);
        lines.push("(Some params may be missing — use clarify action to ask the user if needed.)");
    }

    lines.push("");
    lines.push("Steps:");
    for (let i = 0; i < recipe.steps.length; i++) {
        const step = recipe.steps[i];
        const probe = step.isProbe ? " [PROBE]" : "";
        const skip = step.skipIf ? ` (skip if: ${step.skipIf})` : "";

        // Substitute known params into command template
        let cmd = step.command;
        for (const [k, v] of paramEntries) {
            cmd = cmd.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
        }

        lines.push(`${i + 1}.${probe} ${step.description} → \`${cmd}\`${skip}`);
    }

    // Enhanced context summary
    if (enhancedCtx) {
        lines.push("");
        lines.push("Git Context:");

        if (enhancedCtx.remotes.length > 0) {
            const remoteStrs = enhancedCtx.remotes.map((r) => {
                const gh = r.github ? ` (${r.github.owner}/${r.github.repo})` : "";
                return `  ${r.name}: ${r.fetchUrl}${gh}`;
            });
            lines.push("Remotes:");
            lines.push(...remoteStrs);
        }

        if (enhancedCtx.forkInfo?.isFork) {
            lines.push(`Fork: yes (parent: ${enhancedCtx.forkInfo.parentRepo ?? "unknown"})`);
            if (enhancedCtx.forkInfo.parentCloneUrl) {
                lines.push(`  Parent clone URL: ${enhancedCtx.forkInfo.parentCloneUrl}`);
            }
        }

        if (enhancedCtx.tracking.length > 0) {
            const trackStrs = enhancedCtx.tracking.map(
                (t) => `  ${t.local} → ${t.remote} (ahead ${t.ahead}, behind ${t.behind})`,
            );
            lines.push("Tracking:");
            lines.push(...trackStrs);
        }

        if (enhancedCtx.allBranches.length > 0) {
            const branchCount = enhancedCtx.allBranches.length;
            const localCount = enhancedCtx.allBranches.filter((b) => !b.isRemote).length;
            const remoteCount = branchCount - localCount;
            lines.push(`Branches: ${localCount} local, ${remoteCount} remote`);
        }
    }

    // Warnings
    if (recipe.warnings.length > 0) {
        lines.push("");
        lines.push("Warnings:");
        for (const w of recipe.warnings) {
            lines.push(`  - ${w}`);
        }
    }

    return lines.join("\n");
}

// ============================================================================
// GIT WORKFLOW DETECTION
// ============================================================================

/**
 * Detect if a request involves git workflow keywords that should trigger
 * enhanced git context gathering (even without a recipe match).
 */
export function isGitWorkflowRequest(request: string): boolean {
    return /\b(fetch|sync|fork|upstream|cherry[\s-]?pick|rebase|bisect|undo|revert|squash|remote|restore.*deleted|merge.*upstream)\b/i.test(request) ||
        /\bbranch\b.*\b(has|contains|from)\b/i.test(request);
}
