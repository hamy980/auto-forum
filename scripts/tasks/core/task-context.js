import path from "node:path";
import { configDir, runtimeDir } from "../../lib/paths.js";
import { ensureDir, readJson } from "../../lib/utils.js";
import { GpmClient } from "../../lib/gpm-client.js";

export async function createTaskContext({ campaign, forumConfig }) {
  const gpmConfig = await readJson(path.join(configDir, "gpm.json"));
  await ensureDir(runtimeDir);
  await ensureDir(path.join(runtimeDir, "profiles"));
  return {
    gpmConfig,
    gpmClient: new GpmClient(gpmConfig.baseUrl),
    campaign,
    forumConfig,
    runtimeDir
  };
}
