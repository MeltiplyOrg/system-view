/**
 * CI bundle-budget gate.
 *
 * Runs after `vp build`. Gzip size approximates first-load transfer better
 * than raw bytes, so every emitted JS/CSS/HTML asset is compressed and checked
 * against a per-type and total budget. Budgets include deliberate headroom;
 * tighten them when the product scope is stable rather than on every change.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Maximum gzipped bytes per emitted asset type.
 *
 * Includes artwork, assembly controls, visible traffic, queued capacity,
 * rolling SLO/crash HUD, inline wire insertion and cache coverage. The build
 * measures about 80 KiB JS gzip / 89 KiB total; 81 / 89 KiB bounds transfer.
 * No SDKs, codecs or model copies are loaded. The 512-call runtime ceiling,
 * shared raster pixel budget and single-encoder limit remain independent.
 */
const budgets = {
  ".js": 81 * 1024,
  ".css": 10 * 1024,
  ".html": 2 * 1024,
} as const;

/** Maximum gzipped bytes for the whole build. */
const totalBudget = 89 * 1024;

// Dist is flat today, but recursive discovery keeps the gate valid if assets
// move into nested chunks. Unknown file types are intentionally ignored.
const files = readdirSync("dist", { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && extname(entry.name) in budgets)
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();

if (files.length === 0) {
  console.error("No build assets found in dist/. Run `bun run build` first.");
  process.exit(1);
}

// Collect all violations so one CI run reports every over-budget asset.
const failures: string[] = [];
let totalGzip = 0;
console.log("\nBundle budgets (gzip)");
for (const file of files) {
  const bytes = gzipSync(readFileSync(file)).byteLength;
  totalGzip += bytes;
  const budget = budgets[extname(file) as keyof typeof budgets];
  const status = bytes > budget ? "FAIL" : "ok";
  if (bytes > budget) failures.push(`${file}: ${bytes}B > ${budget}B`);
  console.log(
    `${status.padEnd(4)} ${file.padEnd(45)} ${(bytes / 1024).toFixed(2).padStart(7)} KiB / ${(budget / 1024).toFixed(0)} KiB`,
  );
}
console.log(
  `${totalGzip <= totalBudget ? "ok" : "FAIL"}   ${"TOTAL".padEnd(45)} ${(totalGzip / 1024).toFixed(2).padStart(7)} KiB / ${(totalBudget / 1024).toFixed(0)} KiB`,
);
if (totalGzip > totalBudget)
  failures.push(`total: ${totalGzip}B > ${totalBudget}B`);

if (failures.length > 0) {
  console.error(`\nBundle budget exceeded:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nBundle budgets passed.");
