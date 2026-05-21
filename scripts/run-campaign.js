import fs from "node:fs/promises";
import path from "node:path";
import { runSendPmCampaign } from "./orchestrators/send-pm-flow.js";
import { runtimeDir } from "./lib/paths.js";
import { ensureDir } from "./lib/utils.js";

function parseArgs(argv) {
  const parsed = {
    campaignId: null,
    profiles: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--campaign") {
      parsed.campaignId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--profiles") {
      parsed.profiles = argv[i + 1].split(",").map((value) => value.trim()).filter(Boolean);
      i += 1;
    }
  }

  if (!parsed.campaignId) {
    throw new Error("Usage: node scripts/run-campaign.js --campaign <campaign-id> [--profiles id1,id2]");
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runSendPmCampaign({
    campaignId: args.campaignId,
    profileIdsOverride: args.profiles
  });

  await ensureDir(runtimeDir);
  const outputPath = path.join(runtimeDir, `${args.campaignId}-last-run.json`);
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: true, outputPath, summary: result.results.map((item) => ({
    profileId: item.profileId,
    recipient: item.recipient,
    status: item.outcome.status,
    finalUrl: item.finalUrl
  })) }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
