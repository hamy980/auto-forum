import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import { campaignsDir, forumsDir } from "./lib/paths.js";
import { ensureDir, resolveMaybeRelative } from "./lib/utils.js";

const cwd = process.cwd();

function unquote(s) {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function tsId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function ask(rl, label, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function validateMembers(memberPath) {
  memberPath = unquote(memberPath);
  const absolute = resolveMaybeRelative(cwd, memberPath);
  const raw = await fs.readFile(absolute, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#"));
  if (lines.length === 0) {
    throw new Error(`Member file ${memberPath} has no usable lines`);
  }
  return { absolute, count: lines.length, preview: lines.slice(0, 3) };
}

async function validateForum(forumId) {
  const configPath = path.join(forumsDir, `${forumId}.json`);
  const exists = await fs.stat(configPath).then(() => true).catch(() => false);
  if (!exists) {
    throw new Error(`Forum config not found: ${configPath}`);
  }
  return configPath;
}

async function loadContent(contentPath) {
  contentPath = unquote(contentPath);
  const absolute = resolveMaybeRelative(cwd, contentPath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) {
    throw new Error(`Content path is not a file: ${absolute}`);
  }
  const ext = path.extname(absolute).toLowerCase();
  if (ext === ".json") {
    const data = JSON.parse(await fs.readFile(absolute, "utf8"));
    const variants = Array.isArray(data.contents) ? data.contents : null;
    if (!variants) {
      throw new Error('Content JSON must have a "contents" array of {title, body} objects');
    }
    const normalized = variants
      .map((v, i) => {
        if (typeof v.title !== "string" || typeof v.body !== "string") {
          throw new Error(`contents[${i}].title and contents[${i}].body must be strings`);
        }
        if (!v.title.trim() || !v.body.trim()) return null;
        return { title: v.title, body: v.body };
      })
      .filter(Boolean);
    if (normalized.length === 0) {
      throw new Error('Content JSON "contents" array has no valid {title, body} entries');
    }
    return { mode: "json", absolute, variants: normalized };
  }
  throw new Error(`Unsupported content extension: ${ext}. Use .json`);
}

async function listForumIds() {
  const files = await fs.readdir(forumsDir).catch(() => []);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}

async function listProfiles() {
  try {
    const res = await fetch("http://127.0.0.1:19995/api/v3/profiles?per_page=100");
    const payload = await res.json();
    if (!payload.success) return [];
    return payload.data.map((p) => ({ id: p.id, name: p.name, group_id: p.group_id }));
  } catch {
    return [];
  }
}

async function listGroups() {
  try {
    const res = await fetch("http://127.0.0.1:19995/api/v3/groups");
    const payload = await res.json();
    if (!payload.success) return [];
    return payload.data.map((g) => ({ id: g.id, name: g.name }));
  } catch {
    return [];
  }
}

function findMatchingGroup(groups, forumId) {
  const lower = forumId.toLowerCase();
  const exact = groups.find((g) => g.name.toLowerCase() === lower);
  if (exact) return exact;
  const contains = groups.find((g) => lower.includes(g.name.toLowerCase()) || g.name.toLowerCase().includes(lower));
  return contains ?? null;
}

function runRunner(campaignId, profileIds) {
  return new Promise((resolve, reject) => {
    const args = ["scripts/runner.js", "--campaign", campaignId];
    if (profileIds.length > 0) {
      args.push("--profiles", profileIds.join(","));
    }
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`runner exited with code ${code}`))));
  });
}

async function main() {
  const rl = readline.createInterface({ input, output });

  console.log("=== Quick Campaign Wizard ===\n");
  console.log("(Ban co the nhap relative path nhu 'data/members/x.txt' hoac absolute path Windows nhu 'C:\\\\path\\\\to\\\\file.txt')\n");

  const memberPath = await ask(rl, "Member list file path (e.g. data/members/massagevua-test.txt)");
  let members;
  try {
    members = await validateMembers(memberPath);
    console.log(`  -> ${members.count} members, preview: ${members.preview.join(", ")}\n`);
  } catch (err) {
    console.error(`[error] ${err.message}`);
    rl.close();
    process.exit(1);
  }

  const forumIds = await listForumIds();
  const forumId = await ask(rl, `Forum ID (available: ${forumIds.join(", ")})`);
  try {
    await validateForum(forumId);
    console.log(`  -> forum config OK\n`);
  } catch (err) {
    console.error(`[error] ${err.message}`);
    rl.close();
    process.exit(1);
  }

  const contentPath = await ask(rl, "Content file path (.json with contents[{title, body}])  (absolute path OK)");
  let content;
  try {
    content = await loadContent(contentPath);
    console.log(`  -> content OK (${content.variants.length} variant(s))\n`);
  } catch (err) {
    console.error(`[error] ${err.message}`);
    rl.close();
    process.exit(1);
  }

  const [profiles, groups] = await Promise.all([listProfiles(), listGroups()]);
  let profileIds = [];
  let scopedGroup = null;
  if (profiles.length > 0 && groups.length > 0) {
    scopedGroup = findMatchingGroup(groups, forumId);
    if (scopedGroup) {
      const inGroup = profiles.filter((p) => p.group_id === scopedGroup.id);
      console.log(`  -> GPM group matched: "${scopedGroup.name}" (id=${scopedGroup.id}); ${inGroup.length}/${profiles.length} profile(s) in this group`);
    } else {
      console.log(`  -> Warning: no GPM group matches forum "${forumId}". Will use all ${profiles.length} profile(s).`);
    }
    const candidates = scopedGroup ? profiles.filter((p) => p.group_id === scopedGroup.id) : profiles;
    if (candidates.length === 0) {
      console.log("  -> No candidates available; profileIds will be empty.\n");
    } else {
      const profileInput = await ask(
        rl,
        `Profile selection (Enter=all ${candidates.length}, 'N'=first N, or comma-separated UUIDs/names)`,
        ""
      );
      const normalized = profileInput.trim().toLowerCase();
      if (!normalized || normalized === "all" || normalized === "*") {
        profileIds = candidates.map((p) => p.id);
        console.log(`  -> Using all ${profileIds.length} profile(s) in group "${scopedGroup?.name ?? "(unscoped)"}"`);
      } else if (/^\d+$/.test(normalized)) {
        const n = Math.min(Number(normalized), candidates.length);
        profileIds = candidates.slice(0, n).map((p) => p.id);
        console.log(`  -> Using first ${profileIds.length} profile(s) in group`);
      } else {
        const requested = profileInput.split(",").map((s) => s.trim()).filter(Boolean);
        const knownIds = new Set(candidates.map((p) => p.id));
        const knownNames = new Map(candidates.map((p) => [p.name.toLowerCase(), p.id]));
        profileIds = requested.map((r) => {
          if (knownIds.has(r)) return r;
          if (knownNames.has(r.toLowerCase())) return knownNames.get(r.toLowerCase());
          return r;
        });
        const unknown = requested.filter((r) => !knownIds.has(r) && !knownNames.has(r.toLowerCase()));
        if (unknown.length > 0) {
          console.log(`  -> Warning: ${unknown.length} profile(s) not found in group: ${unknown.join(", ")}`);
        }
        console.log(`  -> Selected ${profileIds.length} profile(s)`);
      }
      console.log();
    }
  } else {
    console.log("  -> GPM not reachable; profileIds will be empty (set later or pass --profiles)\n");
  }

  const id = `quick-${tsId()}`;
  const campaign = {
    id,
    forumId,
    profileIds,
    memberListPath: members.absolute,
    titleTemplates: content.variants.map((v) => v.title),
    bodyTemplates: content.variants.map((v) => v.body),
    errorThreshold: 3
  };

  await ensureDir(campaignsDir);
  const outPath = path.join(campaignsDir, `${id}.json`);
  await fs.writeFile(outPath, JSON.stringify(campaign, null, 2), "utf8");
  console.log(`[wizard] wrote ${outPath}`);

  const confirm = await ask(rl, `Run campaign "${id}" now? (yes/no)`, "yes");
  rl.close();

  if (!/^y(es)?$/i.test(confirm)) {
    console.log(`[wizard] skipped run. To run later: node scripts/runner.js --campaign ${id}`);
    return;
  }

  try {
    await runRunner(id, profileIds);
  } catch (err) {
    console.error(`[runner] ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
});
