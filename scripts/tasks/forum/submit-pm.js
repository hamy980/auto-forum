import { collectNetworkDuring } from "../../lib/playwright-helpers.js";
import { sleep } from "../../lib/utils.js";

function isSubmitUrl(url, forumConfig) {
  const composePath = new URL(forumConfig.composeUrlTemplate.replace("{recipient}", "placeholder")).pathname;
  return url.includes(composePath) && !url.includes("job.php");
}

const COOLDOWN_BUFFER_S = 15;

function extractCooldownMs(message) {
  if (!message) {
    return null;
  }
  const seconds = message.match(/wait at least\s+(\d+)\s+seconds/i);
  if (seconds) {
    return (Number(seconds[1]) + COOLDOWN_BUFFER_S) * 1000;
  }
  const minutes = message.match(/wait at least\s+(\d+)\s+minutes?/i);
  if (minutes) {
    return (Number(minutes[1]) * 60 + COOLDOWN_BUFFER_S) * 1000;
  }
  return null;
}

async function readValidationErrors(page, forumConfig) {
  const selectors = forumConfig.validationErrorSelectors ?? [];
  const values = [];
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    for (let index = 0; index < count; index += 1) {
      const text = (await page.locator(selector).nth(index).textContent())?.trim();
      if (text) {
        values.push(text);
      }
    }
  }
  return values;
}

function detectSubmitResponse(events, forumConfig) {
  const submitResponse = [...events]
    .reverse()
    .find((event) => event.type === "response" && isSubmitUrl(event.url, forumConfig));

  if (!submitResponse) {
    return null;
  }
  if (submitResponse.body?.includes(forumConfig.cooldownErrorIncludes)) {
    return {
      status: "cooldown",
      message: submitResponse.body,
      retryAfterMs: extractCooldownMs(submitResponse.body)
    };
  }
  if (submitResponse.body?.includes(forumConfig.permissionErrorIncludes)) {
    return {
      status: "permission_denied",
      message: submitResponse.body
    };
  }
  return null;
}

async function resolveSubmitOutcome(page, forumConfig, composeUrl, events) {
  const retryConfig = forumConfig.retry ?? {};
  const timeoutMs = retryConfig.postClickPollMs ?? 12000;
  const pollIntervalMs = retryConfig.postClickPollIntervalMs ?? 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentUrl = page.url();
    if (currentUrl.includes(forumConfig.successUrlIncludes) && !currentUrl.startsWith(composeUrl)) {
      return {
        status: "sent",
        conversationUrl: currentUrl
      };
    }

    const validationErrors = await readValidationErrors(page, forumConfig);
    const combined = validationErrors.join("\n");
    if (combined) {
      if (combined.includes(forumConfig.cooldownErrorIncludes)) {
        return {
          status: "cooldown",
          message: combined,
          retryAfterMs: extractCooldownMs(combined)
        };
      }
      if (combined.includes(forumConfig.permissionErrorIncludes)) {
        return {
          status: "permission_denied",
          message: combined
        };
      }
      return {
        status: "validation_error",
        message: combined
      };
    }

    await sleep(pollIntervalMs);
  }

  const responseOutcome = detectSubmitResponse(events, forumConfig);
  if (responseOutcome) {
    return responseOutcome;
  }

  if (page.url().includes(forumConfig.successUrlIncludes) && !page.url().startsWith(composeUrl)) {
    return {
      status: "sent",
      conversationUrl: page.url()
    };
  }

  return {
    status: "timeout",
    message: `No success or error state within ${timeoutMs}ms`
  };
}

export const submitPmTask = {
  name: "forum:submit-pm",
  async run({ ctx, state }) {
    const timeouts = ctx.forumConfig.timeouts ?? {};
    const events = await collectNetworkDuring(
      state.page,
      async () => {
        await state.page.locator(ctx.forumConfig.selectors.submit).nth(ctx.forumConfig.submitIndex ?? 0).click();
        await state.page.waitForLoadState("domcontentloaded", { timeout: timeouts.waitFor ?? 15000 }).catch(() => {});
        await sleep(timeouts.postSubmitMs ?? 750);
      },
      (url, resourceType) =>
        url.includes(new URL(ctx.forumConfig.baseUrl).host) &&
        ["document", "fetch", "xhr"].includes(resourceType)
    );

    const outcome = await resolveSubmitOutcome(state.page, ctx.forumConfig, state.composeUrl, events);
    return {
      ...state,
      lastEvents: events,
      lastOutcome: outcome,
      lastConversationUrl: outcome.conversationUrl ?? null,
      lastError: outcome.message ?? null,
      status: outcome.status
    };
  }
};
