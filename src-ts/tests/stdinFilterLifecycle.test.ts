import { PassThrough, Writable } from "node:stream";
import { describe, it, expect } from "vitest";
import { cleanupStdinFilter, getStdinFilter, initStdinFilter } from "../tui/stdinFilter.js";

class CaptureStdout extends Writable {
    public data = "";

    _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.data += Buffer.isBuffer(chunk) ? chunk.toString("binary") : String(chunk);
        callback();
    }
}

describe("stdinFilter lifecycle", () => {
    it("enables and disables mouse mode during init/cleanup", () => {
        const stdin = new PassThrough() as any;
        stdin.isTTY = true;
        stdin.isRaw = false;
        stdin.setRawMode = () => {};

        const stdout = new CaptureStdout() as any;

        const filter = initStdinFilter(stdin, stdout, true);
        expect(getStdinFilter()).toBe(filter);
        expect(stdout.data).toContain("\x1b[?1000h");
        expect(stdout.data).toContain("\x1b[?1006h");

        cleanupStdinFilter();
        expect(getStdinFilter()).toBeNull();
        expect(stdout.data).toContain("\x1b[?1000l");
        expect(stdout.data).toContain("\x1b[?1006l");
    });
});
