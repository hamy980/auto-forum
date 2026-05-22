import fs from "node:fs/promises";
import path from "node:path";
import { configDir } from "./paths.js";
import { readJson } from "./utils.js";

const DEFAULT_AI_CONFIG = {
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "qwen2.5:7b",
  temperature: 0.7,
  maxTokens: 500,
  timeoutMs: 30000
};

export async function loadAiConfig() {
  const configPath = path.join(configDir, "ai.json");
  try {
    const config = await readJson(configPath);
    return { ...DEFAULT_AI_CONFIG, ...config };
  } catch {
    console.error(`[ai] No ai.json found at ${configPath}, using defaults`);
    return { ...DEFAULT_AI_CONFIG };
  }
}

export async function loadAgentPersona(forumId) {
  // Per-forum override first
  if (forumId) {
    const forumAgentPath = path.join(configDir, "forums", `agent-${forumId}.md`);
    try {
      const content = await fs.readFile(forumAgentPath, "utf-8");
      return content.trim();
    } catch { /* fall through to global */ }
  }
  // Global agent.md fallback
  const globalAgentPath = path.join(configDir, "agent.md");
  try {
    const content = await fs.readFile(globalAgentPath, "utf-8");
    return content.trim();
  } catch {
    throw new Error(`No agent.md found at ${globalAgentPath}${forumId ? ` or ${path.join(configDir, "forums", `agent-${forumId}.md`)}` : ""}`);
  }
}

export async function generateReply(aiConfig, systemPrompt, userPrompt) {
  const url = `${aiConfig.baseUrl}/api/generate`;
  const body = {
    model: aiConfig.model,
    system: systemPrompt,
    prompt: userPrompt,
    stream: false,
    options: {
      temperature: aiConfig.temperature ?? 0.7,
      num_predict: aiConfig.maxTokens ?? 500
    }
  };

  const startMs = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(aiConfig.timeoutMs ?? 30000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const durationMs = Date.now() - startMs;

  const text = (data.response ?? "").trim();
  if (!text) {
    throw new Error("Ollama returned empty response");
  }

  return {
    text,
    model: data.model ?? aiConfig.model,
    durationMs,
    done: data.done ?? true
  };
}

export function buildConversationPrompt(chatLog, memberName, platformConfig) {
  const isTelegram = platformConfig?.platform === "telegram";
  const platformLabel = isTelegram
    ? "Telegram"
    : (platformConfig?.label ?? platformConfig?.id ?? "the forum");
  const platformContext = isTelegram
    ? `You are replying to a private chat on Telegram with ${memberName}.`
    : `You are replying to a private conversation on the forum "${platformLabel}" (${platformConfig?.baseUrl ?? ""}).\n\nThe other person in this conversation is: ${memberName}`;

  return `${platformContext}

--- CONVERSATION HISTORY ---
${chatLog}
---

Based on the conversation above and your persona instructions, write a short reply (2-4 sentences) in Vietnamese. Do not include any headers, labels, quotes, or markdown formatting — just the reply text itself.`;
}