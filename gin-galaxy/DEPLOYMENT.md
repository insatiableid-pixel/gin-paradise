# Gin Paradise — Deployment Guide

> **Audience:** A technically basic operator deploying Gin Paradise for the first time.
> **Architecture:** Single-instance Node.js server with SQLite. No external databases, caches, or message queues required.

---

## What You Need

| Requirement | Details |
|---|---|
| **Node.js** | v18+ (recommended: v20 LTS or newer) |
| **Persistent disk** | Required — the SQLite database file must survive restarts |
| **WebSocket support** | Required — the multiplayer game uses WebSocket connections |
| **Single instance** | Run exactly one instance. SQLite does not support multi-process writes. |
| **Memory** | ~128 MB minimum. A 512 MB instance is comfortable for a small beta. |

---

## Quick Start (Local)

```bash
cd gin-galaxy
cp .env.example .env          # Edit to add your GEMINI_API_KEY (optional)
npm install                    # Install dependencies (first time only)
npm run dev                    # Starts dev server on http://localhost:3000
```

---

## Production Deployment

### 1. Build the Frontend

```bash
cd gin-galaxy
npm install
npm run build                  # Compiles React/Vite to ./dist/
```

### 2. Configure Environment

Create a `.env` file (or set environment variables directly in your hosting platform):

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_PATH=/data/database.sqlite    # Use your persistent disk path
TRUST_PROXY=true                        # Required behind Render/Railway/Fly/nginx
GEMINI_API_KEY=your-key-here            # Optional — only affects AI analysis
```

### 3. Start the Server

```bash
npm start
# or equivalently:
NODE_ENV=production tsx server.ts
```

The server will:
- Print a configuration summary to stdout
- Serve the pre-built frontend from `./dist/`
- Listen on the configured port (default: 3000)
- Accept WebSocket connections on `/ws`
- Respond to health checks on `/api/health`

---

## Environment Variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `NODE_ENV` | `development` | No | Set to `production` to serve static files instead of Vite dev server |
| `PORT` | `3000` | No | HTTP server port |
| `HOST` | `0.0.0.0` | No | Bind address. Use `127.0.0.1` to restrict to localhost. |
| `DATABASE_PATH` | `./database.sqlite` | **Yes** (for persistent deployments) | Path to the SQLite database file. Must be on persistent storage. |
| `TRUST_PROXY` | `false` | **Yes** (behind reverse proxy) | Set to `true` for correct IP resolution behind a reverse proxy |
| `GEMINI_API_KEY` | _(empty)_ | No | Google Gemini API key for AI match analysis. Without it, analysis returns a structured fallback. All gameplay works without it. |
| `ALLOWED_ORIGINS` | _(empty)_ | No | Comma-separated CORS origins if serving frontend from a different domain |

---

## Health Check

```
GET /api/health
```

Returns:
```json
{
  "status": "healthy",
  "timestamp": "2026-03-11T22:30:00.000Z",
  "uptime": 3600,
  "version": "1.0.0-beta",
  "database": "connected",
  "environment": "production"
}
```

Use this endpoint for platform health checks (Render, Railway, Fly, etc.) and uptime monitoring. It is unauthenticated and does not expose secrets.

---

## Platform-Specific Guidance

### Render

1. **Build Command:** `npm install && npm run build`
2. **Start Command:** `npm start`
3. **Environment:** Set `NODE_ENV=production`, `TRUST_PROXY=true`, and `DATABASE_PATH` to a path on the persistent disk
4. **Disk:** Attach a persistent disk and set `DATABASE_PATH` to a path on it (e.g., `/data/database.sqlite`)
5. **Health Check:** Set the health check path to `/api/health`
6. **WebSocket:** Render supports WebSockets by default on Web Services

### Railway

1. **Build Command:** `npm install && npm run build`
2. **Start Command:** `npm start`
3. **Environment:** Set `NODE_ENV=production`, `TRUST_PROXY=true`
4. **Volume:** Attach a volume and set `DATABASE_PATH` to a path on the volume
5. **WebSocket:** Railway supports WebSockets by default

### Fly.io

1. **Dockerfile:** Use a Node.js base image, copy the project, run `npm install && npm run build`
2. **Environment:** Set via `fly secrets set NODE_ENV=production TRUST_PROXY=true`
3. **Volume:** Create a volume and mount it; set `DATABASE_PATH` to a path on the mount
4. **Scaling:** Run exactly 1 instance (`fly scale count 1`)

### VPS with nginx

1. Run the app directly with `npm start`
2. Configure nginx to proxy HTTP and WebSocket:

```nginx
server {
    listen 80;
    server_name ginparadise.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

3. Set `TRUST_PROXY=true` in the app's environment
4. Use a process manager like systemd or PM2 to keep it running:

```bash
# PM2 example:
pm2 start "npm start" --name gin-paradise
pm2 save
```

---

## WebSocket Notes

- The app uses WebSockets on the `/ws` path for real-time multiplayer
- All WebSocket connections require a valid session token passed as a query parameter: `ws://host:port/ws?token=SESSION_TOKEN`
- Common reverse proxy issue: make sure your proxy passes the `Upgrade` and `Connection` headers
- The app handles WebSocket upgrades manually on the HTTP server, so it works correctly with both Vite HMR (dev) and static serving (prod)

---

## SQLite Notes

- **Single instance only.** SQLite is not designed for concurrent writes from multiple processes. Run exactly one instance of the server.
- **WAL mode** is enabled by default for better read performance during concurrent operations.
- **Database file must be on persistent storage.** On platforms like Render or Railway, ephemeral file systems will lose data on restart. Attach a persistent disk or volume.
- **Backup:** To back up the database, copy the `database.sqlite`, `database.sqlite-wal`, and `database.sqlite-shm` files. Alternatively, use SQLite's `.backup` command.

---

## Graceful Shutdown

The server handles `SIGTERM` and `SIGINT` gracefully:

1. Stops accepting new HTTP connections
2. Closes all WebSocket client connections
3. Clears background timers (session purge, room cleanup)
4. Closes the SQLite database connection
5. Exits after a 2-second drain period

This makes it safe to deploy behind process managers (PM2, systemd) and container orchestrators (Docker, Kubernetes).

---

## Admin Access

Admin accounts are provisioned via direct database update (intentionally — no self-service admin promotion):

```sql
sqlite3 database.sqlite "UPDATE users SET is_admin = 1 WHERE username = 'your_admin_username';"
```

Admin endpoints at `/api/admin/*` are read-only and require both a valid session and the `is_admin` flag.

---

## What This Architecture Does NOT Support (Yet)

| Limitation | Workaround |
|---|---|
| Horizontal scaling (multiple instances) | Run one instance. Use a bigger instance if needed. |
| PostgreSQL or Redis | Not needed for a single-node beta. Migrate when real scale demands it. |
| Automated database migrations | Migrations run on startup automatically. |
| HTTPS termination | Use your reverse proxy or platform (Render/Railway do this for you). |
| Automated backups | Copy the SQLite file. Set up a cron job if needed. |

---

## GEMINI_API_KEY (AI Analysis)

The Gemini API key is **completely optional**. Without it:
- All gameplay features work normally
- AI-powered match analysis returns a structured fallback with match statistics and general tips
- The server logs a note at startup indicating analysis is in fallback mode

To enable full AI analysis:
1. Get an API key at https://aistudio.google.com/apikey
2. Add `GEMINI_API_KEY=your-key-here` to your `.env` file or environment
3. Restart the server
