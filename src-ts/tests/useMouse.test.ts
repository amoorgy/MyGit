import { describe, expect, it } from "vitest";
import { stripMouseSequencesFromBuffer } from "../tui/stdinFilter.js";

describe("useMouse stripping", () => {
    it("removes SGR click press/release sequences and preserves text", () => {
        const chunk = Buffer.from("hello\x1b[<0;60;26M\x1b[<0;60;26m world");
        const result = stripMouseSequencesFromBuffer(chunk);

        expect(result.filtered.toString()).toBe("hello world");
        expect(result.pending.length).toBe(0);
        expect(result.scrollEvents).toEqual([]);
    });

    it("buffers incomplete SGR mouse packets across chunks", () => {
        const first = stripMouseSequencesFromBuffer(Buffer.from("a\x1b[<65;10;20"));
        expect(first.filtered.toString()).toBe("a");
        expect(first.pending.toString("ascii")).toBe("\x1b[<65;10;20");
        expect(first.scrollEvents).toEqual([]);

        const second = stripMouseSequencesFromBuffer(Buffer.from("Mb"), first.pending);
        expect(second.filtered.toString()).toBe("b");
        expect(second.pending.length).toBe(0);
        expect(second.scrollEvents).toEqual([{ direction: "down", x: 10, y: 20 }]);
    });

    it("removes legacy X10 click packets (non-SGR terminals)", () => {
        // ESC [ M + encoded cb/x/y bytes (+32 offset)
        const x10Click = Buffer.from([0x1b, 0x5b, 0x4d, 32, 72, 58]); // cb=0, x=40, y=26
        const chunk = Buffer.concat([Buffer.from("x"), x10Click, Buffer.from("y")]);
        const result = stripMouseSequencesFromBuffer(chunk);

        expect(result.filtered.toString()).toBe("xy");
        expect(result.pending.length).toBe(0);
        expect(result.scrollEvents).toEqual([]);
    });

    it("does not swallow a normal Escape keypress", () => {
        const result = stripMouseSequencesFromBuffer(Buffer.from([0x1b]));
        expect(result.filtered.equals(Buffer.from([0x1b]))).toBe(true);
        expect(result.pending.length).toBe(0);
    });
});
