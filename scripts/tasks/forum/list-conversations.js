export const listConversationsTask = {
  name: "forum:list-conversations",
  async run({ ctx, state }) {
    const inboxConfig = ctx.forumConfig.inbox ?? {};
    const inboxUrl = `${ctx.forumConfig.baseUrl}${inboxConfig.listUrl ?? "/conversations/"}`;

    const context = state.browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(inboxUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    const rowSelector = inboxConfig.conversationRow ?? ".structItem--conversation";
    const rowCount = await page.locator(rowSelector).count();

    const conversations = [];
    for (let i = 0; i < rowCount; i++) {
      const row = page.locator(rowSelector).nth(i);

      const titleLink = row.locator(inboxConfig.titleLink ?? ".structItem-title a").first();
      const title = await titleLink.textContent().catch(() => null);
      const href = await titleLink.getAttribute("href").catch(() => null);
      const url = href ? (href.startsWith("http") ? href : `${ctx.forumConfig.baseUrl}${href}`) : null;

      const unreadIndicator = inboxConfig.unreadIndicator ?? ".is-unread";
      const isUnread = await row.evaluate((el, cls) => el.classList.contains(cls.replace(/^\./, "")), unreadIndicator).catch(() => false);

      const lastAuthor = await row.locator(inboxConfig.lastMessageAuthor ?? ".structItem-minor .username").first().textContent().catch(() => null);
      const lastTimeEl = row.locator(inboxConfig.lastMessageTime ?? "time[data-time]").first();
      const lastTime = await lastTimeEl.getAttribute("data-time").catch(() => null);

      conversations.push({ title: title?.trim(), url, unread: isUnread, lastAuthor: lastAuthor?.trim(), lastTime });
    }

    return {
      ...state,
      page,
      conversations,
      status: "conversations_listed"
    };
  }
};