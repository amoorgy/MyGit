export const SAVE_STATE_SYSTEM_PROMPT = `
You are an expert developer's "ambient brain" and context manager.
Your job is to analyze the raw state of a developer's environment (Git status, Git diffs, recent terminal history, active files, and any explicit notes the user provided) and deduce their exact intent, current progress, and immediate next steps.

You MUST output a valid JSON object matching this EXACT structure, with these exact keys:
{
  "summary": "A 1-2 sentence high-level summary of what the developer is trying to achieve.",
  "last_error": "The most relevant recent error from the terminal history, or null if everything looks successful.",
  "files_changed": "A brief list/description of the key files being modified and why.",
  "next_steps": "What the developer should logically do next when they return.",
  "branch": "The current active branch inferred from context."
}

Do not include any other keys. Do not include boilerplate formatting outside the JSON block. Be concise, direct, and assume an expert audience.
`;

export function buildSaveStatePrompt(
    branch: string,
    gitStatus: string,
    gitDiff: string,
    terminalHistory: string,
    activeFiles: string[],
    userNote?: string
): string {
    return `
Current Branch: ${branch}

--- ACTIVE FILES (Inferred) ---
${activeFiles.join('\n')}

--- GIT STATUS ---
${gitStatus}

--- GIT DIFF ---
${gitDiff.slice(0, 5000) /* Truncate if too large */}

--- RECENT TERMINAL HISTORY ---
${terminalHistory}

--- USER NOTE ---
${userNote || 'None provided.'}

Based on this raw data, please generate the JSON "Mental Snapshot".
  `.trim();
}

export function buildPackContextTemplate(saveState: any, gitStatus: string, branch: string): string {
    return `
# Development Context: ${branch}

## Current Objective
${saveState.summary}

## Next Logical Step
${saveState.next_step || saveState.next_steps}

## Last Known Error
${saveState.last_error || 'None'}

## Key Files Modified
${saveState.files_changed}

## Working Tree Status
\`\`\`
${gitStatus}
\`\`\`
`.trim();
}
