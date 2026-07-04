# Gin Paradise Runbook

## Runtime Checks

- Health: `GET /api/health`
- Metrics: `GET /api/metrics`
- Logs: structured JSON on stdout/stderr. Use `LOG_LEVEL=debug|info|warn|error` to tune verbosity.

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
- Multiplayer issues: check `/api/health` coordinator fields and WebSocket startup logs.
- Database issues: check `/api/health` database status and SQLite file permissions.

## Operational Notes

- Preserve `x-request-id` from upstream proxies; otherwise the server generates one.
- Do not log secrets, bearer tokens, cookies, or session IDs. The logger redacts common sensitive keys.
- Keep `.env` values out of commits and prefer platform-managed secrets for production.
