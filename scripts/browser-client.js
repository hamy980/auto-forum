import fs from "node:fs/promises";
import { serviceHost, servicePort, stateFile } from "./config.js";

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

async function printState() {
  const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
  console.log(JSON.stringify(state, null, 2));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "state":
      await printState();
      break;
    case "health":
      console.log(JSON.stringify(await request("GET", "/health"), null, 2));
      break;
    case "tabs":
      console.log(JSON.stringify(await request("GET", "/tabs"), null, 2));
      break;
    case "goto":
      if (!args[0]) {
        throw new Error("Usage: node scripts/browser-client.js goto <url> [--new-tab]");
      }
      console.log(
        JSON.stringify(
          await request("POST", "/goto", {
            url: args[0],
            newTab: args.includes("--new-tab")
          }),
          null,
          2
        )
      );
      break;
    case "activate":
      if (!args[0]) {
        throw new Error("Usage: node scripts/browser-client.js activate <tab-index>");
      }
      console.log(
        JSON.stringify(await request("POST", "/activate", { index: Number(args[0]) }), null, 2)
      );
      break;
    case "links":
      if (!args[0]) {
        throw new Error("Usage: node scripts/browser-client.js links <selector> [tab-index] [limit]");
      }
      console.log(
        JSON.stringify(
          await request("POST", "/links", {
            selector: args[0],
            index: args[1] ? Number(args[1]) : 0,
            limit: args[2] ? Number(args[2]) : 10
          }),
          null,
          2
        )
      );
      break;
    case "elements":
      if (!args[0]) {
        throw new Error(
          "Usage: node scripts/browser-client.js elements <selector> [tab-index] [limit]"
        );
      }
      console.log(
        JSON.stringify(
          await request("POST", "/elements", {
            selector: args[0],
            index: args[1] ? Number(args[1]) : 0,
            limit: args[2] ? Number(args[2]) : 20
          }),
          null,
          2
        )
      );
      break;
    case "click":
      if (!args[0]) {
        throw new Error("Usage: node scripts/browser-client.js click <selector> [tab-index] [nth]");
      }
      console.log(
        JSON.stringify(
          await request("POST", "/click", {
            selector: args[0],
            index: args[1] ? Number(args[1]) : 0,
            nth: args[2] ? Number(args[2]) : 0
          }),
          null,
          2
        )
      );
      break;
    case "fill":
      if (!args[0] || args[1] === undefined) {
        throw new Error(
          "Usage: node scripts/browser-client.js fill <selector> <value> [tab-index] [nth] [--no-clear]"
        );
      }
      console.log(
        JSON.stringify(
          await request("POST", "/fill", {
            selector: args[0],
            value: args[1],
            index: args[2] ? Number(args[2]) : 0,
            nth: args[3] ? Number(args[3]) : 0,
            clearFirst: !args.includes("--no-clear")
          }),
          null,
          2
        )
      );
      break;
    case "value":
      if (!args[0]) {
        throw new Error("Usage: node scripts/browser-client.js value <selector> [tab-index] [nth]");
      }
      console.log(
        JSON.stringify(
          await request("POST", "/value", {
            selector: args[0],
            index: args[1] ? Number(args[1]) : 0,
            nth: args[2] ? Number(args[2]) : 0
          }),
          null,
          2
        )
      );
      break;
    case "network-start":
      console.log(
        JSON.stringify(
          await request("POST", "/network/start", {
            pageIndex: args[0] ? Number(args[0]) : 0,
            urlIncludes: args[1] || null,
            resourceTypes: args[2] ? args[2].split(",") : ["document", "fetch", "xhr"]
          }),
          null,
          2
        )
      );
      break;
    case "network-stop":
      console.log(JSON.stringify(await request("POST", "/network/stop"), null, 2));
      break;
    case "network-clear":
      console.log(JSON.stringify(await request("POST", "/network/clear"), null, 2));
      break;
    case "network-events": {
      const limit = args[0] ? `?limit=${Number(args[0])}` : "";
      console.log(JSON.stringify(await request("GET", `/network/events${limit}`), null, 2));
      break;
    }
    case "stop":
      console.log(JSON.stringify(await request("POST", "/stop"), null, 2));
      break;
    default:
      throw new Error(
        "Usage: node scripts/browser-client.js <state|health|tabs|goto|activate|links|elements|click|fill|value|network-start|network-stop|network-clear|network-events|stop> ..."
      );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
