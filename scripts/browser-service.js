import { chromium } from "playwright";
import fs from "node:fs/promises";
import http from "node:http";
import { chromePath, serviceHost, servicePort, stateFile, userDataDir } from "./config.js";

let context;
let server;
let requestSequence = 0;
let captureState = {
  enabled: false,
  pageIndex: null,
  urlIncludes: null,
  resourceTypes: [],
  startedAt: null,
  events: []
};

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

async function writeState() {
  const payload = {
    pid: process.pid,
    host: serviceHost,
    port: servicePort,
    chromePath,
    userDataDir,
    startedAt: new Date().toISOString()
  };
  await fs.writeFile(stateFile, JSON.stringify(payload, null, 2));
}

async function removeState() {
  try {
    await fs.unlink(stateFile);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function attachPageListeners(page) {
  page.on("console", (msg) => {
    log(`[browser:${msg.type()}] ${msg.text()}`);
  });

  page.on("pageerror", (error) => {
    log(`[pageerror] ${error.message}`);
  });
}

function getPageIndex(page) {
  return context.pages().indexOf(page);
}

function matchesCapture(page, request) {
  if (!captureState.enabled) {
    return false;
  }

  const pageIndex = getPageIndex(page);
  if (captureState.pageIndex !== null && pageIndex !== captureState.pageIndex) {
    return false;
  }

  if (captureState.urlIncludes && !request.url().includes(captureState.urlIncludes)) {
    return false;
  }

  if (
    captureState.resourceTypes.length > 0 &&
    !captureState.resourceTypes.includes(request.resourceType())
  ) {
    return false;
  }

  return true;
}

function sanitizeHeaders(headers) {
  const allowed = [
    "content-type",
    "x-requested-with",
    "referer",
    "origin",
    "cookie"
  ];
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => allowed.includes(key.toLowerCase()))
  );
}

function attachNetworkListeners(page) {
  page.on("request", async (request) => {
    if (!matchesCapture(page, request)) {
      return;
    }

    const entry = {
      id: ++requestSequence,
      type: "request",
      pageIndex: getPageIndex(page),
      frameUrl: page.url(),
      resourceType: request.resourceType(),
      method: request.method(),
      url: request.url(),
      headers: sanitizeHeaders(request.headers()),
      postData: request.postData() ?? null,
      timestamp: new Date().toISOString()
    };
    captureState.events.push(entry);
  });

  page.on("response", async (response) => {
    const request = response.request();
    if (!matchesCapture(page, request)) {
      return;
    }

    let body = null;
    try {
      const contentType = response.headers()["content-type"] ?? "";
      if (
        contentType.includes("application/json") ||
        contentType.includes("text/plain") ||
        contentType.includes("text/html")
      ) {
        body = await response.text();
        if (body.length > 4000) {
          body = `${body.slice(0, 4000)}... [truncated]`;
        }
      }
    } catch {
      body = null;
    }

    const entry = {
      id: ++requestSequence,
      type: "response",
      pageIndex: getPageIndex(page),
      frameUrl: page.url(),
      resourceType: request.resourceType(),
      method: request.method(),
      url: request.url(),
      status: response.status(),
      ok: response.ok(),
      headers: sanitizeHeaders(response.headers()),
      body,
      timestamp: new Date().toISOString()
    };
    captureState.events.push(entry);
  });
}

async function getTabs() {
  return Promise.all(
    context.pages().map(async (page, index) => ({
      index,
      url: page.url(),
      title: await page.title().catch(() => "")
    }))
  );
}

async function ensurePage(newTab = false) {
  if (newTab || context.pages().length === 0) {
    const page = await context.newPage();
    attachPageListeners(page);
    return page;
  }
  return context.pages()[0];
}

function getPageByIndex(index) {
  const resolvedIndex = Number.isFinite(index) ? index : 0;
  return context.pages()[resolvedIndex];
}

async function readLocatorValue(locator) {
  return locator.evaluate((node) => {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      return {
        kind: "form-control",
        value: node.value,
        text: node.value,
        html: null
      };
    }

    if (node instanceof HTMLElement && node.isContentEditable) {
      return {
        kind: "contenteditable",
        value: node.textContent ?? "",
        text: node.textContent ?? "",
        html: node.innerHTML
      };
    }

    return {
      kind: "text",
      value: node.textContent ?? "",
      text: node.textContent ?? "",
      html: node instanceof HTMLElement ? node.innerHTML : null
    };
  });
}

async function setLocatorValue(locator, value, clearFirst = true) {
  const targetValue = String(value ?? "");
  const meta = await locator.evaluate((node) => ({
    tagName: node.tagName.toLowerCase(),
    isContentEditable: node instanceof HTMLElement && node.isContentEditable,
    isInput:
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement
  }));

  if (meta.isInput) {
    if (clearFirst) {
      await locator.clear();
    }
    await locator.fill(targetValue);
    await locator.evaluate((node) => {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return readLocatorValue(locator);
  }

  if (meta.isContentEditable) {
    await locator.click({ timeout: 15000 });
    if (clearFirst) {
      await locator.press("Control+A");
      await locator.press("Backspace");
    }
    await locator.evaluate(
      (node, nextValue) => {
        node.focus();
        if (node instanceof HTMLElement) {
          node.innerHTML = "";
          const lines = String(nextValue).split(/\r?\n/);
          for (const [index, line] of lines.entries()) {
            if (index > 0) {
              node.appendChild(document.createElement("br"));
            }
            node.appendChild(document.createTextNode(line));
          }
          node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
        }
      },
      targetValue
    );
    return readLocatorValue(locator);
  }

  if (clearFirst) {
    await locator.evaluate((node) => {
      if (node instanceof HTMLElement) {
        node.textContent = "";
      }
    });
  }
  await locator.evaluate((node, nextValue) => {
    if (node instanceof HTMLElement) {
      node.textContent = String(nextValue);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, targetValue);
  return readLocatorValue(locator);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function getCaptureSnapshot(limit = null) {
  const events = limit === null ? captureState.events : captureState.events.slice(-limit);
  return {
    enabled: captureState.enabled,
    pageIndex: captureState.pageIndex,
    urlIncludes: captureState.urlIncludes,
    resourceTypes: captureState.resourceTypes,
    startedAt: captureState.startedAt,
    totalEvents: captureState.events.length,
    events
  };
}

async function handleRequest(req, res) {
  try {
    const requestUrl = new URL(req.url, `http://${serviceHost}:${servicePort}`);

    if (req.method === "GET" && requestUrl.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        chromePath,
        userDataDir,
        tabs: await getTabs()
      });
    }

    if (req.method === "GET" && requestUrl.pathname === "/tabs") {
      return sendJson(res, 200, { ok: true, tabs: await getTabs() });
    }

    if (req.method === "POST" && requestUrl.pathname === "/goto") {
      const body = await readJson(req);
      if (!body.url) {
        return sendJson(res, 400, { ok: false, error: "Missing url" });
      }

      const page = await ensurePage(Boolean(body.newTab));
      await page.goto(body.url, {
        waitUntil: body.waitUntil ?? "domcontentloaded",
        timeout: body.timeout ?? 60000
      });
      await page.bringToFront();

      return sendJson(res, 200, {
        ok: true,
        url: page.url(),
        title: await page.title(),
        tabs: await getTabs()
      });
    }

    if (req.method === "POST" && requestUrl.pathname === "/activate") {
      const body = await readJson(req);
      const index = Number(body.index);
      const page = getPageByIndex(index);
      if (!page) {
        return sendJson(res, 404, { ok: false, error: `Tab index ${body.index} not found` });
      }
      await page.bringToFront();
      return sendJson(res, 200, {
        ok: true,
        index,
        url: page.url(),
        title: await page.title()
      });
    }

    if (req.method === "POST" && requestUrl.pathname === "/links") {
      const body = await readJson(req);
      if (!body.selector) {
        return sendJson(res, 400, { ok: false, error: "Missing selector" });
      }

      const page = getPageByIndex(Number(body.index));
      if (!page) {
        return sendJson(res, 404, { ok: false, error: `Tab index ${body.index ?? 0} not found` });
      }

      const links = await page.locator(body.selector).evaluateAll((nodes, limit) =>
        nodes.slice(0, limit).map((node, index) => {
          const href = node instanceof HTMLAnchorElement ? node.href : node.closest("a")?.href ?? "";
          return {
            index,
            text: node.textContent?.trim() ?? "",
            href
          };
        }),
      body.limit ?? 10);

      return sendJson(res, 200, { ok: true, links });
    }

    if (req.method === "POST" && requestUrl.pathname === "/elements") {
      const body = await readJson(req);
      if (!body.selector) {
        return sendJson(res, 400, { ok: false, error: "Missing selector" });
      }

      const page = getPageByIndex(Number(body.index));
      if (!page) {
        return sendJson(res, 404, { ok: false, error: `Tab index ${body.index ?? 0} not found` });
      }

      const elements = await page.locator(body.selector).evaluateAll((nodes, limit) =>
        nodes.slice(0, limit).map((node, index) => ({
          index,
          tagName: node.tagName.toLowerCase(),
          id: node.id || "",
          name: node.getAttribute("name") || "",
          type: node.getAttribute("type") || "",
          href: node.getAttribute("href") || "",
          text: node.textContent?.trim() || "",
          placeholder: node.getAttribute("placeholder") || "",
          value: "value" in node ? node.value ?? "" : ""
        })),
      body.limit ?? 20);

      return sendJson(res, 200, { ok: true, elements });
    }

    if (req.method === "POST" && requestUrl.pathname === "/click") {
      const body = await readJson(req);
      if (!body.selector) {
        return sendJson(res, 400, { ok: false, error: "Missing selector" });
      }

      const page = getPageByIndex(Number(body.index));
      if (!page) {
        return sendJson(res, 404, { ok: false, error: `Tab index ${body.index ?? 0} not found` });
      }

      const locator = page.locator(body.selector);
      const target = locator.nth(Number(body.nth ?? 0));
      await target.waitFor({
        state: body.waitFor ?? "visible",
        timeout: body.timeout ?? 15000
      });
      await target.scrollIntoViewIfNeeded();
      await target.click({
        button: body.button ?? "left",
        timeout: body.timeout ?? 15000
      });
      await page.waitForLoadState(body.loadState ?? "domcontentloaded", {
        timeout: body.timeout ?? 15000
      }).catch(() => {});
      await page.bringToFront();

      return sendJson(res, 200, {
        ok: true,
        url: page.url(),
        title: await page.title()
      });
    }

    if (req.method === "POST" && requestUrl.pathname === "/fill") {
      const body = await readJson(req);
      if (!body.selector) {
        return sendJson(res, 400, { ok: false, error: "Missing selector" });
      }

      const page = getPageByIndex(Number(body.index));
      if (!page) {
        return sendJson(res, 404, { ok: false, error: `Tab index ${body.index ?? 0} not found` });
      }

      const locator = page.locator(body.selector).nth(Number(body.nth ?? 0));
      await locator.waitFor({
        state: body.waitFor ?? "visible",
        timeout: body.timeout ?? 15000
      });
      await locator.scrollIntoViewIfNeeded();
      const result = await setLocatorValue(locator, body.value, body.clearFirst !== false);
      await page.bringToFront();

      return sendJson(res, 200, {
        ok: true,
        selector: body.selector,
        value: String(body.value ?? ""),
        actualValue: result.value,
        actualText: result.text,
        actualHtml: result.html,
        url: page.url(),
        title: await page.title()
      });
    }

    if (req.method === "POST" && requestUrl.pathname === "/value") {
      const body = await readJson(req);
      if (!body.selector) {
        return sendJson(res, 400, { ok: false, error: "Missing selector" });
      }

      const page = getPageByIndex(Number(body.index));
      if (!page) {
        return sendJson(res, 404, { ok: false, error: `Tab index ${body.index ?? 0} not found` });
      }

      const locator = page.locator(body.selector).nth(Number(body.nth ?? 0));
      await locator.waitFor({
        state: body.waitFor ?? "attached",
        timeout: body.timeout ?? 15000
      });
      const result = await readLocatorValue(locator);

      return sendJson(res, 200, {
        ok: true,
        selector: body.selector,
        ...result,
        url: page.url(),
        title: await page.title()
      });
    }

    if (req.method === "POST" && requestUrl.pathname === "/network/start") {
      const body = await readJson(req);
      captureState.enabled = true;
      captureState.pageIndex =
        body.pageIndex === null || body.pageIndex === undefined ? null : Number(body.pageIndex);
      captureState.urlIncludes = body.urlIncludes ?? null;
      captureState.resourceTypes = Array.isArray(body.resourceTypes) ? body.resourceTypes : [];
      captureState.startedAt = new Date().toISOString();
      captureState.events = [];

      return sendJson(res, 200, { ok: true, capture: getCaptureSnapshot() });
    }

    if (req.method === "POST" && requestUrl.pathname === "/network/stop") {
      captureState.enabled = false;
      return sendJson(res, 200, { ok: true, capture: getCaptureSnapshot() });
    }

    if (req.method === "POST" && requestUrl.pathname === "/network/clear") {
      captureState.events = [];
      captureState.startedAt = captureState.enabled ? new Date().toISOString() : null;
      return sendJson(res, 200, { ok: true, capture: getCaptureSnapshot() });
    }

    if (req.method === "GET" && requestUrl.pathname === "/network/events") {
      const limit = requestUrl.searchParams.get("limit");
      return sendJson(res, 200, {
        ok: true,
        capture: getCaptureSnapshot(limit ? Number(limit) : null)
      });
    }

    if (req.method === "POST" && requestUrl.pathname === "/stop") {
      sendJson(res, 200, { ok: true, message: "Stopping browser service" });
      setTimeout(() => {
        shutdown(0).catch((error) => {
          console.error(error);
          process.exit(1);
        });
      }, 50);
      return;
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function shutdown(exitCode = 0) {
  log("Shutting down browser service");
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (context) {
    await context.close();
  }
  await removeState();
  process.exit(exitCode);
}

async function main() {
  log(`Launching Chrome: ${chromePath}`);
  log(`Persistent profile: ${userDataDir}`);

  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: false
  });

  for (const page of context.pages()) {
    attachPageListeners(page);
    attachNetworkListeners(page);
  }

  context.on("page", (page) => {
    attachPageListeners(page);
    attachNetworkListeners(page);
  });

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendJson(res, 500, { ok: false, error: error.message });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(servicePort, serviceHost, resolve);
  });

  await writeState();
  log(`Browser service listening on http://${serviceHost}:${servicePort}`);
}

process.on("SIGINT", () => {
  shutdown(0).catch((error) => {
    console.error(error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown(0).catch((error) => {
    console.error(error);
    process.exit(1);
  });
});

main().catch(async (error) => {
  console.error(error);
  await removeState();
  process.exit(1);
});
