import { loadAiConfig, loadAgentPersona, generateReply, buildConversationPrompt } from "./lib/ai-client.js";
import { loadForumConfig } from "./lib/forum-config.js";
import { parseFrontmatter, buildMdFrontmatter } from "./lib/conversation-reader.js";
import { dataDir } from "./lib/paths.js";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const parsed = { forumId: null, status: "unread", dryRun: false, max: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--forum") { parsed.forumId = argv[++i]; continue; }
    if (arg === "--status") { parsed.status = argv[++i]; continue; }
    if (arg === "--dry-run") { parsed.dryRun = true; continue; }
    if (arg === "--max") { parsed.max = Number(argv[++i]); continue; }
  }
  if (!parsed.forumId) {
    throw new Error("Usage: node scripts/ai-reply.js --forum <id> [--status unread] [--dry-run] [--max N]");
  }
  return parsed;
}

async function processConversation(filePath, forumConfig, aiConfig, systemPrompt, dryRun) {
  const content = await fs.readFile(filePath, "utf-8");
  const frontmatter = parseFrontmatter(content);

  if (!frontmatter) {
    return { file: filePath, status: "error", error: "No frontmatter found" };
  }

  // Check status filter
  if (frontmatter.status !== "unread" && frontmatter.status !== undefined) {
    return { file: filePath, status: "skipped", reason: `status is "${frontmatter.status}", not "unread"` };
  }

  // Extract chat log (everything after second ---)
  const parts = content.split("---");
  let chatLog;
  if (parts.length >= 3) {
    chatLog = parts.slice(2).join("---").trim();
  } else {
    chatLog = content.trim();
  }

  const memberName = frontmatter.member_name ?? "unknown";

  // Build prompt and call AI
  const userPrompt = buildConversationPrompt(chatLog, memberName, forumConfig);

  try {
    const result = await generateReply(aiConfig, systemPrompt, userPrompt);

    // Validate reply quality
    const replyText = result.text;
    if (replyText.length < 10) {
      return { file: filePath, member_name: memberName, status: "ai_error", error: "Reply too short", raw_reply: replyText };
    }

    if (dryRun) {
      return {
        file: filePath,
        member_name: memberName,
        status: "dry_run",
        reply_preview: replyText.slice(0, 200),
        model: result.model,
        duration_ms: result.durationMs
      };
    }

    // Update .md file with AI reply
    const now = new Date().toISOString();
    const updatedFrontmatter = {
      ...frontmatter,
      status: "ai_generated",
      ai_reply: replyText,
      ai_reply_at: now,
      ai_model: result.model
    };

    // Append AI reply to chat log
    const updatedChatLog = chatLog + `\n\n## me (AI-generated, ${now})\n${replyText}`;
    const updatedContent = buildMdFrontmatter(updatedFrontmatter) + "\n" + updatedChatLog + "\n";

    await fs.writeFile(filePath, updatedContent, "utf-8");

    return {
      file: filePath,
      member_name: memberName,
      status: "ai_generated",
      reply_preview: replyText.slice(0, 200),
      model: result.model,
      duration_ms: result.durationMs
    };
  } catch (err) {
    return { file: filePath, member_name: memberName, status: "ai_error", error: err.message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const aiConfig = await loadAiConfig();
  const systemPrompt = await loadAgentPersona(args.forumId);
  const forumConfig = await loadForumConfig(args.forumId);

  const replyDir = path.join(dataDir, args.forumId, "reply");

  let files;
  try {
    files = (await fs.readdir(replyDir)).filter(f => f.endsWith(".md"));
  } catch {
    console.error(`[ai-reply] No reply directory found at ${replyDir}`);
    console.log(JSON.stringify({ forum: args.forumId, processed: 0, skipped: 0, errors: 0, conversations: [] }, null, 2));
    return;
  }

  if (files.length === 0) {
    console.error(`[ai-reply] No .md files found in ${replyDir}`);
    console.log(JSON.stringify({ forum: args.forumId, processed: 0, skipped: 0, errors: 0, conversations: [] }, null, 2));
    return;
  }

  console.error(`[ai-reply] Found ${files.length} conversation files`);
  console.error(`[ai-reply] AI: ${aiConfig.provider} / ${aiConfig.model} at ${aiConfig.baseUrl}`);

  const results = [];
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  const maxProcess = args.max > 0 ? args.max : files.length;

  for (const file of files.slice(0, maxProcess)) {
    const filePath = path.join(replyDir, file);
    console.error(`[ai-reply] Processing ${file}...`);

    const result = await processConversation(filePath, forumConfig, aiConfig, systemPrompt, args.dryRun);
    results.push(result);

    if (result.status === "skipped") {
      skipped += 1;
    } else if (result.status === "ai_error") {
      errors += 1;
      console.error(`[ai-reply] Error for ${file}: ${result.error}`);
    } else {
      processed += 1;
      if (result.status === "dry_run") {
        console.error(`[ai-reply] [DRY RUN] ${file}: ${result.reply_preview}`);
      } else if (result.status === "ai_generated") {
        console.error(`[ai-reply] Generated reply for ${file} (${result.duration_ms}ms, ${result.model})`);
      }
    }
  }

  const summary = {
    forum: args.forumId,
    processed,
    skipped,
    errors,
    conversations: results
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});