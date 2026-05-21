import { getLocatorValue, setLocatorValue } from "../../lib/playwright-helpers.js";

async function verifyField(page, selector, expected) {
  const actual = await getLocatorValue(page.locator(selector).first());
  if (actual !== expected) {
    throw new Error(`Field verification failed for ${selector}. Expected "${expected}" but got "${actual}"`);
  }
}

export const fillPmFormTask = {
  name: "forum:fill-form",
  async run({ ctx, state }) {
    await setLocatorValue(state.page.locator(ctx.forumConfig.selectors.title).first(), state.currentTitle);
    await setLocatorValue(state.page.locator(ctx.forumConfig.selectors.body).first(), state.currentBody);
    await verifyField(state.page, ctx.forumConfig.selectors.title, state.currentTitle);
    await verifyField(state.page, ctx.forumConfig.selectors.body, state.currentBody);

    return {
      ...state,
      status: "form_verified"
    };
  }
};
