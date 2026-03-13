/**
 * Tests for IDE environment detection.
 */

import { describe, it, expect, afterEach } from "vitest";
import { detectIDE, isIDEAvailable } from "../tui/ide.js";

describe("detectIDE", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        // Restore original env
        process.env = { ...originalEnv };
    });

    it("detects VS Code via TERM_PROGRAM", () => {
        process.env.TERM_PROGRAM = "vscode";
        delete process.env.CURSOR_TRACE_ID;
        expect(detectIDE()).toBe("vscode");
    });

    it("detects VS Code via VSCODE_PID", () => {
        delete process.env.TERM_PROGRAM;
        delete process.env.CURSOR_TRACE_ID;
        process.env.VSCODE_PID = "12345";
        expect(detectIDE()).toBe("vscode");
    });

    it("detects VS Code via VSCODE_GIT_IPC_HANDLE", () => {
        delete process.env.TERM_PROGRAM;
        delete process.env.CURSOR_TRACE_ID;
        delete process.env.VSCODE_PID;
        process.env.VSCODE_GIT_IPC_HANDLE = "/tmp/vscode-ipc";
        expect(detectIDE()).toBe("vscode");
    });

    it("detects Cursor via CURSOR_TRACE_ID", () => {
        process.env.CURSOR_TRACE_ID = "abc123";
        expect(detectIDE()).toBe("cursor");
    });

    it("detects Cursor via TERM_PROGRAM", () => {
        process.env.TERM_PROGRAM = "cursor";
        delete process.env.CURSOR_TRACE_ID;
        expect(detectIDE()).toBe("cursor");
    });

    it("Cursor takes priority over VS Code", () => {
        process.env.CURSOR_TRACE_ID = "abc123";
        process.env.VSCODE_PID = "12345";
        expect(detectIDE()).toBe("cursor");
    });

    it("detects Antigravity via ANTIGRAVITY_EDITOR", () => {
        delete process.env.CURSOR_TRACE_ID;
        delete process.env.VSCODE_PID;
        delete process.env.VSCODE_GIT_IPC_HANDLE;
        process.env.ANTIGRAVITY_EDITOR = "true";
        process.env.TERM_PROGRAM = "antigravity";
        expect(detectIDE()).toBe("antigravity");
    });

    it("returns terminal when no IDE detected", () => {
        delete process.env.TERM_PROGRAM;
        delete process.env.CURSOR_TRACE_ID;
        delete process.env.VSCODE_PID;
        delete process.env.VSCODE_GIT_IPC_HANDLE;
        delete process.env.ANTIGRAVITY_EDITOR;
        expect(detectIDE()).toBe("terminal");
    });
});

describe("isIDEAvailable", () => {
    it("returns true for vscode", () => {
        expect(isIDEAvailable("vscode")).toBe(true);
    });

    it("returns true for cursor", () => {
        expect(isIDEAvailable("cursor")).toBe(true);
    });

    it("returns true for antigravity", () => {
        expect(isIDEAvailable("antigravity")).toBe(true);
    });

    it("returns false for terminal", () => {
        expect(isIDEAvailable("terminal")).toBe(false);
    });
});
