import { testPmBetweenRunningProfiles } from "./orchestrators/test-pm-between-profiles.js";

function parseArgs(argv) {
  const parsed = {
    forumId: null,
    senderProfileId: null,
    senderProfileName: null,
    senderRemote: null,
    senderUsername: null,
    receiverProfileId: null,
    receiverProfileName: null,
    receiverRemote: null,
    receiverUsername: null,
    title: null,
    body: null,
    keepAlive: true,
    autoUpdateTimerule: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--forum") parsed.forumId = argv[++i];
    else if (arg === "--sender-profile-id") parsed.senderProfileId = argv[++i];
    else if (arg === "--sender-profile-name") parsed.senderProfileName = argv[++i];
    else if (arg === "--sender-remote") parsed.senderRemote = argv[++i];
    else if (arg === "--sender-username") parsed.senderUsername = argv[++i];
    else if (arg === "--receiver-profile-id") parsed.receiverProfileId = argv[++i];
    else if (arg === "--receiver-profile-name") parsed.receiverProfileName = argv[++i];
    else if (arg === "--receiver-remote") parsed.receiverRemote = argv[++i];
    else if (arg === "--receiver-username") parsed.receiverUsername = argv[++i];
    else if (arg === "--title") parsed.title = argv[++i];
    else if (arg === "--body") parsed.body = argv[++i];
    else if (arg === "--close-after") parsed.keepAlive = false;
    else if (arg === "--auto-update-timerule") parsed.autoUpdateTimerule = true;
  }

  const required = [
    "forumId",
    "senderProfileId",
    "senderRemote",
    "senderUsername",
    "receiverProfileId",
    "receiverRemote",
    "receiverUsername",
    "title",
    "body"
  ];
  for (const key of required) {
    if (!parsed[key]) {
      throw new Error(`Missing required arg: ${key}`);
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await testPmBetweenRunningProfiles({
    forumId: args.forumId,
    sender: {
      profileId: args.senderProfileId,
      profileName: args.senderProfileName,
      remoteDebuggingAddress: args.senderRemote,
      forumUsername: args.senderUsername
    },
    receiver: {
      profileId: args.receiverProfileId,
      profileName: args.receiverProfileName,
      remoteDebuggingAddress: args.receiverRemote,
      forumUsername: args.receiverUsername
    },
    title: args.title,
    body: args.body,
    keepAlive: args.keepAlive,
    autoUpdateTimerule: args.autoUpdateTimerule
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
