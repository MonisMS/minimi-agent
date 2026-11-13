# Minimi agent

Minimi is a local conversational research assistant. It stores original conversation turns, can recall dated discussions, and can recheck a saved recommendation using retained source evidence. It keeps unknown or incomparable results unresolved.

## Requirements

- Ubuntu 22.04 / WSL or another supported local environment
- Node.js 24.x and npm

## Install and run

```sh
npm ci
cp .env.example .env
# Edit .env only when live model/search access is intended.
npm run dev
```

The development UI and API bind to loopback. Without provider credentials, saved history and deterministic local checks remain available; live answer generation is unavailable. To run the production build, use `npm run build` followed by `npm start`.

Set `OPENAI_API_KEY` and `OPENAI_MODEL` for model generation and `TAVILY_API_KEY` for public search. Secrets stay server-side. `DATA_DIR` selects the directory for the local SQLite database. Conversation deletion hides the conversation and removes its original messages; complete cleanup and invalidation of derived rows still needs lifecycle hardening. Deleting the whole data directory removes the local database.

## Checks and evaluation

```sh
npm run check
npm run test:e2e
npm run eval:offline
```

`eval:offline` exercises deterministic integration cases through the scripted chat/recheck pipeline. It writes detailed machine-readable results to ignored `data/offline-eval/latest.json`. These results measure orchestration and fixed assertions, not real-model reasoning quality. No live-provider evaluation has been run.

See [DESIGN.md](DESIGN.md), [operations](docs/OPERATIONS.md), [validation evidence and limitations](docs/VALIDATION.md), [attribution](docs/ATTRIBUTION.md), and the [60-second walkthrough checklist](docs/DEMO_VIDEO.md).

## Current limits

Lifecycle hardening remains incomplete. The isolated demo namespace and browser smoke test are present, while a richer seeded walkthrough covering recall, term mismatch, and unresolved evidence remains limited to scripted pipeline regression coverage. Live model/search behavior, source-support quality, provider cost, and supported-answer latency have not been measured. No benchmark or submission-selection claim is made. Tests, typechecks and builds were intentionally not rerun during this publication; the validation document distinguishes earlier reported development results from this push.
