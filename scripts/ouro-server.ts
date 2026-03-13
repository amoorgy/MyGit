/**
 * TypeScript OpenAI-compatible server for Ouro-2.6B via MLX.
 *
 * Spawns ouro-worker.py as a subprocess and exposes an OpenAI-compatible HTTP API.
 *
 * Usage:
 *   bun scripts/ouro-server.ts [--model mlx-community/Ouro-2.6B-4bit] [--port 8080] [--host 0.0.0.0]
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── CLI args ───────────────────────────────────────────────────────────
function parseArgs(): Record<string, string> {
    const result: Record<string, string> = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith("--") && i + 1 < argv.length) {
            result[argv[i].slice(2)] = argv[i + 1];
        }
    }
    return result;
}

const args = parseArgs();
const MODEL_ID = args.model ?? "mlx-community/Ouro-2.6B-4bit";
const PORT = parseInt(args.port ?? "8080");
const HOST = args.host ?? "0.0.0.0";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(SCRIPTS_DIR, "ouro-worker.py");
const PYTHON = resolve(SCRIPTS_DIR, ".venv/bin/python3");

// ── Worker process ─────────────────────────────────────────────────────
let worker = Bun.spawn([PYTHON, "-u", WORKER, MODEL_ID], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONWARNINGS: "ignore",
        HF_HUB_DISABLE_PROGRESS_BARS: "1",
        TOKENIZERS_PARALLELISM: "false",
    },
});

let buffer = "";
const decoder = new TextDecoder();
const reader = (worker.stdout as ReadableStream<Uint8Array>).getReader();

async function readLine(): Promise<string> {
    while (true) {
        const nl = buffer.indexOf("\n");
        if (nl !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            return line;
        }
        const { done, value } = await reader.read();
        if (done) throw new Error("Worker exited");
        buffer += decoder.decode(value, { stream: true });
    }
}

// Wait for ready signal
const readyLine = await readLine();
const readyMsg = JSON.parse(readyLine);
if (!readyMsg.ready) throw new Error(`Worker init failed: ${readyLine}`);
console.log(`✓ Worker ready — model: ${readyMsg.model}`);

// ── Inference ──────────────────────────────────────────────────────────
interface Message {
    role: string;
    content: string;
}

async function callModel(messages: Message[], maxTokens: number): Promise<string> {
    const id = Math.random().toString(36).slice(2, 10);
    const req = JSON.stringify({ id, messages, max_tokens: maxTokens }) + "\n";
    worker.stdin.write(req);
    const line = await readLine();
    const resp = JSON.parse(line);
    if (resp.error) throw new Error(resp.error);
    return resp.response as string;
}

// ── HTTP server ────────────────────────────────────────────────────────
const server = Bun.serve({
    port: PORT,
    hostname: HOST,
    async fetch(req) {
        const { pathname } = new URL(req.url);

        if (req.method === "GET" && pathname === "/health") {
            return Response.json({ status: "ok" });
        }

        if (req.method === "GET" && pathname === "/v1/models") {
            return Response.json({
                object: "list",
                data: [{ id: MODEL_ID, object: "model", owned_by: "local" }],
            });
        }

        if (req.method === "POST" && pathname === "/v1/chat/completions") {
            const body = await req.json().catch(() => null);
            if (!body) {
                return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }

            const messages: Message[] = body.messages ?? [];
            const maxTokens: number = body.max_tokens ?? 256;

            const t0 = Date.now();
            const content = await callModel(messages, maxTokens);
            const elapsed = Date.now() - t0;
            console.log(`  → ${elapsed}ms, ${content.length} chars`);

            return Response.json({
                id: `chatcmpl-${Math.random().toString(36).slice(2, 10)}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: body.model ?? MODEL_ID,
                choices: [{
                    index: 0,
                    message: { role: "assistant", content },
                    finish_reason: "stop",
                }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
        }

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`\nServer ready at http://${HOST}:${PORT}`);
console.log(`  POST /v1/chat/completions`);
console.log(`  GET  /v1/models`);
console.log(`  GET  /health`);

process.on("SIGINT", () => {
    worker.kill();
    server.stop();
    process.exit(0);
});
