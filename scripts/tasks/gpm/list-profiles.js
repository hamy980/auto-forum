export async function listProfilesTask({ ctx, search = "", groupId = null, perPage = 100, page = 1 }) {
  const params = {
    search,
    per_page: perPage,
    page
  };
  if (groupId !== null && groupId !== undefined) {
    params.group_id = groupId;
  }
  const payload = await ctx.gpmClient.listProfiles(params);
  return payload.data;
}
