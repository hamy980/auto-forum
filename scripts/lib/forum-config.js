import fs from "node:fs/promises";
import path from "node:path";
import { campaignsDir, forumsDir, projectRoot } from "./paths.js";
import { readJson, resolveMaybeRelative } from "./utils.js";

export async function loadForumConfig(forumId) {
  const filePath = path.join(forumsDir, `${forumId}.json`);
  return readJson(filePath);
}

export async function updateForumDelayRule(forumId, retryAfterMs) {
  const filePath = path.join(forumsDir, `${forumId}.json`);
  const config = await readJson(filePath);
  const nextMin = Math.max(config.delayMs?.min ?? 0, retryAfterMs);
  const nextMax = Math.max(config.delayMs?.max ?? 0, nextMin + 20000);
  config.delayMs = {
    min: nextMin,
    max: nextMax
  };
  await fs.writeFile(filePath, JSON.stringify(config, null, 2));
  return config.delayMs;
}

export async function loadCampaign(campaignId) {
  const filePath = path.join(campaignsDir, `${campaignId}.json`);
  return readJson(filePath);
}

export async function loadMemberList(campaign) {
  const filePath = resolveMaybeRelative(projectRoot, campaign.memberListPath ?? campaign.memberSourcePath);
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));
}
