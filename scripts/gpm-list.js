import { createTaskContext } from "./tasks/core/task-context.js";
import { listGroupsTask } from "./tasks/gpm/list-groups.js";
import { listProfilesTask } from "./tasks/gpm/list-profiles.js";

function parseArgs(argv) {
  const parsed = {
    mode: null,
    search: "",
    groupId: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--groups") parsed.mode = "groups";
    else if (arg === "--profiles") parsed.mode = "profiles";
    else if (arg === "--search") parsed.search = argv[++i] ?? "";
    else if (arg === "--group-id") parsed.groupId = Number(argv[++i]);
  }

  if (!parsed.mode) {
    throw new Error("Usage: node scripts/gpm-list.js --groups | --profiles [--search text] [--group-id n]");
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ctx = await createTaskContext({
    campaign: { id: "utility", titleTemplates: [], bodyTemplates: [] },
    forumConfig: { id: "utility" }
  });

  if (args.mode === "groups") {
    console.log(JSON.stringify(await listGroupsTask({ ctx }), null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      await listProfilesTask({
        ctx,
        search: args.search,
        groupId: Number.isFinite(args.groupId) ? args.groupId : null
      }),
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
