import { spawn } from "node:child_process";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { serviceHost, serviceLogFile, servicePort } from "./config.js";

const targetUrl = "https://clubvn.net";
const versionUrl = "chrome://version/";

async function request(method, pathname, body) {
  const response = await fetch(`http://${serviceHost}:${servicePort}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`);
  }
  return payload;
}

async function isServiceReady() {
  try {
    await request("GET", "/health");
    return true;
  } catch {
    return false;
  }
}

async function startServiceIfNeeded() {
  if (await isServiceReady()) {
    console.log("Browser service is already running.");
    return;
  }

  console.log("Starting browser service...");
  const logFd = fs.openSync(serviceLogFile, "a");
  const child = spawn(process.execPath, ["scripts/browser-service.js"], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(500);
    if (await isServiceReady()) {
      console.log("Browser service is ready.");
      return;
    }
  }

  throw new Error(
    `Browser service did not become ready. Check logs or rerun manually. Expected log file: ${serviceLogFile}`
  );
}

async function main() {
  await startServiceIfNeeded();

  const clubvnResult = await request("POST", "/goto", {
    url: targetUrl
  });
  console.log(`Opened ${clubvnResult.url}`);
  console.log(`Title: ${clubvnResult.title}`);

  await request("POST", "/goto", {
    url: versionUrl,
    newTab: true,
    waitUntil: "load",
    timeout: 30000
  });
  console.log(`Opened ${versionUrl} in a new tab`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
