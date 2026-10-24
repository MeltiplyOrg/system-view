import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";

const budgets = {
  ".js": 30 * 1024,
  ".css": 10 * 1024,
  ".html": 2 * 1024,
} as const;
const totalBudget = 40 * 1024;

const files = readdirSync("dist", { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && extname(entry.name) in budgets)
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();

if (files.length === 0) {
  console.error("No build assets found in dist/. Run `bun run build` first.");
  process.exit(1);
}

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
