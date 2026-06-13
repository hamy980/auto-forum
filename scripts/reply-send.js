import { chromium } from "playwright";
import { loadForumConfig } from "./lib/forum-config.js";
import { configDir } from "./lib/paths.js";
import { readJson, sleep } from "./lib/utils.js";
import { GpmClient } from "./lib/gpm-client.js";
import { setLocatorValue } from "./lib/playwright-helpers.js";
import path from "node:path";

function parseArgs(argv) {
  const parsed = { forumId: null, profileId: null, url: null, content: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--forum") { parsed.forumId = argv[++i]; continue; }
    if (arg === "--profile") { parsed.profileId = argv[++i]; continue; }
    if (arg === "--url") { parsed.url = argv[++i]; continue; }
    if (arg === "--content") { parsed.content = argv[++i]; continue; }
  }
  if (!parsed.forumId || !parsed.profileId || !parsed.url) {
    throw new Error("Usage: node scripts/reply-send.js --forum <id> --profile <id> --url <conversation_url> [--content \"reply text\"]");
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const forumConfig = await loadForumConfig(args.forumId);
  const timeouts = forumConfig.timeouts ?? {};
  const gpmConfig = await readJson(path.join(configDir, "gpm.json"));
  const gpmClient = new GpmClient(gpmConfig.baseUrl);

  console.error(`[send] Starting profile ${args.profileId}...`);
  const profileResponse = await gpmClient.getProfile(args.profileId);
  await gpmClient.closeProfile(args.profileId).catch(() => {});
  await sleep(timeouts.closeBeforeStartMs ?? 2000);
  const started = await gpmClient.startProfile(args.profileId, gpmConfig.startOptions ?? {});
  const debuggingAddress = started.data.remote_debugging_address;
  if (!debuggingAddress) {
    throw new Error(`No remote_debugging_address for profile ${args.profileId}`);
  }
  console.error(`[send] Waiting for browser at ${debuggingAddress}...`);
  await gpmClient.waitForCdpReady(debuggingAddress, { timeoutMs: timeouts.cdpReadyMs ?? 30000, intervalMs: timeouts.cdpPollIntervalMs ?? 2000 });
  const browser = await chromium.connectOverCDP(`http://${debuggingAddress}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  try {
    console.error(`[send] Navigating to ${args.url}...`);
    await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 60000 });
    await sleep(timeouts.conversationSettleMs ?? 1000);

    // If no content provided, skip sending and just confirm page loaded
    if (!args.content) {
      const result = { status: "page_loaded", url: page.url(), error: null };
      console.log(JSON.stringify(result, null, 2));
      await browser.close().catch(() => {});
      await gpmClient.closeProfile(args.profileId).catch(() => {});
      return;
    }

    const convConfig = forumConfig.conversation ?? {};
    const editorSelector = convConfig.replyEditor ?? ".fr-element[contenteditable='true']";
    const submitSelector = convConfig.replySubmit ?? "button.button--icon--reply";

    const editor = page.locator(editorSelector).first();
    await editor.waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
    await setLocatorValue(editor, args.content);
    await sleep(timeouts.replyEditorClickMs ?? 300);

    const submitBtn = page.locator(submitSelector).first();
    await submitBtn.click();
    await page.waitForLoadState("domcontentloaded", { timeout: timeouts.waitFor ?? 15000 }).catch(() => {});
    await sleep(timeouts.postSubmitMs ?? 1000);

    // Check for validation errors
    const validationSelectors = forumConfig.validationErrorSelectors ?? [];
    let validationError = null;
    for (const selector of validationSelectors) {
      const errorEl = page.locator(selector).first();
      const errorText = await errorEl.textContent({ timeout: 2000 }).catch(() => null);
      if (errorText?.trim()) {
        validationError = errorText.trim();
        break;
      }
    }

    if (validationError) {
      const result = { status: "reply_validation_error", url: page.url(), error: validationError };
      console.log(JSON.stringify(result, null, 2));
      await browser.close().catch(() => {});
      await gpmClient.closeProfile(args.profileId).catch(() => {});
      return;
    }

    const result = { status: "reply_sent", url: page.url(), error: null };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sleep(timeouts.closeProfileMs ?? 15000);
    await browser.close().catch(() => {});
    await gpmClient.closeProfile(args.profileId).catch(() => {});
    console.error(`[send] Profile stopped`);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});