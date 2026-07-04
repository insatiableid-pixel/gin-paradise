# AGENTS.md

## Project

This repository contains the Gin Paradise web app in `gin-galaxy/`.

## Commands

Run commands from `gin-galaxy/` unless noted otherwise.

```bash
npm install
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run quality:readiness
```

Redis-backed integration tests require `REDIS_URL`:

```bash
npm run test:redis
```

## Conventions

- TypeScript is strict; avoid `any` unless a boundary genuinely needs it.
- React components and type-like declarations use PascalCase.
- Runtime code lives in `src/` for the client and `server/` for Express, SQLite, and multiplayer services.
- Unit tests live in `gin-galaxy/tests/` and use the `*.test.ts` naming convention.
- Do not commit generated artifacts, local databases, logs, screenshots, or dependency folders.
- Use `npm run agent:decompose` for broad objectives that need parallel work lanes.

## Validation

Before opening a PR or pushing a risky change, run:

```bash
npm run ci
npm run test:e2e
```
