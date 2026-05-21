export const stopProfileTask = {
  name: "gpm:stop-profile",
  async run({ ctx, state }) {
    const lifecycle = state.lifecycle ?? {};
    await state.browser?.close().catch(() => {});
    if (lifecycle.closeProfile !== false) {
      await ctx.gpmClient.closeProfile(state.profileId).catch(() => {});
    }
    return {
      ...state,
      browser: null,
      status: state.status === "sent" ? "completed" : state.status
    };
  }
};
