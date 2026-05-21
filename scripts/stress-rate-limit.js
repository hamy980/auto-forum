import { runTwoProfileRateLimitTest } from "./orchestrators/stress-rate-limit.js";

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
    titlePrefix: "rate-limit-test",
    bodyPrefix: "hello from stress pipeline",
    maxAttempts: 5,
    autoUpdateTimerule: true
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
    else if (arg === "--title-prefix") parsed.titlePrefix = argv[++i];
    else if (arg === "--body-prefix") parsed.bodyPrefix = argv[++i];
    else if (arg === "--max-attempts") parsed.maxAttempts = Number(argv[++i]);
    else if (arg === "--no-auto-update-timerule") parsed.autoUpdateTimerule = false;
  }

  const required = [
    "forumId",
    "senderProfileId",
    "senderRemote",
    "senderUsername",
    "receiverProfileId",
    "receiverRemote",
    "receiverUsername"
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
  const result = await runTwoProfileRateLimitTest({
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
    titlePrefix: args.titlePrefix,
    bodyPrefix: args.bodyPrefix,
    maxAttempts: args.maxAttempts,
    autoUpdateTimerule: args.autoUpdateTimerule
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
