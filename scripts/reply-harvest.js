import { chromium } from "playwright";
import { loadForumConfig } from "./lib/forum-config.js";
import { configDir, dataDir, runtimeDir } from "./lib/paths.js";
import { ensureDir, readJson, sleep } from "./lib/utils.js";
import { GpmClient } from "./lib/gpm-client.js";
import { readConversationMessages, parseFrontmatter, buildMdContent } from "./lib/conversation-reader.js";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const parsed = { forumId: null, profileId: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--forum") { parsed.forumId = argv[++i]; continue; }
    if (arg === "--profile") { parsed.profileId = argv[++i]; continue; }
  }
  if (!parsed.forumId || !parsed.profileId) {
    throw new Error("Usage: node scripts/reply-harvest.js --forum <id> --profile <id>");
  }
  return parsed;
}

function sanitizeMemberName(name) {
  return (name ?? "unknown")
    .replace(/\+/g, "_")
    .replace(/[^a-zA-Z0-9_\-.]/g, "")
    .toLowerCase();
}

async function readExistingMd(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return { frontmatter: parseFrontmatter(content), content };
  } catch {
    return { frontmatter: null, content: null };
  }
}

async function checkBadge(page, forumConfig) {
  const inboxConfig = forumConfig.inbox ?? {};
  const triggerSelector = inboxConfig.popupTrigger ?? ".p-navgroup-link--conversations";
  const trigger = page.locator(triggerSelector).first();
  await trigger.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  const badgeAttr = inboxConfig.unreadBadgeAttr ?? "data-badge";
  const badgeValue = await trigger.getAttribute(badgeAttr).catch(() => "0");
  return Number(badgeValue) || 0;
}

async function openPopupAndGetConversations(page, forumConfig) {
  const inboxConfig = forumConfig.inbox ?? {};
  const triggerSelector = inboxConfig.popupTrigger ?? ".p-navgroup-link--conversations";
  const trigger = page.locator(triggerSelector).first();

  await trigger.click();
  await sleep(3000);

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
  await sleep(300);

  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const forumConfig = await loadForumConfig(args.forumId);
  const gpmConfig = await readJson(path.join(configDir, "gpm.json"));
  const gpmClient = new GpmClient(gpmConfig.baseUrl);

  console.error(`[harvest] Starting profile ${args.profileId}...`);
  const profileResponse = await gpmClient.getProfile(args.profileId);
  const profile = profileResponse.data;
  await gpmClient.closeProfile(args.profileId).catch(() => {});
  await sleep(2000);
  const started = await gpmClient.startProfile(args.profileId, gpmConfig.startOptions ?? {});
  const debuggingAddress = started.data.remote_debugging_address;
  if (!debuggingAddress) {
    throw new Error(`No remote_debugging_address for profile ${args.profileId}`);
  }
  console.error(`[harvest] Waiting for browser at ${debuggingAddress}...`);
  await gpmClient.waitForCdpReady(debuggingAddress, { timeoutMs: 30000, intervalMs: 2000 });
  const browser = await chromium.connectOverCDP(`http://${debuggingAddress}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  const outputDir = path.join(dataDir, args.forumId, "reply");
  await ensureDir(outputDir);

  try {
    console.error(`[harvest] Navigating to ${forumConfig.baseUrl}...`);
    await page.goto(forumConfig.baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(2000);

    const unreadCount = await checkBadge(page, forumConfig);
    if (unreadCount === 0) {
      const result = { unread: 0, conversations: [] };
      console.log(JSON.stringify(result, null, 2));
      await browser.close().catch(() => {});
      await gpmClient.closeProfile(args.profileId).catch(() => {});
      return;
    }

    console.error(`[harvest] ${unreadCount} unread conversation(s). Opening popup...`);
    const conversations = await openPopupAndGetConversations(page, forumConfig);

    if (conversations.length === 0) {
      const result = { unread: unreadCount, conversations: [] };
      console.log(JSON.stringify(result, null, 2));
      await browser.close().catch(() => {});
      await gpmClient.closeProfile(args.profileId).catch(() => {});
      return;
    }

    const result = { unread: unreadCount, conversations: [] };

    for (const conv of conversations) {
      if (!conv.url) {
        console.error(`[harvest] Skipping conversation with no URL: "${conv.title}"`);
        continue;
      }

      const conversationUrl = conv.url.replace("/unread", "");
      const memberName = sanitizeMemberName(conv.title);
      const filePath = path.join(outputDir, `${memberName}.md`);

      // Skip if already replied
      const existing = await readExistingMd(filePath);
      if (existing.frontmatter && existing.frontmatter.status === "replied") {
        console.error(`[harvest] Skipping "${conv.title}" — already replied`);
        result.conversations.push({
          member_name: memberName,
          url: conversationUrl,
          file: filePath,
          status: "replied",
          skipped: true
        });
        continue;
      }

      console.error(`[harvest] Reading "${conv.title}" at ${conversationUrl}...`);
      await page.goto(conversationUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(1500);

      const messages = await readConversationMessages(page, forumConfig);
      const lastMsg = messages[messages.length - 1];
      const lastReplyTime = lastMsg?.dataTime ?? 0;

      const frontmatter = {
        url: conversationUrl,
        forum: args.forumId,
        member_name: memberName,
        status: "unread",
        last_reply_time: lastReplyTime,
        harvested_at: new Date().toISOString(),
        profile_id: args.profileId
      };

      const yamlLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join("\n");
      const chatLog = buildMdContent(messages, profile.name);
      const mdContent = `---\n${yamlLines}\n---\n\n${chatLog}`;

      await fs.writeFile(filePath, mdContent, "utf-8");
      console.error(`[harvest] Wrote ${filePath} (${messages.length} messages)`);

      result.conversations.push({
        member_name: memberName,
        url: conversationUrl,
        file: filePath,
        status: "unread",
        message_count: messages.length,
        skipped: false
      });
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sleep(15000);
    await browser.close().catch(() => {});
    await gpmClient.closeProfile(args.profileId).catch(() => {});
    console.error(`[harvest] Profile stopped`);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});