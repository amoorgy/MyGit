import type { Token } from "marked";
import { parseMarkdownToAST, sanitizeChatText } from "./chatRichText.js";
import type { ChatMessage, ChatMessageTone, ChatRichRow, MessageRole, ToolData } from "./ChatArea.js";

export type ChatRowTone = ChatMessageTone;

export type ChatRowKind =
    | "content"
    | "spacer"
    | "tool_summary"
    | "tool_box_top"
    | "tool_box_body"
    | "tool_box_bottom"
    | "thinking_summary"
    | "thinking_box_top"
    | "thinking_box_body"
    | "thinking_box_bottom";

export interface ChatRow {
    id: string;
    role: MessageRole | "meta";
    gutterRole: MessageRole | null;
    text: string;
    segments?: ChatRowSegment[];
    kind: ChatRowKind;
    tone?: ChatRowTone;
    bold?: boolean;
    italic?: boolean;
    dimColor?: boolean;
}

export interface BuildChatRowsOptions {
    contentWidth: number;
    thinkCollapsed: boolean;
    toolsCollapsed: boolean;
}

interface ChatRowDraft {
    text: string;
    segments?: ChatRowSegment[];
    kind: ChatRowKind;
    tone?: ChatRowTone;
    bold?: boolean;
    italic?: boolean;
    dimColor?: boolean;
}

export interface ChatRowSegment {
    text: string;
    tone?: ChatRowTone;
    bold?: boolean;
    italic?: boolean;
    dimColor?: boolean;
}

interface MarkdownLine {
    text: string;
    indent?: number;
    bold?: boolean;
    italic?: boolean;
    dimColor?: boolean;
    tone?: ChatRowTone;
}

export interface ViewportWindow {
    offset: number;
    maxOffset: number;
    start: number;
    end: number;
    renderStart: number;
    renderEnd: number;
    visibleRows: number;
    aboveRows: number;
    belowRows: number;
}

export interface ResizeOffsetParams {
    previousTotalRows: number;
    nextTotalRows: number;
    oldViewportRows: number;
    newViewportRows: number;
    oldOffset: number;
}

export interface ScrollbarThumb {
    top: number;
    height: number;
}

const DEFAULT_OVERSCAN = 2;
const ELLIPSIS = "…";
export const CONTINUATION_INDENT = 2;
const WHITESPACE_RE = /\s/;

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function clipLine(input: string, width: number): string {
    if (width <= 0) return "";
    if (input.length <= width) return input;
    if (width === 1) return ELLIPSIS;
    return `${input.slice(0, width - 1)}${ELLIPSIS}`;
}

function fitToWidth(input: string, width: number, pad: boolean): string {
    const clipped = clipLine(input, width);
    if (!pad || clipped.length >= width) return clipped;
    return clipped.padEnd(width, " ");
}

export function wrapLineWordFirst(
    input: string,
    width: number,
    continuationIndent: number = CONTINUATION_INDENT,
): string[] {
    if (width <= 0) return [""];
    if (input.length === 0) return [""];

    const output: string[] = [];
    let remaining = input;
    let isContinuation = false;

    while (remaining.length > 0) {
        const effectiveIndent = isContinuation
            ? Math.min(Math.max(0, continuationIndent), Math.max(0, width - 1))
            : 0;
        const prefix = " ".repeat(effectiveIndent);
        const available = Math.max(1, width - effectiveIndent);

        if (remaining.length <= available) {
            output.push(`${prefix}${remaining}`);
            break;
        }

        let splitAt = -1;
        for (let i = available - 1; i > 0; i--) {
            if (WHITESPACE_RE.test(remaining[i])) {
                splitAt = i;
                break;
            }
        }

        if (splitAt > 0) {
            const head = remaining.slice(0, splitAt).trimEnd();
            if (head.length > 0) {
                output.push(`${prefix}${head}`);
                remaining = remaining.slice(splitAt).trimStart();
            } else {
                output.push(`${prefix}${remaining.slice(0, available)}`);
                remaining = remaining.slice(available);
            }
        } else {
            output.push(`${prefix}${remaining.slice(0, available)}`);
            remaining = remaining.slice(available);
        }

        isContinuation = true;
    }

    return output.length > 0 ? output : [""];
}

function splitLines(input: string): string[] {
    return input.split("\n").map((line) => line.replace(/\r/g, ""));
}

function inlineTokenToText(token: Token): string {
    const nested = (token as any).tokens as Token[] | undefined;

    switch (token.type) {
        case "strong":
            return inlineTokensToText(nested);
        case "em":
            return inlineTokensToText(nested);
        case "codespan":
            return `\`${token.text}\``;
        case "link": {
            const inner = inlineTokensToText(nested) || token.text || "link";
            return inner;
        }
        case "br":
            return "\n";
        case "del":
            return inlineTokensToText(nested);
        case "text":
        case "escape":
        case "html":
            return token.text ?? "";
        default:
            return (token as any).text ?? token.raw ?? "";
    }
}

function inlineTokensToText(tokens?: Token[]): string {
    if (!tokens || tokens.length === 0) return "";
    return tokens.map((token) => inlineTokenToText(token)).join("");
}

function listItemToText(item: any): string {
    if (!Array.isArray(item?.tokens) || item.tokens.length === 0) {
        return String(item?.text ?? "");
    }

    const out: string[] = [];
    for (const token of item.tokens as Token[]) {
        if (token.type === "paragraph") {
            const paragraphText = inlineTokensToText((token as any).tokens as Token[] | undefined);
            if (paragraphText) out.push(paragraphText);
            continue;
        }
        if (token.type === "text") {
            if (token.text) out.push(token.text);
            continue;
        }
        const nestedLines = markdownTokenToLines(token);
        if (nestedLines.length > 0) {
            out.push(nestedLines.map((line) => line.text).join(" "));
        }
    }

    return out.join(" ").replace(/\s+/g, " ").trim();
}

function listItemPrimaryLines(item: any): string[] {
    if (!Array.isArray(item?.tokens) || item.tokens.length === 0) {
        const fallback = splitLines(String(item?.text ?? "")).map((line) => line.trimEnd());
        return fallback.length > 0 ? fallback : [""];
    }

    const lines: string[] = [];
    for (const token of item.tokens as Token[]) {
        if (token.type === "paragraph") {
            const text = inlineTokensToText((token as any).tokens as Token[] | undefined) || token.text || "";
            lines.push(...splitLines(text).map((line) => line.trimEnd()));
            continue;
        }
        if (token.type === "text") {
            const text = inlineTokensToText((token as any).tokens as Token[] | undefined) || token.text || "";
            lines.push(...splitLines(text).map((line) => line.trimEnd()));
            continue;
        }
        if (token.type === "space" && lines.length > 0) {
            lines.push("");
        }
    }

    if (lines.length > 0) return lines;

    const fallback = splitLines(String(item?.text ?? "")).map((line) => line.trimEnd());
    return fallback.length > 0 ? fallback : [""];
}

function listTokenToLines(listToken: any, depth: number): MarkdownLine[] {
    const lines: MarkdownLine[] = [];
    const start = Number.isFinite(listToken.start) ? Number(listToken.start) : 1;
    const ordered = Boolean(listToken.ordered);

    listToken.items.forEach((item: any, index: number) => {
        const prefix = ordered ? `${start + index}. ` : "• ";
        const primaryLines = listItemPrimaryLines(item);
        const firstLine = primaryLines[0] ?? "";
        lines.push({
            text: prefixIndent(`${prefix}${firstLine}`.trimEnd(), depth * 2),
        });
        const hangingIndent = " ".repeat(prefix.length);
        for (const continuationLine of primaryLines.slice(1)) {
            const continuationText =
                continuationLine.length > 0
                    ? `${hangingIndent}${continuationLine}`.trimEnd()
                    : "";
            lines.push({
                text: prefixIndent(continuationText, depth * 2),
            });
        }

        if (!Array.isArray(item?.tokens)) return;
        for (const token of item.tokens as Token[]) {
            if (token.type === "list") {
                lines.push(...listTokenToLines(token as any, depth + 1));
                continue;
            }
            if (token.type === "paragraph" || token.type === "text" || token.type === "space") {
                continue;
            }
            const nested = markdownTokenToLines(token, depth + 1);
            if (nested.length > 0) {
                lines.push(...nested);
            }
        }
    });

    return lines;
}

function prefixIndent(text: string, indent: number): string {
    if (indent <= 0) return text;
    return `${" ".repeat(indent)}${text}`;
}

function markdownTokenToLines(token: Token, depth: number = 0): MarkdownLine[] {
    switch (token.type) {
        case "space":
            return [];
        case "heading": {
            const text = inlineTokensToText((token as any).tokens as Token[] | undefined) || token.text;
            return [{
                text: text.trim(),
                bold: true,
            }];
        }
        case "paragraph": {
            const inlineTokens = (token as any).tokens as Token[] | undefined;
            const text = inlineTokensToText(inlineTokens) || token.text || "";
            const onlyStrong = inlineTokens?.length === 1 && inlineTokens[0]?.type === "strong";
            const onlyEm = inlineTokens?.length === 1 && inlineTokens[0]?.type === "em";
            return splitLines(text).map((line) => ({
                text: prefixIndent(line, depth * 2),
                bold: Boolean(onlyStrong),
                italic: Boolean(onlyEm),
            }));
        }
        case "list": {
            return listTokenToLines(token as any, depth);
        }
        case "list_item": {
            const text = listItemToText(token as any);
            return [{ text: prefixIndent(text, depth * 2) }];
        }
        case "code": {
            const codeToken = token as any;
            const lines = splitLines(codeToken.text ?? "");
            const fence = codeToken.lang ? `\`\`\`${codeToken.lang}` : "\`\`\`";
            return [fence, ...lines, "\`\`\`"].map((line) => ({
                text: prefixIndent(line, depth * 2),
            }));
        }
        case "blockquote": {
            const nested = (token as any).tokens as Token[] | undefined;
            if (!nested || nested.length === 0) return [{ text: prefixIndent(">", depth * 2), tone: "muted" }];
            return nested.flatMap((nestedToken) => {
                const lines = markdownTokenToLines(nestedToken, depth + 1);
                return lines.map((line) => ({
                    ...line,
                    text: `> ${line.text}`.trimEnd(),
                    tone: "muted",
                }));
            });
        }
        case "hr":
            return [{ text: prefixIndent("---", depth * 2), tone: "dim" }];
        case "text":
        case "escape":
        case "html":
            return splitLines(token.text ?? "").map((line) => ({ text: prefixIndent(line, depth * 2) }));
        default:
            return splitLines(token.raw ?? (token as any).text ?? "").map((line) => ({ text: prefixIndent(line, depth * 2) }));
    }
}

function markdownToLines(content: string): MarkdownLine[] {
    const tokens = parseMarkdownToAST(content);
    if (tokens.length === 0) return [{ text: "" }];

    const out: MarkdownLine[] = [];
    for (const token of tokens) {
        out.push(...markdownTokenToLines(token, 0));
    }
    const normalized = out.flatMap((line) =>
        splitLines(line.text).map((segment) => ({
            ...line,
            text: segment,
        })),
    );

    return normalized.length > 0 ? normalized : [{ text: "" }];
}

function statusChar(success: boolean | null): string {
    if (success === null) return "…";
    return success ? "✓" : "✗";
}

function getToolDots(output: string | null, success: boolean | null): string {
    if (output === null) return "…";
    if (success === false) return "✗";
    const len = output.length;
    if (len === 0) return "○";
    if (len < 100) return "●";
    if (len < 350) return "●●";
    if (len < 800) return "●●●";
    return "●●●●";
}

function boxTop(width: number, title: string): string {
    if (width <= 0) return "";
    if (width === 1) return "┌";
    if (width === 2) return "┌┐";

    const innerWidth = width - 2;
    const normalizedTitle = title.trim().length > 0 ? ` ${title.trim()} ` : "";
    const inner =
        normalizedTitle.length >= innerWidth
            ? fitToWidth(normalizedTitle, innerWidth, false)
            : `${normalizedTitle}${"─".repeat(innerWidth - normalizedTitle.length)}`;

    return `┌${inner}┐`;
}

function boxBody(width: number, text: string): string {
    if (width <= 0) return "";
    if (width === 1) return "│";
    if (width === 2) return "││";

    const innerWidth = width - 2;
    return `│${fitToWidth(text, innerWidth, true)}│`;
}

function wrapBoxBody(width: number, text: string): string[] {
    if (width <= 0) return [""];
    if (width <= 2) return [boxBody(width, text)];
    const innerWidth = width - 2;

    return wrapLineWordFirst(text, innerWidth, CONTINUATION_INDENT).map((line) =>
        boxBody(width, line),
    );
}

function boxBottom(width: number): string {
    if (width <= 0) return "";
    if (width === 1) return "└";
    if (width === 2) return "└┘";
    return `└${"─".repeat(width - 2)}┘`;
}

function baseRoleTone(role: MessageRole): ChatRowTone {
    switch (role) {
        case "system":
            return "dim";
        case "thinking":
            return "muted";
        default:
            return "normal";
    }
}

function buildToolRows(data: ToolData, width: number, toolsCollapsed: boolean): ChatRowDraft[] {
    const rows: ChatRowDraft[] = [];

    if (data.toolType === "read_file" || data.toolType === "write_file") {
        const icon = data.toolType === "read_file" ? "read" : "write";
        const filePath = data.label ?? "";
        rows.push({
            kind: "tool_summary",
            tone: "muted",
            text: `${icon}  ${filePath}  ${statusChar(data.success)}`.trimEnd(),
        });
        return rows;
    }

    const dots = getToolDots(data.output, data.success);
    const displayLabel = data.label ? `${data.toolType} ${data.label}` : data.toolType;

    if (toolsCollapsed) {
        rows.push({
            kind: "tool_summary",
            tone: "muted",
            text: `${displayLabel} ${dots}`.trimEnd(),
        });
        return rows;
    }

    rows.push({
        kind: "tool_box_top",
        tone: data.success === false ? "error" : "muted",
        text: boxTop(width, `${displayLabel} ${dots}`),
        bold: true,
    });

    const reasoning = sanitizeChatText(data.reasoning ?? "").trimEnd();
    if (reasoning.length > 0) {
        for (const line of splitLines(reasoning)) {
            for (const wrapped of wrapBoxBody(width, `reason: ${line}`)) {
                rows.push({
                    kind: "tool_box_body",
                    tone: "muted",
                    italic: true,
                    text: wrapped,
                });
            }
        }
    }

    if (data.output !== null) {
        const outputLines = splitLines(sanitizeChatText(data.output));
        const rendered = outputLines.length > 0 ? outputLines : ["(no output)"];
        for (const line of rendered) {
            for (const wrapped of wrapBoxBody(width, line.length > 0 ? line : " ")) {
                rows.push({
                    kind: "tool_box_body",
                    tone: data.success === false ? "error" : "dim",
                    text: wrapped,
                });
            }
        }
    } else {
        for (const wrapped of wrapBoxBody(width, "(pending output)")) {
            rows.push({
                kind: "tool_box_body",
                tone: "muted",
                dimColor: true,
                text: wrapped,
            });
        }
    }

    rows.push({
        kind: "tool_box_bottom",
        tone: data.success === false ? "error" : "muted",
        text: boxBottom(width),
    });

    return rows;
}

function buildThinkingRows(content: string, width: number, collapsed: boolean): ChatRowDraft[] {
    const lines = splitLines(content)
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0);

    if (collapsed) {
        const count = lines.length;
        return [{
            kind: "thinking_summary",
            tone: "muted",
            dimColor: true,
            text: `[+] reasoning (${count} line${count === 1 ? "" : "s"})`,
        }];
    }

    const rows: ChatRowDraft[] = [{
        kind: "thinking_box_top",
        tone: "muted",
        dimColor: true,
        text: boxTop(width, "reasoning"),
    }];

    for (const line of lines) {
        for (const wrapped of wrapBoxBody(width, line)) {
            rows.push({
                kind: "thinking_box_body",
                tone: "muted",
                dimColor: true,
                italic: true,
                text: wrapped,
            });
        }
    }

    rows.push({
        kind: "thinking_box_bottom",
        tone: "muted",
        dimColor: true,
        text: boxBottom(width),
    });

    return rows;
}

function buildMessageContentRows(msg: ChatMessage, width: number): ChatRowDraft[] {
    const cleanContent = sanitizeChatText(msg.content);

    if (msg.role === "tool") {
        return buildToolRows(msg.toolData!, width, false);
    }

    if (msg.role === "thinking") {
        return splitLines(cleanContent).map((line) => ({
            kind: "content",
            tone: "muted",
            text: line,
        }));
    }

    const drafts: ChatRowDraft[] = [];

    if ((msg.role === "agent" || msg.role === "system") && cleanContent.length > 0) {
        drafts.push(...markdownToLines(cleanContent).map((line) => ({
            kind: "content" as const,
            tone: line.tone ?? baseRoleTone(msg.role),
            text: line.text,
            bold: line.bold,
            italic: line.italic,
            dimColor: line.dimColor,
        })));
    } else if (cleanContent.length > 0) {
        drafts.push(...splitLines(cleanContent).map((line) => ({
            kind: "content" as const,
            tone: baseRoleTone(msg.role),
            text: line,
        })));
    }

    if (Array.isArray(msg.richRows) && msg.richRows.length > 0) {
        drafts.push(...buildRichRows(msg.richRows));
    }

    return drafts;
}

function buildRichRows(rows: ChatRichRow[]): ChatRowDraft[] {
    return rows.map((row) => {
        const text = row.text ?? (row.segments ?? []).map((segment) => segment.text).join("");
        return {
            kind: "content",
            text,
            segments: row.segments?.map((segment) => ({
                text: segment.text,
                tone: segment.tone,
                bold: segment.bold,
                italic: segment.italic,
                dimColor: segment.dimColor,
            })),
            tone: row.tone,
            bold: row.bold,
            italic: row.italic,
            dimColor: row.dimColor,
        };
    });
}

export function buildChatRows(messages: ChatMessage[], options: BuildChatRowsOptions): ChatRow[] {
    const width = Math.max(1, options.contentWidth);
    const rows: ChatRow[] = [];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const drafts: ChatRowDraft[] = [];

        if (msg.role === "tool") {
            drafts.push(...buildToolRows(msg.toolData!, width, options.toolsCollapsed));
        } else if (msg.role === "thinking") {
            drafts.push(...buildThinkingRows(sanitizeChatText(msg.content), width, options.thinkCollapsed));
        } else {
            drafts.push(...buildMessageContentRows(msg, width));
        }

        if (drafts.length === 0) {
            drafts.push({ kind: "content", text: "", tone: baseRoleTone(msg.role) });
        }

        drafts.forEach((draft, rowIndex) => {
            if (draft.segments && draft.segments.length > 0 && draft.text.length <= width) {
                rows.push({
                    id: `${msg.timestamp}-${i}-${rowIndex}-segments`,
                    role: msg.role,
                    gutterRole: rowIndex === 0 ? msg.role : null,
                    text: draft.text,
                    segments: draft.segments,
                    kind: draft.kind,
                    tone: draft.tone,
                    bold: draft.bold,
                    italic: draft.italic,
                    dimColor: draft.dimColor,
                });
                return;
            }

            const wrappedLines = wrapLineWordFirst(draft.text, width, CONTINUATION_INDENT);
            wrappedLines.forEach((wrapped, wrappedIndex) => {
                rows.push({
                    id: `${msg.timestamp}-${i}-${rowIndex}-${wrappedIndex}`,
                    role: msg.role,
                    gutterRole: rowIndex === 0 && wrappedIndex === 0 ? msg.role : null,
                    text: wrapped.length <= width ? wrapped : clipLine(wrapped, width),
                    kind: draft.kind,
                    tone: draft.tone,
                    bold: draft.bold,
                    italic: draft.italic,
                    dimColor: draft.dimColor,
                });
            });
        });

        if (i < messages.length - 1) {
            rows.push({
                id: `${msg.timestamp}-${i}-spacer`,
                role: "meta",
                gutterRole: null,
                text: "",
                kind: "spacer",
                tone: "muted",
                dimColor: true,
            });
        }
    }

    return rows;
}

export function clampOffset(offset: number, totalRows: number, viewportRows: number): number {
    const maxOffset = Math.max(0, totalRows - Math.max(1, viewportRows));
    return clamp(offset, 0, maxOffset);
}

export function applyScrollDelta(offset: number, delta: number, maxOffset: number): number {
    return clamp(offset + delta, 0, Math.max(0, maxOffset));
}

export function getPageJump(viewportRows: number): number {
    return Math.max(1, viewportRows - 2);
}

export function computeViewportWindow(
    totalRows: number,
    viewportRows: number,
    offsetFromBottom: number,
    overscan: number = DEFAULT_OVERSCAN,
): ViewportWindow {
    const safeViewport = Math.max(1, viewportRows);
    const maxOffset = Math.max(0, totalRows - safeViewport);
    const offset = clamp(offsetFromBottom, 0, maxOffset);

    const end = Math.max(0, totalRows - offset);
    const start = Math.max(0, end - safeViewport);

    const renderStart = Math.max(0, start - Math.max(0, overscan));
    const renderEnd = Math.min(totalRows, end + Math.max(0, overscan));

    return {
        offset,
        maxOffset,
        start,
        end,
        renderStart,
        renderEnd,
        visibleRows: Math.max(0, end - start),
        aboveRows: start,
        belowRows: Math.max(0, totalRows - end),
    };
}

export function computeResizePreservedOffset(params: ResizeOffsetParams): number {
    const prevWindow = computeViewportWindow(
        params.previousTotalRows,
        params.oldViewportRows,
        params.oldOffset,
        0,
    );
    const anchorStart = prevWindow.start;
    const rawOffset = params.nextTotalRows - params.newViewportRows - anchorStart;
    return clampOffset(rawOffset, params.nextTotalRows, params.newViewportRows);
}

export function computeScrollbarThumb(
    totalRows: number,
    viewportRows: number,
    offsetFromBottom: number,
    trackHeight: number,
): ScrollbarThumb {
    const safeTrack = Math.max(1, trackHeight);
    if (totalRows <= 0 || totalRows <= viewportRows) {
        return { top: Math.max(0, safeTrack - 1), height: Math.min(1, safeTrack) };
    }

    const window = computeViewportWindow(totalRows, viewportRows, offsetFromBottom, 0);
    const thumbHeight = clamp(
        Math.round((window.visibleRows / totalRows) * safeTrack),
        1,
        safeTrack,
    );

    const maxStart = Math.max(1, totalRows - Math.max(1, viewportRows));
    const fraction = window.start / maxStart;
    const top = Math.round((safeTrack - thumbHeight) * fraction);

    return {
        top: clamp(top, 0, Math.max(0, safeTrack - thumbHeight)),
        height: thumbHeight,
    };
}
