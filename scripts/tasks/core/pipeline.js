import { appendProfileLog, writeProfileState } from "./state-store.js";

export async function runTaskList({ ctx, state, tasks }) {
  let currentState = { ...state };

  for (const task of tasks) {
    await appendProfileLog(ctx.runtimeDir, currentState.profileId, {
      ts: new Date().toISOString(),
      task: task.name,
      phase: "start",
      status: currentState.status
    });

    currentState = await task.run({ ctx, state: currentState });
    await writeProfileState(ctx.runtimeDir, currentState);

    await appendProfileLog(ctx.runtimeDir, currentState.profileId, {
      ts: new Date().toISOString(),
      task: task.name,
      phase: "end",
      status: currentState.status,
      recipient: currentState.currentRecipient ?? null,
      finalUrl: currentState.lastConversationUrl ?? null,
      lastError: currentState.lastError ?? null
    });

    if (currentState.abortPipeline) {
      break;
    }
  }

  return currentState;
}
