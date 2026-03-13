import { describe, expect, it } from "vitest";
import {
    ASCII_CARD_MIN_WIDTH,
    renderAsciiNodeCard,
    shouldUseAsciiCards,
} from "../tui/thoughtMap/render.js";

describe("thought map ASCII render helpers", () => {
    it("renders fixed 3-line node cards", () => {
        const lines = renderAsciiNodeCard({
            width: 40,
            indent: 1,
            path: "1.2",
            title: "Build parser",
            badge: "*",
            isSelected: true,
        });

        expect(lines).toHaveLength(3);
        expect(lines[0].startsWith(">")).toBe(true);
        expect(lines[1]).toContain("|");
        expect(lines[2]).toContain("+");
    });

    it("truncates long labels to fit card width", () => {
        const lines = renderAsciiNodeCard({
            width: 26,
            indent: 0,
            path: "1",
            title: "A very long title that will not fit",
            badge: "d",
            isSelected: false,
        });

        expect(lines[1]).toContain("…");
    });

    it("uses width threshold fallback", () => {
        expect(shouldUseAsciiCards(ASCII_CARD_MIN_WIDTH - 1)).toBe(false);
        expect(shouldUseAsciiCards(ASCII_CARD_MIN_WIDTH)).toBe(true);
    });
});

