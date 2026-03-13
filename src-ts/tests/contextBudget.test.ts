import { describe, expect, it } from "vitest";
import { calculateBudget } from "../context/budget.js";

describe("calculateBudget", () => {
    it("reduces context budget when system/history reserves increase", () => {
        const baseline = calculateBudget(16000, 0.25, 2);
        const heavyReserves = calculateBudget(16000, 0.25, 2, {
            systemPromptReserve: 3200,
            historyReserve: 2200,
        });

        expect(heavyReserves.contextBudget).toBeLessThan(baseline.contextBudget);
        expect(heavyReserves.systemPromptReserve).toBe(3200);
        expect(heavyReserves.historyReserve).toBe(2200);
    });

    it("never underflows when total reserves exceed window", () => {
        const budget = calculateBudget(1000, 0.25, 50, {
            systemPromptReserve: 2000,
            historyReserve: 2000,
            responseReserve: 2000,
        });

        expect(budget.contextBudget).toBe(0);
        expect(budget.ragBudget).toBe(0);
    });
});

