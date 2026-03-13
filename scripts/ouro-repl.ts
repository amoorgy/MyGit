/**
 * Interactive REPL for the Ouro server.
 *
 * Usage:
 *   bun scripts/ouro-repl.ts [--url http://localhost:8080] [--max-tokens 256]
 *
 * Commands:
 *   /clear    — wipe conversation history
 *   /quit     — exit
 */

import * as readline from "node:readline";

// ── MyGit Agent System Prompt ───────────────────────────────────────────
const DEFAULT_SYSTEM_PROMPT = `You are MyGit Agent, an AI-powered repository workspace assistant.
You operate inside an iterative action loop: you emit one action, observe the result, then decide the next. You are NOT a chatbot — you are an executor.

## OUTPUT FORMAT (STRICT — follow exactly)

Return exactly ONE JSON object per response. No markdown fences, no extra text, no commentary outside the JSON.

Required structure:
{
  "reasoning": "1-2 sentence explanation of what you are doing and why",
  "action": { "type": "<action_type>", ...fields }
}

## ACTION TYPES

Execute a git command: {"type": "git", "command": "status"}
Execute a shell command: {"type": "shell", "command": "ls -la"}
Read a file: {"type": "read_file", "path": "src/main.rs"}
Write a file: {"type": "write_file", "path": "config.toml", "content": "..."}
Send a message: {"type": "message", "content": "Working on it..."}
Signal completion: {"type": "done", "summary": "Task completed"}
Respond to user: {"type": "respond", "answer": "The current branch is main"}
Ask for clarification: {"type": "clarify", "question": "Which branch?"}
Propose a plan: {"type": "plan", "steps": [{"description": "Step 1"}]}

## BEHAVIORAL RULES

1. Gather before you act: always check git status/diff before making changes.
2. One action per response: never combine multiple actions.
3. Prefer execution over planning: if you know the next step, do it.
4. Use "done" immediately when finished.
5. Stay within the repository: all file paths are relative to the repo root.`;

// ── CLI args ───────────────────────────────────────────────────────────
function parseArgs(): Record<string, string> {
    const result: Record<string, string> = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith("--") && i + 1 < argv.length) {
            result[argv[i].slice(2)] = argv[++i];
        }
    }
    return result;
}

const args = parseArgs();
const SERVER = args.url ?? "http://localhost:8080";
const MAX_TOKENS = parseInt(args["max-tokens"] ?? "512");
const MODEL = args.model ?? "mlx-community/Ouro-2.6B-4bit";

// ── State ──────────────────────────────────────────────────────────────
type Msg = { role: string; content: string };
const history: Msg[] = [{ role: "system", content: DEFAULT_SYSTEM_PROMPT }];

// ── Check server ───────────────────────────────────────────────────────
async function checkServer(): Promise<boolean> {
    try {
        const res = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(2000) });
        return res.ok;
    } catch {
        return false;
    }
}

// ── Call model ─────────────────────────────────────────────────────────
async function chat(userMsg: string): Promise<void> {
    history.push({ role: "user", content: userMsg });

    const t0 = Date.now();
    const res = await fetch(`${SERVER}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages: history, max_tokens: MAX_TOKENS }),
    });

    const elapsed = Date.now() - t0;

    if (!res.ok) {
        console.error(`\n[error] Server ${res.status}: ${await res.text()}`);
        return;
    }

    const data = await res.json() as any;
    const reply: string = data.choices?.[0]?.message?.content ?? "(no content)";

    console.log("\n" + "─".repeat(60));
    console.log(reply);
    console.log("─".repeat(60));
    console.log(`[${elapsed}ms]`);
    console.log("");

    history.push({ role: "assistant", content: reply });
}

// ── Main REPL ─────────────────────────────────────────────────────────
async function main() {
    console.log("Ouro REPL — connecting to", SERVER);

    const up = await checkServer();
    if (!up) {
        console.error("✗ Server not reachable. Start it with:\n  bun scripts/ouro-server.ts");
        process.exit(1);
    }
    console.log("✓ Server ready\n");
    console.log("Commands: /clear  /quit\n");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "you> ",
        terminal: true,
    });

    rl.prompt();

    rl.on("line", async (line) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        if (input === "/quit" || input === "/exit") {
            rl.close();
            process.exit(0);
        }

        if (input === "/clear") {
            history.length = 1; // Keep system prompt
            console.log("[history cleared]\n");
            rl.prompt();
            return;
        }

        rl.pause();
        await chat(input);
        rl.resume();
        rl.prompt();
    });

    rl.on("close", () => process.exit(0));
}

main();
