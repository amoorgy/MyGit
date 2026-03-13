# mygit Model Benchmark Suite v1

This folder contains a hybrid evaluation pack for comparing model quality on mygit.

## Files

- `mygit-hybrid-benchmark-v1.jsonl` — prompt catalog with expected results
- `mygit-hybrid-fixtures.json` — reusable fixture states referenced by prompt records

## Coverage

The suite contains 220 prompts across 11 categories:

| Category | Count | Focus |
| --- | ---: | --- |
| `capability_qa` | 20 | product facts and supported features |
| `cli_routing` | 20 | command selection and exact CLI routing |
| `slash_routing` | 20 | TUI slash command routing |
| `task_mode` | 20 | `direct_qa` vs `execution` and `light` vs `full` initialization |
| `repo_inspection` | 20 | file/symbol ownership and implementation lookup |
| `init_memory_knowledge` | 20 | indexing, AGENTS, shard docs, and session memory |
| `git_helper` | 20 | commit, summary, explain, fetch, and push-rejection behavior |
| `plan_workflow` | 20 | planning, safety, approvals, and implementation handoff |
| `pr_review` | 20 | PR review/list/post/auth behavior |
| `merge_worktree_conventions` | 20 | merge conflicts, worktrees, and conventions |
| `robustness_guardrails` | 20 | loop guards, clarifications, grounding, and safety |

## Record Shape

Each JSONL row is a single benchmark case.

Common fields:

- `id` — stable benchmark id
- `surface` — `prompt_only`, `agent_in_loop`, or `end_to_end`
- `category` — benchmark bucket
- `fixture_id` — fixture state from `mygit-hybrid-fixtures.json`
- `difficulty` — `easy`, `medium`, or `hard`
- `prompt` — user prompt to evaluate
- `expected_mode` — `direct_qa` or `execution`
- `expected_init_policy` — optional `light` or `full`
- `expected_result_type` — expected output family
- `expected_route` — exact CLI/slash/action route when applicable
- `scoring_profile` — reusable rubric profile
- `must_include` — concepts, commands, files, or behaviors that must appear
- `must_not_include` — forbidden claims or behaviors

## Expected Result Types

- `fact_answer` — semantic answer grounded in repo facts
- `command_route` — exact CLI command or slash command routing
- `task_mode` — correct mode and initialization policy
- `repo_lookup` — correct file and symbol ownership
- `artifact_state` — correct files or repo-local artifacts expected after a workflow
- `agent_action` — correct top-level action selection
- `plan` — valid multi-step plan with safety-aware ordering
- `review` — structured PR review behavior or policy response
- `error_handling` — proper fallback, clarification, or guardrail behavior

## Scoring Profiles

- `fact_semantic`
  - correctness 0.60
  - grounding 0.25
  - concision 0.15
- `route_exact`
  - route correctness 0.75
  - formatting 0.25
- `mode_policy`
  - mode correctness 0.45
  - init policy correctness 0.35
  - safety/inspection policy 0.20
- `artifact_assert`
  - artifact correctness 0.55
  - workflow correctness 0.30
  - grounding 0.15
- `action_schema`
  - action type correctness 0.50
  - schema validity 0.30
  - policy alignment 0.20
- `plan_schema`
  - step quality 0.40
  - safety/approval handling 0.35
  - completeness 0.25
- `review_schema`
  - routing/policy correctness 0.35
  - review structure 0.35
  - severity/grounding 0.30
- `guardrail_policy`
  - safe behavior 0.45
  - grounding 0.35
  - concise recovery 0.20

## Suggested Evaluation Flow

1. Set the repo to the referenced fixture state.
2. Run the prompt through the model using the intended surface.
3. Score the output using the row's `scoring_profile`.
4. Check all `must_include` assertions.
5. Fail the case if any `must_not_include` item appears.

## Source Basis

This suite is grounded in:

- `README.md`
- `TESTING.md`
- `src-ts/agent/protocol.ts`
- `src-ts/tui/thoughtMap/slashCommands.ts`
- `src-ts/plan/types.ts`
- `src-ts/cli/*.ts`
- `src-ts/memory/sessionMemory.ts`
- `src-ts/knowledge/*.ts`
- `src-ts/tests/*.test.ts`
