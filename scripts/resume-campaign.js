import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { runtimeDir } from "./lib/paths.js";
import { readState } from "./lib/result-writer.js";

function parseArgs(argv) {
  const parsed = { campaignId: null, skipErrors: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--campaign") { parsed.campaignId = argv[++i]; continue; }
    if (arg === "--skip-errors") { parsed.skipErrors = true; continue; }
  }
  if (!parsed.campaignId) {
    throw new Error("Usage: node scripts/resume-campaign.js --campaign <id> [--skip-errors]");
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const campaignDir = path.join(runtimeDir, args.campaignId);

  try {
    await fs.access(campaignDir);
  } catch {
    console.error(`No results directory found for campaign: ${args.campaignId}`);
    process.exit(1);
  }

  const files = await fs.readdir(campaignDir);
  const profileIds = [...new Set(files.filter(f => f.endsWith(".jsonl")).map(f => f.replace(".jsonl", "")))];

  if (profileIds.length === 0) {
    console.error("No profile result files found.");
    process.exit(1);
  }

  console.log(`Resuming campaign: ${args.campaignId}`);
  console.log(`Found profiles: ${profileIds.join(", ")}`);

  for (const profileId of profileIds) {
    const state = await readState(runtimeDir, args.campaignId, profileId);

    if (!state) {
      console.log(`[${profileId}] No state file found — skipping`);
      continue;
    }

    if (state.lastStatus === "done" || state.lastStatus === "completed") {
      console.log(`[${profileId}] Already completed — skipping`);
      continue;
    }

    if (!state.lastStatus || state.lastStatus === "paused" || args.skipErrors) {
      const remaining = state.recipientQueue?.length ?? 0;
      console.log(`[${profileId}] Last status: ${state.lastStatus ?? "unknown"} | Remaining: ${remaining} recipients | Last error: ${state.lastError ?? "none"}`);

      if (state.lastStatus === "paused" && !args.skipErrors) {
        console.log(`[${profileId}] Paused due to: ${state.lastError}`);
        console.log(`[${profileId}] Use --skip-errors to force resume, or investigate the error first`);
        continue;
      }

      if (remaining === 0) {
        console.log(`[${profileId}] No remaining recipients — skipping`);
        continue;
      }

      console.log(`[${profileId}] Will resume with ${remaining} remaining recipients`);
    }
  }

  console.log(`\nTo actually resume, run:`);
  console.log(`  node scripts/runner.js --campaign ${args.campaignId} --resume`);

  if (args.skipErrors) {
    console.log(`  (with --skip-errors, paused campaigns will also be resumed)`);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});