import { sleep } from "../../lib/utils.js";

export const openUnreadConversationTask = {
  name: "forum:open-unread-conversation",
  async run({ ctx, state }) {
    const targetTitle = state.targetConversationTitle;
    const inboxConfig = ctx.forumConfig.inbox ?? {};
    const context = state.browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();

    // Navigate to forum homepage
    await page.goto(ctx.forumConfig.baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(2000);

    // Check unread badge
    const triggerSelector = inboxConfig.popupTrigger ?? ".p-navgroup-link--conversations";
    const trigger = page.locator(triggerSelector).first();
    await trigger.waitFor({ state: "visible", timeout: 15000 });

    const badgeAttr = inboxConfig.unreadBadgeAttr ?? "data-badge";
    const badgeValue = await trigger.getAttribute(badgeAttr).catch(() => "0");
    const unreadCount = Number(badgeValue) || 0;

    if (unreadCount === 0) {
      return { ...state, status: "inbox_empty", lastError: "No unread conversations" };
    }

    // Open popup
    await trigger.click();
    await sleep(3000);

    // Parse highlighted rows
    const rowSelector = inboxConfig.popupRowHighlighted ?? ".menu-row--highlighted";
    const linkSelector = inboxConfig.popupConversationLink ?? ".fauxBlockLink-blockLink";
    const timeSelector = inboxConfig.popupTime ?? "time[data-time]";
    const rowCount = await page.locator(rowSelector).count();

    if (rowCount === 0) {
      return { ...state, status: "no_highlighted_rows", lastError: "Popup has no highlighted rows" };
    }

    // Collect unread rows with title, url, dataTime
    const rows = [];
    for (let i = 0; i < rowCount; i++) {
      const row = page.locator(rowSelector).nth(i);
      const linkEl = row.locator(linkSelector).first();
      const text = await linkEl.textContent().catch(() => null);
      const href = await linkEl.getAttribute("href").catch(() => null);
      const url = href ? (href.startsWith("http") ? href : `${ctx.forumConfig.baseUrl}${href}`) : null;
      const timeEl = row.locator(timeSelector).first();
      const dataTime = await timeEl.getAttribute("data-time").catch(() => null);
      rows.push({ title: text?.trim(), url, dataTime: dataTime ? Number(dataTime) : 0 });
    }

    // Sort by dataTime descending — newest first
    rows.sort((a, b) => (b.dataTime ?? 0) - (a.dataTime ?? 0));

    // Pick target: match by title, or fall back to newest
    let targetRow = null;
    if (targetTitle) {
      targetRow = rows.find((r) => r.title?.includes(targetTitle));
    }
    if (!targetRow) {
      targetRow = rows[0];
    }

    if (!targetRow?.url) {
      return { ...state, status: "conversation_not_found", lastError: `No conversation found for "${targetTitle}"` };
    }

    // Navigate directly to the conversation URL (more reliable than clicking popup overlay)
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(300);

    const conversationUrl = targetRow.url.replace("/unread", "");
    await page.goto(conversationUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(1500);

    return {
      ...state,
      page,
      lastConversationUrl: page.url(),
      inboxCheck: {
        unreadCount,
        pickedTitle: targetRow.title,
        pickedTime: targetRow.dataTime
      },
      status: "conversation_opened"
    };
  }
};