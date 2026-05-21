import fs from "node:fs/promises";
import path from "node:path";
import { runtimeDir } from "./lib/paths.js";

function parseArgs(argv) {
  const parsed = { campaignId: null, profileId: null, watch: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--campaign") { parsed.campaignId = argv[++i]; continue; }
    if (arg === "--profile") { parsed.profileId = argv[++i]; continue; }
    if (arg === "--watch") { parsed.watch = true; continue; }
  }
  if (!parsed.campaignId) {
    throw new Error("Usage: node scripts/check-results.js --campaign <id> [--profile <id>] [--watch]");
  }
  return parsed;
}

async function readJsonl(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.trim().split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function printSummary(campaignId, profileId, entries, summary) {
  console.log(`\n=== Campaign: ${campaignId}${profileId ? ` | Profile: ${profileId}` : ""} ===\n`);

  const byStatus = {};
  let total = 0;
  for (const entry of entries) {
    if (entry.STOP_REASON) {
      console.log(`  STOP: ${entry.STOP_REASON}`);
      continue;
    }
    const status = entry.status ?? "unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    total += 1;
  }

  console.log(`  Total actions: ${total}`);
  for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }

  const sent = entries.filter(e => e.status === "sent");
  if (sent.length > 0) {
    console.log(`\n  Sent recipients (${sent.length}):`);
    for (const e of sent.slice(-20)) {
      console.log(`    ${e.member} -> ${e.url ?? "ok"} (${e.ms ?? "?"}ms)`);
    }
  }

  const errors = entries.filter(e => e.error);
  if (errors.length > 0) {
    console.log(`\n  Errors (${errors.length}):`);
    for (const e of errors.slice(-10)) {
      console.log(`    ${e.member ?? e.action}: ${e.status} - ${e.error}`);
    }
  }

  if (summary) {
    console.log(`\n  Summary: started=${summary.startedAt ?? "?"} updated=${summary.updatedAt ?? "?"} stopReason=${summary.stopReason ?? "none"}`);
    console.log(`  Counts: ${Object.entries(summary.counts ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const campaignDir = path.join(runtimeDir, args.campaignId);

  try {
    await fs.access(campaignDir);
  } catch {
    console.log(`No results found for campaign: ${args.campaignId}`);
    console.log(`Expected directory: ${campaignDir}`);
    process.exit(0);
  }

  if (args.profileId) {
    const entries = await readJsonl(path.join(campaignDir, `${args.profileId}.jsonl`));
    const summary = await readJson(path.join(campaignDir, `${args.profileId}-summary.json`));
    printSummary(args.campaignId, args.profileId, entries, summary);
  } else {
    const files = await fs.readdir(campaignDir);
    const profileIds = [...new Set(files.filter(f => f.endsWith(".jsonl")).map(f => f.replace(".jsonl", "")))];

    if (profileIds.length === 0) {
      console.log("No profile result files found.");
      return;
    }

    for (const pid of profileIds) {
      const entries = await readJsonl(path.join(campaignDir, `${pid}.jsonl`));
      const summary = await readJson(path.join(campaignDir, `${pid}-summary.json`));
      printSummary(args.campaignId, pid, entries, summary);
    }
  }

  if (args.watch) {
    console.log("\n--- Watching for new results (Ctrl+C to stop) ---");
    const profileIds = args.profileId ? [args.profileId] :
      [...new Set((await fs.readdir(campaignDir)).filter(f => f.endsWith(".jsonl")).map(f => f.replace(".jsonl", "")))];

    let lastCounts = {};
    for (const pid of profileIds) {
      const entries = await readJsonl(path.join(campaignDir, `${pid}.jsonl`));
      lastCounts[pid] = entries.length;
    }

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      for (const pid of profileIds) {
        const entries = await readJsonl(path.join(campaignDir, `${pid}.jsonl`));
        if (entries.length > lastCounts[pid]) {
          const newEntries = entries.slice(lastCounts[pid]);
          for (const e of newEntries) {
            const ts = e.ts ?? new Date().toISOString();
            if (e.STOP_REASON) {
              console.log(`[${ts}][${pid}] STOP: ${e.STOP_REASON}`);
            } else {
              console.log(`[${ts}][${pid}] ${e.action ?? "?"} ${e.status} ${e.member ?? ""} ${e.error ? "ERR:" + e.error : ""}`);
            }
          }
          lastCounts[pid] = entries.length;
        }
      }
    }
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});