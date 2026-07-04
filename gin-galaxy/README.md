# Gin Paradise

A competitive Gin Rummy platform with AI opponents, real-time multiplayer, tournament mode, match analysis, and a sleek modern interface.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and set your `GEMINI_API_KEY` (optional — AI analysis only)
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Common Commands

```bash
npm run dev          # Start the Express + Vite development server
npm run build        # Build the production frontend bundle
npm run preview      # Preview the production bundle locally
npm run typecheck    # Run TypeScript with strict checking
npm run lint         # Run ESLint
npm test             # Run the Vitest unit suite
npm run test:e2e     # Run Playwright browser smoke tests
npm run test:flaky   # Repeat the test suite for flake detection
npm run test:timed   # Run Vitest with per-test timing output
npm run analyze:bundle # Build and write dist/bundle-stats.html
npm run quality:readiness # Generate the readiness audit report
npm run agent:decompose # Generate parallel work lanes for a broad objective
```

## Autonomous Readiness

See [docs/AUTONOMOUS_OPERATIONS.md](docs/AUTONOMOUS_OPERATIONS.md) for the Level 5 automation loop, evidence surfaces, and external platform requirements.

## Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for full deployment instructions.
