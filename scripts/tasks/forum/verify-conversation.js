async function hasExpectedBody(page, expectedBody) {
  const bodyText = await page.locator("body").textContent({ timeout: 5000 });
  return bodyText?.includes(expectedBody) ?? false;
}

export const verifyConversationTask = {
  name: "forum:verify-conversation",
  async run({ state }) {
    try {
      const pageTitle = await Promise.race([
        state.page.title(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("verify title timeout")), 5000))
      ]);
      const hasTitle = pageTitle.includes(state.currentTitle);
      const hasBody = await Promise.race([
        hasExpectedBody(state.page, state.currentBody),
        new Promise((_, reject) => setTimeout(() => reject(new Error("verify body timeout")), 5000))
      ]);

      return {
        ...state,
        verification: {
          pageTitle,
          hasTitle,
          hasBody
        },
        status: hasTitle && hasBody ? "verified" : "verification_failed",
        lastError: hasTitle && hasBody
          ? null
          : `Verification failed. hasTitle=${hasTitle} hasBody=${hasBody}`
      };
    } catch (error) {
      return {
        ...state,
        verification: {
          pageTitle: null,
          hasTitle: false,
          hasBody: false
        },
        status: "verification_error",
        lastError: error.message
      };
    }
  }
};
