/**
 * Learning Retriever — ported from Rust src/learning/retriever.rs
 *
 * Retrieves relevant workflows and past solutions based on current user intent.
 */

import type { MyGitDatabase, StoredWorkflow } from "../storage/database.js";

export class KnowledgeRetriever {
    private db: MyGitDatabase;
    private minFrequency: number;
    private confidenceThreshold: number;

    constructor(db: MyGitDatabase, minFrequency = 1, confidenceThreshold = 0) {
        this.db = db;
        this.minFrequency = minFrequency;
        this.confidenceThreshold = confidenceThreshold;
    }

    /**
     * Finds similar workflows based on the user's request/intent.
     * Filters by minFrequency (usage_count must be >= minFrequency).
     */
    findRelevantWorkflows(intent: string): StoredWorkflow[] {
        const all = this.db.findWorkflows(intent);
        return all.filter(wf => wf.usage_count >= this.minFrequency);
    }

    /**
     * Formats retrieved workflows into a context string for the LLM.
     */
    formatContext(intent: string): string {
        const workflows = this.findRelevantWorkflows(intent);
        if (workflows.length === 0) return "";

        let context = "Running from past experience (Known Workflows):\n";
        for (const wf of workflows) {
            context += `- When asked "${wf.intent}", I previously used (${wf.usage_count}x):\n  ${wf.prompt}\n`;
        }
        return context;
    }
}
