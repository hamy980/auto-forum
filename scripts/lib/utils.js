import fs from "node:fs/promises";
import path from "node:path";

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function resolveMaybeRelative(baseDir, targetPath) {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomInt(min, max) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

export function pickOne(values, seedIndex = 0) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Expected a non-empty array");
  }
  return values[seedIndex % values.length];
}

export function resolveSpin(text) {
  const spinRegex = /\{([^{}]*\|[^{}]*)\}/g;
  let result = text;
  let prev;
  do {
    prev = result;
    result = result.replace(spinRegex, (_, options) => {
      const parts = options.split("|");
      return parts[Math.floor(Math.random() * parts.length)];
    });
  } while (result !== prev);
  return result;
}

export function fillTemplate(template, context) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
    context[key] === undefined || context[key] === null ? "" : String(context[key])
  );
}

export function plusEncodeRecipient(recipient) {
  return recipient.trim().replace(/\s+/g, "+");
}

export function normalizeRecipientForForum(recipient, mode) {
  if (mode === "xenforo-plus") {
    return plusEncodeRecipient(recipient);
  }
  if (mode === "url-encode") {
    return encodeURIComponent(recipient.trim());
  }
  return recipient.trim();
}

export function parseFirstName(recipient) {
  const normalized = recipient.trim().replace(/\+/g, " ");
  return normalized.split(/\s+/)[0] ?? normalized;
}
