# MyGit

> A terminal-native AI coding assistant for Git workflows — React Ink TUI, LangGraph agent loop, BM25 smart-context retrieval, and durable repo-local session memory.

![Status](https://img.shields.io/badge/Status-Active-brightgreen)
![Language](https://img.shields.io/badge/Language-TypeScript-blue)
![Runtime](https://img.shields.io/badge/Runtime-Bun-black)
![Local LLM](https://img.shields.io/badge/Local%20LLM-Ollama%20Ready-orange)
![Privacy](https://img.shields.io/badge/Privacy-Offline%20First-purple)

<video src="docs/assets/final.mp4" autoplay loop muted playsinline width="100%"></video>

---

## What is MyGit

MyGit is a local-first developer assistant that keeps your Git workflows inside the terminal. Ask it to commit, review PRs, resolve merge conflicts, search history, or execute multi-step coding tasks — all with a permission-gated agent loop that shows its work before acting.

You can also use it for git brain, a feature where even though its still in early stages. But you can use it to sync project state across agents, especially if you want to use different providers but you still want those MD's synced up while also keeping you in the loop when running long multiple agent setups.

It runs fully offline/local with Ollama, LM studio, HuggingFace or connects to any API-backed LLM. Context is built once with `MyGit init` and retrieved on every request, so you get fast, accurate answers without re-reading files every turn.

While the inspiration was always to know how current agentic coding agents work, it grew to a pretty cool tool that you can use to essentially replace any other git tool out there while still being decently reliable with smaller models.

I still need to do a lot more testing, especially with smaller models to see how far they can go compared to other SOTA models. So I am planning on doing some benchmarks with different tier models to kind of have a better understanding of some of the capabilities.

But for now I wanted to both share the tool, and try to document the structure, and a bit of the [architecture inspiration](#architecture-inspiration).


![System Overview](docs/assets/project%20structure.png)

---

## Features

| Feature | Description |
| --- | --- |
| **Interactive TUI** | Animated chat, tool rows, approval prompts, slash command palette, and multi-panel modes |
| **Agent Loop** | LangGraph StateGraph with parse retries, loop guard, cancellation, and permission tiers |
| **Smart Context** | BM25 + SQLite retrieval — index once, ranked context on every request |
| **Knowledge Map** | Managed `AGENTS.md` repo map + deterministic `.MyGit/knowledge/` shard docs |
| **Session Memory** | Durable `Last` / `Next` working memory in `.MyGit/MyGit.md` across sessions |
| **Thought Map (Plan Mode)** | Shift+Tab planning mode — generate a DAG, refine, then hand off to the agent |
| **PR Review** | GitHub fetch, AI analysis with inline comments, SQLite cache, optional post-back |
| **Merge Conflicts** | Two-pane conflict view, accept-ours / accept-theirs, AI-assisted smart merge |
| **Git Recipes** | 15+ structured workflows: cross-repo fetch, history search, fork sync, branch ops |
| **Cross-Branch Search** | Find which branch introduced a feature, deleted a file, or contains a commit |
| **Harness Engineering** | Cross-session failure lessons, staleness detection, KV-cache-friendly prompting |

---

## How It Works — Under the Hood

**Agent loop**: Every request runs through a LangGraph StateGraph. MyGit gathers context (git state, memory, RAG results), calls the LLM, parses the action, checks permissions, and executes — looping back until the task is done or the budget is reached. Destructive actions always require explicit user approval.

![Agent Loop](docs/assets/agent%20loop.png)

**Smart context (RAG + knowledge)**: `MyGit init` builds a BM25 inverted index from your codebase and generates focused shard docs in `.MyGit/knowledge/`. On every request a multi-factor scorer selects the most relevant shards and RAG chunks, injects them into the prompt, and keeps the context window lean. Shards auto-refresh after checkpoints.

**Session memory**: After each session, `/compact-save` or `MyGit brain save` writes a `Last` / `Next` summary to `.MyGit/MyGit.md`. The next session picks this up automatically in `gatherContext` — so a cleared conversation still knows the current project state. `.MyGit/FOCUS.md` lets you pin permanent high-priority instructions.

For full system diagrams and flow charts see [docs/architecture.md](docs/architecture.md).

---

## Installation

### Prerequisites

- [Bun](https://bun.sh) 1.1+ or Node.js
- Git
- One LLM provider: **Ollama** for local/offline use, or any API-backed provider

### Install via NPM / Bun

You can install the CLI globally via npm or bun:

```bash
# Using bun (recommended)
bun install -g @amoorgy/mygit

# Or using npm
npm install -g @amoorgy/mygit
```

### Local Development Setup

If you want to run it from source:
```bash
git clone https://github.com/your-username/MyGit.git
cd MyGit/src-ts
bun install

# Run directly
bun run dev
```

### First-Time Project Setup

```bash
# Interactive setup wizard
MyGit setup

# Build the smart-context index and knowledge map
MyGit init
```

---

## Commands

```bash
# Interactive TUI
mygit
mygit tui --model <model>

# Smart-context index
mygit init
mygit init --status          # Index stats + staleness report
mygit init --check           # Staleness check without recompiling
mygit init --clear
mygit init --batch <n>

# PR review
mygit pr list
mygit pr review <number>
mygit pr review <number> --post
mygit pr post <number>

# Conventions / worktrees
mygit conventions discover|show|clear
mygit worktree list|add|remove|prune

# Config / utilities
mygit config show|init|edit
mygit setup
mygit check

# Brain / memory
mygit brain save [note]
mygit brain resume
mygit brain pack
```

---

## TUI Shortcuts

| Key | Action |
| --- | --- |
| `Enter` | Submit input |
| `Ctrl+C` | Cancel running agent or exit |
| `Shift+Tab` | Toggle thought-map planning mode |
| `/` | Open slash command palette |
| `Cmd+E` / `Ctrl+E` | Expand or collapse tool/reasoning rows |
| Mouse wheel | Scroll chat |
| `Escape` | Back out of dialogs and panels |

---

## Configuration

Config merges in this order (later overrides earlier):

1. Built-in defaults
2. Global config (`~/.config/MyGit/config.toml`)
3. Repo-local `.MyGit/config.toml`
4. Environment variables

```toml
provider = "ollama"

[ollama]
url = "http://localhost:11434"
model = "qwen2.5-coder:7b"
temperature = 0.4
contextWindow = 16384

[context]
enabled = true
autoIndex = true
retrievalTopK = 5
contextBudgetRatio = 0.25
```

See [docs/configuration.md](docs/configuration.md) for the full reference.

---

## Persistence

| Surface | Location | Purpose |
| --- | --- | --- |
| Root agent map | `AGENTS.md` | Tracked repo map and shard entrypoint |
| Database | `.MyGit/MyGit.db` | BM25 index, conventions, workflows, PR cache |
| Knowledge store | `.MyGit/knowledge/*.md` | Generated shard docs |
| Working memory | `.MyGit/MyGit.md` | Latest + recent session summary |
| Focus file | `.MyGit/FOCUS.md` | Highest-priority human-authored instructions |
| Failure lessons | `.MyGit/LESSONS.md` | Cross-session failure patterns (2KB cap) |
| Repo config | `.MyGit/config.toml` | Project-level overrides |

---

## Documentation

- [docs/architecture.md](docs/architecture.md) — full system diagrams and flow charts
- [docs/development.md](docs/development.md) — contributor guide and module ownership
- [docs/configuration.md](docs/configuration.md) — config hierarchy and all settings

* benchmarks soon

---

## Architecture Inspiration

These links were very useful in development of this tool and are the reason for this architecture of the project:

- [OpenAI: Harness Engineering](https://openai.com/index/harness-engineering/
)
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

Even though this project does not run longer tasks and mainly focuses on small issues, this way of getting the information was incredibly useful to make really small models really efficient since they were getting what they needed really fast without extra compute or effort.

This also ties into why RAG because again you need to clue in "bad models" so that they can get you the best results before hallucination kicks in or just straight up no instruction following.

In the future I may implement the ideas of harness engineering even more where it looks more into how you pass over to a new agent when you "can tell" that the current model is no longer at its best capacity and this could be very useful for something like pr reviews which if achievable at a high quality with smaller models would be pretty cool.

---

## Known Issues & Model Recommendations

- **Instruction Following:** Very small local models (<7B) can sometimes struggle with strict JSON tool-call formatting or complex instruction following. If you see the agent looping without progressing, try clearing the session or upgrading models (Pro Tip: you could use something like Ollama Cloud Models to try it out with GLM-5 US hosted models or something similar usage limit is pretty good).
- **Model Recommendations:** The `qwen3.5` family of models are incredibly good at the moment for this codebase and agent structure. Using cloud-hosted models (like Claude, OpenAI, or DeepSeek) or connecting Ollama to your own strong local/cloud instances yields fantastic reliability.
- **Terminal Resizing:** Because the TUI is built with React Ink, aggressively resizing your terminal window while the agent is streaming text might cause visual layout glitches.
- **Massive Repositories:** For gigabyte-sized monorepos, `mygit init` indexing can take a bit longer, and you might need to adjust `retrievalTopK` in your config to prevent blowing past the context window of smaller local models.
- **Feature Polish & Technical Debt:** Some features might feel a bit rough around the edges or not the best right now. I intentionally left some technical debt to get the core project out the door—this helps me figure out what how to progress faster so I don't hit the "rebuild the infrastructure loop".


---

## Contributions

Contributions are welcome! If you would like to contribute, please feel free to contact me directly or follow the norm: fork the repository, make your changes, and submit a pull request.

---

*Built with TypeScript, React Ink, LangGraph, BM25, and SQLite. Runs on Bun.*
