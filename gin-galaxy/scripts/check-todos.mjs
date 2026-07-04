import { execFileSync } from "node:child_process";

const targets = ["src", "server", "tests"];
const pattern = "\\b(TODO|FIXME|HACK)\\b";

try {
  const output = execFileSync("rg", ["--line-number", "--hidden", pattern, ...targets], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  if (output) {
    console.log(output);
  }
} catch (error) {
  if (error.status === 1) {
    console.log("No TODO/FIXME/HACK markers found.");
    process.exit(0);
  }
  throw error;
}
