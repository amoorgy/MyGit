/**
 * Agent Events — mirrors Rust `AgentEvent` in `src/agent/loop.rs`
 *
 * These events flow from the agent graph to the TUI for display.
 */

import type { AgentAction, PlanStep } from "./protocol.js";
import type { PermissionResponse } from "./permissions.js";

// ============================================================================
// EVENT TYPES
// ============================================================================

export type AgentEvent =
    | { type: "thinking"; content: string; isReasoning?: boolean }
    | { type: "message"; content: string }
    | { type: "task_complete"; summary: string }
    | { type: "response"; answer: string }
    | {
        type: "clarify_request";
        question: string;
        resolve: (answer: string) => void;
    }
    | {
        type: "plan_proposal";
        steps: PlanStep[];
        resolve: (approved: boolean) => void;
    }
    | {
        type: "action_request";
        action: AgentAction;
        reasoning: string;
        consequences: string[];
        resolve: (response: PermissionResponse) => void;
    }
    | { type: "action"; action: AgentAction; reasoning: string }
    | {
        type: "execution_result";
        success: boolean;
        output?: string;
        error?: string;
        kind?: "offline" | "network_fail" | "command_fail" | "push_rejected" | "merge_conflict";
    }
    | {
        type: "merge_conflicts";
        files: string[];
        resolve: (outcome: "resolved" | "cancelled") => void;
    }
    | { type: "iteration"; current: number; max: number }
    | { type: "token_usage"; used: number; limit: number }
    | { type: "context_fetch"; query: string; resultCount: number }
    | { type: "done" }
    | { type: "cancelled" }
    | { type: "error"; message: string };

// ============================================================================
// EVENT EMITTER INTERFACE
// ============================================================================

export type AgentEventHandler = (event: AgentEvent) => void;

/**
 * Simple event bus for agent → TUI communication.
 * Uses callbacks instead of Rust's mpsc channels.
 */
export class AgentEventBus {
    private handlers: AgentEventHandler[] = [];

    /**
     * Register an event handler.
     */
    on(handler: AgentEventHandler): () => void {
        this.handlers.push(handler);
        return () => {
            this.handlers = this.handlers.filter((h) => h !== handler);
        };
    }

    /**
     * Emit an event to all handlers.
     */
    emit(event: AgentEvent): void {
        for (const handler of this.handlers) {
            handler(event);
        }
    }
}
