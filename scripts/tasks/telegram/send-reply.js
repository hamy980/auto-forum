import { sleep } from "../../lib/utils.js";
import { setLocatorValue } from "../../lib/playwright-helpers.js";

export const sendTelegramReplyTask = {
  name: "telegram:send-reply",
  async run({ ctx, state }) {
    const config = ctx.platformConfig;
    const timeouts = config.timeouts ?? {};
    const page = state.page;
    const replyText = state.replyText;
    const convConfig = config.conversation ?? {};

    if (!replyText) {
      return { ...state, status: "reply_failed", lastError: "No reply text" };
    }

    const editorSelector = convConfig.replyEditor ?? ".input-message-input";
    const submitSelector = convConfig.replySubmit ?? ".btn-send";

    const editor = page.locator(editorSelector).first();
    await editor.waitFor({ state: "visible", timeout: timeouts.waitFor ?? 10000 });
    await setLocatorValue(editor, replyText);
    await sleep(timeouts.replyEditorClickMs ?? 500);

    // Send via button or Enter
    try {
      await page.locator(submitSelector).first().click({ timeout: 5000 });
    } catch {
      await page.keyboard.press("Enter");
    }

    // Verify message appeared
    const pollTimeout = config.retry?.postClickPollMs ?? 8000;
    const pollInterval = config.retry?.postClickPollIntervalMs ?? 500;
    const startTime = Date.now();
    const searchSnippet = replyText.slice(0, 50);
    let sent = false;

    while (Date.now() - startTime < pollTimeout) {
      const bubbles = await page.locator(convConfig.messageBlock ?? ".bubble").all();
      for (let i = Math.max(0, bubbles.length - 3); i < bubbles.length; i++) {
        const text = await bubbles[i].textContent().catch(() => "");
        if (text.includes(searchSnippet)) { sent = true; break; }
      }
      if (sent) break;
      await sleep(pollInterval);
    }

    return {
      ...state,
      status: sent ? "reply_sent" : "reply_timeout",
      lastError: sent ? null : "Reply did not appear in chat"
    };
  }
};