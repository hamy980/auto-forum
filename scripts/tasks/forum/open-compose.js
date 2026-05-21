import { normalizeRecipientForForum } from "../../lib/utils.js";

function buildComposeUrl(forumConfig, recipient) {
  const encodedRecipient = normalizeRecipientForForum(recipient, forumConfig.recipientEncoding);
  return forumConfig.composeUrlTemplate.replace("{recipient}", encodedRecipient);
}

export const openComposeTask = {
  name: "forum:open-compose",
  async run({ ctx, state }) {
    const context = state.browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    const composeUrl = buildComposeUrl(ctx.forumConfig, state.currentRecipient);

    await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator(ctx.forumConfig.selectors.title).first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator(ctx.forumConfig.selectors.body).first().waitFor({ state: "visible", timeout: 15000 });

    return {
      ...state,
      page,
      composeUrl,
      status: "compose_opened"
    };
  }
};
