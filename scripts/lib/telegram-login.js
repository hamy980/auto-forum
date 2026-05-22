import { sleep, randomInt } from "./utils.js";
import { fetchVerificationCode } from "./platform-config.js";

export async function isAlreadyLoggedIn(page, platformConfig) {
  const selector = platformConfig.login?.chatListIndicator ?? platformConfig.selectors?.sidebarChatList ?? ".chatlist";
  const count = await page.locator(selector).count().catch(() => 0);
  return count > 0;
}

export async function telegramLogin({ page, platformConfig, phone, twoFaPassword, apiConfig }) {
  const login = platformConfig.login ?? {};
  const waitMin = login.waitBetweenSteps?.min ?? 5000;
  const waitMax = login.waitBetweenSteps?.max ?? 10000;
  const stepWait = () => sleep(randomInt(waitMin, waitMax));

  // Already logged in?
  if (await isAlreadyLoggedIn(page, platformConfig)) {
    return { status: "already_logged_in" };
  }

  // 1. Navigate to Telegram Web K
  await page.goto(login.url ?? platformConfig.baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await stepWait();

  // 2. Click "Log in by phone Number"
  const phoneLoginBtn = page.locator(`xpath=${login.phoneLoginButton}`).first();
  await phoneLoginBtn.waitFor({ state: "visible", timeout: 15000 }).catch(() => null);
  for (let retry = 0; retry < 5; retry++) {
    try {
      await phoneLoginBtn.click({ timeout: 5000 });
      break;
    } catch {
      if (retry >= 4) return { status: "login_failed", error: "Cannot click 'Log in by phone Number'" };
      await stepWait();
    }
  }
  await stepWait();

  // 3. Click phone login tab (switch from QR to phone input)
  const phoneTabBtn = page.locator(`xpath=${login.phoneTabButton}`).first();
  await phoneTabBtn.click({ timeout: 10000 }).catch(() => {});
  await stepWait();

  // 4. Enter phone number
  const phoneInput = page.locator(`xpath=${login.phoneInput}`).first();
  await phoneInput.waitFor({ state: "visible", timeout: 15000 });
  await phoneInput.click();
  await phoneInput.fill(phone);
  await stepWait();

  // 5. Click "Login with Phone"
  const phoneSubmitBtn = page.locator(`xpath=${login.phoneSubmitButton}`).first();
  await phoneSubmitBtn.click({ timeout: 10000 });
  await stepWait();

  // 6. Get verification code from API
  const codeResult = await fetchVerificationCode(phone, apiConfig);
  if (codeResult.status !== "code_received") {
    return { status: "login_failed", error: `Verification code: ${codeResult.error}` };
  }
  const code = codeResult.code;
  await stepWait();

  // 7. Enter verification code
  const codeInput = page.locator(`xpath=${login.codeInput}`).first();
  await codeInput.waitFor({ state: "visible", timeout: 15000 });
  await codeInput.click();
  await codeInput.fill(code);
  await stepWait();

  // 8. Enter 2FA password
  if (twoFaPassword) {
    const twoFaInput = page.locator(`xpath=${login.twoFaInput}`).first();
    await twoFaInput.waitFor({ state: "visible", timeout: 15000 });
    await twoFaInput.click();
    await twoFaInput.fill(twoFaPassword);
    await stepWait();

    // 9. Click Login (2FA submit)
    const twoFaSubmitBtn = page.locator(`xpath=${login.twoFaSubmitButton}`).first();
    await twoFaSubmitBtn.click({ timeout: 10000 });
    await stepWait();
  }

  // 10. Wait for chat list to confirm login
  const chatListSelector = login.chatListIndicator ?? platformConfig.selectors?.sidebarChatList ?? ".chatlist";
  try {
    await page.locator(chatListSelector).first().waitFor({ state: "visible", timeout: 30000 });
    return { status: "logged_in" };
  } catch {
    return { status: "login_failed", error: "Chat list did not appear after login" };
  }
}