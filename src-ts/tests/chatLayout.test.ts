import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../tui/components/ChatArea.js";
import { buildChatRows, clipLine, wrapLineWordFirst } from "../tui/components/chatLayout.js";

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
    return {
        role: "agent",
        content: "",
        timestamp: Date.now(),
        ...overrides,
    };
}

describe("chatLayout rows", () => {
    it("expands long tool output into scrollable boxed rows", () => {
        const toolOutput = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join("\n");
        const message = makeMessage({
            role: "tool",
            toolData: {
                toolType: "shell",
                label: "ls -la",
                reasoning: "List project files",
                output: toolOutput,
                success: true,
            },
        });

        const rows = buildChatRows([message], {
            contentWidth: 48,
            thinkCollapsed: true,
            toolsCollapsed: false,
        });

        expect(rows[0]?.kind).toBe("tool_box_top");
        expect(rows[rows.length - 1]?.kind).toBe("tool_box_bottom");
        expect(rows.filter((row) => row.kind === "tool_box_body").length).toBeGreaterThan(120);
    });

    it("preserves core markdown semantics and nested indentation in row output", () => {
        const message = makeMessage({
            role: "agent",
            content: [
                "## Actions",
                "",
                "- read_file",
                "- fetch_context",
                "  - nested_item",
                "",
                "1. respond",
                "",
                "```ts",
                "const action = \"respond\";",
                "```",
            ].join("\n"),
        });

        const rows = buildChatRows([message], {
            contentWidth: 64,
            thinkCollapsed: true,
            toolsCollapsed: true,
        });

        const textRows = rows.map((row) => row.text);
        expect(textRows).toContain("Actions");
        expect(textRows).toContain("• read_file");
        expect(textRows).toContain("  • nested_item");
        expect(textRows).toContain("1. respond");
        expect(textRows).toContain("```ts");
        expect(textRows).toContain("const action = \"respond\";");
        expect(textRows).toContain("```");
    });

    it("renders list continuation lines with hanging indentation", () => {
        const message = makeMessage({
            role: "agent",
            content: [
                "- read `src-ts/index.tsx` ✓",
                "  The main entry point is `src-ts/index.tsx`.",
            ].join("\n"),
        });

        const rows = buildChatRows([message], {
            contentWidth: 96,
            thinkCollapsed: true,
            toolsCollapsed: true,
        });

        const textRows = rows.map((row) => row.text);
        expect(textRows).toContain("• read `src-ts/index.tsx` ✓");
        expect(textRows).toContain("  The main entry point is `src-ts/index.tsx`.");
    });

    it("preserves loose-list paragraph spacing with a blank continuation row", () => {
        const message = makeMessage({
            role: "agent",
            content: "- first paragraph\n\n  second paragraph",
        });

        const rows = buildChatRows([message], {
            contentWidth: 80,
            thinkCollapsed: true,
            toolsCollapsed: true,
        });

        const textRows = rows.map((row) => row.text);
        const firstRowIndex = textRows.indexOf("• first paragraph");
        expect(firstRowIndex).toBeGreaterThanOrEqual(0);
        expect(textRows[firstRowIndex + 1]).toBe("");
        expect(textRows[firstRowIndex + 2]).toBe("  second paragraph");
    });

    it("wraps long paragraph lines with fixed continuation indentation", () => {
        const width = 24;
        const message = makeMessage({
            role: "agent",
            content: "This paragraph is intentionally long so it wraps into multiple terminal rows without truncation.",
        });

        const rows = buildChatRows([message], {
            contentWidth: width,
            thinkCollapsed: true,
            toolsCollapsed: true,
        }).filter((row) => row.kind === "content");

        expect(rows.length).toBeGreaterThan(1);
        expect(rows[0]?.text.startsWith("  ")).toBe(false);
        expect(rows.slice(1).every((row) => row.text.startsWith("  "))).toBe(true);
        expect(rows.every((row) => row.text.length <= width)).toBe(true);
        expect(rows.some((row) => row.text.includes("…"))).toBe(false);
    });

    it("wraps long structured markdown lines with fixed continuation indentation", () => {
        const width = 30;
        const message = makeMessage({
            role: "agent",
            content: [
                "- this list item should wrap across rows in a predictable way",
                "",
                "> this blockquote should also wrap with a continuation prefix",
                "",
                "```txt",
                "averyveryveryveryveryveryveryveryverylongtoken",
                "```",
            ].join("\n"),
        });

        const rows = buildChatRows([message], {
            contentWidth: width,
            thinkCollapsed: true,
            toolsCollapsed: true,
        }).filter((row) => row.kind === "content");

        const listIdx = rows.findIndex((row) => row.text.startsWith("• this list"));
        expect(listIdx).toBeGreaterThanOrEqual(0);
        expect(rows[listIdx + 1]?.text.startsWith("  ")).toBe(true);

        const quoteIdx = rows.findIndex(
            (row) => row.text.startsWith(">") && row.text.includes("this blockquote"),
        );
        expect(quoteIdx).toBeGreaterThanOrEqual(0);
        expect(rows[quoteIdx + 1]?.text.startsWith("  ")).toBe(true);

        const codeIdx = rows.findIndex((row) => row.text.includes("averyveryvery"));
        expect(codeIdx).toBeGreaterThanOrEqual(0);
        expect(rows[codeIdx + 1]?.text.startsWith("  ")).toBe(true);
        expect(rows.every((row) => row.text.length <= width)).toBe(true);
    });

    it("normalizes markdown row output to single-line rows", () => {
        const message = makeMessage({
            role: "agent",
            content: "- one\n  two\n- three",
        });

        const rows = buildChatRows([message], {
            contentWidth: 80,
            thinkCollapsed: true,
            toolsCollapsed: true,
        });

        expect(rows.every((row) => !row.text.includes("\n"))).toBe(true);
    });

    it("wraps tool box body output and keeps box borders aligned", () => {
        const width = 28;
        const message = makeMessage({
            role: "tool",
            toolData: {
                toolType: "shell",
                label: "very long command label for clipping",
                reasoning: "reasoning line that should wrap with indentation inside the box",
                output: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu",
                success: true,
            },
        });

        const rows = buildChatRows([message], {
            contentWidth: width,
            thinkCollapsed: true,
            toolsCollapsed: false,
        });

        const boxRows = rows.filter((row) => row.kind.startsWith("tool_box_"));
        expect(boxRows.length).toBeGreaterThan(2);
        expect(boxRows.every((row) => row.text.length === width)).toBe(true);

        const outputRows = rows.filter((row) => row.kind === "tool_box_body" && row.tone === "dim");
        expect(outputRows.length).toBeGreaterThan(1);
        expect(outputRows.every((row) => row.text.startsWith("│") && row.text.endsWith("│"))).toBe(true);
        expect(outputRows.slice(1).some((row) => row.text.startsWith("│  "))).toBe(true);
    });

    it("keeps narrow-width safety with fallback clipping behavior", () => {
        expect(clipLine("abcdefghijklmnopqrstuvwxyz", 12)).toBe("abcdefghijk…");
        expect(wrapLineWordFirst("abcdefghijklmnopqrstuvwxyz", 5)).toEqual([
            "abcde",
            "  fgh",
            "  ijk",
            "  lmn",
            "  opq",
            "  rst",
            "  uvw",
            "  xyz",
        ]);
    });

    it("strips markdown control markers from strong-only lines", () => {
        const message = makeMessage({
            role: "agent",
            content: "**From `react`:**\n- useState",
        });

        const rows = buildChatRows([message], {
            contentWidth: 40,
            thinkCollapsed: true,
            toolsCollapsed: true,
        });

        const textRows = rows.map((row) => row.text);
        expect(textRows).toContain("From `react`:");
        expect(textRows.some((row) => row.includes("**"))).toBe(false);
    });

    it("keeps rich segmented rows intact for colored fetch summaries", () => {
        const message = makeMessage({
            role: "system",
            content: "",
            richRows: [{
                segments: [
                    { text: "src/app.ts ", tone: "normal" },
                    { text: "+12 ", tone: "accent" },
                    { text: "-4", tone: "error" },
                ],
            }],
        });

        const rows = buildChatRows([message], {
            contentWidth: 40,
            thinkCollapsed: true,
            toolsCollapsed: true,
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]?.segments).toEqual([
            { text: "src/app.ts ", tone: "normal", bold: undefined, italic: undefined, dimColor: undefined },
            { text: "+12 ", tone: "accent", bold: undefined, italic: undefined, dimColor: undefined },
            { text: "-4", tone: "error", bold: undefined, italic: undefined, dimColor: undefined },
        ]);
        expect(rows[0]?.text).toBe("src/app.ts +12 -4");
    });
});
