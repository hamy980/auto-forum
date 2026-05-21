export async function listGroupsTask({ ctx }) {
  const payload = await ctx.gpmClient.request("/api/v3/groups");
  return payload.data;
}
