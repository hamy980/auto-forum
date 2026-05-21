import { createTaskContext } from "../tasks/core/task-context.js";
import { runTaskList } from "../tasks/core/pipeline.js";
import { createAttachRunningProfileTask } from "../tasks/gpm/attach-running-profile.js";
import { stopProfileTask } from "../tasks/gpm/stop-profile.js";
import { openComposeTask } from "../tasks/forum/open-compose.js";
import { fillPmFormTask } from "../tasks/forum/fill-form.js";
import { submitPmTask } from "../tasks/forum/submit-pm.js";
import { handleSubmitOutcomeTask } from "../tasks/forum/handle-submit-outcome.js";
import { openConversationTask } from "../tasks/forum/open-conversation.js";
import { verifyConversationTask } from "../tasks/forum/verify-conversation.js";
import { loadForumConfig } from "../lib/forum-config.js";

function createState({ profileId, profileName, recipient, title, body, conversationUrl = null }) {
  return {
    profileId,
    profileName,
    remoteDebuggingAddress: null,
    browser: null,
    page: null,
    status: "created",
    sequence: 1,
    attempt: 0,
    abortPipeline: false,
    currentRecipient: recipient,
    currentTitle: title,
    currentBody: body,
    composeUrl: null,
    lastOutcome: null,
    lastConversationUrl: conversationUrl,
    lastError: null,
    lastEvents: [],
    verification: null
  };
}

async function runSubmitLoop({ ctx, senderState }) {
  let state = { ...senderState, abortPipeline: false, attempt: 0 };
  while (true) {
    state = await runTaskList({
      ctx,
      state,
      tasks: [openComposeTask, fillPmFormTask, submitPmTask, handleSubmitOutcomeTask]
    });

    if (state.status === "retry_pending") {
      state = { ...state, abortPipeline: false };
      continue;
    }
    return state;
  }
}

export async function testPmBetweenRunningProfiles({
  forumId,
  sender,
  receiver,
  title,
  body,
  keepAlive = true,
  autoUpdateTimerule = false,
  verifyReceiver = true
}) {
  const forumConfig = await loadForumConfig(forumId);
  const ctx = await createTaskContext({
    campaign: {
      id: "direct-test",
      titleTemplates: [title],
      bodyTemplates: [body]
    },
    forumConfig
  });
  ctx.autoUpdateTimerule = autoUpdateTimerule;

  const senderAttachTask = createAttachRunningProfileTask({
    remoteDebuggingAddress: sender.remoteDebuggingAddress,
    profileName: sender.profileName
  });
  const receiverAttachTask = createAttachRunningProfileTask({
    remoteDebuggingAddress: receiver.remoteDebuggingAddress,
    profileName: receiver.profileName
  });

  let senderState = createState({
    profileId: sender.profileId,
    profileName: sender.profileName,
    recipient: receiver.forumUsername,
    title,
    body
  });
  senderState.lifecycle = {
    closeBrowser: !keepAlive,
    closeProfile: !keepAlive
  };

  senderState = await runTaskList({
    ctx,
    state: senderState,
    tasks: [senderAttachTask]
  });

  try {
    senderState = await runSubmitLoop({ ctx, senderState });
  } finally {
    senderState = await runTaskList({
      ctx,
      state: { ...senderState, abortPipeline: false },
      tasks: [stopProfileTask]
    });
  }

  if (!senderState.lastConversationUrl) {
    return {
      forumId,
      sender: {
        profileId: senderState.profileId,
        profileName: senderState.profileName,
        status: senderState.status,
        conversationUrl: senderState.lastConversationUrl,
        lastError: senderState.lastError,
        timeruleUpdated: senderState.timeruleUpdated ?? null
      },
      receiver: {
        profileId: receiver.profileId,
        profileName: receiver.profileName,
        status: "skipped",
        verification: null,
        lastError: "Sender did not produce a conversation URL"
      }
    };
  }

  let receiverResult;
  if (verifyReceiver) {
    let receiverState = createState({
      profileId: receiver.profileId,
      profileName: receiver.profileName,
      recipient: sender.forumUsername,
      title,
      body,
      conversationUrl: senderState.lastConversationUrl
    });
    receiverState.lifecycle = {
      closeBrowser: !keepAlive,
      closeProfile: !keepAlive
    };

    receiverState = await runTaskList({
      ctx,
      state: receiverState,
      tasks: [receiverAttachTask]
    });

    try {
      receiverState = await runTaskList({
        ctx,
        state: receiverState,
        tasks: [openConversationTask, verifyConversationTask]
      });
    } finally {
      receiverState = await runTaskList({
        ctx,
        state: { ...receiverState, abortPipeline: false },
        tasks: [stopProfileTask]
      });
    }
    receiverResult = {
      profileId: receiverState.profileId,
      profileName: receiverState.profileName,
      status: receiverState.status,
      verification: receiverState.verification,
      lastError: receiverState.lastError
    };
  } else {
    receiverResult = {
      profileId: receiver.profileId,
      profileName: receiver.profileName,
      status: "skipped",
      verification: null,
      lastError: null
    };
  }

  return {
    ok: senderState.status === "completed" || senderState.status === "sent",
    status: senderState.lastConversationUrl ? "success" : senderState.status,
    stage: verifyReceiver ? receiverResult.status : senderState.status,
    forumId,
    sender: {
      profileId: senderState.profileId,
      profileName: senderState.profileName,
      status: senderState.status,
      conversationUrl: senderState.lastConversationUrl,
      lastError: senderState.lastError,
      timeruleUpdated: senderState.timeruleUpdated ?? null
    },
    receiver: receiverResult
  };
}
