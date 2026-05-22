import { sleep } from "../../lib/utils.js";

export const openChatTask = {
  name: "telegram:open-chat",
  async run({ ctx, state }) {
    const config = ctx.platformConfig;
    const page = state.page;
    const recipient = state.currentRecipient;
    const selectors = config.selectors ?? {};

    // Click search input
    const searchInput = page.locator(selectors.searchInput ?? ".search-input").first();
    await searchInput.waitFor({ state: "visible", timeout: 15000 });
    await searchInput.click();
    await sleep(500);

    // Type recipient username
    await searchInput.fill(recipient);
    await sleep(2000);

    // Find matching result in search results
    const chatListSelector = selectors.sidebarChatList ?? ".chatlist";
    const chatTitleSelector = selectors.chatTitle ?? ".peer-title";

    // Search results appear in sidebar — look for matching chat
    const results = page.locator(`${chatListSelector} ${chatTitleSelector}`);
    const count = await results.count();

    if (count === 0) {
      return { ...state, status: "chat_not_found", lastError: `No search results for "${recipient}"` };
    }

    // Click the first matching result
    await results.first().click();
    await sleep(1500);

    // Verify chat input is visible
    const chatInput = page.locator(selectors.chatInput ?? ".input-message-input").first();
    try {
      await chatInput.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      return { ...state, status: "chat_open_failed", lastError: "Chat input did not appear after clicking search result" };
    }

    // Clear search
    await searchInput.click();
    await page.keyboard.press("Escape");
    await sleep(500);

    return { ...state, status: "chat_opened" };
  }
};