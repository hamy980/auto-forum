import { createTaskContext } from "../tasks/core/task-context.js";
import { runTaskList } from "../tasks/core/pipeline.js";
import { createAttachRunningProfileTask } from "../tasks/gpm/attach-running-profile.js";
import { stopProfileTask } from "../tasks/gpm/stop-profile.js";
import { openComposeTask } from "../tasks/forum/open-compose.js";
import { fillPmFormTask } from "../tasks/forum/fill-form.js";
import { submitPmTask } from "../tasks/forum/submit-pm.js";
import { handleSubmitOutcomeTask } from "../tasks/forum/handle-submit-outcome.js";
import { openUnreadConversationTask } from "../tasks/forum/open-unread-conversation.js";
import { readRepliesTask } from "../tasks/forum/read-replies.js";
import { sendReplyTask } from "../tasks/forum/send-reply.js";
import { loadForumConfig } from "../lib/forum-config.js";

function createState({ profileId, profileName, forumUsername }) {
  return {
    profileId,
    profileName,
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
    replyBody: null,
    composeUrl: null,
    lastOutcome: null,
    lastConversationUrl: null,
    lastError: null,
    lastEvents: [],
    conversations: null,
    unreadConversations: null,
    newReplies: null,
    knownLastMessageTime: null,
    forumUsername,
    targetConversationTitle: null,
    lifecycle: null,
    verification: null,
    inboxCheck: null
  };
}

export async function testReplyBetweenProfiles({
  forumId,
  sender,
  receiver,
  greetingTitle,
  greetingBody,
  replyBody,
  followUpBody,
  keepAlive = true
}) {
  const forumConfig = await loadForumConfig(forumId);
  const ctx = await createTaskContext({
    campaign: { id: "reply-test", titleTemplates: [greetingTitle], bodyTemplates: [greetingBody] },
    forumConfig
  });

  const senderAttach = createAttachRunningProfileTask({
    remoteDebuggingAddress: sender.remoteDebuggingAddress,
    profileName: sender.profileName
  });
  const receiverAttach = createAttachRunningProfileTask({
    remoteDebuggingAddress: receiver.remoteDebuggingAddress,
    profileName: receiver.profileName
  });

  // === Stage 1: Sender sends greeting to receiver ===
  let senderState = createState({
    profileId: sender.profileId,
    profileName: sender.profileName,
    forumUsername: sender.forumUsername
  });
  senderState.currentRecipient = receiver.forumUsername;
  senderState.currentTitle = greetingTitle;
  senderState.currentBody = greetingBody;
  senderState.lifecycle = { closeBrowser: !keepAlive, closeProfile: !keepAlive };

  senderState = await runTaskList({ ctx, state: senderState, tasks: [senderAttach] });

  try {
    senderState = await runTaskList({ ctx, state: senderState, tasks: [openComposeTask, fillPmFormTask, submitPmTask, handleSubmitOutcomeTask] });
  } finally {
    senderState = await runTaskList({ ctx, state: { ...senderState, abortPipeline: false }, tasks: [stopProfileTask] });
  }

  const senderStage1 = {
    status: senderState.status,
    conversationUrl: senderState.lastConversationUrl,
    lastError: senderState.lastError
  };

  if (!senderState.lastConversationUrl) {
    return { ok: false, stage: "greeting_send", sender: senderStage1, receiver: null };
  }

  // === Stage 2: Receiver opens unread conversation (clicks popup link), reads, replies ===
  let receiverState = createState({
    profileId: receiver.profileId,
    profileName: receiver.profileName,
    forumUsername: receiver.forumUsername
  });
  receiverState.targetConversationTitle = greetingTitle;
  receiverState.lifecycle = { closeBrowser: !keepAlive, closeProfile: !keepAlive };

  receiverState = await runTaskList({ ctx, state: receiverState, tasks: [receiverAttach] });

  try {
    receiverState = await runTaskList({ ctx, state: receiverState, tasks: [openUnreadConversationTask] });

    if (receiverState.status !== "conversation_opened") {
      receiverState = await runTaskList({ ctx, state: { ...receiverState, abortPipeline: false }, tasks: [stopProfileTask] });
      return {
        ok: false,
        stage: "receiver_open_conversation",
        sender: senderStage1,
        receiver: { status: receiverState.status, lastError: receiverState.lastError }
      };
    }

    receiverState = await runTaskList({ ctx, state: { ...receiverState, abortPipeline: false }, tasks: [readRepliesTask] });

    receiverState.replyBody = replyBody;
    receiverState.currentBody = replyBody;
    receiverState = await runTaskList({ ctx, state: { ...receiverState, abortPipeline: false }, tasks: [sendReplyTask] });
  } finally {
    receiverState = await runTaskList({ ctx, state: { ...receiverState, abortPipeline: false }, tasks: [stopProfileTask] });
  }

  const receiverStage2 = {
    status: receiverState.status,
    replies: receiverState.newReplies,
    lastError: receiverState.lastError,
    conversationUrl: receiverState.lastConversationUrl
  };

  // === Stage 3: Sender opens conversation, detects reply, sends follow-up ===
  senderState = createState({
    profileId: sender.profileId,
    profileName: sender.profileName,
    forumUsername: sender.forumUsername
  });
  senderState.targetConversationTitle = greetingTitle;
  senderState.lastConversationUrl = senderStage1.conversationUrl;
  senderState.lifecycle = { closeBrowser: !keepAlive, closeProfile: !keepAlive };

  senderState = await runTaskList({ ctx, state: senderState, tasks: [senderAttach] });

  try {
    senderState = await runTaskList({ ctx, state: senderState, tasks: [openUnreadConversationTask] });

    if (senderState.status === "conversation_opened") {
      senderState = await runTaskList({ ctx, state: { ...senderState, abortPipeline: false }, tasks: [readRepliesTask] });
    }

    senderState.replyBody = followUpBody;
    senderState.currentBody = followUpBody;
    senderState = await runTaskList({ ctx, state: { ...senderState, abortPipeline: false }, tasks: [sendReplyTask] });
  } finally {
    senderState = await runTaskList({ ctx, state: { ...senderState, abortPipeline: false }, tasks: [stopProfileTask] });
  }

  const senderStage3 = {
    status: senderState.status,
    newReplies: senderState.newReplies,
    lastError: senderState.lastError
  };

  return {
    ok: senderStage3.status === "reply_sent",
    stage: "follow_up_sent",
    sender: senderStage1,
    receiver: receiverStage2,
    followUp: senderStage3
  };
}