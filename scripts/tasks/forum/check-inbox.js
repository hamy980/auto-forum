import { sleep } from "../../lib/utils.js";

export const checkInboxTask = {
  name: "forum:check-inbox",
  async run({ ctx, state }) {
    const inboxConfig = ctx.forumConfig.inbox ?? {};
    const timeouts = ctx.forumConfig.timeouts ?? {};
    const context = state.browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();

    // Navigate to forum homepage
    await page.goto(ctx.forumConfig.baseUrl, { waitUntil: "domcontentloaded", timeout: timeouts.navigation ?? 60000 });
    await sleep(timeouts.inboxSettleMs ?? 2000);

    // Check unread badge first — skip popup if zero
    const triggerSelector = inboxConfig.popupTrigger ?? ".p-navgroup-link--conversations";
    const trigger = page.locator(triggerSelector).first();
    await trigger.waitFor({ state: "visible", timeout: timeouts.waitFor ?? 15000 });

    const badgeAttr = inboxConfig.unreadBadgeAttr ?? "data-badge";
    const badgeValue = await trigger.getAttribute(badgeAttr).catch(() => "0");
    const unreadCount = Number(badgeValue) || 0;

    if (unreadCount === 0) {
      return {
        ...state,
        page,
        conversations: [],
        unreadConversations: [],
        latestUnreadConversation: null,
        inboxCheck: { total: 0, unreadCount: 0, unread: [] },
        status: "inbox_empty"
      };
    }

    // Open popup and parse unread conversations
    await trigger.click();
    await sleep(timeouts.popupOpenMs ?? 3000);

    const rowSelector = inboxConfig.popupRowHighlighted ?? ".menu-row--highlighted";
    const rowCount = await page.locator(rowSelector).count();

    const conversations = [];
    for (let i = 0; i < rowCount; i++) {
      const row = page.locator(rowSelector).nth(i);

      const linkEl = row.locator(inboxConfig.popupConversationLink ?? ".fauxBlockLink-blockLink").first();
      const title = await linkEl.textContent().catch(() => null);
      const href = await linkEl.getAttribute("href").catch(() => null);
      const url = href ? (href.startsWith("http") ? href : `${ctx.forumConfig.baseUrl}${href}`) : null;

      const timeEl = row.locator(inboxConfig.popupTime ?? "time[data-time]").first();
      const dataTime = await timeEl.getAttribute("data-time").catch(() => null);

      conversations.push({
        title: title?.trim(),
        url,
        unread: true,
        dataTime: dataTime ? Number(dataTime) : 0
      });
    }

    // Sort by dataTime descending — newest first
    conversations.sort((a, b) => (b.dataTime ?? 0) - (a.dataTime ?? 0));

    // Close popup
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(timeouts.popupCloseMs ?? 300);

    const latestUnread = conversations[0] ?? null;

    return {
      ...state,
      page,
      conversations,
      unreadConversations: conversations,
      latestUnreadConversation: latestUnread,
      inboxCheck: {
        total: conversations.length,
        unreadCount: conversations.length,
        unread: conversations,
        badgeCount: unreadCount
      },
      status: conversations.length > 0 ? "inbox_has_unread" : "inbox_empty"
    };
  }
};