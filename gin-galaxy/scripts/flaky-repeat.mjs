import { spawnSync } from "node:child_process";

const separatorIndex = process.argv.indexOf("--");
const runsFlagIndex = process.argv.indexOf("--runs");
const runs =
  runsFlagIndex >= 0 && process.argv[runsFlagIndex + 1]
    ? Number(process.argv[runsFlagIndex + 1])
    : Number(process.env.FLAKE_RUNS ?? 2);
const command = separatorIndex >= 0 ? process.argv.slice(separatorIndex + 1) : ["npm", "test"];

if (!Number.isInteger(runs) || runs < 1) {
  console.error("--runs must be a positive integer");
  process.exit(1);
}

if (command.length === 0) {
  console.error("Missing command after --");
  process.exit(1);
}

const failures = [];
for (let i = 1; i <= runs; i += 1) {
  console.log(`\nFlake signal run ${i}/${runs}: ${command.join(" ")}`);
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    failures.push({ run: i, status: result.status });
  }
}

if (failures.length > 0) {
  console.error(`\nFlake signal failed in ${failures.length}/${runs} runs.`);
  for (const failure of failures) {
    console.error(`- run ${failure.run}: exit ${failure.status}`);
  }
  process.exit(1);
}

console.log(`\nFlake signal passed ${runs}/${runs} runs.`);
