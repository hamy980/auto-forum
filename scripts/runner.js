import { chromium } from "playwright";
import { loadCampaign, loadForumConfig, loadMemberList } from "./lib/forum-config.js";
import { loadContentPack, buildCampaignContent } from "./lib/campaign-sources.js";
import { configDir, dataDir, runtimeDir } from "./lib/paths.js";
import { ensureDir, fillTemplate, normalizeRecipientForForum, parseFirstName, pickOne, randomInt, readJson, resolveMaybeRelative, sleep } from "./lib/utils.js";
import { GpmClient } from "./lib/gpm-client.js";
import { collectNetworkDuring, getLocatorValue, setLocatorValue } from "./lib/playwright-helpers.js";
import { ErrorTracker } from "./lib/error-tracker.js";
import { appendResult, updateSummary, writeState, readState, resultPath } from "./lib/result-writer.js";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const parsed = { campaignId: null, profileIds: [], resume: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--campaign") { parsed.campaignId = argv[++i]; continue; }
    if (arg === "--profiles") { parsed.profileIds = argv[++i].split(",").map(s => s.trim()).filter(Boolean); continue; }
    if (arg === "--resume") { parsed.resume = true; continue; }
  }
  if (!parsed.campaignId) {
    throw new Error("Usage: node scripts/runner.js --campaign <id> [--profiles id1,id2] [--resume]");
  }
  return parsed;
}

function buildComposeUrl(forumConfig, recipient) {
  const encoded = normalizeRecipientForForum(recipient, forumConfig.recipientEncoding);
  return forumConfig.composeUrlTemplate.replace("{recipient}", encoded);
}

function extractCooldownMs(message) {
  if (!message) return null;
  const secondsMatch = message.match(/wait at least\s+(\d+)\s+seconds/i);
  if (secondsMatch) return (Number(secondsMatch[1]) + 15) * 1000;
  const minutesMatch = message.match(/wait at least\s+(\d+)\s+minutes?/i);
  if (minutesMatch) return (Number(minutesMatch[1]) * 60 + 15) * 1000;
  return null;
}

async function readValidationErrors(page, forumConfig) {
  const selectors = forumConfig.validationErrorSelectors ?? [];
  const values = [];
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    for (let i = 0; i < count; i += 1) {
      const text = (await page.locator(selector).nth(i).textContent())?.trim();
      if (text) values.push(text);
    }
  }
  return values;
}

async function submitWithRetry({ page, forumConfig, composeUrl, title, body, maxAttempts = 3 }) {
  const selectors = forumConfig.selectors;
  const timeouts = forumConfig.timeouts ?? {};
  const retry = forumConfig.retry ?? {};
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    const startMs = Date.now();

    try {
      const events = await collectNetworkDuring(
        page,
        async () => {
          await page.locator(selectors.submit).nth(forumConfig.submitIndex ?? 0).click();
          await page.waitForLoadState("domcontentloaded", { timeout: timeouts.waitFor ?? 15000 }).catch(() => {});
          await sleep(timeouts.postSubmitMs ?? 1000);
        },
        (url, resourceType) =>
          url.includes(new URL(forumConfig.baseUrl).host) &&
          ["document", "fetch", "xhr"].includes(resourceType)
      );

      const pollTimeout = retry.postClickPollMs ?? 12000;
      const pollInterval = retry.postClickPollIntervalMs ?? 500;
      const startedAt = Date.now();
      let outcome = { status: "unknown", message: "No conclusive signal" };

      while (Date.now() - startedAt < pollTimeout) {
        if (page.url().includes(forumConfig.successUrlIncludes) && !page.url().includes("/add")) {
          outcome = { status: "sent", conversationUrl: page.url() };
          break;
        }
        const errors = await readValidationErrors(page, forumConfig);
        const combined = errors.join("\n");
        if (combined) {
          if (forumConfig.cooldownErrorIncludes && combined.includes(forumConfig.cooldownErrorIncludes)) {
            outcome = { status: "cooldown", message: combined, retryAfterMs: extractCooldownMs(combined) };
            break;
          }
          if (forumConfig.permissionErrorIncludes && combined.includes(forumConfig.permissionErrorIncludes)) {
            outcome = { status: "permission_denied", message: combined };
            break;
          }
          outcome = { status: "validation_error", message: combined };
          break;
        }
        await sleep(pollInterval);
      }

      if (outcome.status === "unknown") {
        const submitEvent = [...events].reverse().find(e => e.type === "response" && e.url.includes(new URL(forumConfig.baseUrl).host));
        if (submitEvent?.body?.includes(forumConfig.cooldownErrorIncludes)) {
          outcome = { status: "cooldown", message: submitEvent.body, retryAfterMs: extractCooldownMs(submitEvent.body) };
        } else if (submitEvent?.body?.includes(forumConfig.permissionErrorIncludes)) {
          outcome = { status: "permission_denied", message: submitEvent.body };
        }
      }

      const elapsed = Date.now() - startMs;

      if (outcome.status === "sent") {
        return { status: "sent", url: outcome.conversationUrl, ms: elapsed, attempt };
      }

      if (outcome.status === "cooldown") {
        if (attempt >= maxAttempts) {
          return { status: "cooldown", error: outcome.message, retryAfterMs: outcome.retryAfterMs, ms: elapsed, attempt };
        }
        const waitMs = outcome.retryAfterMs ?? retry.cooldownFallbackMs ?? 70000;
        console.log(`  [cooldown] waiting ${(waitMs / 1000).toFixed(0)}s before retry...`);
        await sleep(waitMs);
        await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 60000 });
        await page.locator(selectors.title).first().waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
        await page.locator(selectors.body).first().waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
        await setLocatorValue(page.locator(selectors.title).first(), title);
        await setLocatorValue(page.locator(selectors.body).first(), body);
        continue;
      }

      if (outcome.status === "permission_denied" || outcome.status === "validation_error") {
        return { status: outcome.status, error: outcome.message, ms: elapsed, attempt };
      }

      if (attempt >= maxAttempts) {
        return { status: "timeout", error: outcome.message, ms: elapsed, attempt };
      }
      await sleep(retry.networkRetryDelayMs ?? 3000);
      await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 60000 });
      await page.locator(selectors.title).first().waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
      await page.locator(selectors.body).first().waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
      await setLocatorValue(page.locator(selectors.title).first(), title);
      await setLocatorValue(page.locator(selectors.body).first(), body);
    } catch (err) {
      const elapsed = Date.now() - startMs;
      if (attempt >= maxAttempts) {
        return { status: "network_error", error: err.message, ms: elapsed, attempt };
      }
      await sleep(retry.networkRetryDelayMs ?? 3000);
    }
  }

  return { status: "timeout", error: "max attempts reached", ms: 0, attempt };
}

async function runProfile({ gpmClient, gpmConfig, forumConfig, campaign, profileId, recipientQueue, resume }) {
  const tracker = new ErrorTracker(campaign.errorThreshold ?? 3);
  const timeouts = forumConfig.timeouts ?? {};

  const profileResponse = await gpmClient.getProfile(profileId);
  const profile = profileResponse.data;
  // Close profile first in case it's already open (ALREADY_OPEN error)
  await gpmClient.closeProfile(profileId).catch(() => {});
  await sleep(timeouts.closeBeforeStartMs ?? 2000);
  const started = await gpmClient.startProfile(profileId, gpmConfig.startOptions ?? {});
  const debuggingAddress = started.data.remote_debugging_address;
  if (!debuggingAddress) {
    throw new Error(`No remote_debugging_address for profile ${profileId}`);
  }
  // Poll CDP endpoint until browser is ready
  console.log(`[${profileId}] Waiting for browser at ${debuggingAddress}...`);
  await gpmClient.waitForCdpReady(debuggingAddress, { timeoutMs: timeouts.cdpReadyMs ?? 30000, intervalMs: timeouts.cdpPollIntervalMs ?? 2000 });
  const browser = await chromium.connectOverCDP(`http://${debuggingAddress}`);

  console.log(`[${profileId}] Profile started: ${profile.name}`);

  try {
    let sequence = (resume?.recipientIndex ?? 0);
    let sentCount = 0;
    let errorCount = 0;

    while (recipientQueue.length > 0) {
      if (tracker.shouldPause) {
        const stopReason = `${tracker.errorStreak} consecutive errors: ${tracker.lastErrors.map(e => e.status).join(", ")}`;
        console.error(`[${profileId}] PAUSED: ${stopReason}`);
        await appendResult(runtimeDir, campaign.id, profileId, { STOP_REASON: stopReason });
        await updateSummary(runtimeDir, campaign.id, profileId, { status: "paused", error: stopReason });
        await writeState(runtimeDir, campaign.id, profileId, {
          recipientQueue,
          recipientIndex: sequence,
          sequence,
          lastError: stopReason,
          lastStatus: "paused"
        });
        break;
      }

      const recipient = recipientQueue.shift();
      sequence += 1;
      const content = buildCampaignContent({
        campaign,
        contentPack: campaign.contentPackPath ? await loadContentPack(campaign.contentPackPath) : null,
        recipient,
        profile,
        sequence
      });

      console.log(`[${profileId}][#${sequence}] Sending to ${recipient}...`);

      let context;
      try {
        context = browser.contexts()[0];
      } catch {
        console.error(`[${profileId}] Browser disconnected, stopping profile`);
        break;
      }
      if (!context) {
        console.error(`[${profileId}] No browser context, stopping profile`);
        break;
      }
      const page = context.pages()[0] ?? await context.newPage();
      const composeUrl = buildComposeUrl(forumConfig, recipient);
      const startMs = Date.now();

      try {
        await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 60000 });
        await page.locator(forumConfig.selectors.title).first().waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
        await page.locator(forumConfig.selectors.body).first().waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
        await setLocatorValue(page.locator(forumConfig.selectors.title).first(), content.title);
        await setLocatorValue(page.locator(forumConfig.selectors.body).first(), content.body);

        const result = await submitWithRetry({
          page,
          forumConfig,
          composeUrl,
          title: content.title,
          body: content.body,
          maxAttempts: forumConfig.retry?.maxAttempts ?? 3
        });

        const elapsed = Date.now() - startMs;
        const entry = {
          action: "send_pm",
          member: recipient,
          status: result.status,
          url: result.url ?? null,
          error: result.error ?? null,
          ms: elapsed,
          attempt: result.attempt ?? 1
        };

        await appendResult(runtimeDir, campaign.id, profileId, entry);
        await updateSummary(runtimeDir, campaign.id, profileId, entry);

        if (result.status === "sent") {
          tracker.record("sent");
          sentCount += 1;
          console.log(`[${profileId}][#${sequence}] Sent to ${recipient} (${elapsed}ms)`);
          if (result.url) {
            const sentDir = path.join(dataDir, campaign.forumId, "sent");
            await ensureDir(sentDir);
            const sentFile = path.join(sentDir, `${profileId}_successful.txt`);
            await fs.appendFile(sentFile, `${new Date().toISOString()}\t${recipient}\t${result.url}\n`);
          }
        } else {
          tracker.record(result.status, result.error);
          errorCount += 1;
          console.error(`[${profileId}][#${sequence}] ${result.status}: ${result.error ?? "unknown"} (${elapsed}ms)`);
        }

        await writeState(runtimeDir, campaign.id, profileId, {
          recipientQueue,
          recipientIndex: sequence,
          sequence,
          lastRecipient: recipient,
          lastError: result.error,
          lastStatus: result.status
        });
      } catch (err) {
        const elapsed = Date.now() - startMs;
        tracker.record("network_error", err.message);
        errorCount += 1;
        console.error(`[${profileId}][#${sequence}] Error: ${err.message} (${elapsed}ms)`);

        const entry = { action: "send_pm", member: recipient, status: "network_error", error: err.message, ms: elapsed };
        await appendResult(runtimeDir, campaign.id, profileId, entry);
        await updateSummary(runtimeDir, campaign.id, profileId, entry);
      }

      if (recipientQueue.length > 0 && !tracker.shouldPause) {
        const delayMin = forumConfig.delayMs?.min ?? 60000;
        const delayMax = forumConfig.delayMs?.max ?? 70000;
        const delay = randomInt(delayMin, delayMax);
        console.log(`[${profileId}] Waiting ${(delay / 1000).toFixed(0)}s before next recipient...`);
        await sleep(delay);
      }
    }

    if (!tracker.shouldPause) {
      await appendResult(runtimeDir, campaign.id, profileId, { action: "campaign_complete", status: "done" });
      await updateSummary(runtimeDir, campaign.id, profileId, { status: "done" });
    }

    console.log(`[${profileId}] Finished: ${sentCount} sent, ${errorCount} errors`);
  } finally {
    // Wait before closing so cookies/session data are persisted
    await sleep(timeouts.closeProfileMs ?? 15000);
    await browser.close().catch(() => {});
    await gpmClient.closeProfile(profileId).catch(() => {});
    console.log(`[${profileId}] Profile stopped`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const campaign = await loadCampaign(args.campaignId);
  const forumConfig = await loadForumConfig(campaign.forumId);
  const gpmConfig = await readJson(`${configDir}/gpm.json`);
  const gpmClient = new GpmClient(gpmConfig.baseUrl);

  let recipientQueue;
  let resumeState = null;

  if (args.resume) {
    resumeState = await readState(runtimeDir, args.campaignId, args.profileIds[0] ?? campaign.profileIds[0]);
  }

  if (resumeState?.recipientQueue) {
    recipientQueue = resumeState.recipientQueue;
    console.log(`Resuming with ${recipientQueue.length} remaining recipients`);
  } else {
    recipientQueue = campaign.memberSourcePath
      ? await (await import("./lib/campaign-sources.js")).loadMembersFromSource(campaign.memberSourcePath)
      : await loadMemberList(campaign);
  }

  const profileIds = args.profileIds.length > 0 ? args.profileIds : campaign.profileIds;
  if (profileIds.length === 0) {
    throw new Error("No profile ids. Set campaign.profileIds or pass --profiles");
  }

  console.log(`Campaign: ${args.campaignId} | Forum: ${campaign.forumId} | Recipients: ${recipientQueue.length} | Profiles: ${profileIds.length}`);

  // Distribute recipients across profiles (round-robin)
  const queues = [];
  for (let i = 0; i < profileIds.length; i++) queues.push([]);
  recipientQueue.forEach((r, i) => queues[i % profileIds.length].push(r));

  // Run all profiles in parallel — each with its own queue and browser
  const results = await Promise.allSettled(
    profileIds.map((pid, i) =>
      runProfile({ gpmClient, gpmConfig, forumConfig, campaign, profileId: pid, recipientQueue: queues[i], resume: resumeState })
        .catch(err => {
          console.error(`[${pid}] Profile failed: ${err.message}`);
          return { profileId: pid, error: err.message };
        })
    )
  );

  const succeeded = results.filter(r => r.status === "fulfilled" && !r.value?.error).length;
  const failed = results.filter(r => r.status === "rejected" || r.value?.error).length;
  console.log(`\nCampaign complete: ${succeeded} profiles succeeded, ${failed} profiles failed`);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});