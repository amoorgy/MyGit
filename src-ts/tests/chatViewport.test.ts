import { describe, expect, it } from "vitest";
import {
    applyScrollDelta,
    computeResizePreservedOffset,
    computeScrollbarThumb,
    computeViewportWindow,
    getPageJump,
} from "../tui/components/chatLayout.js";

describe("chat viewport math", () => {
    it("computes row windows from bottom-relative offsets", () => {
        const atBottom = computeViewportWindow(100, 20, 0, 0);
        expect(atBottom.start).toBe(80);
        expect(atBottom.end).toBe(100);

        const scrolledUp = computeViewportWindow(100, 20, 10, 0);
        expect(scrolledUp.start).toBe(70);
        expect(scrolledUp.end).toBe(90);
        expect(scrolledUp.aboveRows).toBe(70);
        expect(scrolledUp.belowRows).toBe(10);
    });

    it("preserves anchor row on resize and stays pinned at bottom when offset is zero", () => {
        const pinned = computeResizePreservedOffset({
            previousTotalRows: 200,
            nextTotalRows: 200,
            oldViewportRows: 20,
            newViewportRows: 30,
            oldOffset: 0,
        });
        expect(pinned).toBe(0);

        const preserved = computeResizePreservedOffset({
            previousTotalRows: 200,
            nextTotalRows: 200,
            oldViewportRows: 20,
            newViewportRows: 30,
            oldOffset: 40,
        });
        expect(preserved).toBe(30);
    });

    it("preserves anchor start when row count grows after reflow", () => {
        const previousTotalRows = 120;
        const nextTotalRows = 180;
        const oldViewportRows = 20;
        const newViewportRows = 20;
        const oldOffset = 30;

        const previousWindow = computeViewportWindow(
            previousTotalRows,
            oldViewportRows,
            oldOffset,
            0,
        );

        const nextOffset = computeResizePreservedOffset({
            previousTotalRows,
            nextTotalRows,
            oldViewportRows,
            newViewportRows,
            oldOffset,
        });

        const nextWindow = computeViewportWindow(nextTotalRows, newViewportRows, nextOffset, 0);
        expect(nextWindow.start).toBe(previousWindow.start);
    });

    it("derives scrollbar thumb from row counts", () => {
        const bottomThumb = computeScrollbarThumb(100, 20, 0, 20);
        expect(bottomThumb.height).toBe(4);
        expect(bottomThumb.top).toBe(16);

        const topThumb = computeScrollbarThumb(100, 20, 80, 20);
        expect(topThumb.height).toBe(4);
        expect(topThumb.top).toBe(0);
    });

    it("applies web-like row deltas and page jumps", () => {
        expect(applyScrollDelta(0, 1, 50)).toBe(1);
        expect(applyScrollDelta(1, -5, 50)).toBe(0);
        expect(applyScrollDelta(48, 5, 50)).toBe(50);
        expect(getPageJump(24)).toBe(22);
    });
});
