/**
 * Lightweight rich-text parsing for Ink chat messages.
 * Supports fenced code blocks, paragraphs, and basic list blocks.
 */

import { marked, Token } from "marked";

const ANSI_ESCAPE_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const MOUSE_FRAGMENT_RE = /(?:\x1b)?\[?<\d+;\d+;\d+[Mm]/g;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sanitizeChatText(input: string): string {
    return input
        .replace(/\r\n?/g, "\n")
        .replace(ANSI_ESCAPE_RE, "")
        .replace(MOUSE_FRAGMENT_RE, "")
        .replace(CONTROL_RE, "");
}

export function parseMarkdownToAST(input: string): Token[] {
    return marked.lexer(input).filter(t => t.type !== "space");
}

