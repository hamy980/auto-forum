import { sleep } from "../../lib/utils.js";

export const checkTelegramInboxTask = {
  name: "telegram:check-inbox",
  async run({ ctx, state }) {
    const config = ctx.platformConfig;
    const page = state.page;
    const selectors = config.selectors ?? {};

    const unreadSelector = selectors.unreadChat ?? ".chatlist-chat.is-unread";
    const chatTitleSelector = selectors.chatTitle ?? ".peer-title";

    const unreadChats = await page.locator(unreadSelector).all();
    const conversations = [];

    for (const chat of unreadChats) {
      const title = await chat.locator(chatTitleSelector).first().textContent().catch(() => "").then(s => s.trim());
      conversations.push({ title, element: chat });
    }

    if (conversations.length === 0) {
      return { ...state, conversations: [], status: "inbox_empty" };
    }

    return { ...state, conversations, status: "inbox_has_unread" };
  }
};