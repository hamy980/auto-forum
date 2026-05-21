import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./utils.js";

export function resultDir(runtimeDir, campaignId) {
  return path.join(runtimeDir, campaignId);
}

export function resultPath(runtimeDir, campaignId, profileId) {
  return path.join(resultDir(runtimeDir, campaignId), `${profileId}.jsonl`);
}

export function summaryPath(runtimeDir, campaignId, profileId) {
  return path.join(resultDir(runtimeDir, campaignId), `${profileId}-summary.json`);
}

export function statePath(runtimeDir, campaignId, profileId) {
  return path.join(resultDir(runtimeDir, campaignId), `${profileId}-state.json`);
}

export async function appendResult(runtimeDir, campaignId, profileId, entry) {
  const dir = resultDir(runtimeDir, campaignId);
  await ensureDir(dir);
  const line = JSON.stringify({ ...entry, ts: entry.ts ?? new Date().toISOString(), profileId }) + "\n";
  await fs.appendFile(resultPath(runtimeDir, campaignId, profileId), line);
}

const COUNTABLE_STATUSES = ["sent", "cooldown", "permission_denied", "validation_error", "timeout", "network_error"];

export async function updateSummary(runtimeDir, campaignId, profileId, entry) {
  const filePath = summaryPath(runtimeDir, campaignId, profileId);
  let summary;
  try {
    summary = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    summary = { profileId, campaignId, counts: {}, lastStatus: null, lastError: null, stopReason: null, startedAt: null, updatedAt: null };
  }
  if (!summary.startedAt) summary.startedAt = entry.ts ?? new Date().toISOString();
  summary.updatedAt = entry.ts ?? new Date().toISOString();
  summary.lastStatus = entry.status ?? entry.STOP_REASON ?? null;
  summary.lastError = entry.error ?? null;

  if (entry.status && COUNTABLE_STATUSES.includes(entry.status)) {
    summary.counts[entry.status] = (summary.counts[entry.status] ?? 0) + 1;
  }
  if (entry.STOP_REASON) {
    summary.stopReason = entry.STOP_REASON;
  }

  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(summary, null, 2));
}

export async function writeState(runtimeDir, campaignId, profileId, state) {
  const filePath = statePath(runtimeDir, campaignId, profileId);
  await ensureDir(path.dirname(filePath));
  const pick = ({ recipientQueue, recipientIndex, sequence, lastRecipient, lastError, lastStatus }) => ({
    recipientQueue: recipientQueue ?? [],
    recipientIndex: recipientIndex ?? 0,
    sequence: sequence ?? 0,
    lastRecipient: lastRecipient ?? null,
    lastError: lastError ?? null,
    lastStatus: lastStatus ?? null,
  });
  await fs.writeFile(filePath, JSON.stringify(pick(state), null, 2));
}

export async function readState(runtimeDir, campaignId, profileId) {
  const filePath = statePath(runtimeDir, campaignId, profileId);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}