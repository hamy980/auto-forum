import fs from "node:fs/promises";
import path from "node:path";
import { campaignsDir, projectRoot } from "./paths.js";
import { fillTemplate, parseFirstName, pickOne, readJson, resolveMaybeRelative, resolveSpin } from "./utils.js";

export async function loadContentPack(contentPackPath) {
  const filePath = resolveMaybeRelative(projectRoot, contentPackPath);
  return readJson(filePath);
}

export async function loadMembersFromSource(memberSourcePath) {
  const filePath = resolveMaybeRelative(projectRoot, memberSourcePath);
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));
}

export function buildCampaignContent({ campaign, contentPack, recipient, profile, sequence }) {
  const context = {
    campaign_id: campaign.id,
    recipient_name: recipient,
    first_name: parseFirstName(recipient),
    profile_id: profile.id,
    profile_name: profile.name,
    sequence
  };

  const titleTemplates = contentPack?.titleTemplates ?? campaign.titleTemplates;
  const bodyTemplates = contentPack?.bodyTemplates ?? campaign.bodyTemplates;
  return {
    title: resolveSpin(fillTemplate(pickOne(titleTemplates, sequence), context)),
    body: resolveSpin(fillTemplate(pickOne(bodyTemplates, sequence), context))
  };
}
