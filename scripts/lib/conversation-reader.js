export async function readConversationMessages(page, forumConfig) {
  const convConfig = forumConfig.conversation ?? {};
  const msgSelector = convConfig.messageBlock ?? ".message";
  const authorSelector = convConfig.messageAuthor ?? ".message-name a";
  const bodySelector = convConfig.messageBody ?? ".message-body .bbWrapper";
  const timeSelector = convConfig.messageTime ?? "time[data-time]";

  const count = await page.locator(msgSelector).count();
  const messages = [];
  for (let i = 0; i < count; i += 1) {
    const msg = page.locator(msgSelector).nth(i);
    const author = await msg.locator(authorSelector).first().textContent().catch(() => "").then(s => s.trim());
    const body = await msg.locator(bodySelector).first().textContent().catch(() => "").then(s => s.trim());
    const timeEl = msg.locator(timeSelector).first();
    const dataTime = await timeEl.getAttribute("data-time").catch(() => null);
    messages.push({ author, body, dataTime: dataTime ? Number(dataTime) : 0 });
  }
  return messages;
}

export function formatTimestamp(unixMs) {
  if (!unixMs) return new Date().toISOString().slice(0, 16).replace("T", " ");
  const d = new Date(Number(unixMs) * 1000);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export function buildMdContent(messages, profileName) {
  const lines = [];
  for (const msg of messages) {
    const author = msg.author?.trim() || "unknown";
    const label = author === profileName ? "me" : author;
    const time = formatTimestamp(msg.dataTime);
    const body = msg.body?.trim() || "(empty)";
    lines.push(`## ${label} (${time})\n${body}\n`);
  }
  return lines.join("\n");
}

export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      data[key] = val === "null" ? null : val;
    }
  }
  return data;
}

export function buildMdFrontmatter(fields) {
  const lines = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v ?? "null"}`)
    .join("\n");
  return `---\n${lines}\n---\n`;
}