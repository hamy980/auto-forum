# GPM Forum PM Pipeline

Multi-profile forum outreach automation with AI-powered reply, built on GPM Login + Playwright.

## Features

- **Campaign Runner** — Parallel PM sending across 6+ GPM profiles with round-robin queue distribution
- **Spin Syntax** — `{option1|option2|option3}` inline randomization for diverse message content
- **AI Reply** — Ollama-powered reply generation using persona rules, knowledge base, and conversation context
- **Follow-up Tracking** — 7/14 day rule: auto-classify sent PMs as pending → needs_followup → needs_abandon → replied
- **Resume Support** — Campaign state persistence with `--resume` flag for crash recovery
- **Error Tracking** — Auto-pause after consecutive error threshold, JSONL audit trail

## Architecture

```
config/           → Forum selectors, GPM settings, AI config, agent persona
campaigns/        → Campaign definitions (profiles, member list, templates)
data/             → Member lists, sent logs, conversation tracking (.md)
scripts/
  lib/            → Shared libraries (GPM client, AI client, content builder, etc.)
  runner.js       → Campaign runner (parallel multi-profile PM send)
  ai-reply.js     → AI reply generation (reads .md → Ollama → writes reply)
  reply-harvest.js → Inbox scanner (unread conversations → .md files)
  reply-send.js   → Send reply to a specific conversation URL
  followup-check.js → Follow-up status checker (7/14 day rule)
  runner-reply.js → Polling reply loop (with optional --ai flag)
  check-results.js → Campaign result viewer with --watch support
```

## Quick Start

### 1. Campaign Run
```bash
node scripts/runner.js --campaign massagevua-greet3
node scripts/runner.js --campaign massagevua-greet3 --resume    # continue after crash
node scripts/runner.js --campaign massagevua-greet3 --profiles id1,id2  # specific profiles
```

### 2. Check Unread Inbox
```bash
node scripts/reply-harvest.js --forum massagevua.net --profile <id>
```

### 3. AI-Powered Reply
```bash
node scripts/ai-reply.js --forum massagevua.net --dry-run     # preview AI replies
node scripts/ai-reply.js --forum massagevua.net               # generate & save
```

### 4. Send Reply
```bash
node scripts/reply-send.js --forum massagevua.net --profile <id> --url <conversation_url> --content "reply text"
```

### 5. Follow-up Check
```bash
node scripts/followup-check.js --forum massagevua.net --profile <id> --campaign massagevua-greet3
node scripts/followup-check.js --forum massagevua.net --profile <id> --dry-run  # classify without browser
```

### 6. GPM Profile Management
```bash
node scripts/gpm-list.js --groups
node scripts/gpm-list.js --profiles --search massagevua.net
```

## Configuration

### Forum Config (`config/forums/<forum>.json`)
```json
{
  "id": "massagevua.net",
  "baseUrl": "https://massagevua.net",
  "composeUrlTemplate": "https://massagevua.net/conversations/add?to={recipient}",
  "selectors": { "title": "input[name='title']", "body": "[contenteditable='true']", "submit": "button.button--icon--conversation" },
  "delayMs": { "min": 60000, "max": 70000 },
  "timeouts": { "navigation": 60000, "cdpReadyMs": 30000 },
  "retry": { "maxAttempts": 3, "cooldownFallbackMs": 70000 }
}
```

### AI Config (`config/ai.json`)
```json
{
  "provider": "ollama",
  "baseUrl": "http://localhost:11434",
  "model": "deepseek-v4-flash:cloud",
  "temperature": 0.7,
  "maxTokens": 500
}
```

### Agent Persona (`config/agent.md`)
Define who the AI agent is, rules (DO/DON'T), tone, and knowledge base. Per-forum override via `config/forums/agent-<forum>.md`.

### Campaign Config (`campaigns/<id>.json`)
```json
{
  "id": "massagevua-greet3",
  "forumId": "massagevua.net",
  "profileIds": ["..."],
  "memberListPath": "../data/massagevua.net/camps_greeting_01.txt",
  "titleTemplates": ["Chào {first_name}, làm quen nhé!"],
  "bodyTemplates": ["Chào {first_name}! Mình {mới tham gia|vừa gia nhập} diễn đàn..."]
}
```

## Spin Syntax

Use `{option1|option2|option3}` in any template for random selection each time:
```
"Chào {first_name}! Mình {mới tham gia|vừa gia nhập|mới đến} diễn đàn."
```
3 body templates × 3 spin blocks = up to 81 unique variants.

## Personalization Variables

| Variable | Value |
|----------|-------|
| `{first_name}` | First word of recipient name |
| `{recipient_name}` | Full recipient name |
| `{campaign_id}` | Campaign ID |
| `{profile_id}` | GPM profile ID |
| `{profile_name}` | GPM profile name |
| `{sequence}` | Message sequence number |

## Conversation Lifecycle

```
sent → (7 days no reply) → followed_up → (7 more days no reply) → abandoned
                            ↘ (they reply anytime) → replied
```

AI reply lifecycle:
```
unread → ai_generated → replied (after send)
         ↘ ai_error (bad output, retry)
```

## GPM Profile Lifecycle

```
closeProfile() → sleep(2s) → startProfile() → waitForCdpReady() → connectOverCDP()
  ... work ...
  sleep(15s) → browser.close() → closeProfile()
```

Key: always close before start (ALREADY_OPEN handling), poll CDP endpoint instead of fixed sleep, wait 15s before close for cookie persistence.

## Project Structure

```
config/
  gpm.json                    GPM API settings
  ai.json                     Ollama/AI provider config
  agent.md                    AI persona, rules, knowledge
  forums/
    massagevua.net.json        Full forum config (selectors, inbox, timeouts)
    clubvn.net.json            Basic config
campaigns/
  massagevua-greet*.json      Campaign definitions
scripts/
  lib/
    gpm-client.js             GPM REST API client
    ai-client.js              Ollama API client
    campaign-sources.js       Content builder with spin syntax
    conversation-reader.js     XenForo message parser
    playwright-helpers.js      DOM interaction helpers
    error-tracker.js           Consecutive error tracking
    result-writer.js           JSONL + summary + state persistence
    forum-config.js            Config loader
    utils.js                   sleep, randomInt, pickOne, fillTemplate, resolveSpin
  runner.js                    Campaign runner (main)
  ai-reply.js                  AI reply generation
  reply-harvest.js             Inbox scanner
  reply-send.js                Reply sender
  followup-check.js            Follow-up classifier
  runner-reply.js              Polling reply loop
  check-results.js             Result viewer
  resume-campaign.js           Resume helper
  gpm-list.js                  GPM discovery
data/
  <forum>/
    camps_greeting_*.txt       Member lists
    sent/                      Per-profile send logs
    reply/                     Harvested conversation .md files
    conversations/             Follow-up tracking .md files
runtime/
  <campaignId>/                Per-campaign JSONL logs + state + summaries
docs/
  ARCHITECTURE.md
  GUIDELINES.md
  GPM-API.md
```

## Requirements

- Node.js 18+
- GPM Login running locally (`http://127.0.0.1:19995`)
- Ollama running locally for AI replies (`http://localhost:11434`)
- Playwright (`npm install`)