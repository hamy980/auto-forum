import { chromium } from "playwright";

export const startProfileTask = {
  name: "gpm:start-profile",
  async run({ ctx, state }) {
    const profileResponse = await ctx.gpmClient.getProfile(state.profileId);
    const started = await ctx.gpmClient.startProfile(state.profileId, ctx.gpmConfig.startOptions ?? {});
    const debuggingAddress = started.data.remote_debugging_address;
    if (!debuggingAddress) {
      throw new Error(`Profile ${state.profileId} did not return remote_debugging_address`);
    }

    const browser = await chromium.connectOverCDP(`http://${debuggingAddress}`);
    return {
      ...state,
      profileName: profileResponse.data.name,
      remoteDebuggingAddress: debuggingAddress,
      browser,
      status: "profile_started"
    };
  }
};
