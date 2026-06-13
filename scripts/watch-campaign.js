import fs from "node:fs/promises";
import path from "node:path";
import { runtimeDir } from "./lib/paths.js";

const campaignId = process.argv[2];
if (!campaignId) {
  console.error("Usage: node scripts/watch-campaign.js <campaign-id> [intervalSec]");
  process.exit(1);
}
const intervalSec = Number(process.argv[3] ?? 3);

const dir = path.join(runtimeDir, campaignId);
const summaries = new Map();
let prevSent = -1;
let lastReportTime = Date.now();

async function readSummaries() {
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith("-summary.json")) continue;
    const profileId = f.replace("-summary.json", "");
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, f), "utf-8"));
      out.push({ profileId, ...data });
    } catch {}
  }
  return out;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "?";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

async function tick() {
  const rows = await readSummaries();
  if (rows.length === 0) {
    console.log(`[watch] no summary files yet at ${dir}`);
    return;
  }
  rows.sort((a, b) => a.profileId.localeCompare(b.profileId));
  const now = Date.now();
  const elapsedMs = (now - lastReportTime) / 1000;
  lastReportTime = now;

  let totalSent = 0;
  let totalErrors = 0;
  const lines = [];
  lines.push(`\n=== ${campaignId} @ ${new Date().toLocaleTimeString()} ===`);
  lines.push(`profile                               | sent | errs | lastStatus     | lastSeen`);
  lines.push(`--------------------------------------|------|------|----------------|--------`);
  for (const r of rows) {
    const sent = r.counts?.sent ?? 0;
    const errs = (r.counts?.cooldown ?? 0) + (r.counts?.validation_error ?? 0) + (r.counts?.network_error ?? 0) + (r.counts?.permission_denied ?? 0) + (r.counts?.timeout ?? 0);
    totalSent += sent;
    totalErrors += errs;
    const lastSeen = r.updatedAt ? formatDuration(now - new Date(r.updatedAt).getTime()) + " ago" : "?";
    const pid = r.profileId.slice(0, 36);
    const lastStatus = (r.lastStatus ?? "—").padEnd(14);
    lines.push(`${pid} | ${String(sent).padStart(4)} | ${String(errs).padStart(4)} | ${lastStatus} | ${lastSeen}`);
  }
  const rate = elapsedMs > 0 && prevSent >= 0 ? ((totalSent - prevSent) / elapsedMs * 60).toFixed(1) : "—";
  prevSent = totalSent;
  lines.push(`--------------------------------------|------|------|----------------|--------`);
  lines.push(`TOTAL sent=${totalSent}  errors=${totalErrors}  rate=${rate}/min`);
  console.log(lines.join("\n"));
}

console.log(`[watch] polling ${dir} every ${intervalSec}s (Ctrl+C to stop)`);
while (true) {
  try {
    await tick();
  } catch (e) {
    console.error(`[watch] error: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
