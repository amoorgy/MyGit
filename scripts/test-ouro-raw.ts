/**
 * TypeScript equivalent of test-ouro-raw.py.
 *
 * Spawns the MLX worker directly (no HTTP layer), sends one message,
 * prints the response, and exits. The model is loaded once per run.
 *
 * Usage:
 *   bun scripts/test-ouro-raw.ts [--model mlx-community/Ouro-2.6B-4bit]
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── CLI args ───────────────────────────────────────────────────────────
function parseArgs(): Record<string, string> {
    const result: Record<string, string> = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length - 1; i++) {
        if (argv[i].startsWith("--")) result[argv[i].slice(2)] = argv[i + 1];
    }
    return result;
}
const args = parseArgs();
const MODEL_ID = args.model ?? "mlx-community/Ouro-2.6B-4bit";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(SCRIPTS_DIR, "ouro-worker.py");
const PYTHON = resolve(SCRIPTS_DIR, ".venv/bin/python3");

// ── Spawn worker ───────────────────────────────────────────────────────
console.log(`Testing ${MODEL_ID}…`);

const worker = Bun.spawn([PYTHON, "-u", WORKER, MODEL_ID], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
});

const reader = (worker.stdout as ReadableStream<Uint8Array>).getReader();
const decoder = new TextDecoder();
let buffer = "";

async function readLine(): Promise<string> {
    while (true) {
        const nl = buffer.indexOf("\n");
        if (nl !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            return line;
        }
        const { done, value } = await reader.read();
        if (done) throw new Error("Worker exited before responding");
        buffer += decoder.decode(value, { stream: true });
    }
}

// Wait for ready
const readyLine = await readLine();
const ready = JSON.parse(readyLine);
if (!ready.ready) {
    console.error("Worker failed to start:", readyLine);
    worker.kill();
    process.exit(1);
}

// ── Single inference ───────────────────────────────────────────────────
const PROMPT = "Explain git merge conflict in one sentence";
const messages = [{ role: "user", content: PROMPT }];

const t0 = Date.now();
worker.stdin.write(JSON.stringify({ id: "test", messages, max_tokens: 64 }) + "\n");
const respLine = await readLine();
const elapsed = Date.now() - t0;

const resp = JSON.parse(respLine);

console.log("=".repeat(10));
if (resp.error) {
    console.error("Error:", resp.error);
    worker.kill();
    process.exit(1);
}

console.log(`Response (${elapsed}ms): ${resp.response}`);
console.log("=".repeat(10));
console.log("\n✓ Ouro model works via mlx_lm!");

worker.kill();
