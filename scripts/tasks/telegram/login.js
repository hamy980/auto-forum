import { telegramLogin, isAlreadyLoggedIn } from "../../lib/telegram-login.js";

export const telegramLoginTask = {
  name: "telegram:login",
  async run({ ctx, state }) {
    const phone = state.phoneNumber;
    const twoFaPassword = state.twoFaPassword ?? null;
    const result = await telegramLogin({
      page: state.page,
      platformConfig: ctx.platformConfig,
      phone,
      twoFaPassword,
      apiConfig: ctx.verificationApiConfig
    });
    return {
      ...state,
      loginStatus: result.status,
      lastError: result.error ?? null,
      status: result.status === "logged_in" || result.status === "already_logged_in"
        ? "logged_in"
        : "login_failed"
    };
  }
};