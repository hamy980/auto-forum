import { chromium } from "playwright";
import { GpmClient } from "../lib/gpm-client.js";
import { loadPlatformConfig, loadVerificationApiConfig } from "../lib/platform-config.js";
import { loadCampaign } from "../lib/forum-config.js";
import { readJson, sleep, randomInt } from "../lib/utils.js";
import { telegramLogin } from "../lib/telegram-login.js";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, projectRoot } from "../lib/paths.js";

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

async function main() {
  const campaignId = getArg("--campaign") ?? getArg("-c");
  const profileIdsCsv = getArg("--profiles");
  const accountsPath = getArg("--accounts");
  const platformId = getArg("--platform") ?? "telegram";

  if (!campaignId) {
    console.error("Usage: node scripts/telegram-login-batch.js --campaign <id> [--profiles id1,id2] [--accounts path] [--platform telegram]");
    process.exit(1);
  }

  const campaign = await loadCampaign(campaignId);
  const platformConfig = await loadPlatformConfig(campaign.platformId ?? campaign.forumId ?? platformId);
  const apiConfig = await loadVerificationApiConfig();
  const gpmConfig = await readJson(path.join(projectRoot, "../config/gpm.json"));
  const gpmClient = new GpmClient(gpmConfig.baseUrl);

  // Load accounts: CSV format — profileId,phone,twoFaPassword
  const accPath = accountsPath ?? campaign.accountsPath;
  const accFile = path.isAbsolute(accPath) ? accPath : path.resolve(projectRoot, accPath);
  const raw = await fs.readFile(accFile, "utf8");
  const accounts = raw.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("#")).map(line => {
    const [profileId, phone, twoFaPassword] = line.split(",").map(s => s.trim());
    return { profileId, phone, twoFaPassword: twoFaPassword || null };
  });

  // Filter by --profiles if specified
  const targetProfiles = profileIdsCsv
    ? profileIdsCsv.split(",").map(s => s.trim())
    : accounts.map(a => a.profileId);

  const accountsToProcess = accounts.filter(a => targetProfiles.includes(a.profileId));
  if (accountsToProcess.length === 0) {
    console.error("No accounts to process");
    process.exit(1);
  }

  console.log(`Logging in ${accountsToProcess.length} Telegram accounts...`);

  const results = [];
  for (const account of accountsToProcess) {
    console.log(`\n--- Profile: ${account.profileId} | Phone: ${account.phone} ---`);
    try {
      // GPM lifecycle: close → start → CDP
      const profile = await gpmClient.getProfile(account.profileId);
      await gpmClient.closeProfile(account.profileId).catch(() => {});
      await sleep(2000);

      const startResult = await gpmClient.startProfile(account.profileId, gpmConfig.startOptions ?? {});
      const address = startResult.remote_debugging_address;
      await gpmClient.waitForCdpReady(address);

      const browser = await chromium.connectOverCDP(`http://${address}`);
      const page = browser.contexts()[0].pages()[0];

      // Login
      const result = await telegramLogin({
        page,
        platformConfig,
        phone: account.phone,
        twoFaPassword: account.twoFaPassword,
        apiConfig
      });

      console.log(`Result: ${result.status}${result.error ? ` — ${result.error}` : ""}`);
      results.push({ profileId: account.profileId, phone: account.phone, status: result.status, error: result.error ?? null });

      // Close
      await sleep(15000);
      await browser.close().catch(() => {});
      await gpmClient.closeProfile(account.profileId).catch(() => {});
    } catch (err) {
      console.error(`Error: ${err.message}`);
      results.push({ profileId: account.profileId, phone: account.phone, status: "error", error: err.message });
    }
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});