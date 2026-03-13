/**
 * TypeScript test: call the local Ouro server's OpenAI-compatible API.
 *
 * Usage:
 *   1. Start the server:  python3 scripts/ouro-server.py
 *   2. Run this test:     cd src-ts && bun ../scripts/test-ouro-api.ts
 *
 * This tests the same path MyGit uses (ChatOpenAI → localhost:8080/v1).
 */

const SERVER_URL = "http://localhost:8080";

// ── 1. Check if server is up ──────────────────────────────────────────
async function checkServer(): Promise<boolean> {
    try {
        const res = await fetch(`${SERVER_URL}/v1/models`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return false;
        const data = await res.json();
        console.log("✓ Server is up. Available models:", JSON.stringify(data));
        return true;
    } catch {
        return false;
    }
}

// ── 2. Raw fetch test (no dependencies) ───────────────────────────────
async function testRawFetch(): Promise<void> {
    console.log("\n── Test 1: Raw fetch to /v1/chat/completions ──");

    const body = {
        model: "ByteDance/Ouro-2.6B",
        messages: [
            { role: "user", content: "What is a git commit? Answer in one sentence." },
        ],
        temperature: 0.7,
        max_tokens: 100,
    };

    const t0 = Date.now();
    const res = await fetch(`${SERVER_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Server error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const elapsed = Date.now() - t0;
    const reply = data.choices?.[0]?.message?.content ?? "(no content)";

    console.log(`  Response (${elapsed}ms):`);
    console.log(`  "${reply}"`);
    console.log(`  Usage: ${JSON.stringify(data.usage)}`);
    console.log("  ✓ Raw fetch works!\n");
}

// ── 3. LangChain ChatOpenAI test (same as MyGit uses) ─────────────────
async function testLangChain(): Promise<void> {
    console.log("── Test 2: LangChain ChatOpenAI ──");

    let ChatOpenAI: any;
    try {
        const mod = await import("@langchain/openai");
        ChatOpenAI = mod.ChatOpenAI;
    } catch {
        console.log("  ⚠ @langchain/openai not installed, skipping LangChain test.");
        console.log("  (Run: cd src-ts && bun install)");
        return;
    }

    const model = new ChatOpenAI({
        openAIApiKey: "local",
        modelName: "ByteDance/Ouro-2.6B",
        temperature: 0.7,
        configuration: { baseURL: `${SERVER_URL}/v1` },
    });

    const t0 = Date.now();
    const result = await model.invoke("Explain what a git branch is in one sentence.");
    const elapsed = Date.now() - t0;

    console.log(`  Response (${elapsed}ms):`);
    console.log(`  "${result.content}"`);
    console.log("  ✓ LangChain ChatOpenAI works!\n");
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
    console.log("=".repeat(60));
    console.log("Ouro-2.6B  —  TypeScript API test");
    console.log("=".repeat(60));

    const up = await checkServer();
    if (!up) {
        console.error("\n✗ Server not reachable at", SERVER_URL);
        console.error("  Start it first:  python3 scripts/ouro-server.py");
        process.exit(1);
    }

    await testRawFetch();
    await testLangChain();

    console.log("=".repeat(60));
    console.log("All tests passed! The Ouro model works with MyGit's stack.");
    console.log("=".repeat(60));
}

main().catch((err) => {
    console.error("\n✗ Test failed:", err.message ?? err);
    process.exit(1);
});
