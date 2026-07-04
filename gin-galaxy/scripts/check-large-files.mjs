import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const maxBytes = Number(process.env.MAX_STAGED_FILE_BYTES ?? 5 * 1024 * 1024);
const ignoredSegments = ["/node_modules/", "/dist/", "/coverage/", "/.codex-test/"];
const ignoredNames = new Set(["package-lock.json"]);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const repoRoot = git(["rev-parse", "--show-toplevel"]);
const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
  .split(/\r?\n/)
  .filter(Boolean);

const oversized = staged.filter((relativePath) => {
  const normalized = relativePath.replaceAll("\\", "/");
  const normalizedWithLeadingSlash = `/${normalized}`;
  if (
    ignoredSegments.some((segment) => normalizedWithLeadingSlash.includes(segment)) ||
    ignoredNames.has(path.basename(normalized))
  ) {
    return false;
  }

  const absolutePath = path.join(repoRoot, relativePath);
  return existsSync(absolutePath) && statSync(absolutePath).size > maxBytes;
});

if (oversized.length > 0) {
  const limitMiB = (maxBytes / 1024 / 1024).toFixed(1);
  console.error(`Staged files exceed the ${limitMiB} MiB limit:`);
  for (const file of oversized) {
    const sizeMiB = (statSync(path.join(repoRoot, file)).size / 1024 / 1024).toFixed(1);
    console.error(`- ${file} (${sizeMiB} MiB)`);
  }
  process.exit(1);
}
