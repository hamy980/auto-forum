export async function setLocatorValue(locator, value) {
  const targetValue = String(value ?? "");
  const meta = await locator.evaluate((node) => ({
    isInput:
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement,
    isContentEditable: node instanceof HTMLElement && node.isContentEditable
  }));

  if (meta.isInput) {
    await locator.clear();
    await locator.fill(targetValue);
    await locator.evaluate((node) => {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return;
  }

  if (meta.isContentEditable) {
    await locator.click();
    await locator.press("Control+A");
    await locator.press("Backspace");
    await locator.evaluate((node, nextValue) => {
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
    }, targetValue);
    return;
  }

  await locator.evaluate((node, nextValue) => {
    if (node instanceof HTMLElement) {
      node.textContent = String(nextValue);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, targetValue);
}

export async function getLocatorValue(locator) {
  return locator.evaluate((node) => {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      return node.value;
    }
    if (node instanceof HTMLElement && node.isContentEditable) {
      return node.textContent ?? "";
    }
    return node.textContent ?? "";
  });
}

export async function collectNetworkDuring(page, task, filter) {
  const events = [];

  const onRequest = (request) => {
    if (filter(request.url(), request.resourceType())) {
      events.push({
        type: "request",
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        headers: request.headers(),
        postData: request.postData() ?? null
      });
    }
  };

  const onResponse = async (response) => {
    const request = response.request();
    if (!filter(request.url(), request.resourceType())) {
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

    events.push({
      type: "response",
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      status: response.status(),
      ok: response.ok(),
      headers: response.headers(),
      body
    });
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    await task();
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
  return events;
}
