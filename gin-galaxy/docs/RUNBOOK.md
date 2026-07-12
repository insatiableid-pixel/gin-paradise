# Gin Paradise Runbook

## Runtime Checks

- Health: `GET /api/health`
- Metrics: `GET /api/metrics`
- Logs: structured JSON on stdout/stderr. Use `LOG_LEVEL=debug|info|warn|error` to tune verbosity.
- Tracing: preserve inbound `traceparent`; the server emits `traceparent`, `traceId`, and `spanId` for each request log.

## Deploy

1. Run `npm ci`.
2. Run `npm run ci`.
3. Build the production bundle with `npm run build`.
4. Start with `NODE_ENV=production npm start`.
5. Confirm `/api/health` returns `status: "healthy"` and `/api/metrics` includes `gin_paradise_requests_total`.

## Rollback

1. Redeploy the previous known-good commit or image.
2. Confirm the rollback with `/api/health`.
3. Check logs for `server.started`, `request.failed`, and repeated 5xx responses.
4. Verify live-room behavior with a multiplayer smoke test before reopening traffic.

## Incident Triage

- 5xx spike: inspect `request.failed` logs by `requestId`, route, and status code.
- Slow responses: compare `gin_paradise_request_duration_ms_avg` and `gin_paradise_request_duration_ms_max`.
- Cross-service failures: search logs by `traceId` first, then by `requestId`.
- Multiplayer issues: check `/api/health` coordinator fields and WebSocket startup logs.
- Database issues: check `/api/health` database status and SQLite file permissions.

## Operational Notes

- Preserve `x-request-id` from upstream proxies; otherwise the server generates one.
- Do not log secrets, bearer tokens, cookies, or session IDs. The logger redacts common sensitive keys.
- Keep `.env` values out of commits and prefer platform-managed secrets for production.
## Multiplayer scaling and latency constraints

- Matchmaking re-evaluates local waiting players every 30 seconds as their
  rating brackets expand. Queue state is mirrored through the coordinator for
  deduplication and diagnostics, but pairing still requires both WebSockets on
  the same application node. Production deployments must use sticky routing
  for the matchmaking WebSocket until cross-node match creation and handoff is
  implemented.
- Gameplay actions wait for the Redis room-state commit before broadcast. This
  is an intentional durability barrier and places Redis round-trip latency on
  the player input path. Before deploying against a remote Redis, measure p50,
  p95, and p99 action-to-broadcast latency from every application region under
  expected peak concurrency. Do not promote a topology whose p95 exceeds the
  product's documented interaction budget; no remote-Redis latency result is
  assumed by the local readiness suite.
