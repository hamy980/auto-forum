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
  return JSON.parse(await fs.readFile(configPath, "utf8"));
}

function buildNewForumConfig(forumId, baseUrl) {
  const defaultPath = "/conversations/add?to={recipient}";
  return {
    id: forumId,
    label: forumId,
    baseUrl,
    composeUrlTemplate: `${baseUrl.replace(/\/$/, "")}${defaultPath}`,
    recipientEncoding: "xenforo-plus",
    selectors: {
      title: "input[name='title']",
      body: "[contenteditable='true']",
      submit: "button.button--icon--conversation"
    },
    submitIndex: 0,
    successUrlIncludes: "/conversations/",
    cooldownErrorIncludes: "You must wait at least",
    permissionErrorIncludes: "do not have permission",
    validationErrorSelectors: [".blockMessage", ".message--error", ".formRow--errors"],
    inbox: {
      listUrl: "/conversations/",
      popupTrigger: ".p-navgroup-link--conversations",
      unreadBadgeAttr: "data-badge",
      popupBody: ".js-convMenuBody",
      popupRow: ".menu-row",
      popupRowHighlighted: ".menu-row--highlighted",
      popupConversationLink: ".fauxBlockLink-blockLink",
      popupTime: "time[data-time]"
    },
    conversation: {
      messageBlock: ".message",
      messageBody: ".message-body .bbWrapper",
      messageAuthor: ".message-name a",
      messageTime: "time[data-time]",
      replyEditor: ".fr-element[contenteditable='true']",
      replySubmit: "button.button--icon--reply"
    },
    fallbackReplies: {
      fromOther: "Cảm ơn <<first_name>> đã phản hồi! Mình sẽ cập nhật thêm sớm nhé.",
      fromSelf: "Cảm ơn bạn đã liên hệ! Mình sẽ phản hồi sớm nhé."
    },
    delayMs: { min: 60000, max: 80000 },
    replyDelayMs: { min: 4000, max: 8000 },
    timeouts: {
      navigation: 60000,
      waitFor: 15000,
      closeBeforeStartMs: 2000,
      cdpReadyMs: 30000,
      cdpPollIntervalMs: 2000,
      postSubmitMs: 1000,
      closeProfileMs: 15000,
      popupOpenMs: 3000,
      popupCloseMs: 300,
      inboxSettleMs: 2000,
      conversationSettleMs: 1500,
      postReplyMinMs: 4000,
      postReplyMaxMs: 8000,
      replyEditorClickMs: 500,
      chatListWaitMs: 1500
    },
    retry: {
      maxAttempts: 3,
      postClickPollMs: 12000,
      postClickPollIntervalMs: 500,
      networkRetryDelayMs: 3000,
      cooldownFallbackMs: 70000
    },
    cookieBanner: {
      dismissSelector: "#cookie-accept",
      waitMs: 3000,
      clickTimeoutMs: 3000,
      afterClickMs: 500
    }
  };
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

async function listProfiles({ groupId = null } = {}) {
  try {
    const params = new URLSearchParams({ per_page: "100" });
    if (groupId) params.set("group_id", String(groupId));
    const res = await fetch(`http://127.0.0.1:19995/api/v3/profiles?${params}`);
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
  console.log("(Paths: relative OK; absolute Windows paths also accepted. Domain is matched against config/forums/<domain>.json and GPM group names.)\n");

  // 1. Domain (forum)
  const forumIds = await listForumIds();
  const domain = unquote(await ask(rl, `1) Domain (forum) (available: ${forumIds.join(", ")})`));
  let forumConfig;
  try {
    forumConfig = await validateForum(domain);
    console.log(`  -> forum config OK (baseUrl: ${forumConfig.baseUrl})\n`);
  } catch (err) {
    console.log(`  -> ${err.message}`);
    const choice = await ask(rl, "  Tao forum config moi? (yes/no)", "no");
    if (!/^y(es)?$/i.test(choice)) {
      console.error(`[error] aborting; create ${domain}.json under config/forums/ then retry.`);
      rl.close();
      process.exit(1);
    }
    const defaultUrl = `https://${domain}`;
    const baseUrl = unquote(await ask(rl, `  Base URL (default: ${defaultUrl})`, defaultUrl));
    const cfg = buildNewForumConfig(domain, baseUrl);
    await ensureDir(forumsDir);
    const cfgPath = path.join(forumsDir, `${domain}.json`);
    await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
    console.log(`  -> wrote ${cfgPath}`);
    console.log(`  -> NOTE: selectors are XenForo defaults; edit the file if your forum uses different markup.`);
    console.log(`  -> NOTE: if this forum is real-domain and should not be tracked, add it to .gitignore.\n`);
    forumConfig = cfg;
  }

  // 2. Member list
  const memberPath = await ask(rl, "2) Member list file path (e.g. data/members/massagevua-test.txt)");
  let members;
  try {
    members = await validateMembers(memberPath);
    console.log(`  -> ${members.count} members, preview: ${members.preview.join(", ")}\n`);
  } catch (err) {
    console.error(`[error] ${err.message}`);
    rl.close();
    process.exit(1);
  }

  // 3. Content
  const contentPath = await ask(rl, "3) Content file path (.json with contents[{title, body}])");
  let content;
  try {
    content = await loadContent(contentPath);
    console.log(`  -> content OK (${content.variants.length} variant(s))\n`);
  } catch (err) {
    console.error(`[error] ${err.message}`);
    rl.close();
    process.exit(1);
  }

  const [allProfiles, groups] = await Promise.all([listProfiles(), listGroups()]);
  let profileIds = [];
  let scopedGroup = null;
  let candidates = allProfiles;
  if (allProfiles.length > 0 && groups.length > 0) {
    scopedGroup = findMatchingGroup(groups, domain);
    if (scopedGroup) {
      candidates = await listProfiles({ groupId: scopedGroup.id });
      console.log(`  -> GPM group matched: "${scopedGroup.name}" (id=${scopedGroup.id}); ${candidates.length}/${allProfiles.length} profile(s) in this group`);
    } else {
      console.log(`  -> Warning: no GPM group matches domain "${domain}". Will use all ${allProfiles.length} profile(s).`);
    }
    if (candidates.length === 0) {
      console.log("  -> No candidates available; profileIds will be empty.\n");
    } else {
      console.log("  -> Available profiles in this batch (1-indexed):");
      candidates.forEach((p, i) => console.log(`     [${i + 1}] ${p.name}  (${p.id.slice(0, 8)}...)`));
      console.log();
      const profileInput = await ask(
        rl,
        `Profile selection: Enter=all ${candidates.length} | N=first N | A-B=range (e.g. 1-3) | N,M=positions or UUIDs/names`,
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
      } else if (/^\d+\s*-\s*\d+$/.test(normalized)) {
        const [aRaw, bRaw] = normalized.split("-").map((s) => Number(s.trim()));
        const a = Math.max(1, Math.min(candidates.length, aRaw));
        const b = Math.max(1, Math.min(candidates.length, bRaw));
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        profileIds = candidates.slice(lo - 1, hi).map((p) => p.id);
        if (profileIds.length === 0) {
          console.log(`  -> Range ${aRaw}-${bRaw} yields no valid positions (group has ${candidates.length} profile(s))`);
        } else {
          console.log(`  -> Using batch positions ${lo}-${hi}: ${profileIds.length} profile(s)`);
        }
      } else {
        const tokens = profileInput.split(",").map((s) => s.trim()).filter(Boolean);
        const knownIds = new Set(candidates.map((p) => p.id));
        const knownNames = new Map(candidates.map((p) => [p.name.toLowerCase(), p.id]));
        const positionRe = /^\d+$/;
        const out = [];
        const unknown = [];
        for (const t of tokens) {
          if (positionRe.test(t)) {
            const idx = Number(t) - 1;
            if (idx >= 0 && idx < candidates.length) {
              out.push(candidates[idx].id);
            } else {
              unknown.push(t);
            }
          } else if (knownIds.has(t)) {
            out.push(t);
          } else if (knownNames.has(t.toLowerCase())) {
            out.push(knownNames.get(t.toLowerCase()));
          } else {
            unknown.push(t);
          }
        }
        profileIds = out;
        if (unknown.length > 0) {
          console.log(`  -> Warning: ${unknown.length} unknown: ${unknown.join(", ")}`);
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
    forumId: domain,
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
