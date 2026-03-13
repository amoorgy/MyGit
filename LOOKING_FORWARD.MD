# MyGit — Looking Forward

## Feature 1: Thought Map (Plan-First TUI)

The goal is to reduce friction in the TUI prompting experience. Instead of a one-by-one checkpoint flow ("okay we can do this"), the agent should present a **map of thoughts** — an interactive flowchart showing what it's planning and why.

### What it looks like

You prompt the agent with something like:

> "Go through X, Y, Z and tell me what's missing, what's wrong, and what we could improve."

The LLM responds with a **thought map** — essentially a flowchart — where you can:

- See each step and the reasoning behind it
- Understand dependencies between steps (what runs in parallel vs. sequentially)
- Drill into any node for detail on what the LLM was thinking at that point

### Why it matters

- Reduces the effort required to supervise and steer the agent
- Makes iterative workflows (e.g. working through 10 issues) much faster
- Makes the TUI a genuinely useful alternative to just running Claude Code directly
- Saves tokens when using capable local models (e.g. a cloud Ollama GLM at Opus 4.6 level) since you only approve plans, not every step

---

## Feature 2: Git Brain

Git Brain is essentially `/init` — but advanced. It's a context-awareness tool that actively builds and maintains a mental model of your project, then keeps you up to speed whenever you return.

### Core behavior

```bash
mygit brain "I was working on the auth feature"
```

The agent spawns, searches commits, stash, past stored project data (via RAG), and produces a **summary** of:

- What you were working on
- What was finished vs. unfinished
- Why certain decisions were made (reconstructed from chat history across Claude Code, Cursor, VS Code, Codex, etc.)

### What makes it different from just using Claude Code

It integrates across all your CLI tools — not just one. After bringing *you* up to speed, it also updates all relevant `agent.md` / `CLAUDE.md` files for Claude Code, Cursor, or any other tool — so the next agent session already has context on what to focus on, saving early tokens and context window.

### Workflow example

You produce 10 issues. Then:

```bash
mygit brain update-issues
```

Each issue branch gets a structured `task.md` with what needs to be done and how — ready before anyone even picks up the branch.

---

## Cross-cutting concern: Context efficiency

Both of these features depend on being able to search through projects efficiently without burning through context.

Right now, only frontier models with 1M+ context windows (like Claude Opus 4.6) can do this without hallucinating too quickly. The better we make context management here, the better these features work on **smaller local LLMs** — which is the real prize: cutting the cost of repetitive AI-assisted dev work that every developer is doing today.
