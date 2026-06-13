import { chromium } from "playwright";
import path from "node:path";
import { loadCampaign, loadForumConfig, loadMemberList } from "./forum-config.js";
import { configDir, runtimeDir } from "./paths.js";
import {
  ensureDir,
  fillTemplate,
  normalizeRecipientForForum,
  parseFirstName,
  pickOne,
  randomInt,
  readJson,
  resolveMaybeRelative,
  sleep
} from "./utils.js";
import { GpmClient } from "./gpm-client.js";
import { collectNetworkDuring, getLocatorValue, setLocatorValue } from "./playwright-helpers.js";

function buildComposeUrl(forumConfig, recipient) {
  const encodedRecipient = normalizeRecipientForForum(recipient, forumConfig.recipientEncoding);
  return forumConfig.composeUrlTemplate.replace("{recipient}", encodedRecipient);
}

function buildPersonalizedContent(campaign, recipient, profile, sequence) {
  const context = {
    campaign_id: campaign.id,
    recipient_name: recipient,
    first_name: parseFirstName(recipient),
    profile_id: profile.id,
    profile_name: profile.name,
    sequence
  };

  const title = fillTemplate(pickOne(campaign.titleTemplates, sequence), context);
  const body = fillTemplate(pickOne(campaign.bodyTemplates, sequence), context);
  return { title, body };
}

async function verifyField(page, selector, expected) {
  const locator = page.locator(selector).first();
  const actual = await getLocatorValue(locator);
  if (actual !== expected) {
    throw new Error(`Field verification failed for ${selector}. Expected "${expected}" but got "${actual}"`);
  }
}

function detectOutcome(page, events, forumConfig) {
  const submitResponse = [...events]
    .reverse()
    .find((event) => event.type === "response" && isSubmitUrl(event.url, forumConfig));

  if (submitResponse?.body?.includes(forumConfig.cooldownErrorIncludes)) {
    return {
      status: "cooldown",
      message: submitResponse.body
    };
  }

  if (submitResponse?.body?.includes(forumConfig.permissionErrorIncludes)) {
    return {
      status: "permission_denied",
      message: submitResponse.body
    };
  }

  if (page.url().includes(forumConfig.successUrlIncludes) && !page.url().includes("/add")) {
    return {
      status: "sent",
      conversationUrl: page.url()
    };
  }

  return {
    status: "unknown",
    message: submitResponse?.body ?? "No conclusive success or error signal"
  };
}

function isSubmitUrl(url, forumConfig) {
  const composePath = new URL(forumConfig.composeUrlTemplate.replace("{recipient}", "placeholder")).pathname;
  const submitPath = composePath.replace(/\?.*$/, "");
  return url.includes(submitPath) && !url.includes("job.php");
}

function extractCooldownMs(message) {
  if (!message) {
    return null;
  }
  const secondsMatch = message.match(/wait at least\s+(\d+)\s+seconds/i);
  if (secondsMatch) {
    return (Number(secondsMatch[1]) + 2) * 1000;
  }
  const minutesMatch = message.match(/wait at least\s+(\d+)\s+minutes?/i);
  if (minutesMatch) {
    return (Number(minutesMatch[1]) * 60 + 2) * 1000;
  }
  return null;
}

async function readValidationErrors(page, forumConfig) {
  const selectors = forumConfig.validationErrorSelectors ?? [];
  const values = [];
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    for (let index = 0; index < count; index += 1) {
      const text = (await page.locator(selector).nth(index).textContent())?.trim();
      if (text) {
        values.push(text);
      }
    }
  }
  return values;
}

async function waitForSubmitResolution(page, forumConfig, composeUrl) {
  const retryConfig = forumConfig.retry ?? {};
  const timeoutMs = retryConfig.postClickPollMs ?? 12000;
  const pollIntervalMs = retryConfig.postClickPollIntervalMs ?? 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentUrl = page.url();
    if (currentUrl.includes(forumConfig.successUrlIncludes) && !currentUrl.startsWith(composeUrl)) {
      return {
        status: "sent",
        conversationUrl: currentUrl
      };
    }

    const errors = await readValidationErrors(page, forumConfig);
    const combined = errors.join("\n");
    if (combined) {
      if (forumConfig.cooldownErrorIncludes && combined.includes(forumConfig.cooldownErrorIncludes)) {
        return {
          status: "cooldown",
          message: combined,
          retryAfterMs: extractCooldownMs(combined)
        };
      }
      if (forumConfig.permissionErrorIncludes && combined.includes(forumConfig.permissionErrorIncludes)) {
        return {
          status: "permission_denied",
          message: combined
        };
      }
      return {
        status: "validation_error",
        message: combined
      };
    }

    await sleep(pollIntervalMs);
  }

  return {
    status: "timeout",
    message: `No success or error state within ${timeoutMs}ms`
  };
}

async function sendPmViaProfile({
  browser,
  forumConfig,
  profile,
  recipient,
  title,
  body
}) {
  const timeouts = forumConfig.timeouts ?? {};
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();
  const composeUrl = buildComposeUrl(forumConfig, recipient);

  await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 60000 });
  await page.locator(forumConfig.selectors.title).first().waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
  await page.locator(forumConfig.selectors.body).first().waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });

  await setLocatorValue(page.locator(forumConfig.selectors.title).first(), title);
  await setLocatorValue(page.locator(forumConfig.selectors.body).first(), body);
  await verifyField(page, forumConfig.selectors.title, title);
  await verifyField(page, forumConfig.selectors.body, body);

  const maxAttempts = forumConfig.retry?.maxAttempts ?? 1;
  let attempt = 0;
  let lastResult = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    const events = await collectNetworkDuring(
      page,
      async () => {
        await page.locator(forumConfig.selectors.submit).nth(forumConfig.submitIndex ?? 0).click();
        await page.waitForLoadState("domcontentloaded", { timeout: timeouts.waitFor ?? 15000 }).catch(() => {});
        await sleep(timeouts.postSubmitMs ?? 1000);
      },
      (url, resourceType) =>
        url.includes(new URL(forumConfig.baseUrl).host) &&
        ["document", "fetch", "xhr"].includes(resourceType)
    );

    const submitResponseOutcome = detectOutcome(page, events, forumConfig);
    const pageOutcome = await waitForSubmitResolution(page, forumConfig, composeUrl);
    const outcome =
      pageOutcome.status !== "timeout" && pageOutcome.status !== "validation_error"
        ? pageOutcome
        : submitResponseOutcome.status !== "unknown"
          ? submitResponseOutcome
          : pageOutcome;

    lastResult = {
      profileId: profile.id,
      profileName: profile.name,
      recipient,
      title,
      body,
      composeUrl,
      finalUrl: page.url(),
      attempt,
      outcome,
      events
    };

    if (outcome.status === "sent") {
      return lastResult;
    }

    if (outcome.status === "cooldown") {
      const retryAfterMs = outcome.retryAfterMs ?? extractCooldownMs(outcome.message) ?? 70000;
      if (attempt >= maxAttempts) {
        return lastResult;
      }
      await sleep(retryAfterMs);
      await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.locator(forumConfig.selectors.title).first().waitFor({ state: "visible", timeout: 15000 });
      await page.locator(forumConfig.selectors.body).first().waitFor({ state: "visible", timeout: 15000 });
      await setLocatorValue(page.locator(forumConfig.selectors.title).first(), title);
      await setLocatorValue(page.locator(forumConfig.selectors.body).first(), body);
      await verifyField(page, forumConfig.selectors.title, title);
      await verifyField(page, forumConfig.selectors.body, body);
      continue;
    }

    if (outcome.status === "timeout" || outcome.status === "unknown") {
      if (page.url().includes(forumConfig.successUrlIncludes) && !page.url().startsWith(composeUrl)) {
        lastResult.outcome = {
          status: "sent",
          conversationUrl: page.url()
        };
        return lastResult;
      }
      if (attempt >= maxAttempts) {
        return lastResult;
      }
      await sleep(forumConfig.retry?.networkRetryDelayMs ?? 3000);
      await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.locator(forumConfig.selectors.title).first().waitFor({ state: "visible", timeout: 15000 });
      await page.locator(forumConfig.selectors.body).first().waitFor({ state: "visible", timeout: 15000 });
      await setLocatorValue(page.locator(forumConfig.selectors.title).first(), title);
      await setLocatorValue(page.locator(forumConfig.selectors.body).first(), body);
      await verifyField(page, forumConfig.selectors.title, title);
      await verifyField(page, forumConfig.selectors.body, body);
      continue;
    }

    return lastResult;
  }

  return lastResult;
}

async function connectStartedProfile(startPayload) {
  const debuggingAddress = startPayload.data.remote_debugging_address;
  if (!debuggingAddress) {
    throw new Error("GPM start profile response did not include remote_debugging_address");
  }
  return chromium.connectOverCDP(`http://${debuggingAddress}`);
}

async function runProfileFlow({ gpmClient, gpmConfig, forumConfig, campaign, recipientQueue, profileId }) {
  const profileResponse = await gpmClient.getProfile(profileId);
  const profile = profileResponse.data;
  const started = await gpmClient.startProfile(profileId, gpmConfig.startOptions ?? {});
  const browser = await connectStartedProfile(started);
  const results = [];

  try {
    let sequence = 0;
    while (recipientQueue.length > 0) {
      const recipient = recipientQueue.shift();
      sequence += 1;
      const content = buildPersonalizedContent(campaign, recipient, profile, sequence);
      const result = await sendPmViaProfile({
        browser,
        forumConfig,
        profile,
        recipient,
        title: content.title,
        body: content.body
      });
      results.push(result);

      const delayMin = forumConfig.delayMs?.min ?? gpmConfig.delayMs?.min ?? 70000;
      const delayMax = forumConfig.delayMs?.max ?? gpmConfig.delayMs?.max ?? delayMin;
      if (recipientQueue.length > 0) {
        await sleep(randomInt(delayMin, delayMax));
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await gpmClient.closeProfile(profileId).catch(() => {});
  }

  return results;
}

export async function runCampaign({
  campaignId,
  profileIdsOverride = []
}) {
  const gpmConfig = await readJson(path.join(configDir, "gpm.json"));
  const campaign = await loadCampaign(campaignId);
  const forumConfig = await loadForumConfig(campaign.forumId);
  const members = await loadMemberList(campaign);
  const recipientQueue = [...members];
  const gpmClient = new GpmClient(gpmConfig.baseUrl);
  const profileIds = profileIdsOverride.length > 0 ? profileIdsOverride : campaign.profileIds;

  if (profileIds.length === 0) {
    throw new Error("No profile ids provided. Set campaign.profileIds or pass --profiles");
  }

  await ensureDir(runtimeDir);
  const concurrency = Math.max(1, Math.min(gpmConfig.concurrency ?? profileIds.length, profileIds.length));
  const workers = profileIds.slice(0, concurrency).map((profileId) =>
    runProfileFlow({
      gpmClient,
      gpmConfig,
      forumConfig,
      campaign,
      recipientQueue,
      profileId
    })
  );
  const nestedResults = await Promise.all(workers);
  const results = nestedResults.flat();
  return {
    campaignId,
    forumId: campaign.forumId,
    results
  };
}
