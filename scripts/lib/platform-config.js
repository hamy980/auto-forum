import path from "node:path";
import { forumsDir, platformsDir } from "./paths.js";
import { readJson, sleep } from "./utils.js";

export async function loadPlatformConfig(configId) {
  const platformPath = path.join(platformsDir, `${configId}.json`);
  try {
    const config = await readJson(platformPath);
    if (config.platform) return config;
  } catch { /* not a platform config, try forums */ }

  const forumPath = path.join(forumsDir, `${configId}.json`);
  return readJson(forumPath);
}

export async function loadVerificationApiConfig() {
  const filePath = path.join(platformsDir, "verification-api.json");
  try {
    return await readJson(filePath);
  } catch {
    return {
      baseUrl: "http://127.0.0.1:5000",
      getCodeEndpoint: "/getcode/{phone}",
      headers: { Accept: "application/json" },
      responseCodePath: "message.code",
      timeoutMs: 30000,
      retryCount: 3,
      retryDelayMs: 5000
    };
  }
}

export function resolveJsonPath(obj, dotPath) {
  return dotPath.split(".").reduce((current, key) => current?.[key], obj);
}

export async function fetchVerificationCode(phone, apiConfig) {
  const endpoint = apiConfig.getCodeEndpoint.replace("{phone}", encodeURIComponent(phone));
  const url = `${apiConfig.baseUrl}${endpoint}`;

  for (let attempt = 0; attempt < apiConfig.retryCount; attempt++) {
    try {
      const response = await fetch(url, {
        headers: apiConfig.headers,
        signal: AbortSignal.timeout(apiConfig.timeoutMs)
      });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const data = await response.json();
      const code = resolveJsonPath(data, apiConfig.responseCodePath);
      if (code) return { status: "code_received", code: String(code) };
    } catch (err) {
      if (attempt < apiConfig.retryCount - 1) {
        await sleep(apiConfig.retryDelayMs);
        continue;
      }
      return { status: "code_not_received", error: err.message };
    }
  }
  return { status: "code_not_received", error: "Code not received after all retries" };
}