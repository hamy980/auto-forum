# Guidelines

## Engineering Rules

Build new behavior as:
1. helper in `scripts/lib/` only if it is pure/shared logic
2. task in `scripts/tasks/` if it is one atomic action
3. orchestrator in `scripts/orchestrators/` if it composes multiple tasks
4. command in `scripts/` only as a thin CLI wrapper

Do not add new monolithic one-off scripts for core workflow logic.

## Task Design

Each task should:
- have a single responsibility
- accept `{ ctx, state }`
- return a new `state`
- not mutate unrelated state fields
- not print final user output

Good task examples:
- attach running profile
- open compose page
- fill PM form
- submit PM
- verify conversation

Bad task examples:
- one task that starts profile, sends PM, verifies inbox, updates config, and prints summary

## Orchestrator Design

Orchestrators should:
- own loops and branching
- own retry policy
- own lifecycle policy
- return one compact result object

Orchestrators should not:
- duplicate DOM logic already in tasks
- hide side effects
- write massive ad-hoc logs outside runtime conventions

## Runtime Logging

Use:
- `runtime/profiles/<profileId>.json`
- `runtime/profiles/<profileId>.log.jsonl`

Keep logs structured and minimal.

Do not persist live objects such as:
- `browser`
- `page`
- `locator`
- raw circular Playwright state

## Forum Config Rules

Put forum-specific differences in `config/forums/<forum>.json`:
- endpoint templates
- selector differences
- success URL patterns
- cooldown text
- permission text
- delay rules
- retry settings

Do not fork tasks just because a selector changes. Prefer config-driven behavior first.

## Content Rules

Campaign content should come from:
- campaign inline templates, or
- `contentPackPath`

Member sources should come from:
- `memberListPath`, or
- `memberSourcePath`

Do not hardcode member lists or message bodies inside orchestrators.

### Spin Syntax

Use `{option1|option2|option3}` in templates for per-message randomization.
`resolveSpin()` runs after `fillTemplate()` — variables like `{first_name}` are resolved first.

### AI Reply Rules

- Agent persona (`agent.md`) must define DO/DON'T rules and knowledge
- AI replies should be reviewed before sending (status: `unread` → `ai_generated` → `replied`)
- Always fall back to hardcoded templates when AI fails or returns empty

## No Hardcoding

All timeouts, delays, and retry settings must come from forum config JSON.
Runner code should use `forumConfig.timeouts.xxx ?? defaultValue` pattern.
Never hardcode sleep values, delay ranges, or selector strings in scripts.

## Lifecycle Rules

For running-profile tests:
- keep GPM profile open by default
- close local Playwright client at command end

For campaign/batch runs:
- lifecycle can be stricter
- explicitly decide whether to close profile at the end

Never assume “keepAlive” means “keep local Node process attached forever”.

## Response Rules

Every production-oriented command should return structured JSON.

Minimum:
- `ok`
- `status`
- `stage`
- key identifiers
- `lastError`

Preferred:
- `conversationUrl`
- `timeruleUpdated`
- receiver verification summary

## Before Adding New Features

Check first:
- is there already a reusable task for this?
- should this be a config change instead of a code fork?
- should this become a new orchestrator instead of a new one-off command?

## Review Checklist

When another agent reviews this repo, it should verify:
- no live Playwright objects are persisted to JSON
- commands return promptly after workflow completion
- GPM profiles do not close unexpectedly when keep-alive is intended
- forum differences are config-driven where possible
- retry/cooldown logic is centralized and observable
- new functionality is built on tasks, not one giant script
