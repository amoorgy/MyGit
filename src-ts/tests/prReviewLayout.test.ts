import { describe, expect, it } from "vitest";
import { computePrReviewLayout, PR_REVIEW_NARROW_WIDTH, truncateInline } from "../tui/components/prReviewLayout.js";

describe("pr review layout", () => {
    it("switches to stacked mode below the narrow-width threshold", () => {
        const layout = computePrReviewLayout(PR_REVIEW_NARROW_WIDTH - 1, 28);

        expect(layout.mode).toBe("narrow");
        expect(layout.leftWidth).toBe(PR_REVIEW_NARROW_WIDTH - 1);
        expect(layout.rightWidth).toBe(PR_REVIEW_NARROW_WIDTH - 1);
        expect(layout.findingsHeight).toBeGreaterThanOrEqual(6);
        expect(layout.detailsHeight).toBeGreaterThanOrEqual(8);
    });

    it("keeps wide-mode pane widths within bounds", () => {
        const layout = computePrReviewLayout(120, 30);

        expect(layout.mode).toBe("wide");
        expect(layout.leftWidth).toBeGreaterThanOrEqual(28);
        expect(layout.rightWidth).toBeGreaterThanOrEqual(32);
        expect(layout.leftWidth + layout.rightWidth + 1).toBe(120);
    });

    it("truncates inline status text safely", () => {
        expect(truncateInline("abcdefghij", 6)).toBe("abcde…");
        expect(truncateInline("abc", 6)).toBe("abc");
    });
});
