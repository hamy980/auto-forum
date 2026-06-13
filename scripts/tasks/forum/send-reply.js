import { setLocatorValue } from "../../lib/playwright-helpers.js";
import { sleep } from "../../lib/utils.js";

export const sendReplyTask = {
  name: "forum:send-reply",
  async run({ ctx, state }) {
    if (!state.lastConversationUrl) {
      return { ...state, lastError: "lastConversationUrl is required to send reply" };
    }

    const convConfig = ctx.forumConfig.conversation ?? {};
    const timeouts = ctx.forumConfig.timeouts ?? {};
    const context = state.browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(state.lastConversationUrl, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 60000 });
    await sleep(timeouts.conversationSettleMs ?? 1000);

    const replyEditorSelector = convConfig.replyEditor ?? ".fr-element[contenteditable='true']";
    const replySubmitSelector = convConfig.replySubmit ?? "button.button--icon--reply";

    const replyEditor = page.locator(replyEditorSelector).first();
    await replyEditor.waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });
    await setLocatorValue(replyEditor, state.replyBody ?? state.currentBody ?? "");

    await sleep(timeouts.replyEditorClickMs ?? 300);

    const submitBtn = page.locator(replySubmitSelector).first();
    await submitBtn.click();
    await page.waitForLoadState("domcontentloaded", { timeout: timeouts.waitFor ?? 15000 }).catch(() => {});
    await sleep(timeouts.postSubmitMs ?? 1000);

    const validationSelectors = ctx.forumConfig.validationErrorSelectors ?? [];
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
      if (validationError.includes(ctx.forumConfig.cooldownErrorIncludes ?? "You must wait at least")) {
        return { ...state, page, lastError: validationError, status: "cooldown" };
      }
      return { ...state, page, lastError: validationError, status: "reply_validation_error" };
    }

    return { ...state, page, lastError: null, status: "reply_sent" };
  }
};