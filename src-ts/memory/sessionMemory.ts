import * as fs from "fs/promises";
import * as path from "path";
import { execa } from "execa";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export interface SessionTranscriptEntry {
    role: "system" | "user" | "agent" | "tool" | "action" | "thinking";
    content: string;
    toolType?: string;
    toolLabel?: string;
    success?: boolean | null;
}

export interface ProjectMemoryState {
    repoRoot: string;
    last: string;
    next: string;
    recentSessions: string[];
    importedLegacy: boolean;
}

export interface SessionCheckpointOptions {
    repoRoot?: string;
    model?: BaseChatModel;
    transcript?: SessionTranscriptEntry[];
    userNote?: string;
    persist: boolean;
    extraContext?: string[];
}

export interface SessionCheckpointResult {
    repoRoot: string;
    branch: string;
    last: string;
    next: string;
    summary: string;
    persisted: boolean;
    refreshFiles: string[];
}

interface LegacyBrainState {
    timestamp?: string;
    branch?: string;
    summary?: string;
    next_step?: string;
    next_steps?: string;
}

const MEMORY_HEADER = "# mygit Project Memory";
const LATEST_HEADING = "## Latest";
const RECENT_HEADING = "## Recent Sessions";
const RECENT_SESSION_LIMIT = 20;

function canonicalMemoryPath(repoRoot: string): string {
    return path.join(repoRoot, ".mygit", "MYGIT.md");
}

function legacyBrainPath(repoRoot: string): string {
    return path.join(repoRoot, ".mygit", "brain.json");
}

function truncateInline(text: string, maxChars = 180): string {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    return cleaned.length > maxChars
        ? cleaned.slice(0, maxChars - 3).trimEnd() + "..."
        : cleaned;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function readUtf8(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch {
        return null;
    }
}

async function resolveRepoRoot(repoRoot?: string): Promise<string> {
    if (repoRoot) return repoRoot;
    try {
        const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"]);
        return stdout.trim() || process.cwd();
    } catch {
        return process.cwd();
    }
}

async function getGitBranch(repoRoot: string): Promise<string> {
    try {
        const { stdout } = await execa("git", ["branch", "--show-current"], { cwd: repoRoot });
        return stdout.trim() || "unknown";
    } catch {
        return "unknown";
    }
}

async function getGitStatus(repoRoot: string): Promise<string> {
    try {
        const { stdout } = await execa("git", ["status", "--short"], { cwd: repoRoot });
        return stdout.trim();
    } catch {
        return "";
    }
}

function parseActiveFiles(statusOutput: string): string[] {
    return statusOutput
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^([A-Z?]{1,2}|[MADRCU ]{1,2})\s+/, "").trim())
        .filter(Boolean);
}

function extractRefreshFiles(transcript: SessionTranscriptEntry[] | undefined, statusOutput: string): string[] {
    const fromTranscript = (transcript ?? [])
        .flatMap((entry) => {
            const values: string[] = [];
            if (entry.toolType === "read_file" || entry.toolType === "write_file") {
                if (entry.toolLabel) values.push(entry.toolLabel);
                if (entry.content) values.push(entry.content);
            }
            return values;
        })
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .filter((value) => !value.startsWith("$"))
        .filter((value) => !value.includes("\n"))
        .filter((value) => /[./]/.test(value));

    return uniqueStrings([...parseActiveFiles(statusOutput), ...fromTranscript]);
}

function transcriptToPrompt(transcript: SessionTranscriptEntry[] | undefined, maxChars = 5000): string {
    const rendered = (transcript ?? [])
        .map((entry) => {
            if (entry.role === "tool") {
                const label = entry.toolLabel ? ` ${entry.toolLabel}` : "";
                const status = entry.success === false ? " failed" : entry.success === true ? " succeeded" : "";
                return `[tool:${entry.toolType ?? "unknown"}${label}${status}] ${entry.content}`;
            }
            return `[${entry.role}] ${entry.content}`;
        })
        .join("\n");

    if (rendered.length <= maxChars) return rendered;
    return rendered.slice(0, maxChars - 3).trimEnd() + "...";
}

function fallbackCheckpointSummary(args: {
    branch: string;
    statusOutput: string;
    transcript?: SessionTranscriptEntry[];
    userNote?: string;
}): { last: string; next: string } {
    const activeFiles = parseActiveFiles(args.statusOutput);
    const lastTool = [...(args.transcript ?? [])]
        .reverse()
        .find((entry) => entry.role === "tool" && entry.toolLabel);
    const lastAgentOrUser = [...(args.transcript ?? [])]
        .reverse()
        .find((entry) => entry.role === "agent" || entry.role === "user");

    const last = args.userNote
        ? truncateInline(args.userNote, 140)
        : lastTool?.toolLabel
            ? `Worked on ${truncateInline(lastTool.toolLabel, 120)}`
            : lastAgentOrUser?.content
                ? truncateInline(lastAgentOrUser.content, 140)
                : "Reviewed the current repository state.";

    const next = activeFiles.length > 0
        ? `Continue with ${truncateInline(activeFiles.slice(0, 3).join(", "), 140)}.`
        : args.branch && args.branch !== "unknown"
            ? `Continue work on branch ${args.branch}.`
            : "Review the current git status and continue.";

    return { last, next };
}

function modelContentToString(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") return part;
                if (part && typeof part === "object" && "text" in part) {
                    const text = (part as { text?: unknown }).text;
                    return typeof text === "string" ? text : JSON.stringify(part);
                }
                return JSON.stringify(part);
            })
            .join("\n");
    }
    return String(content ?? "");
}

function parseSummaryOutput(raw: string, fallback: { last: string; next: string }): { last: string; next: string; summary: string } {
    const cleaned = raw.trim();
    let last = "";
    let next = "";

    if (cleaned.startsWith("{")) {
        try {
            const parsed = JSON.parse(cleaned) as Record<string, unknown>;
            const parsedLast = parsed.last ?? parsed.summary;
            const parsedNext = parsed.next ?? parsed.next_step ?? parsed.next_steps;
            if (typeof parsedLast === "string") last = parsedLast.trim();
            if (typeof parsedNext === "string") next = parsedNext.trim();
        } catch {
            // Fall through to line parsing.
        }
    }

    if (!last) {
        const match = cleaned.match(/(?:^|\n)Last:\s*(.+)/i);
        if (match) last = match[1].trim();
    }
    if (!next) {
        const match = cleaned.match(/(?:^|\n)Next:\s*(.+)/i);
        if (match) next = match[1].trim();
    }

    if (!last || !next) {
        const lines = cleaned
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
        if (!last && lines[0]) last = lines[0].replace(/^[-*]\s*/, "");
        if (!next && lines[1]) next = lines[1].replace(/^[-*]\s*/, "");
    }

    last = truncateInline(last || fallback.last, 240);
    next = truncateInline(next || fallback.next, 240);
    return {
        last,
        next,
        summary: `Last: ${last}\nNext: ${next}`,
    };
}

async function summarizeCheckpoint(args: {
    model?: BaseChatModel;
    branch: string;
    statusOutput: string;
    transcript?: SessionTranscriptEntry[];
    userNote?: string;
    extraContext?: string[];
}): Promise<{ last: string; next: string; summary: string }> {
    const fallback = fallbackCheckpointSummary(args);
    if (!args.model) {
        return parseSummaryOutput("", fallback);
    }

    const prompt = [
        `Branch: ${args.branch}`,
        `Git Status:\n${args.statusOutput || "(clean)"}`,
        args.userNote ? `User Note:\n${args.userNote}` : "",
        args.transcript && args.transcript.length > 0 ? `Transcript:\n${transcriptToPrompt(args.transcript)}` : "",
        ...(args.extraContext ?? []).map((section) => section.trim()).filter(Boolean),
        "Return exactly two short lines in plain text:",
        "Last: <what was accomplished>",
        "Next: <what should happen next>",
    ].filter(Boolean).join("\n\n");

    try {
        const response = await args.model.invoke([
            new SystemMessage("You summarize mygit development checkpoints. Be concise and concrete. Output only two lines: `Last:` and `Next:`."),
            new HumanMessage(prompt),
        ]);
        return parseSummaryOutput(modelContentToString(response.content), fallback);
    } catch {
        return parseSummaryOutput("", fallback);
    }
}

function formatRecentSessionLine(timestamp: string, branch: string, last: string, next: string, userNote?: string): string {
    const note = userNote ? ` | Note: ${truncateInline(userNote, 80)}` : "";
    return `- ${timestamp} [${branch || "unknown"}] Last: ${truncateInline(last, 120)} | Next: ${truncateInline(next, 120)}${note}`;
}

function renderProjectMemory(last: string, next: string, recentSessions: string[]): string {
    const recentBlock = recentSessions.length > 0
        ? recentSessions.join("\n")
        : "- none";

    return [
        MEMORY_HEADER,
        "",
        LATEST_HEADING,
        `Last: ${last}`,
        `Next: ${next}`,
        "",
        RECENT_HEADING,
        recentBlock,
        "",
    ].join("\n");
}

function parseProjectMemory(raw: string, repoRoot: string): ProjectMemoryState {
    const latestBlock = raw.match(/## Latest\s*\n([\s\S]*?)(?:\n## Recent Sessions|$)/i)?.[1] ?? "";
    const last = latestBlock.match(/(?:^|\n)Last:\s*(.+)/i)?.[1]?.trim() ?? "";
    const next = latestBlock.match(/(?:^|\n)Next:\s*(.+)/i)?.[1]?.trim() ?? "";

    const recentBlock = raw.match(/## Recent Sessions\s*\n([\s\S]*)$/i)?.[1] ?? "";
    const recentSessions = recentBlock
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "));

    return {
        repoRoot,
        last,
        next,
        recentSessions,
        importedLegacy: false,
    };
}

async function persistProjectMemory(repoRoot: string, last: string, next: string, recentSessions: string[]): Promise<void> {
    const filePath = canonicalMemoryPath(repoRoot);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, renderProjectMemory(last, next, recentSessions), "utf-8");
}

async function importLegacyBrainState(repoRoot: string): Promise<ProjectMemoryState | null> {
    const raw = await readUtf8(legacyBrainPath(repoRoot));
    if (!raw) return null;

    try {
        const legacy = JSON.parse(raw) as LegacyBrainState;
        const last = truncateInline(legacy.summary ?? "", 240);
        const next = truncateInline(legacy.next_step ?? legacy.next_steps ?? "", 240);
        if (!last && !next) return null;

        const timestamp = legacy.timestamp ?? new Date().toISOString();
        const branch = legacy.branch?.trim() || "unknown";
        const recentSessions = [formatRecentSessionLine(timestamp, branch, last || "Imported legacy memory.", next || "Resume from current git status.")];
        await persistProjectMemory(repoRoot, last || "Imported legacy memory.", next || "Resume from current git status.", recentSessions);
        return {
            repoRoot,
            last: last || "Imported legacy memory.",
            next: next || "Resume from current git status.",
            recentSessions,
            importedLegacy: true,
        };
    } catch {
        return null;
    }
}

export async function loadProjectMemory(repoRoot?: string): Promise<ProjectMemoryState> {
    const resolvedRepoRoot = await resolveRepoRoot(repoRoot);
    const raw = await readUtf8(canonicalMemoryPath(resolvedRepoRoot));
    if (raw) {
        return parseProjectMemory(raw, resolvedRepoRoot);
    }

    const imported = await importLegacyBrainState(resolvedRepoRoot);
    if (imported) return imported;

    return {
        repoRoot: resolvedRepoRoot,
        last: "",
        next: "",
        recentSessions: [],
        importedLegacy: false,
    };
}

export async function createSessionCheckpoint(options: SessionCheckpointOptions): Promise<SessionCheckpointResult> {
    const repoRoot = await resolveRepoRoot(options.repoRoot);
    const [branch, statusOutput] = await Promise.all([
        getGitBranch(repoRoot),
        getGitStatus(repoRoot),
    ]);

    const { last, next, summary } = await summarizeCheckpoint({
        model: options.model,
        branch,
        statusOutput,
        transcript: options.transcript,
        userNote: options.userNote,
        extraContext: options.extraContext,
    });

    const refreshFiles = extractRefreshFiles(options.transcript, statusOutput);
    let persisted = false;

    if (options.persist) {
        const existing = await loadProjectMemory(repoRoot);
        const recentLine = formatRecentSessionLine(new Date().toISOString(), branch, last, next, options.userNote);
        const recentSessions = uniqueStrings([recentLine, ...existing.recentSessions]).slice(0, RECENT_SESSION_LIMIT);
        await persistProjectMemory(repoRoot, last, next, recentSessions);
        persisted = true;
    }

    return {
        repoRoot,
        branch,
        last,
        next,
        summary,
        persisted,
        refreshFiles,
    };
}

export async function buildPortableMemoryPack(repoRoot?: string): Promise<string> {
    const resolvedRepoRoot = await resolveRepoRoot(repoRoot);
    const memory = await loadProjectMemory(resolvedRepoRoot);
    if (!memory.last && !memory.next && memory.recentSessions.length === 0) {
        return "";
    }

    const [branch, statusOutput] = await Promise.all([
        getGitBranch(resolvedRepoRoot),
        getGitStatus(resolvedRepoRoot),
    ]);

    return [
        `# Development Context: ${branch || "unknown"}`,
        "",
        "## Latest Memory",
        `Last: ${memory.last || "No recent session memory recorded."}`,
        `Next: ${memory.next || "Resume from the current git status."}`,
        "",
        "## Recent Sessions",
        memory.recentSessions.length > 0 ? memory.recentSessions.slice(0, 5).join("\n") : "- none",
        "",
        "## Working Tree Status",
        statusOutput || "(clean)",
        "",
    ].join("\n");
}
