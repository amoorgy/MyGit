export const PR_REVIEW_NARROW_WIDTH = 100;
const PR_REVIEW_WIDE_LEFT_MIN = 28;
const PR_REVIEW_WIDE_RIGHT_MIN = 32;
const PR_REVIEW_WIDE_GAP = 1;
const PR_REVIEW_NARROW_FINDINGS_MIN = 6;
const PR_REVIEW_NARROW_DETAILS_MIN = 8;

export interface PrReviewLayout {
    mode: "wide" | "narrow";
    contentWidth: number;
    compactHeader: boolean;
    compactFooter: boolean;
    leftWidth: number;
    rightWidth: number;
    findingsHeight: number;
    detailsHeight: number;
}

export function computePrReviewLayout(width: number, height: number): PrReviewLayout {
    const contentWidth = Math.max(1, width);
    const mode = contentWidth < PR_REVIEW_NARROW_WIDTH ? "narrow" : "wide";
    const compactHeader = height < 16 || contentWidth < 72;
    const compactFooter = height < 14 || contentWidth < 88;

    if (mode === "narrow") {
        const paneBudget = Math.max(
            PR_REVIEW_NARROW_FINDINGS_MIN + PR_REVIEW_NARROW_DETAILS_MIN,
            height - (compactHeader ? 6 : 7),
        );
        const findingsHeight = Math.max(
            PR_REVIEW_NARROW_FINDINGS_MIN,
            Math.min(paneBudget - PR_REVIEW_NARROW_DETAILS_MIN, Math.floor(paneBudget * 0.4)),
        );
        const detailsHeight = Math.max(PR_REVIEW_NARROW_DETAILS_MIN, paneBudget - findingsHeight);
        return {
            mode,
            contentWidth,
            compactHeader,
            compactFooter,
            leftWidth: contentWidth,
            rightWidth: contentWidth,
            findingsHeight,
            detailsHeight,
        };
    }

    const leftWidth = Math.max(
        PR_REVIEW_WIDE_LEFT_MIN,
        Math.min(contentWidth - PR_REVIEW_WIDE_RIGHT_MIN - PR_REVIEW_WIDE_GAP, Math.floor(contentWidth * 0.42)),
    );
    const rightWidth = Math.max(PR_REVIEW_WIDE_RIGHT_MIN, contentWidth - leftWidth - PR_REVIEW_WIDE_GAP);
    const paneHeight = Math.max(8, height - (compactHeader ? 6 : 7));

    return {
        mode,
        contentWidth,
        compactHeader,
        compactFooter,
        leftWidth,
        rightWidth,
        findingsHeight: paneHeight,
        detailsHeight: paneHeight,
    };
}

export function truncateInline(text: string, maxWidth: number): string {
    if (maxWidth <= 0) return "";
    if (text.length <= maxWidth) return text;
    if (maxWidth === 1) return text.slice(0, 1);
    return `${text.slice(0, maxWidth - 1)}…`;
}
