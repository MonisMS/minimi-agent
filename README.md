# Minimi agent

A TypeScript chat-agent project. This branch contains the foundation, shared domain contracts, run-budget primitives, scoped original-history storage, durable run lifecycle, reconnectable HTTP/event transport and deterministic date resolution (implementation chunks 00–06). It is an incremental checkpoint, not a completed chat agent or final submission.

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

Run admission persists the question and run atomically, reconciles request keys, supports linked retries and enforces active-run limits. Terminal updates check version and conversation generation; startup interrupts old active runs without replaying provider work.

Scoped HTTP routes provide conversations, saved messages, run admission/state/cancellation and conversation deletion. Event subscriptions send a current snapshot followed by persisted sequenced events, without starting execution. Completed injected answers are saved atomically with terminal state. Production has no executor at this checkpoint: new run admission returns 503 rather than generating a fake answer. Tests inject controlled executors without paid calls.

The date resolver uses an injected reference time and IANA timezone, returning local labels, exclusive UTC windows and explicit ambiguity/unsupported phrases. Tests cover missing years, leap dates, ambiguous weekdays and 23/25-hour daylight-saving days. It is an internal primitive; original-history retrieval is not connected yet.

Live model/search adapters, original-history retrieval, evidence storage, rechecks and the full chat UI are not included in this branch.

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
