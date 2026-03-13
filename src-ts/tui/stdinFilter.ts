/**
 * stdinFilter — Node.js Transform stream that strips mouse escape sequences
 * from stdin before they reach Ink, and emits scroll/shiftTab events.
 *
 * Architecture: instead of patching stdin.emit (fragile, race-prone), we
 * sit a Transform stream between process.stdin and Ink's render(). Bytes are
 * filtered at the stream level, so Ink never sees raw mouse sequences.
 *
 * Usage:
 *   const filter = initStdinFilter(process.stdin, process.stdout, mouseEnabled);
 *   render(<App />, { stdin: filter.proxy });
 *   // subscribers call getStdinFilter().events.on('scroll', ...)
 */

import { Transform } from "node:stream";
import { EventEmitter } from "node:events";

// ============================================================================
// TYPES
// ============================================================================

export interface ScrollEvent {
    direction: "up" | "down";
    x: number;
    y: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1000l\x1b[?1006l";
const EMPTY_BUFFER = Buffer.alloc(0);
const SHIFT_TAB_SEQ = Buffer.from([0x1b, 0x5b, 0x5a]);

// ============================================================================
// PARSING HELPERS
// ============================================================================

function isDigitByte(byte: number): boolean {
    return byte >= 48 && byte <= 57;
}

function isScrollCode(code: number): boolean {
    return (code & 64) === 64 && ((code & 3) === 0 || (code & 3) === 1);
}

function scrollDirectionFromCode(code: number): "up" | "down" {
    return (code & 1) === 0 ? "up" : "down";
}

interface ParsedSequence {
    end: number;
    event: ScrollEvent | null;
}

function parseSgrMouseSequence(
    buffer: Buffer,
    start: number,
): ParsedSequence | "incomplete" | null {
    if (buffer[start] !== 0x1b) return null;
    // A lone ESC is the Escape key — not a sequence start.
    if (start + 1 >= buffer.length) return null;
    if (buffer[start + 1] !== 0x5b) return null;
    // ESC [ alone may be the beginning of a split sequence.
    if (start + 2 >= buffer.length) return "incomplete";
    if (buffer[start + 2] !== 0x3c) return null;

    let i = start + 3;
    while (i < buffer.length && (isDigitByte(buffer[i]) || buffer[i] === 0x3b)) {
        i++;
    }
    if (i >= buffer.length) return "incomplete";

    const terminator = buffer[i];
    if (terminator !== 0x4d && terminator !== 0x6d) return null;

    const ascii = buffer.toString("ascii", start, i + 1);
    const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(ascii);
    if (!match) return null;

    const code = Number.parseInt(match[1], 10);
    const x = Number.parseInt(match[2], 10);
    const y = Number.parseInt(match[3], 10);
    const isPress = match[4] === "M";

    return {
        end: i + 1,
        event:
            isPress && isScrollCode(code)
                ? { direction: scrollDirectionFromCode(code), x, y }
                : null,
    };
}

function parseX10MouseSequence(
    buffer: Buffer,
    start: number,
): ParsedSequence | "incomplete" | null {
    if (buffer[start] !== 0x1b) return null;
    if (start + 1 >= buffer.length) return null; // lone ESC: not a sequence
    if (buffer[start + 1] !== 0x5b) return null;
    if (start + 2 >= buffer.length) return "incomplete";
    if (buffer[start + 2] !== 0x4d) return null; // ESC [ M
    if (start + 6 > buffer.length) return "incomplete";

    const cb = buffer[start + 3] - 32;
    const x = Math.max(0, buffer[start + 4] - 32);
    const y = Math.max(0, buffer[start + 5] - 32);

    return {
        end: start + 6,
        event: isScrollCode(cb)
            ? { direction: scrollDirectionFromCode(cb), x, y }
            : null,
    };
}

// ============================================================================
// EXPORTED PARSING HELPER (used by tests and _transform)
// ============================================================================

interface MouseChunkResult {
    filtered: Buffer;
    pending: Buffer;
    scrollEvents: ScrollEvent[];
}

/**
 * Process a raw stdin chunk: strip mouse sequences, accumulate pending bytes,
 * and return filtered output plus any detected scroll events.
 */
export function stripMouseSequencesFromBuffer(
    incoming: Buffer,
    pending: Buffer = EMPTY_BUFFER,
): MouseChunkResult {
    const buffer =
        pending.length > 0 ? Buffer.concat([pending, incoming]) : incoming;

    if (buffer.length === 0) {
        return { filtered: EMPTY_BUFFER, pending: EMPTY_BUFFER, scrollEvents: [] };
    }

    const scrollEvents: ScrollEvent[] = [];
    const kept: Buffer[] = [];
    let copyStart = 0;
    let i = 0;
    let pendingStart = -1;

    while (i < buffer.length) {
        if (buffer[i] !== 0x1b) {
            i++;
            continue;
        }

        let parsed = parseSgrMouseSequence(buffer, i);
        if (parsed === "incomplete") {
            pendingStart = i;
            break;
        }
        if (parsed === null) {
            parsed = parseX10MouseSequence(buffer, i);
            if (parsed === "incomplete") {
                pendingStart = i;
                break;
            }
        }
        if (!parsed) {
            i++;
            continue;
        }

        if (i > copyStart) kept.push(buffer.subarray(copyStart, i));
        if (parsed.event) scrollEvents.push(parsed.event);
        i = parsed.end;
        copyStart = parsed.end;
    }

    const completeEnd = pendingStart >= 0 ? pendingStart : buffer.length;
    if (copyStart < completeEnd) kept.push(buffer.subarray(copyStart, completeEnd));

    const filtered =
        kept.length === 0
            ? EMPTY_BUFFER
            : kept.length === 1
              ? kept[0]
              : Buffer.concat(kept);

    return {
        filtered,
        pending: pendingStart >= 0 ? buffer.subarray(pendingStart) : EMPTY_BUFFER,
        scrollEvents,
    };
}

// ============================================================================
// TRANSFORM STREAM
// ============================================================================

/**
 * StdinFilter extends Transform so it can be used as a drop-in stdin
 * replacement for Ink. It intercepts raw terminal bytes, strips mouse escape
 * sequences, and forwards only clean input downstream.
 *
 * Call setRawMode/isTTY are proxied via the init factory below.
 */
export class StdinFilter extends Transform {
    public isTTY: boolean;
    public isRaw: boolean;

    readonly events = new EventEmitter();

    private _pending: Buffer = EMPTY_BUFFER;
    private _realStdin: NodeJS.ReadStream;

    constructor(realStdin: NodeJS.ReadStream) {
        super();
        this._realStdin = realStdin;
        this.isTTY = !!realStdin.isTTY;
        this.isRaw = !!(realStdin as any).isRaw;
    }

    /** Proxy setRawMode to the real stdin so Ink can enable raw mode. */
    setRawMode(mode: boolean): this {
        (this._realStdin as any).setRawMode?.(mode);
        this.isRaw = mode;
        return this;
    }

    /** Proxy ref/unref so Ink can keep the process alive correctly. */
    ref() {
        (this._realStdin as any).ref?.();
        return this;
    }

    unref() {
        (this._realStdin as any).unref?.();
        return this;
    }

    _transform(
        chunk: Buffer,
        _encoding: string,
        callback: () => void,
    ): void {
        const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        const result = stripMouseSequencesFromBuffer(incoming, this._pending);
        this._pending = result.pending;

        let filtered = result.filtered;

        // Strip Shift+Tab sequences
        const seqLen = SHIFT_TAB_SEQ.length;
        let shiftTabCount = 0;
        const stKept: Buffer[] = [];
        let stCopyStart = 0;
        let j = 0;

        while (j <= filtered.length - seqLen) {
            if (
                filtered[j] === 0x1b &&
                filtered[j + 1] === 0x5b &&
                filtered[j + 2] === 0x5a
            ) {
                if (j > stCopyStart) stKept.push(filtered.subarray(stCopyStart, j));
                shiftTabCount++;
                j += seqLen;
                stCopyStart = j;
            } else {
                j++;
            }
        }

        if (shiftTabCount > 0) {
            if (stCopyStart < filtered.length) stKept.push(filtered.subarray(stCopyStart));
            filtered =
                stKept.length === 0
                    ? EMPTY_BUFFER
                    : stKept.length === 1
                      ? stKept[0]
                      : Buffer.concat(stKept);
        }

        // Emit events before pushing so callbacks fire before Ink sees data
        for (const evt of result.scrollEvents) {
            this.events.emit("scroll", evt);
        }
        for (let k = 0; k < shiftTabCount; k++) {
            this.events.emit("shiftTab");
        }

        if (filtered.length > 0) this.push(filtered);
        callback();
    }

    _flush(callback: () => void): void {
        if (this._pending.length > 0) {
            this.push(this._pending);
            this._pending = EMPTY_BUFFER;
        }
        callback();
    }
}

// ============================================================================
// MODULE-LEVEL SINGLETON
// ============================================================================

let _filter: StdinFilter | null = null;
let _stdout: NodeJS.WriteStream | null = null;
let _stdin: NodeJS.ReadStream | null = null;
let _mouseEnabled = false;
let _exitHookInstalled = false;

/** Get the active filter (available in React hooks after initStdinFilter). */
export function getStdinFilter(): StdinFilter | null {
    return _filter;
}

/**
 * Create and wire the stdin filter.
 * Call this BEFORE Ink's render().
 * Returns the filter as a stdin-compatible stream to pass to render().
 */
export function initStdinFilter(
    stdin: NodeJS.ReadStream,
    stdout: NodeJS.WriteStream,
    mouseEnabled: boolean,
): StdinFilter {
    if (_filter) return _filter; // idempotent

    const filter = new StdinFilter(stdin);
    _filter = filter;
    _stdout = stdout;
    _stdin = stdin;
    _mouseEnabled = mouseEnabled;

    // Pipe real stdin bytes through the filter
    stdin.pipe(filter);

    if (mouseEnabled) {
        stdout.write(ENABLE_MOUSE);
    }

    // Ensure mouse mode is disabled even on abrupt exits (e.g. render crash).
    if (!_exitHookInstalled) {
        process.once("exit", () => {
            cleanupStdinFilter();
        });
        _exitHookInstalled = true;
    }

    return filter;
}

/** Disable mouse mode and release the singleton. */
export function cleanupStdinFilter(): void {
    if (_stdin && _filter) {
        _stdin.unpipe(_filter);
        _filter.removeAllListeners();
        _filter.events.removeAllListeners();
    }
    if (_stdout && _mouseEnabled) {
        _stdout.write(DISABLE_MOUSE);
    }
    _filter = null;
    _stdin = null;
    _stdout = null;
    _mouseEnabled = false;
}
