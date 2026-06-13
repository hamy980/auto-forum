import { chromium } from "playwright";
import { loadForumConfig } from "./lib/forum-config.js";
import { configDir, dataDir, runtimeDir } from "./lib/paths.js";
import { ensureDir, readJson, sleep } from "./lib/utils.js";
import { GpmClient } from "./lib/gpm-client.js";
import { readConversationMessages, parseFrontmatter, buildMdFrontmatter, buildMdContent } from "./lib/conversation-reader.js";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const parsed = { forumId: null, profileId: null, campaignId: null, daysThreshold: 7, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--forum") { parsed.forumId = argv[++i]; continue; }
    if (arg === "--profile") { parsed.profileId = argv[++i]; continue; }
    if (arg === "--campaign") { parsed.campaignId = argv[++i]; continue; }
    if (arg === "--days-threshold") { parsed.daysThreshold = Number(argv[++i]); continue; }
    if (arg === "--dry-run") { parsed.dryRun = true; continue; }
  }
  if (!parsed.forumId || !parsed.profileId) {
    throw new Error("Usage: node scripts/followup-check.js --forum <id> --profile <id> [--campaign <id>] [--days-threshold 7] [--dry-run]");
  }
  return parsed;
}

function sanitizeMemberName(name) {
  return (name ?? "unknown")
    .replace(/\+/g, "_")
    .replace(/[^a-zA-Z0-9_\-.]/g, "")
    .toLowerCase();
}

function daysBetween(dateA, dateB) {
  const msPerDay = 86400000;
  return (dateB.getTime() - dateA.getTime()) / msPerDay;
}

async function readJsonlResults(campaignId) {
  const results = [];
  const seen = new Set();
  const campaignDir = path.join(runtimeDir, campaignId);
  try {
    const files = await fs.readdir(campaignDir);
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));
    for (const file of jsonlFiles) {
      const content = await fs.readFile(path.join(campaignDir, file), "utf-8");
      for (const line of content.trim().split("\n").filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.action === "send_pm" && entry.status === "sent" && entry.url && !seen.has(entry.url)) {
            seen.add(entry.url);
            results.push(entry);
          }
        } catch { /* skip malformed lines */ }
      }
    }
  } catch {
    /* campaign directory doesn't exist yet */
  }
  return results;
}

async function readSuccessfulFiles(forumId) {
  const results = [];
  const sentDir = path.join(dataDir, forumId, "sent");
  const files = await fs.readdir(sentDir).catch(() => []);
  for (const file of files) {
    if (!file.endsWith("_successful.txt")) continue;
    const profileId = file.replace("_successful.txt", "");
    const content = await fs.readFile(path.join(sentDir, file), "utf-8");
    for (const line of content.split("\n").filter(Boolean)) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        results.push({ ts: parts[0], member: parts[1], url: parts[2], profileId });
      }
    }
  }
  return results;
}

async function readExistingConversations(forumId) {
  const convDir = path.join(dataDir, forumId, "conversations");
  const conversations = {};
  try {
    const files = await fs.readdir(convDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(convDir, file);
      const content = await fs.readFile(filePath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      if (frontmatter) {
        const memberName = file.replace(".md", "");
        conversations[memberName] = { filePath, frontmatter, content };
      }
    }
  } catch { /* directory doesn't exist yet */ }
  return conversations;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const forumConfig = await loadForumConfig(args.forumId);
  const timeouts = forumConfig.timeouts ?? {};
  const gpmConfig = await readJson(path.join(configDir, "gpm.json"));
  const gpmClient = new GpmClient(gpmConfig.baseUrl);

  const convDir = path.join(dataDir, args.forumId, "conversations");
  await ensureDir(convDir);

  // Read sent PMs from JSONL (campaign results) and successful files
  const jsonlPms = args.campaignId ? await readJsonlResults(args.campaignId) : [];
  const filePms = await readSuccessfulFiles(args.forumId);
  const seenUrls = new Set(jsonlPms.map(p => p.url));
  const sentPms = [...jsonlPms, ...filePms.filter(p => !seenUrls.has(p.url))];
  console.error(`[followup] Found ${sentPms.length} sent PMs (${jsonlPms.length} from JSONL, ${filePms.length} from successful files)`);

  // Read existing .md tracking files
  const existingConvs = await readExistingConversations(args.forumId);
  console.error(`[followup] Found ${Object.keys(existingConvs).length} existing tracking files`);

  // Classify conversations
  const result = { pending: [], needs_followup: [], needs_abandon: [], replied: [], checked: [] };
  const now = new Date();
  const staleConversations = [];

  // Process sent PMs
  for (const pm of sentPms) {
    const url = pm.url;
    const member = pm.member;
    const sentAt = pm.ts ? new Date(pm.ts) : now;
    const daysAgo = daysBetween(sentAt, now);
    const memberSlug = sanitizeMemberName(member);
    const filePath = path.join(convDir, `${memberSlug}.md`);

    const existing = existingConvs[memberSlug];

    // Already finalized — skip browser check
    if (existing?.frontmatter?.status === "abandoned") {
      result.needs_abandon.push({ member: memberSlug, url, days_ago: Math.round(daysAgo * 10) / 10, file: filePath, status: "abandoned" });
      continue;
    }
    if (existing?.frontmatter?.status === "replied") {
      result.replied.push({ member: memberSlug, url, days_ago: Math.round(daysAgo * 10) / 10, file: filePath, status: "replied" });
      continue;
    }

    const followupAt = existing?.frontmatter?.followup_at ? new Date(existing.frontmatter.followup_at) : null;
    const effectiveDate = followupAt ?? sentAt;
    const daysSinceEffective = daysBetween(effectiveDate, now);

    staleConversations.push({
      member: memberSlug,
      url,
      sentAt: sentAt.toISOString(),
      daysAgo: Math.round(daysAgo * 10) / 10,
      daysSinceEffective: Math.round(daysSinceEffective * 10) / 10,
      currentStatus: existing?.frontmatter?.status ?? "sent",
      followupAt: followupAt?.toISOString() ?? null,
      filePath
    });
  }

  // Also check existing .md files not in sentPms
  for (const [memberSlug, info] of Object.entries(existingConvs)) {
    if (sentPms.some(p => sanitizeMemberName(p.member) === memberSlug)) continue;
    if (info.frontmatter?.status === "abandoned" || info.frontmatter?.status === "replied") continue;
    const sentAt = info.frontmatter?.sent_at ? new Date(info.frontmatter.sent_at) : now;
    const followupAt = info.frontmatter?.followup_at ? new Date(info.frontmatter.followup_at) : null;
    const effectiveDate = followupAt ?? sentAt;
    staleConversations.push({
      member: memberSlug,
      url: info.frontmatter?.url ?? "",
      sentAt: sentAt.toISOString(),
      daysAgo: Math.round(daysBetween(sentAt, now) * 10) / 10,
      daysSinceEffective: Math.round(daysBetween(effectiveDate, now) * 10) / 10,
      currentStatus: info.frontmatter?.status ?? "sent",
      followupAt: followupAt?.toISOString() ?? null,
      filePath: info.filePath
    });
  }

  console.error(`[followup] ${staleConversations.length} conversations need browser check`);

  // If dry-run, classify without browser
  if (args.dryRun || staleConversations.length === 0) {
    for (const conv of staleConversations) {
      const entry = {
        member: conv.member,
        url: conv.url,
        days_ago: conv.daysAgo,
        file: conv.filePath,
        current_status: conv.currentStatus,
        days_since_effective: conv.daysSinceEffective
      };
      if (conv.daysSinceEffective >= args.daysThreshold * 2) {
        result.needs_abandon.push({ ...entry, status: "needs_abandon" });
      } else if (conv.daysSinceEffective >= args.daysThreshold) {
        result.needs_followup.push({ ...entry, status: "needs_followup" });
      } else {
        result.pending.push({ ...entry, status: "pending" });
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Start browser to check conversations
  console.error(`[followup] Starting profile ${args.profileId}...`);
  const profileResponse = await gpmClient.getProfile(args.profileId);
  const profile = profileResponse.data;
  await gpmClient.closeProfile(args.profileId).catch(() => {});
  await sleep(timeouts.closeBeforeStartMs ?? 2000);
  const started = await gpmClient.startProfile(args.profileId, gpmConfig.startOptions ?? {});
  const debuggingAddress = started.data.remote_debugging_address;
  if (!debuggingAddress) {
    throw new Error(`No remote_debugging_address for profile ${args.profileId}`);
  }
  console.error(`[followup] Waiting for browser at ${debuggingAddress}...`);
  await gpmClient.waitForCdpReady(debuggingAddress, { timeoutMs: timeouts.cdpReadyMs ?? 30000, intervalMs: timeouts.cdpPollIntervalMs ?? 2000 });
  const browser = await chromium.connectOverCDP(`http://${debuggingAddress}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  try {
    await page.goto(forumConfig.baseUrl, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 60000 });
    await sleep(timeouts.inboxSettleMs ?? 2000);

    for (const conv of staleConversations) {
      console.error(`[followup] Checking "${conv.member}" (sent ${conv.daysAgo} days ago, status: ${conv.currentStatus})...`);

      try {
        await page.goto(conv.url, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 30000 });
        await sleep(timeouts.conversationSettleMs ?? 1500);

        const messages = await readConversationMessages(page, forumConfig);
        const lastMsg = messages[messages.length - 1];
        const profileNameLower = (profile.name ?? "").toLowerCase().trim();
        const isLastFromUs = lastMsg && lastMsg.author?.trim().toLowerCase() === profileNameLower;
        const lastReplyTime = lastMsg?.dataTime ?? 0;

        // Determine status
        let newStatus;
        if (!isLastFromUs && messages.length > 1) {
          newStatus = "replied";
        } else if (conv.daysSinceEffective >= args.daysThreshold * 2) {
          newStatus = "needs_abandon";
        } else if (conv.daysSinceEffective >= args.daysThreshold) {
          newStatus = conv.currentStatus === "followed_up" ? "needs_abandon" : "needs_followup";
        } else {
          newStatus = "pending";
        }

        // Write frontmatter status
        const fmStatus = newStatus === "needs_followup" ? "sent"
          : newStatus === "needs_abandon" ? "abandoned"
          : newStatus;
        const frontmatter = {
          url: conv.url,
          forum: args.forumId,
          member_name: conv.member,
          status: fmStatus,
          sent_at: conv.sentAt,
          followup_at: conv.followupAt,
          last_check_at: now.toISOString(),
          last_reply_time: lastReplyTime || "null",
          profile_id: args.profileId
        };

        const mdContent = buildMdFrontmatter(frontmatter) + "\n" + buildMdContent(messages, profile.name);
        await fs.writeFile(conv.filePath, mdContent, "utf-8");

        const entry = {
          member: conv.member,
          url: conv.url,
          days_ago: conv.daysAgo,
          file: conv.filePath,
          status: newStatus,
          last_author: lastMsg?.author ?? "unknown",
          message_count: messages.length
        };

        if (newStatus === "replied") result.replied.push(entry);
        else if (newStatus === "needs_followup") result.needs_followup.push(entry);
        else if (newStatus === "needs_abandon") result.needs_abandon.push(entry);
        else result.pending.push(entry);

        result.checked.push(entry);
        await sleep(randomInt(2000, 4000));
      } catch (err) {
        console.error(`[followup] Error checking "${conv.member}": ${err.message}`);
        result.checked.push({ member: conv.member, url: conv.url, status: "error", error: err.message });
      }
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sleep(timeouts.closeProfileMs ?? 15000);
    await browser.close().catch(() => {});
    await gpmClient.closeProfile(args.profileId).catch(() => {});
    console.error(`[followup] Profile stopped`);
  }
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});