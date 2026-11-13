# Operations

## Local setup

Use Node 24.x. Install the lockfile exactly with `npm ci`, copy `.env.example` to `.env`, then start development with `npm run dev`. The API binds to `127.0.0.1`; Vite proxies API requests to it. Use `npm run build && npm start` for the production build.

## Configuration

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Server-side model credential |
| `OPENAI_MODEL` | Explicit Responses API model name |
| `TAVILY_API_KEY` | Server-side public search credential |
| `PORT` | Local API port |
| `DATA_DIR` | Directory for the SQLite database |
| `MAX_MODEL_CALLS` | Maximum model dispatches per run |
| `MAX_SEARCH_QUERIES` | Maximum search queries per run |
| `MAX_SEARCH_BATCHES` | Maximum search batches per run |
| `SEARCH_CONCURRENCY` | Concurrent searches, capped by scheduler behavior |
| `MAX_RUN_MS` | Hard run time limit |
| `ACQUISITION_CUTOFF_MS` | Search acquisition cutoff within the run limit |
| `ACTIVE_RUN_PER_CONVERSATION` | Concurrent run limit per conversation |
| `PROCESS_ACTIVE_RUNS` | Process-wide active run limit |

Do not put credentials in `VITE_*` variables or browser storage. Readiness reports configuration booleans and a model label, not secret values. Missing credentials disable live generation/search; they do not enable a demo fallback.

## Local data

Conversation deletion marks the conversation deleted and removes its original messages. Full cleanup/invalidation of derived run, evidence, and result rows still needs lifecycle hardening. Deleting the configured data directory removes the entire local database. The `data/` directory, `.env`, Playwright output, and build output are excluded from version control.

## Evaluation commands

- `npm run check`: typecheck, deterministic tests, production build.
- `npm run test:e2e`: Playwright browser workflows using the isolated scripted test server.
- `npm run eval:offline`: scripted coordinator cases; JSON output goes to `data/offline-eval/latest.json`.

There is no authorized live evaluation in this delivery. Do not infer live answer quality from scripted tests.
