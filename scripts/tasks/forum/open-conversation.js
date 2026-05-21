export const openConversationTask = {
  name: "forum:open-conversation",
  async run({ state }) {
    if (!state.lastConversationUrl) {
      throw new Error("lastConversationUrl is required to open a conversation");
    }

    const context = state.browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(state.lastConversationUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    return {
      ...state,
      page,
      status: "conversation_opened"
    };
  }
};
