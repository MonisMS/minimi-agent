# Minimi agent

A TypeScript conversational research agent with persistent original conversation history, dated recall, evidence storage and bounded web search. Configured model and search services are now connected to the backend. The full chat interface and historical recommendation rechecks are still in development.

## Run locally

Use Node 24 (the tested installation is 24.22.3).

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173 for the current readiness interface. API readiness is at http://127.0.0.1:3000/api/readiness. Set OPENAI_API_KEY and OPENAI_MODEL in your local .env to enable backend generation; set TAVILY_API_KEY for current web research. Without credentials, saved data remains readable and readiness reports unavailable generation. Configuration examples contain blank keys; never commit populated secrets.

## Implemented

- Express API foundation and React/Vite readiness interface.
- Runtime-validated domain contracts, injectable clocks and bounded model/search accounting primitives.
- SQLite owners, scoped conversations and immutable original message text, with full-text lookup and numbered migrations.
- Deterministic tests for configuration, budgets, validation, persistence and owner/namespace isolation.

Run admission persists the question and run atomically, reconciles request keys, supports linked retries and enforces active-run limits. Terminal updates check version and conversation generation; startup interrupts old active runs without replaying provider work.

Scoped HTTP routes provide conversations, saved messages, run admission/state/cancellation and conversation deletion. Event subscriptions send a current snapshot followed by persisted sequenced events, without starting execution. Final answers are saved atomically with terminal state. Configured generation executes through the same run lifecycle; an unconfigured server rejects new generation rather than returning a fake answer.

The date resolver uses an injected reference time and IANA timezone, returning local labels, exclusive UTC windows and explicit ambiguity/unsupported phrases. Tests cover missing years, leap dates, ambiguous weekdays and 23/25-hour daylight-saving days. It is an internal primitive; original-history retrieval is not connected yet.

Retrieval queries scoped original messages by calendar window, full-text terms and recent conversational context. It reports candidate bounds/ambiguity and expands saved exchanges. Historical recall answers from saved originals without current web search; ambiguous dates produce a clarification.

Evidence storage retains bounded exact source text, separate observation/publication/effective dates and immutable captures. Scoped repository access and quote/span validation operate on the saved text. It does not provide arbitrary URL fetching.

The Tavily adapter, single web_search tool schema and fair search scheduler support current public research. Acquisition uses shared query/batch budgets, bounded concurrency, explicit error outcomes and observation registration. Ordinary conversation does not require web research.

The OpenAI Responses adapter supports streamed text, custom tool continuations and structured output with explicit model configuration and disabled automatic retries. Refusal, incomplete response, invalid structured output and cancellation remain distinct outcomes. The chat coordinator shares one budget across model requests and searches, excludes provisional pre-tool prose from the final answer, and retains acquired source references.

Historical recommendation rechecks and the full chat UI are not included. Tests, typechecks and builds were intentionally not rerun for the latest publication updates. No live provider calls were made during publication.

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
