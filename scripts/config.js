import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
export const userDataDir = path.resolve(__dirname, "../chrome-profile");
export const servicePort = 47831;
export const serviceHost = "127.0.0.1";
export const stateFile = path.resolve(__dirname, "../browser-service.json");
export const serviceLogFile = path.resolve(__dirname, "../browser-service.log");

