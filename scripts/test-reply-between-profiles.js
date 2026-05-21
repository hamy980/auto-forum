import { testReplyBetweenProfiles } from "./orchestrators/test-reply-between-profiles.js";

function parseArgs(argv) {
  const parsed = {
    forumId: null,
    senderProfileId: null,
    senderRemote: null,
    senderUsername: null,
    receiverProfileId: null,
    receiverRemote: null,
    receiverUsername: null,
    greetingTitle: "Chào bạn, làm quen nhé!",
    greetingBody: "Chào bạn! Mình mới tham gia diễn đàn, muốn kết bạn. Có gì thú vị chia sẻ với mình nhé!",
    replyBody: "Chào bạn! Cảm ơn đã nhắn tin, mình rất vui được làm quen 😊",
    followUpBody: "Cảm ơn bạn đã reply! Đây là info mình muốn chia sẻ: https://example.com — bạn xem nhé!",
    keepAlive: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--forum") parsed.forumId = argv[++i];
    else if (arg === "--sender-profile-id") parsed.senderProfileId = argv[++i];
    else if (arg === "--sender-remote") parsed.senderRemote = argv[++i];
    else if (arg === "--sender-username") parsed.senderUsername = argv[++i];
    else if (arg === "--receiver-profile-id") parsed.receiverProfileId = argv[++i];
    else if (arg === "--receiver-remote") parsed.receiverRemote = argv[++i];
    else if (arg === "--receiver-username") parsed.receiverUsername = argv[++i];
    else if (arg === "--greeting-title") parsed.greetingTitle = argv[++i];
    else if (arg === "--greeting-body") parsed.greetingBody = argv[++i];
    else if (arg === "--reply-body") parsed.replyBody = argv[++i];
    else if (arg === "--follow-up-body") parsed.followUpBody = argv[++i];
    else if (arg === "--close-after") parsed.keepAlive = false;
  }

  const required = ["forumId", "senderProfileId", "senderRemote", "senderUsername", "receiverProfileId", "receiverRemote", "receiverUsername"];
  for (const key of required) {
    if (!parsed[key]) {
      throw new Error(`Missing required arg: ${key}`);
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await testReplyBetweenProfiles({
    forumId: args.forumId,
    sender: {
      profileId: args.senderProfileId,
      remoteDebuggingAddress: args.senderRemote,
      forumUsername: args.senderUsername
    },
    receiver: {
      profileId: args.receiverProfileId,
      remoteDebuggingAddress: args.receiverRemote,
      forumUsername: args.receiverUsername
    },
    greetingTitle: args.greetingTitle,
    greetingBody: args.greetingBody,
    replyBody: args.replyBody,
    followUpBody: args.followUpBody,
    keepAlive: args.keepAlive
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});