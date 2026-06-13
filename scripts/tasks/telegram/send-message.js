import { sleep } from "../../lib/utils.js";
import { setLocatorValue } from "../../lib/playwright-helpers.js";

export const sendMessageTask = {
  name: "telegram:send-message",
  async run({ ctx, state }) {
    const config = ctx.platformConfig;
    const timeouts = config.timeouts ?? {};
    const page = state.page;
    const messageBody = state.currentContent?.body;
    const selectors = config.selectors ?? {};

    if (!messageBody) {
      return { ...state, status: "message_not_sent", lastError: "No message body" };
    }

    // Type message into chat input
    const chatInput = page.locator(selectors.chatInput ?? ".input-message-input").first();
    await setLocatorValue(chatInput, messageBody);
    await sleep(timeouts.replyEditorClickMs ?? 500);

    // Click send button
    const sendBtn = page.locator(selectors.sendButton ?? ".btn-send").first();
    try {
      await sendBtn.click({ timeout: 5000 });
    } catch {
      // Fallback: press Enter
      await page.keyboard.press("Enter");
    }

    // Wait for message to appear in chat
    const timeoutMs = config.retry?.postClickPollMs ?? 8000;
    const pollInterval = config.retry?.postClickPollIntervalMs ?? 500;
    const startTime = Date.now();
    const searchSnippet = messageBody.slice(0, 50);

    while (Date.now() - startTime < timeoutMs) {
      const bubbles = await page.locator(config.conversation?.messageBlock ?? ".bubble").all();
      // Check last few bubbles for the sent text
      for (let i = Math.max(0, bubbles.length - 3); i < bubbles.length; i++) {
        const text = await bubbles[i].textContent().catch(() => "");
        if (text.includes(searchSnippet)) {
          return { ...state, status: "message_sent" };
        }
      }
      await sleep(pollInterval);
    }

    return { ...state, status: "message_timeout", lastError: "Message did not appear in chat within timeout" };
  }
};