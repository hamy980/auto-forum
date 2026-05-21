import { buildCampaignContent } from "../../lib/campaign-sources.js";

export const personalizeContentTask = {
  name: "forum:personalize-content",
  async run({ ctx, state }) {
    const sequence = (state.sequence ?? 0) + 1;
    const { title, body } = buildCampaignContent({
      campaign: ctx.campaign,
      contentPack: ctx.contentPack,
      recipient: state.currentRecipient,
      profile: {
        id: state.profileId,
        name: state.profileName
      },
      sequence
    });

    return {
      ...state,
      sequence,
      currentTitle: title,
      currentBody: body,
      status: "content_ready"
    };
  }
};
