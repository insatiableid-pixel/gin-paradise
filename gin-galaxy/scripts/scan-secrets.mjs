import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const excluded = [
  /^node_modules\//,
  /^dist\//,
  /^coverage\//,
  /^playwright-report\//,
  /^test-results\//,
  /^reports\//,
  /^package-lock\.json$/,
];

const patterns = [
  { name: "GitHub token", regex: /gh[pousr]_[A-Za-z0-9_]{30,}/g },
  { name: "Google API key", regex: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "Stripe live secret", regex: /sk_live_[0-9A-Za-z]{20,}/g },
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "Private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    name: "Generic secret assignment",
    regex: /\b(?:secret|token|password|api[_-]?key)\b\s*[:=]\s*["']([A-Za-z0-9_./+=-]{24,})["']/gi,
  },
];

const allowedValues = new Set(["your-gemini-api-key-here", "replace-me", "example", "changeme"]);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const repoRoot = git(["rev-parse", "--show-toplevel"]);
const files = execFileSync(
  "git",
  ["-C", repoRoot, "ls-files", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !excluded.some((regex) => regex.test(file.replaceAll("\\", "/"))));

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(path.join(repoRoot, file), "utf8");
  } catch {
    continue;
  }

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern.regex)) {
      const value = match[1] ?? match[0];
      if (allowedValues.has(value.toLowerCase())) continue;
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      findings.push({ file, line, name: pattern.name });
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.name}`);
  }
  process.exit(1);
}

console.log(`Secret scan passed across ${files.length} files.`);
