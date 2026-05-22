import path from "node:path";
import { configDir, runtimeDir } from "../../lib/paths.js";
import { ensureDir, readJson } from "../../lib/utils.js";
import { GpmClient } from "../../lib/gpm-client.js";
import { loadPlatformConfig, loadVerificationApiConfig } from "../../lib/platform-config.js";

export async function createTaskContext({ campaign, forumConfig, platformConfig }) {
  const gpmConfig = await readJson(path.join(configDir, "gpm.json"));
  await ensureDir(runtimeDir);
  await ensureDir(path.join(runtimeDir, "profiles"));

  const resolvedPlatformConfig = platformConfig ?? forumConfig;
  const isTelegram = resolvedPlatformConfig?.platform === "telegram";
  const verificationApiConfig = isTelegram ? await loadVerificationApiConfig() : null;

  return {
    gpmConfig,
    gpmClient: new GpmClient(gpmConfig.baseUrl),
    campaign,
    forumConfig,
    platformConfig: resolvedPlatformConfig,
    verificationApiConfig,
    runtimeDir
  };
}
