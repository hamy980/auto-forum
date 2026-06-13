# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `scripts/run-quick.js` — interactive wizard that prompts for member list file, forum ID, and content file. Validates all inputs against existing configs, generates a temporary `campaigns/quick-<timestamp>.json`, and invokes `runner.js`. Auto-discovers available forum IDs and scopes GPM profile selection to the group matching the chosen `forumId`.
- `replyDelayMs` block in forum configs — per-forum delay between replies (separate from `delayMs` which is for sending PMs).
- `fallbackReplies` block in `config/forums/sample-forum.json` — moves hardcoded Vietnamese reply templates out of `runner-reply.js` and into config.
- `config/forums/forum4travel.com.json` and `config/forums/thiendia.vip.json` — sample configs demonstrating two different `composeUrlTemplate` patterns (`/direct-messages/add?to=` and `/conversations/add?to=`). Both are git-ignored.
- Extra timeout keys in `config/forums/sample-forum.json`: `popupOpenMs`, `popupCloseMs`, `inboxSettleMs`, `conversationSettleMs`, `postReplyMinMs`, `postReplyMaxMs`, `replyEditorClickMs`, `chatListWaitMs`.

### Changed
- Wizard (`scripts/run-quick.js`) now scopes the profile list to the GPM group whose name matches the chosen `forumId` (case-insensitive). `Enter` picks all profiles in that group; `N` picks the first N; comma-separated input resolves UUIDs or display names. Falls back to all GPM profiles when no group matches.
- Wizard content format changed: `run-quick.js` `loadContent` now expects `{ contents: [{title, body}, ...] }`; each recipient picks a random variant.
- Template syntax changed from `{var}` to `<<var>>` (and `<<a|b|c>>` for spin) to avoid clashing with JSON object/array braces.
- `scripts/runner.js` (production PM sender) now persists cooldown-derived delays to `config/forums/<id>.json` via `updateForumDelayRule` so subsequent runs on the same forum use the new floor. Opt out with `autoUpdateTimerule: false` in the forum config.

### Security
- Excluded `config/forums/forum4travel.com.json` and `config/forums/thiendia.vip.json` from version control by adding them to `.gitignore` (follows the existing pattern for real-domain configs).
- `opencode.json` (local-only) contains a hardcoded API key and must remain untracked / git-ignored.
