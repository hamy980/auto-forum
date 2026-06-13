# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `scripts/run-quick.js` — interactive wizard that prompts for member list file, forum ID, and content file (`.json` with `titleTemplates`/`bodyTemplates` or `.txt` with one body per line), validates all inputs against existing config files, generates a temporary `campaigns/quick-<timestamp>.json`, and invokes `runner.js`. Also auto-discovers available forum IDs and GPM profiles.
- `replyDelayMs` block in forum configs — per-forum delay between replies (separate from `delayMs` which is for sending PMs).
- `fallbackReplies` block in `config/forums/sample-forum.json` — moves hardcoded Vietnamese reply templates out of `runner-reply.js` and into config.
- `config/forums/forum4travel.com.json` and `config/forums/thiendia.vip.json` — sample configs demonstrating two different `composeUrlTemplate` patterns (`/direct-messages/add?to=` and `/conversations/add?to=`). Both are git-ignored.
- Extra timeout keys in `config/forums/sample-forum.json`: `popupOpenMs`, `popupCloseMs`, `inboxSettleMs`, `conversationSettleMs`, `postReplyMinMs`, `postReplyMaxMs`, `replyEditorClickMs`, `chatListWaitMs`.

### Changed
- All entry scripts (`runner-reply.js`, `runner.js`, `reply-harvest.js`, `reply-send.js`, `followup-check.js`) now read timing values from `forumConfig.timeouts` / `platformConfig.timeouts` instead of hardcoded magic numbers.
- All task files under `scripts/tasks/forum/` and `scripts/tasks/telegram/` (`check-inbox.js`, `open-unread-conversation.js`, `send-reply.js`, `submit-pm.js`, `open-chat.js`, `send-message.js`, `send-reply.js`) replaced hardcoded `await sleep(N)` and `timeout: N` values with `ctx.forumConfig.timeouts` / `ctx.platformConfig.timeouts` lookups.
- `scripts/lib/campaign-runner.js` — `sendPmViaProfile` now uses `forumConfig.timeouts` for `navigation`, `waitFor`, and `postSubmitMs`.
- `scripts/runner-reply.js` — reply loop now uses `forumConfig.replyDelayMs` (or `platformConfig.replyDelayMs` for Telegram) instead of `timeouts.postReplyMinMs`/`postReplyMaxMs`.

### Security
- Excluded `config/forums/forum4travel.com.json` and `config/forums/thiendia.vip.json` from version control by adding them to `.gitignore` (follows the existing pattern for real-domain configs).
- `opencode.json` (local-only) contains a hardcoded API key and must remain untracked / git-ignored.
