# Minimi agent

A TypeScript chat-agent project. This branch contains the foundation, shared domain contracts, run-budget primitives and scoped original-history storage (implementation chunks 00–03). It is an incremental checkpoint, not a completed chat agent or final submission.

## Run locally

Use Node 24 (the tested installation is 24.22.3).

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173. API readiness is at http://127.0.0.1:3000/api/readiness. No credentials are needed for this checkpoint. Configuration examples contain blank keys; never commit populated secrets.

## Implemented

- Express API foundation and React/Vite readiness interface.
- Runtime-validated domain contracts, injectable clocks and bounded model/search accounting primitives.
- SQLite owners, scoped conversations and immutable original message text, with full-text lookup and numbered migrations.
- Deterministic tests for configuration, budgets, validation, persistence and owner/namespace isolation.

Live model/search adapters, run admission and streaming, dated recall, evidence storage, rechecks and the full chat UI are not included in this branch.

## Verification

```bash
npm run check
npm run build
npm start
```

The check command runs TypeScript validation, deterministic tests and the production build. Tests use temporary databases and scripted transports, with no paid provider calls.

## Local data

The server creates its SQLite database in `data/` by default. Keep this directory and database files out of Git. `DATA_DIR` and other supported settings are documented in `.env.example`. All keys stay on the server.

Internal execution guides and repository research are excluded from this branch's current file list. This branch retains earlier Git history; deleting documents from the current tree does not erase their historical versions.
