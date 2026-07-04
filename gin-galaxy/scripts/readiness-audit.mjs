import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const targetFlagIndex = process.argv.indexOf("--target");
const targetLevel =
  targetFlagIndex >= 0 && process.argv[targetFlagIndex + 1]
    ? Number(process.argv[targetFlagIndex + 1])
    : 5;
const root = process.cwd();
const reportsDir = path.join(root, "reports");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function hasFile(relativePath) {
  return (
    existsSync(path.resolve(root, "..", relativePath)) ||
    existsSync(path.resolve(root, relativePath))
  );
}

function hasScript(name) {
  return Boolean(packageJson.scripts?.[name]);
}

const checks = [
  ["README", hasFile("README.md") || hasFile("gin-galaxy/README.md"), 1],
  ["lint script", hasScript("lint"), 1],
  [
    "strict typecheck",
    hasScript("typecheck") &&
      readFileSync(path.join(root, "tsconfig.json"), "utf8").includes('"strict": true'),
    1,
  ],
  ["unit tests", hasScript("test"), 1],
  ["AGENTS.md", hasFile("AGENTS.md"), 2],
  ["pre-commit hook", hasFile(".husky/pre-commit"), 2],
  ["devcontainer", hasFile(".devcontainer/devcontainer.json"), 2],
  ["CI workflow", hasFile(".github/workflows/ci.yml"), 2],
  ["integration browser smoke", hasScript("test:e2e") && hasFile("e2e/smoke.spec.ts"), 3],
  ["secret scan", hasScript("security:secrets"), 3],
  ["code scanning workflow", hasFile(".github/workflows/codeql.yml"), 3],
  ["metrics endpoint", hasFile("server/observability.ts"), 3],
  [
    "distributed trace context",
    readFileSync(path.join(root, "server", "observability.ts"), "utf8").includes("traceparent"),
    3,
  ],
  ["bundle budget", hasScript("quality:bundle") && hasFile("quality/bundle-budget.json"), 4],
  ["flaky test loop", hasScript("test:flaky") && hasFile(".github/workflows/quality-loops.yml"), 4],
  ["release automation", hasFile(".github/workflows/release.yml"), 4],
  ["self-improvement workflow", hasFile(".github/workflows/autonomous-readiness.yml"), 5],
  ["goal decomposition", hasScript("agent:decompose") && hasFile("scripts/decompose-goal.mjs"), 5],
];

const passed = checks.filter(([, pass]) => pass);
const highestLevel = [1, 2, 3, 4, 5].reduce((level, candidate) => {
  const candidateChecks = checks.filter(([, , checkLevel]) => checkLevel <= candidate);
  return candidateChecks.every(([, pass]) => pass) ? candidate : level;
}, 0);

mkdirSync(reportsDir, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  targetLevel,
  highestLevel,
  score: {
    passed: passed.length,
    total: checks.length,
    percent: Number(((passed.length / checks.length) * 100).toFixed(1)),
  },
  checks: checks.map(([name, pass, level]) => ({ name, pass, level })),
  externalBlockers: [
    "Production deployment frequency and rollback metrics require a connected deployment platform.",
    "GitHub secret scanning and branch protection require repository settings access and plan support.",
    "Self-improvement output should be reviewed by maintainers before autonomous changes are merged.",
  ],
};

const markdown = [
  "# Readiness Audit",
  "",
  `Generated: ${report.generatedAt}`,
  `Target level: ${targetLevel}`,
  `Repo-controlled level: ${highestLevel}`,
  `Score: ${report.score.passed}/${report.score.total} (${report.score.percent}%)`,
  "",
  "## Checks",
  "",
  ...report.checks.map((check) => `- ${check.pass ? "[x]" : "[ ]"} L${check.level} ${check.name}`),
  "",
  "## External Blockers",
  "",
  ...report.externalBlockers.map((blocker) => `- ${blocker}`),
  "",
].join("\n");

writeFileSync(
  path.join(reportsDir, "readiness-audit.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
writeFileSync(path.join(reportsDir, "readiness-audit.md"), markdown);

console.log(
  `Readiness audit: repo-controlled level ${highestLevel}, score ${report.score.percent}%.`,
);

if (highestLevel < Math.min(targetLevel, 5)) {
  console.log("Repo-controlled checks are below target; see reports/readiness-audit.md.");
}
