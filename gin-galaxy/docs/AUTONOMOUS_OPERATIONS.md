# Autonomous Operations

This repo uses a repo-controlled Level 5 loop:

1. CI validates security, typing, linting, tests, build output, bundle budgets, and readiness evidence.
2. Scheduled quality loops repeat the test suite and collect dead-code and duplicate-code signals.
3. The autonomous readiness workflow audits current controls and updates a standing GitHub issue with the next parallel work lanes.
4. Goal decomposition writes `reports/agent-plan.md` so independent agents can split work by quality, security, operations, product, and architecture.

## Evidence Surfaces

- `npm run ci`
- `npm run test:e2e`
- `npm run test:flaky`
- `npm run quality:readiness`
- `npm run agent:decompose`
- GitHub Actions: CI, CodeQL, Dependency Review, Quality Loops, Autonomous Readiness, Release

## External Requirements

The repository can generate readiness evidence, but full Level 5 operation also requires platform settings:

- Enable GitHub code scanning, secret scanning, and branch protection where the plan supports it.
- Connect `/api/metrics`, JSON logs, `x-request-id`, and `traceparent` to the production observability stack.
- Track deployment frequency, rollback time, and failed-change rate from the deployment platform.
- Require human review before autonomous issue plans become merged code.
