# Testing Guide

mygit has two testing layers:

1. automated tests in `src-ts/tests/`
2. manual end-to-end flow checks in the TUI and CLI

---

## Automated Tests

Run everything:

```bash
cd src-ts
bun run typecheck
bun run test
```

Target a file:

```bash
cd src-ts
bun test tests/agentGraphPromptBudget.test.ts
```

## Current Suite Map

### Agent / Prompting

| File | Coverage |
| --- | --- |
| `agentContextFormat.test.ts` | prompt-memory ordering, truncation, latest-read context |
| `agentGraphFetchLoop.test.ts` | `fetch_context` loop guard and free-fetch cap |
| `agentGraphPromptBudget.test.ts` | token budgeting and runtime-state injection |
| `agentRuntime.test.ts` | recursion limits and normalized runtime failures |
| `protocolPromptProfiles.test.ts` | direct-QA vs execution prompt profiles |
| `protocolTaskMode.test.ts` | task-mode inference |

### Memory / Context

| File | Coverage |
| --- | --- |
| `sessionMemory.test.ts` | `.mygit/MYGIT.md` writes, legacy `brain.json` import, portable pack output |
| `autoIndex.test.ts` | touched-file refresh gating and deduplication |
| `knowledgeSelector.test.ts` | shard selection and fallback rules |
| `knowledgeStore.test.ts` | managed `AGENTS.md` ownership and shard persistence |
| `contextBudget.test.ts` | token budget math |
| `contextRetriever.test.ts` | BM25 result ordering |
| `databasePathConsistency.test.ts` | `.mygit/mygit.db` path usage |

### TUI / Interaction

| File | Coverage |
| --- | --- |
| `chatLayout.test.ts` | row layout, list wrapping, spacing |
| `chatRichText.test.ts` | markdown-to-chat token parsing |
| `chatViewport.test.ts` | viewport and scroll behavior |
| `useAgentHistoryCompaction.test.ts` | chat history compaction behavior |
| `useAgentToolOutput.test.ts` | tool-row output formatting |
| `useMouse.test.ts` | mouse + Shift+Tab detection |
| `stdinFilterLifecycle.test.ts` | stdin filter setup/teardown |
| `ideDetection.test.ts` | IDE detection logic |

### Other Product Flows

| File | Coverage |
| --- | --- |
| `executor.test.ts` | git/shell/file action dispatch |
| `cli.test.ts` | CLI parsing |
| `pushRejectionDetection.test.ts` | push rejection and conflict handoff |
| `thoughtMapImplementation.test.ts` | planning DAG to implementation plan |
| `thoughtMapRender.test.ts` | thought map rendering |
| `smartMergeReasoning.test.ts` | smart merge scoring |
| `branchTools.test.ts` | branch/worktree helper flow |
| `githubAuth.test.ts` | GitHub auth resolution |
| `prReviewPosting.test.ts` | PR review post formatting |
| `prReviewLayout.test.ts` | PR review layout |
| `prSlashCommands.test.ts` | PR slash command behavior |
| `fetchFlow.test.ts` | safe fetch flow summary generation |

---

## Manual E2E Flow Checks

Run the app first:

```bash
cd src-ts
bun run dev
```

Mark each flow as:

- `PASS`
- `FAIL`
- `PARTIAL`

---

## Flow 1: Basic Connectivity

### 1.1 Greeting

Prompt:

```text
hello
```

Expected:

- model responds within a few seconds
- no crash
- token bar updates

### 1.2 Repo Awareness

Prompt:

```text
What branch am I on right now?
```

Expected:

- correct branch
- no permission prompt

### 1.3 Indexed Context

First run:

```bash
mygit init
```

Then prompt:

```text
Explain what this project does.
```

Expected:

- answer reflects TUI, agent, Git workflows, and repo retrieval
- no hallucinated subsystems
- root `AGENTS.md` exists or is updated if mygit owns it
- `.mygit/knowledge/manifest.json` and shard docs exist

---

## Flow 2: Agent Execution

### 2.1 File Read

```text
Read src-ts/agent/protocol.ts and list the supported action types.
```

Expected:

- accurate action list
- no permission prompt

### 2.2 Multi-step Inspection

```text
Compare src-ts/agent/graph.ts and src-ts/agent/protocol.ts and explain how they work together.
```

Expected:

- targeted reads or `fetch_context`
- coherent explanation of prompt/graph/action relationship

### 2.3 Permission Prompt

```text
Run 'ls src-ts/' and show me the output.
```

Expected:

- approval UI appears if shell commands are set to `ask`
- approved command output appears in the tool row

### 2.4 Loop Guard

```text
Keep running git status until something changes.
```

Expected:

- loop guard stops repetition
- app remains responsive

---

## Flow 3: Session Memory

### 3.1 Compact In Memory

Have a short conversation, then use:

- `/compact`
- `In-memory`

Expected:

- chat is replaced by a compact summary
- summary remains available to the next prompt
- `.mygit/MYGIT.md` is unchanged

### 3.2 Compact And Persist

Use:

- `/compact`
- `Save to file`

Expected:

- `.mygit/MYGIT.md` is updated with `Last:` and `Next:`
- recent session line is appended
- next prompt still has the compact summary available

### 3.3 Clear Session

After a few prompts, use:

- `/clear`

Expected:

- live chat history clears
- `.mygit/MYGIT.md` is updated
- asking about the prior session may return the distilled latest memory, not the full verbatim chat

### 3.4 Brain CLI

```bash
mygit brain save "I was working on auth persistence"
mygit brain resume
mygit brain pack
```

Expected:

- `save` updates `.mygit/MYGIT.md`
- `resume` prints latest memory from markdown
- `pack` prints or copies a portable markdown context block

### 3.5 Knowledge Refresh After Checkpoint

After `mygit init`, change a tracked source file and run:

```bash
mygit brain save "checkpoint after source edit"
```

Expected:

- the command returns quickly and does not block on a full reindex
- `.mygit/MYGIT.md` is updated
- `.mygit/knowledge/manifest.json` remains present
- shard docs are still present after the background refresh path

---

## Flow 4: Thought Map

### 4.1 Enter And Exit

- press `Shift+Tab`
- press `Shift+Tab` again

Expected:

- enters and exits planning mode cleanly

### 4.2 Generate Map

In thought mode:

```text
Improve the agent retry logic and document the changes.
```

Expected:

- context gathering panel updates step-by-step
- DAG renders
- node selection works

### 4.3 Implement Handoff

- choose `Implement`
- review plan
- reject or approve

Expected:

- rejection returns cleanly
- approval enters plan execution flow

---

## Flow 5: PR Review

Prerequisite: valid GitHub auth and a repo with PRs.

### 5.1 List PRs

```bash
mygit pr list
```

Expected:

- PR list is fetched successfully

### 5.2 Review PR

```bash
mygit pr review <number>
```

Expected:

- metadata, files, and commits are fetched
- AI review is generated or loaded from cache
- summary includes risk/decision/comments

### 5.3 Post Review

```bash
mygit pr review <number> --post
```

Expected:

- cached or fresh review posts back to GitHub successfully

---

## Flow 6: Merge / Conflict Handling

### 6.1 Explicit Conflict UI

If the repo has conflicts:

```bash
mygit conflicts list
```

Expected:

- conflicted files are listed

### 6.2 Push Rejection Recovery

Prompt:

```text
Push the current branch to origin.
```

Expected when remote rejects:

- push rejection is detected
- mygit attempts `git pull --no-rebase`
- merge conflicts, if present, are handed off to the merge UI

---

## Flow 7: Model / Config

### 7.1 Model Picker

- open `/`
- choose `Model`

Expected:

- model selector opens
- switching model updates the status bar

### 7.2 Provider Check

```bash
mygit check
```

Expected:

- current provider reachability and configured credentials are reported

---

## When A Change Needs Manual Revalidation

Run the relevant manual flow again when you touch:

| Area changed | Revalidate |
| --- | --- |
| `agent/*`, `executor/*` | Flow 2 |
| `memory/*`, `useAgent.ts`, `cli/brain.ts` | Flow 3 |
| `tui/thoughtMap/*`, `plan/*` | Flow 4 |
| `pr/*`, `github/*`, `cli/pr.ts` | Flow 5 |
| `merge/*` | Flow 6 |
| `config/*`, provider logic | Flow 7 |
