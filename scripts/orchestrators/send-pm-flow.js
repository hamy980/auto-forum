import { createTaskContext } from "../tasks/core/task-context.js";
import { runTaskList } from "../tasks/core/pipeline.js";
import { startProfileTask } from "../tasks/gpm/start-profile.js";
import { stopProfileTask } from "../tasks/gpm/stop-profile.js";
import { createPickRecipientTask } from "../tasks/forum/pick-recipient.js";
import { personalizeContentTask } from "../tasks/forum/personalize-content.js";
import { openComposeTask } from "../tasks/forum/open-compose.js";
import { fillPmFormTask } from "../tasks/forum/fill-form.js";
import { submitPmTask } from "../tasks/forum/submit-pm.js";
import { handleSubmitOutcomeTask } from "../tasks/forum/handle-submit-outcome.js";
import { loadCampaign, loadForumConfig, loadMemberList } from "../lib/forum-config.js";
import { loadContentPack, loadMembersFromSource } from "../lib/campaign-sources.js";
import { randomInt, sleep } from "../lib/utils.js";

function createInitialProfileState(profileId) {
  return {
    profileId,
    profileName: null,
    remoteDebuggingAddress: null,
    browser: null,
    page: null,
    status: "created",
    sequence: 0,
    attempt: 0,
    abortPipeline: false,
    currentRecipient: null,
    currentTitle: null,
    currentBody: null,
    composeUrl: null,
    lastOutcome: null,
    lastConversationUrl: null,
    lastError: null,
    lastEvents: [],
    lifecycle: {
      closeBrowser: true,
      closeProfile: true
    }
  };
}

async function runSingleRecipientFlow({ ctx, state }) {
  let currentState = { ...state, abortPipeline: false, attempt: 0 };

  while (true) {
    currentState = await runTaskList({
      ctx,
      state: currentState,
      tasks: [openComposeTask, fillPmFormTask, submitPmTask, handleSubmitOutcomeTask]
    });

    if (currentState.status === "retry_pending") {
      currentState = {
        ...currentState,
        abortPipeline: false
      };
      continue;
    }

    return currentState;
  }
}

async function runProfileWorker({ ctx, profileId, recipientQueue }) {
  let state = createInitialProfileState(profileId);
  state = await runTaskList({
    ctx,
    state,
    tasks: [startProfileTask]
  });

  try {
    const pickRecipientTask = createPickRecipientTask(recipientQueue);
    while (recipientQueue.length > 0) {
      state = await runTaskList({
        ctx,
        state: {
          ...state,
          abortPipeline: false,
          lastOutcome: null,
          lastEvents: [],
          lastConversationUrl: null,
          lastError: null
        },
        tasks: [pickRecipientTask, personalizeContentTask]
      });

      if (state.status === "queue_empty") {
        break;
      }

      state = await runSingleRecipientFlow({ ctx, state });

      const delayMin = ctx.forumConfig.delayMs?.min ?? ctx.gpmConfig.delayMs?.min ?? 70000;
      const delayMax = ctx.forumConfig.delayMs?.max ?? ctx.gpmConfig.delayMs?.max ?? delayMin;
      if (recipientQueue.length > 0) {
        await sleep(randomInt(delayMin, delayMax));
      }
    }
  } finally {
    state = await runTaskList({
      ctx,
      state: {
        ...state,
        abortPipeline: false
      },
      tasks: [stopProfileTask]
    });
  }

  return state;
}

export async function runSendPmCampaign({ campaignId, profileIdsOverride = [] }) {
  const campaign = await loadCampaign(campaignId);
  const forumConfig = await loadForumConfig(campaign.forumId);
  const recipientQueue = campaign.memberSourcePath
    ? await loadMembersFromSource(campaign.memberSourcePath)
    : await loadMemberList(campaign);
  const contentPack = campaign.contentPackPath
    ? await loadContentPack(campaign.contentPackPath)
    : null;
  const ctx = await createTaskContext({ campaign, forumConfig });
  ctx.contentPack = contentPack;
  const profileIds = profileIdsOverride.length > 0 ? profileIdsOverride : campaign.profileIds;

  if (profileIds.length === 0) {
    throw new Error("No profile ids provided. Set campaign.profileIds or pass --profiles");
  }

  const concurrency = Math.max(1, Math.min(ctx.gpmConfig.concurrency ?? profileIds.length, profileIds.length));
  const workers = profileIds.slice(0, concurrency).map((profileId) =>
    runProfileWorker({ ctx, profileId, recipientQueue })
  );
  const finalStates = await Promise.all(workers);

  return {
    campaignId,
    forumId: campaign.forumId,
    results: finalStates.map((state) => ({
      profileId: state.profileId,
      profileName: state.profileName,
      status: state.status,
      recipient: state.currentRecipient,
      finalUrl: state.lastConversationUrl,
      lastError: state.lastError
    }))
  };
}
