/**
 * Learning Memory — ported from Rust src/learning/memory.rs
 *
 * high-level interface for the agent's long-term memory.
 * Orchestrates recording and retrieving of knowledge.
 */

import { ActionRecorder } from "./recorder.js";
import { KnowledgeRetriever } from "./retriever.js";
import type { MyGitDatabase } from "../storage/database.js";
import type { Convention } from "../conventions/types.js";
import { loadConventions } from "../conventions/index.js";

export class AgentMemory {
    private db: MyGitDatabase;
    recorder: ActionRecorder;
    retriever: KnowledgeRetriever;
    conventions: Convention[] = [];

    constructor(db: MyGitDatabase, minFrequency = 1, confidenceThreshold = 0) {
        this.db = db;
        this.recorder = new ActionRecorder(db);
        this.retriever = new KnowledgeRetriever(db, minFrequency, confidenceThreshold);
    }

    async loadContext(repoPath: string) {
        // Load conventions
        this.conventions = loadConventions(this.db);
    }

    getConventionContext(): string {
        if (this.conventions.length === 0) return "";

        let ctx = "Project Conventions:\n";
        for (const conv of this.conventions) {
            ctx += `- [${conv.type}] ${conv.description}\n`;
        }
        return ctx;
    }
}
