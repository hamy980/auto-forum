export const readTelegramMessagesTask = {
  name: "telegram:read-messages",
  async run({ ctx, state }) {
    const config = ctx.platformConfig;
    const page = state.page;
    const convConfig = config.conversation ?? {};

    const msgSelector = convConfig.messageBlock ?? ".bubble";
    const authorSelector = convConfig.messageAuthor ?? ".bubble .peer-title";
    const bodySelector = convConfig.messageBody ?? ".bubble .message";
    const timeSelector = convConfig.messageTime ?? ".bubble .message-time";

    const count = await page.locator(msgSelector).count();
    const messages = [];

    for (let i = 0; i < count; i += 1) {
      const msg = page.locator(msgSelector).nth(i);
      const author = await msg.locator(authorSelector).first().textContent().catch(() => "").then(s => s.trim());
      const body = await msg.locator(bodySelector).first().textContent().catch(() => "").then(s => s.trim());
      const timeEl = msg.locator(timeSelector).first();
      const dataTime = await timeEl.getAttribute("data-time").catch(() => null);
      messages.push({ author, body, dataTime: dataTime ? Number(dataTime) : 0 });
    }

    return { ...state, newMessages: messages, status: "messages_read" };
  }
};