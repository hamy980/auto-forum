import path from "node:path";
import { fileURLToPath } from "node:url";

// Project root = chrome-profile (git repo root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const projectRoot = path.resolve(__dirname, "../../chrome-profile");

// All resource dirs are siblings of chrome-profile
export const configDir = path.join(projectRoot, "../config");
export const forumsDir = path.join(configDir, "forums");
export const platformsDir = path.join(configDir, "platforms");
export const campaignsDir = path.join(projectRoot, "../campaigns");
export const dataDir = path.join(projectRoot, "../data");
export const runtimeDir = path.join(projectRoot, "../runtime");