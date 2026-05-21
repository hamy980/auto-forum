import { sleep } from "../../lib/utils.js";
import { updateForumDelayRule } from "../../lib/forum-config.js";

export const handleSubmitOutcomeTask = {
  name: "forum:handle-submit-outcome",
  async run({ ctx, state }) {
    if (state.lastOutcome?.status === "sent") {
      return {
        ...state,
        abortPipeline: true,
        status: "sent"
      };
    }

    if (state.lastOutcome?.status === "cooldown") {
      const attempt = (state.attempt ?? 0) + 1;
      const maxAttempts = ctx.forumConfig.retry?.maxAttempts ?? 3;
      let timeruleUpdated = null;
      if (ctx.autoUpdateTimerule && state.lastOutcome.retryAfterMs) {
        timeruleUpdated = await updateForumDelayRule(ctx.forumConfig.id, state.lastOutcome.retryAfterMs);
      }
      if (attempt >= maxAttempts) {
        return {
          ...state,
          attempt,
          abortPipeline: true,
          status: "cooldown",
          lastError: state.lastOutcome.message,
          timeruleUpdated
        };
      }

      await sleep(state.lastOutcome.retryAfterMs ?? ctx.forumConfig.delayMs?.min ?? 70000);
      return {
        ...state,
        attempt,
        status: "retry_pending",
        abortPipeline: false,
        timeruleUpdated
      };
    }

    if (["permission_denied", "validation_error"].includes(state.lastOutcome?.status)) {
      return {
        ...state,
        abortPipeline: true,
        status: state.lastOutcome.status,
        lastError: state.lastOutcome.message
      };
    }

    const attempt = (state.attempt ?? 0) + 1;
    const maxAttempts = ctx.forumConfig.retry?.maxAttempts ?? 3;
    if (attempt >= maxAttempts) {
      return {
        ...state,
        attempt,
        abortPipeline: true,
        status: state.lastOutcome?.status ?? "unknown",
        lastError: state.lastOutcome?.message ?? "Unknown submit error"
      };
    }

    await sleep(ctx.forumConfig.retry?.networkRetryDelayMs ?? 3000);
    return {
      ...state,
      attempt,
      status: "retry_pending",
      abortPipeline: false
    };
  }
};
