# Directive 106 - Endurance Soak Sprint

## Objective
Add a heavier bounded Redis app-process endurance-soak lane that proves repeated seeded multi-room failover cycles across both nodes, and harden the existing app-failover proofs so they assert durable recovery truth instead of brittle websocket ordering.

## Why This Sprint
Directive 105 widened the deterministic recovery matrix, but the next highest-leverage move was to push the app-process proof into a longer bounded soak path. Gin Paradise already had app soak and seeded fault-matrix coverage; what it still lacked was a dedicated heavier endurance lane that repeatedly alternates ownership across several live rooms and then holds up inside the full Redis suite. This sprint is about confidence-building, not pretending we have already reached unbounded production chaos.

## Required Deliverables
1. Add a new two-process Redis endurance-soak suite that:
   - creates multiple seeded live rooms across both nodes,
   - mixes local-owner and split-node topologies,
   - varies pre-advanced turn depth, and
   - survives repeated alternating owner-loss cycles while gameplay keeps moving.
2. Wire that new lane into `npm run test:redis`.
3. Add a dedicated `npm run test:redis:soak` command for the bounded heavier soak path.
4. Harden any existing app-failover proofs that fail under the heavier cumulative Redis lane because they rely on overly strict websocket ordering instead of durable recovery state.
5. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so the repo now describes bounded endurance-soak proof honestly while keeping the remaining production-scale soak / long-running chaos gap explicit.
6. Add `EXECUTION_REPORT_106.md` describing what changed and how it was verified.

## Constraints
- Keep the endurance soak deterministic and CI-stable.
- Do not over-claim production-scale certification.
- Preserve the already-green Redis integration, failover, churn, restart-soak, load, smoke, app-failover, app-soak, seeded fault-matrix, and chaos lanes.
- Prefer durable coordinator and room-state signals over brittle notification-order assumptions.

## Verification
Run, at minimum:
- `npm run lint`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis:soak`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Completion Criteria
The sprint is complete when the repo has a heavier bounded endurance-soak lane integrated into the Redis verification path, the app-failover proofs stay green under the full Redis suite, and the docs/report describe the stronger bounded confidence without overstating the remaining scale gap.
