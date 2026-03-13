/**
 * Learning Recorder — ported from Rust src/learning/recorder.rs
 *
 * Records agent operations and outcomes to the database to build experience.
 */

import type { MyGitDatabase, StoredOperation, StoredWorkflow } from "../storage/database.js";

export class ActionRecorder {
    private db: MyGitDatabase;

    constructor(db: MyGitDatabase) {
        this.db = db;
    }

    /**
     * Records a single operation (action execution)
     */
    recordOperation(
        request: string,
        phase: string,
        actionType: string,
        success: boolean,
    ) {
        this.db.recordOperation({
            request,
            phase,
            action_type: actionType,
            success,
        });
    }

    /**
     * Learns a workflow from a successful sequence of actions.
     * This is a simplified version; normally we'd aggregate multiple ops.
     */
    learnWorkflow(intent: string, prompt: string) {
        // Simple de-duplication handled by DB constraint
        this.db.insertWorkflow(intent, prompt);
    }
}
