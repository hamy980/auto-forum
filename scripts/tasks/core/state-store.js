import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../../lib/utils.js";

function statePath(runtimeDir, profileId) {
  return path.join(runtimeDir, "profiles", `${profileId}.json`);
}

function sanitizeEvents(events = []) {
  return events.slice(-10).map((event) => ({
    type: event.type ?? null,
    method: event.method ?? null,
    resourceType: event.resourceType ?? null,
    url: event.url ?? null,
    status: event.status ?? null,
    message: event.message ?? null
  }));
}

export function toPersistedState(state) {
  return {
    profileId: state.profileId ?? null,
    profileName: state.profileName ?? null,
    remoteDebuggingAddress: state.remoteDebuggingAddress ?? null,
    status: state.status ?? null,
    sequence: state.sequence ?? 0,
    attempt: state.attempt ?? 0,
    currentRecipient: state.currentRecipient ?? null,
    currentTitle: state.currentTitle ?? null,
    currentBody: state.currentBody ?? null,
    composeUrl: state.composeUrl ?? null,
    lastConversationUrl: state.lastConversationUrl ?? null,
    lastError: state.lastError ?? null,
    lastOutcome: state.lastOutcome ?? null,
    lifecycle: state.lifecycle ?? null,
    verification: state.verification ?? null,
    inboxCheck: state.inboxCheck ?? null,
    lastEvents: sanitizeEvents(state.lastEvents)
  };
}

export async function writeProfileState(runtimeDir, state) {
  await ensureDir(path.join(runtimeDir, "profiles"));
  await fs.writeFile(
    statePath(runtimeDir, state.profileId),
    JSON.stringify(toPersistedState(state), null, 2)
  );
}

export async function appendProfileLog(runtimeDir, profileId, event) {
  await ensureDir(path.join(runtimeDir, "profiles"));
  const logPath = path.join(runtimeDir, "profiles", `${profileId}.log.jsonl`);
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`);
}
