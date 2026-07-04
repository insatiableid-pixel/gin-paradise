import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const objective =
  process.env.GOAL_OBJECTIVE || process.argv.slice(2).join(" ") || "Advance Gin Paradise readiness";
const generatedAt = new Date().toISOString();
const reportsDir = path.join(process.cwd(), "reports");

const lanes = [
  {
    lane: "Quality",
    trigger: "tests, flake, coverage, lint, duplicate code",
    nextActions: [
      "Run CI and quality-loop workflows.",
      "Convert repeated lint warnings into tracked cleanup issues.",
      "Raise coverage thresholds only after high-risk paths are covered.",
    ],
    verification: ["npm run ci", "npm run test:flaky"],
  },
  {
    lane: "Security",
    trigger: "secrets, dependencies, code scanning, auth boundaries",
    nextActions: [
      "Review CodeQL and dependency-review findings.",
      "Enable repository secret scanning if plan settings allow it.",
      "Keep npm audit at zero low-or-higher vulnerabilities.",
    ],
    verification: ["npm run security:audit", "npm run security:secrets"],
  },
  {
    lane: "Operations",
    trigger: "deployment, rollback, observability, incidents",
    nextActions: [
      "Wire /api/metrics and JSON logs into the deployment platform.",
      "Record deployment frequency and rollback duration.",
      "Keep runbook steps aligned with the deployed environment.",
    ],
    verification: ["GET /api/health", "GET /api/metrics"],
  },
  {
    lane: "Product and UX",
    trigger: "browser smoke failures, route regressions, user workflows",
    nextActions: [
      "Expand Playwright smoke tests around login, wallet, multiplayer, and replay flows.",
      "Add visual checks for high-risk responsive screens.",
      "Tie failing user journeys to focused issues.",
    ],
    verification: ["npm run test:e2e"],
  },
  {
    lane: "Architecture",
    trigger: "large modules, complexity warnings, shared contracts",
    nextActions: [
      "Split highest-complexity handlers behind typed boundaries.",
      "Promote repeated route patterns to shared middleware.",
      "Document cross-service contracts in AGENTS.md and runbooks.",
    ],
    verification: ["npm run lint", "npm run quality:dead-code"],
  },
];

const plan = {
  generatedAt,
  objective,
  parallelizable: true,
  lanes,
  completionRule:
    "All blocking CI jobs pass, scheduled readiness issue is updated, and any external blockers are explicitly assigned.",
};

mkdirSync(reportsDir, { recursive: true });
writeFileSync(path.join(reportsDir, "agent-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

const markdown = [
  "# Agent Decomposition Plan",
  "",
  `Generated: ${generatedAt}`,
  `Objective: ${objective}`,
  "",
  "## Parallel Lanes",
  "",
  ...lanes.flatMap((lane) => [
    `### ${lane.lane}`,
    "",
    `Trigger: ${lane.trigger}`,
    "",
    "Next actions:",
    ...lane.nextActions.map((action) => `- ${action}`),
    "",
    "Verification:",
    ...lane.verification.map((command) => `- \`${command}\``),
    "",
  ]),
  "## Completion Rule",
  "",
  plan.completionRule,
  "",
].join("\n");

writeFileSync(path.join(reportsDir, "agent-plan.md"), markdown);
console.log(`Agent decomposition written for objective: ${objective}`);
