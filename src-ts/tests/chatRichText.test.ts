import { describe, it, expect } from "vitest";
import { parseMarkdownToAST, sanitizeChatText } from "../tui/components/chatRichText.js";

describe("chatRichText", () => {
    it("parses a plain paragraph", () => {
        const tokens = parseMarkdownToAST("hello world");
        expect(tokens.length).toBe(1);
        expect(tokens[0].type).toBe("paragraph");
        if (tokens[0].type === "paragraph") {
            expect(tokens[0].text).toBe("hello world");
        }
    });

    it("parses fenced code blocks with language", () => {
        const tokens = parseMarkdownToAST("Before\n\n```ts\nconst x = 1;\n```\n\nAfter");
        expect(tokens.length).toBe(3);
        expect(tokens[0].type).toBe("paragraph");
        expect(tokens[1].type).toBe("code");
        if (tokens[1].type === "code") {
            expect(tokens[1].lang).toBe("ts");
            expect(tokens[1].text).toBe("const x = 1;");
        }
        expect(tokens[2].type).toBe("paragraph");
    });

    it("parses mixed list content", () => {
        const tokens = parseMarkdownToAST("Intro\n\n- one\n- two\n\n1. alpha\n2. beta");
        expect(tokens.length).toBe(3);
        expect(tokens[0].type).toBe("paragraph");
        expect(tokens[1].type).toBe("list");
        if (tokens[1].type === "list") {
            expect(tokens[1].ordered).toBe(false);
            expect(tokens[1].items.length).toBe(2);
        }
        expect(tokens[2].type).toBe("list");
        if (tokens[2].type === "list") {
            expect(tokens[2].ordered).toBe(true);
            expect(tokens[2].start).toBe(1);
            expect(tokens[2].items.length).toBe(2);
        }
    });

    it("sanitizes ansi and mouse fragments", () => {
        const dirty = "\u001b[31mred\u001b[0m and <64;46;14M clean";
        expect(sanitizeChatText(dirty)).toBe("red and  clean");
    });
});


