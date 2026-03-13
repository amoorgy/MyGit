# MyGit Agent System - Implementation Changes

## Overview
This document tracks the major changes and implementation of the MyGit Agent System - a Local LLM-Powered Git CLI Agent built with Rust.

## Implementation Date
December 2025

---

## New Modules Created

### 1. Agent Module (`src/agent/`)

**Purpose:** Core agent logic including actions, permissions, context, and execution.

#### Files:
- **`actions.rs`** - Defines `AgentAction` enum with all possible actions (Git, Shell, ReadFile, WriteFile, Message). Includes safety tier classification (Safe, Standard, Dangerous) and permission categorization.
- **`permissions.rs`** - Three-tier permission system with global/repo/session scopes. Features:
  - `PermissionState`: Allowed, Denied, Ask
  - `PermissionResponse`: Allow/Deny × Once/Session/Permanent
  - Command similarity matching for session approvals
  - Shell allowlist support
  - File write scope restrictions
  - Double confirmation for dangerous operations
- **`context.rs`** - Repository context gathering (git status, branch, commits, file tree) and observation tracking.
- **`protocol.rs`** - LLM communication protocol with JSON parsing, error formatting, and system prompts.
- **`executor.rs`** - Action execution for git/shell/file operations with dry-run support.
- **`agent_loop.rs`** - Main agent loop that iteratively plans and executes actions with LLM.

---

### 2. AI Module (`src/ai/`)

**Purpose:** LLM client abstraction and Ollama integration.

#### Files:
- **`mod.rs`** - 
  - `LLMClient` trait with `generate()`, `health_check()`, `model_name()` methods
  - `OllamaClient` implementation using reqwest for HTTP API calls
  - `ChatSession` for multi-turn conversations (future use)
  - Model listing and availability checking

---

### 3. Config Module (`src/config/`)

**Purpose:** Application configuration management with TOML serialization.

#### Files:
- **`mod.rs`** - Configuration structures:
  - `Config`: Main config with ollama, agent, tui, github settings
  - `OllamaConfig`: URL, model, timeout settings
  - `AgentConfig`: Permissions, confirmation, shell, file_write settings
  - `PermissionConfig`: Default states for each permission category
  - `ConfirmationConfig`: Auto-approve safe actions, require double confirm
  - `ShellConfig`: Allowlist of pre-approved commands
  - `FileWriteConfig`: Repo-only mode and exclusion patterns
  - Global and repo-local config file loading/saving

---

### 4. CLI Module (`src/cli/`)

**Purpose:** Command-line interface and user interaction.

#### Files:
- **`mod.rs`** - 
  - `Cli` struct with clap-derived arguments
  - `Commands`: Agent, Git, Config, Check, Tui
  - `GitCommands`: Commit, Pr, Summary, Explain
  - `ConfigCommands`: Show, Init, Set, Edit
  - Display helpers for formatted output
  - Interactive prompts (confirm, input, permission)

---

### 5. TUI Module (`src/tui/`)

**Purpose:** Terminal user interface using ratatui (future implementation).

#### Files:
- **`mod.rs`** - 
  - `App`: Application state (input, messages, mode, context)
  - `Message`, `MessageRole`: Message types for chat history
  - `AppMode`: Input, Confirm, Permission, Settings, Scrolling
  - `PendingAction`, `ContextInfo`: UI state structures
  - Render functions for header, messages, context, input, status
  - Dialog rendering for confirmations and permissions
  - Keyboard event handling for all modes
  - Terminal initialization/restore helpers

---

### 6. Main Entry Point (`src/main.rs`)

**Purpose:** Application initialization and command routing.

#### Functions:
- `main()`: CLI parsing and async runtime setup
- `run_app()`: Command dispatch to handlers
- `check_ollama()`: Health check and model listing
- `handle_config()`: Config show/init/edit commands
- `handle_git()`: Smart git operations (commit, pr, summary, explain)
- `run_agent_mode()`: Main agent execution loop with permissions
- `run_tui()`: TUI entry (currently falls back to CLI)

---

### 7. Cargo.toml

**Purpose:** Project dependencies and metadata.

#### Key Dependencies:
- **Async Runtime:** tokio (full features)
- **HTTP:** reqwest (json, stream)
- **Serialization:** serde, serde_json, toml
- **CLI:** clap (derive), colored, dialoguer
- **TUI:** ratatui, crossterm, tui-input
- **Git:** git2
- **Errors:** anyhow, thiserror
- **Utilities:** shell-words, directories, chrono, futures, async-trait
- **OAuth:** oauth2, axum, tower-http (for future GitHub integration)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Layer                          │
│  (args parsing, display, interactive prompts)           │
└────────────────┬────────────────────────────────────────────┘
                 │
        ┌────────┼────────┐
        │        │        │
        ▼        ▼        ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │  Agent  │ │   AI    │ │ Config  │
   │  Loop   │ │ Client  │ │ Manager │
   └────┬────┘ └─────────┘ └─────────┘
        │
        ▼
   ┌────────────────────────────┐
   │   Permission Manager    │
   │  (Global/Repo/Session)  │
   └───────┬────────────────┘
           │
           ▼
   ┌────────────────────────────┐
   │     Action Executor     │
   │  (Git/Shell/File Ops)   │
   └────────────────────────────┘
```

---

## Safety Features

1. **Three Safety Tiers:**
   - Safe: Read-only operations (auto-approved)
   - Standard: Modifying operations (single confirm)
   - Dangerous: Destructive operations (double confirm)

2. **Permission Scopes:**
   - Global: `~/.config/mygit/config.toml`
   - Repo: `.mygit/config.toml`
   - Session: Runtime only, cleared on exit

3. **Permission Categories:**
   - Shell Commands
   - File Writes
   - Destructive Git

4. **Session Behavior:**
   - Similar command approval (if "npm install" approved, "npm test" auto-approved)
   - Per-category session overrides
   - Double confirmation toggle

5. **File Write Restrictions:**
   - Repo-only mode (default)
   - Exclusion patterns (.git/, .env, *.key, *.pem)
   - Path validation (no absolute paths, no .. traversal)

---

## CLI Usage Examples

```bash
# Check Ollama connection and available models
mygit check

# Smart commit with AI-generated message
mygit git commit --context "Add new feature"

# Create a pull request (future)
mygit git pr --target main

# Summarize recent commits
mygit git summary --count 10

# Explain a file or commit
mygit git explain main.rs
mygit git explain abc1234

# Interactive agent mode
mygit agent "Create a new branch and commit these changes"

# Configuration
mygit config show
mygit config init --local
mygit config edit

# TUI mode (future)
mygit tui
```

---

## Configuration Example

```toml
[ollama]
url = "http://localhost:11434"
model = "llama3.2"
timeout_secs = 120

[agent.permissions]
shell_commands = "ask"
file_writes = "ask"
destructive_git = "ask"

[agent.confirmation]
auto_approve_safe = true
require_double_confirm = true

[agent.shell]
allowlist = [
    "npm install",
    "npm run",
    "cargo build",
    "cargo test",
    "make",
]

[agent.file_write]
repo_only = true
exclude_patterns = [
    ".git/",
    ".env",
    "*.key",
    "*.pem",
]

[tui]
theme = "dark"
show_context = true
```

---

## Status

### Completed
- ✅ Agent module with all core functionality
- ✅ AI module with Ollama integration
- ✅ Config module with TOML support
- ✅ CLI module with full command parsing
- ✅ TUI module with UI scaffolding
- ✅ Permission system (3 tiers, 3 scopes)
- ✅ Action execution (git, shell, file read/write)
- ✅ Project compiles successfully

### Future Work
- ⏳ GitHub API integration (PR creation, auth)
- ⏳ GitLab API integration
- ⏳ Settings menu in TUI
- ⏳ Shell command output streaming
- ⏳ Action history/undo
- ⏳ Multi-file operations
- ⏳ Project templates
- ⏳ Tests and CI/CD

---

## Enhanced Agent Protocol Refactor (December 2025)

### Problem Solved
The original agent had a "bare minimum" implementation that:
- Hit "Max iterations" on simple queries
- Didn't know when tasks were complete
- Couldn't communicate reasoning to users
- Had unbounded context growth
- Used simplistic JSON actions without structure for multi-step workflows

### Solution: Enhanced Agent Protocol

#### 1. New Agent Response Schema (`src/agent/protocol.rs`)

**Before:** Agent responded with just an action JSON
```json
{"type": "git", "command": "status"}
```

**After:** Agent responds with thinking, action, and optional progress
```json
{
  "thinking": "I need to check git status first to see what files have changed",
  "action": {"type": "git", "command": "status"},
  "progress": {"step": 1, "of": 3, "description": "Checking repository state"}
}
```

#### 2. New Action Types

| Action Type | Purpose | Behavior |
|-------------|---------|----------|
| `done` | Task completed | Ends loop with summary |
| `respond` | Answer question | Ends loop with direct answer |
| `clarify` | Ask for input | Pauses loop, waits for user input |
| `plan` | Multi-step plan | Shows plan, optionally waits for approval |

**Examples:**
```json
{"type": "done", "summary": "Committed 3 files successfully"}
{"type": "respond", "answer": "You are on branch 'main'"}
{"type": "clarify", "question": "Which remote should I push to?"}
{"type": "plan", "steps": [
  {"step": 1, "action": "git status", "description": "Check changes"},
  {"step": 2, "action": "git add -A", "description": "Stage files"},
  {"step": 3, "action": "git commit", "description": "Commit changes"}
]}
```

#### 3. New Config Options (`src/config/settings.rs`)

Added to `AgentConfig`:
- `show_thinking: bool` - Show agent's reasoning in TUI (default: true)
- `planning_mode: PlanningMode` - How to handle multi-step plans

**PlanningMode enum:**
- `ShowAndApprove` - Show plan and wait for user approval before executing
- `ShowAndExecute` - Show plan but execute immediately (default)
- `JustExecute` - Don't show plan, just execute steps

#### 4. Enhanced Validation (`src/agent/validation.rs`)

- New `ParsedResponse` struct holds thinking + action + progress
- `parse_response()` function parses new schema with backward compatibility
- Falls back to old format if new format not detected

#### 5. Enhanced Agent Loop (`src/agent/loop.rs`)

New `AgentEvent` variants:
- `TaskComplete { summary }` - Task finished with summary
- `Response { answer }` - Direct answer to question
- `ClarifyRequest { question, reply_tx }` - Pause for user input
- `PlanProposal { steps, reply_tx }` - Plan needs approval
- `Progress { step, total, description }` - Progress update

New function `run_agent_loop_with_config()` accepts:
- `show_thinking: bool`
- `planning_mode: PlanningMode`

#### 6. Context Sliding Window (`src/agent/context.rs`)

- `format_for_prompt_with_window(window_size)` - Recent N observations get full detail, older ones get one-line summary
- Prevents context explosion during long agent runs
- Default window size: 5

#### 7. Enhanced TUI (`src/tui/mod.rs`)

New AppModes:
- `Clarify` - Shows clarification input field
- `PlanApproval` - Shows plan with approve/reject options

New MessageRoles:
- `Thinking` - Agent's reasoning (dimmed, italic)
- `Progress` - Progress updates (blue)

New UI components:
- `render_clarify_input()` - Input field for clarify mode
- `render_plan_approval()` - Plan display with approval options

Keyboard handlers:
- Clarify mode: Enter to submit, Esc to cancel
- Plan mode: Y/Enter to approve, N/Esc to reject, arrows to navigate

#### 8. Executor Updates (`src/executor/mod.rs`)

Added handling for new action types in `execute_action()` and `dry_run()`:
- `Done`, `Respond`, `Clarify`, `Plan` are now handled (return success with appropriate message)

### Expected Behavior After Changes

#### Simple query: "what branch am I on"
```
Thinking: User wants to know current branch - I can answer from context
Agent: You are on branch 'main'
Task completed
```

#### Commit request: "commit the changes"
```
Thinking: Need to check status, stage, then commit
Progress: [1/3] Checking repository state
Running: git status
   M src/agent/loop.rs
Thinking: Found changes, staging all files
Progress: [2/3] Staging changes
Running: git add -A
   Done
Thinking: Staged, now committing
Progress: [3/3] Creating commit
Running: git commit -m "Enhance agent loop"
   [main abc123] Enhance agent loop
Agent: Task completed: Committed 1 file
```

#### Ambiguous request: "push it"
```
Thinking: User said "push it" but should confirm remote
Agent: Question: Push to which remote? (origin/upstream)
> User types: origin
Thinking: User confirmed origin, pushing
Running: git push origin HEAD
   Pushed to origin/main
Agent: Task completed: Pushed to origin/main
```

### Files Modified in This Refactor

1. `src/agent/protocol.rs` - New structs, action types, system prompt
2. `src/agent/validation.rs` - ParsedResponse, parse_response()
3. `src/agent/loop.rs` - New events, run_agent_loop_with_config()
4. `src/agent/context.rs` - Sliding window implementation
5. `src/agent/mod.rs` - Export run_agent_loop_with_config
6. `src/config/settings.rs` - PlanningMode enum, new config fields
7. `src/executor/mod.rs` - Handle new action types
8. `src/tui/mod.rs` - New modes, events, render functions

---

## Loop Stuck Fix (December 2025)

### Problem
The agent would get stuck in infinite loops, repeatedly trying the same command (e.g., `git status`) even after duplicate detection fired. The "Already executed" message would appear, but the agent would keep trying.

### Solution: Consecutive Duplicate Counter

Added a `consecutive_duplicate_attempts` counter in `src/agent/loop.rs`:

```rust
let mut consecutive_duplicate_attempts = 0;
const MAX_DUPLICATE_ATTEMPTS: usize = 2;
```

**Behavior:**
1. When duplicate detected: Increment counter, show attempt number
2. When MAX_DUPLICATE_ATTEMPTS reached: Auto-complete with summary
3. When new action executes: Reset counter to 0

### Improved Task Completion Detection

Enhanced `is_task_complete()` to recognize more task types:
- **Status queries**: If `git status` ran successfully, task is done
- **"What" queries**: Treated as status-like inquiries
- **Branch operations**: Detects `git branch` and `git checkout`
- **Fallback**: Any successful action marks task as potentially complete

### Better Completion Summaries

Enhanced `generate_completion_summary()`:
- Status queries return the actual git status output
- Branch operations get descriptive summaries
- Generic fallback shows last successful action

### Expected Behavior After Fix

**Query: "show status"**
```
Iteration 1: git status -> success, output shown
Iteration 2: Agent tries git status again
  -> "Already executed: git status (attempt 1/2)"
  -> Task detected as complete
  -> Summary: "Repository status: ..."
✓ Task completed (no infinite loop)
```

---

## Read-Then-Respond Fix (December 2025)

### Problem
When user asked "read Cargo.toml and tell me the dependencies", the agent would:
1. Read the file ✓
2. Immediately auto-complete with "Task completed: Read: Cargo.toml" ✗
3. Never actually tell the user what the dependencies were

The `is_task_complete()` fallback was too aggressive - treating any successful action as completion.

### Solution

1. **More Conservative Auto-Complete** (`src/agent/loop.rs`)
   - Read operations are now recognized as "information gathering", not task completion
   - Won't auto-complete if the only successful action is a read
   - Requires the LLM to follow up with a `respond` action

2. **Better System Prompt** (`src/agent/protocol.rs`)
   - Added rule: "After read_file: ALWAYS follow up with respond containing the information"
   - Added explicit example showing the two-step pattern (read → respond)
   - Clarified when to use `done` vs `respond`

### Expected Behavior After Fix

**Query: "read Cargo.toml and tell me the dependencies"**
```
Iteration 1: read_file Cargo.toml -> success
Iteration 2: Agent now uses "respond" action
  -> "The dependencies are: tokio, serde, anyhow..."
✓ Task completed with actual answer
```

---

## System Prompt Refactor: Workspace Management Focus (December 2025)

### Overview
Refactored the agent's system prompt to establish a clear identity as a **workspace management specialist** rather than a general-purpose coding AI.

### Files Changed
- `src/agent/protocol.rs` - Replaced `build_agent_system_prompt()` content (lines 283-476)

### Key Changes

#### New Identity
The agent now identifies as "MyGit Agent - an autonomous development workspace assistant" with a focus on:
- Git operations (primary strength)
- File management and organization
- Code analysis (understanding, not writing)
- Documentation generation
- Development coordination (builds, tests)

#### Explicit Capabilities
- **Git Operations**: Branch management, commit workflows, history analysis, status tracking
- **File & Code Management**: Reading/analyzing code, finding patterns, small surgical changes (configs, docs, typos)
- **Development Coordination**: Running builds/tests, preparing releases, managing changelogs
- **Analysis**: Explaining structure, identifying dependencies, detecting issues (describe only)

#### Explicit Limitations
- No complete features or large code blocks
- No independent architectural decisions
- No refactoring without approval
- No code solutions when pointing out issues
- Stays within repository context

#### Working Style
- **Autonomous when clear**: Works independently on unambiguous tasks
- **Ask only when stuck**: Clarifies only for genuine ambiguity
- **Transparent**: Explains reasoning, shows what will change

### Preserved Behavior
- JSON response format unchanged (`AgentResponse` structure)
- All action types unchanged (`AgentAction` enum)
- Safety tier classifications unchanged
- Permission system unchanged

### Examples Updated
Replaced some examples to better reflect workspace management focus:
- Added "analyze the permission system" example showing analysis workflow
- Added "prepare for release 0.2.0" example showing planning capability
- Removed redundant examples

### Rationale
The goal is to create a "sweet spot" where the agent:
1. Has a clear, focused identity
2. Works autonomously on workspace tasks
3. Doesn't try to be a general-purpose coding AI
4. Provides transparency about what's happening
5. Only asks for user input when genuinely stuck

---

## Professional UI Polish + Full Settings Menu (December 2025)

### Overview
Two improvements to make the TUI more professional and functional:
1. Removed all emojis for a cleaner, terminal-native look
2. Made the Config menu option actually configurable with an interactive settings screen

### Files Changed
- `src/tui/mod.rs` - UI polish and settings implementation

### Part 1: Emoji Removal

Replaced emoji characters with text equivalents for a more professional appearance:

| Element | Before | After |
|---------|--------|-------|
| User message | `◆` | `>` |
| Agent message | `●` | `*` |
| System message | `✓` | `-` |
| Action | `→` | `$` |
| Thinking | `💭` | `.` |
| Progress | `📊` | `#` |
| Loading indicator | `⏳` | `[...]` |
| Branch display | `📂` | `[branch]` |
| Model display | `🤖` | (plain text) |
| Dangerous warning | `⚠` | `!` |
| Plan approval | `📋` | (plain text) |

### Part 2: Full Settings Configuration

Added a new `AppMode::Settings` that allows users to configure all settings from the TUI.

#### New Components
- `AppMode::Settings` enum variant
- `settings_index: usize` field in App struct
- `edited_config: Option<Config>` field for working copy

#### Configurable Settings (11 total)

| Category | Setting | Type | Controls |
|----------|---------|------|----------|
| Agent | Automation Level | Enum | `<` `>` to cycle: Safe/SemiAutonomous/Extreme |
| Agent | Show Thinking | Bool | `Space` to toggle |
| Agent | Planning Mode | Enum | `<` `>` to cycle: ShowAndApprove/ShowAndExecute/JustExecute |
| Agent | Max Iterations | Number | `<` `>` to adjust: 5-50 |
| Confirm | Auto-approve Safe | Bool | `Space` to toggle |
| Confirm | Double Confirm | Bool | `Space` to toggle |
| Permissions | Shell Commands | Enum | `<` `>` to cycle: Ask/Allowed/Denied |
| Permissions | File Writes | Enum | `<` `>` to cycle: Ask/Allowed/Denied |
| Permissions | Destructive Git | Enum | `<` `>` to cycle: Ask/Allowed/Denied |
| Files | Repo Only | Bool | `Space` to toggle |
| Ollama | Timeout (sec) | Number | `<` `>` to adjust: 30-300 |

#### Controls
- `Up/Down` - Navigate between settings
- `Left/Right` - Cycle enum values or adjust numbers
- `Space` - Toggle boolean values
- `S` - Save settings to config file
- `Esc` - Cancel without saving

#### Helper Functions Added
- `get_setting_info()` - Returns category, name, and display value for each setting
- `cycle_setting_next()` - Cycles enum values forward or increments numbers
- `cycle_setting_prev()` - Cycles enum values backward or decrements numbers
- `toggle_setting()` - Toggles boolean values
- `render_settings()` - Renders the settings overlay

### Usage

1. Press `/` to open the menu
2. Select "Config"
3. Navigate settings with arrow keys
4. Modify values with `Space`, `<`, or `>`
5. Press `S` to save or `Esc` to cancel

Settings are saved to the global config file (`~/.config/mygit/config.toml`).

---

## Provider Management UI Implementation (January 2026)

### Overview
Implemented a comprehensive provider management system in the TUI that allows users to switch between Ollama and Google LLM providers, configure API keys, test connections, and list provider-specific models.

### Files Changed
- `src/tui/mod.rs` - Major UI enhancements for provider management
- `src/config/settings.rs` - Added `LLMProvider` enum and Google config
- `src/llm/mod.rs` - Exported `GoogleClient`
- `src/llm/google.rs` - Implemented Google Gemini API client

### Key Changes

#### 1. New Menu Structure
- **Updated Menu Items**: Changed from `["Config", "Model", "Login", "Dev Mode", "Exit"]` to `["Config", "Provider", "Model", "Dev Mode", "Exit"]`
- **New "Provider" Menu**: Dedicated menu item for provider management, replacing the buried "Login" option

#### 2. New App Modes
Added two new UI modes to `AppMode` enum:
- `ProviderSelect`: Interactive provider selection and configuration screen
- `ProviderInput`: Input mode for entering API keys securely

#### 3. Provider Management State
Added new fields to `App` struct:
- `provider_menu_index: usize` - Tracks selection in provider menu (0-3)
- `provider_input: Input` - Input field for API keys
- `provider_test_result: Option<String>` - Stores connection test results

#### 4. Enhanced ContextInfo
Updated `ContextInfo` to track current provider:
- Added `provider: LLMProvider` field
- Status bar now displays provider name with color coding:
  - Ollama: Cyan
  - Google: Magenta

#### 5. Provider Menu Features

##### Menu Options:
1. **Switch Provider**: Toggle between Ollama and Google
2. **Configure API Key**:
   - Only relevant for Google provider
   - Securely masked input field
   - Shows status (✓ Set / ✗ Not Set)
3. **Test Connection**:
   - Runs health check on selected provider
   - Displays real-time feedback with ✓/✗ indicators
   - Shows error messages if connection fails
4. **Save & Exit**:
   - Persists settings to global config
   - Updates app context with new provider settings
   - Automatically switches model based on provider

#### 6. Provider-Specific Model Listing

Updated model selection logic in main menu:
- **Ollama**: Fetches models dynamically via API (`client.list_models()`)
- **Google**: Shows predefined list of available models:
  - gemini-2.0-flash-exp
  - gemini-1.5-pro
  - gemini-1.5-flash
- **Error Handling**: If Google API key not set, shows helpful message directing user to Provider menu

#### 7. Dynamic LLM Client Selection

Updated agent spawning logic to create appropriate client based on provider:
```rust
let client: Box<dyn LLMClient> = match config.provider {
    LLMProvider::Ollama => Box::new(OllamaClient::new(&config.ollama.url, &model)),
    LLMProvider::Google => {
        if let Some(ref api_key) = config.google.api_key {
            Box::new(GoogleClient::new(api_key, &model))
        } else {
            // Error: API key not configured
        }
    }
};
```

#### 8. UI/UX Improvements

##### Visual Feedback:
- Provider name displayed prominently in status bar
- Color-coded provider indicators
- Real-time connection test results
- Masked API key input for security

##### Navigation:
- Press `/` for main menu
- Select "Provider" option (↑↓ to navigate, Enter to select)
- Provider menu shows all options clearly
- Esc to cancel, Enter to confirm actions

##### Status Bar Format:
```
[NORMAL] [main] Ollama:qwen2.5-coder:7b
[NORMAL] [main] Google:gemini-2.0-flash-exp
```

#### 9. Configuration Integration

- Provider settings saved to global config (`~/.config/mygit/config.toml`)
- Settings persist across sessions
- Context info automatically updated when provider changes
- Model automatically switches to provider-specific default

### User Workflow

#### Switching to Google Provider:
1. Open TUI (`cargo run`)
2. Press `/` for menu
3. Select "Provider"
4. Navigate to "Switch Provider" and press Enter
5. Navigate to "Configure API Key" and press Enter
6. Enter Google API key (masked input)
7. Navigate to "Test Connection" to verify
8. Navigate to "Save & Exit" to persist changes

#### Selecting Provider-Specific Models:
1. Press `/` for menu
2. Select "Model"
3. See only models available for current provider
4. Select desired model with Enter

### Technical Details

#### New Functions Added:
- `render_provider_menu()`: Renders the provider selection overlay with input handling
- Updated `render_status()`: Shows provider in status bar with color coding
- Updated menu handling logic for provider selection

#### Key Integration Points:
- Config loading/saving with `Config::save_global()`
- LLM client instantiation based on provider
- Health check API for connection testing
- Model listing APIs (provider-specific)

### Benefits

1. **User-Friendly**: Clear visual interface for provider management
2. **Secure**: API keys are masked during input
3. **Reliable**: Connection testing before use
4. **Flexible**: Easy switching between providers
5. **Informative**: Real-time feedback on provider status
6. **Persistent**: Settings saved globally across sessions

### Testing Performed

- ✅ Provider switching between Ollama and Google
- ✅ API key configuration and masking
- ✅ Connection validation for both providers
- ✅ Model listing shows correct provider-specific models
- ✅ Settings persistence after restart
- ✅ Status bar updates correctly
- ✅ Build succeeds with no errors (warnings only)

### Critical Bug Fixes

#### Bug #1: Config Reload After Provider Switch

**Issue**: After switching providers and saving, the agent would still use the old provider because the `config` variable was loaded once at startup and never refreshed.

**Symptom**:
```
- ✓ Google API connection successful!
- Provider settings saved!
> You: hello
- Error: LLM Error: Ollama API error (404 Not Found):
  {"error":"model 'gemini-2.0-flash-exp' not found"}
```

**Fix**: Made `config` mutable and added `Config::load()` calls after:
1. Saving provider settings in Provider menu
2. Saving general settings in Settings menu

Now the config is immediately reloaded after any save operation, ensuring the agent always uses the correct provider.

#### Bug #2: Model Selection Not Persisting

**Issue**: When selecting a model from the Model menu, it would update the display but not save to config. After reloading the config (e.g., after saving provider settings), the model would reset to the default.

**Symptom**:
```
> User selects "gemini-2.0-flash-exp" from Model menu
- Model set to: gemini-2.0-flash-exp
> User saves provider settings
> Model resets back to default (e.g., gemini-1.5-pro)
```

**Fix**: Updated ModelSelect mode to:
1. Update the appropriate config field (`config.ollama.model` or `config.google.model`) based on current provider
2. Save the config to disk immediately after selection
3. Only update `app.context_info.model` if save succeeds

Now model selections persist across config reloads and app restarts.

### Testing Status

- ✅ Provider switching between Ollama and Google
- ✅ API key configuration and masking
- ✅ Connection validation for both providers
- ✅ Model listing shows correct provider-specific models
- ✅ Settings persistence after restart
- ✅ Status bar updates correctly
- ✅ Build succeeds with no errors (warnings only)
- ✅ **Config reload after provider switch (critical fix)**

### Future Enhancements

- Add OpenAI provider support (already stubbed in `src/llm/openai.rs`)
- Support custom model lists for Google via API
- Add model search/filter functionality
- Add connection status indicators in main chat view
- Support multiple API keys for different providers
- Add provider-specific advanced settings (temperature, max tokens, etc.)

---

## Smart Provider Detection & Unified Model Selector (January 2026)

### Overview
Completely redesigned the LLM provider and model selection system to be more intuitive and automatic. The app now intelligently detects available providers at startup and offers a unified model selection menu that shows models from all providers.

### Files Changed
- `src/llm/model.rs` - Added `ModelInfo`, `ProviderType`, `ProviderStatus` structs
- `src/llm/google.rs` - Added `list_models()` and `list_models_with_info()` methods
- `src/llm/ollama.rs` - Added model size parsing, `list_models_with_info()`, `get_largest_model()`
- `src/llm/detection.rs` - **NEW** Smart provider detection module
- `src/llm/mod.rs` - Updated exports
- `src/main.rs` - Integrated smart startup detection
- `src/config/settings.rs` - Added `Display` impl for `LLMProvider`
- `src/tui/mod.rs` - Added `UnifiedModelState`, `UnifiedModelSelect` mode, and new render functions

### Key Features

#### 1. Smart Startup Detection
On launch, the app now:
1. Checks if Ollama is running
2. If Ollama available → auto-selects the **largest model** by parameter count
3. If Ollama unavailable → checks for Google Gemini API key
4. If Google configured → uses Gemini
5. If neither available → shows helpful setup instructions

**Example startup output:**
```
Using Ollama with model: qwen2.5-coder:32b
```

Or if no provider available:
```
No LLM provider available!

To get started, set up one of the following:

  Option 1: Start Ollama (local LLM)
    $ ollama serve
    $ ollama pull llama3.2

  Option 2: Set Google Gemini API key
    $ mygit config set google.api_key <YOUR_API_KEY>
```

#### 2. Unified Model Selector

New model selection UI accessible via `/` → "Model":

```
┌─────────────────── SELECT MODEL ───────────────────┐
│                                                     │
│   [ Ollama (5) ]  |  [ Google Gemini (12) ]        │
│                                                     │
│  Model Name                              Size       │
│  ─────────────────────────────────────────────────  │
│  > qwen2.5-coder:32b                     32.0B     │
│    qwen2.5-coder:7b                      7.0B      │
│    llama3.2:latest                       3.0B      │
│    deepseek-r1:7b                        7.6B      │
│                                                     │
│  Tab: Switch Provider | ↑↓: Navigate | Enter: Select│
└─────────────────────────────────────────────────────┘
```

**Features:**
- Two-tab interface showing both Ollama and Google models
- Displays model sizes (parameter counts)
- Search functionality with `/` key
- Tab to switch between providers
- Automatically switches provider when selecting a model from different provider

#### 3. Model Metadata

New data structures for richer model information:

```rust
pub struct ModelInfo {
    pub name: String,
    pub display_name: String,
    pub provider: ProviderType,
    pub parameter_size: Option<u64>,  // In millions (7000 = 7B)
    pub description: Option<String>,
}

pub enum ProviderType {
    Ollama,
    Google,
}
```

#### 4. Google Model Listing

Added ability to fetch models from Google API:
- `list_models()` - Returns list of model names
- `list_models_with_info()` - Returns full `ModelInfo` structs
- Filters for models that support `generateContent`

#### 5. Ollama Model Size Parsing

Enhanced Ollama integration to parse model sizes:
- Parses `parameter_size` field (e.g., "7.6B", "134.52M", "1.5B")
- `parse_parameter_size()` - Converts size strings to numbers
- `get_largest_model()` - Finds model with most parameters

### Technical Details

#### New Module: `src/llm/detection.rs`

```rust
pub async fn detect_providers(config: &Config) -> ProviderDetectionResult {
    // Returns which providers are available and recommended model
}

pub async fn fetch_all_models(config: &Config) -> (Vec<ModelInfo>, Vec<ModelInfo>) {
    // Returns (ollama_models, google_models) for unified selector
}
```

#### New TUI State

```rust
pub struct UnifiedModelState {
    pub provider_index: usize,       // 0 = Ollama, 1 = Google
    pub model_index: usize,
    pub ollama_models: Vec<ModelInfo>,
    pub google_models: Vec<ModelInfo>,
    pub search_query: String,
    pub loading: bool,
    pub error: Option<String>,
}
```

#### New AppModes

```rust
UnifiedModelSelect,    // Main model selection mode
UnifiedModelSearch,    // Search filter mode
```

### User Workflow

#### Automatic at Startup:
1. App launches
2. Detects Ollama running with 5 models
3. Finds largest model (qwen2.5-coder:32b)
4. Auto-connects and shows in status bar

#### Manual Model Selection:
1. Press `/` for menu
2. Select "Model"
3. See all Ollama models (Tab to see Google models)
4. Arrow keys to navigate, Enter to select
5. Model and provider updated, saved to config

### Benefits

1. **Zero Configuration**: Works out of the box with Ollama
2. **Smart Defaults**: Picks the best available model automatically
3. **Unified View**: See all providers in one place
4. **Provider Agnostic**: Seamlessly switch between Ollama and Google
5. **Future Ready**: Architecture supports adding more providers

### Testing Performed

- ✅ Startup detection with Ollama running
- ✅ Automatic largest model selection
- ✅ Fallback to Google when Ollama unavailable
- ✅ Unified model menu renders correctly
- ✅ Tab switches between providers
- ✅ Model selection updates config
- ✅ Provider switching works from model menu
- ✅ Search filters models correctly
- ✅ Build succeeds with no errors

---

## UC-1 & UC-2 Use Case Implementation (January 2026)

### Overview
Implemented enhanced context gathering, explain-before-execute functionality, undo command tracking, and improved system prompts to support two key use cases:

**UC-1: Safe Git Command Execution**
- "Commit all changes"
- "Undo my last commit"
- "Reset this branch to main"

**UC-2: Repository Understanding**
- "What changed since yesterday?"
- "Why is my branch dirty?"
- "What's different from main?"

### Files Changed

#### 1. `src/agent/context.rs`

**New structs:**
- `BranchInfo` - Tracks branch name, tracking remote, ahead/behind counts
- `RecentActivity` - Tracks commits today/yesterday, files changed since yesterday
- `ExecutedAction` - Tracks executed actions with undo commands for recovery

**New fields in `AgentContext`:**
- `unstaged_diff: String` - Working tree changes (not staged)
- `branch_info: BranchInfo` - Branch tracking and comparison info
- `recent_activity: RecentActivity` - Time-based activity data
- `action_history: Vec<ExecutedAction>` - For undo support

**New methods:**
- `gather_branch_info()` - Gathers tracking remote and ahead/behind counts via git commands
- `gather_recent_activity()` - Gathers commits today/yesterday and files changed
- `record_action()` - Records action for undo tracking (keeps last 20)
- `get_last_undoable()` - Returns last action that can be undone
- `summarize_status()` - Human-readable summary of git status (staged, modified, untracked counts)

**Updated `format_for_prompt_with_window()`:**
- Shows branch tracking status (e.g., "3 ahead, 2 behind origin/main")
- Shows working tree summary (e.g., "2 staged, 3 modified, 1 untracked")
- Shows recent activity (commits today/yesterday, last commit time)
- Shows last undoable action when available

#### 2. `src/agent/protocol.rs`

**New methods on `AgentAction`:**
- `consequences()` - Returns human-readable consequences of the action
- `compute_undo()` - Returns the git command to undo this action (if possible)

**New helper functions:**
- `git_consequences()` - Detailed consequences for git commands (commit, reset, push, merge, etc.)
- `shell_consequences()` - Consequences for shell commands
- `compute_git_undo()` - Undo commands for git operations (commit → reset, add → reset, etc.)

**System prompt enhancements - new sections added:**
- "HANDLING TEMPORAL QUERIES" - For "what changed since yesterday?" type questions
- "HANDLING WHY IS MY BRANCH DIRTY?" - For explaining uncommitted changes
- "HANDLING BRANCH COMPARISONS" - For "what's different from main?" questions
- "UNDO OPERATIONS" - For handling undo/revert/rollback requests

#### 3. `src/agent/loop.rs`

**Enhanced `AgentEvent::ActionRequest`:**
- Added `reasoning: String` field - Why the agent chose this action
- Added `consequences: Vec<String>` field - What will happen if action executes

**Updated `handle_action_execution()`:**
- Now accepts `reasoning` parameter
- Records actions for undo tracking via `context.record_action()`
- Passes reasoning and consequences when sending ActionRequest events

#### 4. `src/tui/mod.rs`

**Enhanced `PendingActionState`:**
- Added `reasoning: String` field
- Added `consequences: Vec<String>` field

**Updated `set_pending_action()`:**
- Accepts reasoning and consequences parameters

**Redesigned `render_confirmation_panel()`:**
- Shows "Why" section with agent's reasoning (magenta border)
- Shows "Command" section with the action (cyan border)
- Shows "What will happen" section with bulleted consequences (yellow/red based on safety)
- Dynamically adjusts layout based on available content

#### 5. `src/main.rs`

**Updated CLI ActionRequest handler:**
- Displays reasoning before action (magenta color)
- Displays consequences as bulleted list (yellow color)
- Pattern match updated for new ActionRequest fields

### Use Case Coverage

#### UC-1: Safe Git Command Execution

| Feature | Implementation |
|---------|----------------|
| Safety tiers | Existing (Safe/Standard/Dangerous) |
| Explain before execute | New: reasoning + consequences in confirmation dialog |
| Confirm before execute | Existing permission system |
| Dry run | Existing `--dry-run` flag |
| Undo mechanism | New: `compute_undo()` + action history tracking |

#### UC-2: Repository Understanding

| Feature | Implementation |
|---------|----------------|
| Context gathering | Enhanced: branch_info, recent_activity, unstaged_diff |
| Status summarization | New: `summarize_status()` method |
| Time-based queries | New: `RecentActivity` struct |
| Branch comparison | New: `BranchInfo` with ahead/behind counts |
| System prompt guidance | New: sections for temporal/dirty/comparison queries |

### Testing

Build and test:
```bash
cargo build
cargo test
```

Manual testing prompts:
```bash
# UC-1 tests
cargo run -- agent "commit all changes"
cargo run -- agent "undo my last commit"
cargo run -- agent --dry-run "reset this branch to main"

# UC-2 tests
cargo run -- agent "what changed since yesterday?"
cargo run -- agent "why is my branch dirty?"
cargo run -- agent "what's different from main?"
```

### Build Status
- ✅ Build succeeds with 1 warning (unused `name` field in BranchInfo)
- ✅ Tests pass (0 tests defined)

---

## Complete README Overhaul (January 2026)

### Overview
Completely rewrote README.md to accurately document the current codebase architecture and features. The previous README was outdated and referenced a different project structure.

### What Changed

**Old README Issues:**

- Referenced non-existent modules (`ai/`, `platform/`, `workflows/`)
- Listed features not yet implemented (GitHub/GitLab integration, OAuth)
- Had incorrect directory structure diagram
- Missing documentation for actual features

**New README Includes:**

1. **Accurate Project Overview** - Describes MyGit as a local LLM-powered Git CLI agent

2. **Complete Feature Documentation:**
   - AI-powered git operations (natural language, commit messages, multi-step automation)
   - LLM support (Ollama local, Google Gemini cloud, auto-detection)
   - Interactive TUI features
   - Safety & permission system

3. **Quick Start Guide** - Step-by-step from install to first run

4. **Accurate Architecture Section:**
   - Correct module structure (`agent/`, `llm/`, `executor/`, `cli/`, `config/`, `tui/`)
   - Agent loop diagram with explanation
   - All 9 action types documented with safety classifications

5. **Full Configuration Reference:**
   - Global and repo-local config paths
   - Complete TOML config example (~60 lines)
   - Explanation of every setting

6. **LLM Provider Documentation:**
   - Ollama setup with recommended models
   - Google Gemini setup with API key configuration
   - Provider auto-detection explanation

7. **Permission System Documentation:**
   - Safety tiers (Safe/Standard/Dangerous) with examples
   - Automation levels (Safe/Semi-Autonomous/Extreme)
   - Permission categories and states
   - Session override options

8. **Complete CLI Reference:**
   - All global options documented
   - All commands with usage examples

9. **TUI Features Section:**
   - Main interface components
   - Modal dialogs (confirmation, plan approval, clarification)
   - Keyboard shortcuts table
   - Event display types

10. **Contributing Section** - Development setup instructions

### Files Modified

- `README.md` - Complete rewrite (~580 lines)
- `changes.md` - Added this entry

---

## Plan Mode Foundation: Storage Layer + Plan Types (February 2026)

### Overview
First session of the Plan Mode & Pattern Learning implementation. Established the data foundation: rich plan types and SQLite-backed storage for workflows, preferences, conventions, and operation history.

### What Was Built

#### 1. Plan Types (`src/plan/types.rs`)
- `Plan` struct with id, intent, steps, safety_level, created_at
- `Step` struct with command, is_git flag, reversibility, approval requirement
- `SafetyLevel` enum (High/Medium/Low) auto-classified from steps
- `ExecutionMode` enum (Auto/StepByStep/Interactive)
- `PlanResult` and `StepResult` for execution outcomes
- Safety classification using a self-contained destructive command list (no dependency on agent module)
- `Plan::rollback_points()` identifies safe rollback positions
- Display implementations for CLI output

#### 2. SQLite Storage (`src/storage/database.rs`)
- `Database` struct wrapping rusqlite Connection
- `open(path)`, `open_user()` (~/.mygit/workflows.db), `open_project()` (.git/mygit/conventions.db)
- Auto-creates schema on open (CREATE IF NOT EXISTS)
- **Workflows**: insert, update_stats, find_workflows (keyword search), list, delete
- **Preferences**: set (upsert with confidence bump), get
- **Operation History**: record
- **Conventions**: save (upsert), load_all, clear
- Keyword search splits intent into words and matches any via SQL LIKE
- Results ordered by success_rate * frequency

#### 3. Library Crate (`src/lib.rs`)
- Added lib.rs exposing `storage` and `plan` modules for integration testing
- Added `[lib]` section to Cargo.toml for dual lib+bin setup
- Plan types are decoupled from agent module (no cross-crate dependency issues)

### Files Created
- `src/plan/mod.rs`
- `src/plan/types.rs`
- `src/storage/mod.rs`
- `src/storage/database.rs`
- `src/lib.rs`
- `tests/storage_test.rs`

### Files Modified
- `Cargo.toml` - Added rusqlite (bundled), chrono serde feature, [lib] section
- `src/main.rs` - Added `mod plan; mod storage;`

### Dependencies Added
- `rusqlite = { version = "0.31", features = ["bundled"] }` - SQLite with bundled C library
- `chrono` serde feature enabled for DateTime serialization

### Test Results
- 4 unit tests (plan safety classification, rollback points)
- 4 integration tests (DB schema, workflow CRUD, preference CRUD, convention CRUD)
- All 12 tests pass

### Architecture Decisions
- Plan types live in lib crate, decoupled from agent protocol (which is binary-only)
- Storage uses raw rusqlite, not an ORM - keeps it simple and auditable
- Schema uses `strftime('%s','now')` for timestamps (unix seconds)
- Workflow search uses SQL LIKE, not embeddings (sufficient for v1)
- Conventions table uses composite primary key (type + rule) for natural upsert

---

## Agent D: CLI Commands + Config + Wiring (February 2026)

### Overview
Implemented the integration/wiring layer (Agent D) for the Plan Mode system. Added CLI commands for plan mode, convention management, and pattern management. Added learning config to the config system. Wired all new library modules into the binary crate. Also created the learning module (Agent C's scope) since it was needed for compilation.

### What Was Built

#### 1. CLI Commands (`src/cli/args.rs`)
- `mygit plan "<intent>" [--dry-run] [--mode auto|step-by-step|interactive]` - Plan generation
- `mygit conventions discover|show|clear` - Convention management
- `mygit patterns list [--limit N]|delete <id>` - Pattern management
- New enums: `ConventionCommands`, `PatternCommands`

#### 2. LearningConfig (`src/config/settings.rs`)
- `LearningConfig` struct with `enabled`, `min_frequency`, `confidence_threshold`
- Added to main `Config` struct with `#[serde(default)]` for backwards compatibility

#### 3. Command Handlers (`src/main.rs`)
- `handle_plan()` - Retrieves similar workflows, loads conventions, builds pattern context
- `handle_conventions()` - Discover/show/clear project conventions via git analysis
- `handle_patterns()` - List/delete learned workflow patterns from user DB

#### 4. Learning Module (`src/learning/`)
- `recorder.rs` - Records plan executions and preferences to DB
- `retriever.rs` - Finds similar workflows and builds LLM context strings
- `mod.rs` - Re-exports public API

#### 5. Module Wiring
- `src/lib.rs` - Added `pub mod learning;` (conventions was already added by Agent A)
- `src/main.rs` - Added `mod conventions; mod learning;` and new command imports

### Files Created
- `src/learning/mod.rs`
- `src/learning/recorder.rs`
- `src/learning/retriever.rs`

### Files Modified
- `src/cli/args.rs` - Added Plan, Conventions, Patterns commands
- `src/config/settings.rs` - Added LearningConfig struct and field
- `src/main.rs` - Added module declarations, imports, and command handlers
- `src/lib.rs` - Added `pub mod learning;`

### Build Status
- All 18 tests pass (7 lib unit tests + 7 bin unit tests + 4 integration tests)
- Zero compilation errors, warnings only (unused items from not-yet-wired modules)

---

## Agent A Completion: Convention Discovery Integration Tests + Bug Fix (February 2026)

### Overview
Completed the remaining Agent A work: created comprehensive integration tests for the conventions module and fixed a compilation error in the learning module that was blocking the build.

### What Was Done

#### 1. Integration Tests (`tests/conventions_test.rs`) - NEW
Created 12 integration tests using `tempfile` and `git2` to programmatically create test repos:

**Commit analysis tests:**
- `test_conventional_commits_detected` - Verifies >60% conventional commits trigger detection
- `test_conventional_commits_not_detected_when_rare` - Verifies low ratio doesn't trigger
- `test_issue_references_detected` - Verifies GitHub-style `#123` references detected
- `test_jira_style_references_detected` - Verifies `PROJ-123` style references detected

**Branch analysis tests:**
- `test_branch_naming_detected` - Verifies `feature/` prefix pattern detected with 3+ branches
- `test_default_branch_detected` - Verifies main/master detection

**Merge analysis tests:**
- `test_rebase_strategy_detected_with_no_merges` - Linear history → `rebase_or_squash`
- `test_merge_strategy_detected_with_many_merges` - Many merge commits → `merge_commits`

**Database round-trip tests:**
- `test_save_and_load_conventions` - Save conventions, reload, verify all fields match
- `test_save_conventions_clears_previous` - Verify save replaces (not appends)

**End-to-end tests:**
- `test_discover_conventions_on_empty_repo` - Single-commit repo doesn't crash
- `test_discover_conventions_end_to_end` - Full repo with all patterns detected

#### 2. Bug Fix (`src/learning/retriever.rs`)
Fixed a partial-move compilation error: `w.success_rate()` was called after `w.intent` was moved. Extracted `success_rate` before the move.

### Files Created
- `tests/conventions_test.rs`

### Files Modified
- `src/learning/retriever.rs` - Fixed partial-move error (line 23-30)

### Test Results
- All 23 tests pass: 7 lib unit tests + 12 convention integration + 4 storage integration
- Zero compilation errors

### Agent A Status: COMPLETE
All deliverables from `AGENT_A_conventions.md` are done:
- `src/conventions/mod.rs` - Types, discover/save/load entry points
- `src/conventions/commits.rs` - Conventional commits + issue reference detection
- `src/conventions/branches.rs` - Branch naming pattern detection
- `src/conventions/merges.rs` - Merge strategy detection
- `src/lib.rs` - `pub mod conventions;` added
- `tests/conventions_test.rs` - 12 comprehensive integration tests

---

## Next Phase Planning: Audit + Work Division (February 2026)

### Overview
Performed a full project audit to assess what was delivered by the 4 original agents (A-D), identified gaps, and designed 3 major new features with work divided across 4 new agents (E-H).

### What Was Done

#### 1. Project Audit
- Verified all modules compile (21 warnings, zero errors)
- Confirmed 23/23 tests passing
- Assessed each module's implementation status (complete vs partial vs missing)
- Identified unused code: `StoredPreference`, `record_execution`, `record_preference`

#### 2. Gap Analysis (Original Agents)
- Agent A (Conventions): COMPLETE
- Agent B (Plan Executor): NOT IMPLEMENTED — `src/plan/executor.rs` missing
- Agent C (Learning Scorer + Workflows): NOT IMPLEMENTED — `scorer.rs` and `src/workflows/` missing
- Agent D (CLI Wiring): COMPLETE

#### 3. New Feature Design
Designed 3 major new features:
- **Git Worktrees in TUI** — manage multiple worktrees with status, add/remove/switch
- **Merge Conflict Visualization** — custom side-by-side/three-pane diff viewer with character-level highlights and configurable colors (alternative to VS Code's approach)
- **Smart Solutions** — AI-powered merge conflict resolution with 2-3 weighted plans, algorithmic + AI evaluation, user preference learning

#### 4. Work Division (4 New Agents)
- **Agent E**: Worktree Manager (`src/worktree/`, TUI panel, CLI commands)
- **Agent F**: Merge Conflict Parser + Diff Engine (`src/merge/parser.rs`, `differ.rs`, `resolver.rs`)
- **Agent G**: TUI Merge Conflict Viewer (`src/tui/merge_view.rs`, `diff_render.rs`, `theme.rs`)
- **Agent H**: Smart Solutions Engine (`src/merge/smart.rs`, `evaluator.rs`, learning loop)

### Files Created
- `NEXT_PHASE_WORK.md` — Full analysis document with feature specs and agent assignments
- `AGENT_E_worktrees.md` — Agent E instructions: git worktree manager (skills: `git-worktree-expert`, `ratatui-widget-builder`)
- `AGENT_F_conflict_parser.md` — Agent F instructions: merge conflict parser + diff engine (skills: `conflict-marker-expert`, `diff-algorithm-expert`)
- `AGENT_G_tui_merge_view.md` — Agent G instructions: TUI merge conflict viewer (skills: `ratatui-layout-master`, `tui-interaction-patterns`, `theme-system-designer`)
- `AGENT_H_smart_solutions.md` — Agent H instructions: smart solutions engine (skills: `llm-prompt-engineer`, `scoring-algorithm-designer`, `learning-loop-designer`)

### Architecture Decisions
- Agents E and F can run in parallel (no dependencies)
- Agents G and H depend on Agent F's types but can start with stubs
- Smart Solutions uses a dual evaluation system: fast algorithmic + optional AI review
- Merge theme is fully user-configurable via `[merge.theme]` in config.toml
- Worktrees use hybrid approach: `git2` for reads, `git` CLI for mutations

---

## Agent G: TUI Merge Conflict Viewer (February 2026)

### Overview
Implemented the interactive merge conflict resolution TUI — a full-screen side-by-side diff viewer with character-level highlighting, conflict navigation, resolution keybindings, and a configurable color theme. This is Agent G's scope from the NEXT_PHASE_WORK plan.

### What Was Built

#### 1. Theme System (`src/tui/theme.rs`)
- `ResolvedTheme` struct with concrete ratatui Color values for all conflict viewer elements
- `parse_color()` function supporting named colors (red, dark_blue, light_green), hex (#RRGGBB), indexed (idx:N), with white fallback
- `ResolvedTheme::from_config()` converts string-based `ConflictTheme` config into resolved Colors
- 6 unit tests covering named colors, dark variants, hex, indexed, unknown fallback, and default theme

#### 2. Diff Rendering Helpers (`src/tui/diff_render.rs`)
- `render_ours_line()` / `render_theirs_line()` — Convert `LineDiff` into styled ratatui `Line` with gutter line numbers
- Character-level diff highlighting: removed chars get underlined red on ours side, added chars get underlined green on theirs side
- `render_base_line()` for diff3 three-pane mode
- `render_resolved_lines()` for the result/preview pane
- Pure functions with no state dependency (input: merge types + theme, output: styled Lines)

#### 3. Merge View State & Rendering (`src/tui/merge_view.rs`)
- `MergeViewState` struct with conflict file, pre-computed hunk diffs, navigation state, layout mode, theme
- Two sub-modes: `FileSelect` (pick which conflicted file to open) and `Normal` (view/resolve conflicts)
- `MergeLayout::SideBySide` (default) and `MergeLayout::ThreePane` (for diff3 with base)
- State methods: `next_hunk`, `prev_hunk`, `resolve_current`, `scroll_up/down`, `toggle_layout`, `save`
- Full-screen rendering with 4 regions: title bar, diff panes, result pane, controls bar
- File select screen with list navigation and conflict counts
- Save function that writes resolved content and re-reads to keep state in sync

#### 4. Config Integration (`src/config/settings.rs`)
- `ConflictTheme` struct — serde-friendly with 12 string color fields (ours_bg, theirs_bg, char_added, char_removed, etc.)
- `MergeViewConfig` struct with theme, default_layout, show_line_numbers
- Added `merge_view: MergeViewConfig` to main `Config` struct with `#[serde(default)]`

#### 5. TUI Integration (`src/tui/mod.rs`)
- Added `AppMode::MergeConflict` variant to enum
- Added `merge_state: Option<MergeViewState>` to `App` struct
- Added "Conflicts" to MENU_ITEMS menu
- Menu handler: lists conflicted files via `git diff --name-only --diff-filter=U`, enters file select mode
- Full-screen render dispatch: early return in `ui()` for MergeConflict mode
- Keybindings for both sub-modes:
  - FileSelect: Up/Down navigate, Enter opens file, Esc exits
  - Normal: j/k or Up/Down for hunk nav, 1/o for Ours, 2/t for Theirs, 3/b for Both, Tab for layout toggle, PgUp/PgDn for scroll, Ctrl+S to save, Esc to go back

### Files Created
- `src/tui/theme.rs`
- `src/tui/diff_render.rs`
- `src/tui/merge_view.rs`

### Files Modified
- `src/config/settings.rs` — Added ConflictTheme, MergeViewConfig, merge_view field on Config
- `src/tui/mod.rs` — Added module declarations, AppMode::MergeConflict, App.merge_state, MENU_ITEMS, keybindings, full-screen render dispatch

### Test Results
- Build: compiles (warnings only, all pre-existing)
- 6 new unit tests (theme::parse_color, theme::resolved_theme_default) — all pass
- All existing tests still pass (34/35 lib + all integration tests; 1 pre-existing failure in differ)

---

## Agent H: Smart Solutions Engine (February 2026)

### Overview
Implemented the AI-powered merge conflict resolution system ("Smart Solutions"). Includes LLM prompt construction for generating 2-3 resolution plans per conflict, a dual evaluation system (algorithmic + AI review), a TUI popup for presenting plans, configuration, and a learning loop that records user choices to improve future suggestions.

### What Was Built

#### 1. Smart Resolution Engine (`src/merge/smart.rs`) - NEW
- `SmartSolutionRequest` — context struct (hunk, file path, language, surrounding code, conventions, user prefs)
- `SmartSolutionPlan` — generated resolution with strategy name, resolved lines, explanation, confidence, evaluated score, trust level
- `TrustLevel` enum (High > 0.8, Medium > 0.5, Low)
- `build_prompt()` — detailed LLM prompt with file context, language, conflict sides, base (diff3), conventions, strict JSON format
- `build_evaluation_prompt()` — second prompt for AI-based plan evaluation
- `parse_plans_response()` — robust parser handling direct JSON, markdown-wrapped, and embedded JSON
- `detect_language()` — 20 languages from file extension
- `load_user_prefs()` — loads merge preferences from DB

#### 2. Algorithmic Evaluator (`src/merge/evaluator.rs`) - NEW
- `ScoringWeights` — configurable: LLM 30%, pattern 25%, syntax 20%, convention 15%, simplicity 10%
- `evaluate_algorithmic()` — pure computation scoring, sorts by score descending
- 5 scoring functions: pattern alignment, syntax heuristics, convention check, simplicity, LLM confidence
- `apply_ai_scores()` — blends AI evaluation scores with algorithmic scores
- `EvaluationMode` enum (Algorithmic/AiReview/Both)

#### 3. Config (`src/config/settings.rs`) - MODIFIED
- `SmartMergeConfig`: enabled, evaluation_mode, auto_apply_threshold (0.85), max_plans (3), trust_ai_level

#### 4. Learning Loop (`src/learning/recorder.rs`) - MODIFIED
- `record_resolution()` — updates merge.default_style, merge.trust_ai, merge.edit_rate preferences + operation_history

#### 5. TUI Popup (`src/tui/mod.rs`) - MODIFIED
- `AppMode::SmartSolutions` + `SmartSolutionsState` + `render_smart_solutions()`
- Centered overlay with plan list, expandable code previews, trust color coding, keybindings (Up/Down, Enter, 1-3, a, Esc)

### Files Created
- `src/merge/smart.rs`, `src/merge/evaluator.rs`, `tests/smart_resolution_test.rs`

### Files Modified
- `src/merge/mod.rs`, `src/config/settings.rs`, `src/learning/recorder.rs`, `src/learning/mod.rs`, `src/tui/mod.rs`

### Test Results
- 17 unit tests (smart.rs + evaluator.rs) — all pass
- 23 integration tests (smart_resolution_test.rs) — all pass
- 1 pre-existing failure in Agent F's differ.rs (not related)

---

## Agent F: Merge Conflict Parser + Diff Engine (February 2026)

### Overview
Implemented the data layer for the merge conflict system: a robust conflict marker parser, character-level diff engine using the `similar` crate, and resolution application logic. Also wired CLI commands for conflict management. This module lives in the library crate (`src/lib.rs`) with no TUI or LLM dependency.

### What Was Built

#### 1. Types (`src/merge/mod.rs`)
- `ConflictFile` — path, hunks, total_lines, with `resolved_count()` and `is_fully_resolved()` helpers
- `ConflictHunk` — id, line range, ours/theirs/base content, labels, optional resolution
- `Resolution` enum — AcceptOurs, AcceptTheirs, AcceptBoth, Custom, Smart
- `SmartResolution` — for Agent H's AI-resolved content
- `DiffSpan`, `DiffTag` — character-level diff rendering primitives
- `HunkDiff`, `LineDiff` — line-level diff results with char-level detail for changed lines

#### 2. Parser (`src/merge/parser.rs`)
- State machine parser handling standard 2-way and diff3 3-way conflict formats
- Handles: empty sides, missing labels, multiple conflicts per file, diff3 base markers
- `parse_conflict_file(path)` — reads file and parses
- `parse_conflicts(content)` — parses from string (returns empty Vec for clean files)
- Extracts branch labels from <<<<<<< and >>>>>>> markers
- Tracks 1-based line numbers for TUI navigation

#### 3. Diff Engine (`src/merge/differ.rs`)
- `diff_hunks(ours, theirs)` — line-level diff using Patience algorithm, with char-level detail for changed line pairs
- `diff_lines_char_level(old, new)` — character-level diff returning (old_spans, new_spans) for inline highlighting
- Uses `similar` crate's `TextDiff` for both line and char comparisons

#### 4. Resolver (`src/merge/resolver.rs`)
- `resolve_hunk(hunk, resolution)` — applies a resolution to get output lines
- `apply_resolution(content, file)` — replaces resolved conflict blocks in full file content, preserves unresolved markers
- `resolve_file(file)` — reads, resolves, writes back to disk
- `resolve_all_with(path, accept_ours)` — batch resolve all conflicts in a file
- `list_conflicted_files()` — runs `git diff --name-only --diff-filter=U`

#### 5. CLI Commands (`src/cli/args.rs`)
- `mygit conflicts list` — list files with conflicts and count
- `mygit conflicts show <file>` — colored display of each hunk (ours=cyan, theirs=magenta)
- `mygit conflicts accept-ours` — resolve all conflicts in all files accepting ours
- `mygit conflicts accept-theirs` — resolve all conflicts accepting theirs

#### 6. Dependencies
- Added `similar = "2"` to Cargo.toml for diff computation

### Files Created
- `src/merge/mod.rs`
- `src/merge/parser.rs`
- `src/merge/differ.rs`
- `src/merge/resolver.rs`
- `tests/merge_parser_test.rs` (17 tests)
- `tests/merge_differ_test.rs` (8 tests)

### Files Modified
- `src/lib.rs` — Added `pub mod merge;`
- `src/cli/args.rs` — Added `Conflicts(ConflictCommands)` and `ConflictCommands` enum
- `src/main.rs` — Added `mod merge;`, import, match arm, and `handle_conflicts()` handler
- `Cargo.toml` — Added `similar = "2"` dependency

### Also Fixed
- `src/merge/evaluator.rs:215` — Fixed ambiguous numeric type on `clamp()` call (Agent H's file)
- `src/merge/differ.rs` unit test — Fixed overly-specific span assertion for `similar` crate's char-level output

### Test Results
- 140 total tests pass: 35 lib unit + 41 bin unit + 12 conventions integration + 8 differ integration + 17 parser integration + 23 smart integration + 4 storage integration
- Zero compilation errors, warnings only (pre-existing unused code)

---

## Agent E: Git Worktree Manager (February 2026)

### Overview
Implemented the complete Git Worktree Manager (Agent E scope from NEXT_PHASE_WORK.md). Added a new `src/worktree/` library module with worktree CRUD operations, per-worktree status gathering, CLI commands, TUI panel with navigation/management, and agent context awareness.

### What Was Built

#### 1. Worktree Library Module (`src/worktree/`)

**`mod.rs`** — Core types:
- `WorktreeInfo` — Branch, HEAD commit, main/current flags, lock state, status
- `WorktreeStatus` — Clean, Dirty (modified/untracked/staged counts), Conflicts, Locked, Prunable, Unknown
- Display impl for human-readable status output
- Re-exports all public API functions

**`manager.rs`** — Git worktree operations:
- `list_worktrees(repo_path)` — Parses `git worktree list --porcelain` output
- `add_worktree(repo_path, wt_path, branch, create_branch)` — Creates worktree with optional `-b` flag
- `remove_worktree(repo_path, wt_path, force)` — Removes worktree, supports `--force`
- `prune_worktrees(repo_path)` — Prunes stale entries with `--verbose`
- `lock_worktree(repo_path, wt_path, reason)` — Locks worktree with optional reason
- `unlock_worktree(repo_path, wt_path)` — Unlocks a locked worktree

**`status.rs`** — Per-worktree status gathering:
- `get_worktree_status(wt_path)` — Runs `git -C <path> status --porcelain`
- Counts modified, untracked, staged, and conflict markers
- Detects UU/AA/DD/AU/UA/DU/UD conflict patterns

#### 2. CLI Commands (`src/cli/args.rs`)
- `mygit worktree list` — Show all worktrees with status
- `mygit worktree add <branch> [-p path] [-b]` — Create worktree (with optional new branch)
- `mygit worktree remove <path> [--force]` — Remove a worktree
- `mygit worktree prune` — Prune stale entries

#### 3. Command Handler (`src/main.rs`)
- `handle_worktree()` — Full CLI handler for all worktree subcommands
- Default worktree path: sibling directory named `<repo>-<branch>`
- Colored output with status indicators

#### 4. TUI Integration (`src/tui/mod.rs`)
- `AppMode::WorktreeManager` — New TUI mode
- "Worktrees" added to main menu (accessible via `/`)
- Worktree list with color-coded status indicators:
  - Green `●` for current worktree, `○` for others
  - Color per status: green (clean), yellow (dirty), red (conflicts), magenta (locked)
- Keybindings: `Up/Down` navigate, `R` remove, `P` prune, `Esc` back
- `render_worktree_panel()` — Overlay panel with centered layout

#### 5. Agent Context Awareness (`src/agent/context.rs`)
- `active_worktree: Option<PathBuf>` field on `AgentContext`
- `git_cmd()` helper — Builds git commands with `-C <path>` when a worktree is active
- All git commands in `refresh()` now use `git_cmd()` for worktree-aware operation

#### 6. Integration Tests (`tests/worktree_test.rs`)
9 tests using `tempfile` for isolated repos:
- `test_list_worktrees_single` — Fresh repo has exactly 1 worktree
- `test_add_worktree` — Add worktree, verify in list
- `test_add_worktree_new_branch` — Create new branch with `-b`
- `test_remove_worktree` — Add then remove, verify cleanup
- `test_prune_stale_worktree` — Delete dir manually, prune cleans up
- `test_worktree_status_dirty` — Modified file detected
- `test_worktree_status_clean` — Clean repo detected
- `test_worktree_status_untracked` — Untracked files detected
- `test_cannot_add_duplicate_branch` — Same branch in two worktrees fails

### Files Created
- `src/worktree/mod.rs`
- `src/worktree/manager.rs`
- `src/worktree/status.rs`
- `tests/worktree_test.rs`

### Files Modified
- `src/lib.rs` — Added `pub mod worktree;`
- `src/cli/args.rs` — Added `Worktree(WorktreeCommands)` variant and `WorktreeCommands` enum
- `src/main.rs` — Added `mod worktree;`, import, match arm, `handle_worktree()` handler
- `src/tui/mod.rs` — Added `WorktreeManager` mode, state fields, menu item, keybindings, render function
- `src/agent/context.rs` — Added `active_worktree` field, `git_cmd()` helper, updated `refresh()`
- `CLAUDE.md` — Updated module docs, CLI commands, and test listing

### Also Fixed (pre-existing issues)
- `src/merge/resolver.rs` — Fixed lifetime/borrow error: `resolved` Vec dropped while `result` still held borrows. Changed `result` to `Vec<String>` (owned).
- `src/llm/mod.rs` — Removed broken `#[cfg(feature = "cli")]` gate on `detection` module (feature was never defined, hiding `detect_providers` and `fetch_all_models` from the binary).

### Test Results
- 149 total tests pass: 35 lib unit + 41 bin unit + 12 conventions integration + 8 differ integration + 17 parser integration + 23 smart integration + 4 storage integration + 9 worktree integration
- Zero compilation errors, warnings only (pre-existing unused code from other modules)

---

## Documentation Consolidation: Version History + Roadmap (February 2026)

### Overview
Consolidated 12 scattered agent documentation files into two organized documents structured by version milestone.

### What Was Done

#### 1. Created `VERSION_HISTORY.md`
Complete feature summary of every module organized into 4 versions:
- **v1.0 (Foundation)**: Agent system, LLM, TUI, CLI, config, executor, use cases
- **v2.0 (Intelligence Layer)**: All 8 agents (A-H) — conventions, learning, plan types, worktrees, merge conflict system, smart solutions
- **v3.0 (Completion)**: Plan executor, scoring, edit learning, e2e flow (next phase)
- **v4.0 (Future Vision)**: Teams, NLP, CI, cross-repo, marketplace

Includes module dependency graph, design patterns summary, and full test breakdown (149 tests).

#### 2. Created `ROADMAP.md`
Actionable development roadmap with:
- Gap analysis (6 items: plan executor, scorer, edit learning, plan generation, workflow templates, dead code)
- v3 priorities (6 ordered tasks with file paths and dependencies)
- v4 exploration (3 tiers by value/effort)
- Architecture debt and cleanup recommendations

#### 3. Deleted 12 Old Files
Removed scattered agent MDs and planning docs:
- `AGENT_A_conventions.md` through `AGENT_H_smart_solutions.md` (10 files)
- `NEXT_PHASE_WORK.md`
- `Plan_Mode_Documentation.md`

### Files Created
- `VERSION_HISTORY.md`
- `ROADMAP.md`

### Files Deleted
- `AGENT_A_conventions.md`, `AGENT_B_conventions.md`, `AGENT_B_plan_executor.md`
- `AGENT_C_learning.md`, `AGENT_C_workflows.md`, `AGENT_D_cli_wiring.md`
- `AGENT_E_worktrees.md`, `AGENT_F_conflict_parser.md`
- `AGENT_G_tui_merge_view.md`, `AGENT_H_smart_solutions.md`
- `NEXT_PHASE_WORK.md`, `Plan_Mode_Documentation.md`

---

## Fix JSON Parse Errors for Ollama Models & API Clients (February 2026)

### Problem
Smaller Ollama models (e.g., `qwen3-coder:8b`) consistently failed to produce correctly structured JSON responses, causing 3/3 parse failures and breaking the agent loop. Common model mistakes included:
- `"action": "clarify"` (string instead of required object)
- Flat structures with `"type"` at root level alongside `"thinking"`
- Missing required fields in action objects (e.g., `{"type": "clarify"}` without `"question"`)

### Root Causes
1. System prompt showed action examples without the wrapping `"action": {...}` context, confusing models
2. Parser had no recovery logic for structurally valid JSON that didn't match the strict schema
3. OpenAI-compatible client's `extract_text()` fallback could return serialized JSON objects as literal strings

### Changes

#### 1. Robust JSON Recovery (`src/agent/validation.rs`)
- Added `try_recover_malformed()` function with 3 recovery strategies:
  - **Action-as-string**: `"action": "clarify"` → builds proper `{"type": "clarify", "question": "..."}` using thinking field or other context
  - **Flat structure**: `{"thinking": "...", "type": "git", "command": "status"}` → extracts action from root fields
  - **Missing-field defaults**: `{"type": "clarify"}` → fills `question` from thinking text
- Added `diagnose_parse_error()` for targeted error messages (e.g., "action must be an object, not a string")
- Added early empty/whitespace response validation
- Supports 10 action type aliases (e.g., `readfile`/`read`/`read_file`)

#### 2. Improved System Prompt (`src/agent/protocol.rs`)
- Replaced abstract format description with 9 complete copy-paste examples
- Explicitly states: `"action" MUST be an object with a "type" key. It is NEVER a string.`
- Each example shows the full `{"thinking":"...","action":{"type":"...","field":"..."}}` structure

#### 3. Fixed `extract_text()` (`src/llm/openai_compatible.rs`)
- Added object handling: extracts `text` field from objects, or serializes agent-action-like objects properly
- Prevents returning raw `{}` or `null` as literal strings to downstream parsers

### Files Modified
- `src/agent/validation.rs` — Added recovery functions, diagnostics, empty check
- `src/agent/protocol.rs` — Rewrote system prompt with full examples
- `src/llm/openai_compatible.rs` — Improved `extract_text()` fallback

### Test Results
- All 152 tests pass (35 lib + 45 bin + 72 integration)
- Zero compilation errors

---

## TUI Redesign: Large ASCII Logo + Simplified Layout (February 2026)

### Overview
Redesigned the TUI header to follow a Gemini CLI-inspired layout: a large block-character ASCII art logo displayed at the top of the chat area (no box/border), with essential shortcuts moved to the bottom-right status bar. Removed the old boxed header with its "COMMAND DECK" tips panel.

### What Changed

#### 1. New Large ASCII Logo
- Replaced `ASCII_LOGO_3D` (small line-art) with `ASCII_LOGO_LARGE` using `█` block characters (~46 chars wide, 6 lines tall)
- Replaced `ASCII_LOGO_COMPACT` with a smaller block-character version for narrow terminals
- Logo uses gradient coloring (yellow to orange) via existing `gradient_line_with_style()`
- Subtitle "AI-Powered Git Agent" shown below logo in muted color
- Hint text "Type a message to get started." below subtitle

#### 2. Header Section Removed
- Removed `render_header()` function entirely (bordered box with logo + tips split)
- Removed `build_logo_gradient_lines()` function
- Removed `dynamic_header_height()` function
- Removed `HEADER_MAX_HEIGHT`, `HEADER_CHAT_HEIGHT`, `STATUS_ROW_HEIGHT` constants
- Layout simplified from 4 chunks (header, content, input, status) to 3 chunks (content, input, status)

#### 3. Logo in Chat Area
- New `build_welcome_logo_lines()` function generates the logo as `Vec<Line>`
- `render_messages()` prepends logo lines when chat is empty
- Logo scrolls away naturally as messages appear

#### 4. Status Bar Shortcuts
- Added right-aligned shortcuts to status bar: `/ menu  ^C stop  ^Q exit`
- Status bar now has left side (provider, model, branch, status) and right side (shortcuts) separated by dynamic spacing

### Removed Items
- "COMMAND DECK" / "AGENT RUNNING" / "STANDBY" labels
- `[Enter] send` keybinding hint (self-evident)
- Branch info in header (already in status bar)
- Folder path display

### Files Modified
- `src/tui/mod.rs` — All changes in this single file

### Build Status
- Compiles with zero errors (pre-existing warnings only)

---

## 2026-02-14: Fix Agent Looping Without Progress

### Problem
The agent repeatedly executed the same action (e.g., reading README.md in a loop) until hitting the 20-iteration max, never making progress on the user's actual request. This made the tool unusable for anything beyond trivial tasks with small/medium local LLMs.

### Root Cause
The primary cause was that `num_ctx` was never sent to Ollama. Ollama defaults to a 2048-token context window when `num_ctx` is omitted, but the agent's prompt (system prompt + repository context + observations + runtime state) easily exceeds 2048 tokens. The model received a truncated prompt and could not see its previous actions or instructions not to repeat them.

### Changes

1. **Added `num_ctx: 16384` to all Ollama API requests** (`src/llm/ollama.rs`)
   - Added `num_ctx` field to `OllamaOptions` struct
   - Ensures the model sees the full prompt including past observations

2. **Switched to Ollama Chat API** (`src/llm/ollama.rs`, `src/llm/model.rs`, `src/agent/loop.rs`)
   - Added `chat()` method to `LLMClient` trait with default fallback to `generate()`
   - Implemented native `/api/chat` endpoint in `OllamaClient` using structured `system`/`user` message roles
   - Agent loop now uses `client.chat()` instead of concatenating "System:" and "User:" as plain text

3. **Lowered duplicate detection threshold** (`src/agent/loop.rs`)
   - Changed `MAX_DUPLICATE_ATTEMPTS` from 3 to 2
   - Improved duplicate warning message to be more directive

4. **Increased observation window from 3 to 5** (`src/agent/context.rs`)
   - Model now sees last 5 actions in full detail (was 3)

5. **Made temperature and context_window configurable** (`src/config/settings.rs`, `src/llm/ollama.rs`, `src/main.rs`, `src/tui/mod.rs`)
   - Added `temperature` and `context_window` fields to `OllamaConfig`
   - Added `with_llm_options()` builder method to `OllamaClient`
   - Default temperature changed from 0.3 to 0.4 for better exploration
   - Wired config values through all `OllamaClient` construction sites

### Config Example
```toml
[ollama]
temperature = 0.4
context_window = 16384
```

### Files Modified
- `src/llm/ollama.rs` — OllamaOptions, OllamaClient struct, chat API implementation
- `src/llm/model.rs` — Added `chat()` to LLMClient trait
- `src/agent/loop.rs` — Use chat API, lower duplicate threshold
- `src/agent/context.rs` — Increase observation window
- `src/config/settings.rs` — New config fields
- `src/main.rs` — Wire config to client construction
- `src/tui/mod.rs` — Wire config to client construction

### Build Status
- All 194 tests pass, zero new warnings

---

## 2026-02-14: Fix Chat API Connection Failure + num_ctx Default

### Problem
After the initial agent loop fixes, the `/api/chat` endpoint was failing with "Failed to connect to Ollama" on the second agent iteration for some models (e.g., smallthinker:latest). Also `num_ctx` was set to 16384 but modern models support 32K.

### Changes

1. **Added chat API fallback** (`src/llm/ollama.rs`) — If `/api/chat` fails, automatically falls back to `/api/generate` with text concatenation. Extracted native chat into private `chat_native()` method.

2. **Changed `num_ctx` default from 16384 to 32768** (`src/llm/ollama.rs`) — Matches standard 32K context window of modern local models.

3. **Added LLM retry logic** (`src/agent/loop.rs`) — Agent loop now retries once with a 2-second delay on transient LLM connection failures instead of immediately exiting.

### Files Modified
- `src/llm/ollama.rs` — Fallback chat logic, num_ctx default
- `src/agent/loop.rs` — LLM retry on transient failure

### Build Status
- All 194 tests pass

---

## 2026-02-14 — Agent Module Simplification

### Why
The agent module had grown to ~4500 lines across 6 files but only ~1900 were actually needed. Two-thirds was over-engineered defensive programming: heuristic validators that frequently misfired, an unused strict phase system, elaborate JSON recovery logic, aspirational features (undo tracking, activity metrics) that were never wired up, and 5-6 separate duplicate detectors with overlapping logic.

### Changes

1. **Simplified `validation.rs`** (746 → 168 lines) — Removed all malformed JSON recovery logic, diagnostic helpers, and fallback extraction. Kept clean JSON parse → deserialize → error path.

2. **Simplified `loop.rs`** (2182 → 762 lines) — Removed strict phase system, terminal output validation, path-based read redirects, clarify quality checks, task completion detection. Consolidated 5-6 separate duplicate detectors into one unified `LoopGuard` struct.

3. **Simplified `context.rs`** (811 → 452 lines) — Removed `BranchInfo`/`RecentActivity`/`ExecutedAction`/`LastExecution` structs and all associated gathering/tracking. Simplified plan progress tracking.

4. **Simplified `permissions.rs`** (272 → 166 lines) — Removed `CommandPattern` pattern tracking and unused methods. Kept `FileWriteScope` (used by config callers).

5. **Simplified `protocol.rs`** (514 → 324 lines) — Simplified consequences from 111 lines to ~20. Removed `compute_git_undo()`. Cleaned up system prompt.

### Summary
| File | Before | After | Reduction |
|------|--------|-------|-----------|
| validation.rs | 746 | 168 | -578 (77%) |
| loop.rs | 2182 | 762 | -1420 (65%) |
| context.rs | 811 | 452 | -359 (44%) |
| permissions.rs | 272 | 166 | -106 (39%) |
| protocol.rs | 514 | 324 | -190 (37%) |
| **Total** | **4533** | **1880** | **-2653 (59%)** |

### Files Modified
- `src/agent/validation.rs`
- `src/agent/loop.rs`
- `src/agent/context.rs`
- `src/agent/permissions.rs`
- `src/agent/protocol.rs`

### Build Status
- All tests pass (cargo build + cargo test)

---

## 2026-02-15 — TypeScript TUI Major Enhancement

### Context
Migrating MyGit from Rust to React Ink (TypeScript). This session implements 5 major TUI improvements: instant command menu, responsive layout with multi-logo system, expanded multi-provider model selection, scrollable chat with mouse wheel, and context/token usage bar.

### Changes

#### Phase 1: Instant "/" Menu + Custom Text Input
- **`src-ts/tui/App.tsx`** — "/" now triggers menu instantly on keystroke (moved from handleSubmit to onChange handler); added reactive terminal resize, model selector wiring, mouse scroll integration, token usage prop drilling
- **`src-ts/tui/components/CustomTextInput.tsx`** (NEW) — Replaces ink-text-input with custom implementation supporting cursor movement, backspace, delete, Ctrl+A/E/K/U, home/end
- **`src-ts/tui/components/InputBox.tsx`** — Switched from ink-text-input to CustomTextInput

#### Phase 2: Responsive Layout + Logo System
- **`src-ts/tui/logos.ts`** (NEW) — Ported all logo variants from Rust (Block, Simple3D, 3D styles, each with large+compact), plus TINY fallback. Selection logic picks best fit for terminal width + theme preference with fallback chain
- **`src-ts/tui/theme.ts`** — Added `logoFont` (per-theme logo style preference) and `danger` color to UiPalette
- **`src-ts/tui/components/WelcomeScreen.tsx`** — Dynamic logo selection via `selectLogo()`, accepts height prop, hides tips when terminal < 15 rows

#### Phase 3: Multi-Provider Model Selection
- **`src-ts/config/settings.ts`** — Added `ApiService` type (anthropic/openai/deepseek/moonshot/groq/cerebras/openrouter/gemini), `API_SERVICE_ENV_KEYS`, `API_SERVICE_BASE_URLS`, `ApiProviderConfig`, `mouseEnabled` UI config
- **`src-ts/llm/providers.ts`** — Complete rewrite: static model catalog for 8 providers (25+ models), service base URLs for OpenAI-compatible APIs, `detectAllProviders()`, `getModelsForService()`, `API_SERVICE_LABELS`
- **`src-ts/tui/components/ModelSelector.tsx`** (NEW) — Full-screen model selection overlay with provider tabs, search/filter, scrollable model list with descriptions, dynamic Ollama model fetching
- **`src-ts/cli/index.ts`** — Updated `detectProviders` → `detectAllProviders` reference

#### Phase 4: Scroll + Mouse Wheel
- **`src-ts/tui/components/ChatArea.tsx`** — Complete rewrite with scroll state (offset + auto-scroll), Up/Down/PageUp/PageDown keyboard scrolling, scroll indicators showing messages above/below
- **`src-ts/tui/hooks/useMouse.ts`** (NEW) — SGR mouse mode hook for scroll wheel events, enables/disables mouse escape codes on mount/cleanup

#### Phase 5: Context/Token Bar
- **`src-ts/agent/events.ts`** — Added `token_usage` event type
- **`src-ts/agent/graph.ts`** — Emits token usage estimate after each LLM call (chars/4 heuristic)
- **`src-ts/tui/hooks/useAgent.ts`** — Added `TokenUsage` type and state, handles token_usage events
- **`src-ts/tui/components/StatusBar.tsx`** — Added visual context bar: `CTX [████████  ] 72%` with color thresholds (normal/warning/danger/full)

### New Files
- `src-ts/tui/components/CustomTextInput.tsx`
- `src-ts/tui/logos.ts`
- `src-ts/tui/components/ModelSelector.tsx`
- `src-ts/tui/hooks/useMouse.ts`

### Build Status
- TypeScript compilation: 0 errors
- Bun build: success (4.0 MB bundle)

---

## 2026-02-22: Fix Git Command Parsing + File Read Truncation (TypeScript)

### Changes

#### 1. Fix git command parsing (`src-ts/executor/index.ts`)
**Problem:** `executeGit()` used `.split(/\s+/)` to split git commands into args, which broke on quoted arguments like `git commit -m "hello world"` (split the quoted string into separate args).

**Fix:** Changed `executeGit()` to pass the full command as a single string with `shell: true` instead of splitting into args. The shell now handles quoting properly, matching how `executeShell()` already works.

#### 2. Add file read truncation (`src-ts/executor/index.ts`)
**Problem:** `readFileContents()` read entire files with no size limit, risking memory issues and context overflow with large files. The Rust version truncates at 50KB.

**Fix:** Added `MAX_FILE_SIZE = 50_000` constant. After reading a file, if `content.length > MAX_FILE_SIZE`, the content is truncated to 50KB with a marker appended: `"\n... (file truncated, showing first 50KB)"`.

### Files Modified
- `src-ts/executor/index.ts` — Both changes in this single file

---

## 2026-02-22: Agent Cancellation Support (TypeScript TUI)

### Problem
Pressing Ctrl+C during an active agent run would exit the entire application. There was no way to cancel a running agent and return to the input prompt.

### Changes

#### 1. AbortSignal support in agent graph (`src-ts/agent/graph.ts`)
- Added `signal?: AbortSignal` to `AgentGraphOptions` interface
- Added abort checks at the top of `gatherContextNode`, `callLLMNode`, and `executeNode` — the three nodes that do real work
- When aborted, emits `{ type: "cancelled" }` event and returns `{ done: true }` to stop the graph

#### 2. AbortController in useAgent hook (`src-ts/tui/hooks/useAgent.ts`)
- Added `abortControllerRef` (React ref) to hold the current AbortController
- `sendRequest()` now creates a fresh AbortController per request and passes its signal to `runAgent()`
- Added `cancelAgent()` function that calls `abort()` on the current controller
- Exported `cancelAgent` in the `UseAgentReturn` interface

#### 3. Ctrl+C handler in App (`src-ts/tui/App.tsx`)
- Destructured `cancelAgent` from `useAgent()`
- Replaced the old Ctrl+C handler (which was Ollama-only and always called `exit()`) with a conditional handler:
  - If `isProcessing` is true: calls `cancelAgent()` to stop the agent
  - If not processing: calls `exit()` to quit the app
- Removed the `config.provider === "ollama"` guard so Ctrl+C works for all providers

### Files Modified
- `src-ts/agent/graph.ts` — AbortSignal in options, abort checks in 3 nodes
- `src-ts/tui/hooks/useAgent.ts` — AbortController ref, cancelAgent function, signal passing
- `src-ts/tui/App.tsx` — Conditional Ctrl+C handler with cancelAgent

---

## 2026-02-23: Agent Resilience Features (TypeScript)

### What Changed
Three resilience features added to the TypeScript agent and TUI:

1. **LLM Retry on Connection Failure** (`src-ts/agent/graph.ts`):
   - `callLLMNode` now wraps `model.invoke()` in a try/catch. On any connection error, it emits a "Retrying LLM connection..." thinking event, waits 2 seconds, then retries once before propagating the error.

2. **Silent Context Actions** (`src-ts/agent/graph.ts`):
   - Added `isSilentContextAction()` helper that identifies read-only git context-gathering commands (status, log, diff, show, rev-parse, branch).
   - `executeNode` now suppresses `execution_result` event emission for these silent commands, reducing UI noise while the agent gathers context.

3. **Chat Auto-Compact** (`src-ts/tui/hooks/useAgent.ts`):
   - In the `token_usage` event handler, when token usage exceeds 85% of the limit and there are more than 16 messages, older messages are trimmed to keep only the last 16, with a system note prepended indicating compaction occurred.

### Why
- Retry logic improves reliability when LLM providers have intermittent connectivity issues.
- Silent context actions reduce visual clutter in the TUI during agent reasoning.
- Auto-compaction prevents context overflow by proactively trimming chat history before hitting the token limit.

### Files Modified
- `src-ts/agent/graph.ts`
- `src-ts/tui/hooks/useAgent.ts`

---

## 2026-02-22: Rust → TypeScript Full Migration (Phases A–D)

### Overview
Completed the full migration from Rust to TypeScript across 4 phases, closing all gaps identified in the comprehensive gap analysis. The TypeScript implementation now has full feature parity with the Rust codebase plus additional capabilities.

### Phase A: Critical Fixes
1. **Git command parsing** (`src-ts/executor/index.ts`) — Replaced naive `.split(/\s+/)` with `shell: true` for proper quoted argument handling
2. **File read truncation** (`src-ts/executor/index.ts`) — Added 50KB limit with truncation marker
3. **Agent cancellation** (`src-ts/agent/graph.ts`, `src-ts/tui/hooks/useAgent.ts`, `src-ts/tui/App.tsx`) — AbortController support with Ctrl+C handler
4. **Permissions from config** (`src-ts/agent/permissions.ts`) — Added `PermissionManager.fromConfig(config)` factory
5. **Detached HEAD** (`src-ts/agent/context.ts`) — Fallback to `git rev-parse --short HEAD` when not on a branch

### Phase B: CLI Command Wrappers
6. **Conventions CLI** (`src-ts/cli/conventions.ts`) — discover, show, clear commands
7. **Conflicts CLI** (`src-ts/cli/conflicts.ts`) — list, show, accept-ours, accept-theirs commands
8. **Worktree CLI** (`src-ts/cli/worktree.ts`) — list, add, remove, prune commands
9. **Config init/edit** (`src-ts/cli/index.ts`) — Generate default config + open in $EDITOR
10. **Git summary/explain** (`src-ts/cli/git.ts`) — AI-powered commit summary and code/commit explanation

### Phase C: Polish & Advanced Features
11. **LLM retry** (`src-ts/agent/graph.ts`) — Single retry with 2s delay on connection failure
12. **Silent context actions** (`src-ts/agent/graph.ts`) — Suppress execution_result for read-only git commands
13. **Chat auto-compact** (`src-ts/tui/hooks/useAgent.ts`) — Trim to 16 messages when token usage > 85%
14. **Standalone plan mode** (`src-ts/plan/types.ts`, `src-ts/plan/engine.ts`, `src-ts/cli/plan.ts`) — Full plan generation via LLM, step-by-step execution (auto/step_by_step/interactive), safety classification
15. **Config sections** (`src-ts/config/settings.ts`) — Added LearningConfig and SmartMergeConfig with full defaults
16. **Learning retriever** (`src-ts/learning/retriever.ts`) — Added minFrequency and confidenceThreshold filtering
17. **Learning config wiring** (`src-ts/agent/graph.ts`, `src-ts/learning/memory.ts`) — Config values passed through to AgentMemory → KnowledgeRetriever
18. **Setup wizard** (`src-ts/cli/setup.ts`) — Interactive provider/model/automation config with connection test
19. **Install command** (`src-ts/cli/install.ts`) — Global install via bun wrapper script

### Phase D: Documentation Update
20. **CLAUDE.md** — Rewritten for TypeScript-only focus with complete CLI reference and module structure
21. **changes.md** — This entry documenting the full migration

### Files Created
- `src-ts/cli/conventions.ts`, `src-ts/cli/conflicts.ts`, `src-ts/cli/worktree.ts`
- `src-ts/cli/plan.ts`, `src-ts/cli/setup.ts`, `src-ts/cli/install.ts`
- `src-ts/plan/types.ts`, `src-ts/plan/engine.ts`
- `src-ts/tui/components/ClarifyPanel.tsx`, `src-ts/tui/components/PlanApprovalPanel.tsx`, `src-ts/tui/components/PrCommitsPanel.tsx`

### Files Modified
- `src-ts/agent/graph.ts` — LLM retry, silent actions, abort signal, learning config
- `src-ts/agent/context.ts` — Detached HEAD fallback
- `src-ts/agent/permissions.ts` — fromConfig() factory
- `src-ts/executor/index.ts` — Shell: true for git, file truncation
- `src-ts/tui/App.tsx` — Ctrl+C cancel handler
- `src-ts/tui/hooks/useAgent.ts` — Auto-compact, cancellation, learning config pass-through
- `src-ts/cli/index.ts` — Registered plan, setup, install commands
- `src-ts/cli/agent.ts` — Uses fromConfig() for permissions
- `src-ts/cli/git.ts` — Summary and explain subcommands
- `src-ts/config/settings.ts` — LearningConfig, SmartMergeConfig interfaces and defaults
- `src-ts/learning/retriever.ts` — minFrequency/confidenceThreshold filtering
- `src-ts/learning/memory.ts` — Pass config values to KnowledgeRetriever
- `CLAUDE.md` — Rewritten for TS-only focus

### Build Status
- TypeScript type check: 0 errors (`npx tsc --noEmit`)

---

## 2026-02-23 — Global Install: Fix and Setup

### What Changed
Fixed the `mygit install` command so it correctly installs the TypeScript CLI globally as a system-wide command.

### Why
User wanted `mygit` accessible from any directory (like `claude code`), but the install command had two bugs:
1. The entry point path was computed incorrectly — `path.resolve(import.meta.dir, "../index.tsx")` in `cli/install.ts` worked correctly, but was previously using the wrong fallback logic.
2. `fs.writeFile` silently failed when the target was a broken symlink; replaced with `fs.unlink` (remove existing) + `writeFileSync` to handle pre-existing symlinks.

Also removed the old shell alias `alias mygit=".../target/release/mygit"` that pointed to the archived Rust binary, from:
- `~/.bashrc`
- `~/.bash_profile`
- `~/.zshrc`

### How to Re-install After Moving the Repo
```bash
cd src-ts && bun run index.tsx install
```

### Files Modified
- `src-ts/cli/install.ts` — Fixed entry point resolution, replaced fs.writeFile with writeFileSync + pre-removal of existing symlink
- `~/.bashrc`, `~/.bash_profile`, `~/.zshrc` — Removed stale `mygit` alias pointing to Rust binary
- `~/.local/bin/mygit` — Created wrapper script (executable)

---

## 2026-02-26 — Thought Map: Interactive Plan Mode for TUI

### What

Added the "Thought Map" feature — an interactive plan-first mode in the TUI where the user and LLM co-author a tree of reasoning nodes. Instead of executing commands, the LLM generates a structured thought map that the user can navigate and refine node-by-node.

### Why

The existing plan mode was CLI-only and non-interactive (flat step list). The TUI needed an interactive planning experience where users feel like active participants — drilling into nodes, asking the LLM to develop specific areas, and watching the map grow organically.

### How It Works

- **Shift+Tab** toggles the input box between normal chat and plan mode (visual: blue border + `[PLAN]` tag)
- In plan mode, submitting text generates a thought map (3-7 root nodes with reasoning, dependencies, status)
- A two-pane ThoughtMapPanel displays: left = navigable node tree, right = selected node detail
- Typing + Enter while viewing the map refines the currently selected node via LLM
- Escape returns to normal input mode

### Files Created

- `src-ts/tui/thoughtMap/types.ts` — ThoughtMapNode, ThoughtMap, FlatNode, helpers (findNodeById, updateNodeById, flattenNodes)
- `src-ts/tui/thoughtMap/llm.ts` — generateThoughtMap(), refineThoughtMapNode(), defensive JSON parsing
- `src-ts/tui/hooks/useThoughtMap.ts` — State hook for generation, refinement, node selection
- `src-ts/tui/components/ThoughtMapPanel.tsx` — Two-pane display with tree nav + node detail

### Files Modified

- `src-ts/tui/App.tsx` — Added "thought_map" AppMode, inputIsThoughtMode toggle, useThoughtMap hook, submit routing, Escape handling
- `src-ts/tui/hooks/useMouse.ts` — Added onShiftTab callback, Shift+Tab escape sequence detection (`\x1b[Z`)
- `src-ts/tui/components/InputBox.tsx` — Added isThoughtMode prop (blue border, [PLAN] tag, different placeholder)

---

## February 28, 2026 — Two-Step Plan Mode, ASCII DAG Visualization, Mouse Fix

Three changes to the TUI's plan/thought map system.

### Change 1: Mouse Escape Code Leakage Fix

Fixed raw SGR mouse escape sequences leaking into text input. Root causes: ENABLE_MOUSE written before stdin.emit patch was installed, and the patch ran too late in the React lifecycle (after Ink already registered its listener).

**Fixes:**
- Added `patchStdinForMouseFiltering()` export — installs stdin.emit filter at module level, called BEFORE `render(<App>)` in cli/index.ts
- Reordered `stdout.write(ENABLE_MOUSE)` to happen AFTER the emit patch is installed
- The `useMouse` hook now detects the global patch and wires callbacks via refs instead of re-patching
- Added control character guard in `CustomTextInput` — rejects any input containing C0/C1 control bytes as a safety net

### Change 2: Two-Step Plan Mode (Context Gathering → Thought Map)

Split the thought map generation into two visible phases:
- **Phase 1 (automatic)**: Gathers git context incrementally (repo root, branch, status, commits, diff, file tree) and displays each item as it completes in a read-only `ContextGatheringPanel`
- **Phase 2 (interactive)**: Generates the thought map using pre-gathered context, then shows the interactive ThoughtMapPanel for refinement

Added `gatherContextWithProgress()` to agent/context.ts and `generateThoughtMapWithContext()` to thoughtMap/llm.ts.

### Change 3: ASCII DAG Visualization

Replaced the flat tree list in ThoughtMapPanel's left pane with a topologically-sorted ASCII directed acyclic graph showing dependency arrows between nodes.

Added to render.ts:
- `flattenAllNodes()` — recursively flattens children, implicit parent deps
- `topologicalSort()` — assigns nodes to layers by dependency resolution
- `dagNavigationOrder()` — left-to-right, top-to-bottom for arrow key nav
- `renderDagAscii()` — full ASCII DAG renderer with boxes, vertical/horizontal connectors, fan-out/fan-in arrows, and selection highlighting

### Files Created
- `src-ts/tui/components/ContextGatheringPanel.tsx` — Read-only context accumulation display

### Files Modified
- `src-ts/tui/hooks/useMouse.ts` — Global patch export, reordered ENABLE_MOUSE, callback ref wiring
- `src-ts/cli/index.ts` — Call patchStdinForMouseFiltering before Ink render
- `src-ts/tui/components/CustomTextInput.tsx` — Control character rejection guard
- `src-ts/agent/context.ts` — Added gatherContextWithProgress, ContextItem type
- `src-ts/tui/thoughtMap/llm.ts` — Added generateThoughtMapWithContext
- `src-ts/tui/hooks/useThoughtMap.ts` — Two-phase state (isGatheringContext, contextItems)
- `src-ts/tui/App.tsx` — ContextGatheringPanel integration, new state fields, busy guards
- `src-ts/tui/thoughtMap/render.ts` — DAG layout engine (topologicalSort, renderDagAscii, flattenAllNodes)
- `src-ts/tui/components/ThoughtMapPanel.tsx` — Replaced flat tree with DAG rendering

---

## 2026-03-03 — Clean up tool call display in ChatArea

**Why:** The TUI was cluttered with repetitive `read_file ●●●` rows. When expanded, file contents were dumped into the chat — noisy and useless.

**What changed:**
- `src-ts/tui/components/ChatArea.tsx` — Added `label?: string` to `ToolData`. Reworked `renderToolMessage`: `read_file`/`write_file` now render as a single compact row (`read  src-ts/tui/App.tsx  ✓`) regardless of expand state — file contents are never shown. `git`/`shell` collapsed view now includes the command text as context.
- `src-ts/tui/hooks/useAgent.ts` — Populate `label` from action data: file path for `read_file`/`write_file`, command string for `git`/`shell`.


---

## 2026-03-03 — Smarter parse-failure retry in agent loop

**Why:** When the LLM reads a file containing special JSON characters (escaped quotes, backslashes, backticks) and then tries to include that content verbatim in a `respond` action, `JSON.parse` fails. The first-retry feedback was generic ("respond with valid JSON"), so the LLM often re-read the same file instead of fixing its answer — triggering the loop guard and stopping prematurely.

**What changed:**
- `src-ts/agent/graph.ts` — `parseActionNode`: on the **first** failure, keep the existing gentle retry message. On **second and subsequent** failures, escalate with explicit guidance to avoid embedding raw file content in JSON strings and use a plain-text summary in a `respond` action instead.

---

## 2026-03-04 — RAG-based dynamic context retrieval system

**Why:** The agent loaded all context eagerly on iteration 0 (git status, 10 commits, 200-file tree, memory) — wasting tokens on irrelevant info. This is a major problem for local models with small 8K-32K context windows. The retriever used simple SQL `LIKE` matching with no semantic understanding.

**What changed:**

New module: `src-ts/context/` — RAG system with BM25 retrieval
- `context/types.ts` — Interfaces for ContextChunk, ContextResult, ContextBudget, IndexOptions, IndexStats
- `context/tokenizer.ts` — BM25 tokenizer (lowercase, camelCase/snake_case splitting, stop words)
- `context/indexer.ts` — ProjectIndexer: walks repo files, chunks by function/class boundaries, generates LLM summaries, populates BM25 inverted index. Change detection via git hash-object
- `context/retriever.ts` — ContextRetriever: BM25 search with IDF scoring, query enhancement, directory summaries, file summaries
- `context/budget.ts` — Token budget calculator with adaptive observation window sizing

Modified files:
- `storage/database.ts` — Added 4 new tables (context_index, context_dir_index, context_terms, context_stats) with full CRUD methods
- `agent/protocol.ts` — Added `fetch_context` action type (query + scope: search/file/directory), classified as "safe". Updated system prompt with context retrieval guidance
- `agent/graph.ts` — Added `fetchContextNode` (free, no iteration cost, capped at 5 per cycle). Modified `gatherContextNode` to inject RAG summaries on iteration 0. Updated `callLLMNode` with budget-aware context formatting. New routing: loopGuard → fetchContext → callLLM (bypasses iteration increment)
- `agent/context.ts` — Added `ragSummaries` and `directoryOverview` fields to AgentContextState. Made `formatContextForPrompt` budget-aware with `FormatContextOptions` (adaptive window size, output truncation, RAG mode that replaces file tree)
- `agent/events.ts` — Added `context_fetch` event type
- `config/settings.ts` — Added `ContextConfig` interface (enabled, autoIndex, retrievalTopK, contextBudgetRatio) with defaults
- `tui/hooks/useAgent.ts` — Handles `context_fetch` event (silent), passes contextConfig and contextWindow to runAgent
- `cli/index.ts` — Added `mygit index` command (--status, --clear, --batch)

---

## Smart Merge Redesign: Push Conflict Resolution Flow

### Date: 2026-03-04

### Summary
Complete redesign of the smart merge feature. When the agent attempts a `git push` that is rejected due to upstream changes, the system now automatically detects the failure, pulls to surface conflicts, and presents an interactive two-pane TUI panel for hunk-by-hunk resolution. The confidence/scoring pipeline has been entirely removed in favor of AI reasoning with explicit user approval.

### Key Changes

**Push Rejection Detection & Auto-Pull**
- `executor/index.ts` — Added `push_rejected` and `merge_conflict` to `ExecutionResult.kind`. New helpers: `isPushRejected()`, `hasMergeConflictMarkers()`. Added `fetch_context` cases to `executeAction()`/`dryRun()` for exhaustive switch coverage.
- `agent/graph.ts` — Intercepts push failures in execute node: auto-runs `git pull --no-rebase`, detects conflicts via `listConflictedFiles()`, emits `merge_conflicts` event with Promise-based resolve callback, awaits user resolution before continuing.
- `agent/events.ts` — Added `merge_conflicts` event type with `files: string[]` and `resolve` callback.

**Smart Merge Simplification**
- `merge/types.ts` — Removed `TrustLevel`, `llmConfidence`, `evaluatedScore`, `trustLevel` from `SmartSolutionPlan`. Added `SmartMergeDecision` type (`accept_ours | accept_theirs | hybrid`), `decision` and `reasoningSteps` fields. Updated `SmartResolution` accordingly.
- `merge/smart.ts` — Replaced `generateSmartSolutions()` (multi-plan + scoring) with `generateSmartSolution()` (single recommendation with reasoning). Added `regenerateWithInstructions()` for user "Other" flow. New prompt asks for ONE JSON with decision + reasoning_steps + explanation.
- `merge/evaluator.ts` — Deprecated to no-op stubs. `evaluateAlgorithmic()` is now a no-op. Exports `TrustLevel` type for any remaining references.
- `config/settings.ts` — Simplified `SmartMergeConfig` from 5 fields to just `enabled: boolean`.

**IDE Integration**
- `tui/ide.ts` — NEW: `detectIDE()` returns `vscode | cursor | antigravity | terminal`. `openIDEDiff()` opens file in IDE. `openIDEMergeEditor()` opens VS Code 3-way merge editor. `isIDEAvailable()` boolean check.

**TUI Components**
- `tui/components/SmartMergeReview.tsx` — NEW: Reusable AI merge review panel showing decision badge, reasoning steps, code preview. Actions: Accept (Enter), Deny (Esc), Other (custom instruction).
- `tui/components/MergeConflictPanel.tsx` — NEW: Two-pane conflict resolution view (file list + MergeView). Auto-opens IDE diff on file navigation. Keyboard: Tab/j/k/o/t/s/Enter/Esc.
- `tui/components/MergeView.tsx` — Updated to use `SmartMergeReview` component. Changed `smartSolutions` prop from `Map<number, SmartSolutionPlan[]>` to `Map<number, SmartSolutionPlan>`.

**Agent & App Wiring**
- `tui/hooks/useAgent.ts` — Added `pendingMergeConflicts` state and `respondToMergeConflicts()` callback. Handles `merge_conflicts` event.
- `tui/App.tsx` — Added `merge_conflicts` to `AppMode`. Auto-parses conflict files and renders `MergeConflictPanel`. Cleaned up legacy `setSmartSolutions` reference.

**Tests**
- `tests/pushRejectionDetection.test.ts` — NEW: 15 tests for `isPushRejected()` and `hasMergeConflictMarkers()`
- `tests/ideDetection.test.ts` — NEW: 11 tests for `detectIDE()` and `isIDEAvailable()`
- `tests/smartMergeReasoning.test.ts` — NEW: 6 tests for `extractJson()` response parsing

---

## 2026-03-05 — PR Review Feature

Added a full CodeRabbit-style AI PR review feature with GitHub integration.

**Why**: Users want AI-powered code review for pull requests, eliminating the need for third-party tools like CodeRabbit.

**New Files**
- `src-ts/github/types.ts` — Raw GitHub REST API shapes (GitHubPR, GitHubPRFile, GitHubReviewSubmission, etc.)
- `src-ts/github/client.ts` — `GitHubClient` class using Bun `fetch`; detectRepoInfo, getPR, getPRFiles, getPRDiff, postReview, listPRs, checkAuth
- `src-ts/pr/types.ts` — App-domain types: PRData, PRFile, PRCommit, ReviewComment, FileSummary, PRReview, SEVERITY_COLORS
- `src-ts/pr/analyzer.ts` — LLM analysis: `analyzeFile()` per-file, `synthesizeReview()` overall, reuses `extractJson()` from merge/smart.ts
- `src-ts/pr/cache.ts` — SHA-based SQLite cache wrapper
- `src-ts/cli/pr.ts` — Commander.js PR commands: `pr list`, `pr review <number>`, `pr post <number>`
- `src-ts/tui/hooks/usePrReview.ts` — React hook managing fetch → analyze (with progress) → cache → post lifecycle
- `src-ts/tui/components/PrReviewPanel.tsx` — Two-pane TUI panel (file list + comment detail), structural clone of MergeConflictPanel.tsx

**Modified Files**
- `src-ts/config/settings.ts` — Added `GitHubConfig` interface and `github` field; GITHUB_TOKEN env var auto-detection
- `src-ts/storage/database.ts` — Added `pr_reviews` and `pr_posted_reviews` tables; savePRReview, getCachedPRReview, listCachedPRReviews, markPRReviewPosted methods
- `src-ts/tui/App.tsx` — Added `"pr_review"` AppMode; import and render PrReviewPanel; prNumberPromptActive state; pr-commits and pr-review slash dispatch; PR_SUBCOMMANDS wiring
- `src-ts/cli/index.ts` — Registered prCommand(); GitHub token check in `mygit check`
- `src-ts/tui/thoughtMap/slashCommands.ts` — Changed /pr to hasSubmenu:true; added PR_SUBCOMMANDS (pr-commits, pr-review)
- `src-ts/cli/setup.ts` — Extended setup wizard with GitHub PAT prompt (Step 6)

---

## 2026-03-06 — Project-Grounded Agent Prompt for Capability Q&A

Improved the agent system prompt so small product questions about MyGit are answered from an authoritative built-in project brief instead of triggering unnecessary repository exploration.

**Why**: Simple questions like what `/init` does or whether MyGit supports a built-in capability were causing the agent to loop through repeated reads/searches instead of returning a short direct answer.

**Modified Files**
- `src-ts/agent/protocol.ts` — Added a project grounding block covering MyGit identity, active codebase, interfaces, core capabilities, provider support, slash commands, and exact `mygit init` behavior. Added a capability-QA policy that biases direct questions toward `respond` actions and short yes/no-first answers.
- `src-ts/tests/protocolPromptProfiles.test.ts` — Added assertions that both prompt profiles include the MyGit grounding and `/init` capability guidance.
- `CLAUDE.md` — Documented that `agent/protocol.ts` now contains built-in capability grounding and that direct MyGit capability questions should prefer grounded answers before repo exploration.

**Validation**
- Ran `npx vitest run tests/protocolPromptProfiles.test.ts tests/protocolTaskMode.test.ts` in `src-ts/`.

---

## 2026-03-07 — Restored Session Memory Pipeline

Reconnected the new session memory flow by restoring the missing `sessionMemory.ts` module that recent uncommitted changes had started importing.

**Why**: `mygit install` and TypeScript compilation were failing because callers had been migrated from the legacy brain store to `memory/sessionMemory.ts`, but the implementation file itself was absent.

**New Files**
- `src-ts/memory/sessionMemory.ts` — canonical `.mygit/MYGIT.md` loader/writer, legacy `.mygit/brain.json` import bridge, checkpoint summarization, refresh-file extraction, and portable markdown pack generation.

**Modified Files**
- `CLAUDE.md` — corrected the memory module map and documented that `sessionMemory.ts` now owns durable memory parsing/writing and legacy import fallback behavior.

**Validation**
- Ran `npx tsc --noEmit` in `src-ts/`.
- Ran `npx vitest run tests/sessionMemory.test.ts tests/autoIndex.test.ts tests/knowledgeSelector.test.ts tests/knowledgeStore.test.ts tests/protocolPromptProfiles.test.ts tests/protocolTaskMode.test.ts` in `src-ts/`.
- Ran `mygit install` from the repo root successfully.

---

## 2026-03-07 — Hybrid Model Benchmark Prompt Suite

Added a repo-grounded benchmark dataset for evaluating different models against MyGit behavior, routing, and workflow expectations.

**Why**: The project needed a large, source-grounded prompt suite with expected results so multiple models can be compared consistently across capability Q&A, routing, planning, memory, PR review, worktree, conflict, and guardrail behavior.

**New Files**
- `benchmarks/README.md` — benchmark taxonomy, record schema, scoring profiles, and evaluation instructions
- `benchmarks/mygit-hybrid-fixtures.json` — 12 reusable fixture states covering indexed/unindexed, memory/knowledge presence, auth, conflicts, worktrees, and push-rejection scenarios
- `benchmarks/mygit-hybrid-benchmark-v1.jsonl` — 220 benchmark prompts with expected modes, result types, routes, required assertions, and forbidden assertions

**Modified Files**
- `CLAUDE.md` — documented the benchmark assets and where to find the benchmark catalog and fixture definitions

**Validation**
- Parsed `benchmarks/mygit-hybrid-benchmark-v1.jsonl` successfully with Node.
- Verified the catalog contains 220 prompts across 11 categories with 20 prompts each.
- Parsed `benchmarks/mygit-hybrid-fixtures.json` successfully.

---

## 2026-03-10 — Harness Engineering MVP

Added three harness engineering mechanisms to improve context quality, cross-session learning, and knowledge freshness detection.

**Why**: MyGit's multi-file context system (FOCUS.md, MYGIT.md, AGENTS.md, shards, RAG) already aligns with harness engineering principles. Three gaps remained: no cross-session failure learning, no staleness detection for knowledge shards, and shard selection ignored working tree state.

**New Files**
- `src-ts/harness/lessons.ts` — cross-session failure feedback loop. Captures 4 failure signals (iteration exhaustion, loop guard kills, parse failures, consecutive execution failures) to `.mygit/LESSONS.md`. Append-only, capped at 2000 chars.
- `src-ts/harness/staleness.ts` — knowledge staleness detection. Full check (commits, age, source path validity) for CLI, quick check (commit count only) for agent context.

**Modified Files**
- `src-ts/knowledge/selector.ts` — added `contextPathScore` and `ShardContextHints` for git-diff-aware shard selection. Removed early-return that skipped scoring when no profiles matched.
- `src-ts/agent/context.ts` — reordered prompt sections (RAG before git status) for KV-cache-friendly ordering. Added `lessons` and `stalenessNote` to `PromptMemoryState`. Tuned execution-mode budgets (shards 3300→3600, agent map 1200→1000).
- `src-ts/agent/graph.ts` — wired lessons loading/capture, staleness check, context hints for shard selection, mode-aware RAG budget scaling (direct_qa ×0.6, execution ×1.2).
- `src-ts/cli/index.ts` — added `--check` flag to `mygit init`, integrated staleness report into `--status`.

**Validation**
- `bun run typecheck` — passes
- `bun run build` — passes (1409 modules, 175ms)
- `bun test` — 139 pass, 3 pre-existing failures (unrelated)

---

## 2026-03-10 — Git Recipes: Complex Git Workflow Support

Added a recipe system that provides structured guidance for complex multi-step git operations the agent previously couldn't handle (cross-repo fetches, fork syncing, targeted history ops, branch search).

**Why**: The agent would loop and fail on requests like "fetch a branch from my fork" because it lacked cross-repo awareness (only knew `origin`) and had no workflow knowledge for multi-step git operations. Requests like "find which branch has the login feature" were also misclassified as `direct_qa` instead of `execution`.

**New Files**
- `src-ts/recipes/types.ts` — type definitions for recipes, matches, and enhanced git context
- `src-ts/recipes/catalog.ts` — 15 structured git workflow recipes across 5 categories (cross_repo, history, search, branch, setup)
- `src-ts/recipes/matcher.ts` — regex-scored request matching, parameter extraction, prompt formatting
- `src-ts/recipes/context.ts` — enhanced git context gathering (remotes, tracking, branches, fork info via GitHub API)

**Modified Files**
- `src-ts/agent/context.ts` — added `recipeGuidance` and `enhancedGitContext` fields to `AgentContextState`; extended `formatContextForPrompt` to render remote/tracking/fork info
- `src-ts/agent/protocol.ts` — extended `buildAgentSystemPrompt` to accept optional recipe guidance; fixed `inferTaskMode` to classify git workflow keywords as `execution` mode
- `src-ts/agent/graph.ts` — integrated recipe matching and enhanced context gathering in `gatherContextNode` (iteration 0); passes recipe guidance to system prompt in `callLLMNode`
- `src-ts/github/client.ts` — added `getRepo()` method for fork relationship detection
- `src-ts/github/types.ts` — added `GitHubRepoDetail` interface with fork/parent/source fields
- `CLAUDE.md` — added `src-ts/recipes/` to source map and implementation notes

**Validation**
- `bun run typecheck` passes
- All 142 tests pass across 35 test files

---

## 2026-03-10 — Rename to "Mr T" + Comprehensive Documentation Overhaul

Renamed the project from "MyGit" to "Mr T" across all user-facing branding, ASCII art, and documentation. Rewrote README.md and docs/architecture.md with comprehensive Mermaid flowcharts for every major system, detailed explanations, and image/GIF placeholders.

**Why**: Project rebranding to "Mr T" with simultaneous documentation upgrade to make the codebase fully documented with visual flowcharts for every subsystem.

**Branding Changes (Source Files)**
- `src-ts/tui/logos.ts` — Replaced all 6 ASCII art variants (block/simple3d/threeD x large/compact) with "MR T" branding; updated LOGO_TINY
- `src-ts/tui/components/WelcomeScreen.tsx` — Tagline: "Mr T — AI-powered Git assistant"
- `src-ts/tui/components/Menu.tsx` — "Quit Mr T"
- `src-ts/tui/components/PrInboxPanel.tsx` — "Mr T config:"
- `src-ts/tui/thoughtMap/slashCommands.ts` — "Quit Mr T"
- `src-ts/pr/posting.ts` — "Generated by Mr T" footer
- `src-ts/cli/brain.ts` — "Welcome back to Mr T!"
- `src-ts/cli/index.ts` — "Manage Mr T configuration"
- `src-ts/cli/setup.ts` — "Mr T Setup Wizard"
- `src-ts/cli/install.ts` — "Install Mr T globally via symlink"
- `src-ts/memory/sessionMemory.ts` — "# Mr T Project Memory" header + system prompt
- `src-ts/github/client.ts` — User-Agent: "mr-t-cli"
- `src-ts/agent/protocol.ts` — Identity: "Mr T is an AI-powered Git CLI agent"
- `src-ts/knowledge/store.ts` — "Managed by Mr T" in AGENTS.md
- `src-ts/knowledge/compiler.ts` — "Managed by Mr T" in agent map
- `src-ts/tests/sessionMemory.test.ts` — Updated test expectation
- `src-ts/tests/knowledgeStore.test.ts` — Updated test expectations

**Documentation Overhaul**
- `README.md` — Complete rewrite with 15+ Mermaid flowcharts covering: system overview, agent loop state machine, RAG indexing pipeline, knowledge compilation, BM25 retrieval, shard selection scoring, harness engineering (lessons + staleness), prompt assembly, permission system, session memory, slash commands, thought map, PR review, git recipes, merge conflicts, TUI mode state machine, and event bus architecture. Added image/GIF placeholders throughout using `docs/assets/` convention.
- `docs/architecture.md` — Expanded from 8 flows to 13 flows with detailed flowcharts, added database schema, shard selection scoring, event bus architecture, TUI mode state machine, recipe matching, and harness engineering flows.
- `CLAUDE.md` — Renamed all prose references to "Mr T"
- `PROJECT_SUMMARY.md` — Renamed
- `docs/configuration.md` — Renamed
- `TESTING.md` — Renamed
- `benchmarks/README.md` — Renamed
- Created `docs/assets/` directory for future screenshots and GIFs

**Not Changed (Intentional)**
- `MyGitDatabase` class name and all imports/type refs — internal code identifier, not user-facing
- `.mygit/` directory name — backward compatibility
- `mygit` CLI command name — binary name stays the same
- `changes.md` historical entries — append-only changelog
- GitHub repo URL references — actual repo URL unchanged

**Validation**
- `bun run typecheck` passes cleanly
