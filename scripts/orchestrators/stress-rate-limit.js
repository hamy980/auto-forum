import { testPmBetweenRunningProfiles } from "./test-pm-between-profiles.js";

export async function runTwoProfileRateLimitTest({
  forumId,
  sender,
  receiver,
  titlePrefix,
  bodyPrefix,
  maxAttempts = 5,
  autoUpdateTimerule = true
}) {
  const attempts = [];

  for (let index = 1; index <= maxAttempts; index += 1) {
    const result = await testPmBetweenRunningProfiles({
      forumId,
      sender,
      receiver,
      title: `${titlePrefix} ${index}`,
      body: `${bodyPrefix} ${index}`,
      keepAlive: true,
      autoUpdateTimerule,
      verifyReceiver: false
    });

    attempts.push(result);

    if (result.sender.status === "cooldown" || result.sender.status === "permission_denied") {
      return {
        ok: result.sender.status === "cooldown",
        status: result.sender.status,
        attempts,
        stoppedAt: index,
        timeruleUpdated: result.sender.timeruleUpdated ?? null
      };
    }
  }

  return {
    ok: true,
    status: "max_attempts_reached",
    attempts,
    stoppedAt: maxAttempts,
    timeruleUpdated: attempts.at(-1)?.sender?.timeruleUpdated ?? null
  };
}
