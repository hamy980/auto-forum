import { chromium } from "playwright";

export function createAttachRunningProfileTask({ remoteDebuggingAddress, profileName = null }) {
  return {
    name: "gpm:attach-running-profile",
    async run({ state }) {
      if (!remoteDebuggingAddress) {
        throw new Error("remoteDebuggingAddress is required to attach a running profile");
      }

      const browser = await chromium.connectOverCDP(`http://${remoteDebuggingAddress}`);
      return {
        ...state,
        profileName: profileName ?? state.profileName,
        remoteDebuggingAddress,
        browser,
        status: "profile_attached"
      };
    }
  };
}
