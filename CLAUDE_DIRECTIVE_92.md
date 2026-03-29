# CLAUDE DIRECTIVE 92 - Expired-Lease Room Reclaim

## Goal
Make Redis-mode failover honest by letting a successor node reclaim a room after the ownership lease expires, and remove the last sticky-session wording from live handoff messages.

## Scope
- Treat rooms with an expired `ownerLeaseExpiresAt` as reclaimable instead of permanently remote-owned.
- Make `roomManager` actually claim ownership before serving an expired-lease room locally.
- Replace sticky-session wording in the handoff hint with relay/failover language.
- Add a live Redis integration test that proves a second coordinator can claim an expired lease.
- Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so they describe lease-aware failover recovery truthfully.

## Must-Haves
- A room whose owner lease has expired must be servable on the current node after a successful reclaim.
- The handoff message must not mention sticky sessions.
- Redis lease reclamation must be proven with two coordinators and a short TTL.
- Keep spectator relay, timer recovery, and clean shutdown ownership release intact.

## Verification
- `npm run lint`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Output
- Update `PROJECT_STATUS.md` with the new sprint summary.
- Update `gin-galaxy/DEPLOYMENT.md` to describe lease-aware failover recovery.
- Write `EXECUTION_REPORT_92.md` after implementation.
