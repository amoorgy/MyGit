/**
 * Git Recipes — catalog of structured multi-step git workflows.
 *
 * Each recipe provides step-by-step guidance that gets injected into
 * the agent's system prompt when a matching request is detected.
 * The agent can follow the steps or adapt as needed.
 */

import type { GitRecipe } from "./types.js";

// ============================================================================
// CROSS-REPO RECIPES
// ============================================================================

const fetchRemoteBranch: GitRecipe = {
    id: "fetch-remote-branch",
    category: "cross_repo",
    name: "Fetch Branch from Remote/Fork",
    triggers: [
        /fetch\s+(a\s+)?branch\s+.*\bfrom\b/i,
        /get\s+(a\s+)?branch\s+.*\bfrom\b.*\b(fork|remote)\b/i,
        /pull\s+(a\s+)?branch\s+.*\bfrom\b.*\b(fork|remote)\b/i,
        /\bbranch\b.*\bfrom\b.*\b(fork|remote|upstream)\b/i,
        /\bfrom\b.*\b(fork|remote)\b.*\bbranch\b/i,
        /take\s+(a\s+)?branch\s+from/i,
        /bring\s+(a\s+)?branch\s+from/i,
    ],
    requiredContext: ["remotes", "fork_info", "all_branches"],
    steps: [
        { description: "List current remotes to see what's configured", command: "git remote -v", isProbe: true, safety: "safe" },
        { description: "Add the remote if it's not already configured", command: "git remote add {{remote}} {{url}}", isProbe: false, safety: "standard", skipIf: "remote already exists" },
        { description: "Fetch branches from the remote", command: "git fetch {{remote}}", isProbe: false, safety: "standard" },
        { description: "List available remote branches to confirm the target exists", command: "git branch -r --list '{{remote}}/*'", isProbe: true, safety: "safe" },
        { description: "Create a local branch tracking the remote branch", command: "git checkout -b {{branch}} {{remote}}/{{branch}}", isProbe: false, safety: "standard" },
    ],
    warnings: [
        "If the local branch already exists, use `git checkout {{branch}} && git pull {{remote}} {{branch}}` instead.",
        "If the remote URL is SSH, ensure your SSH key is configured.",
    ],
    suggestedIterations: 10,
};

const syncFork: GitRecipe = {
    id: "sync-fork",
    category: "cross_repo",
    name: "Sync Fork with Upstream",
    triggers: [
        /sync\s+(my\s+)?fork/i,
        /update\s+(my\s+)?fork\s+(from|with)\s+upstream/i,
        /pull\s+(from\s+)?upstream/i,
        /fetch\s+upstream\s+changes/i,
        /keep\s+(my\s+)?fork\s+(up[\s-]?to[\s-]?date|in\s+sync|updated)/i,
        /merge\s+upstream\s+(into|to)/i,
    ],
    requiredContext: ["remotes", "fork_info", "tracking"],
    steps: [
        { description: "Check if upstream remote exists", command: "git remote -v", isProbe: true, safety: "safe" },
        { description: "Add upstream remote if missing (use parent repo URL from fork info)", command: "git remote add upstream {{upstream_url}}", isProbe: false, safety: "standard", skipIf: "upstream already configured" },
        { description: "Fetch all upstream branches", command: "git fetch upstream", isProbe: false, safety: "standard" },
        { description: "Switch to main/master branch", command: "git checkout {{default_branch}}", isProbe: false, safety: "standard" },
        { description: "Merge upstream changes into local branch", command: "git merge upstream/{{default_branch}}", isProbe: false, safety: "standard" },
        { description: "Push updated branch to origin", command: "git push origin {{default_branch}}", isProbe: false, safety: "standard" },
    ],
    warnings: [
        "If merge conflicts arise, resolve them before pushing.",
        "Some prefer `git rebase upstream/main` over merge — ask the user which they prefer if unclear.",
    ],
    suggestedIterations: 10,
};

const cherryPickCrossRemote: GitRecipe = {
    id: "cherry-pick-cross-remote",
    category: "cross_repo",
    name: "Cherry-pick from Another Remote",
    triggers: [
        /cherry[\s-]?pick\s+.*\b(from|across)\b.*\b(fork|remote|upstream)\b/i,
        /\b(from|across)\b.*\b(fork|remote|upstream)\b.*cherry[\s-]?pick/i,
        /grab\s+(a\s+)?commit\s+from\s+(fork|upstream|remote)/i,
    ],
    requiredContext: ["remotes", "fork_info"],
    steps: [
        { description: "List remotes", command: "git remote -v", isProbe: true, safety: "safe" },
        { description: "Add source remote if needed", command: "git remote add {{remote}} {{url}}", isProbe: false, safety: "standard", skipIf: "remote already exists" },
        { description: "Fetch from the source remote", command: "git fetch {{remote}}", isProbe: false, safety: "standard" },
        { description: "Find the target commit(s) on the remote branch", command: "git log {{remote}}/{{branch}} --oneline -10", isProbe: true, safety: "safe" },
        { description: "Cherry-pick the commit(s)", command: "git cherry-pick {{commit_sha}}", isProbe: false, safety: "standard" },
    ],
    warnings: [
        "If cherry-picking multiple commits, use `git cherry-pick <start>..<end>` for a range.",
        "Conflicts may arise — resolve before continuing.",
    ],
    suggestedIterations: 10,
};

const pushToFork: GitRecipe = {
    id: "push-to-fork",
    category: "cross_repo",
    name: "Push Branch to Fork",
    triggers: [
        /push\s+.*\b(to\s+)?(my\s+)?fork\b/i,
        /push\s+.*\bbranch\b.*\bto\s+(my\s+)?fork\b/i,
        /send\s+.*\bbranch\b.*\bto\s+(my\s+)?fork\b/i,
    ],
    requiredContext: ["remotes", "fork_info", "tracking"],
    steps: [
        { description: "List remotes to identify the fork", command: "git remote -v", isProbe: true, safety: "safe" },
        { description: "Check current branch", command: "git branch --show-current", isProbe: true, safety: "safe" },
        { description: "Push current branch to the fork remote", command: "git push {{fork_remote}} {{branch}}", isProbe: false, safety: "standard" },
    ],
    warnings: [
        "If the fork remote is 'origin', this is the default push target.",
        "Use -u flag to set upstream tracking: `git push -u {{fork_remote}} {{branch}}`",
    ],
    suggestedIterations: 8,
};

const compareAcrossRemotes: GitRecipe = {
    id: "compare-across-remotes",
    category: "cross_repo",
    name: "Compare Branches Across Remotes",
    triggers: [
        /diff\s+(between|across)\s+.*\b(fork|remote|upstream)\b/i,
        /compare\s+.*\b(fork|remote|upstream)\b/i,
        /difference\s+between\s+.*\b(fork|upstream)\b/i,
    ],
    requiredContext: ["remotes", "fork_info"],
    steps: [
        { description: "Fetch latest from both remotes", command: "git fetch --all", isProbe: false, safety: "standard" },
        { description: "Show diff between the two remote branches", command: "git diff {{remote_a}}/{{branch_a}}...{{remote_b}}/{{branch_b}} --stat", isProbe: true, safety: "safe" },
        { description: "Show detailed diff if needed", command: "git diff {{remote_a}}/{{branch_a}}...{{remote_b}}/{{branch_b}}", isProbe: false, safety: "safe" },
    ],
    warnings: [
        "Use three-dot diff (`...`) to compare from the common ancestor.",
        "The `--stat` flag gives a summary; omit it for full diff.",
    ],
    suggestedIterations: 8,
};

// ============================================================================
// HISTORY RECIPES
// ============================================================================

const undoFileToDate: GitRecipe = {
    id: "undo-file-to-date",
    category: "history",
    name: "Undo File Changes to a Specific Date",
    triggers: [
        /undo\s+.*\b(file|changes)\b.*\b(to|back\s+to|before|until)\b.*\b(date|day|month|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|\d{1,2}[/-]\d{1,2})/i,
        /revert\s+.*\bfile\b.*\b(to|back\s+to)\b.*\b(date|day|\d)/i,
        /restore\s+.*\bfile\b.*\b(from|to|as\s+of)\b.*\b(date|day|\d)/i,
        /reset\s+.*\bfile\b.*\b(to|back\s+to)\b.*\b(date|\d)/i,
    ],
    requiredContext: [],
    steps: [
        { description: "Find the last commit before the target date that touched the file", command: "git log --before='{{date}}' -1 --format='%H %ci %s' -- {{file}}", isProbe: true, safety: "safe" },
        { description: "Show the file at that commit to verify", command: "git show {{commit_sha}}:{{file}}", isProbe: true, safety: "safe" },
        { description: "Restore the file from that commit", command: "git checkout {{commit_sha}} -- {{file}}", isProbe: false, safety: "standard" },
    ],
    warnings: [
        "This stages the restored version. Use `git diff --cached` to review before committing.",
        "If no commit is found before the date, the file may not have existed yet.",
    ],
    suggestedIterations: 8,
};

const findChangeIntroduced: GitRecipe = {
    id: "find-change-introduced",
    category: "history",
    name: "Find When a Change Was Introduced",
    triggers: [
        /when\s+was\s+.*\b(introduced|added|changed|created)\b/i,
        /find\s+(the\s+)?commit\s+that\s+(added|introduced|changed|created)/i,
        /which\s+commit\s+(added|introduced|changed|broke)/i,
        /who\s+(added|introduced|changed|wrote)/i,
    ],
    requiredContext: [],
    steps: [
        { description: "Search for the string/change across all history", command: "git log -S'{{search_term}}' --all --oneline -- {{file}}", isProbe: true, safety: "safe" },
        { description: "Show the first commit that introduced the change", command: "git show {{commit_sha}}", isProbe: true, safety: "safe" },
        { description: "If searching for a pattern instead, use regex", command: "git log -G'{{pattern}}' --all --oneline", isProbe: true, safety: "safe" },
    ],
    warnings: [
        "`-S` finds commits where the string count changed (add/remove). `-G` finds commits with matching diff lines.",
        "Add `-- <file>` to narrow to a specific file.",
    ],
    suggestedIterations: 8,
};

const restoreDeletedFile: GitRecipe = {
    id: "restore-deleted-file",
    category: "history",
    name: "Restore a Deleted File",
    triggers: [
        /restore\s+(\w+\s+)?deleted\s+file/i,
        /recover\s+(\w+\s+)?(deleted|removed)\s+file/i,
        /bring\s+back\s+(\w+\s+)?(deleted|removed)\s+file/i,
        /undelete\s+(\w+\s+)?file/i,
        /get\s+back\s+(\w+\s+)?file\s+.*\bdeleted\b/i,
    ],
    requiredContext: [],
    steps: [
        { description: "Find the commit that deleted the file", command: "git log --diff-filter=D --summary -- '{{file}}'", isProbe: true, safety: "safe" },
        { description: "Restore the file from the commit just before deletion", command: "git checkout {{commit_sha}}^ -- {{file}}", isProbe: false, safety: "standard" },
    ],
    warnings: [
        "The `^` suffix means 'parent of the commit that deleted it' — i.e., the last version before deletion.",
        "If you don't know the exact path, use `git log --diff-filter=D --summary` to search all deletions.",
    ],
    suggestedIterations: 8,
};

const bisectBug: GitRecipe = {
    id: "bisect-bug",
    category: "history",
    name: "Bisect to Find a Bug",
    triggers: [
        /bisect/i,
        /find\s+which\s+commit\s+broke/i,
        /which\s+commit\s+caused\s+(the\s+)?(bug|regression|failure|issue)/i,
        /when\s+did\s+.*\bbreak\b/i,
        /binary\s+search\s+.*\bcommit/i,
    ],
    requiredContext: [],
    steps: [
        { description: "Start bisect session", command: "git bisect start", isProbe: false, safety: "standard" },
        { description: "Mark the current commit as bad", command: "git bisect bad", isProbe: false, safety: "standard" },
        { description: "Mark a known good commit", command: "git bisect good {{good_commit}}", isProbe: false, safety: "standard" },
        { description: "Git will checkout a middle commit — test it, then mark good or bad", command: "git bisect good  OR  git bisect bad", isProbe: true, safety: "standard" },
        { description: "When done, reset to original state", command: "git bisect reset", isProbe: false, safety: "standard" },
    ],
    warnings: [
        "Bisect is interactive — the agent should guide the user through each step.",
        "For automated bisect: `git bisect run <test-script>` can automate the process.",
        "Always run `git bisect reset` when done to return to the original branch.",
    ],
    suggestedIterations: 12,
};

// ============================================================================
// SEARCH RECIPES
// ============================================================================

const findBranchWithFeature: GitRecipe = {
    id: "find-branch-with-feature",
    category: "search",
    name: "Find Which Branch Has a Feature",
    triggers: [
        /which\s+branch\s+(has|contains|includes)/i,
        /find\s+(the\s+)?branch\s+.*\b(with|containing|that\s+has)\b/i,
        /what\s+branch\s+(is|has)\s+.*\b(feature|change|code|fix)\b/i,
        /\bfeature\b.*\bacross\s+branches\b/i,
    ],
    requiredContext: ["all_branches"],
    steps: [
        { description: "Search commit messages across all branches", command: "git log --all --oneline --grep='{{search_term}}'", isProbe: true, safety: "safe" },
        { description: "Find branches containing the matching commit", command: "git branch -a --contains {{commit_sha}}", isProbe: true, safety: "safe" },
        { description: "Alternatively, search code content across all branches", command: "git grep '{{search_term}}' $(git branch -a --format='%(refname:short)')", isProbe: true, safety: "safe" },
    ],
    warnings: [
        "Searching all branches with `git grep` can be slow on large repos.",
        "`--grep` searches commit messages; `git log -S` searches code diffs.",
    ],
    suggestedIterations: 8,
};

const findDeletedCode: GitRecipe = {
    id: "find-deleted-code",
    category: "search",
    name: "Find Deleted Code in History",
    triggers: [
        /find\s+(the\s+)?deleted\s+(code|function|class|method|variable)/i,
        /search\s+(for\s+)?(removed|deleted)\s+(code|function|class)/i,
        /where\s+did\s+.*\b(go|disappear)\b/i,
        /when\s+was\s+.*\b(removed|deleted)\b/i,
    ],
    requiredContext: [],
    steps: [
        { description: "Search for the code string across all history (finds additions and removals)", command: "git log -S'{{search_term}}' --all --oneline", isProbe: true, safety: "safe" },
        { description: "Show the commit that removed it", command: "git show {{commit_sha}}", isProbe: true, safety: "safe" },
        { description: "To see the code in its last known state", command: "git show {{commit_sha}}^:{{file}}", isProbe: true, safety: "safe" },
    ],
    warnings: [
        "Use `-S` for exact string match, `-G` for regex match.",
        "Add `--diff-filter=D` to `git log` to find file-level deletions.",
    ],
    suggestedIterations: 8,
};

const searchAllBranches: GitRecipe = {
    id: "search-all-branches",
    category: "search",
    name: "Search Code Across All Branches",
    triggers: [
        /search\s+(across|in)\s+all\s+branches/i,
        /grep\s+(across|all)\s+branches/i,
        /find\s+.*\bin\s+all\s+branches\b/i,
        /look\s+for\s+.*\bacross\s+branches\b/i,
    ],
    requiredContext: ["all_branches"],
    steps: [
        { description: "Search code content across all local and remote branches", command: "git grep '{{search_term}}' $(git for-each-ref --format='%(refname:short)' refs/heads/ refs/remotes/)", isProbe: true, safety: "safe" },
        { description: "Alternatively search commit diffs for the term", command: "git log --all -S'{{search_term}}' --oneline", isProbe: true, safety: "safe" },
    ],
    warnings: [
        "Searching many branches can be slow. Consider narrowing with `-- <path>` to limit file scope.",
        "Remote branches need to be fetched first (`git fetch --all`).",
    ],
    suggestedIterations: 8,
};

// ============================================================================
// BRANCH RECIPES
// ============================================================================

const squashCommits: GitRecipe = {
    id: "squash-commits",
    category: "branch",
    name: "Squash Recent Commits",
    triggers: [
        /squash\s+(the\s+)?(last\s+)?\d*\s*commits?/i,
        /combine\s+(the\s+)?(last\s+)?\d*\s*commits?/i,
        /merge\s+(the\s+)?last\s+\d+\s+commits?\s+into\s+one/i,
        /flatten\s+commits/i,
    ],
    requiredContext: [],
    steps: [
        { description: "Check recent commits to confirm the range", command: "git log --oneline -{{count}}", isProbe: true, safety: "safe" },
        { description: "Soft reset to un-commit but keep changes staged", command: "git reset --soft HEAD~{{count}}", isProbe: false, safety: "dangerous" },
        { description: "Create a single commit with all the changes", command: "git commit -m '{{message}}'", isProbe: false, safety: "standard" },
    ],
    warnings: [
        "This rewrites history. Only do this for commits that haven't been pushed, or use `--force` push.",
        "The `--soft` reset preserves all changes in the staging area.",
    ],
    suggestedIterations: 8,
};

const cherryPickRange: GitRecipe = {
    id: "cherry-pick-range",
    category: "branch",
    name: "Cherry-pick a Range of Commits",
    triggers: [
        /cherry[\s-]?pick\s+(a\s+)?range/i,
        /cherry[\s-]?pick\s+(commits?\s+)?(from|between)\s+.*\bto\b/i,
        /cherry[\s-]?pick\s+multiple\s+commits/i,
        /cherry[\s-]?pick\s+\w+\s*\.\.\s*\w+/i,
    ],
    requiredContext: [],
    steps: [
        { description: "List commits in the range to confirm", command: "git log --oneline {{start_commit}}..{{end_commit}}", isProbe: true, safety: "safe" },
        { description: "Cherry-pick the range (exclusive start, inclusive end)", command: "git cherry-pick {{start_commit}}..{{end_commit}}", isProbe: false, safety: "standard" },
    ],
    warnings: [
        "The range `A..B` is exclusive of A (starts from A's child). To include A, use `A^..B`.",
        "Conflicts may arise on each commit — resolve before continuing with `git cherry-pick --continue`.",
    ],
    suggestedIterations: 8,
};

// ============================================================================
// SETUP RECIPES
// ============================================================================

const setupUpstream: GitRecipe = {
    id: "setup-upstream",
    category: "setup",
    name: "Set Up Upstream Remote for Fork",
    triggers: [
        /add\s+upstream/i,
        /set\s*up\s+(the\s+)?upstream/i,
        /configure\s+upstream/i,
        /set\s*up\s+fork\s+tracking/i,
        /track\s+upstream/i,
    ],
    requiredContext: ["remotes", "fork_info"],
    steps: [
        { description: "Check existing remotes", command: "git remote -v", isProbe: true, safety: "safe" },
        { description: "Add the upstream remote", command: "git remote add upstream {{upstream_url}}", isProbe: false, safety: "standard" },
        { description: "Fetch upstream branches", command: "git fetch upstream", isProbe: false, safety: "standard" },
        { description: "Verify the setup", command: "git remote -v", isProbe: true, safety: "safe" },
    ],
    warnings: [
        "If this is a GitHub fork, the upstream URL should be the parent repository's clone URL.",
    ],
    suggestedIterations: 8,
};

// ============================================================================
// CATALOG EXPORT
// ============================================================================

export const RECIPE_CATALOG: GitRecipe[] = [
    // Cross-repo
    fetchRemoteBranch,
    syncFork,
    cherryPickCrossRemote,
    pushToFork,
    compareAcrossRemotes,
    // History
    undoFileToDate,
    findChangeIntroduced,
    restoreDeletedFile,
    bisectBug,
    // Search
    findBranchWithFeature,
    findDeletedCode,
    searchAllBranches,
    // Branch
    squashCommits,
    cherryPickRange,
    // Setup
    setupUpstream,
];
