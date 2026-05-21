# Architecture

## Goal

Build a reusable, multi-profile automation system for forum PM workflows.

The architecture must support:
- multiple GPM profiles in parallel
- multiple forums with different PM endpoints and selectors
- task-level reuse across future features
- deterministic runtime state and logs
- short-running commands that return quickly

## Layers

### 1. Configuration Layer

Files:
- `config/gpm.json`
- `config/forums/*.json`
- `campaigns/*.json`
- `data/*`

Responsibility:
- describe environment and runtime behavior
- avoid hardcoding forum-specific logic into tasks

### 2. Library Layer

Files under `scripts/lib/`.

Responsibility:
- pure helpers
- file path helpers
- config loading
- campaign/content/member sources
- GPM API client
- Playwright DOM/network helpers

This layer should not contain campaign orchestration logic.

### 3. Task Layer

Files under `scripts/tasks/`.

Responsibility:
- one task = one atomic action
- tasks are reusable and composable
- tasks receive `ctx` and `state`
- tasks return a new `state`

Task categories:
- `core`: context, pipeline, state store
- `gpm`: profile lifecycle and discovery
- `forum`: PM actions, verification, inbox checks

### 4. Orchestrator Layer

Files under `scripts/orchestrators/`.

Responsibility:
- compose task lists into workflows
- define lifecycle policy
- define retry/cooldown loops
- decide when to stop or continue

Examples:
- `send-pm-flow.js`
- `test-pm-between-profiles.js`
- `stress-rate-limit.js`

### 5. Command Layer

Entry scripts under `scripts/`.

Responsibility:
- parse CLI args
- call one orchestrator
- print one final JSON result

Examples:
- `run-campaign.js`
- `test-running-profiles-pm.js`
- `stress-rate-limit.js`
- `gpm-list.js`

## State Model

Per-profile runtime state is stored in:
- `runtime/profiles/<profileId>.json`
- `runtime/profiles/<profileId>.log.jsonl`

State must be serializable.

Do not persist:
- Playwright `browser`
- Playwright `page`
- other live handles or circular objects

Persist:
- `profileId`
- `profileName`
- `remoteDebuggingAddress`
- `status`
- `sequence`
- `attempt`
- `currentRecipient`
- `currentTitle`
- `currentBody`
- `composeUrl`
- `lastConversationUrl`
- `lastError`
- `lastOutcome`
- `lifecycle`
- `verification`
- reduced `lastEvents`

## Lifecycle Policy

There are two different lifecycle concepts:

1. Local Playwright session lifecycle
- should close at end of command so the command returns promptly

2. GPM browser/profile lifecycle
- may remain open after command when `keepAlive` is intended

This distinction is critical.

Current rule:
- detach/close local CDP connection always
- close GPM profile only when lifecycle says so

## Submit Outcome Model

Sender outcomes:
- `sent`
- `cooldown`
- `permission_denied`
- `validation_error`
- `timeout`
- `unknown`

Receiver outcomes:
- `verified`
- `verification_failed`
- `verification_error`
- `skipped`

Stress-test outcomes:
- `success`
- `cooldown`
- `permission_denied`
- `max_attempts_reached`

## Response Design

Commands should return compact JSON with:
- `ok`
- `status`
- `stage`
- `forumId`
- sender summary
- receiver summary when applicable
- `timeruleUpdated` when cooldown tuning changed config

Commands should not rely on humans inspecting logs to know success.

## Retry and Timerule Strategy

Retry policy belongs in forum config.

Cooldown handling:
1. detect cooldown from DOM or submit response
2. parse wait duration
3. optionally auto-update forum delay rule
4. retry or stop depending on orchestrator policy

Timerule auto-update should only change:
- `delayMs.min`
- `delayMs.max`

It should never silently rewrite unrelated forum config fields.

## AI Reply System

Components:
- `config/ai.json` — Ollama provider config (model, baseUrl, temperature, maxTokens)
- `config/agent.md` — Persona, rules (DO/DON'T), tone, knowledge base
- `scripts/lib/ai-client.js` — `generateReply()`, `loadAgentPersona()`, `buildConversationPrompt()`
- `scripts/ai-reply.js` — CLI: scan unread .md → AI generate → save reply

Flow: `reply-harvest.js → .md (unread) → ai-reply.js → .md (ai_generated) → reply-send.js`

Per-forum persona override: `config/forums/agent-<forum>.md` checked first, falls back to global.

## Spin Syntax

Templates support `{option1|option2|option3}` inline randomization via `resolveSpin()`.
Applied after `fillTemplate()` resolves variable placeholders like `{first_name}`.

## Follow-up Tracking

`followup-check.js` cross-references sent PMs against `.md` tracking files:
- `<7 days` → pending
- `7+ days no reply` → needs_followup
- `14+ days total` → needs_abandon
- `they replied` → replied

## Campaign Runner

`runner.js` is the production campaign runner:
- Multi-profile parallel execution via `Promise.allSettled`
- Round-robin queue distribution
- ErrorTracker with auto-pause threshold
- JSONL append-only logging + summary + state persistence
- `--resume` flag for crash recovery

## Legacy Components

These files are legacy or transitional:
- `scripts/browser-service.js`
- `scripts/browser-client.js`
- `scripts/open-clubvn.js`
- `scripts/lib/campaign-runner.js`

They are still useful for experiments, but not the target architecture.

New work should prefer task/orchestrator layers or the campaign runner.
