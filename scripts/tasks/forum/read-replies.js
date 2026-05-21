export const readRepliesTask = {
  name: "forum:read-replies",
  async run({ ctx, state }) {
    if (!state.lastConversationUrl) {
      return { ...state, newReplies: [], status: "no_conversation_url" };
    }

    const convConfig = ctx.forumConfig.conversation ?? {};
    const context = state.browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(state.lastConversationUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    const messageSelector = convConfig.messageBlock ?? ".message";
    const messageCount = await page.locator(messageSelector).count();

    const knownLastTime = state.knownLastMessageTime ?? null;
    const senderUsername = state.forumUsername ?? state.profileName ?? null;
    const newReplies = [];

    for (let i = 0; i < messageCount; i++) {
      const msg = page.locator(messageSelector).nth(i);

      const author = await msg.locator(convConfig.messageAuthor ?? ".message-name a").first().textContent().catch(() => null);
      const timeAttr = await msg.locator(convConfig.messageTime ?? "time[data-time]").first().getAttribute("data-time").catch(() => null);
      const body = await msg.locator(convConfig.messageBody ?? ".message-body .bbWrapper").first().textContent().catch(() => null);

      const isFromSender = senderUsername && author?.trim().toLowerCase().includes(senderUsername.toLowerCase());
      const isNewer = !knownLastTime || (timeAttr && Number(timeAttr) > Number(knownLastTime));

      if (!isFromSender && isNewer) {
        newReplies.push({ author: author?.trim(), time: timeAttr, body: body?.trim() });
      }
    }

    const latestMessageTime = await page.locator(`${messageSelector}:last-child ${convConfig.messageTime ?? "time[data-time]"}`).first().getAttribute("data-time").catch(() => knownLastTime);

    return {
      ...state,
      page,
      newReplies,
      knownLastMessageTime: latestMessageTime ?? knownLastTime,
      status: newReplies.length > 0 ? "replies_found" : "no_new_replies"
    };
  }
};