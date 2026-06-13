import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import { campaignsDir, dataDir, forumsDir } from "./lib/paths.js";
import { ensureDir, resolveMaybeRelative } from "./lib/utils.js";

const cwd = process.cwd();

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
  const absolute = resolveMaybeRelative(cwd, contentPath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) {
    throw new Error(`Content path is not a file: ${absolute}`);
  }
  const ext = path.extname(absolute).toLowerCase();
  if (ext === ".json") {
    const data = JSON.parse(await fs.readFile(absolute, "utf8"));
    if (!Array.isArray(data.titleTemplates) || !Array.isArray(data.bodyTemplates)) {
      throw new Error("Content JSON must have titleTemplates[] and bodyTemplates[]");
    }
    if (data.titleTemplates.length === 0 || data.bodyTemplates.length === 0) {
      throw new Error("Content JSON titleTemplates/bodyTemplates cannot be empty");
    }
    return { mode: "json", absolute, data };
  }
  if (ext === ".txt" || ext === ".md") {
    const lines = (await fs.readFile(absolute, "utf8"))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.startsWith("#"));
    if (lines.length === 0) {
      throw new Error(`Content text file ${contentPath} has no usable lines`);
    }
    return { mode: "text", absolute, lines };
  }
  throw new Error(`Unsupported content extension: ${ext}. Use .json or .txt`);
}

function buildTemplates(content) {
  if (content.mode === "json") {
    return {
      titleTemplates: content.data.titleTemplates,
      bodyTemplates: content.data.bodyTemplates
    };
  }
  return {
    titleTemplates: ["Chào {first_name}!"],
    bodyTemplates: content.lines
  };
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
    return payload.data.map((p) => ({ id: p.id, name: p.name }));
  } catch {
    return [];
  }
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

  const contentPath = await ask(rl, "Content file path (.json with titleTemplates+bodyTemplates, or .txt with one body per line)");
  let content;
  try {
    content = await loadContent(contentPath);
    console.log(`  -> content OK (${content.mode} mode)\n`);
  } catch (err) {
    console.error(`[error] ${err.message}`);
    rl.close();
    process.exit(1);
  }

  const profiles = await listProfiles();
  let profileIds = [];
  if (profiles.length > 0) {
    const profileInput = await ask(
      rl,
      `Profile IDs comma-separated (enter = all ${profiles.length} profiles)`,
      ""
    );
    if (profileInput) {
      profileIds = profileInput.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      profileIds = profiles.map((p) => p.id);
    }
    console.log(`  -> ${profileIds.length} profile(s) selected\n`);
  } else {
    console.log("  -> GPM not reachable; profileIds will be empty (set later or pass --profiles)\n");
  }

  const id = `quick-${tsId()}`;
  const templates = buildTemplates(content);
  const campaign = {
    id,
    forumId,
    profileIds,
    memberListPath: members.absolute.includes(dataDir)
      ? path.relative(path.dirname(campaignsDir), members.absolute).replace(/\\/g, "/")
      : memberPath,
    ...templates,
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
