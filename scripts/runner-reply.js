import { chromium } from "playwright";
import { loadForumConfig } from "./lib/forum-config.js";
import { loadPlatformConfig, loadVerificationApiConfig } from "./lib/platform-config.js";
import { configDir, runtimeDir } from "./lib/paths.js";
import { ensureDir, readJson, sleep, randomInt } from "./lib/utils.js";
import { GpmClient } from "./lib/gpm-client.js";
import { setLocatorValue } from "./lib/playwright-helpers.js";
import { ErrorTracker } from "./lib/error-tracker.js";
import { appendResult, updateSummary, writeState, readState } from "./lib/result-writer.js";
import { loadAiConfig, loadAgentPersona, generateReply, buildConversationPrompt } from "./lib/ai-client.js";
import { readConversationMessages, readTelegramMessages } from "./lib/conversation-reader.js";
import { telegramLogin, isAlreadyLoggedIn } from "./lib/telegram-login.js";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const parsed = { forumId: null, profileId: null, maxReplies: 10, pollIntervalMs: 30000, resume: false, useAi: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--forum") { parsed.forumId = argv[++i]; continue; }
    if (arg === "--profile") { parsed.profileId = argv[++i]; continue; }
    if (arg === "--max-replies") { parsed.maxReplies = Number(argv[++i]); continue; }
    if (arg === "--poll-interval") { parsed.pollIntervalMs = Number(argv[++i]) * 1000; continue; }
    if (arg === "--resume") { parsed.resume = true; continue; }
    if (arg === "--ai") { parsed.useAi = true; continue; }
  }
  if (!parsed.forumId || !parsed.profileId) {
    throw new Error("Usage: node scripts/runner-reply.js --forum <id> --profile <id> [--max-replies N] [--poll-interval Secs] [--ai] [--resume]");
  }
  return parsed;
}

async function checkBadge({ page, forumConfig, timeouts }) {
  const inboxConfig = forumConfig.inbox ?? {};
  const triggerSelector = inboxConfig.popupTrigger ?? ".p-navgroup-link--conversations";
  const trigger = page.locator(triggerSelector).first();
  await trigger.waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 }).catch(() => null);
  const badgeAttr = inboxConfig.unreadBadgeAttr ?? "data-badge";
  const badgeValue = await trigger.getAttribute(badgeAttr).catch(() => "0");
  return Number(badgeValue) || 0;
}

async function openPopupAndGetConversations({ page, forumConfig, timeouts }) {
  const inboxConfig = forumConfig.inbox ?? {};
  const triggerSelector = inboxConfig.popupTrigger ?? ".p-navgroup-link--conversations";
  const trigger = page.locator(triggerSelector).first();

  await trigger.click();
  await sleep(timeouts.popupOpenMs ?? 3000);

  const rowSelector = inboxConfig.popupRowHighlighted ?? ".menu-row--highlighted";
  const linkSelector = inboxConfig.popupConversationLink ?? ".fauxBlockLink-blockLink";
  const timeSelector = inboxConfig.popupTime ?? "time[data-time]";
  const rowCount = await page.locator(rowSelector).count();

  const rows = [];
  for (let i = 0; i < rowCount; i += 1) {
    const row = page.locator(rowSelector).nth(i);
    const linkEl = row.locator(linkSelector).first();
    const text = await linkEl.textContent().catch(() => null);
    const href = await linkEl.getAttribute("href").catch(() => null);
    const url = href ? (href.startsWith("http") ? href : `${forumConfig.baseUrl}${href}`) : null;
    const timeEl = row.locator(timeSelector).first();
    const dataTime = await timeEl.getAttribute("data-time").catch(() => null);
    rows.push({ title: text?.trim(), url, dataTime: dataTime ? Number(dataTime) : 0 });
  }

  rows.sort((a, b) => (b.dataTime ?? 0) - (a.dataTime ?? 0));

  await page.keyboard.press("Escape").catch(() => {});
  await sleep(timeouts.popupCloseMs ?? 300);

  return rows;
}

async function readReplies({ page, forumConfig }) {
  const convConfig = forumConfig.conversation ?? {};
  const msgSelector = convConfig.messageBlock ?? ".message";
  const bodySelector = convConfig.messageBody ?? ".message-body .bbWrapper";
  const authorSelector = convConfig.messageAuthor ?? ".message-name a";
  const timeSelector = convConfig.messageTime ?? "time[data-time]";

  const count = await page.locator(msgSelector).count();
  const replies = [];
  for (let i = 0; i < count; i += 1) {
    const msg = page.locator(msgSelector).nth(i);
    const author = await msg.locator(authorSelector).first().textContent().catch(() => "").then(s => s.trim());
    const body = await msg.locator(bodySelector).first().textContent().catch(() => "").then(s => s.trim());
    const timeEl = msg.locator(timeSelector).first();
    const dataTime = await timeEl.getAttribute("data-time").catch(() => null);
    replies.push({ author, body, dataTime: dataTime ? Number(dataTime) : 0 });
  }
  return replies;
}

async function sendReply({ page, forumConfig, replyBody, timeouts }) {
  const convConfig = forumConfig.conversation ?? {};
  const editorSelector = convConfig.replyEditor ?? ".fr-element[contenteditable='true']";
  const submitSelector = convConfig.replySubmit ?? "button.button--icon--reply";

  const editor = page.locator(editorSelector).first();
  await editor.waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
  await setLocatorValue(editor, replyBody);
  await sleep(timeouts.replyEditorClickMs ?? 300);

  await page.locator(submitSelector).first().click();
  await page.waitForLoadState("domcontentloaded", { timeout: timeouts.waitFor ?? 15000 }).catch(() => {});
  await sleep(timeouts.postSubmitMs ?? 1000);

  const validationSelectors = forumConfig.validationErrorSelectors ?? [];
  for (const selector of validationSelectors) {
    const errorEl = page.locator(selector).first();
    const errorText = await errorEl.textContent({ timeout: 2000 }).catch(() => null);
    if (errorText?.trim()) {
      return { status: "reply_validation_error", error: errorText.trim() };
    }
  }

  return { status: "reply_sent" };
}

async function runReplyLoop({ gpmClient, gpmConfig, forumConfig, profileId, maxReplies, pollIntervalMs, useAi, aiConfig, systemPrompt }) {
  const tracker = new ErrorTracker(5);
  const timeouts = forumConfig.timeouts ?? {};
  const replyDelay = forumConfig.replyDelayMs ?? { min: 4000, max: 8000 };
  const fallbackReplies = forumConfig.fallbackReplies ?? {
    fromOther: "Cảm ơn {first_name} đã phản hồi! Mình sẽ cập nhật thêm sớm nhé.",
    fromSelf: "Cảm ơn bạn đã liên hệ! Mình sẽ phản hồi sớm nhé."
  };
  const profileResponse = await gpmClient.getProfile(profileId);
  const profile = profileResponse.data;
  const started = await gpmClient.startProfile(profileId, gpmConfig.startOptions ?? {});
  const debuggingAddress = started.data.remote_debugging_address;
  if (!debuggingAddress) throw new Error(`No remote_debugging_address for profile ${profileId}`);
  const browser = await chromium.connectOverCDP(`http://${debuggingAddress}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  console.log(`[${profileId}] Reply checker started: ${profile.name}`);

  let repliesSent = 0;
  const resultsDir = path.join(runtimeDir, "reply-checks");
  await ensureDir(resultsDir);

  try {
    while (repliesSent < maxReplies) {
      if (tracker.shouldPause) {
        const stopReason = `${tracker.errorStreak} consecutive errors: ${tracker.lastErrors.map(e => e.status).join(", ")}`;
        console.error(`[${profileId}] PAUSED: ${stopReason}`);
        await appendResult(runtimeDir, "reply-checks", profileId, { STOP_REASON: stopReason });
        await updateSummary(runtimeDir, "reply-checks", profileId, { status: "paused", error: stopReason });
        break;
      }

      console.log(`[${profileId}] Checking inbox...`);
      const startMs = Date.now();

      try {
        await page.goto(forumConfig.baseUrl, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 60000 });
        await sleep(timeouts.inboxSettleMs ?? 2000);

        const unreadCount = await checkBadge({ page, forumConfig, timeouts });
        if (unreadCount === 0) {
          console.log(`[${profileId}] No unread conversations. Polling in ${(pollIntervalMs / 1000).toFixed(0)}s...`);
          await appendResult(runtimeDir, "reply-checks", profileId, { action: "check_inbox", status: "inbox_empty", ms: Date.now() - startMs });
          await sleep(pollIntervalMs);
          continue;
        }

        console.log(`[${profileId}] ${unreadCount} unread conversation(s)`);
        const conversations = await openPopupAndGetConversations({ page, forumConfig, timeouts });

        if (conversations.length === 0) {
          console.log(`[${profileId}] No highlighted rows in popup`);
          tracker.record("validation_error", "No highlighted rows");
          await appendResult(runtimeDir, "reply-checks", profileId, { action: "check_inbox", status: "no_highlighted_rows", error: "Popup empty", ms: Date.now() - startMs });
          await sleep(pollIntervalMs);
          continue;
        }

        const target = conversations[0];
        if (!target.url) {
          tracker.record("validation_error", "No conversation URL");
          await appendResult(runtimeDir, "reply-checks", profileId, { action: "check_inbox", status: "no_url", error: "Missing URL", ms: Date.now() - startMs });
          await sleep(pollIntervalMs);
          continue;
        }

        const convUrl = target.url.replace("/unread", "");
        await page.goto(convUrl, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 30000 });
        await sleep(timeouts.conversationSettleMs ?? 1500);

        const replies = await readReplies({ page, forumConfig });
        const lastReply = replies.length > 0 ? replies[replies.length - 1] : null;
        const isFromOther = lastReply && lastReply.author !== profile.name;

        let replyBody;
        if (useAi && aiConfig && systemPrompt) {
          try {
            const chatLog = replies.map(r => `## ${r.author === profile.name ? "me" : r.author} (${new Date(r.dataTime * 1000).toISOString().slice(0, 16).replace("T", " ")})\n${r.body}`).join("\n\n");
            const userPrompt = buildConversationPrompt(chatLog, lastReply?.author ?? "unknown", forumConfig);
            const aiResult = await generateReply(aiConfig, systemPrompt, userPrompt);
            if (aiResult.text && aiResult.text.length >= 10) {
              replyBody = aiResult.text;
              console.log(`[${profileId}] AI reply generated (${aiResult.durationMs}ms, ${aiResult.model})`);
            } else {
              console.error(`[${profileId}] AI reply too short, falling back to template`);
              replyBody = isFromOther
                ? fallbackReplies.fromOther.replace("{first_name}", lastReply.author.split(" ")[0])
                : fallbackReplies.fromSelf;
            }
          } catch (aiErr) {
            console.error(`[${profileId}] AI error, falling back to template: ${aiErr.message}`);
            replyBody = isFromOther
              ? fallbackReplies.fromOther.replace("{first_name}", lastReply.author.split(" ")[0])
              : fallbackReplies.fromSelf;
          }
        } else {
          replyBody = isFromOther
            ? fallbackReplies.fromOther.replace("{first_name}", lastReply.author.split(" ")[0])
            : fallbackReplies.fromSelf;
        }

        const replyResult = await sendReply({ page, forumConfig, replyBody, timeouts });
        const elapsed = Date.now() - startMs;

        if (replyResult.status === "reply_sent") {
          tracker.record("sent");
          repliesSent += 1;
          console.log(`[${profileId}] Reply sent to "${target.title}" (${repliesSent}/${maxReplies}, ${elapsed}ms)`);
        } else {
          tracker.record(replyResult.status, replyResult.error);
          console.error(`[${profileId}] Reply failed: ${replyResult.error}`);
        }

        await appendResult(runtimeDir, "reply-checks", profileId, {
          action: "reply",
          status: replyResult.status,
          conversationTitle: target.title,
          conversationUrl: convUrl,
          error: replyResult.error ?? null,
          ms: elapsed
        });
        await updateSummary(runtimeDir, "reply-checks", profileId, {
          status: replyResult.status,
          error: replyResult.error ?? null
        });

        await sleep(randomInt(replyDelay.min, replyDelay.max));
      } catch (err) {
        tracker.record("network_error", err.message);
        console.error(`[${profileId}] Error: ${err.message}`);
        await appendResult(runtimeDir, "reply-checks", profileId, { action: "check_inbox", status: "network_error", error: err.message, ms: Date.now() - startMs });
        await sleep(pollIntervalMs);
      }
    }

    if (!tracker.shouldPause) {
      await appendResult(runtimeDir, "reply-checks", profileId, { action: "reply_loop_complete", status: "done", repliesSent });
      await updateSummary(runtimeDir, "reply-checks", profileId, { status: "done" });
    }

    console.log(`[${profileId}] Reply loop done: ${repliesSent} replies sent`);
  } finally {
    await browser.close().catch(() => {});
    await gpmClient.closeProfile(profileId).catch(() => {});
    console.log(`[${profileId}] Profile stopped`);
  }
}

async function checkTelegramInbox({ page, platformConfig }) {
  const selectors = platformConfig.selectors ?? {};
  const unreadSelector = selectors.unreadChat ?? ".chatlist-chat.is-unread";
  const chatTitleSelector = selectors.chatTitle ?? ".peer-title";
  const unreadChats = await page.locator(unreadSelector).all();
  const conversations = [];
  for (const chat of unreadChats) {
    const title = await chat.locator(chatTitleSelector).first().textContent().catch(() => "").then(s => s.trim());
    conversations.push({ title, url: null, dataTime: 0 });
  }
  return { count: conversations.length, conversations };
}

async function openTelegramChat({ page, platformConfig, conversation, timeouts }) {
  const selectors = platformConfig.selectors ?? {};
  const unreadSelector = selectors.unreadChat ?? ".chatlist-chat.is-unread";
  const unreadChats = await page.locator(unreadSelector).all();
  if (unreadChats.length === 0) return false;
  await unreadChats[0].click();
  await sleep(timeouts.chatListWaitMs ?? 1500);
  return true;
}

async function sendTelegramReply({ page, platformConfig, replyBody, timeouts }) {
  const convConfig = platformConfig.conversation ?? {};
  const editorSelector = convConfig.replyEditor ?? ".input-message-input";
  const submitSelector = convConfig.replySubmit ?? ".btn-send";

  const editor = page.locator(editorSelector).first();
  await editor.waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
  await setLocatorValue(editor, replyBody);
  await sleep(timeouts.replyEditorClickMs ?? 300);

  try {
    await page.locator(submitSelector).first().click({ timeout: 5000 });
  } catch {
    await page.keyboard.press("Enter");
  }
  await sleep(timeouts.postSubmitMs ?? 1000);
  return { status: "reply_sent" };
}

async function runTelegramReplyLoop({ gpmClient, gpmConfig, platformConfig, profileId, maxReplies, pollIntervalMs, useAi, aiConfig, systemPrompt, apiConfig, account }) {
  const tracker = new ErrorTracker(5);
  const timeouts = platformConfig.timeouts ?? {};
  const replyDelay = platformConfig.replyDelayMs ?? { min: 4000, max: 8000 };
  const profileResponse = await gpmClient.getProfile(profileId);
  const profile = profileResponse.data;

  await gpmClient.closeProfile(profileId).catch(() => {});
  await sleep(timeouts.closeBeforeStartMs ?? 2000);
  const started = await gpmClient.startProfile(profileId, gpmConfig.startOptions ?? {});
  const debuggingAddress = started.data.remote_debugging_address;
  if (!debuggingAddress) throw new Error(`No remote_debugging_address for profile ${profileId}`);
  await gpmClient.waitForCdpReady(debuggingAddress, { timeoutMs: timeouts.cdpReadyMs ?? 30000, intervalMs: timeouts.cdpPollIntervalMs ?? 2000 });
  const browser = await chromium.connectOverCDP(`http://${debuggingAddress}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  console.log(`[${profileId}] Telegram reply checker started: ${profile.name}`);

  // Navigate to Telegram and login if needed
  await page.goto(platformConfig.baseUrl, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 60000 });
  await sleep(timeouts.inboxSettleMs ?? 3000);

  if (!(await isAlreadyLoggedIn(page, platformConfig))) {
    if (!account) {
      console.error(`[${profileId}] No account data for Telegram login`);
      await browser.close().catch(() => {});
      await gpmClient.closeProfile(profileId).catch(() => {});
      return;
    }
    const loginResult = await telegramLogin({ page, platformConfig, phone: account.phone, twoFaPassword: account.twoFaPassword, apiConfig });
    if (loginResult.status !== "logged_in" && loginResult.status !== "already_logged_in") {
      console.error(`[${profileId}] Login failed: ${loginResult.error}`);
      await browser.close().catch(() => {});
      await gpmClient.closeProfile(profileId).catch(() => {});
      return;
    }
    console.log(`[${profileId}] Logged in`);
  }

  let repliesSent = 0;
  const resultsDir = path.join(runtimeDir, "reply-checks");
  await ensureDir(resultsDir);

  try {
    while (repliesSent < maxReplies) {
      if (tracker.shouldPause) {
        const stopReason = `${tracker.errorStreak} consecutive errors`;
        console.error(`[${profileId}] PAUSED: ${stopReason}`);
        break;
      }

      console.log(`[${profileId}] Checking Telegram inbox...`);
      const startMs = Date.now();

      try {
        const { count, conversations } = await checkTelegramInbox({ page, platformConfig });
        if (count === 0) {
          console.log(`[${profileId}] No unread chats. Polling in ${(pollIntervalMs / 1000).toFixed(0)}s...`);
          await appendResult(runtimeDir, "reply-checks", profileId, { action: "check_inbox", status: "inbox_empty", ms: Date.now() - startMs });
          await sleep(pollIntervalMs);
          continue;
        }

        console.log(`[${profileId}] ${count} unread chat(s)`);

        const opened = await openTelegramChat({ page, platformConfig, conversation: conversations[0], timeouts });
        if (!opened) {
          tracker.record("validation_error", "Could not open chat");
          await sleep(pollIntervalMs);
          continue;
        }
        await sleep(timeouts.conversationSettleMs ?? 1500);

        const replies = await readTelegramMessages(page, platformConfig);
        const lastReply = replies.length > 0 ? replies[replies.length - 1] : null;
        const isFromOther = lastReply && lastReply.author !== profile.name;

        let replyBody;
        if (useAi && aiConfig && systemPrompt) {
          try {
            const chatLog = replies.map(r => `## ${r.author === profile.name ? "me" : r.author}\n${r.body}`).join("\n\n");
            const userPrompt = buildConversationPrompt(chatLog, lastReply?.author ?? "unknown", platformConfig);
            const aiResult = await generateReply(aiConfig, systemPrompt, userPrompt);
            if (aiResult.text && aiResult.text.length >= 10) {
              replyBody = aiResult.text;
            } else {
              replyBody = isFromOther ? `Cảm ơn ${lastReply.author.split(" ")[0]}!` : "Cảm ơn bạn!";
            }
          } catch (aiErr) {
            console.error(`[${profileId}] AI error: ${aiErr.message}`);
            replyBody = isFromOther ? `Cảm ơn ${lastReply.author.split(" ")[0]}!` : "Cảm ơn bạn!";
          }
        } else {
          replyBody = isFromOther ? `Cảm ơn ${lastReply.author.split(" ")[0]}!` : "Cảm ơn bạn!";
        }

        const replyResult = await sendTelegramReply({ page, platformConfig, replyBody, timeouts });
        const elapsed = Date.now() - startMs;

        if (replyResult.status === "reply_sent") {
          tracker.record("sent");
          repliesSent += 1;
          console.log(`[${profileId}] Reply sent to "${conversations[0].title}" (${repliesSent}/${maxReplies}, ${elapsed}ms)`);
        } else {
          tracker.record(replyResult.status, replyResult.error);
        }

        await appendResult(runtimeDir, "reply-checks", profileId, {
          action: "reply", status: replyResult.status, conversationTitle: conversations[0]?.title,
          error: replyResult.error ?? null, ms: elapsed
        });

        await sleep(randomInt(replyDelay.min, replyDelay.max));
      } catch (err) {
        tracker.record("network_error", err.message);
        console.error(`[${profileId}] Error: ${err.message}`);
        await appendResult(runtimeDir, "reply-checks", profileId, { action: "check_inbox", status: "network_error", error: err.message, ms: Date.now() - startMs });
        await sleep(pollIntervalMs);
      }
    }

    console.log(`[${profileId}] Reply loop done: ${repliesSent} replies sent`);
  } finally {
    await sleep(timeouts.closeProfileMs ?? 15000);
    await browser.close().catch(() => {});
    await gpmClient.closeProfile(profileId).catch(() => {});
    console.log(`[${profileId}] Profile stopped`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configId = args.forumId;
  const platformConfig = await loadPlatformConfig(configId);
  const isTelegram = platformConfig.platform === "telegram";
  const forumConfig = isTelegram ? platformConfig : await loadForumConfig(configId);
  const gpmConfig = await readJson(`${configDir}/gpm.json`);
  const gpmClient = new GpmClient(gpmConfig.baseUrl);

  let aiConfig = null;
  let systemPrompt = null;
  if (args.useAi) {
    aiConfig = await loadAiConfig();
    systemPrompt = await loadAgentPersona(configId);
    console.log(`AI enabled: ${aiConfig.provider} / ${aiConfig.model} at ${aiConfig.baseUrl}`);
  }

  const platformLabel = isTelegram ? "Telegram" : `Forum: ${configId}`;
  console.log(`Reply checker: ${platformLabel} profile=${args.profileId} maxReplies=${args.maxReplies} poll=${args.pollIntervalMs / 1000}s ai=${args.useAi}`);

  if (isTelegram) {
    const apiConfig = await loadVerificationApiConfig();
    // Load account for login if needed
    let account = null;
    // Account loading would be from campaign or external source
    await runTelegramReplyLoop({
      gpmClient, gpmConfig, platformConfig, profileId: args.profileId,
      maxReplies: args.maxReplies, pollIntervalMs: args.pollIntervalMs,
      useAi: args.useAi, aiConfig, systemPrompt, apiConfig, account
    });
  } else {
    await runReplyLoop({
      gpmClient, gpmConfig, forumConfig, profileId: args.profileId,
      maxReplies: args.maxReplies, pollIntervalMs: args.pollIntervalMs,
      useAi: args.useAi, aiConfig, systemPrompt
    });
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});