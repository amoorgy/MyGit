/**
 * useThoughtMap — state hook for thought map lifecycle.
 *
 * Two-phase flow:
 *   Phase 1: Context gathering (read-only, automatic)
 *   Phase 2: Thought map generation + interactive refinement
 *
 * Does NOT persist to SQLite — thought maps are ephemeral per session.
 */

import { useState, useCallback } from "react";
import type { ProviderConfig } from "../../llm/providers.js";
import { createChatModel } from "../../llm/providers.js";
import { generateThoughtMapWithContext, refineThoughtMapNode } from "../thoughtMap/llm.js";
import { gatherContextWithProgress, type ContextItem } from "../../agent/context.js";
import type { ThoughtMap } from "../thoughtMap/types.js";

export type { ContextItem } from "../../agent/context.js";

export interface UseThoughtMapReturn {
    thoughtMap: ThoughtMap | null;
    isGatheringContext: boolean;
    contextItems: ContextItem[];
    isGenerating: boolean;
    isRefining: boolean;
    error: string | null;
    selectedNodeId: string | null;
    setSelectedNodeId: (id: string | null) => void;
    generateMap: (intent: string) => Promise<void>;
    refineNode: (nodeId: string, prompt: string) => Promise<void>;
    clearMap: () => void;
}

export function useThoughtMap(
    providerConfig: ProviderConfig,
): UseThoughtMapReturn {
    const [thoughtMap, setThoughtMap] = useState<ThoughtMap | null>(null);
    const [isGatheringContext, setIsGatheringContext] = useState(false);
    const [contextItems, setContextItems] = useState<ContextItem[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

    const generateMap = useCallback(
        async (intent: string) => {
            setError(null);

            // Phase 1: Context gathering
            setIsGatheringContext(true);
            setContextItems([
                { label: "Repository root", value: "", status: "pending" },
                { label: "Branch", value: "", status: "pending" },
                { label: "Git status", value: "", status: "pending" },
                { label: "Recent commits", value: "", status: "pending" },
                { label: "Diff summary", value: "", status: "pending" },
                { label: "File tree", value: "", status: "pending" },
            ]);

            try {
                const ctx = await gatherContextWithProgress((label, value) => {
                    setContextItems((prev) =>
                        prev.map((item) =>
                            item.label === label
                                ? { ...item, value, status: "done" as const }
                                : item,
                        ),
                    );
                });
                setIsGatheringContext(false);

                // Phase 2: Thought map generation
                setIsGenerating(true);
                const model = createChatModel(providerConfig);
                const map = await generateThoughtMapWithContext(intent, model, ctx);
                setThoughtMap(map);
                if (map.nodes.length > 0) {
                    setSelectedNodeId(map.nodes[0].id);
                }
            } catch (err: any) {
                setError(err.message ?? "Failed to generate thought map");
            } finally {
                setIsGatheringContext(false);
                setIsGenerating(false);
            }
        },
        [providerConfig],
    );

    const refineNode = useCallback(
        async (nodeId: string, prompt: string) => {
            if (!thoughtMap) return;
            setIsRefining(true);
            setError(null);
            try {
                const model = createChatModel(providerConfig);
                const updated = await refineThoughtMapNode(
                    thoughtMap,
                    nodeId,
                    prompt,
                    model,
                );
                setThoughtMap(updated);
            } catch (err: any) {
                setError(err.message ?? "Failed to refine node");
            } finally {
                setIsRefining(false);
            }
        },
        [thoughtMap, providerConfig],
    );

    const clearMap = useCallback(() => {
        setThoughtMap(null);
        setSelectedNodeId(null);
        setError(null);
        setContextItems([]);
    }, []);

    return {
        thoughtMap,
        isGatheringContext,
        contextItems,
        isGenerating,
        isRefining,
        error,
        selectedNodeId,
        setSelectedNodeId,
        generateMap,
        refineNode,
        clearMap,
    };
}
