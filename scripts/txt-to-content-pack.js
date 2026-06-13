import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./lib/paths.js";

function parseAdsTxt(raw) {
  const blocks = raw
    .split(/^---\s*$/gm)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks.map((block, idx) => {
    const lines = block.split(/\r?\n/);
    let title = `Mẫu ${idx + 1}`;
    const bodyLines = [];

    for (const line of lines) {
      const headerMatch = line.match(/^###\s+(.+?)\s*$/);
      if (headerMatch) {
        title = headerMatch[1].trim();
        continue;
      }
      bodyLines.push(line);
    }

    let body = bodyLines.join("\n").trim();
    body = body.replace(/^\n+|\n+$/g, "");

    return { title, body };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: node scripts/txt-to-content-pack.js <input.txt> [output.json]");
    process.exit(1);
  }

  const inputPath = path.isAbsolute(args[0])
    ? args[0]
    : path.resolve(dataDir, args[0]);
  const outputPath = args[1]
    ? path.isAbsolute(args[1])
      ? args[1]
      : path.resolve(dataDir, args[1])
    : inputPath.replace(/\.txt$/i, ".json");

  const raw = await fs.readFile(inputPath, "utf8");
  const contents = parseAdsTxt(raw);

  const pack = { contents };
  await fs.writeFile(outputPath, JSON.stringify(pack, null, 2) + "\n", "utf8");

  console.log(`Parsed ${contents.length} blocks from ${path.basename(inputPath)}`);
  console.log(`Wrote ${outputPath}`);
  contents.forEach((c, i) => {
    const preview = c.body.replace(/\n/g, " ").slice(0, 60);
    console.log(`  [${i + 1}] ${c.title} — ${preview}...`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
